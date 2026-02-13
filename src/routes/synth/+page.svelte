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

	type BgWave = {
		id: number;
		frequency: number;
		amplitude: number;
		speed: number;
		phaseOffset: number;
	};

	type BlendMode = 'random-lfo' | 'low-high' | 'high-low' | 'middle-out';

	let errorMessage = '';
	let infoMessage = '';
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
	let blendMode: BlendMode = 'random-lfo';
	let pitchMultiplier = 1;
	let blendProgress = 0;

	let captureMode: 'upload' | 'record' = 'upload';
	let isRecording = false;
	let recordingCountdown = 5;
	let mediaRecorder: MediaRecorder | null = null;
	let recordedChunks: BlobPart[] = [];
	let recordingTimer: ReturnType<typeof setInterval> | null = null;

	let viewportHeight = 900;
	let bgWaves: BgWave[] = [];
	let bgPhase = 0;
	let hasAnalysis = false;

	const fftSize = 4096;
	const bgColumns = 20;

	const getAudioContext = async () => {
		if (!ctx) ctx = new AudioContext();
		if (ctx.state === 'suspended') await ctx.resume();
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
		return monoData.slice(startIndex, Math.max(startIndex + 64, endIndex));
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
			real[bitReverse(i, bits)] = input[i];
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

	const blendEnvelope = (index: number, t: number) => {
		const normalizedIndex = index / 29;
		if (blendMode === 'low-high') {
			const startAt = normalizedIndex * 0.55;
			return Math.max(0, Math.min(1, (t - startAt) / 0.45));
		}
		if (blendMode === 'high-low') {
			const startAt = (1 - normalizedIndex) * 0.55;
			return Math.max(0, Math.min(1, (t - startAt) / 0.45));
		}
		if (blendMode === 'middle-out') {
			const distance = Math.abs(normalizedIndex - 0.5) * 2;
			const startAt = distance * 0.6;
			return Math.max(0, Math.min(1, (t - startAt) / 0.4));
		}
		return 1;
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
			magnitudes.push({ index: i, magnitude: Math.hypot(real[i], imag[i]) });
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
		hasAnalysis = true;
		applyBlendMode(blendMode);
		applySynthesis();
	};

	const applySynthesis = () => {
		if (!buckets.length || !monoData) return;
		const sourceSlice = getSlice();
		if (!sourceSlice) return;

		const out = new Float32Array(sourceSlice.length);
		for (let i = 0; i < sourceSlice.length; i++) {
			const t = i / sampleRate;
			const blendT = i / Math.max(1, sourceSlice.length - 1);
			let sample = 0;
			for (const bucket of buckets) {
				const gain = gainOverrides[bucket.index] ?? 1;
				const lfo = lfos[bucket.index] ?? { rate: 0, depth: 0, phase: 0 };
				const modulation = 1 + lfo.depth * Math.sin(2 * Math.PI * lfo.rate * t + lfo.phase);
				const envelope = blendEnvelope(bucket.index, blendT);
				sample +=
					bucket.baseAmplitude *
					gain *
					modulation *
					envelope *
					Math.sin(2 * Math.PI * bucket.frequency * pitchMultiplier * t);
			}
			out[i] = sample;
		}

		const peak = Math.max(...out.map((v) => Math.abs(v)), 1e-6);
		for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.9;

		const audioBuffer = new AudioBuffer({ length: out.length, sampleRate, numberOfChannels: 1 });
		audioBuffer.getChannelData(0).set(out);
		synthesizedSlice = audioBuffer;
	};

	const handleAudioBlob = async (blob: Blob, name: string) => {
		errorMessage = '';
		infoMessage = '';
		const context = await getAudioContext();
		const bytes = await blob.arrayBuffer();
		const decoded = await context.decodeAudioData(bytes.slice(0));

		if (decoded.duration > 5) {
			errorMessage = 'Please upload or record audio that is 5 seconds or shorter.';
			monoData = null;
			buckets = [];
			hasAnalysis = false;
			return;
		}

		fileName = name;
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
		await handleAudioBlob(file, file.name);
	};

	const startRecording = async () => {
		errorMessage = '';
		infoMessage = '';
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			recordedChunks = [];
			mediaRecorder = new MediaRecorder(stream);
			isRecording = true;
			recordingCountdown = 5;

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) recordedChunks.push(event.data);
			};

			mediaRecorder.onstop = async () => {
				stream.getTracks().forEach((track) => track.stop());
				isRecording = false;
				if (recordingTimer) clearInterval(recordingTimer);
				const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
				await handleAudioBlob(blob, 'Recorded clip');
				infoMessage = 'Recording complete. FFT + synthesis updated.';
			};

			mediaRecorder.start();
			recordingTimer = setInterval(() => {
				recordingCountdown -= 1;
				if (recordingCountdown <= 0) {
					stopRecording();
				}
			}, 1000);
			setTimeout(() => {
				if (isRecording) stopRecording();
			}, 5000);
		} catch {
			errorMessage = 'Microphone access failed. Please allow mic permission and try again.';
		}
	};

	const stopRecording = () => {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
	};

	const onSliceChange = () => {
		if (sliceEnd <= sliceStart) sliceEnd = Math.min(duration, sliceStart + 0.05);
		analyzeSlice();
	};

	const updateGain = (index: number, value: string) => {
		gainOverrides[index] = Number(value);
		gainOverrides = [...gainOverrides];
		applySynthesis();
	};

	const applyBlendMode = (mode: BlendMode) => {
		blendMode = mode;
		if (mode === 'random-lfo') {
			lfos = buckets.map(() => ({
				rate: 0.25 + Math.random() * 4,
				depth: 0.1 + Math.random() * 0.8,
				phase: Math.random() * Math.PI * 2
			}));
		} else {
			lfos = Array.from({ length: 30 }, () => ({ rate: 0, depth: 0, phase: 0 }));
		}
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
		const width = 190;
		const height = 88;
		const points: string[] = [];
		for (let x = 0; x <= width; x += 4) {
			const phase = (x / width) * Math.PI * 2 * (frequency / 320) + blendProgress * 0.6;
			const y = height / 2 + Math.sin(phase) * amplitude * 30;
			points.push(`${x},${y.toFixed(1)}`);
		}
		return points.join(' ');
	};

	const buildBackgroundWaves = () => {
		const rows = Math.max(4, Math.ceil(viewportHeight / 92));
		const count = rows * bgColumns;
		bgWaves = Array.from({ length: count }, (_, id) => ({
			id,
			frequency: 8 + Math.random() * 88,
			amplitude: 0.2 + Math.random() * 0.55,
			speed: 0.2 + Math.random() * 0.9,
			phaseOffset: Math.random() * Math.PI * 2
		}));
	};

	const bgWavePath = (wave: BgWave) => {
		const width = 90;
		const height = 34;
		const points: string[] = [];
		for (let x = 0; x <= width; x += 3) {
			const angle = (x / width) * Math.PI * 2 + bgPhase * wave.speed + wave.phaseOffset;
			const y = height / 2 + Math.sin(angle) * (6 + wave.amplitude * 8);
			points.push(`${x},${y.toFixed(1)}`);
		}
		return points.join(' ');
	};

	onMount(() => {
		const handleResize = () => {
			viewportHeight = window.innerHeight;
			buildBackgroundWaves();
		};

		handleResize();
		window.addEventListener('resize', handleResize);

		let raf = 0;
		const tick = () => {
			blendProgress += 0.01;
			bgPhase += 0.016;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);

		return () => {
			window.removeEventListener('resize', handleResize);
			if (recordingTimer) clearInterval(recordingTimer);
			cancelAnimationFrame(raf);
		};
	});
</script>

<main class="synth-page {hasAnalysis ? 'focused' : ''}">
	<div class="bg-grid" aria-hidden="true" style={`grid-template-columns:repeat(${bgColumns},minmax(0,1fr));`}>
		{#each bgWaves as wave (wave.id)}
			<div class="bg-cell">
				<svg viewBox="0 0 90 34">
					<polyline fill="none" stroke="rgba(229,229,229,0.36)" stroke-width="1.35" points={bgWavePath(wave)} />
				</svg>
			</div>
		{/each}
	</div>

	<section class="hero-card">
		<h1>reSynthesizer</h1>
		<p>Upload or record up to five seconds, isolate a slice, analyze top harmonics, and sculpt your resynthesis.</p>

		<div class="mode-toggle">
			<button class:active={captureMode === 'upload'} on:click={() => (captureMode = 'upload')}>Upload</button>
			<button class:active={captureMode === 'record'} on:click={() => (captureMode = 'record')}>Record 5s</button>
		</div>

		{#if captureMode === 'upload'}
			<label class="dropzone">
				<span>Audio file (max 5s)</span>
				<input type="file" accept="audio/*" on:change={onUpload} />
			</label>
		{:else}
			<div class="record-panel">
				<button class="record" on:click={isRecording ? stopRecording : startRecording}>
					{isRecording ? `Stop (${recordingCountdown}s)` : 'Start 5s recording'}
				</button>
				<span>Use your microphone to capture a short source sound.</span>
			</div>
		{/if}

		{#if fileName}<p class="meta">Source: {fileName} · {duration.toFixed(2)}s</p>{/if}
		{#if infoMessage}<p class="info">{infoMessage}</p>{/if}
		{#if errorMessage}<p class="error">{errorMessage}</p>{/if}
	</section>

	<section class="analysis">
		{#if monoData}
			<div class="controls">
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
						max="2"
						step="0.01"
						bind:value={pitchMultiplier}
						on:input={applySynthesis}
					/>
				</label>
				<label>
					Blend mode
					<select bind:value={blendMode} on:change={(e) => applyBlendMode((e.currentTarget as HTMLSelectElement).value as BlendMode)}>
						<option value="random-lfo">All random LFOs</option>
						<option value="low-high">Fade low → high</option>
						<option value="high-low">Fade high → low</option>
						<option value="middle-out">Fade middle → out</option>
					</select>
				</label>
				<button on:click={playSynthesis}>Play resynthesized slice</button>
			</div>

			<div class="grid">
				{#each buckets as bucket (bucket.index)}
					<article class="wave-card">
						<header>
							<strong>{(bucket.frequency * pitchMultiplier).toFixed(1)} Hz</strong>
							<span>A {(bucket.baseAmplitude * (gainOverrides[bucket.index] ?? 1)).toFixed(2)}</span>
						</header>
						<svg viewBox="0 0 190 88" role="img" aria-label={`Sine wave at ${(bucket.frequency * pitchMultiplier).toFixed(1)} hertz`}>
							<polyline
								fill="none"
								stroke="#f5f5f5"
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
			</div>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: 'Times New Roman', Times, serif;
		background: #000;
		color: #f3f4f6;
	}

	.synth-page {
		position: relative;
		min-height: 100vh;
		padding: 1.5rem;
		overflow: hidden;
		background: #000;
	}

	.bg-grid {
		position: absolute;
		inset: 0;
		display: grid;
		gap: 0.35rem;
		opacity: 0.9;
		pointer-events: none;
		z-index: 0;
	}

	.bg-cell {
		display: grid;
		place-items: center;
	}

	.bg-cell svg {
		width: 100%;
		height: 100%;
	}

	.hero-card,
	.analysis {
		position: relative;
		z-index: 2;
		max-width: 1220px;
		margin: 0 auto;
	}

	.hero-card {
		background: rgba(10, 10, 10, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 1rem;
		padding: 1.25rem;
		backdrop-filter: blur(4px);
	}

	h1 {
		margin: 0;
		font-size: clamp(2.4rem, 5vw, 4.3rem);
		letter-spacing: 0.02em;
	}

	.mode-toggle {
		display: inline-flex;
		gap: 0.35rem;
		padding: 0.2rem;
		margin-top: 0.8rem;
		border: 1px solid rgba(255, 255, 255, 0.24);
		border-radius: 999px;
	}

	.mode-toggle button,
	.record,
	.analysis button,
	select,
	.dropzone {
		font-family: inherit;
	}

	.mode-toggle button {
		background: transparent;
		color: #d1d5db;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 999px;
	}

	.mode-toggle button.active {
		background: #f3f4f6;
		color: #111827;
	}

	.dropzone {
		display: grid;
		gap: 0.6rem;
		margin-top: 0.9rem;
		padding: 1rem;
		border: 1px dashed rgba(255, 255, 255, 0.33);
		border-radius: 0.8rem;
		background: rgba(255, 255, 255, 0.05);
	}

	.dropzone input {
		color: #e5e7eb;
	}

	.record-panel {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.9rem;
		padding: 1rem;
		border-radius: 0.8rem;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.05);
	}

	.record,
	.analysis button {
		border: 1px solid rgba(255, 255, 255, 0.4);
		background: #101010;
		color: #f9fafb;
		padding: 0.55rem 0.9rem;
		border-radius: 0.5rem;
	}

	.meta,
	.info,
	.error {
		margin: 0.65rem 0 0;
	}

	.error {
		color: #fca5a5;
	}

	.info {
		color: #93c5fd;
	}

	.analysis {
		margin-top: 1rem;
		padding: 0;
		max-height: 0;
		overflow: hidden;
		opacity: 0;
		transition: max-height 450ms ease, opacity 450ms ease, padding 450ms ease, background 450ms ease;
	}

	.focused .analysis {
		max-height: 300vh;
		opacity: 1;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.9);
		border-radius: 1rem;
	}

	.controls {
		display: grid;
		gap: 0.75rem;
	}

	label {
		display: grid;
		gap: 0.4rem;
	}

	select {
		background: #0f0f0f;
		color: #e5e7eb;
		border: 1px solid rgba(255, 255, 255, 0.28);
		border-radius: 0.4rem;
		padding: 0.42rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.7rem;
		margin-top: 1rem;
	}

	.wave-card {
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.6rem;
		padding: 0.45rem;
		background: rgba(255, 255, 255, 0.03);
		display: grid;
		gap: 0.45rem;
	}

	.wave-card header {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}

	.wave-card svg {
		width: 100%;
		background: #030303;
		border-radius: 0.35rem;
	}

	@media (max-width: 980px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	@media (max-width: 680px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
