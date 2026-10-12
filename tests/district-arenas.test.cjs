const test=require('node:test'),assert=require('node:assert/strict');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
// Loads each generated district arena through the server loader, ONE AT A TIME (each is ~150 MB while
// built). Gated on the generated packs (npm run build:districts); skipped on a clean clone.
const ids=['stormwind','stormwind-dwarven','stormwind-valley','stormwind-park'];
const needs=['stormwind-trade','stormwind-dwarven','stormwind-valley','stormwind-park'].flatMap(p=>[p+'.json','props/'+p+'.json']);

for(const id of ids)test(id+' arena: safe deployment inside the pack, spawns, navigation, Domination, Battle Royale and bots',skipUnlessAssets(...needs),async()=>{
  const T=await import('three'),{loadArena,survivalOrigin}=await import('../server/world.mjs'),{getDistrict,COMBAT_RADIUS,SPAWN_SEARCH_RADIUS,inDistrict}=await import('../src/districts.mjs');
  const {placeCapturePoints}=await import('../src/domination-rules.mjs'),{createRoyalePlan,royaleState}=await import('../src/battle-royale-rules.mjs'),{BotNav}=await import('../server/bot-nav.mjs');
  const d=getDistrict(id),arena=await loadArena(id);
  assert.equal(arena.city,id);
  // The deployment point is found within the search radius of the table origin and the combat bubble stays inside the pack.
  const shift=Math.hypot(arena.origin.x-d.origin[0],arena.origin.z-d.origin[2]);
  assert.ok(shift<=SPAWN_SEARCH_RADIUS+1e-6,id+' deployment moved '+shift.toFixed(1)+' from the table origin');
  assert.equal(survivalOrigin(arena,id).distanceTo(arena.origin),0);
  assert.ok(shift+COMBAT_RADIUS<d.radius);
  assert.ok(arena.coreSpawns.length>=20&&arena.spawns.length>=200,id+' spawn pool '+arena.spawns.length);
  for(const s of arena.spawns)assert.ok(inDistrict(d,s,0),id+' spawn outside the pack circle');
  assert.ok(arena.nav.reachable.length>=600,id+' navigation '+arena.nav.reachable.length);
  const maxSpawn=Math.max(...arena.spawns.map(s=>Math.hypot(s.x-arena.origin.x,s.z-arena.origin.z)));assert.ok(maxSpawn<COMBAT_RADIUS,id+' spawns lie inside the combat radius');
  const points=placeCapturePoints(arena.coreSpawns);assert.equal(points.length,3);
  for(const p of points)assert.ok(Math.hypot(p.x-arena.origin.x,p.z-arena.origin.z)<COMBAT_RADIUS);
  const plan=createRoyalePlan(arena.spawns,arena.origin);assert.ok(plan.initialRadius>=36&&plan.initialRadius<=48);assert.ok(royaleState(plan,0).flight);
  const bots=BotNav.fromGroundNavigation(arena.nav);assert.ok(bots.nearest(arena.spawns[0]));
  // Spawning respects visibility and the arena stance helpers exactly as on the full city.
  const spawn=arena.spawn([],'alliance',null);assert.ok(Array.isArray(spawn)&&spawn.length===3&&spawn.every(Number.isFinite));
  assert.ok(new T.Vector3().fromArray(spawn).distanceTo(arena.origin)<COMBAT_RADIUS+3);
});

test('Trade pack gives the same arena as the full city (deployment, spawn pool, Domination points)',skipUnlessAssets('stormwind.json','props/stormwind.json',...needs),async()=>{
  // The pack must not change the proven Trade District. These numbers were recorded from the full-city build.
  const {loadArena}=await import('../server/world.mjs'),{placeCapturePoints}=await import('../src/domination-rules.mjs');
  const arena=await loadArena('stormwind');
  const key=a=>({origin:a.origin.toArray().map(v=>+v.toFixed(2)),spawns:a.spawns.length,core:a.coreSpawns.length,dom:placeCapturePoints(a.coreSpawns).map(p=>[p.id,+p.x.toFixed(2),+p.z.toFixed(2)])});
  assert.deepEqual(key(arena),{origin:[-138,-5.58,3],spawns:1480,core:512,dom:[['A',-135.5,-32],['B',-135.5,3],['C',-128,35.5]]});
});
