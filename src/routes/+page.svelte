<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	type Blob = {
		x: number;
		y: number;
		vx: number;
		vy: number;
		size: number;
		alpha: number;
	};

	const blobCount = 18;
	let blobs = $state<Blob[]>([]);
	let viewport = { w: 1, h: 1 };
	let mouse = { x: -1000, y: -1000 };

	onMount(() => {
		viewport = { w: window.innerWidth, h: window.innerHeight };
		blobs = Array.from({ length: blobCount }, () => ({
			x: Math.random() * viewport.w,
			y: Math.random() * viewport.h,
			vx: (Math.random() - 0.5) * 0.6,
			vy: (Math.random() - 0.5) * 0.6,
			size: 90 + Math.random() * 180,
			alpha: 0.08 + Math.random() * 0.16
		}));

		const updateViewport = () => {
			viewport = { w: window.innerWidth, h: window.innerHeight };
		};

		const onMove = (event: PointerEvent) => {
			mouse = { x: event.clientX, y: event.clientY };
		};

		const onLeave = () => {
			mouse = { x: -1000, y: -1000 };
		};

		window.addEventListener('resize', updateViewport);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerleave', onLeave);

		let raf = 0;
		const tick = () => {
			blobs = blobs.map((blob) => {
				const dx = mouse.x - blob.x;
				const dy = mouse.y - blob.y;
				const dist = Math.hypot(dx, dy);
				const attractionRadius = 170;

				let ax = 0;
				let ay = 0;
				if (dist < attractionRadius) {
					const strength = (1 - dist / attractionRadius) * 0.12;
					ax = (dx / (dist || 1)) * strength;
					ay = (dy / (dist || 1)) * strength;
				}

				const vx = (blob.vx + ax) * 0.985;
				const vy = (blob.vy + ay) * 0.985;
				let x = blob.x + vx;
				let y = blob.y + vy;

				if (x < -blob.size) x = viewport.w + blob.size;
				if (x > viewport.w + blob.size) x = -blob.size;
				if (y < -blob.size) y = viewport.h + blob.size;
				if (y > viewport.h + blob.size) y = -blob.size;

				return { ...blob, x, y, vx, vy };
			});
			raf = requestAnimationFrame(tick);
		};

		raf = requestAnimationFrame(tick);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener('resize', updateViewport);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerleave', onLeave);
		};
	});
</script>

<main class="landing">
	{#each blobs as blob, index (index)}
		<div
			class="blob"
			style={`width:${blob.size}px;height:${blob.size}px;transform:translate(${blob.x - blob.size / 2}px,${blob.y - blob.size / 2}px);opacity:${blob.alpha};`}
		></div>
	{/each}
	<h1>Hello!</h1>
	<nav>
		<a href={resolve("/simulation")}>Open simulation</a>
		<a href={resolve("/synth")}>Open synth</a>
	</nav>
</main>

<style>
	.landing {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #fff;
	}

	.blob {
		position: absolute;
		border-radius: 9999px;
		background: #6b7280;
		filter: blur(2px);
		will-change: transform;
	}

	h1 {
		position: fixed;
		top: 2.5rem;
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		font-family: 'Times New Roman', Times, serif;
		font-size: clamp(3rem, 8vw, 5.5rem);
		line-height: 1;
		color: #0f172a;
		z-index: 2;
		pointer-events: none;
	}

	nav {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		gap: 1rem;
		z-index: 3;
	}

	a {
		padding: 0.6rem 1rem;
		border-radius: 999px;
		border: 1px solid #111827;
		color: #111827;
		text-decoration: none;
		background: rgba(255, 255, 255, 0.85);
		font-size: 0.95rem;
		font-weight: 600;
	}
</style>
