const test=require('node:test'),assert=require('node:assert/strict');
const T=require('three');
const point=(x,z=0)=>new T.Vector3(x,0,z);
const chooser=()=>import('../server/world.mjs').then(m=>m.chooseTeamSpawn);

test('Random deployment never selects an exposed point when a covered one is available',async()=>{
  const choose=await chooser(),covered=point(20),exposed=point(30),threat=point(0);
  for(const random of [0,.25,.75,.999]){
    assert.deepEqual(choose([exposed,covered],{threats:[threat],hidden:p=>p===covered,random:()=>random}).toArray(),covered.toArray());
  }
});

test('When no point is fully covered, deployment minimizes the number of visible enemies',async()=>{
  const choose=await chooser(),safer=point(20),open=point(40),enemyA=point(0),enemyB=point(-20);
  assert.deepEqual(choose([open,safer],{threats:[enemyA,enemyB],hidden:(p,t)=>p===safer&&t===enemyA,random:()=>0}).toArray(),safer.toArray());
});

test('Equal safety retains random variety and never mutates shared map points',async()=>{
  const choose=await chooser(),candidates=[point(0),point(20),point(40)];
  const first=choose(candidates,{random:()=>0}),last=choose(candidates,{random:()=>.999});
  assert.deepEqual(first.toArray(),[0,0,0]);assert.deepEqual(last.toArray(),[40,0,0]);
  first.y=100;assert.equal(candidates[0].y,0);
});

test('Enemy clearance, occupied space and last deployment remain hard exclusions',async()=>{
  const choose=await chooser(),candidates=[point(0),point(20),point(40),point(60)];
  const options={threats:[point(1)],occupied:[point(21)],last:point(41),random:()=>0};
  assert.deepEqual(choose(candidates,options).toArray(),[60,0,0]);
  assert.equal(choose(candidates.slice(0,3),options),null);
  assert.equal(choose([]),null);
});

test('Teammate proximity is a mild preference and cannot override safer cover',async()=>{
  const choose=await chooser(),near=point(12),far=point(80),ally=point(0);
  // Near has twice the weight; both locations remain possible.
  assert.deepEqual(choose([near,far],{allies:[ally],random:()=>.6}).toArray(),near.toArray());
  assert.deepEqual(choose([near,far],{allies:[ally],random:()=>.9}).toArray(),far.toArray());
  assert.deepEqual(choose([near,far],{allies:[ally],threats:[point(-20)],hidden:p=>p===far,random:()=>0}).toArray(),far.toArray());
});

test('Cover must block enemy muzzle-to-head rays as well as torso rays',async()=>{
  const {spawnHasCover}=await import('../server/world.mjs');
  const {PLAYER_EYE_HEIGHT}=await import('../src/player-config.js');
  const candidate=point(20),enemy=point(0),rays=[];
  const lowWall=(from,to)=>{rays.push([from.clone(),to.clone()]);return to.y<2;};
  assert.equal(spawnHasCover(candidate,enemy,lowWall),false);
  assert.equal(rays.length,2);
  for(const [from,to] of rays){assert.equal(from.y,PLAYER_EYE_HEIGHT-.35);assert.equal(from.x,enemy.x);assert.equal(to.x,candidate.x);}
  assert.deepEqual(rays.map(([,to])=>to.y),[1.4,2.5]);
  assert.equal(spawnHasCover(candidate,enemy,()=>true),true);
  assert.equal(candidate.y,0);assert.equal(enemy.y,0);
});
