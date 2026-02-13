<script lang="ts">
	import { onMount } from 'svelte';
	import { SIM_CONFIG } from '$lib/features/physics-scene/config';
	import { startSimulation } from '$lib/features/physics-scene/runtime';

	let sceneContainer: HTMLDivElement;

	onMount(() => {
		const sim = startSimulation(sceneContainer, SIM_CONFIG);
		return () => sim.destroy();
	});
</script>

<div class="scene" bind:this={sceneContainer} aria-label="Physics scene"></div>

<style>
	.scene {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
	}
</style>
