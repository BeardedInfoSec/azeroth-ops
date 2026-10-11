const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const wait=async predicate=>{const until=Date.now()+4000;while(!predicate()){if(Date.now()>until)throw Error('Timed out');await new Promise(r=>setTimeout(r,10));}};
const loaded=peer=>peer.send({type:'loaded',code:peer.room.code,loadGeneration:peer.room.loadGeneration,layoutRevision:peer.room.layoutRevision});
const tinyArena=id=>({id,origin:{x:0,z:0},spawn:()=>[0,2.45,0]});
async function fixture(t){
 const {attachMultiplayer}=await import('../server/multiplayer.mjs');
 const pending=[],server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:city=>new Promise((resolve,reject)=>pending.push({city,resolve,reject}))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const sockets=[];
 t.after(async()=>{for(const ws of sockets)ws.terminate();net.close();await new Promise(r=>server.close(r));});
 async function connect(team='alliance'){
  const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),c={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};sockets.push(ws);
  ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='welcome')c.id=m.id;if(m.type==='room')c.room=m.room;if(m.type==='rooms')c.rooms=m.rooms;});await wait(()=>c.id);c.send({type:'profile',team});return c;
 }
 const a=await connect(),b=await connect('horde'),observer=await connect();a.send({type:'create'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
 const room=net.rooms.get(a.room.code);
 async function start(){a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await wait(()=>room.members.every(id=>net.clients.get(id).ready));a.send({type:'start'});await wait(()=>room.phase==='loading');}
 return {a,b,observer,room,net,pending,start};
}

test('loading timeout resets consent and discovery; old map completion cannot replace a retry',async t=>{
 const {a,b,observer,room,pending,start}=await fixture(t);await start();a.send({type:'loaded'});await new Promise(r=>setTimeout(r,30));assert.equal(a.room.players[0].loaded,false,'A premature unstamped acknowledgment must not mark the map ready');room.loadDeadline=Date.now()-1;
 await wait(()=>room.phase==='waiting'&&observer.rooms?.some(r=>r.code===room.code));
 assert.ok(a.room.players.every(p=>!p.ready&&!p.loaded));assert.equal(room.startsAt,0);
 a.send({type:'settings',city:'dalaran'});await wait(()=>room.city==='dalaran');await start();
 pending[0].resolve({id:'old-stormwind'});await new Promise(r=>setTimeout(r,60));assert.equal(room.arena,null);
 const arena=tinyArena('new-dalaran');pending[1].resolve(arena);await wait(()=>room.arena===arena&&a.room.layoutRevision&&b.room.layoutRevision);
 loaded(a);loaded(b);await wait(()=>room.phase==='countdown');assert.equal(room.arena.id,'new-dalaran');
});

test('failed maps reopen a fresh lobby and obsolete failures cannot cancel its retry',async t=>{
 const {a,observer,room,pending,start}=await fixture(t);await start();pending[0].reject(Error('fixture missing map'));
 await wait(()=>room.phase==='waiting'&&observer.rooms?.some(r=>r.code===room.code));assert.ok(a.room.players.every(p=>!p.ready&&!p.loaded));
 await start();room.loadDeadline=Date.now()-1;await wait(()=>room.phase==='waiting');await start();
 pending[1].reject(Error('obsolete failure'));await new Promise(r=>setTimeout(r,60));assert.equal(room.phase,'loading');assert.equal(a.messages.filter(m=>m.type==='error'&&m.message.includes('obsolete')).length,0);
});

test('losing a team during countdown cancels start and migrates host with everyone unready',async t=>{
 const {a,b,observer,room,pending,start}=await fixture(t);await start();pending[0].resolve(tinyArena('fixture'));await wait(()=>a.room.layoutRevision&&b.room.layoutRevision);loaded(a);loaded(b);await wait(()=>room.phase==='countdown');
 a.ws.close();await wait(()=>b.room.phase==='waiting'&&b.room.host===b.id&&observer.rooms?.some(r=>r.code===room.code));
 assert.equal(b.room.players.length,1);assert.equal(b.room.players[0].ready,false);assert.equal(b.room.players[0].loaded,false);assert.equal(b.room.countdown,0);
 b.send({type:'start'});await wait(()=>b.messages.some(m=>m.type==='error'));assert.equal(room.phase,'waiting');
});
