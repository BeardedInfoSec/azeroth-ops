const test=require('node:test'),assert=require('node:assert/strict');

test('Every playable race has one modest passive and unknown races are neutral',async()=>{
  const {ROSTERS}=await import('../src/rules.mjs'),m=await import('../src/racial-traits.mjs');
  assert.deepEqual(Object.keys(m.RACE_TRAITS).sort(),Object.values(ROSTERS).flat().sort());
  const neutral=m.raceTraits('not-a-race');
  for(const race of Object.values(ROSTERS).flat()){
    const t=m.raceTraits(race);assert.ok(Object.isFrozen(t));assert.ok(t.name&&t.description);
    assert.equal(Object.keys(neutral).filter(key=>typeof neutral[key]==='number'&&t[key]!==neutral[key]).length,1,race);
    assert.ok(t.movement<=1.03);assert.ok(t.healthBonus<=5);assert.ok(t.reload>=.95);assert.ok(t.adsIn>=.94);assert.ok(t.recoil>=.92);
    assert.equal(m.racialSpread(race),1);
  }
  for(const race of ['missing','__proto__',undefined]){
    assert.equal(m.racialMaxHealth(100,race),100);assert.equal(m.racialMovement(race),1);assert.equal(m.racialRegenDelay(race),6);assert.equal(m.racialRegenRate(race),12);
  }
});

test('Racial weapons preserve damage and cadence and compose once with existing perks',async()=>{
  const m=await import('../src/racial-traits.mjs'),{GUNS}=await import('../src/weapon-data.js'),{classWeapons}=await import('../src/loadouts.mjs'),before=JSON.stringify(GUNS);
  for(const race of Object.keys(m.RACE_TRAITS))for(const [i,g] of m.racialWeapons(GUNS,race).entries()){
    assert.equal(g.damage,GUNS[i].damage);assert.deepEqual(g.damageCurve,GUNS[i].damageCurve);assert.deepEqual(g.multipliers,GUNS[i].multipliers);
    for(const key of ['capacity','interval','introInterval','cycle','hipSpread','adsSpread','adsOut'])assert.equal(g[key],GUNS[i][key]);
    assert.notEqual(g,GUNS[i]);assert.notEqual(g.damageCurve,GUNS[i].damageCurve);
  }
  const quick=classWeapons(GUNS,{perk:'fastHands'}),gnome=m.racialWeapons(quick,'gnome');assert.equal(gnome[0].reload,GUNS[0].reload*.85*.95);
  assert.equal(m.racialWeapons(GUNS,'orc')[0].adsIn,GUNS[0].adsIn*.94);
  assert.equal(m.racialWeapons(GUNS,'bloodelf')[0].reserve,Math.floor(GUNS[0].reserve*1.1));
  assert.deepEqual(m.racialWeapons(quick,'gnome'),gnome);assert.equal(JSON.stringify(GUNS),before);
});

test('Support timers, health and regeneration remain explicit and bounded',async()=>{
  const m=await import('../src/racial-traits.mjs');
  assert.equal(m.racialMaxHealth(100,'tauren'),105);assert.equal(m.racialMaxHealth(250,'tauren'),255);
  assert.equal(m.racialReviveDuration(4,'human'),3.4);assert.equal(m.racialReviveDuration(4,'forsaken'),4);
  assert.equal(m.racialBleedoutDuration(30,'forsaken'),36);assert.equal(m.racialBleedoutDuration(30,'human'),30);
  assert.equal(m.racialRegenDelay('troll'),5.5);assert.equal(m.racialRegenRate('draenei'),13.8);
  assert.equal(m.racialMovement('nightelf'),1.03);assert.equal(m.racialRecoil('dwarf'),.92);
});

test('Tauren endurance preserves sniper torso kills and flat-band rifle body-shot counts',async()=>{
  const {GUNS}=await import('../src/weapon-data.js'),{damageAt}=await import('../src/engine/weapon-simulation.mjs'),{racialMaxHealth}=await import('../src/racial-traits.mjs');
  const hp=racialMaxHealth(100,'tauren'),shots=(gun,range,health,region='locTorsoUpper')=>Math.ceil(health/damageAt(gun,range,region));
  for(const gun of GUNS.filter(g=>g.bolt))for(const range of [0,50,150])for(const region of ['locHead','locTorsoUpper','locTorsoMid']){
    assert.equal(shots(gun,range,100,region),1,gun.name+' baseline '+region);
    assert.equal(shots(gun,range,hp,region),1,gun.name+' Tauren '+region);
  }
  for(const [id,expected] of [['an94_mp',[3,4,5]],['scar_mp',[3,3,4]]]){
    const gun=GUNS.find(g=>g.id===id);
    for(const [i,range] of [0,40,100].entries()){
      assert.equal(shots(gun,range,100),expected[i]);assert.equal(shots(gun,range,hp),expected[i]);
    }
  }
  // Document the intentional small mixed-hit edge instead of pretending that
  // extra health can never change a kill threshold.
  const an94=GUNS.find(g=>g.id==='an94_mp'),mixed=damageAt(an94,100,'locHead')+3*damageAt(an94,100);
  assert.ok(mixed>=100&&mixed<hp);
});
