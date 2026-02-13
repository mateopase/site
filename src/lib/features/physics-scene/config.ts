import type { SimulationConfig } from './types';

export const SIM_CONFIG: SimulationConfig = {
	scene: {
		backgroundColor: 0xf3f4f6,
		camera: {
			fov: 55,
			near: 0.1,
			far: 1000,
			position: [0, 1.8, 5.5],
			lookAt: [0, 0.2, 0]
		},
		cube: {
			color: 0x3b82f6,
			roughness: 0.4,
			position: [0, 0.8, 0],
			rotationSpeed: 0.01
		},
		floor: {
			size: 14,
			y: -1.5,
			color: 0xe5e7eb,
			roughness: 0.95
		},
		lights: {
			directionalIntensity: 1.2,
			directionalPosition: [4, 8, 4],
			ambientIntensity: 0.35,
			shadowMapSize: 2048,
			shadowBounds: 8,
			shadowNear: 1,
			shadowFar: 24
		}
	},
	physics: {
		gravity: [0, -9.82, 0],
		friction: 0.2,
		restitution: 0.82,
		sphereRadius: 0.16,
		sphereMass: 0.25,
		spawnHeight: 3.2,
		linearDamping: 0.08,
		angularDamping: 0.1,
		fixedTimeStep: 1 / 60,
		maxSubSteps: 4
	},
	limits: {
		maxSpheres: 200
	}
};
