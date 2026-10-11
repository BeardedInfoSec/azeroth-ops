const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const {server}=require('./server.cjs'),{attachMultiplayer}=await import('../server/multiplayer.mjs'),net=attachMultiplayer(server);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await require('./test-pointer-lock.cjs')(page);
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  // Test-only access is appended to the intercepted response, never production source.
  await page.route('**/src/game.js',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,body:source+`\nwindow.survivalTest={get combat(){return combat},player,camera,keys,resetRound,damagePlayer,simulation,get env(){return combat.survival?.environment},get controller(){return combat.survival},THREE,move,pose(position,target){player.fromArray(position);const d=new THREE.Vector3().fromArray(target).sub(player);yaw=Math.atan2(-d.x,-d.z);pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));vertical=0;camera.position.copy(player);camera.rotation.set(pitch,yaw,0);camera.updateMatrixWorld(true);}};`});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>azeroth.state.ready,null,{timeout:120000});
  const state=()=>page.evaluate(()=>azeroth.state);
  async function focus(id){
   await page.evaluate(id=>{const t=survivalTest,item=t.env.interactions.find(i=>i.id===id),p=item.position.clone(),target=item.mesh.position.clone();p.y+=2.45;target.y+=1.7;t.pose(p.toArray(),target.toArray());},id);
   await page.waitForFunction(id=>azeroth.state.survival.focus===id,id,{timeout:5000});
  }
  async function hold(ms=120){await page.keyboard.down('e');await page.waitForTimeout(ms);await page.keyboard.up('e');}
  async function holdUntil(predicate,arg,extra=0){await page.keyboard.down('e');try{await page.waitForFunction(predicate,arg,{timeout:5000});if(extra)await page.waitForTimeout(extra);}finally{await page.keyboard.up('e');await page.waitForFunction(()=>!survivalTest.controller.purchaseHeld);}}
  async function capture(id,path){await page.evaluate(id=>{const t=survivalTest,item=t.env.interactions.find(i=>i.id===id),target=item.mesh.position.clone();target.y+=1.4;t.pose(t.player.toArray(),target.toArray());},id);await page.waitForTimeout(100);await page.screenshot({path});}
  for(const city of ['stormwind','dalaran','darnassus']){
   if((await state()).active)await page.keyboard.press('Escape');await page.selectOption('#mode','undead');await page.click('[data-map="'+city+'"]');await page.waitForFunction(c=>azeroth.state.ready&&azeroth.state.city===c,city,{timeout:120000});await page.click('#play');await page.waitForFunction(()=>azeroth.state.active);
   const initial=await state();assert.equal(initial.survival.points,500);assert.deepEqual(initial.survival.owned,[0]);assert.deepEqual(initial.survival.zones,[0]);assert.ok(initial.survival.queued>0);assert.equal(initial.gun,'AN-94');
   const structure=await page.evaluate(()=>({windows:survivalTest.env.windows.length,gates:survivalTest.env.gates.length,racks:survivalTest.env.weaponBuys.length,huds:document.querySelectorAll('#survival-hud').length}));assert.equal(structure.windows,9);assert.equal(structure.gates,2);assert.equal(structure.racks,3);assert.equal(structure.huds,1);assert.equal(await page.evaluate(()=>survivalTest.env.activeWindows.length),3);
   await page.keyboard.press('2');assert.equal((await state()).gun,'AN-94');await page.waitForFunction(()=>survivalTest.combat.units.some(u=>u.entry),null,{timeout:5000});
   // Observe a real queued zombie attacking boards, then accelerate only the remaining boards.
   await page.waitForFunction(()=>survivalTest.env.activeWindows.some(w=>w.boards<6),null,{timeout:12000});
   const entrant=await page.evaluate(()=>{const t=survivalTest,u=t.combat.units.find(u=>u.entry);t.env.setBoards(u.entry,0);return u.id;});
   await page.waitForFunction(id=>survivalTest.combat.units.some(u=>u.id===id&&!u.entry),entrant,{timeout:6000});
   const beforeHit=(await state()).survival.points;const damage=await page.evaluate(id=>{const t=survivalTest,u=t.combat.units.find(u=>u.id===id);return t.combat.playerShot(u,1,false);},entrant);assert.ok(damage);assert.equal((await state()).survival.points,beforeHit+10);
   // Freeze fixture enemies between input assertions; actual controller ticks continue.
   await page.evaluate(()=>{for(const u of survivalTest.combat.units)u.cooldown=999;survivalTest.combat.spawnDelay=999;});
   const windowId=await page.evaluate(()=>{const t=survivalTest,w=t.env.activeWindows[0];t.env.setBoards(w,5);return w.id;});await focus(windowId);const repairBefore=(await state()).survival.points;await holdUntil(id=>azeroth.state.survival.windows.find(w=>w.id===id).boards===6,windowId);assert.equal((await state()).survival.windows.find(w=>w.id===windowId).boards,6);assert.equal((await state()).survival.points,repairBefore+10);await capture(windowId,'artifacts/survival-window-'+city+'.png');
   const gateId=await page.evaluate(()=>survivalTest.env.gates[0].id);await focus(gateId);await holdUntil(()=>survivalTest.controller.purchaseHeld);assert.deepEqual((await state()).survival.zones,[0]);assert.equal((await state()).survival.points,repairBefore+10);
   const blocked=await page.evaluate(()=>{const t=survivalTest,g=t.env.gates[0],a=g.inside.clone(),b=g.outside.clone();a.y+=2.45;b.y+=2.45;return t.env.isMoveBlocked(a,b,.32);});assert.ok(blocked);
   // Explicit economy fixture: fund purchases without bypassing E interaction or spending rules.
   await page.evaluate(()=>{survivalTest.controller.rules.points=6000;survivalTest.controller.cooldown=0;});await holdUntil(()=>azeroth.state.survival.zones.includes(1));assert.equal((await state()).survival.points,5250);assert.equal(await page.evaluate(()=>survivalTest.env.activeWindows.length),3);
   const open=await page.evaluate(()=>{const t=survivalTest,g=t.env.gates[0],a=g.inside.clone(),b=g.outside.clone();a.y+=2.45;b.y+=2.45;return {open:g.open,blocked:t.env.isMoveBlocked(a,b,.32),traverse:t.env.canTraverse(t.combat.nav.nodes[g.insideNode],t.combat.nav.nodes[g.outsideNode])};});assert.deepEqual(open,{open:true,blocked:false,traverse:true});await capture(gateId,'artifacts/survival-gate-'+city+'.png');
   const rackId=await page.evaluate(()=>survivalTest.env.weaponBuys.find(w=>w.gunIndex===1).id);await focus(rackId);await page.evaluate(()=>survivalTest.controller.cooldown=0);await holdUntil(()=>azeroth.state.survival.owned.includes(1),undefined,1500);assert.equal((await state()).survival.points,4250);assert.ok((await state()).survival.owned.includes(1));assert.equal((await state()).gun,'SCAR-H');
   await page.evaluate(()=>{survivalTest.simulation.ammo=1;survivalTest.simulation.reserve=0;survivalTest.controller.cooldown=0;});await holdUntil(()=>azeroth.state.ammo===30);assert.equal((await state()).survival.points,3850);assert.equal((await state()).ammo,30);assert.ok((await state()).reserve>0);await capture(rackId,'artifacts/survival-rack-'+city+'.png');
   await page.keyboard.press('6');assert.equal((await state()).gun,'SCAR-H');
   // Later-area purchase fixture funds exact price assertions for all wall weapons.
   await page.evaluate(()=>{survivalTest.controller.rules.points=10000;survivalTest.controller.cooldown=0;});
   await focus('weapon-2');await holdUntil(()=>azeroth.state.survival.owned.includes(2));assert.equal((await state()).survival.points,8500);assert.equal((await state()).gun,'DSR 50');
   const gate2=await page.evaluate(()=>survivalTest.env.gates.find(g=>g.level===2).id);await focus(gate2);await page.evaluate(()=>survivalTest.controller.cooldown=0);await holdUntil(()=>azeroth.state.survival.zones.includes(2));assert.equal((await state()).survival.points,7000);assert.equal(await page.evaluate(()=>survivalTest.env.activeWindows.length),3);
   assert.ok(await page.evaluate(()=>{const t=survivalTest,g=t.env.gates.find(g=>g.level===2),a=g.inside.clone(),b=g.outside.clone();a.y+=2.45;b.y+=2.45;return !t.env.isMoveBlocked(a,b,.32)&&t.env.canTraverse(t.combat.nav.nodes[g.insideNode],t.combat.nav.nodes[g.outsideNode]);}));
   await focus('weapon-3');await page.evaluate(()=>survivalTest.controller.cooldown=0);await holdUntil(()=>azeroth.state.survival.owned.includes(3));assert.equal((await state()).survival.points,5250);assert.equal((await state()).gun,'BALLISTA');await capture('weapon-3','artifacts/survival-outer-rack-'+city+'.png');
   await page.keyboard.press('Escape');assert.equal((await state()).active,false);assert.equal((await state()).survival.points,5250);await page.click('#play');assert.equal((await state()).survival.points,5250);
   await page.evaluate(()=>{window.oldSurvival=survivalTest.controller;survivalTest.resetRound();});assert.equal((await state()).survival.points,500);assert.deepEqual((await state()).survival.owned,[0]);assert.ok(await page.evaluate(()=>oldSurvival.environment.group.parent===null&&oldSurvival.environment.windows.length===0&&document.querySelectorAll('#survival-hud').length===1));
   await page.keyboard.press('Escape');await page.selectOption('#mode','explore');await page.click('#play');await page.waitForFunction(()=>azeroth.state.active&&azeroth.state.mode==='explore');assert.equal((await state()).survival,null);assert.equal(await page.locator('#survival-hud').count(),0);
   console.log('PASS',city,'queued breach/entry, repair, restricted weapons, gate spending/collision, all3 wallguns+ammo,3 active perimeter entrances,heldpurchase debounce,pause/reset/disposal');
  }
  assert.deepEqual(errors,[]);console.log('PASS survival browser QA across all cities; no console errors');
 }catch(error){console.error('BROWSER ERRORS',errors);for(const page of browser.contexts().flatMap(c=>c.pages())){console.log(await page.evaluate(()=>azeroth.state));await page.screenshot({path:'artifacts/survival-failure.png'});}throw error;}
 finally{await browser.close();net.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exit(1);});
