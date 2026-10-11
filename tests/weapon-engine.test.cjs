const test=require('node:test'),assert=require('node:assert/strict');
async function setup(){return {...await import('../src/engine/weapon-simulation.mjs'),...await import('../src/weapon-data.js')};}
test('Fixed-step engine produces equal simulation time at different render rates',async()=>{
  const {SimulationClock}=await import('../src/engine/clock.mjs');
  for(const rate of [30,60,144]){const clock=new SimulationClock(0);let ticks=0;for(let i=1;i<=rate;i++)ticks+=clock.advance(i*1000/rate).steps.length;assert.equal(ticks,120);}
  assert.equal(new SimulationClock(0).advance(10000).steps.length,12,'A stalled browser cannot cause unbounded catch-up');
});
test('Character capsule resolves floor penetration at the configured eye height',async()=>{
  const T=await import('three'),{MeshBVH}=await import('three-mesh-bvh'),{CharacterCollision}=await import('../src/engine/character-collision.js');
  const geometry=new T.BoxGeometry(20,1,20);geometry.translate(0,-.5,0);geometry.boundsTree=new MeshBVH(geometry);const collider=new T.Mesh(geometry),position=new T.Vector3(0,2.35,0);
  const delta=new CharacterCollision(2.45,.32).resolve(position,collider);assert.ok(Math.abs(delta.y-.1)<.001);assert.ok(Math.abs(delta.x)+Math.abs(delta.z)<.001);geometry.dispose();collider.material.dispose();
});
test('Patched BO2 damage curves and body multipliers drive damage',async()=>{
  const {GUNS,damageAt}=await setup();assert.equal(GUNS[1].capacity,30);
  assert.equal(damageAt(GUNS[0],10),40);assert.equal(damageAt(GUNS[0],40),33);assert.equal(damageAt(GUNS[0],100),24);assert.equal(damageAt(GUNS[0],10,'locHead'),48);
  assert.equal(damageAt(GUNS[2],100,'locTorsoLower'),147);assert.equal(damageAt(GUNS[3],100,'locTorsoLower'),95);assert.equal(damageAt(GUNS[3],100,'locHead'),190);assert.equal(damageAt(GUNS[0],1,'locGun'),0);
});
test('Bolt rifles require a fresh trigger press and their full patched cycle',async()=>{
  const {GUNS,WeaponSimulation}=await setup(),s=new WeaponSimulation(GUNS);s.select(2);s.tick(.01,false,false);assert.ok(s.fire());assert.equal(s.cooldown,1.5);s.tick(2,false,true);assert.equal(s.fire(),false);s.tick(.01,false,false);assert.ok(s.fire());assert.equal(s.ammo,3);
  s.select(3);s.tick(.01,false,false);assert.equal(s.fire(),false,'Weapon switching cannot bypass recovery');s.tick(2,false,false);assert.ok(s.fire());assert.equal(s.cooldown,1.26);
});
test('ADS duration is stable and reload timing distinguishes empty magazines',async()=>{
  const {GUNS,WeaponSimulation}=await setup(),s=new WeaponSimulation(GUNS);s.select(2);s.tick(.2,true,false);assert.equal(s.ads,.5);s.tick(.2,true,false);assert.equal(s.ads,1);s.tick(.5,true,false);assert.equal(s.ads,1);
  s.ammo=2;assert.ok(s.reload());assert.equal(s.reloadDuration,3.4);s.tick(3.3,true,false);assert.equal(s.ammo,2);assert.equal(s.ads,0);s.tick(.2,false,false);assert.equal(s.ammo,5);
  s.ammo=0;s.reload();assert.equal(s.reloadDuration,4);assert.equal(s.fire(),false);
});
