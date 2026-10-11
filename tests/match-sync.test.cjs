const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(predicate){for(let i=0;i<300;i++){if(predicate())return;await delay(5);}throw Error('Fixture timed out');}

async function fixture(t,{teams=['alliance','horde'],mode='tdm',failSpawn=false}={}){
  const T=await import('three'),{attachMultiplayer}=await import('../server/multiplayer.mjs'),{defaultLayout}=await import('../src/map-layout.mjs');
  let now=100000,resolveMap,spawnCalls=0;const calls={prepare:0,start:0,tick:0,dispose:0};
  const arena={city:'stormwind',layout:defaultLayout('stormwind'),origin:new T.Vector3(0,2.45,0),spawns:[new T.Vector3(-15,0,0),new T.Vector3(15,0,0)],trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3(),spawn(players,team){spawnCalls++;return failSpawn?null:[team==='alliance'?-15:15,2.45,players.length*2];}};
  const server=http.createServer(),net=attachMultiplayer(server,{clock:()=>now,autoTick:false,arenaLoader:()=>new Promise(resolve=>{resolveMap=resolve;}),zombieFactory:({players})=>({prepare(){calls.prepare++;for(const [i,p] of players().entries()){p.hp=100;p.position=[i*2,2.45,0];p.status='alive';p.spawnNumber++;}},start(){calls.start++;},tick(){calls.tick++;},snapshot:()=>({wave:1,spawn:[0,2.45,0]}),playerSnapshot:()=>null,leave(){},dispose(){calls.dispose++;}})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const peers=[];
  t.after(async()=>{for(const peer of peers)peer.ws.terminate();net.close();await new Promise(resolve=>server.close(resolve));});
  async function connect(team,name){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),peer={ws,messages:[],send:message=>ws.send(JSON.stringify(message))};peers.push(peer);ws.on('message',raw=>{const message=JSON.parse(raw);peer.messages.push(message);if(message.type==='welcome')peer.id=message.id;if(message.type==='room')peer.room=message.room;});await wait(()=>peer.id);peer.send({type:'profile',team,name});return peer;}
  const a=await connect(teams[0],'Alpha');a.send({type:'create',mode});await wait(()=>a.room);for(let i=1;i<teams.length;i++){const peer=await connect(teams[i],'Peer '+i);peer.send({type:'join',code:a.room.code});await wait(()=>peer.room);}const room=net.rooms.get(a.room.code);
  async function start(){for(const peer of peers)if(peer.ws.readyState===1&&net.clients.get(peer.id)?.room===room.code)peer.send({type:'ready',ready:true});await wait(()=>room.members.every(id=>net.clients.get(id).ready));const host=peers.find(peer=>peer.id===room.host);host.send({type:'start'});await wait(()=>room.phase==='loading'&&resolveMap);}
  async function load(){resolveMap(arena);await wait(()=>peers.filter(peer=>peer.ws.readyState===1).every(peer=>peer.room?.layoutRevision===room.layoutRevision)&&room.layoutRevision);}
  const stamp=()=>({code:room.code,loadGeneration:room.loadGeneration,layoutRevision:room.layoutRevision});
  async function ready(peer){peer.send({type:'loaded',...stamp()});await wait(()=>net.clients.get(peer.id)?.loaded);}
  async function step(ms=0){now+=ms;net.tick();await delay(10);}
  return {net,arena,room,peers,calls,start,load,stamp,ready,step,connect,get now(){return now;},get spawnCalls(){return spawnCalls;}};
}

test('only current map acknowledgments count, and every player deploys at one server deadline',async t=>{
  const f=await fixture(t),[a,b]=f.peers;await f.start();a.send({type:'loaded',...f.stamp()});await delay(15);assert.equal(f.net.clients.get(a.id).loaded,false,'Cannot acknowledge before authoritative layout exists');await f.load();
  for(const bad of [{},{...f.stamp(),code:'OLD'},{...f.stamp(),loadGeneration:f.room.loadGeneration-1},{...f.stamp(),layoutRevision:'old'}])a.send({type:'loaded',...bad});await delay(15);assert.equal(f.net.clients.get(a.id).loaded,false);
  a.send({type:'load-progress',...f.stamp(),progress:.65,stage:'Building scene'});await wait(()=>b.room.players.find(p=>p.id===a.id).loadProgress===.65);assert.equal(b.room.players.find(p=>p.id===a.id).loadStage,'Building scene');
  await f.ready(a);await f.step();assert.equal(f.room.phase,'loading');assert.equal(f.spawnCalls,0,'No early deployment while a peer is loading');await f.ready(b);await f.step();assert.equal(f.room.phase,'countdown');assert.equal(f.spawnCalls,2);assert.equal(a.room.startsAt,f.now+3000);assert.equal(a.room.serverNow,f.now);assert.equal(a.room.startsAt,b.room.startsAt);
  const before=a.room.players.map(p=>({id:p.id,position:p.position.slice(),spawn:p.spawn}));assert.ok(a.room.players.every(p=>p.hp>0&&p.loaded));const pa=f.net.clients.get(a.id),ammo=pa.weapon.ammo,position=pa.position.slice();a.send({type:'pose',position:[100,100,100],yaw:0,pitch:0});a.send({type:'fire',target:[15,1,0]});await delay(15);assert.deepEqual(pa.position,position);assert.equal(pa.weapon.ammo,ammo,'Countdown blocks movement and shooting');
  await f.step(2999);assert.equal(f.room.phase,'countdown');await f.step(1);assert.equal(f.room.phase,'playing');assert.equal(f.spawnCalls,2,'Start does not spawn players a second time');assert.deepEqual(a.room.players.map(p=>({id:p.id,position:p.position,spawn:p.spawn})),before);assert.ok(f.room.members.every(id=>f.net.clients.get(id).protectedUntil===f.now+2000));
});

test('leadership transfer requires the leader and a connected member, and preserves readiness',async t=>{
  const f=await fixture(t,{teams:['alliance','horde','alliance']}),[a,b,c]=f.peers;await f.start();await f.load();await f.ready(a);const generation=f.room.loadGeneration;
  b.send({type:'transfer-host',targetId:b.id});await wait(()=>b.messages.some(m=>m.type==='error'));assert.equal(f.room.host,a.id);
  a.send({type:'transfer-host',targetId:'unknown'});await wait(()=>a.messages.some(m=>m.type==='error'));assert.equal(f.room.host,a.id);
  a.send({type:'transfer-host',targetId:c.id});await wait(()=>f.room.host===c.id);assert.equal(f.room.loadGeneration,generation);assert.equal(f.net.clients.get(a.id).loaded,true);assert.equal(f.room.phase,'loading');
  a.send({type:'transfer-host',targetId:b.id});await delay(15);assert.equal(f.room.host,c.id,'Former leader loses transfer authority');
});

test('automatic leader handoff preserves a populated countdown and running match',async t=>{
  const f=await fixture(t,{teams:['alliance','horde','alliance']}),[a,b,c]=f.peers;await f.start();await f.load();for(const peer of f.peers)await f.ready(peer);await f.step();const deadline=f.room.startsAt;a.ws.close();await wait(()=>f.room.host===b.id);assert.equal(f.room.phase,'countdown');assert.equal(f.room.startsAt,deadline);assert.deepEqual(f.room.members,[b.id,c.id]);await f.step(3000);assert.equal(f.room.phase,'playing');
  b.send({type:'transfer-host',targetId:c.id});await wait(()=>f.room.host===c.id);assert.equal(f.room.phase,'playing');assert.equal(f.room.startsAt,deadline);
});

test('a stale acknowledgment from a timed-out load cannot unlock its retry',async t=>{
  const f=await fixture(t),[a,b]=f.peers;await f.start();await f.load();const stale=f.stamp();f.room.loadDeadline=f.now-1;await f.step();assert.equal(f.room.phase,'waiting');await f.start();await f.load();a.send({type:'loaded',...stale});await delay(15);assert.equal(f.net.clients.get(a.id).loaded,false);await f.ready(b);await f.step();assert.equal(f.room.phase,'loading');await f.ready(a);await f.step();assert.equal(f.room.phase,'countdown');
});

test('a failed deployment cancels the whole countdown with an actionable error',async t=>{
  const f=await fixture(t,{failSpawn:true});await f.start();await f.load();for(const peer of f.peers)await f.ready(peer);await f.step();assert.equal(f.room.phase,'waiting');assert.equal(f.room.startsAt,0);assert.ok(f.room.members.every(id=>!f.net.clients.get(id).ready&&!f.net.clients.get(id).loaded));assert.ok(f.peers[0].messages.some(m=>m.type==='error'&&/No safe deployment/.test(m.message)));
});

test('co-op deploys before countdown but starts its simulation only at the shared deadline',async t=>{
  const f=await fixture(t,{teams:['alliance'],mode:'zombies'});await f.start();await f.load();await f.ready(f.peers[0]);await f.step();assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,0);assert.equal(f.calls.tick,0);assert.equal(f.peers[0].room.players[0].status,'alive');await f.step(3000);assert.equal(f.calls.prepare,1);assert.equal(f.calls.start,1);assert.equal(f.calls.tick,1);assert.equal(f.room.phase,'playing');
});

test('Any waiting player can switch faction and race; both peers see it and that player must ready again',async t=>{
  const f=await fixture(t),[a,b]=f.peers;
  a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await wait(()=>f.room.members.every(id=>f.net.clients.get(id).ready));
  b.send({type:'profile',team:'alliance',race:'nightelf'});
  await wait(()=>[a,b].every(peer=>peer.room.players.find(p=>p.id===b.id)?.race==='nightelf'));
  for(const peer of [a,b]){const changed=peer.room.players.find(p=>p.id===b.id);assert.equal(changed.team,'alliance');assert.equal(changed.ready,false);assert.equal(peer.room.players.find(p=>p.id===a.id).ready,true);}
  b.send({type:'profile',team:'horde',race:'tauren'});await wait(()=>a.room.players.find(p=>p.id===b.id)?.race==='tauren');
  await f.start();const before=b.messages.length;b.send({type:'profile',team:'alliance',race:'gnome'});await wait(()=>b.messages.length>before);assert.equal(f.net.clients.get(b.id).team,'horde');assert.equal(f.net.clients.get(b.id).race,'tauren','operator stays locked after loading starts');
});
