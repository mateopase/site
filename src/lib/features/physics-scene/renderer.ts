import * as THREE from 'three';
import type { SceneConfig } from './types';

export interface SceneRenderer {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	renderer: THREE.WebGLRenderer;
	cube: THREE.Mesh;
	floor: THREE.Mesh;
	resize: () => void;
	dispose: () => void;
}

export const createSceneRenderer = (
	container: HTMLDivElement,
	config: SceneConfig
): SceneRenderer => {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(config.backgroundColor);

	const camera = new THREE.PerspectiveCamera(config.camera.fov, 1, config.camera.near, config.camera.far);
	camera.position.set(...config.camera.position);
	camera.lookAt(...config.camera.lookAt);

	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	container.appendChild(renderer.domElement);

	const cubeGeometry = new THREE.BoxGeometry();
	const cubeMaterial = new THREE.MeshStandardMaterial({
		color: config.cube.color,
		roughness: config.cube.roughness
	});
	const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
	cube.position.set(...config.cube.position);
	cube.castShadow = true;
	cube.receiveShadow = true;
	scene.add(cube);

	const floorGeometry = new THREE.PlaneGeometry(config.floor.size, config.floor.size);
	const floorMaterial = new THREE.MeshStandardMaterial({
		color: config.floor.color,
		roughness: config.floor.roughness
	});
	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = config.floor.y;
	floor.receiveShadow = true;
	scene.add(floor);

	const light = config.lights;
	const directionalLight = new THREE.DirectionalLight(0xffffff, light.directionalIntensity);
	directionalLight.position.set(...light.directionalPosition);
	directionalLight.castShadow = true;
	directionalLight.shadow.mapSize.set(light.shadowMapSize, light.shadowMapSize);
	directionalLight.shadow.camera.left = -light.shadowBounds;
	directionalLight.shadow.camera.right = light.shadowBounds;
	directionalLight.shadow.camera.top = light.shadowBounds;
	directionalLight.shadow.camera.bottom = -light.shadowBounds;
	directionalLight.shadow.camera.near = light.shadowNear;
	directionalLight.shadow.camera.far = light.shadowFar;
	scene.add(directionalLight);

	const ambientLight = new THREE.AmbientLight(0xffffff, light.ambientIntensity);
	scene.add(ambientLight);

	const resize = () => {
		const { clientWidth, clientHeight } = container;
		renderer.setSize(clientWidth, clientHeight);
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
	};

	const dispose = () => {
		cubeGeometry.dispose();
		cubeMaterial.dispose();
		floorGeometry.dispose();
		floorMaterial.dispose();
		renderer.dispose();
		renderer.domElement.remove();
	};

	return { scene, camera, renderer, cube, floor, resize, dispose };
};
