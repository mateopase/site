<script lang="ts">
	import PhysicsScene from '$lib/components/scene/PhysicsScene.svelte';
</script>

<main class="hero">
	<PhysicsScene />
	<h1>Hello</h1>
</main>

<style>
	.hero {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
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

</style>
