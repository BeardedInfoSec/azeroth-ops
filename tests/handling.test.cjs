const test=require('node:test'),assert=require('node:assert/strict');
test('Rifle and sniper dispersion is bounded and fully aimed shots are exact',async()=>{
 const {spreadDegrees}=await import('../src/engine/aim.mjs');for(const gun of [{hipSpread:3},{hipSpread:14,bolt:true}]){const cap=gun.bolt?2:.55;assert.equal(spreadDegrees(gun,0),cap);assert.ok(spreadDegrees(gun,0,100)<=cap*1.5);assert.equal(spreadDegrees(gun,1,100),0);assert.ok(spreadDegrees(gun,.5)<cap*.5);}
});
test('Sustained recoil is bounded and returns to aim after release',async()=>{
 const {kickAfterShot,recoverKick}=await import('../src/engine/aim.mjs');let kick=0;for(let i=0;i<300;i++){kick=kickAfterShot(kick,{});assert.ok(kick<=.012);kick=recoverKick(kick,.096);}assert.ok(recoverKick(kick,1)<.000001);
});
test('Imported bald human includes the original scalp geometry',()=>{
 const model=require('../public/assets/characters/human.json');const scalp=model.parts.find(p=>p.geoset===1);assert.ok(scalp?.indices.length>100);assert.ok(Math.max(...scalp.indices.map(i=>model.positions[i*3+1]))>2);
});
