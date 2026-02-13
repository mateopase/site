<script lang="ts">
	import { onMount } from 'svelte';

	type FrequencyBucket = {
		index: number;
		frequency: number;
		baseAmplitude: number;
	};

	type Lfo = {
		rate: number;
		depth: number;
		phase: number;
	};

	type BackgroundWave = {
		id: number;
		freq: number;
		amp: number;
		duration: number;
		delay: number;
		phase: number;
	};

	let errorMessage = '';
	let fileName = '';
	let duration = 0;
	let sampleRate = 44100;
	let monoData: Float32Array | null = null;
	let sliceStart = 0;
	let sliceEnd = 0;
	let buckets: FrequencyBucket[] = [];
	let gainOverrides: number[] = Array(30).fill(1);
	let lfos: Lfo[] = Array.from({ length: 30 }, () => ({ rate: 0, depth: 0, phase: 0 }));
	let synthesizedSlice: AudioBuffer | null = null;
	let ctx: AudioContext | null = null;
	let blendMode: 'random' | 'low-high' | 'high-low' | 'middle-out' = 'random';
	let pitchMultiplier = 1;
	let isRecording = false;
	let recordSecondsLeft = 5;
	let recorder: MediaRecorder | null = null;
	let bgRows = 9;
	const bgCols = 20;
	let backgroundWaves: BackgroundWave[] = [];
	let fileInput: HTMLInputElement;

	const fftSize = 4096;

	const refreshBackground = () => {
		if (typeof window !== 'undefined') {
			bgRows = Math.max(7, Math.ceil(window.innerHeight / 92));
		}
		const count = bgRows * bgCols;
		backgroundWaves = Array.from({ length: count }, (_, i) => ({
			id: i,
			freq: 8 + Math.random() * 84,
			amp: 0.1 + Math.random() * 0.7,
			duration: 7 + Math.random() * 12,
			delay: -Math.random() * 12,
			phase: Math.random() * Math.PI * 2
		}));
	};

	onMount(() => {
		refreshBackground();
		window.addEventListener('resize', refreshBackground);
		return () => window.removeEventListener('resize', refreshBackground);
	});

	const getAudioContext = async () => {
		if (!ctx) {
			ctx = new AudioContext();
		}
		if (ctx.state === 'suspended') {
			await ctx.resume();
		}
		return ctx;
	};

	const normalize = (values: number[]) => {
		const max = Math.max(...values, 1e-6);
		return values.map((value) => value / max);
	};

	const createMono = (audio: AudioBuffer) => {
		const length = audio.length;
		const output = new Float32Array(length);
		for (let c = 0; c < audio.numberOfChannels; c++) {
			const channel = audio.getChannelData(c);
			for (let i = 0; i < length; i++) {
				output[i] += channel[i] / audio.numberOfChannels;
			}
		}
		return output;
	};

	const getSlice = () => {
		if (!monoData) return null;
		const startIndex = Math.floor(sliceStart * sampleRate);
		const endIndex = Math.floor(sliceEnd * sampleRate);
		return monoData.slice(startIndex, Math.max(startIndex + 32, endIndex));
	};

	const bitReverse = (value: number, bits: number) => {
		let reversed = 0;
		for (let i = 0; i < bits; i++) {
			reversed = (reversed << 1) | (value & 1);
			value >>= 1;
		}
		return reversed;
	};

	const fftReal = (input: Float32Array) => {
		const n = input.length;
		const bits = Math.log2(n);
		const real = new Float32Array(n);
		const imag = new Float32Array(n);

		for (let i = 0; i < n; i++) {
			const j = bitReverse(i, bits);
			real[j] = input[i];
		}

		for (let size = 2; size <= n; size *= 2) {
			const half = size / 2;
			const theta = (-2 * Math.PI) / size;
			for (let start = 0; start < n; start += size) {
				for (let k = 0; k < half; k++) {
					const even = start + k;
					const odd = even + half;
					const angle = theta * k;
					const wr = Math.cos(angle);
					const wi = Math.sin(angle);

					const tr = wr * real[odd] - wi * imag[odd];
					const ti = wr * imag[odd] + wi * real[odd];

					real[odd] = real[even] - tr;
					imag[odd] = imag[even] - ti;
					real[even] += tr;
					imag[even] += ti;
				}
			}
		}

		return { real, imag };
	};

	const applyBlendMode = () => {
		if (!buckets.length) return;
		const center = (buckets.length - 1) / 2;
		lfos = buckets.map((_, idx) => {
			const x = idx / Math.max(buckets.length - 1, 1);
			if (blendMode === 'random') {
				return {
					rate: 0.3 + Math.random() * 5.5,
					depth: 0.2 + Math.random() * 0.65,
					phase: Math.random() * Math.PI * 2
				};
			}
			if (blendMode === 'low-high') {
				return {
					rate: 0.2 + x * 9,
					depth: 0.25 + x * 0.55,
					phase: x * Math.PI
				};
			}
			if (blendMode === 'high-low') {
				const inv = 1 - x;
				return {
					rate: 0.2 + inv * 9,
					depth: 0.25 + inv * 0.55,
					phase: inv * Math.PI
				};
			}
			const dist = Math.abs(idx - center) / Math.max(center, 1);
			const towardEdge = 1 - dist;
			return {
				rate: 0.25 + towardEdge * 8,
				depth: 0.2 + towardEdge * 0.65,
				phase: dist * Math.PI
			};
		});
		applySynthesis();
	};

	const analyzeSlice = () => {
		const slice = getSlice();
		if (!slice) return;

		const windowed = new Float32Array(fftSize);
		for (let i = 0; i < fftSize; i++) {
			const sample = slice[i] ?? 0;
			const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
			windowed[i] = sample * hann;
		}

		const { real, imag } = fftReal(windowed);
		const magnitudes: { index: number; magnitude: number }[] = [];
		for (let i = 1; i < fftSize / 2; i++) {
			const magnitude = Math.hypot(real[i], imag[i]);
			magnitudes.push({ index: i, magnitude });
		}

		magnitudes.sort((a, b) => b.magnitude - a.magnitude);
		const top = magnitudes.slice(0, 30);
		const normalized = normalize(top.map((m) => m.magnitude));

		buckets = top
			.map((entry, idx) => ({
				index: idx,
				frequency: (entry.index * sampleRate) / fftSize,
				baseAmplitude: normalized[idx]
			}))
			.sort((a, b) => a.frequency - b.frequency);

		gainOverrides = Array(30).fill(1);
		applyBlendMode();
	};

	const applySynthesis = () => {
		if (!buckets.length || !monoData) return;
		const sourceSlice = getSlice();
		if (!sourceSlice) return;

		const out = new Float32Array(sourceSlice.length);
		for (let i = 0; i < sourceSlice.length; i++) {
			const t = i / sampleRate;
			let sample = 0;
			for (const bucket of buckets) {
				const gain = gainOverrides[bucket.index] ?? 1;
				const lfo = lfos[bucket.index] ?? { rate: 0, depth: 0, phase: 0 };
				const modulation = 1 + lfo.depth * Math.sin(2 * Math.PI * lfo.rate * t + lfo.phase);
				sample +=
					bucket.baseAmplitude *
					gain *
					modulation *
					Math.sin(2 * Math.PI * bucket.frequency * pitchMultiplier * t);
			}
			out[i] = sample;
		}

		const peak = Math.max(...out.map((v) => Math.abs(v)), 1e-6);
		for (let i = 0; i < out.length; i++) {
			out[i] = (out[i] / peak) * 0.9;
		}

		const audioBuffer = new AudioBuffer({ length: out.length, sampleRate, numberOfChannels: 1 });
		audioBuffer.getChannelData(0).set(out);
		synthesizedSlice = audioBuffer;
	};

	const processFile = async (file: File) => {
		errorMessage = '';
		const context = await getAudioContext();
		const bytes = await file.arrayBuffer();
		const decoded = await context.decodeAudioData(bytes.slice(0));

		if (decoded.duration > 5) {
			errorMessage = 'Please use audio that is 5 seconds or shorter.';
			monoData = null;
			buckets = [];
			return;
		}

		fileName = file.name;
		duration = decoded.duration;
		sampleRate = decoded.sampleRate;
		monoData = createMono(decoded);
		sliceStart = 0;
		sliceEnd = Math.min(decoded.duration, 1.5);
		analyzeSlice();
	};

	const onUpload = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		await processFile(file);
	};

	const startRecording = async () => {
		errorMessage = '';
		if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
			errorMessage = 'Recording is not supported in this browser.';
			return;
		}
		if (isRecording) return;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const chunks: BlobPart[] = [];
			recorder = new MediaRecorder(stream);
			isRecording = true;
			recordSecondsLeft = 5;

			recorder.ondataavailable = (evt) => {
				if (evt.data.size) chunks.push(evt.data);
			};

			recorder.onstop = async () => {
				isRecording = false;
				recordSecondsLeft = 5;
				stream.getTracks().forEach((track) => track.stop());
				const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
				const recordedFile = new File([blob], 'recording-5s.webm', { type: blob.type });
				await processFile(recordedFile);
			};

			recorder.start();
			const ticker = window.setInterval(() => {
				recordSecondsLeft -= 1;
				if (recordSecondsLeft <= 0) window.clearInterval(ticker);
			}, 1000);
			window.setTimeout(() => {
				window.clearInterval(ticker);
				if (recorder && recorder.state !== 'inactive') recorder.stop();
			}, 5000);
		} catch {
			errorMessage = 'Microphone permission is required to record a 5 second sample.';
			isRecording = false;
		}
	};

	const onSliceChange = () => {
		if (sliceEnd <= sliceStart) {
			sliceEnd = Math.min(duration, sliceStart + 0.05);
		}
		analyzeSlice();
	};

	const updateGain = (index: number, value: string) => {
		gainOverrides[index] = Number(value);
		gainOverrides = [...gainOverrides];
		applySynthesis();
	};

	const playSynthesis = async () => {
		if (!synthesizedSlice) return;
		const context = await getAudioContext();
		const source = context.createBufferSource();
		source.buffer = synthesizedSlice;
		source.connect(context.destination);
		source.start();
	};

	const wavePath = (frequency: number, amplitude: number) => {
		const width = 170;
		const height = 82;
		const points: string[] = [];
		for (let x = 0; x <= width; x += 4) {
			const phase = (x / width) * Math.PI * 2 * (frequency / 450);
			const y = height / 2 + Math.sin(phase) * amplitude * 30;
			points.push(`${x},${y.toFixed(1)}`);
		}
		return points.join(' ');
	};
</script>

<main class="synth-page">
	<div class="ambient-grid" aria-hidden="true" style={`--rows:${bgRows};--cols:${bgCols};`}>
		{#each backgroundWaves as wave (wave.id)}
			<svg
				viewBox="0 0 110 38"
				class="ambient-wave"
				style={`--dur:${wave.duration}s;--delay:${wave.delay}s;--amp:${wave.amp};--phase:${wave.phase}rad;`}
			>
				<polyline
					fill="none"
					stroke="rgba(226,232,240,0.33)"
					stroke-width="1.3"
					points={wavePath(wave.freq, wave.amp)}
				/>
			</svg>
		{/each}
	</div>

	<section class="top-panel">
		<h1>reSynthesizer</h1>
		<p>Upload or record a 5-second source, extract the top 30 FFT frequencies, then shape and blend the sine stack.</p>

		<div class="ingest-grid">
			<div class="ingest-card">
				<h2>Upload audio</h2>
				<p>Any file format your browser can decode. Max length: 5s.</p>
				<input bind:this={fileInput} type="file" accept="audio/*" on:change={onUpload} />
				<button class="secondary" on:click={() => fileInput.click()}>Choose file</button>
			</div>

			<div class="ingest-card">
				<h2>Record 5 seconds</h2>
				<p>Capture a clean sample right now with your microphone.</p>
				<button on:click={startRecording} disabled={isRecording}>
					{isRecording ? `Recording… ${recordSecondsLeft}s` : 'Start 5s recording'}
				</button>
			</div>
		</div>

		{#if fileName}<p class="file-line">Loaded: {fileName} ({duration.toFixed(2)}s)</p>{/if}
		{#if errorMessage}<p class="error">{errorMessage}</p>{/if}
	</section>

	<section class="analysis" class:active={!!monoData}>
		{#if monoData}
			<section class="slice-ui">
				<label>
					Slice start: {sliceStart.toFixed(2)}s
					<input type="range" min="0" max={duration} step="0.01" bind:value={sliceStart} on:input={onSliceChange} />
				</label>
				<label>
					Slice end: {sliceEnd.toFixed(2)}s
					<input type="range" min="0.05" max={duration} step="0.01" bind:value={sliceEnd} on:input={onSliceChange} />
				</label>
				<label>
					Pitch multiplier: {pitchMultiplier.toFixed(2)}x
					<input
						type="range"
						min="0.5"
						max="2.5"
						step="0.01"
						bind:value={pitchMultiplier}
						on:input={applySynthesis}
					/>
				</label>
				<div class="button-row">
					<button on:click={playSynthesis}>Play resynthesized slice</button>
					<select bind:value={blendMode}>
						<option value="random">Random LFO blend</option>
						<option value="low-high">Fade low → high</option>
						<option value="high-low">Fade high → low</option>
						<option value="middle-out">Fade middle → out</option>
					</select>
					<button class="secondary" on:click={applyBlendMode}>Apply blend mode</button>
				</div>
			</section>

			<section class="grid">
				{#each buckets as bucket (bucket.index)}
					<article class="wave-card">
						<header>
							<strong>{(bucket.frequency * pitchMultiplier).toFixed(1)} Hz</strong>
							<span>Amp {(bucket.baseAmplitude * (gainOverrides[bucket.index] ?? 1)).toFixed(2)}</span>
						</header>
						<svg viewBox="0 0 170 82" role="img" aria-label={`Sine wave at ${bucket.frequency.toFixed(1)} hertz`}>
							<polyline
								fill="none"
								stroke="#f8fafc"
								stroke-width="2"
								points={wavePath(
									bucket.frequency * pitchMultiplier,
									bucket.baseAmplitude * (gainOverrides[bucket.index] ?? 1)
								)}
							/>
						</svg>
						<input
							type="range"
							min="0"
							max="2"
							step="0.01"
							value={gainOverrides[bucket.index] ?? 1}
							on:input={(e) => updateGain(bucket.index, (e.currentTarget as HTMLInputElement).value)}
						/>
					</article>
				{/each}
			</section>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		font-family: 'Times New Roman', Times, serif;
		background: #000;
		color: #f8fafc;
	}

	.synth-page {
		position: relative;
		padding: 1.5rem;
		max-width: 1220px;
		margin: 0 auto;
		min-height: 100vh;
		overflow: hidden;
	}

	.ambient-grid {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		grid-template-rows: repeat(var(--rows), minmax(52px, 1fr));
		gap: 0.3rem;
		pointer-events: none;
		opacity: 0.95;
	}

	.ambient-wave {
		width: 100%;
		height: 100%;
		transform-origin: center;
		animation: drift var(--dur) linear infinite;
		animation-delay: var(--delay);
	}

	@keyframes drift {
		0% {
			transform: translateX(-4px) translateY(0px) rotate(calc(var(--phase) * 0.04));
		}
		50% {
			transform: translateX(5px) translateY(-2px) rotate(calc(var(--phase) * -0.02));
		}
		100% {
			transform: translateX(-4px) translateY(0px) rotate(calc(var(--phase) * 0.04));
		}
	}

	.top-panel {
		position: relative;
		z-index: 2;
		background: linear-gradient(180deg, rgba(9, 9, 11, 0.94), rgba(9, 9, 11, 0.82));
		border: 1px solid rgba(248, 250, 252, 0.16);
		border-radius: 1rem;
		padding: 1.2rem;
		backdrop-filter: blur(2px);
	}

	h1 { margin: 0 0 0.45rem; font-size: 2.15rem; }
	p { margin: 0; color: rgba(248, 250, 252, 0.82); }

	.ingest-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
		margin-top: 1rem;
	}

	.ingest-card {
		padding: 1rem;
		border-radius: 0.85rem;
		border: 1px solid rgba(248, 250, 252, 0.22);
		background: rgba(2, 6, 23, 0.85);
		display: grid;
		gap: 0.7rem;
	}

	.ingest-card h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.ingest-card input[type='file'] {
		display: none;
	}

	button,
	select {
		padding: 0.55rem 0.85rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(248, 250, 252, 0.4);
		background: #f8fafc;
		color: #020617;
		font-family: 'Times New Roman', Times, serif;
		font-size: 0.98rem;
	}

	button.secondary { background: transparent; color: #f8fafc; }
	button:disabled { opacity: 0.55; cursor: not-allowed; }

	.file-line,
	.error {
		margin-top: 0.7rem;
	}

	.error { color: #fda4af; }

	.analysis {
		position: relative;
		z-index: 1;
		margin-top: 1rem;
		border-radius: 1rem;
		opacity: 0;
		background: rgba(0, 0, 0, 0);
		transition: opacity 500ms ease, background-color 500ms ease;
	}

	.analysis.active {
		opacity: 1;
		background: rgba(0, 0, 0, 0.92);
		padding: 1rem;
	}

	.slice-ui { display: grid; gap: 0.8rem; margin: 0.2rem 0 1rem; }
	label { display: grid; gap: 0.4rem; }
	.button-row { display: flex; gap: 0.7rem; flex-wrap: wrap; }

	.grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.wave-card {
		border: 1px solid rgba(248, 250, 252, 0.2);
		border-radius: 0.6rem;
		padding: 0.45rem;
		background: rgba(15, 23, 42, 0.78);
		display: grid;
		gap: 0.45rem;
	}

	.wave-card header {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}

	svg { width: 100%; background: rgba(2, 6, 23, 0.82); border-radius: 0.35rem; }

	@media (max-width: 980px) {
		.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
		.ingest-grid { grid-template-columns: 1fr; }
	}

	@media (max-width: 680px) {
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
