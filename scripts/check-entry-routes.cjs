const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const {server}=require('./server.cjs');await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 try{
  await require('./test-pointer-lock.cjs')(page);page.on('pageerror',e=>errors.push(e.stack));
  await page.route('**/src/game.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nwindow.entryTest={get combat(){return combat},get env(){return combat.survival.environment},player,THREE,aim(target){const d=new THREE.Vector3().fromArray(target).sub(player);yaw=Math.atan2(-d.x,-d.z);pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));}};`});});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>azeroth.state.ready,null,{timeout:120000});
  async function walkTo(nodeId){
   const path=await page.evaluate(id=>{const t=entryTest,nav=t.combat.nav,start=nav.nearest(t.player),queue=[start.id],prev=new Map([[start.id,null]]);for(let k=0;k<queue.length&&!prev.has(id);k++)for(const next of nav.nodes[queue[k]].edges)if(!prev.has(next)){prev.set(next,queue[k]);queue.push(next);}if(!prev.has(id))throw Error('No physical ground route to '+id);const result=[];for(let at=id;at!==null;at=prev.get(at))result.unshift(nav.nodes[at].point.toArray());return result;},nodeId);
   for(const point of path){
    let last=Infinity,stalled=0;
    for(let attempt=0;attempt<100;attempt++){
     const distance=await page.evaluate(p=>{const t=entryTest,target=new t.THREE.Vector3().fromArray(p);target.y=t.player.y;t.aim(target.toArray());return Math.hypot(target.x-t.player.x,target.z-t.player.z);},point);
     if(distance<.24)break;
     if(distance>last-.015)stalled++;else stalled=0;
     if(stalled>12||attempt===99)throw Error('WASD route blocked at '+JSON.stringify({point,distance,position:await page.evaluate(()=>entryTest.player.toArray())}));
     last=distance;await page.keyboard.down('w');await page.waitForTimeout(Math.min(130,Math.max(25,distance/5.2*700)));await page.keyboard.up('w');
    }
   }
  }
  for(const city of ['stormwind','dalaran','darnassus']){
   if(await page.evaluate(()=>azeroth.state.active))await page.keyboard.press('Escape');await page.selectOption('#mode','undead');await page.click('[data-map="'+city+'"]');await page.waitForFunction(c=>azeroth.state.ready&&azeroth.state.city===c,city,{timeout:120000});await page.click('#play');
   await page.waitForFunction(()=>entryTest.combat.units.some(u=>u.entry),null,{timeout:8000});
   const entrant=await page.evaluate(()=>{const t=entryTest,u=t.combat.units.find(u=>u.entry);return {id:u.id,entry:u.entry.id,hasPath:!!u.entry.approachPath?.length,hasSpawn:!!u.entry.spawnPoint};});assert.ok(entrant.hasPath&&entrant.hasSpawn);
   await page.waitForFunction(id=>entryTest.env.windows.find(w=>w.id===id).boards<6,entrant.entry,{timeout:12000});
   await page.evaluate(id=>entryTest.env.setBoards(entryTest.env.windows.find(w=>w.id===id),0),entrant.entry);
   await page.waitForFunction(id=>entryTest.combat.units.some(u=>u.id===id&&!u.entry),entrant.id,{timeout:10000});
   // Enemy pressure and funds are isolated fixtures; movement and purchases remain real inputs.
   await page.evaluate(()=>{const t=entryTest;t.combat.spawnDelay=9999;for(const u of t.combat.units)u.stunLeft=9999;t.combat.survival.rules.points=10000;});
   for(const level of [1,2]){
    const gate=await page.evaluate(level=>{const g=entryTest.env.gates.find(g=>g.level===level);return {id:g.id,node:g.insideNode};},level);
    await walkTo(gate.node);
    await page.evaluate(id=>{const g=entryTest.env.gates.find(g=>g.id===id);entryTest.aim(g.mesh.position.clone().add(new entryTest.THREE.Vector3(0,1.7,0)).toArray());},gate.id);
    await page.waitForFunction(id=>azeroth.state.survival.focus===id,gate.id,{timeout:5000});
    await page.keyboard.down('e');try{await page.waitForFunction(level=>azeroth.state.survival.zones.includes(level),level,{timeout:5000});}finally{await page.keyboard.up('e');}
    assert.equal(await page.evaluate(()=>entryTest.env.activeWindows.length),3);
    assert.ok(await page.evaluate(level=>entryTest.env.windows.filter(w=>w.zone<level).every(w=>w.retired),level));
    await walkTo(await page.evaluate(id=>entryTest.env.gates.find(g=>g.id===id).outsideNode,gate.id));
    console.log('PASS',city,'real W traversal and E gate',level);
   }
   await page.screenshot({path:'artifacts/entry-route-'+city+'.png'});
   console.log('PASS',city,'physical concealed approach, breach, release and both expanded areas');
  }
  assert.deepEqual(errors,[]);
 }catch(error){console.error('PAGE ERRORS',errors);console.error(JSON.stringify(await page.evaluate(()=>({city:azeroth.state.city,player:azeroth.state.position,hp:azeroth.state.hp,units:entryTest.combat.units.map(u=>({id:u.id,position:u.mesh.position.toArray(),entry:u.entry?.id,approachIndex:u.entryApproachIndex,releaseIndex:u.entryReleaseIndex,boards:u.entry?.boards,approach:u.entry?.approachPath?.map(p=>p.toArray()),release:u.entry?.releasePath?.map(p=>p.toArray())}))})),null,2));await page.screenshot({path:'artifacts/entry-route-failure.png'});throw error;}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1);});
