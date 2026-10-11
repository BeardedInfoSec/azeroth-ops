const test=require('node:test'),assert=require('node:assert/strict');

test('Knife is ammo free and shares recovery with guns without cancelling reload or bolt actions',async()=>{
  const {MELEE,tryMelee}=await import('../src/melee-rules.mjs'),{WeaponSimulation}=await import('../src/engine/weapon-simulation.mjs'),{GUNS}=await import('../src/weapon-data.js');
  const weapon=new WeaponSimulation(GUNS),state={};weapon.ammo=0;weapon.reserve=0;
  assert.equal(tryMelee(weapon,state,1000),true);assert.equal(weapon.ammo,0);assert.equal(weapon.reserve,0);assert.equal(weapon.cooldown,MELEE.cooldown);
  assert.equal(tryMelee(weapon,state,1400),false);weapon.tick(.8,false,false);assert.equal(tryMelee(weapon,state,1800),true);
  weapon.tick(.8,false,false);weapon.refill();weapon.ammo--;weapon.reload();const remaining=weapon.reloadLeft;
  assert.equal(tryMelee(weapon,state,3000),false);assert.equal(weapon.reloadLeft,remaining);assert.equal(weapon.ammo,GUNS[0].capacity-1);
  weapon.tick(10,false,false);weapon.select(2);weapon.releaseTrigger();assert.equal(weapon.fire(),true);assert.equal(tryMelee(weapon,state,4000),false,'knife cannot skip bolt cycling');
  weapon.tick(5,false,false);assert.equal(tryMelee(weapon,state,6000),true);weapon.select(0);weapon.releaseTrigger();assert.equal(weapon.fire(),false,'switching guns cannot skip knife recovery');
});

test('Dead, downed, reviving and airborne players cannot knife; invalid clocks never unlock recovery',async()=>{
  const {tryMelee}=await import('../src/melee-rules.mjs'),weapon={ammo:0,reserve:0,reloadLeft:0,cooldown:0,ads:1},state={};
  for(const status of [{alive:false},{reviving:true},{landed:false}])assert.equal(tryMelee(weapon,state,1000,status),false);
  assert.equal(tryMelee(weapon,state,NaN),false);assert.equal(state.nextAt,undefined);assert.equal(weapon.cooldown,0);
});

test('Knife arc selects one nearest body and respects forward aim, exact contact distance, and cover',async()=>{
  const {selectMeleeTarget}=await import('../src/melee-rules.mjs');
  const near={id:'near',position:[0,0,-1.5],height:1.85},far={id:'far',position:[0,0,-2.2],height:1.85},behind={id:'behind',position:[0,0,1],height:1.85},side={id:'side',position:[1.5,0,-.2],height:1.85};
  const input={origin:[0,2.1,0],direction:[0,0,-1],candidates:[behind,side,far,near]};
  const hit=selectMeleeTarget(input);assert.equal(hit.candidate.id,'near');assert.deepEqual(hit.point,[0,1.85,-1.16]);assert.ok(hit.distance<2);
  assert.equal(selectMeleeTarget({...input,blocked:()=>true}),null,'walls and boards reject every contact');
  assert.equal(selectMeleeTarget({...input,candidates:[behind,side]}),null);
  assert.equal(selectMeleeTarget({...input,candidates:[{...far,position:[0,0,-2.7]}]}),null);
  assert.equal(selectMeleeTarget({...input,direction:[0,0,0]}),null);assert.equal(selectMeleeTarget({...input,origin:[NaN,0,0]}),null);
  assert.equal(selectMeleeTarget({...input,candidates:[{...near,alive:false}]}),null);
});

test('A low target can be knifed by aiming down, without extending reach through ceilings',async()=>{
  const {selectMeleeTarget}=await import('../src/melee-rules.mjs');
  const input={origin:[0,2.1,0],direction:[0,-1,-1],candidates:[{id:'gnome',position:[0,0,-1.2],height:1.05}]};
  assert.equal(selectMeleeTarget(input).candidate.id,'gnome');
  assert.equal(selectMeleeTarget({...input,candidates:[{id:'below',position:[0,-3,-1],height:1.8}]}),null);
});
