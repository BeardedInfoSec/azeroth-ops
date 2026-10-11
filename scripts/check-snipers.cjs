const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});await require('./test-pointer-lock.cjs')(p);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  // Test-only target fixture: Explore keeps it stationary, using real city cover and damage.
  await p.route('**/src/game.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`
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
  await p.goto('http://127.0.0.1:8097');await p.waitForFunction(()=>window.azeroth?.state.ready,null,{timeout:120000});await p.selectOption('#mode','explore');await p.click('#play');
  const state=()=>p.evaluate(()=>window.azeroth.state);
  for(const [key,name,capacity] of [['6','DSR 50',5],['7','BALLISTA',7]]){
    await p.keyboard.press(key);await p.waitForTimeout(1600);assert.equal((await state()).gun,name);assert.equal((await state()).ammo,capacity);
    await p.screenshot({path:'artifacts/'+key+'-sniper-hip.png'});await p.mouse.down({button:'right'});await p.waitForTimeout(1100);assert.equal((await state()).ads,1);assert.ok((await state()).scope);assert.ok(Math.abs((await state()).fov-15)<.1);
    await p.screenshot({path:'artifacts/'+key+'-sniper-scope.png'});
    await p.mouse.down();await p.waitForTimeout(1650);await p.mouse.up();assert.equal((await state()).ammo,capacity-1,'Holding trigger does not autofire bolt rifle');
    await p.mouse.down();await p.waitForTimeout(100);await p.mouse.up();assert.equal((await state()).ammo,capacity-2);
    await p.keyboard.press('r');await p.waitForTimeout(600);assert.equal((await state()).scope,false);await p.waitForTimeout(3100);assert.equal((await state()).ammo,capacity);await p.mouse.up({button:'right'});
    console.log('PASS',name,'original scope, ADS, bolt gating, reload');
  }
  await p.keyboard.press('1');await p.mouse.down({button:'right'});await p.waitForTimeout(800);await p.screenshot({path:'artifacts/an94-iron-ads.png'});assert.equal((await state()).scope,false);assert.ok(Math.abs((await state()).fov-50)<.1);assert.deepEqual(errors,[]);
  await p.mouse.up({button:'right'});await p.evaluate(()=>document.exitPointerLock());await p.selectOption('#mode','explore');await p.selectOption('#loadout','2');await p.click('#play');await p.evaluate(()=>regression.addScopedTarget());await p.waitForTimeout(100);await p.mouse.down({button:'right'});await p.waitForTimeout(800);
  const s=await state(),target=s.bots[0],dx=target.position[0]-s.position[0],dz=target.position[2]-s.position[2],yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(target.position[1]+target.height*.6-s.position[1],Math.hypot(dx,dz));
  await p.evaluate(({x,y})=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:x,movementY:y})),{x:-Math.atan2(Math.sin(yaw-s.look.yaw),Math.cos(yaw-s.look.yaw))/s.inputSensitivity,y:-(pitch-s.look.pitch)/s.inputSensitivity});
  await p.mouse.down();await p.waitForTimeout(150);await p.mouse.up();assert.equal((await state()).kills,1,'Scoped DSR torso hit eliminates an 80-HP undead');assert.equal((await state()).ammo,4);assert.deepEqual(errors,[]);console.log('PASS scoped sniper shot resolves real character damage');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
