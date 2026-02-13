import type * as CANNON from 'cannon-es';
import type * as THREE from 'three';

export type Vec3Tuple = readonly [number, number, number];

export interface SceneConfig {
	backgroundColor: number;
	camera: {
		fov: number;
		near: number;
		far: number;
		position: Vec3Tuple;
		lookAt: Vec3Tuple;
	};
	cube: {
		color: number;
		roughness: number;
		position: Vec3Tuple;
		rotationSpeed: number;
	};
	floor: {
		size: number;
		y: number;
		color: number;
		roughness: number;
	};
	lights: {
		directionalIntensity: number;
		directionalPosition: Vec3Tuple;
		ambientIntensity: number;
		shadowMapSize: number;
		shadowBounds: number;
		shadowNear: number;
		shadowFar: number;
	};
}

export interface PhysicsConfig {
	gravity: Vec3Tuple;
	friction: number;
	restitution: number;
	sphereRadius: number;
	sphereMass: number;
	spawnHeight: number;
	linearDamping: number;
	angularDamping: number;
	fixedTimeStep: number;
	maxSubSteps: number;
}

export interface LimitsConfig {
	maxSpheres: number;
}

export interface SimulationConfig {
	scene: SceneConfig;
	physics: PhysicsConfig;
	limits: LimitsConfig;
}

export interface SpherePair {
	mesh: THREE.Mesh;
	body: CANNON.Body;
}
