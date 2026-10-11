const test=require('node:test'),assert=require('node:assert/strict'),T=require('three');
// CPU-only synthetic arenas: no city assets, no renderer.
const flat=(x,z,y=0)=>({point:new T.Vector3(x,y,z),face:{normal:new T.Vector3(0,1,0)}});
async function modules(){
  const [{GroundNavigation},spawns,world]=await Promise.all([import('../src/navigation.js'),import('../src/spawns.js'),import('../server/world.mjs')]);
  return {GroundNavigation,...spawns,...world};
}
// floor(x,z) -> hit or null; wall(a,b) -> true when the segment is blocked.
function arena(m,{floor=(x,z)=>flat(x,z),wall=()=>false,origin=new T.Vector3()}={}){
  const floorAt=(x,z)=>floor(x,z),blocked=(a,b)=>wall(a,b);
  return {origin,floorAt,blocked,nav:new m.GroundNavigation(origin,floorAt,blocked,{radius:Math.ceil(m.SPAWN_RULES.maxRadius/2.5)+1})};
}
const minGap=points=>{let best=Infinity;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)best=Math.min(best,Math.hypot(points[i].x-points[j].x,points[i].z-points[j].z));return best;};

test('GroundNavigation keeps its default 22-cell grid and accepts a wider one',async()=>{
  const m=await modules(),o=new T.Vector3(),a=new m.GroundNavigation(o,flat,()=>false),b=new m.GroundNavigation(o,flat,()=>false,{radius:29});
  assert.equal(a.nodes.length,45*45);assert.equal(b.nodes.length,59*59);assert.equal(a.cell,2.5);
});

test('generated pool is at least three times the original rule, spaced, bounded and deterministic',async()=>{
  const m=await modules(),a=arena(m),first=m.generateSpawnPoints(a),second=m.generateSpawnPoints(a);
  const original=a.nav.reachable.filter(n=>n.edges.length>=2&&n.point.distanceTo(a.origin)<49&&m.clearSpawn(n.point,a.floorAt,a.blocked)).length;
  assert.equal(first.core.length,original,'tier 1 is exactly the original rule');
  assert.ok(first.all.length>=original*3,'density '+first.all.length+' vs '+original);
  assert.deepEqual(first.all.map(p=>p.toArray()),second.all.map(p=>p.toArray()));
  assert.deepEqual(first.all.slice(0,original).map(p=>p.toArray()),first.core.map(p=>p.toArray()),'original points keep leading the list');
  for(const p of first.all)assert.ok(Math.hypot(p.x,p.z)<m.SPAWN_RULES.maxRadius,'inside the extended bound');
  assert.ok(m.SPAWN_RULES.maxRadius+4<75,"extended bound plus the survival-origin offset (about 3 m on the real cities) stays inside the 75 m combat bubble");
  assert.ok(first.extra.some(p=>Math.hypot(p.x,p.z)>=49),'ring beyond 49 m is populated');
  assert.ok(minGap(first.all)>=m.SPAWN_RULES.minSpacing-1e-9,'minimum spacing '+minGap(first.all));
});

test('unreachable islands, void and blocked ground never produce spawns',async()=>{
  const m=await modules();
  // Void between x=30..38, then an island at 38..44; walls block a pocket at z>40.
  const floor=(x,z)=>(x>30&&x<38)?null:flat(x,z),wall=(a,b)=>Math.max(a.z,b.z)>40;
  const a=arena(m,{floor,wall}),pool=m.generateSpawnPoints(a);
  assert.ok(pool.all.length>0);
  assert.ok(pool.all.every(p=>p.x<=30),'island across the void is disconnected');
  assert.ok(pool.all.every(p=>p.z<=40),'walled region excluded');
});

test('reachable dead ends are accepted only when they pass clearance',async()=>{
  const m=await modules();
  // A corridor one cell wide: interior nodes have two links, the tip has one.
  const floor=(x,z)=>Math.abs(z)<1.3&&x>-1.3?flat(x,z):(Math.abs(x)<8&&Math.abs(z)<8?flat(x,z):null);
  const strip=arena(m,{floor:(x,z)=>(Math.abs(z)<1.3&&x>=-1.3&&x<=16)||Math.abs(x)<2.6&&Math.abs(z)<2.6?flat(x,z):null});
  const pool=m.generateSpawnPoints({...strip,minSpacing:1.7});
  assert.equal(typeof pool.stats.deadEnd,'number');
  for(const p of pool.all)assert.ok(m.clearSpawn(p,strip.floorAt,strip.blocked));
  const tight=arena(m,{floor,wall:()=>true}),none=m.generateSpawnPoints(tight);
  assert.equal(none.all.length,0,'fully walled ground fails clearance everywhere');
});

test('authored spawns are validated and every failure is reported with a reason',async()=>{
  const m=await modules(),floor=(x,z)=>(x>30&&x<38)?null:flat(x,z),wall=(a,b)=>Math.abs(a.x-(-20))<1.1&&Math.abs(a.z)<1.1;
  const a=arena(m,{floor,wall}),list=[
    {id:'ok',position:[10,0,10],yaw:1,team:'alliance'},
    {id:'far',position:[69,0,30],yaw:0,team:'any'},
    {id:'void',position:[34,0,0],yaw:0,team:'any'},
    {id:'island',position:[40,0,0],yaw:0,team:'horde'},
    {id:'blocked',position:[-20,0,0],yaw:0,team:'any'},
    {id:'twin',position:[10.3,0,10],yaw:0,team:'horde'},
    {id:'high',position:[0,9,0],yaw:0,team:'any'},
    {id:'bad',position:[NaN,0,0],yaw:0}
  ];
  const out=m.resolveAuthoredSpawns(list,a);
  assert.deepEqual(out.accepted.map(s=>s.id),['ok']);
  assert.equal(out.accepted[0].team,'alliance');assert.equal(out.accepted[0].yaw,1);
  const reasons=Object.fromEntries(out.rejected.map(r=>[r.id,r.reason]));
  assert.deepEqual(Object.keys(reasons).sort(),['bad','blocked','far','high','island','twin','void']);
  assert.match(reasons.far,/Outside/);assert.match(reasons.void,/walkable/);assert.match(reasons.island,/connected/);assert.match(reasons.blocked,/room/);assert.match(reasons.twin,/Overlaps/);assert.match(reasons.high,/walkable/);
  assert.deepEqual(m.resolveAuthoredSpawns(undefined,a),{accepted:[],rejected:[]},'legacy layouts have no authored spawns');
});

test('server merge appends accepted authored spawns, keeps rejected ones reported, and legacy layouts are unchanged',async()=>{
  const m=await modules(),a=arena(m),legacy=m.assembleSpawns({...a,authored:undefined}),pool=m.generateSpawnPoints(a);
  assert.equal(legacy.spawns.length,pool.all.length);assert.equal(legacy.authored.accepted.length,0);assert.equal(legacy.spawnTeams?.size??legacy.teamOf.size,0);
  const merged=m.assembleSpawns({...a,authored:[{id:'a',position:[5.2,0,-3.1],yaw:2,team:'horde'},{id:'b',position:[500,0,0],yaw:0,team:'any'},{id:'c',position:[8,0,8],yaw:0,team:'any'}]});
  assert.equal(merged.spawns.length,pool.all.length+2);assert.deepEqual(merged.authored.rejected.map(r=>r.id),['b']);
  const tagged=merged.spawns.at(-2);assert.equal(merged.teamOf.get(tagged),'horde');assert.equal(merged.teamOf.size,1,'untagged (any) spawns carry no team');
  assert.equal(merged.spawnYaw([tagged.x,tagged.y+1.7,tagged.z]),2);assert.equal(merged.spawnYaw([123,0,456]),null);
  assert.deepEqual(merged.spawns.slice(0,pool.all.length).map(p=>p.toArray()),pool.all.map(p=>p.toArray()),'generated points keep their order');
  assert.equal(merged.coreSpawns.length,pool.core.length,'objective placement still uses only the core set');
});

test('team weights bias own-team spawns but never override safety or exclusions',async()=>{
  const m=await modules(),p=x=>new T.Vector3(x,0,0);
  assert.equal(m.teamSpawnWeight(undefined,'alliance'),1);assert.equal(m.teamSpawnWeight('any','horde'),1);
  assert.equal(m.teamSpawnWeight('alliance','alliance'),4);assert.equal(m.teamSpawnWeight('horde','alliance'),.15);
  const own=p(0),plain=p(30),enemyTag=p(60),teamOf=new Map([[own,'alliance'],[enemyTag,'horde']]);
  const spawnWith=random=>m.createSpawner([own,plain,enemyTag],teamOf,()=>({}),{random})([],'alliance',null);
  const pick=r=>spawnWith(()=>r)[0];
  assert.equal(pick(.1),0,'own tag covers the first 4/5.15 of the weight');
  assert.equal(pick(.7),0);assert.equal(pick(.8),30);assert.equal(pick(.999),60);
  // A visible own-team point loses to a concealed enemy-tagged point.
  const threat={position:[0,1.7,-40],hp:100,team:'horde'};
  const concealed=m.createSpawner([own,enemyTag],teamOf,(from,to)=>to.x===60?{}:null,{random:()=>0});
  assert.equal(concealed([threat],'alliance',null)[0],60);
  assert.equal(m.createSpawner([own],teamOf,()=>({}))([{position:[1,1.7,0],hp:100,team:'horde'}],'alliance',null),null,'threat clearance still wins');
});

test('large pools sample a bounded subset first but still search the rest for safety',async()=>{
  const m=await modules(),pts=Array.from({length:1000},(_,i)=>new T.Vector3(i*4,0,0));
  let calls=0;const safe=pts[999];
  const pick=m.chooseTeamSpawn(pts,{threats:[new T.Vector3(-100,0,0)],maxCandidates:50,random:(()=>{let s=1;return()=>(s=(s*16807)%2147483647)/2147483647;})(),hidden:p=>{calls++;return p===safe;}});
  assert.equal(pick.x,safe.x,'the only concealed point is found even outside the first sample');
  assert.ok(calls<=1000);
  calls=0;const quick=m.chooseTeamSpawn(pts,{threats:[new T.Vector3(-100,0,0)],maxCandidates:50,random:()=>.3,hidden:()=>{calls++;return true;}});
  assert.ok(quick&&calls===50,'stops after the sample when it already contains fully concealed points ('+calls+')');
  // Default (no cap) behaves exactly as before.
  assert.equal(m.chooseTeamSpawn([new T.Vector3(1,0,0)],{random:()=>0}).x,1);
});

test('domination and battle royale planning stay valid and deterministic on the larger pool',async()=>{
  const m=await modules(),{placeCapturePoints}=await import('../src/domination-rules.mjs'),{createRoyalePlan}=await import('../src/battle-royale-rules.mjs');
  const a=arena(m),pool=m.generateSpawnPoints(a);
  const core=placeCapturePoints(pool.core),again=placeCapturePoints(pool.core.slice());assert.deepEqual(core,again);
  assert.equal(core.length,3);for(const c of core)assert.ok(Math.hypot(c.x,c.z)<49,'capture points stay in the core area');
  const plan=createRoyalePlan(pool.all,a.origin),small=createRoyalePlan(pool.core,a.origin);
  assert.deepEqual(plan.center,small.center);assert.equal(plan.initialRadius,small.initialRadius);assert.ok(plan.initialRadius<=48,'royale radius clamp unchanged');
  assert.deepEqual(placeCapturePoints(pool.all),placeCapturePoints(pool.all.slice()));
});
