const test = require('node:test');
const assert = require('node:assert/strict');

async function modules() {
  const THREE = await import('three');
  const {installStaticCoverRaycast} = await import('../src/engine/static-cover-raycast.js');
  return {THREE, installStaticCoverRaycast};
}

function nativeHits(THREE, root, ray) {
  const guards = root.children.map(group => [group, group.raycast]);
  for (const [group] of guards) group.raycast = THREE.Group.prototype.raycast;
  try { return ray.intersectObject(root, true); }
  finally { for (const [group, raycast] of guards) group.raycast = raycast; }
}

function sameHits(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((hit, index) => {
    assert.equal(hit.object, expected[index].object);
    assert.ok(Math.abs(hit.distance - expected[index].distance) < 1e-8);
    assert.ok(hit.point.distanceTo(expected[index].point) < 1e-8);
  });
}

test('Static cover bounds preserve exact hits with gaps, transforms and finite rays', async () => {
  const {THREE, installStaticCoverRaycast} = await modules();
  const root = new THREE.Group(), group = new THREE.Group();
  root.position.set(12, 3, -8); root.rotation.y = .37; root.scale.set(1.3, .8, 1.1);
  group.position.set(1, .2, 0); root.add(group);
  const geometry = new THREE.BoxGeometry(2, .3, .15);
  const material = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(geometry, material);
    plank.position.y = .24 + i * .4; group.add(plank);
  }
  installStaticCoverRaycast(group);
  try {
    for (const x of [-2, 0, 1]) for (const y of [.24, .44, 1.04, 3]) {
      const origin = group.localToWorld(new THREE.Vector3(x, y, -2));
      const direction = group.localToWorld(new THREE.Vector3(x, y, 2)).sub(origin).normalize();
      for (const far of [.1, 2.2, 10]) {
        const ray = new THREE.Raycaster(origin, direction, 0, far);
        sameHits(ray.intersectObject(root, true), nativeHits(THREE, root, ray));
      }
    }
    // A ray beginning inside the cached bounds must not reject a nearby face
    // just because the box's exit lies beyond ray.far.
    const origin = group.localToWorld(new THREE.Vector3(0, 1.04, 0));
    const direction = group.localToWorld(new THREE.Vector3(0, 1.04, 1)).sub(origin).normalize();
    const inside = new THREE.Raycaster(origin, direction, 0, .1);
    assert.ok(inside.intersectObject(root, true).length);
    sameHits(inside.intersectObject(root, true), nativeHits(THREE, root, inside));
  } finally { geometry.dispose(); material.dispose(); }
});

test('Off-ray wall and rack groups skip child raycasts without changing closest cover', async () => {
  const {THREE, installStaticCoverRaycast} = await modules();
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(2, .3, .15);
  const material = new THREE.MeshBasicMaterial();
  let calls = 0;
  for (let z = 1; z <= 8; z++) for (let x = -10; x <= 10; x++) {
    const group = new THREE.Group(); group.position.set(x * 3, 0, z * 4); root.add(group);
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(geometry, material); plank.position.y = .24 + i * .4;
      plank.raycast = function (...args) { calls++; return THREE.Mesh.prototype.raycast.apply(this, args); };
      group.add(plank);
    }
    installStaticCoverRaycast(group);
  }
  try {
    const ray = new THREE.Raycaster(new THREE.Vector3(.3, 1.04, 0), new THREE.Vector3(0, 0, 1), 0, 12);
    calls = 0; const expected = nativeHits(THREE, root, ray), nativeCalls = calls;
    // Shooting does not need to traverse transforms again after setup.
    for (const group of root.children) group.updateWorldMatrix = () => { throw new Error('Unexpected per-shot transform update'); };
    calls = 0; const actual = ray.intersectObject(root, true), guardedCalls = calls;
    sameHits(actual, expected); assert.ok(actual.length > 0);
    assert.ok(guardedCalls <= nativeCalls / 10, `${guardedCalls} child tests versus ${nativeCalls} native`);
    calls = 0; ray.far = 1;
    assert.equal(ray.intersectObject(root, true).length, 0); assert.equal(calls, 0);
  } finally { geometry.dispose(); material.dispose(); }
});

async function fortificationFixture(gunFactory = null) {
  const {THREE} = await modules();
  const {SurvivalWorld} = await import('../src/survival-world.js');
  const nodes = [], grid = new Map();
  for (let z = -7; z <= 7; z++) for (let x = -7; x <= 7; x++) {
    const node = {id: nodes.length, x, z, point: new THREE.Vector3(x * 2.5, 2 + x * .04, z * 2.5), edges: []};
    nodes.push(node); grid.set(`${x},${z}`, node);
  }
  for (const node of nodes) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const other = grid.get(`${node.x + dx},${node.z + dz}`); if (other) node.edges.push(other.id);
  }
  const spawn = new THREE.Vector3(0, 2, 0);
  const nav = {nodes, reachable: nodes, cell: 2.5, nearest(p) { return nodes.reduce((a, b) => a.point.distanceToSquared(p) < b.point.distanceToSquared(p) ? a : b); }};
  const gunModels = gunFactory ? gunFactory(THREE) : [];
  const env = new SurvivalWorld({scene: new THREE.Scene(), nav, spawn, gunModels, zoneSteps: [3, 6, 9], perkDefinitions: []});
  return {THREE, env};
}

test('Survival shot cover updates only repaired windows and preserves opened zones and concealed spawns', async () => {
  const {THREE, env} = await fortificationFixture();
  try {
    assert.ok(env.windows.length > 1); assert.equal(env.gates.length, 2);
    const window = env.windows[0], origin = window.inside.clone(), target = window.approachPath.at(-1).clone();
    origin.y = target.y = window.mesh.position.y + 1.04;
    const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target));
    const verify = () => sameHits(ray.intersectObject(env.shotCollider, true), nativeHits(THREE, env.shotCollider, ray));
    assert.ok(ray.intersectObject(window.mesh, true).length); verify();
    const unrelated = env.windows[1].mesh, update = unrelated.updateWorldMatrix;
    let unrelatedUpdates = 0;
    unrelated.updateWorldMatrix = function (...args) { unrelatedUpdates++; return update.apply(this, args); };
    env.setBoards(window, 0); assert.equal(ray.intersectObject(window.mesh, true).length, 0); verify();
    env.setBoards(window, 3); assert.ok(ray.intersectObject(window.mesh, true).length); verify();
    env.setBoards(window, 6); verify(); assert.equal(unrelatedUpdates, 0);
    env.setBoards(window, 0);
    const concealed = window.spawnPoint.clone(); origin.y = concealed.y = window.mesh.position.y + 1.6;
    ray.set(origin, concealed.clone().sub(origin).normalize()); ray.far = origin.distanceTo(concealed);
    assert.ok(ray.intersectObject(window.mesh, true).length, 'Back wall still conceals the undead spawn'); verify();
    const gate = env.gates.find(g => g.level === 1);
    // The paired crates deliberately have a 3 cm center seam. Keep exact rays
    // through it clear; use the crate body to test closed/open cover below.
    const seamOrigin = gate.mesh.localToWorld(new THREE.Vector3(0, 1.4, 1.25));
    const seamTarget = gate.mesh.localToWorld(new THREE.Vector3(0, 1.4, -1.25));
    ray.set(seamOrigin, seamTarget.clone().sub(seamOrigin).normalize()); ray.far = seamOrigin.distanceTo(seamTarget);
    assert.equal(ray.intersectObject(env.shotCollider, true).length, 0); verify();
    const gateOrigin = gate.mesh.localToWorld(new THREE.Vector3(.35, 1.4, 1.25));
    const gateTarget = gate.mesh.localToWorld(new THREE.Vector3(.35, 1.4, -1.25));
    ray.set(gateOrigin, gateTarget.clone().sub(gateOrigin).normalize()); ray.far = gateOrigin.distanceTo(gateTarget);
    assert.ok(ray.intersectObject(env.shotCollider, true).length); verify();
    assert.equal(env.openZone(1), true); assert.equal(gate.mesh.parent, null);
    assert.equal(ray.intersectObject(env.shotCollider, true).length, 0); verify();
    assert.equal(unrelatedUpdates, 0);
  } finally { env.dispose(); }
});

test('Attached skinned rack cover bounds match render transforms immediately after construction', async () => {
  let source, geometry, material;
  const {THREE, env} = await fortificationFixture(T => {
    geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([-.3, -.3, 0, .3, -.3, 0, 0, .3, 0], 3));
    geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    geometry.setIndex([0, 1, 2]);
    material = new T.MeshBasicMaterial({side: T.DoubleSide});
    source = new T.Group(); source.position.set(-4, 2, 3); source.rotation.y = .4;
    const mesh = new T.SkinnedMesh(geometry, material), bone = new T.Bone();
    source.add(mesh); mesh.add(bone); source.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([bone])); bone.position.x = .2; source.updateMatrixWorld(true);
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    return [null, source, source, source];
  });
  try {
    for (const rack of env.weaponBuys) {
      let gun; rack.mesh.traverse(object => { if (object.isSkinnedMesh) gun = object; });
      assert.ok(gun);
      const vertices = [0, 1, 2].map(i => gun.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(gun.matrixWorld));
      const center = vertices.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
      const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize();
      const ray = new THREE.Raycaster(center.clone().addScaledVector(normal, 2), normal.clone().negate(), 0, 4);
      const before = ray.intersectObject(rack.mesh, true);
      assert.ok(before.some(hit => hit.object === gun), 'Cached cover includes the displayed gun immediately');
      env.scene.updateMatrixWorld(true);
      const after = ray.intersectObject(rack.mesh, true); sameHits(before, after);
      const guard = rack.mesh.raycast; rack.mesh.raycast = THREE.Group.prototype.raycast;
      try {
        gun.boundingBox = null; gun.boundingSphere = null;
        const optimized = gun.raycast; gun.raycast = THREE.SkinnedMesh.prototype.raycast;
        try { sameHits(after, ray.intersectObject(rack.mesh, true)); }
        finally { gun.raycast = optimized; }
      } finally { rack.mesh.raycast = guard; }
    }
  } finally {
    env.dispose(); source.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose(); });
    geometry.dispose(); material.dispose();
  }
});
