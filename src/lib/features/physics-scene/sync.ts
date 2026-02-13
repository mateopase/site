import type { SpherePair } from './types';

export const syncSphereTransforms = (pairs: SpherePair[]) => {
	for (const pair of pairs) {
		pair.mesh.position.set(pair.body.position.x, pair.body.position.y, pair.body.position.z);
		pair.mesh.quaternion.set(
			pair.body.quaternion.x,
			pair.body.quaternion.y,
			pair.body.quaternion.z,
			pair.body.quaternion.w
		);
	}
};
