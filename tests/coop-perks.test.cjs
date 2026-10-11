const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(perks=[],race='gnome'){
  const T=await import('three'),api=await import('../server/zombie-perks.mjs'),{SurvivalRules,survivalWeapons}=await import('../src/survival-rules.mjs'),{WeaponSimulation}=await import('../src/engine/weapon-simulation.mjs'),{GUNS}=await import('../src/weapon-data.js');
  const p={id:'one',race,status:'alive',hp:100,position:[0,2.45,0],interactHeld:false,interactAt:1000,survival:new SurvivalRules({coop:true}),weapon:new WeaponSimulation(GUNS)};
  p.survival.perks=new Set(perks);let now=1000;const hits=[],messages=[];
  const m={players:[p],units:[],random:()=>.1,feet:p=>new T.Vector3().fromArray(p.position).add(new T.Vector3(0,-2.45,0)),trace:(a,b)=>a.x===2||b.x===2?{}:null,send:(_p,msg)=>messages.push(msg),broadcast:msg=>messages.push(msg),hurtUnit:(unit,damage)=>hits.push({id:unit.id,damage}),configureWeapons:p=>{p.weapon.guns=survivalWeapons(GUNS,p.survival);},revive:p=>{p.status='alive';p.hp=p.survival.maxHealth*.4;}};
  return {T,api,p,m,hits,messages,get now(){return now;},step(seconds,held=false){const count=Math.ceil(seconds/.05);for(let i=0;i<count;i++){now+=50;p.interactHeld=held;p.interactAt=now;api.tickPerks(m,.05,now);}},down(){api.onDown(m,p,now);p.survival.losePerks();p.status='downed';p.hp=0;}};
}
test('Co-op Quick Revive costs 1500, has no three-purchase solo cap, and retains the four-perk limit',async()=>{
  const {SurvivalRules}=await import('../src/survival-rules.mjs'),r=new SurvivalRules({coop:true});r.points=20000;
  for(let i=0;i<5;i++){assert.deepEqual(r.buyPerk('quick_revive'),{ok:true,cost:1500});r.consumePerk('quick_revive');}
  assert.equal(r.points,12500);for(const id of ['juggernog','quick_revive','deadshot','stamin_up'])assert.equal(r.buyPerk(id).ok,true);
  r.zones.add(1);assert.equal(r.buyPerk('double_tap').reason,'perk-limit');assert.equal(r.buyPerk('__proto__').reason,'unknown-perk');
  const solo=new SurvivalRules();assert.deepEqual(solo.buyPerk('quick_revive'),{ok:true,cost:500});
});
test("Who's Who requires a fresh, sustained hold, restores owned ammunition, and consumes itself",async()=>{
  const f=await fixture(['whos_who','juggernog'],'human');f.p.weapon.ammo=17;f.down();assert.equal(f.p.selfRecovery.required,6.8);
  f.step(1,true);assert.equal(f.p.selfRecovery.hold,0,'A held repair key cannot start self rescue');f.step(.1,false);f.step(3,true);f.step(.1,false);assert.equal(f.p.selfRecovery.hold,0);
  f.step(6.9,true);assert.equal(f.p.status,'alive');assert.equal(f.p.hp,100);assert.equal(f.p.weapon.ammo,17);assert.ok(f.p.survival.perks.has('juggernog'));assert.equal(f.p.survival.perks.has('whos_who'),false);assert.equal(f.p.selfRecovery,null);
  f.down();assert.equal(f.p.selfRecovery,null,'The consumed recovery cannot repeat');
});
test('Self rescue expires after fifteen seconds; client heartbeat loss cancels progress',async()=>{
  const f=await fixture(['whos_who']);f.down();f.step(.1,false);f.step(3,true);f.api.tickPerks(f.m,.1,f.now+500);assert.equal(f.p.selfRecovery.hold,0);
  f.step(13,false);assert.equal(f.p.selfRecovery,null);assert.equal(f.p.status,'downed');
});
test('Tombstone survives a dead wait, requires owner hold and LOS, and restores packed gear exactly once',async()=>{
  const f=await fixture(['tombstone','juggernog']);f.p.survival.owned.add(1);f.p.survival.packed.add(1);f.p.weapon.inventory[1].ammo=12;f.down();f.p.status='dead';f.p.survival.resetLoadout();f.step(60);assert.equal(f.m.stashes.length,1);assert.equal(f.m.stashes[0].expiresAt,0);
  f.p.status='alive';f.p.hp=100;f.step(.1,false);assert.ok(f.m.stashes[0].expiresAt>f.now);f.p.position[0]=2;f.step(1.1,true);assert.equal(f.m.stashes.length,1,'The stash cannot be taken through cover');f.p.position[0]=0;f.step(.1,false);f.step(1.1,true);
  assert.equal(f.m.stashes.length,0);assert.ok(f.p.survival.packed.has(1));assert.equal(f.p.weapon.inventory[1].ammo,12);assert.equal(f.p.survival.perks.has('tombstone'),false);assert.ok(f.p.survival.perks.has('juggernog'));assert.equal(f.p.perkRequireRelease,true);
});
test('Electric Cherry and PhD respect cover; reload cancellation cannot produce repeated shocks',async()=>{
  const f=await fixture(['electric_cherry','phd_flopper']);for(const x of [1,2,8])f.m.units.push({id:x,position:new f.T.Vector3(x,0,0),height:1.8,hp:100,alive:true});
  f.api.onReload(f.m,f.p,f.now,1);f.api.onReload(f.m,f.p,f.now,1);assert.deepEqual(f.hits,[{id:1,damage:100}]);assert.equal(f.m.units[0].stunUntil,f.now+2000);
  f.api.onShot(f.m,f.p,0);f.api.onReload(f.m,f.p,f.now,1);assert.equal(f.hits.length,2);f.api.onLand(f.m,f.p,f.now,1.19);assert.equal(f.hits.length,2);f.api.onLand(f.m,f.p,f.now,1.2);assert.deepEqual(f.hits.at(-1),{id:1,damage:150});f.api.onLand(f.m,f.p,f.now,2);assert.equal(f.hits.length,3);
});
test('Vulture drops appear inside entry walls, belong to the killer, expire and conceal only living perk owners',async()=>{
  const f=await fixture(['vulture_aid']);f.p.weapon.reserve=0;const unit={position:new f.T.Vector3(30,0,0),entry:{inside:new f.T.Vector3()}};f.api.onKill(f.m,f.p,unit,f.now);
  assert.deepEqual(f.m.pickups[0].position.toArray(),[0,0,0]);assert.equal(f.m.pickups[0].owner,'one');f.step(.1);assert.equal(f.m.pickups.length,0);assert.equal(f.p.weapon.reserve,30);assert.equal(f.p.zombieHidden,true);
  const state=f.api.perkSnapshot(f.m,f.now);assert.ok(JSON.stringify(state));assert.equal(state.clouds.length,1);f.p.status='downed';f.step(.1);assert.equal(f.p.zombieHidden,false);f.step(11);assert.equal(f.m.clouds.length,0);
});
