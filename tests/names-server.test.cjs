// Server-authoritative callsign rules over real WebSockets (stub arena, fake clock, CPU only).
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await delay(10);}throw Error('Timed out');};
async function fixture({store=null}={}){
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),T=await import('three'),{createProfileStore}=await import('../server/profiles.mjs');
  let now=500000;const spawns=[];for(let x=-40;x<=40;x+=2)for(let z=-40;z<=40;z+=2)spawns.push(new T.Vector3(x,0,z));
  const arena={origin:new T.Vector3(0,2.45,0),spawns,trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3(),floorAt:(x,z)=>({point:new T.Vector3(x,0,z)}),spawn:()=>[0,2.45,0]};
  const profiles=store||createProfileStore();
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false,profiles});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const players=[];
  async function step(ms=50){now+=ms;net.tick();await delay(10);}
  async function connect(profile={},{token=null}={}){
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),p={ws,messages:[],send:m=>ws.send(JSON.stringify(m)),last:type=>[...p.messages].reverse().find(m=>m.type===type)};
    players.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='welcome')p.id=m.id;if(m.type==='room')p.room=m.room;});
    await wait(()=>p.id);if(token){p.send({type:'hello',token});await wait(()=>p.last('profile'));}
    if(profile!==null)p.send({type:'profile',team:'alliance',race:'human',loadout:{primary:2,secondary:0},...profile});
    return p;
  }
  const tokenFor=n=>'token-'+String(n).padStart(2,'0')+'-abcdefghijklmnopqrstuvwxyz';
  const client=p=>net.clients.get(p.id);
  async function close(){for(const p of players)p.ws.terminate();net.close();await new Promise(r=>server.close(r));}
  return {net,players,connect,step,close,client,tokenFor,profiles,advance:ms=>{now+=ms;},now:()=>now};
}

test('a valid callsign and clan tag are accepted, normalised and echoed in room messages',async()=>{
  const f=await fixture();try{
    const a=await f.connect({name:'  Bravo   One  ',tag:'wow'});await wait(()=>f.client(a).nameSet);
    assert.equal(f.client(a).name,'Bravo One');assert.equal(f.client(a).tag,'WOW');
    a.send({type:'create',mode:'tdm'});await wait(()=>a.room);
    const me=a.room.players.find(p=>p.id===a.id);assert.equal(me.name,'Bravo One');assert.equal(me.tag,'WOW');assert.equal(me.bot,false);
    assert.ok(a.last('callsign').ok!==false||a.last('callsign')===undefined);
  }finally{await f.close();}
});

test('invalid, hostile and reserved names are refused and the previous callsign stays',async()=>{
  const f=await fixture();try{
    const a=await f.connect({name:'Alpha'});await wait(()=>f.client(a).nameSet);
    // Spend the free first change so the later attempts exercise validation, not the cooldown.
    a.send({type:'profile',name:'Alpha One'});await wait(()=>f.client(a).name==='Alpha One');
    const hostile=['ab','x'.repeat(17),'x'.repeat(5000),'_Bad','Bad_','<b>Bob</b>','Al​pha','‮Alpha','Al\u0000pha','Alpha\nBeta','Аlpha','Admin','bot','System','Server','Gruntling','😀 Alpha','Alpha;DROP',7,{x:1},['Alpha'],true];
    for(const bad of hostile){
      const before=a.messages.length;a.send({type:'profile',name:bad});await wait(()=>a.messages.length>before&&a.messages.slice(before).some(m=>m.type==='callsign'));
      const reply=a.messages.slice(before).find(m=>m.type==='callsign');
      assert.equal(reply.ok,false,'rejected '+JSON.stringify(bad).slice(0,40));assert.ok(reply.reason);assert.equal(f.client(a).name,'Alpha One');
    }
    // Tags are validated too.
    for(const tag of ['a','abcde','a b','<b>','BOT','​ab',9]){a.send({type:'profile',tag});await delay(15);assert.equal(f.client(a).tag,'',JSON.stringify(tag));}
    assert.equal(f.client(a).baseName,'Alpha One');
  }finally{await f.close();}
});

test('a first callsign that fails validation falls back to Operator NNN with an explanation',async()=>{
  const f=await fixture();try{
    const a=await f.connect({name:'‮Evil'});await wait(()=>f.client(a).nameSet);
    assert.match(f.client(a).name,/^Operator [1-9]\d\d$/);const reply=a.last('callsign');assert.match(reply.notice,/default callsign/);
  }finally{await f.close();}
});

test('profanity is replaced by Operator NNN and the user is told',async()=>{
  const f=await fixture();try{
    const bad='sh'+'it'+'lord',a=await f.connect({name:'Clean'});await wait(()=>f.client(a).nameSet);
    a.send({type:'profile',name:bad});await wait(()=>f.client(a).name!=='Clean');
    assert.match(f.client(a).name,/^Operator \d{3}$/);assert.match(a.last('callsign').notice,/not allowed/);
    const tagBad='na'+'zi';a.send({type:'profile',tag:tagBad});await delay(20);assert.equal(f.client(a).tag,'');
  }finally{await f.close();}
});

test('names are unique per room, case-insensitively, with a numeric suffix',async()=>{
  const f=await fixture();try{
    const a=await f.connect({name:'Same'}),b=await f.connect({name:'SAME'}),c=await f.connect({name:'same'});
    await wait(()=>[a,b,c].every(p=>f.client(p).nameSet));
    a.send({type:'create',mode:'tdm'});await wait(()=>a.room);
    b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    c.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===3);
    assert.deepEqual(a.room.players.map(p=>p.name),['Same','SAME (2)','same (3)']);
    // Leaving restores the plain callsign; a re-join gets the next free suffix.
    b.send({type:'leave'});await wait(()=>a.room.players.length===2);assert.equal(f.client(b).name,'SAME');
    b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===3);assert.ok(a.room.players.some(p=>p.name==='SAME (2)'));
    // A rename into a taken name is suffixed rather than refused.
    c.send({type:'profile',name:'sAmE'});await wait(()=>a.room.players.some(p=>p.id===c.id&&/\(\d\)$/.test(p.name)));
    const names=a.room.players.map(p=>p.name.toLowerCase());assert.equal(new Set(names).size,names.length);
  }finally{await f.close();}
});

test('renames are rate limited to one per 10 s (the first change is free) and locked during a match',async()=>{
  const f=await fixture();try{
    const a=await f.connect({name:'Alice'}),b=await f.connect({name:'Bobby'});await wait(()=>[a,b].every(p=>f.client(p).nameSet));
    a.send({type:'create',mode:'tdm'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    b.send({type:'profile',team:'horde',race:'orc'});await wait(()=>f.client(b).team==='horde');
    a.send({type:'profile',name:'Alice Two'});await wait(()=>f.client(a).name==='Alice Two');   // free
    a.send({type:'profile',name:'Alice Three'});await wait(()=>a.messages.some(m=>m.type==='callsign'&&/Wait/.test(m.reason||'')));
    assert.equal(f.client(a).name,'Alice Two');
    f.advance(5000);a.send({type:'profile',name:'Alice Three'});await delay(40);assert.equal(f.client(a).name,'Alice Two','still inside the 10 s window');
    f.advance(5100);a.send({type:'profile',name:'Alice Three'});await wait(()=>f.client(a).name==='Alice Three');
    // Re-sending the same name is a no-op, not a rename.
    a.send({type:'profile',name:'Alice Three'});await delay(30);
    // Locked while a match is running.
    f.advance(11000);
    for(const p of [a,b])p.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});
    await wait(()=>a.room.phase==='loading'&&a.room.layoutRevision);for(const p of [a,b])p.send({type:'loaded',code:a.room.code,loadGeneration:a.room.loadGeneration,layoutRevision:a.room.layoutRevision});
    await wait(()=>[a,b].every(p=>f.client(p).loaded));await f.step();await f.step(3100);assert.equal(a.room.phase,'playing');
    const before=a.messages.length;a.send({type:'profile',name:'Mid Match'});await wait(()=>a.messages.slice(before).some(m=>m.type==='callsign'));
    assert.match(a.messages.slice(before).find(m=>m.type==='callsign').reason,/locked during a match/);assert.equal(f.client(a).name,'Alice Three');
    // Between matches it is allowed again.
    const room=f.net.rooms.get(a.room.code);room.score.alliance=room.target-1;f.client(a).protectedUntil=f.client(b).protectedUntil=0;
    f.net.rooms.get(a.room.code).phase='ended';await f.step();
    a.send({type:'profile',name:'After Match'});await wait(()=>f.client(a).name==='After Match');
    a.send({type:'return'});await wait(()=>a.room.phase==='waiting');
  }finally{await f.close();}
});

test('callsign and tag persist to the profile and come back in profile and room messages',async()=>{
  const f=await fixture();try{
    const token=f.tokenFor(1),a=await f.connect({name:'Persisted',tag:'ab'},{token});await wait(()=>f.client(a).nameSet);
    await wait(()=>a.messages.filter(m=>m.type==='profile').some(m=>m.profile.callsign==='Persisted'));
    const echo=a.last('profile').profile;assert.equal(echo.callsign,'Persisted');assert.equal(echo.tag,'AB');
    const stored=f.profiles.get(f.client(a).profile.id);assert.equal(stored.callsign,'Persisted');assert.equal(stored.tag,'AB');
    a.send({type:'create',mode:'tdm'});await wait(()=>a.room);assert.equal(a.room.players[0].tag,'AB');
    // A fresh connection with the same token and no name in its first message resumes the saved callsign.
    a.ws.terminate();await wait(()=>!f.net.clients.has(a.id));
    const b=await f.connect(null,{token});b.send({type:'create',mode:'tdm'});await wait(()=>b.room);
    assert.equal(b.room.players[0].name,'Persisted');assert.equal(b.room.players[0].tag,'AB');
    // Rejected names never reach the store.
    b.send({type:'profile',name:'Adm'+'in'});await delay(30);assert.equal(f.profiles.get(f.client(b).profile.id).callsign,'Persisted');
  }finally{await f.close();}
});

test('stored profile callsigns are re-validated on load and cannot smuggle markup',async()=>{
  const {cleanProfile,publicProfile}=await import('../server/profiles.mjs');
  const id='0'.repeat(32);
  assert.equal(cleanProfile({callsign:'<img src=x>',tag:'<b>'},id).callsign,'Operator');
  assert.equal(cleanProfile({callsign:'Good Name',tag:'xy'},id).tag,'XY');
  assert.equal(cleanProfile({callsign:'‮Evil',tag:'ok'},id).callsign,'Operator');
  assert.equal(cleanProfile({callsign:'Admin',tag:'bot'},id).tag,'');
  assert.equal(publicProfile(cleanProfile({callsign:'Good Name',tag:'ab'},id)).tag,'AB');
});
