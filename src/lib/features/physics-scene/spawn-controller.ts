import * as THREE from 'three';

export interface SpawnController {
	getSpawnPoint: (event: PointerEvent) => THREE.Vector3 | null;
}

export const createSpawnController = (
	container: HTMLDivElement,
	camera: THREE.PerspectiveCamera,
	spawnPlaneY: number
): SpawnController => {
	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();
	const spawnPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -spawnPlaneY);
	const hitPoint = new THREE.Vector3();

	const getSpawnPoint = (event: PointerEvent): THREE.Vector3 | null => {
		const rect = container.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return null;
		}

		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
		raycaster.setFromCamera(pointer, camera);

		if (!raycaster.ray.intersectPlane(spawnPlane, hitPoint)) {
			return null;
		}

		return hitPoint.clone();
	};

	return { getSpawnPoint };
};
