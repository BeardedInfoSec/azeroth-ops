const test=require('node:test'),assert=require('node:assert/strict');
const rules=()=>import('../src/survival-rules.mjs');
async function rich(){const {SurvivalRules}=await rules(),r=new SurvivalRules();r.points=100000;r.zones=new Set([0,1,2]);return r;}
test('All twelve perk machines have fixed costs and access requirements',async()=>{
  const {ZOMBIE_PERKS,PERKS_BY_ID,SurvivalRules}=await rules();
  assert.equal(ZOMBIE_PERKS.length,12);assert.equal(new Set(ZOMBIE_PERKS.map(p=>p.id)).size,12);
  for(const p of ZOMBIE_PERKS){assert.ok(p.name&&p.short&&p.description);assert.match(p.color,/^#[0-9a-f]{6}$/i);assert.ok([0,1,2].includes(p.zone));assert.ok(p.cost>0);assert.equal(PERKS_BY_ID[p.id],p);}
  const r=new SurvivalRules();r.points=10000;assert.equal(r.buyPerk('double_tap',0).reason,'zone-locked');assert.equal(r.points,10000);
  assert.equal(r.buyPerk('unknown').reason,'unknown-perk');assert.equal(r.buyPerk('__proto__').reason,'unknown-perk');
});
test('Perk purchases enforce affordability, no duplicates, and the classic four-perk cap atomically',async()=>{
  const {SurvivalRules}=await rules(),r=new SurvivalRules();assert.equal(r.buyPerk('juggernog').reason,'insufficient-points');assert.equal(r.points,500);
  r.points=10000;for(const id of ['juggernog','stamin_up','deadshot','quick_revive'])assert.equal(r.buyPerk(id).ok,true);
  const before=r.points;assert.equal(r.buyPerk('juggernog').reason,'already-owned');r.zones.add(1);assert.equal(r.buyPerk('mule_kick').reason,'perk-limit');assert.equal(r.points,before);assert.equal(r.perks.size,4);
  assert.equal(r.maxHealth,250);assert.equal(r.movementMultiplier,1.25);assert.equal(r.spreadMultiplier,.65);assert.equal(r.recoilMultiplier,.65);
});
test('Quick Revive allows exactly three purchases across downs and loadout restoration',async()=>{
  const r=await rich();for(let n=0;n<3;n++){assert.equal(r.buyPerk('quick_revive').ok,true);r.consumePerk('quick_revive');}
  const before=r.points;assert.equal(r.buyPerk('quick_revive').reason,'revive-limit');assert.equal(r.points,before);
  r.restoreLoadout({owned:[0],perks:[],packed:[],revivePurchases:0});assert.equal(r.revivePurchases,3);
  r.reset();assert.equal(r.revivePurchases,0);assert.equal(r.buyPerk('quick_revive').ok,true);
});
test('Two weapon slots replace the current weapon; Mule Kick adds and later removes the correct third slot',async()=>{
  const r=await rich();r.buyWeapon(1);r.packWeapon(0);
  assert.deepEqual(r.buyWeapon(2,1,0),{ok:true,cost:1500,refill:false,replaced:0});assert.deepEqual([...r.owned],[1,2]);assert.equal(r.packed.has(0),false);
  r.buyPerk('mule_kick');assert.equal(r.weaponCapacity,3);r.buyWeapon(3,2,2);assert.deepEqual([...r.owned],[1,2,3]);assert.equal(r.muleWeapon,3);r.packWeapon(3);
  r.consumePerk('mule_kick');assert.deepEqual([...r.owned],[1,2]);assert.equal(r.packed.has(3),false);assert.equal(r.weaponCapacity,2);
});
test('Pack-a-Punch requires final area, owned weapon and 5000 points, then ammo costs 4500',async()=>{
  const {SurvivalRules}=await rules(),r=new SurvivalRules();r.points=10000;assert.equal(r.packWeapon(0).reason,'zone-locked');r.zones.add(2);
  assert.equal(r.packWeapon(2).reason,'weapon-not-owned');r.points=4999;assert.equal(r.packWeapon(0).reason,'insufficient-points');assert.equal(r.points,4999);
  r.points=10000;assert.deepEqual(r.packWeapon(0),{ok:true,cost:5000});assert.equal(r.packWeapon(0).reason,'already-packed');assert.equal(r.points,5000);
  assert.deepEqual(r.buyWeapon(0),{ok:true,cost:4500,refill:true});assert.equal(r.points,500);assert.ok(r.owned.has(0)&&r.packed.has(0));
  assert.equal(r.buyWeapon(0).reason,'insufficient-points');assert.ok(r.owned.has(0)&&r.packed.has(0));
});
test('Packed and perk weapon modifiers change real damage, cooldown and reload without touching source guns',async()=>{
  const {survivalWeapons}=await rules(),{GUNS}=await import('../src/weapon-data.js'),{damageAt,WeaponSimulation}=await import('../src/engine/weapon-simulation.mjs');
  const baseline=JSON.stringify(GUNS),r=await rich();r.buyPerk('double_tap');r.buyPerk('speed_cola');r.packWeapon(0);
  const guns=survivalWeapons(GUNS,r);assert.equal(guns[0].capacity,45);assert.equal(guns[0].reserve,240);assert.equal(guns[0].name,'PACKED AN-94');
  assert.equal(damageAt(guns[0],10,'locTorsoUpper'),damageAt(GUNS[0],10,'locTorsoUpper')*4);
  assert.equal(damageAt(guns[1],10,'locTorsoUpper'),damageAt(GUNS[1],10,'locTorsoUpper')*2);
  const sim=new WeaponSimulation(guns);assert.equal(sim.fire(),true);assert.equal(sim.cooldown,GUNS[0].introInterval/1.33);sim.tick(1,false,false);assert.equal(sim.reload(),true);assert.equal(sim.reloadLeft,GUNS[0].reload*.5);
  assert.equal(guns[2].cycle,GUNS[2].cycle/1.33);assert.equal(JSON.stringify(GUNS),baseline);
  const again=survivalWeapons(GUNS,r);assert.equal(again[0].capacity,45,'Recomputing never stacks modifiers');
});
test('Recovery restores packed equipment while excluding consumed perks and respecting Mule capacity',async()=>{
  const r=await rich();r.buyPerk('mule_kick');r.buyPerk('whos_who');r.buyPerk('tombstone');r.buyWeapon(1);r.buyWeapon(2);r.packWeapon(1);r.packWeapon(2);
  const snapshot=r.snapshotLoadout(),points=r.points;r.clearPerks();assert.equal(r.owned.size,2);assert.equal(r.maxHealth,100);
  r.restoreLoadout(snapshot,{excludePerks:['whos_who']});assert.equal(r.owned.size,3);assert.ok(r.packed.has(2));assert.equal(r.perks.has('whos_who'),false);assert.ok(r.perks.has('tombstone'));assert.equal(r.points,points);
  r.restoreLoadout(snapshot,{exclude:['mule_kick','tombstone']});assert.equal(r.owned.size,2);assert.equal(r.packed.has(2),false);assert.equal(r.perks.has('tombstone'),false);
  r.resetLoadout();assert.deepEqual([...r.owned],[0]);assert.equal(r.perks.size,0);assert.equal(r.packed.size,0);assert.equal(r.points,points);
});
