const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(predicate){for(let i=0;i<200;i++){if(predicate())return;await delay(5);}throw new Error('Fixture timed out');}

test('room layout retention requires the same room, city, revision and generation',async()=>{
  const {mergeRoomLayout}=await import('../src/room-layout.mjs'),layout={city:'stormwind',placements:[]},previous={code:'AAA',city:'stormwind',layoutRevision:'1:abc',loadGeneration:1,layout},next={code:'AAA',city:'stormwind',layoutRevision:'1:abc',loadGeneration:1,phase:'playing'};
  assert.equal(mergeRoomLayout(previous,next).layout,layout);assert.equal(Object.hasOwn(next,'layout'),false,'Raw snapshot stays unmodified');
  for(const change of [{code:'BBB'},{city:'dalaran'},{layoutRevision:'2:def'},{loadGeneration:2},{layoutRevision:null}])assert.equal(mergeRoomLayout(previous,{...next,...change}).layout,null);
  assert.equal(mergeRoomLayout(previous,{...next,layout:null}).layout,null);assert.equal(mergeRoomLayout(null,next).layout,null);
});

test('frozen layouts retry after backpressure and leave normal position snapshots small',async t=>{
  const T=await import('three'),{attachMultiplayer}=await import('../server/multiplayer.mjs'),{defaultLayout}=await import('../src/map-layout.mjs'),{mergeRoomLayout}=await import('../src/room-layout.mjs');
  let now=100000,finish;const layout=defaultLayout('stormwind');layout.hiddenProps=Array.from({length:1000},(_,i)=>i);
  const arena={city:'stormwind',layout,origin:new T.Vector3(0,2.45,0),spawns:[new T.Vector3()],spawn:()=>[0,2.45,0],trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3()},server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:()=>new Promise(resolve=>{finish=resolve;}),clock:()=>now,autoTick:false}),peers=[];
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const p of peers)p.ws.terminate();net.close();await new Promise(resolve=>server.close(resolve));});
  async function connect(team){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),peer={ws,messages:[],send:value=>ws.send(JSON.stringify(value))};peers.push(peer);ws.on('message',raw=>{const message=JSON.parse(raw);peer.messages.push(message);if(message.type==='welcome')peer.id=message.id;if(message.type==='room')peer.room=mergeRoomLayout(peer.room,message.room);});await wait(()=>peer.id);peer.send({type:'profile',team});return peer;}
  const a=await connect('alliance'),b=await connect('horde');a.send({type:'create'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>finish);assert.equal(a.room.layout,null);
  const host=net.clients.get(a.id);let backedUp=true;Object.defineProperty(host.ws,'bufferedAmount',{configurable:true,get:()=>backedUp?300000:0});finish(arena);await wait(()=>b.room.layoutRevision);const room=net.rooms.get(a.room.code);assert.equal(host.layoutSentRevision,undefined,'Dropped send is not marked delivered');assert.equal(a.room.layout,null);
  backedUp=false;now+=1001;net.tick();await wait(()=>a.room.layoutRevision);assert.deepEqual(a.room.layout,layout);assert.equal(room.arena,arena);
  const fullCount=()=>a.messages.filter(m=>m.type==='room'&&m.room.layout).length,first=fullCount();now+=1001;net.tick();await wait(()=>fullCount()>first);assert.ok(fullCount()>first,'Unacknowledged loading layout is retried');
  for(const peer of [a,b])peer.send({type:'loaded',code:peer.room.code,loadGeneration:peer.room.loadGeneration,layoutRevision:peer.room.layoutRevision});await wait(()=>[...net.clients.values()].every(p=>p.loaded));const before=a.messages.length;net.tick();await wait(()=>a.room.phase==='countdown');for(let i=0;i<3;i++){now+=50;net.tick();await delay(5);}
  const updates=a.messages.slice(before).filter(m=>m.type==='room');assert.ok(updates.length>=3);assert.ok(updates.every(m=>!Object.hasOwn(m.room,'layout')),'Normal snapshots omit the payload');assert.ok(updates.every(m=>m.room.layoutRevision===room.layoutRevision));assert.deepEqual(a.room.layout,layout,'Game API still sees the retained authoritative layout');delete host.ws.bufferedAmount;
});

test('safe deployment moves off a placed crate before navigation is built',async()=>{
  const T=await import('three'),{survivalOrigin}=await import('../server/world.mjs'),{clearSpawn}=await import('../src/spawns.js');
  const base=new T.Vector3(-141,-8.02,3),inside=(x,z)=>Math.abs(x-base.x)<.75&&Math.abs(z-base.z)<.75;
  const floorAt=(x,z,top,max)=>{const y=base.y+(inside(x,z)?1.4:0);return top>=y&&top-y<=max?{point:new T.Vector3(x,y,z),face:{normal:new T.Vector3(0,1,0)}}:null;},blocked=()=>false;
  const initial=floorAt(base.x,base.z,base.y+8,50);assert.equal(clearSpawn(initial.point,floorAt,blocked,1.2,2.65),false,'A small crate top cannot fit the deployment footprint');
  const chosen=survivalOrigin({city:'stormwind',floorAt,blocked}),feet=chosen.clone().add(new T.Vector3(0,-2.45,0));assert.ok(!inside(feet.x,feet.z));assert.equal(feet.y,base.y);assert.equal(clearSpawn(feet,floorAt,blocked,1.2,2.65),true);assert.ok(feet.distanceTo(base)<=3.01);
});
