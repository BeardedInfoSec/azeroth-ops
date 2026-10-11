const test=require('node:test'),assert=require('node:assert/strict');
const rules=()=>import('../src/survival-rules.mjs');

test('Survival starts with 500 points, AN-94, and only the first area open',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();
  assert.equal(s.points,500);assert.deepEqual([...s.owned],[0]);assert.deepEqual([...s.zones],[0]);
  assert.equal(s.spend(501),false);assert.equal(s.spend(-1),false);assert.equal(s.spend(NaN),false);
  assert.equal(s.spend(1.5),false);assert.equal(s.spend(500),true);assert.equal(s.points,0);
});

test('Damaging hits and kills pay once, including headshots; zero damage pays nothing',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();
  assert.equal(s.awardHit('a',{damage:0,killed:true}),0);
  assert.equal(s.awardHit('a',{damage:20}),10);
  assert.equal(s.awardHit('a',{damage:80,killed:true}),110);
  assert.equal(s.awardHit('a',{damage:80,killed:true,headshot:true}),0);
  assert.equal(s.awardHit('a',{damage:20}),0);
  assert.equal(s.awardHit('b',{damage:100,killed:true,headshot:true}),160);
  assert.equal(s.points,780);
});

test('Repairs cap at 60 per window per wave and next wave preserves purchases and points',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();
  for(let i=0;i<6;i++)assert.equal(s.repair('north'),10);
  assert.equal(s.repair('north'),0);assert.equal(s.repair('south'),10);
  s.points=5000;s.openZone(1);s.buyWeapon(2);const points=s.points;
  const wave=s.resetWave();assert.equal(wave.wave,2);assert.equal(s.points,points);
  assert.equal(s.repair('north'),10);assert.ok(s.zones.has(1));assert.ok(s.owned.has(2));
});

test('Doors require sequential progression and exact costs without charging failed attempts',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();
  assert.equal(s.openZone(1).reason,'insufficient-points');assert.equal(s.points,500);
  s.points=3000;assert.equal(s.openZone(2).reason,'previous-zone-locked');assert.equal(s.points,3000);
  assert.deepEqual(s.openZone(1),{ok:true,cost:750});assert.equal(s.points,2250);
  assert.equal(s.openZone(1).reason,'already-open');assert.equal(s.points,2250);
  assert.deepEqual(s.openZone(2),{ok:true,cost:1500});assert.equal(s.points,750);
  assert.equal(s.openZone(8).reason,'unknown-zone');assert.equal(s.points,750);
});

test('Wall guns enforce their unlocked area, affordability, and 40 percent ammo refill cost',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();
  assert.equal(s.buyWeapon(1).reason,'insufficient-points');assert.equal(s.points,500);
  s.points=10000;assert.equal(s.buyWeapon(2,0).reason,'zone-locked');assert.equal(s.points,10000);
  assert.deepEqual(s.buyWeapon(1),{ok:true,cost:1000,refill:false});
  assert.deepEqual(s.buyWeapon(1),{ok:true,cost:400,refill:true});
  s.openZone(1);assert.deepEqual(s.buyWeapon(2),{ok:true,cost:1500,refill:false,replaced:0});
  assert.deepEqual(s.buyWeapon(2),{ok:true,cost:600,refill:true});
  assert.equal(s.buyWeapon(3).reason,'zone-locked');s.openZone(2);
  assert.deepEqual(s.buyWeapon(3),{ok:true,cost:1750,refill:false,replaced:1});
  assert.deepEqual(s.buyWeapon(3),{ok:true,cost:700,refill:true});
  assert.equal(s.buyWeapon(99).reason,'unknown-weapon');
});

test('Restart clears economy, doors, weapons, repaired windows and awarded kills',async()=>{
  const {SurvivalRules}=await rules(),s=new SurvivalRules();s.points=5000;s.openZone(1);s.buyWeapon(2);
  s.resetWave(5);s.repair('north');s.awardHit('a',{killed:true});s.reset();
  assert.equal(s.points,500);assert.equal(s.wave,1);assert.deepEqual([...s.owned],[0]);assert.deepEqual([...s.zones],[0]);
  assert.equal(s.repairs.size,0);assert.equal(s.killed.size,0);
});

test('Waves scale enemy count, health, movement, damage and pacing with bounded late waves',async()=>{
  const {waveConfig}=await rules(),first=waveConfig(1),second=waveConfig(2),late=waveConfig(1000);
  assert.equal(first.count,8);assert.equal(first.health,80);assert.equal(first.speed,1.65);assert.equal(first.damage,21);
  assert.equal(second.count,11);assert.equal(second.health,98);assert.ok(Math.abs(second.speed-1.85)<1e-10);
  assert.ok(second.entryDelay<first.entryDelay);assert.equal(second.ghoulSpeed,second.speed*1.2);
  assert.equal(late.count,36);assert.equal(late.health,500);assert.equal(late.speed,3.8);assert.equal(late.damage,40);assert.equal(late.entryDelay,.45);
  assert.equal(waveConfig(-5).wave,1);assert.equal(waveConfig(NaN).wave,1);
});
