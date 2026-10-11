const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ao-profiles-'));
const TOKEN='abcdefghijklmnop1234567890_-ABCD';
test('tokens are validated and hashed, never stored raw',async()=>{
  const M=await import('../server/profiles.mjs');
  for(const bad of [null,undefined,42,{},[],'short','x'.repeat(65),'has space has space 123','bad/chars/bad/chars/1234','ünïcödé-ünïcödé-ünïcödé'])assert.equal(M.validToken(bad),false);
  assert.equal(M.validToken(TOKEN),true);
  const dir=tmp(),file=path.join(dir,'profiles.json'),store=M.createProfileStore({file});
  assert.throws(()=>store.resolve('nope'));const p=store.resolve(TOKEN);assert.equal(p.id,M.hashToken(TOKEN));assert.notEqual(p.id,TOKEN);
  store.flush();assert.ok(!fs.readFileSync(file,'utf8').includes(TOKEN));store.close();
});
test('atomic write: temp file renamed into place, state round-trips',async()=>{
  const M=await import('../server/profiles.mjs'),dir=tmp(),file=path.join(dir,'sub','profiles.json');
  const store=M.createProfileStore({file,debounceMs:5});const p=store.resolve(TOKEN);store.setCallsign(p,'  <b>Thrall</b> ');
  const r=store.applyMatch(p,5000,{kills:7,headshots:3,matches:1});assert.ok(r.levelAfter>1);
  await new Promise(r=>setTimeout(r,60));
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['profiles.json'],'no stray temp file');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(data.version,M.SCHEMA_VERSION);
  const again=M.createProfileStore({file}).resolve(TOKEN);assert.equal(again.xp,5000);assert.equal(again.stats.kills,7);assert.ok(!/[<>]/.test(again.callsign));assert.ok(again.unlocked.includes('extMags'));
  store.close();
});
test('debounce coalesces writes',async()=>{
  const M=await import('../server/profiles.mjs'),dir=tmp(),file=path.join(dir,'p.json'),store=M.createProfileStore({file,debounceMs:30});
  const p=store.resolve(TOKEN);for(let i=0;i<20;i++)store.applyMatch(p,10,{kills:1});
  assert.ok(!fs.existsSync(file));await new Promise(r=>setTimeout(r,120));assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).profiles[p.id].stats.kills,20);store.close();
});
test('corrupt, wrong-schema and oversized files are backed up and the store starts clean',async()=>{
  const M=await import('../server/profiles.mjs');
  for(const [name,content,maxBytes] of [['junk','{not json',4e6],['schema',JSON.stringify({version:99,profiles:{}}),4e6],['big',JSON.stringify({version:1,profiles:{}})+' '.repeat(500),100]]){
    const dir=tmp(),file=path.join(dir,'profiles.json');fs.writeFileSync(file,content);
    const logs=[],store=M.createProfileStore({file,maxBytes,log:m=>logs.push(m)});
    assert.equal(store.size,0,name);assert.ok(!fs.existsSync(file),name);
    const backups=fs.readdirSync(dir).filter(f=>f.startsWith('profiles.json.corrupt-'));assert.equal(backups.length,1,name);assert.equal(fs.readFileSync(path.join(dir,backups[0]),'utf8'),content);
    store.resolve(TOKEN);store.flush();assert.ok(fs.existsSync(file));store.close();
  }
});
test('hostile profile contents are clamped on load',async()=>{
  const M=await import('../server/profiles.mjs'),dir=tmp(),file=path.join(dir,'profiles.json'),id=M.hashToken(TOKEN);
  fs.writeFileSync(file,JSON.stringify({version:1,profiles:{[id]:{xp:-5,callsign:42,stats:{kills:'many',deaths:1e99},unlocked:['__proto__','dsr50_mp',7],title:'title:legend',camo:{primary:'camo:gold'}},'not-an-id':{xp:9}}}));
  const store=M.createProfileStore({file}),p=store.resolve(TOKEN);
  assert.equal(store.size,1);assert.equal(p.xp,0);assert.equal(p.callsign,'Operator');assert.equal(p.stats.kills,0);assert.ok(p.stats.deaths<=1e8);
  assert.ok(p.unlocked.includes('dsr50_mp'));assert.ok(!p.unlocked.includes('__proto__'));assert.equal(p.title,'title:recruit','locked title reset');assert.equal(p.camo.primary,'camo:stock');
  store.close();
});
test('entry cap evicts the least recently seen profile; cosmetics need unlocks',async()=>{
  const M=await import('../server/profiles.mjs');let now=1000;
  const store=M.createProfileStore({maxEntries:3,clock:()=>now});
  const tok=i=>'token'+String(i).padStart(12,'0')+'zzzz';
  for(let i=0;i<4;i++){now+=10;store.resolve(tok(i));}
  assert.equal(store.size,3);assert.equal(store.get(M.hashToken(tok(0))),null);assert.ok(store.get(M.hashToken(tok(3))));
  const p=store.resolve(tok(3));assert.equal(store.setCosmetics(p,{title:'title:legend'}),false);assert.equal(p.title,'title:recruit');
  assert.equal(store.setCosmetics(p,{title:'title:scrapper'}),false);store.applyMatch(p,2000,{});assert.equal(store.setCosmetics(p,{title:'title:scrapper',camo:{primary:'camo:desert'}}),true);assert.equal(p.camo.primary,'camo:desert');
});
