const test=require('node:test'),assert=require('node:assert/strict');
const THREE=require('three');
function box(x,y,z,w=2,h=3,d=.5){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.position.set(x,y,z);mesh.updateMatrixWorld(true);return mesh;}
test('Nearest solid cover blocks bullets, but cover behind the target does not',async()=>{
  const {traceShot}=await import('../src/ballistics.js');
  const origin=new THREE.Vector3(0,1,0),target=new THREE.Vector3(0,1,-10),actor=box(0,1,-8);
  const wall=box(0,1,-4);let shot=traceShot(origin,target,wall,[actor]);assert.ok(shot.blocked);assert.equal(shot.hit,null);assert.ok(shot.point.z>-4);
  wall.position.z=-12;wall.updateMatrixWorld(true);shot=traceShot(origin,target,wall,[actor]);assert.equal(shot.blocked,false);assert.equal(shot.hit.object,actor);
  wall.position.z=-4;wall.position.x=5;wall.updateMatrixWorld(true);assert.equal(traceShot(origin,target,wall,[actor]).hit.object,actor);
});
test('Third-person camera visibility cannot bypass cover in front of the body',async()=>{
  const {traceShot}=await import('../src/ballistics.js');const wall=box(0,.5,-2,2,2,.5),target=box(0,1,-8);
  const aim=traceShot(new THREE.Vector3(3,3,1),new THREE.Vector3(0,1,-8),wall,[target]);assert.equal(aim.hit.object,target);
  const shot=traceShot(new THREE.Vector3(0,1,0),aim.point,wall,[target]);assert.ok(shot.blocked);assert.equal(shot.hit,null);
});
test('Bot fire causes no damage or tracer through cover and resumes with clear LOS',async()=>{
  const {Combat}=await import('../src/combat.js'),{shotBlocked}=await import('../src/ballistics.js');
  const wall=box(0,1,-4);let damage=0,tracers=0;
  const c=new Combat({shotBlocked:(a,b)=>shotBlocked(a,b,wall),getPlayer:()=>new THREE.Vector3(0,2.45,-8),damagePlayer:()=>damage++,tracer:()=>tracers++});
  c.mode='factions';c.faction='alliance';c.nav={step:()=>false};c.equip=()=>{};
  const bot={id:0,alive:true,hp:100,faction:'horde',mesh:new THREE.Group(),actor:{height:2,update(){},animate(){}},cooldown:0,attackTime:0,navTimer:0};c.units=[bot];
  const random=Math.random;Math.random=()=>0;try{c.tick(.016);assert.equal(damage,0);assert.equal(tracers,0);wall.position.x=10;wall.updateMatrixWorld(true);c.tick(.016);assert.equal(damage,1);assert.equal(tracers,1);}finally{Math.random=random;}
});
test('Fountain streams animate while retaining their original prop transform',async()=>{
  const {createFountain}=await import('../src/fountains.js');const f=createFountain('stormwindfountain01.m2');f.group.position.set(10,2,3);
  const spray=f.group.children.find(o=>o.isPoints),before=Array.from(spray.geometry.attributes.position.array);f.update(.4);assert.notDeepEqual(Array.from(spray.geometry.attributes.position.array),before);assert.deepEqual(f.group.position.toArray(),[10,2,3]);
  f.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});
