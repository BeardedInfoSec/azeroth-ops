const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await delay(10);}throw Error('Timed out');};
const TOKEN_A='sessionAlpha_0123456789-abcdef',TOKEN_B='sessionBravo_0123456789-abcdef';
async function fixture(options={}){
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),{createProfileStore}=await import('../server/profiles.mjs'),T=await import('three'),{PLAYER_EYE_HEIGHT}=await import('../src/player-config.js');
  let now=100000;const spawns=[];for(let x=-40;x<=40;x+=2)for(let z=-40;z<=40;z+=2)spawns.push(new T.Vector3(x,0,z));
  const arena={origin:new T.Vector3(0,PLAYER_EYE_HEIGHT,0),spawns,trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3(),floorAt:(x,z)=>({point:new T.Vector3(x,0,z)}),spawn:()=>[0,PLAYER_EYE_HEIGHT,0]};
  const profiles=createProfileStore(),server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false,profiles,...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const sockets=[];
  async function step(ms=50){now+=ms;net.tick();await delay(10);}
  async function connect(token,{name='P',team,race}={}){
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),p={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};sockets.push(ws);
    ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='welcome'){p.id=m.id;p.resumed=!!m.resumed;}if(m.type==='room')p.room=m.room;if(m.type==='profile')p.profile=m.profile;if(m.type==='left')p.room=null;});
    await wait(()=>p.id);if(token)p.send({type:'hello',token});p.send({type:'profile',name,team,race});return p;
  }
  async function match(a,b){
    a.send({type:'create'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    for(const p of [a,b])p.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});
    await wait(()=>a.room.phase==='loading'&&[a,b].every(p=>p.room.layoutRevision));
    for(const p of [a,b])p.send({type:'loaded',code:p.room.code,loadGeneration:p.room.loadGeneration,layoutRevision:p.room.layoutRevision});
    const room=net.rooms.get(a.room.code);await wait(()=>room.arena&&room.members.every(id=>net.clients.get(id).loaded));await step();await step(3001);assert.equal(room.phase,'playing');return room;
  }
  async function close(){for(const ws of sockets)ws.terminate();net.close();await new Promise(r=>server.close(r));}
  return {net,connect,match,step,close,profiles};
}

test('hello creates a profile and sends it; raw token is never exposed',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A);await wait(()=>a.profile);assert.equal(a.profile.level,1);assert.equal(a.profile.rank,'Peon');
    assert.ok(!JSON.stringify(a.messages).includes(TOKEN_A));assert.ok(!f.net.sessions.has(TOKEN_A));
    const server=f.net.clients.get(a.id);assert.ok(server.sessionId&&server.sessionId!==TOKEN_A);
  }finally{await f.close();}
});
test('hostile or oversized tokens are rejected without a session',async()=>{
  const f=await fixture();try{
    const a=await f.connect(null);
    for(const token of ['short','x'.repeat(65),'x'.repeat(5000),'bad token with spaces 1234567890',{a:1},[TOKEN_A],null,42]){
      const before=a.messages.filter(m=>m.type==='error').length;a.send({type:'hello',token});await wait(()=>a.messages.filter(m=>m.type==='error').length>before);
    }
    assert.equal(f.net.sessions.size,0);assert.equal(f.net.clients.get(a.id).sessionId,undefined);
    a.ws.send('x'.repeat(9000));await wait(()=>a.ws.readyState===WebSocket.CLOSED);
  }finally{await f.close();}
});
test('a concurrent second socket with the same token is refused, even mid-match',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'A'}),b=await f.connect(TOKEN_A,{name:'Thief'});
    await wait(()=>b.messages.some(m=>m.type==='error'&&/already connected/.test(m.message)));
    assert.equal(f.net.sessions.size,1);assert.equal(f.net.clients.get(b.id).sessionId,undefined);assert.equal(a.ws.readyState,WebSocket.OPEN);assert.ok(!b.profile);
    const c=await f.connect(TOKEN_B,{name:'B',team:'horde',race:'orc'});const room=await f.match(a,c);
    const thief=await f.connect(TOKEN_A);await wait(()=>thief.messages.some(m=>m.type==='error'));assert.equal(room.members.includes(thief.id),false);assert.equal(f.net.clients.get(a.id).ws.readyState,WebSocket.OPEN);
  }finally{await f.close();}
});
test('a dropped player resumes room, slot and state within 60 seconds',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'}),b=await f.connect(TOKEN_B,{name:'Bravo',team:'horde',race:'orc'});const room=await f.match(a,b);
    const pa=f.net.clients.get(a.id);pa.kills=3;pa.position=[5,pa.position[1],6];room.score.alliance=3;pa.weapon.select(1);
    a.ws.terminate();await wait(()=>pa.dropped);
    assert.ok(f.net.clients.has(a.id));assert.ok(room.members.includes(a.id));await f.step(30000);assert.ok(room.members.includes(a.id));
    const a2=await f.connect(TOKEN_A);
    await wait(()=>a2.resumed);assert.equal(a2.id,a.id);await wait(()=>a2.room?.phase==='playing');
    assert.equal(pa.dropped,false);assert.equal(pa.kills,3);assert.equal(pa.position[0],5);assert.equal(pa.weapon.index,1);assert.equal(a2.room.score.alliance,3);
    assert.equal(f.net.clients.size,2,'placeholder socket client removed');assert.equal(a2.room.players.find(p=>p.id===a.id).kills,3);
    await f.step(70000);assert.ok(room.members.includes(a.id),'no expiry after resuming');
  }finally{await f.close();}
});
test('the seat expires after 60 seconds and the player is removed',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'}),b=await f.connect(TOKEN_B,{name:'Bravo',team:'horde',race:'orc'});const room=await f.match(a,b);
    a.ws.terminate();await wait(()=>f.net.clients.get(a.id)?.dropped);
    await f.step(59000);assert.ok(room.members.includes(a.id));
    await f.step(1100);assert.ok(!room.members.includes(a.id));assert.ok(!f.net.clients.has(a.id));assert.equal(f.net.sessions.size,1);
    await wait(()=>b.room.players.length===1);
    const late=await f.connect(TOKEN_A);await wait(()=>late.profile);assert.notEqual(late.id,a.id);assert.ok(!late.resumed);
  }finally{await f.close();}
});
test('lobby disconnects are immediate and the leader migrates as before',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'}),b=await f.connect(TOKEN_B,{name:'Bravo',team:'horde',race:'orc'});
    a.send({type:'create'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    a.ws.terminate();await wait(()=>b.room.players.length===1&&b.room.host===b.id);assert.ok(!f.net.clients.has(a.id));assert.equal(f.net.sessions.size,1);
  }finally{await f.close();}
});
test('a held host passes leadership to a connected player',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'}),b=await f.connect(TOKEN_B,{name:'Bravo',team:'horde',race:'orc'});const room=await f.match(a,b);
    a.ws.terminate();await wait(()=>room.host===b.id);assert.ok(room.members.includes(a.id));
  }finally{await f.close();}
});
test('locked class slots and picks are refused for profiled players',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'});await wait(()=>a.profile);
    a.send({type:'profile',loadout:{primary:3,secondary:2,perk:'stockpile'},slot:4});
    await wait(()=>a.messages.some(m=>m.type==='error'&&/unlocks at level 14/.test(m.message)));
    a.send({type:'profile',loadout:{primary:3,secondary:2,perk:'stockpile'},slot:0});
    await wait(()=>a.messages.some(m=>m.type==='error'&&/Locked until you level up/.test(m.message)));
    const pa=f.net.clients.get(a.id);assert.ok(pa.pending.primary<2&&pa.pending.secondary<2&&pa.pending.perk==='balanced');
    // Anonymous clients are unrestricted, as before.
    const anon=await f.connect(null);anon.send({type:'profile',loadout:{primary:3,secondary:2}});await wait(()=>f.net.clients.get(anon.id).pending.primary===3);
  }finally{await f.close();}
});
test('XP is awarded server-side, summarised at match end and persisted',async()=>{
  const f=await fixture();try{
    const a=await f.connect(TOKEN_A,{name:'Alpha'}),b=await f.connect(TOKEN_B,{name:'Bravo',team:'horde',race:'orc'});await wait(()=>a.profile&&b.profile);
    const room=await f.match(a,b),pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id);
    pa.protectedUntil=pb.protectedUntil=0;pa.position=[0,pa.position[1],0];pb.position=[3,pb.position[1],0];pb.hp=1;room.score.alliance=room.target-1;
    a.send({type:'fire',target:[3,1.4,0]});
    await wait(()=>room.phase==='ended');
    await wait(()=>a.messages.some(m=>m.type==='xp')&&b.messages.some(m=>m.type==='xp'));
    const xa=a.messages.find(m=>m.type==='xp'),xb=b.messages.find(m=>m.type==='xp');
    assert.equal(pa.kills,1);assert.ok(xa.xp>=900&&xa.xp<=1000,'kill + completion + win, got '+xa.xp);assert.equal(xa.won,true);assert.ok(xa.breakdown.some(i=>i.id==='win'));
    assert.equal(xb.xp,300);assert.equal(xb.won,false);
    const stored=f.profiles.get(pa.sessionId);assert.equal(stored.stats.matches,1);assert.equal(stored.stats.wins,1);assert.equal(stored.stats.kills,1);assert.equal(stored.xp,xa.xp);
    assert.equal(f.profiles.get(pb.sessionId).stats.deaths,1);
    // Resending a held summary after a reconnect, in the ended phase.
    a.ws.terminate();await wait(()=>pa.dropped);const a2=await f.connect(TOKEN_A);await wait(()=>a2.messages.some(m=>m.type==='xp'));
  }finally{await f.close();}
});
