const test=require('node:test'),assert=require('node:assert/strict');
const rules=()=>import('../src/battle-royale-rules.mjs');
test('Zeppelin follows a bounded eighteen-second flight above the highest safe ground',async()=>{
  const {createRoyalePlan,flightAt}=await rules();
  const plan=createRoyalePlan([[-40,0,0],[0,2,0],[40,4,0]],[0,0,0]);
  assert.deepEqual(plan.center,[0,2,0]);assert.equal(plan.initialRadius,40);
  assert.ok(plan.flight.start[1]>=4+120);assert.deepEqual(flightAt(plan,-10).position,plan.flight.start);
  assert.equal(flightAt(plan,9).position[0],0);assert.deepEqual(flightAt(plan,25).position,plan.flight.end);
});
test('Storm remains full through flight, shrinks continuously through stages and eventually kills at center',async()=>{
  const {createRoyalePlan,zoneAt,royaleState}=await rules(),plan=createRoyalePlan([[0,0,0],[48,0,0]],[0,0,0]);
  assert.equal(royaleState(plan,17).phase,'flight');assert.equal(royaleState(plan,18).phase,'combat');
  assert.equal(zoneAt(plan,18).radius,48);assert.equal(zoneAt(plan,43).radius,48);
  assert.equal(zoneAt(plan,55.5).radius,42);assert.equal(zoneAt(plan,68).radius,36);
  assert.equal(zoneAt(plan,55.5).timeToClose,12.5);assert.equal(zoneAt(plan,55.5).shrinking,true);
  let previous=48;for(let time=0;time<300;time+=.25){const zone=zoneAt(plan,time);assert.ok(zone.radius<=previous+1e-8);assert.ok(zone.radius>=0);previous=zone.radius;}
  assert.equal(zoneAt(plan,300).radius,0);assert.equal(zoneAt(plan,300).damage,40);
  assert.equal(zoneAt(plan,300).timeToClose,0);
});
test('Gliding descends at ten metres per second and lands only on the supplied safe node',async()=>{
  const {advanceGlide}=await rules();
  assert.deepEqual(advanceGlide([1,30,2],[0,0,0],1),{position:[1,20,2],landed:false});
  assert.deepEqual(advanceGlide([1,4,2],[0,0,0],1),{position:[0,2.45,0],landed:true});
});
