<script lang="ts">
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

	const fftSize = 4096;

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
		applySynthesis();
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
				sample += bucket.baseAmplitude * gain * modulation * Math.sin(2 * Math.PI * bucket.frequency * t);
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

	const onUpload = async (event: Event) => {
		errorMessage = '';
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		const context = await getAudioContext();
		const bytes = await file.arrayBuffer();
		const decoded = await context.decodeAudioData(bytes.slice(0));

		if (decoded.duration > 5) {
			errorMessage = 'Please upload an audio file that is 5 seconds or shorter.';
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

	const blurWaves = () => {
		lfos = buckets.map(() => ({
			rate: 0.25 + Math.random() * 4,
			depth: 0.15 + Math.random() * 0.7,
			phase: Math.random() * Math.PI * 2
		}));
		applySynthesis();
	};

	const clearBlur = () => {
		lfos = Array.from({ length: 30 }, () => ({ rate: 0, depth: 0, phase: 0 }));
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
	<h1>Synth</h1>
	<p class="sub">Upload up to 5s of audio, slice it, inspect the top 30 FFT frequencies, and resynthesize.</p>

	<div class="controls">
		<input type="file" accept="audio/*" on:change={onUpload} />
		{#if fileName}<span>{fileName} ({duration.toFixed(2)}s)</span>{/if}
		{#if errorMessage}<p class="error">{errorMessage}</p>{/if}
	</div>

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
			<div class="button-row">
				<button on:click={playSynthesis}>Play resynthesized slice</button>
				<button on:click={blurWaves}>Blur amplitudes</button>
				<button on:click={clearBlur}>Clear blur</button>
			</div>
		</section>

		<section class="grid">
			{#each buckets as bucket (bucket.index)}
				<article class="wave-card">
					<header>
						<strong>{bucket.frequency.toFixed(1)} Hz</strong>
						<span>Amp {(bucket.baseAmplitude * (gainOverrides[bucket.index] ?? 1)).toFixed(2)}</span>
					</header>
					<svg viewBox="0 0 170 82" role="img" aria-label={`Sine wave at ${bucket.frequency.toFixed(1)} hertz`}>
						<polyline
							fill="none"
							stroke="#111827"
							stroke-width="2"
							points={wavePath(
								bucket.frequency,
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
</main>

<style>
	.synth-page {
		padding: 1.5rem;
		max-width: 1200px;
		margin: 0 auto;
	}
	.sub { margin-top: 0.4rem; color: #374151; }
	.controls { display: flex; flex-direction: column; gap: 0.45rem; margin: 1rem 0; }
	.error { color: #991b1b; font-weight: 600; }
	.slice-ui { display: grid; gap: 0.8rem; margin: 1rem 0 1.5rem; }
	label { display: grid; gap: 0.4rem; }
	.button-row { display: flex; gap: 0.7rem; flex-wrap: wrap; }
	button {
		padding: 0.5rem 0.8rem;
		border-radius: 0.45rem;
		border: 1px solid #111827;
		background: #fff;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.8rem;
	}
	.wave-card {
		border: 1px solid #d1d5db;
		border-radius: 0.6rem;
		padding: 0.45rem;
		background: #f9fafb;
		display: grid;
		gap: 0.45rem;
	}
	.wave-card header {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
	}
	svg { width: 100%; background: #fff; border-radius: 0.35rem; }
	@media (max-width: 980px) {
		.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	}
	@media (max-width: 680px) {
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
