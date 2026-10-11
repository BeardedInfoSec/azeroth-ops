const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage({viewport:{width:1440,height:1000}});await require('./test-pointer-lock.cjs')(p);const errors=[];p.on('pageerror',e=>errors.push(e.message));
// Test-only instrumentation. No gameplay cheats are shipped by the server.
await p.route('**/src/game.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+`
window.regression={earnStreak,damagePlayer,camera,hitPoint};
window.regression={...(window.regression||{}),addScopedTarget(){
  const candidates=[];for(const radius of [9,11,13])for(let step=0;step<24;step++){const angle=step*Math.PI/12,floor=floorAt(player.x+Math.sin(angle)*radius,player.z+Math.cos(angle)*radius,player.y+3,10);if(floor)candidates.push(floor.point.clone());}
  const point=candidates.find(point=>{
    const distance=Math.hypot(point.x-player.x,point.z-player.z);
    if(distance<8||distance>14)return false;
    const floor=floorAt(point.x,point.z,player.y+3,10);
    if(!floor||floor.face.normal.y<.7||Math.abs(floor.point.y-point.y)>.1)return false;
    const chest=point.clone().add(new THREE.Vector3(0,1.1,0));
    return !shotBlocked(player,chest,shotCover())&&!shotBlocked(player.clone().add(new THREE.Vector3(0,-.35,0)),chest,shotCover());
  });
  if(!point)throw new Error('No visible city floor for scoped-shot fixture');
  const unit=combat.add('zombie','scourge',point,999,80);unit.actor.animate('idle');unit.actor.update(0);unit.mesh.updateMatrixWorld(true);
}};
`});});
await p.goto('http://127.0.0.1:8097');await p.waitForFunction(()=>window.azeroth?.state.ready,null,{timeout:120000});await p.selectOption('#mode','explore');await p.click('#play');await p.keyboard.press('v');await p.waitForTimeout(500);await p.screenshot({path:'artifacts/head-after.png'});await p.keyboard.press('v');
const state=()=>p.evaluate(()=>azeroth.state);const start=(await state()).look.pitch;await p.mouse.down();await p.waitForTimeout(1800);await p.mouse.up();assert.ok((await state()).ammo<18);assert.equal((await state()).look.pitch,start);await p.waitForTimeout(700);assert.ok((await state()).look.viewKick<.00001);console.log('PASS sustained fire does not accumulate aim drift');
await p.keyboard.press('Escape');await p.selectOption('#mode','factions');await p.click('#play');await p.evaluate(()=>{for(let i=0;i<7;i++)regression.earnStreak();});assert.equal((await state()).streak,0);await p.keyboard.press('3');await p.keyboard.press('5');assert.ok((await state()).uavTime>0);assert.ok((await state()).sentryActive);assert.equal((await state()).rewards.supply,1);await p.evaluate(()=>regression.damagePlayer(1000));const dead=await state();assert.equal(dead.streak,0);assert.deepEqual(dead.rewards,{uav:0,supply:0,sentry:0});assert.equal(dead.uavTime,0);assert.equal(dead.sentryActive,false);await p.waitForFunction(()=>azeroth.state.hp===100,null,{timeout:8000});assert.deepEqual((await state()).rewards,{uav:0,supply:0,sentry:0});console.log('PASS live death clears active effects, stored rewards and respawn progress');
await p.keyboard.press('Escape');await p.selectOption('#mode','explore');await p.selectOption('#loadout','2');await p.click('#play');await p.evaluate(()=>regression.addScopedTarget());await p.waitForTimeout(100);await p.mouse.down({button:'right'});await p.waitForTimeout(800);const s=await state(),target=s.bots[0],dx=target.position[0]-s.position[0],dz=target.position[2]-s.position[2],yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target.position[1]+target.height*.6-s.position[1],Math.hypot(dx,dz));await p.evaluate(({x,y})=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:x,movementY:y})),{x:-Math.atan2(Math.sin(yaw-s.look.yaw),Math.cos(yaw-s.look.yaw))/s.inputSensitivity,y:-(pitch-s.look.pitch)/s.inputSensitivity});
await p.evaluate(()=>{window.markerSamples=[];function sample(){const m=document.getElementById('hitmarker');if(m.style.opacity==='1'){const projected=regression.hitPoint.clone().project(regression.camera),box=m.getBoundingClientRect();markerSamples.push({dx:box.x+box.width/2-(projected.x*.5+.5)*innerWidth,dy:box.y+box.height/2-(-projected.y*.5+.5)*innerHeight,z:Number(getComputedStyle(m).zIndex),scopeZ:Number(getComputedStyle(document.getElementById('scope')).zIndex)});}requestAnimationFrame(sample);}requestAnimationFrame(sample);});await p.mouse.down();await p.waitForTimeout(100);await p.mouse.up();await p.screenshot({path:'artifacts/hitmarker-scoped.png'});await p.waitForTimeout(150);assert.equal((await state()).kills,1);const samples=await p.evaluate(()=>markerSamples);assert.ok(samples.length>0);assert.ok(samples.every(m=>Math.abs(m.dx)<1&&Math.abs(m.dy)<1&&m.z>m.scopeZ));assert.deepEqual(errors,[]);console.log('PASS scoped hit markers track real impact within one pixel and render above scope');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
