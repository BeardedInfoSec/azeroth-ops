// README screenshots. One isolated server, one headless window, strictly sequential.
// The pointer-lock shim is installed before navigation (see AGENTS.md).
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.AO_PROFILES=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ao-shots-')),'profiles.json');
const out=path.join(__dirname,'..','docs','screenshots');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const {server}=require('./server.cjs'),{attachMultiplayer}=await import('../server/multiplayer.mjs'),net=attachMultiplayer(server);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],done=[];
  const shot=async(page,name)=>{await page.screenshot({path:path.join(out,name+'.png')});done.push(name);console.log('saved',name);};
  try{
    const page=await browser.newPage({viewport:{width:1600,height:900}});await require('./test-pointer-lock.cjs')(page);
    page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>window.azeroth?.state.ready,null,{timeout:180000});await page.waitForTimeout(800);
    await shot(page,'01-main-menu');
    await page.click('#lobby-open');
    for(const [view,name] of [['play','02-lobby'],['classes','03-armory'],['operator','04-operator']]){
      await page.locator('.lobby-nav [data-lobby-view="'+view+'"]').click();await page.waitForTimeout(700);await shot(page,name);
    }
    await page.click('#lobby-close');await page.waitForTimeout(400);
    // Zombies in Stormwind, first then third person.
    await page.selectOption('#mode','undead');await page.click('#play');
    await page.waitForFunction(()=>window.azeroth.state.active,null,{timeout:180000});await page.waitForTimeout(3500);
    await shot(page,'05-zombies-first-person');
    await page.keyboard.press('v');await page.waitForTimeout(900);await shot(page,'06-zombies-third-person');
    // Battle Royale: aboard the Horde zeppelin, then gliding.
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.azeroth.state.active);
    await page.selectOption('#mode','royale');await page.click('#play');
    await page.waitForFunction(()=>window.azeroth.state.active&&window.azeroth.state.deployment==='aboard',null,{timeout:180000});
    await page.keyboard.press('v');await page.waitForTimeout(2500);await shot(page,'07-royale-zeppelin');
    await page.keyboard.press('Space');await page.waitForFunction(()=>window.azeroth.state.deployment==='gliding',null,{timeout:10000});
    await page.waitForTimeout(2500);await shot(page,'08-royale-glide');
  }catch(error){console.error('capture stopped after',done.join(', '),'\n',error.message);process.exitCode=1;}
  finally{if(errors.length)console.log('browser errors:',errors.slice(0,5));await browser.close();net.close();await new Promise(r=>server.close(r));}
})();
