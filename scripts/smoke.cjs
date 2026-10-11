const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  fs.mkdirSync('artifacts',{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await require('./test-pointer-lock.cjs')(page);
  const errors=[],reports=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const state=()=>page.evaluate(()=>window.azeroth.state);
  async function pause(){await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>!window.azeroth.state.active);}
  async function deploy(){await page.click('#play');await page.waitForFunction(()=>window.azeroth.state.active);await page.waitForTimeout(350);}
  async function aimAt(unit){
    const s=await state(),b=s.bots.find(b=>b.id===unit.id);if(!b?.alive)return;
    const p=s.position,dx=b.position[0]-p[0],dz=b.position[2]-p[2],yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(b.position[1]+b.height*.68-p[1],Math.hypot(dx,dz));
    const dyaw=Math.atan2(Math.sin(yaw-s.look.yaw),Math.cos(yaw-s.look.yaw));
    await page.evaluate(({x,y})=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:x,movementY:y})),{x:-dyaw/s.inputSensitivity,y:-(pitch-s.look.pitch)/s.inputSensitivity});
  }
  async function eliminate(unit){
    await page.mouse.down({button:"right"});await page.waitForTimeout(600);
    for(let i=0;i<12;i++){
      if(!(await state()).bots.find(b=>b.id===unit.id)?.alive){await page.mouse.up({button:'right'});return;}
      if((await state()).ammo===0){await page.keyboard.press('r');await page.waitForTimeout(3250);}
      await aimAt(unit);await page.mouse.down();await page.waitForTimeout(220);await page.mouse.up();
    }
    await page.mouse.up({button:'right'});
    assert.equal((await state()).bots.find(b=>b.id===unit.id)?.alive,false,'Hits eliminate '+unit.race);
  }
  try{
    await page.goto('http://127.0.0.1:8097');await page.waitForFunction(()=>window.azeroth?.state.ready&&window.azeroth.state.charactersReady,null,{timeout:120000});
    for(const [faction,races] of Object.entries({alliance:['human','dwarf','nightelf','gnome','draenei'],horde:['orc','forsaken','tauren','troll','bloodelf']})){
      await page.selectOption('#faction',faction);assert.deepEqual(await page.locator('#race option').evaluateAll(options=>options.map(o=>o.value)),races);
      for(const race of races){await page.selectOption('#race',race);assert.equal((await state()).race,race);}
    }
    await page.selectOption('#faction','alliance');await page.screenshot({path:'artifacts/v2-menu.png'});
    console.log('PASS all 10 operator selections and faction restrictions');
    for(const city of ['stormwind','dalaran','darnassus']){
      if((await state()).active)await pause();
      if(city!=='stormwind'){await page.click(`[data-map="${city}"]`);await page.waitForFunction(c=>window.azeroth.state.ready&&window.azeroth.state.city===c,city,{timeout:120000});}
      await page.selectOption('#mode','undead');await deploy();
      const before=await state();assert.equal(before.survival.points,500);assert.deepEqual(before.survival.owned,[0]);assert.deepEqual(before.survival.zones,[0]);assert.equal(before.gun,'AN-94');
      assert.equal(before.survival.queued+before.bots.length,8);assert.ok(before.survival.queued>0);assert.ok(before.grounded);assert.ok(before.navNodes>20);
      await page.keyboard.press('2');assert.equal((await state()).gun,'AN-94','Unpurchased weapons stay locked');
      await page.waitForFunction(()=>window.azeroth.state.bots.length>0,null,{timeout:10000});
      const entering=await state();assert.ok(entering.bots.every(b=>b.faction==='scourge'));
      const first=entering.bots[0],entry=entering.survival.windows.reduce((best,w)=>Math.hypot((w.spawnPoint||w.outside)[0]-first.position[0],(w.spawnPoint||w.outside)[2]-first.position[2])<Math.hypot((best.spawnPoint||best.outside)[0]-first.position[0],(best.spawnPoint||best.outside)[2]-first.position[2])?w:best);
      assert.ok(Math.hypot(first.position[0]-(entry.spawnPoint||entry.outside)[0],first.position[2]-(entry.spawnPoint||entry.outside)[2])<.8,'Undead arrive at a barricaded entrance');
      await page.waitForFunction(id=>window.azeroth.state.survival.windows.find(w=>w.id===id).boards<6,entry.id,{timeout:10000});
      await page.waitForFunction(id=>window.azeroth.state.survival.windows.find(w=>w.id===id).boards===0,entry.id,{timeout:15000});
      await page.waitForFunction(({id,outside})=>{const b=window.azeroth.state.bots.find(b=>b.id===id);return b&&Math.hypot(b.position[0]-outside[0],b.position[2]-outside[2])>3;},{id:first.id,outside:entry.outside},{timeout:20000});
      const moved=await state(),target=moved.bots.find(b=>b.id===first.id);
      assert.ok(target.alive,'Released undead remains alive before player fire');
      await eliminate(target);const killed=await state();assert.ok(killed.kills>0);assert.ok(killed.survival.points>=610,'Real weapon hits and elimination award survival points');
      assert.equal(killed.bots.find(b=>b.id===target.id).animation,'death','Eliminated undead plays death animation');
      await page.keyboard.press('r');await page.waitForFunction(()=>azeroth.state.reloadLeft===0&&azeroth.state.ammo===30,null,{timeout:10000});assert.equal((await state()).ammo,30);
      const reserve=(await state()).reserve;await page.keyboard.press('2');assert.equal((await state()).gun,'AN-94');assert.equal((await state()).ammo,30);await page.keyboard.press('1');assert.equal((await state()).reserve,reserve);
      await page.screenshot({path:`artifacts/v2-${city}-undead.png`});
      console.log('PASS',city,'queued survival, natural barricade breach, released movement, weapon kill, points and reload');
      await pause();await page.selectOption('#mode','factions');await page.selectOption('#faction',city==='dalaran'?'alliance':'horde');await page.selectOption('#race',city==='dalaran'?'gnome':'tauren');await deploy();
      const faction=await state();assert.equal(faction.bots.length,9);assert.equal(faction.bots.filter(b=>b.faction===faction.faction).length,4);assert.equal(faction.bots.filter(b=>b.faction!==faction.faction).length,5);assert.equal(new Set(faction.bots.map(b=>b.race)).size,9);
      await page.keyboard.press('v');await page.waitForTimeout(250);assert.ok((await state()).thirdPerson);await page.screenshot({path:`artifacts/v2-${city}-factions.png`});await page.keyboard.press('v');
      await pause();const frozen=await state();await page.waitForTimeout(250);assert.deepEqual((await state()).bots,frozen.bots,'Pause freezes both teams');
      reports.push({city,navNodes:before.navNodes,waveSize:8,survivalPoints:killed.survival.points,factionCombatants:10});console.log('PASS',city,'undead and faction modes');
    }
    await page.selectOption('#mode','explore');await deploy();assert.equal((await state()).bots.length,0);
    const y=(await state()).position[1];await page.keyboard.press('Space');await page.waitForTimeout(200);assert.ok((await state()).position[1]>y+.4);await page.waitForTimeout(900);
    await pause();await page.click('#restart');await page.waitForFunction(()=>window.azeroth.state.active);assert.equal((await state()).hp,100);
    await page.keyboard.press('Escape');assert.equal((await state()).active,false,'Escape releases mouse capture');
    await deploy();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state()).active,false,'Losing focus releases mouse capture');
    assert.deepEqual(errors,[]);fs.writeFileSync('artifacts/smoke-results.json',JSON.stringify({passed:true,reports,errors},null,2));console.log('PASS exploration, jumping, restart, no browser errors');
  }catch(e){console.log('FAIL STATE',JSON.stringify(await state()));await page.screenshot({path:'artifacts/smoke-failure.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
