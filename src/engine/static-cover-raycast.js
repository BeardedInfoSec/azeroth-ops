import {Box3, Vector3} from 'three';

// Cover never moves after construction. Its original bounds include every
// repairable plank, so removing/re-adding those planks cannot invalidate them.
// This is only a rejection test: rays inside the box still hit exact geometry,
// preserving board gaps, open rack frames and the nearest real obstruction.
export function installStaticCoverRaycast(group) {
  group.updateWorldMatrix(true, false);
  // SkinnedMesh updates its attached bind inverse in updateMatrixWorld (not
  // updateWorldMatrix). Rack guns were just reparented/scaled, so use the same
  // transform path as rendering before freezing their enclosing world bounds.
  group.updateMatrixWorld(true);
  group.traverse(object => {
    if (object.isSkinnedMesh) { object.boundingBox = null; object.boundingSphere = null; }
  });
  const bounds = new Box3().setFromObject(group).expandByScalar(1e-4);
  const entry = new Vector3();
  group.raycast = function (raycaster) {
    const ray = raycaster.ray;
    if (bounds.containsPoint(ray.origin)) return;
    if (!ray.intersectBox(bounds, entry)) return false;
    if (entry.distanceToSquared(ray.origin) > raycaster.far * raycaster.far) return false;
    // Three r180 stops recursion only on false, otherwise visits child meshes.
  };
  return group;
}
