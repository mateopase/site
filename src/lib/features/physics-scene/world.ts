import * as CANNON from 'cannon-es';
import type { PhysicsConfig } from './types';

export interface PhysicsWorld {
	world: CANNON.World;
	sphereMaterial: CANNON.Material;
	addBody: (body: CANNON.Body) => void;
	removeBody: (body: CANNON.Body) => void;
	step: (deltaSeconds: number) => void;
	dispose: () => void;
}

export const createPhysicsWorld = (config: PhysicsConfig, floorY: number): PhysicsWorld => {
	const world = new CANNON.World({ gravity: new CANNON.Vec3(...config.gravity) });
	world.broadphase = new CANNON.SAPBroadphase(world);
	world.allowSleep = true;

	const groundMaterial = new CANNON.Material('ground');
	const sphereMaterial = new CANNON.Material('sphere');
	world.addContactMaterial(
		new CANNON.ContactMaterial(groundMaterial, sphereMaterial, {
			friction: config.friction,
			restitution: config.restitution
		})
	);

	const groundBody = new CANNON.Body({
		mass: 0,
		shape: new CANNON.Plane(),
		material: groundMaterial
	});
	groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
	groundBody.position.set(0, floorY, 0);
	world.addBody(groundBody);

	let accumulator = 0;
	const maxDelta = 0.1;

	const step = (deltaSeconds: number) => {
		accumulator += Math.min(deltaSeconds, maxDelta);
		let subSteps = 0;
		while (accumulator >= config.fixedTimeStep && subSteps < config.maxSubSteps) {
			world.step(config.fixedTimeStep);
			accumulator -= config.fixedTimeStep;
			subSteps += 1;
		}

		if (subSteps === config.maxSubSteps) {
			accumulator = 0;
		}
	};

	const dispose = () => {
		world.removeBody(groundBody);
	};

	return {
		world,
		sphereMaterial,
		addBody: (body) => world.addBody(body),
		removeBody: (body) => world.removeBody(body),
		step,
		dispose
	};
};
