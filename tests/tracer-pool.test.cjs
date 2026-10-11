const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');

test('Tracer follows the barrel, clips to cover, and stays hidden behind a protruding barrel',async()=>{
  const {TracerPool}=await import('../src/engine/tracer-pool.js');
  const scene=new THREE.Scene(),wall=new THREE.Mesh(new THREE.BoxGeometry(10,10,.5),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  wall.position.z=-4;wall.updateMatrixWorld(true);
  const pool=new TracerPool(scene,()=>wall,2),body=new THREE.Vector3(),muzzle=new THREE.Vector3(.3,-.2,-1),end=new THREE.Vector3(0,0,-10);
  pool.trigger(body,end,0xffd490,()=>muzzle);pool.update();
  let trail=pool.visibleWeaponTrails[0];assert.ok(trail);assert.ok(Math.abs(trail[0]-.3)<1e-6);assert.equal(trail[5],-3.75);
  muzzle.x=.7;pool.update();trail=pool.visibleWeaponTrails[0];assert.ok(Math.abs(trail[0]-.7)<1e-6);
  muzzle.set(0,0,-5);pool.update();assert.equal(pool.visibleWeaponTrails.length,0);
  pool.dispose();wall.geometry.dispose();wall.material.dispose();
});

test('Physics catch-up never repeats tracer rays and repeated shots reuse fixed resources',async()=>{
  const {TracerPool}=await import('../src/engine/tracer-pool.js');
  const scene=new THREE.Scene(),cover=new THREE.Object3D();let rays=0;cover.raycast=()=>{rays++;};
  const pool=new TracerPool(scene,()=>cover,4),geometry=pool.slots.map(slot=>slot.line.geometry),materials=pool.slots.map(slot=>slot.line.material);
  const from=new THREE.Vector3(),end=new THREE.Vector3(0,0,-10),muzzle=new THREE.Vector3(.3,0,-1);
  pool.trigger(from,end,0xffffff,()=>muzzle);
  for(let i=0;i<6;i++)pool.tick(1/120);
  assert.equal(rays,0);pool.update();assert.equal(rays,2);
  pool.tick(.1);pool.update();assert.equal(rays,2);assert.equal(pool.visibleWeaponTrails.length,0);
  for(let i=0;i<1000;i++)pool.trigger(from,end,0xffffff,()=>muzzle);
  assert.equal(scene.children.length,4);assert.deepEqual(pool.slots.map(slot=>slot.line.geometry),geometry);assert.deepEqual(pool.slots.map(slot=>slot.line.material),materials);
  pool.reset();pool.update();assert.equal(pool.visibleWeaponTrails.length,0);
  pool.dispose();assert.equal(scene.children.length,0);
});
