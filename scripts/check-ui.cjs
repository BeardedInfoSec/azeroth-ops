const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 const {server}=require('./server.cjs'),{attachMultiplayer}=await import('../server/multiplayer.mjs');
 const net=attachMultiplayer(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1366,height:768}});await require('./test-pointer-lock.cjs')(page);
  page.on('pageerror',error=>errors.push(error.stack));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>azeroth.state.ready,null,{timeout:120000});
  for(const size of [{width:1366,height:768},{width:1440,height:1000},{width:900,height:900}]){
   await page.setViewportSize(size);const tag=size.width+'x'+size.height;
   if(await page.locator('#multiplayer-panel').isVisible())await page.click('#lobby-close');
   await page.screenshot({path:'artifacts/ui-home-'+tag+'.png'});
   await page.click('#lobby-open');
   for(const view of ['play','classes','operator']){
    const nav=page.locator('.lobby-nav [data-lobby-view="'+view+'"]');await nav.focus();await page.keyboard.press('Enter');
    assert.equal(await nav.getAttribute('aria-selected'),'true');assert.ok(await page.locator('#lobby-'+view+'-view').isVisible());
    for(const other of ['play','classes','operator'].filter(name=>name!==view))assert.equal(await page.locator('#lobby-'+other+'-view').isVisible(),false);
    const focus=await nav.evaluate(el=>{const s=getComputedStyle(el);return document.activeElement===el&&(s.outlineStyle!=='none'||s.boxShadow!=='none');});assert.ok(focus,'Keyboard focus must be visible on '+view);
    if(view==='classes'){
     const card=page.locator('[data-class-slot="2"]');await card.focus();await page.keyboard.press('Enter');
     assert.equal(await page.locator('[data-class-slot="2"]').getAttribute('aria-pressed'),'true');assert.equal(await page.inputValue('#class-slot'),'2');
     assert.equal(await page.evaluate(()=>document.activeElement?.dataset.classSlot),'2','Selecting a class must retain keyboard focus');
     assert.equal(await page.locator('[data-class-slot]').count(),5);assert.equal(await page.locator('.weapon-card').count(),2);
    }
    const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth+1,panel:document.getElementById('multiplayer-panel').scrollWidth>document.getElementById('multiplayer-panel').clientWidth+1}));assert.deepEqual(overflow,{document:false,panel:false},tag+' '+view+' horizontal overflow');
    await page.screenshot({path:'artifacts/ui-'+view+'-'+tag+'.png'});
   }
   console.log('PASS keyboard navigation, class cards and layout at',tag);
  }
  // Check explicit opaque control colors. Transparent glass surfaces need visual review.
  const contrast=await page.evaluate(()=>{
   const rgb=value=>value.match(/[\d.]+/g)?.map(Number),luminance=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),results=[];
   for(const el of document.querySelectorAll('#multiplayer-panel button,#multiplayer-panel input,#multiplayer-panel select')){
    if(!el.getClientRects().length||el.disabled)continue;const style=getComputedStyle(el),fg=rgb(style.color),bg=rgb(style.backgroundColor);if(!fg||!bg||(bg[3]??1)<1)continue;
    const a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);results.push({control:el.id||el.textContent.trim(),ratio:Math.round(ratio*100)/100});
   }return results;
  });
  assert.ok(contrast.length>0,'Expected opaque controls for basic contrast check');assert.deepEqual(contrast.filter(item=>item.ratio<4.5),[],'Control text contrast');assert.deepEqual(errors,[]);
  console.log('PASS basic opaque-control text contrast and no console errors',JSON.stringify(contrast));
  await page.click('#lobby-close');await page.selectOption('#mode','explore');await page.selectOption('#loadout','0');
  let savedAmmo;
  for(const action of ['deploy','resume']){
   await page.click('#play');await page.waitForFunction(()=>azeroth.state.active);
   assert.equal(await page.locator('#menu').isVisible(),false,action+': home must not intercept gameplay');
   assert.equal(await page.locator('#multiplayer-panel').isVisible(),false,action+': lobby must not intercept gameplay');
   assert.ok(await page.locator('#hud').isVisible());
   if(action==='resume')assert.equal(await page.evaluate(()=>azeroth.state.ammo),savedAmmo,'Resume must retain ammunition rather than redeploy');
   const before=await page.evaluate(()=>azeroth.state.ammo);
   // A real Playwright canvas click must reach the game, not an invisible menu.
   await page.locator('#game').click({position:{x:450,y:450},delay:90});
   await page.waitForFunction(ammo=>azeroth.state.ammo<ammo,before);
   savedAmmo=await page.evaluate(()=>azeroth.state.ammo);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!azeroth.state.active&&document.pointerLockElement===null);
   assert.ok(await page.locator('#menu').isVisible());assert.equal(await page.locator('#multiplayer-panel').isVisible(),false);
  }
  assert.deepEqual(errors,[]);console.log('PASS solo deploy/resume, hidden menus, real canvas firing, preserved ammunition and Escape release');
 }finally{await browser.close();net.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exit(1);});
