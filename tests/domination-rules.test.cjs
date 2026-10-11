const test=require('node:test'),assert=require('node:assert/strict');
const rules=()=>import('../src/domination-rules.mjs');
const grid=(x0,x1,z0,z1,step=2,y=()=>0)=>{const out=[];for(let x=x0;x<=x1;x+=step)for(let z=z0;z<=z1;z+=step)out.push({x,y:y(x,z),z});return out;};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const players=(team,point,count=1)=>Array.from({length:count},()=>({team,x:point.x,y:point.y,z:point.z}));

test('Capture points are deterministic, ordered along the longest axis, separated and on open flat ground',async()=>{
  const {placeCapturePoints}=await rules();
  // A long city strip (120 x 40) with a raised, narrow ledge that must not be chosen.
  const spawns=grid(-60,60,-20,20,2,(x,z)=>x>=-2&&x<=2&&z>=10?5:0);
  const first=placeCapturePoints(spawns),second=placeCapturePoints(spawns.slice());
  assert.deepEqual(first,second);assert.deepEqual(first.map(p=>p.id),['A','B','C']);
  assert.ok(first[0].x<first[1].x&&first[1].x<first[2].x,'A,B,C run along the long axis');
  assert.ok(first[0].x<-35&&first[2].x>35&&Math.abs(first[1].x)<8);
  for(let i=0;i<3;i++){
    assert.ok(spawns.some(s=>s.x===first[i].x&&s.z===first[i].z&&s.y===first[i].y),'points sit on safe ground');
    assert.equal(first[i].y,0);assert.equal(first[i].radius,6);
    for(let j=i+1;j<3;j++)assert.ok(dist(first[i],first[j])>=15);
  }
});

test('Placement prefers well-surrounded ground over isolated edge points and rejects degenerate sets',async()=>{
  const {placeCapturePoints}=await rules();
  const spawns=grid(-50,50,-10,10);spawns.push({x:-52,y:0,z:0}); // lone far-end point, no neighbours
  const points=placeCapturePoints(spawns);
  assert.notEqual(points[0].x,-52);
  assert.throws(()=>placeCapturePoints([{x:0,y:0,z:0}]));
  assert.throws(()=>placeCapturePoints(grid(0,4,0,4)),/separated/);
  // Direction is canonical: a mirrored map yields the same A-to-C ordering.
  const mirrored=placeCapturePoints(grid(-50,50,-10,10).map(p=>({x:-p.x,y:p.y,z:p.z})));
  assert.ok(mirrored[0].x<mirrored[2].x);
});

test('Solo capture takes about five seconds, extra players speed it up to a 3x cap',async()=>{
  const {createDominationState,stepDomination,presenceAt,DOMINATION}=await rules();
  const pts=[{id:'A',x:0,y:0,z:0,radius:6}];
  const seconds=count=>{const s=createDominationState(pts),score={alliance:0,horde:0};let t=0;while(!s.points[0].owner&&t<20){stepDomination(s,presenceAt(s.points,players('alliance',pts[0],count)),.05,score);t+=.05;}return t;};
  assert.ok(Math.abs(seconds(1)-5)<.11);assert.ok(Math.abs(seconds(2)-2.5)<.11);assert.ok(Math.abs(seconds(3)-5/3)<.11);
  assert.ok(Math.abs(seconds(5)-5/3)<.11,'more than three adds nothing');assert.equal(DOMINATION.radius,6);
});

test('Presence uses the 6 m radius and ignores players far above or below',async()=>{
  const {presenceAt}=await rules();
  const pts=[{id:'A',x:0,y:0,z:0,radius:6}];
  const at=(team,x,y=0,z=0)=>({team,x,y,z});
  assert.deepEqual(presenceAt(pts,[at('alliance',5.9),at('alliance',6.1),at('horde',0,12),at('horde',0,3)])[0],{alliance:1,horde:1});
});

test('Contested points freeze; an owned point must be neutralised before it flips',async()=>{
  const {createDominationState,stepDomination}=await rules();
  const s=createDominationState([{id:'A',x:0,y:0,z:0,radius:6}]),p=s.points[0],score={alliance:0,horde:0};
  stepDomination(s,[{alliance:1,horde:0}],1,score);stepDomination(s,[{alliance:1,horde:0}],1,score);assert.ok(Math.abs(p.control-.4)<1e-9);
  const frozen=p.control;for(let i=0;i<3;i++)stepDomination(s,[{alliance:1,horde:1}],1,score);assert.equal(p.control,frozen);assert.equal(p.contested,true);
  for(let i=0;i<4;i++)stepDomination(s,[{alliance:1,horde:0}],1,score);assert.equal(p.owner,'alliance');assert.equal(p.control,1);
  const ev=[];for(let i=0;i<20;i++)ev.push(...stepDomination(s,[{alliance:0,horde:1}],.25,score));
  const neutralAt=ev.findIndex(e=>e.type==='neutralize'),capAt=ev.findIndex(e=>e.type==='capture');
  assert.ok(neutralAt>=0,'enemy neutralises first');assert.ok(capAt<0||capAt>neutralAt);
  for(let i=0;i<20;i++)stepDomination(s,[{alliance:0,horde:1}],.25,score);
  assert.equal(p.owner,'horde');assert.equal(p.control,-1);
  stepDomination(s,[{alliance:0,horde:0}],1,score);assert.equal(p.owner,'horde','Empty point keeps its owner');
});

test('Owned points score one per point per five seconds; eliminations are not part of the rules',async()=>{
  const {createDominationState,stepDomination}=await rules();
  const s=createDominationState([{id:'A',x:0,y:0,z:0},{id:'B',x:30,y:0,z:0},{id:'C',x:60,y:0,z:0}]),score={alliance:0,horde:0};
  s.points[0].owner=s.points[1].owner='alliance';s.points[0].control=s.points[1].control=1;s.points[2].owner='horde';s.points[2].control=-1;
  const idle=[{},{},{}];
  for(let i=0;i<49;i++)stepDomination(s,idle,.1,score);assert.deepEqual(score,{alliance:0,horde:0});
  const ev=stepDomination(s,idle,.1,score);assert.deepEqual(score,{alliance:2,horde:1});assert.equal(ev.at(-1).type,'tick');
  for(let i=0;i<10;i++)stepDomination(s,idle,1,score);assert.deepEqual(score,{alliance:6,horde:3});
});

test('Win conditions: score limit, time limit, ties',async()=>{
  const {dominationWinner}=await rules();
  assert.equal(dominationWinner({alliance:199,horde:150},200,false),null);
  assert.equal(dominationWinner({alliance:200,horde:150},200,false),'alliance');
  assert.equal(dominationWinner({alliance:120,horde:201},200,false),'horde');
  assert.equal(dominationWinner({alliance:201,horde:201},200,false),'draw');
  assert.equal(dominationWinner({alliance:60,horde:80},200,true),'horde');
  assert.equal(dominationWinner({alliance:80,horde:80},200,true),'draw');
});

test('Spawn weighting favours owned points, discourages enemy-held ground and never reaches zero',async()=>{
  const {createDominationState,spawnObjectiveWeight}=await rules();
  const s=createDominationState([{id:'A',x:0,y:0,z:0,radius:6},{id:'B',x:100,y:0,z:0,radius:6}]);
  assert.equal(spawnObjectiveWeight({x:0,y:0,z:0},s,'alliance'),1);assert.equal(spawnObjectiveWeight({x:0,y:0,z:0},null,'alliance'),1);
  s.points[0].owner='alliance';s.points[1].owner='horde';
  const near=spawnObjectiveWeight({x:5,y:0,z:0},s,'alliance'),far=spawnObjectiveWeight({x:50,y:0,z:0},s,'alliance');
  assert.ok(near>far&&far>1&&near<=4);
  assert.equal(spawnObjectiveWeight({x:100,y:0,z:4},s,'alliance'),.25);
  assert.ok(spawnObjectiveWeight({x:100,y:0,z:4},s,'horde')>1);
  assert.ok(spawnObjectiveWeight({x:300,y:0,z:0},s,'alliance')>0);
});

test('Spawn chooser applies the objective weight only within the equally safe tier',async()=>{
  const {chooseTeamSpawn}=await import('../server/world.mjs'),T=require('three');
  const v=(x,z=0)=>new T.Vector3(x,0,z),near=v(20),far=v(80),weigh=p=>p===near?9:1;
  assert.deepEqual(chooseTeamSpawn([near,far],{weigh,random:()=>.85}).toArray(),near.toArray());
  assert.deepEqual(chooseTeamSpawn([near,far],{weigh,random:()=>.95}).toArray(),far.toArray());
  assert.deepEqual(chooseTeamSpawn([near,far],{threats:[v(0)],hidden:p=>p===far,weigh,random:()=>0}).toArray(),far.toArray());
});

test('Snapshot and HUD model expose owner, progress, contested state and score bars',async()=>{
  const {createDominationState,dominationSnapshot,dominationHudModel,stepDomination}=await rules();
  const s=createDominationState([{id:'A',x:1,y:0,z:2},{id:'B',x:30,y:0,z:2},{id:'C',x:60,y:0,z:2}]);
  stepDomination(s,[{alliance:1,horde:0},{alliance:1,horde:1},{}],1,{alliance:0,horde:0});
  const snap=dominationSnapshot(s);assert.equal(snap.points[0].side,'alliance');assert.ok(Math.abs(snap.points[0].progress-.2)<1e-9);assert.equal(snap.points[1].contested,true);assert.equal(snap.nextTick,4);
  const model=dominationHudModel(snap,{alliance:50,horde:100},200);
  assert.deepEqual(model.points.map(p=>p.state),['capturing','contested','neutral']);assert.deepEqual(model.bars,{alliance:.25,horde:.5});
  assert.deepEqual(dominationHudModel(null,{alliance:0,horde:0},200).points,[]);
});

test('Mode helpers keep TDM targets and add Domination limits',async()=>{
  const {dominationTargets,defaultTarget,isTeamMode}=await rules();
  assert.deepEqual(dominationTargets('tdm'),[10,20,50,75]);assert.deepEqual(dominationTargets('domination'),[100,200,300]);
  assert.equal(defaultTarget('domination'),200);assert.equal(defaultTarget('tdm'),50);
  assert.ok(isTeamMode('domination')&&isTeamMode('tdm')&&!isTeamMode('royale')&&!isTeamMode('zombies'));
});
