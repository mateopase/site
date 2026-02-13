import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { createSpawnController } from './spawn-controller';
import { syncSphereTransforms } from './sync';
import { createPhysicsWorld } from './world';
import { createSceneRenderer } from './renderer';
import type { SimulationConfig, SpherePair } from './types';

export interface SimulationHandle {
	destroy: () => void;
}

export const startSimulation = (
	container: HTMLDivElement,
	config: SimulationConfig
): SimulationHandle => {
	const sceneRenderer = createSceneRenderer(container, config.scene);
	const physics = createPhysicsWorld(config.physics, config.scene.floor.y);
	const spawnController = createSpawnController(
		container,
		sceneRenderer.camera,
		config.scene.floor.y + config.physics.sphereRadius
	);

	const spawned: SpherePair[] = [];
	const sphereGeometry = new THREE.SphereGeometry(config.physics.sphereRadius, 18, 18);
	const sphereMaterial = new THREE.MeshStandardMaterial({
		color: 0xf97316,
		roughness: 0.45,
		metalness: 0.05
	});

	const removeOldestSphere = () => {
		const oldest = spawned.shift();
		if (!oldest) {
			return;
		}
		physics.removeBody(oldest.body);
		sceneRenderer.scene.remove(oldest.mesh);
	};

	const spawnSphere = (point: THREE.Vector3) => {
		if (spawned.length >= config.limits.maxSpheres) {
			removeOldestSphere();
		}

		const mesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		sceneRenderer.scene.add(mesh);

		const body = new CANNON.Body({
			mass: config.physics.sphereMass,
			shape: new CANNON.Sphere(config.physics.sphereRadius),
			position: new CANNON.Vec3(point.x, config.physics.spawnHeight, point.z),
			material: physics.sphereMaterial
		});
		body.linearDamping = config.physics.linearDamping;
		body.angularDamping = config.physics.angularDamping;
		physics.addBody(body);

		spawned.push({ mesh, body });
	};

	const onPointerDown = (event: PointerEvent) => {
		const point = spawnController.getSpawnPoint(event);
		if (!point) {
			return;
		}
		spawnSphere(point);
	};

	const onResize = () => {
		sceneRenderer.resize();
	};

	sceneRenderer.resize();
	window.addEventListener('resize', onResize);
	container.addEventListener('pointerdown', onPointerDown);

	const clock = new THREE.Clock();
	let frameId = 0;
	let destroyed = false;

	const animate = () => {
		if (destroyed) {
			return;
		}

		const delta = clock.getDelta();
		physics.step(delta);

		sceneRenderer.cube.rotation.x += config.scene.cube.rotationSpeed;
		sceneRenderer.cube.rotation.y += config.scene.cube.rotationSpeed;

		syncSphereTransforms(spawned);
		sceneRenderer.renderer.render(sceneRenderer.scene, sceneRenderer.camera);
		frameId = requestAnimationFrame(animate);
	};

	frameId = requestAnimationFrame(animate);

	const destroy = () => {
		if (destroyed) {
			return;
		}
		destroyed = true;
		cancelAnimationFrame(frameId);

		window.removeEventListener('resize', onResize);
		container.removeEventListener('pointerdown', onPointerDown);

		for (const pair of spawned) {
			physics.removeBody(pair.body);
			sceneRenderer.scene.remove(pair.mesh);
		}
		spawned.length = 0;

		sphereGeometry.dispose();
		sphereMaterial.dispose();
		physics.dispose();
		sceneRenderer.dispose();
	};

	return { destroy };
};
