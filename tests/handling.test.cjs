const test=require('node:test'),assert=require('node:assert/strict');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
test('Rifle and sniper dispersion is bounded and fully aimed shots are exact',async()=>{
 const {spreadDegrees}=await import('../src/engine/aim.mjs');for(const gun of [{hipSpread:3},{hipSpread:14,bolt:true}]){const cap=gun.bolt?2:.55;assert.equal(spreadDegrees(gun,0),cap);assert.ok(spreadDegrees(gun,0,100)<=cap*1.5);assert.equal(spreadDegrees(gun,1,100),0);assert.ok(spreadDegrees(gun,.5)<cap*.5);}
});
test('Sustained recoil is bounded and returns to aim after release',async()=>{
 const {kickAfterShot,recoverKick}=await import('../src/engine/aim.mjs');let kick=0;for(let i=0;i<300;i++){kick=kickAfterShot(kick,{});assert.ok(kick<=.012);kick=recoverKick(kick,.096);}assert.ok(recoverKick(kick,1)<.000001);
});
test('Imported human includes head-top geometry (bald scalp geoset 1, or a hairstyle geoset 2-99)',skipUnlessAssets('characters/human.json'),()=>{
 const model=require('../public/assets/characters/human.json');const head=model.parts.filter(p=>p.geoset>=1&&p.geoset<100&&p.indices.length>100);assert.ok(head.length>0,'scalp or hair geoset present');assert.ok(Math.max(...head.flatMap(p=>p.indices.map(i=>model.positions[i*3+1])))>2);
});
