const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(predicate){for(let i=0;i<300;i++){if(predicate())return;await delay(5);}throw Error('Stance fixture timed out');}
const closeTo=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

async function tinyArena({roof=false}={}){
  const T=await import('three'),{MeshBVH}=await import('three-mesh-bvh'),{createArenaStance}=await import('../server/world.mjs');
  const inputs=[new T.PlaneGeometry(80,80).rotateX(-Math.PI/2)];if(roof)inputs.push(new T.BoxGeometry(8,.2,8).translate(0,1.9,0));
  const positions=[];for(const input of inputs){const expanded=input.toNonIndexed();positions.push(...expanded.attributes.position.array);expanded.dispose();input.dispose();}
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.boundsTree=new MeshBVH(geometry);
  const collider=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));collider.updateMatrixWorld(true);
  const trace=(a,b)=>{const delta=b.clone().sub(a),length=delta.length();if(length<1e-6)return null;const ray=new T.Raycaster(a,delta.divideScalar(length),0,length);ray.firstHitOnly=true;return ray.intersectObject(collider)[0]||null;};
  return {T,city:'stormwind',origin:new T.Vector3(0,2.45,0),survivalSpawn:new T.Vector3(0,2.45,0),collider,shots:collider,spawns:[new T.Vector3(0,0,0),new T.Vector3(0,0,-6)],trace,blocked:(a,b)=>!!trace(a,b),floorAt:(x,z)=>({point:new T.Vector3(x,0,z),face:{normal:new T.Vector3(0,1,0)}}),spawn:(_players,team)=>[0,2.45,team==='alliance'?0:-6],...createArenaStance(collider),dispose(){geometry.dispose();collider.material.dispose();}};
}

async function networkFixture(t,options){
  const arena=await tinyArena(options),{attachMultiplayer}=await import('../server/multiplayer.mjs');let now=100000;
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false}),peers=[];
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const peer of peers)peer.ws.terminate();net.close();await new Promise(resolve=>server.close(resolve));arena.dispose();});
  for(const [team,race] of [['alliance','human'],['horde','orc']]){
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),peer={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};peers.push(peer);
    ws.on('message',raw=>{const m=JSON.parse(raw);peer.messages.push(m);if(m.type==='welcome')peer.id=m.id;if(m.type==='room')peer.room=m.room;});await wait(()=>peer.id);peer.send({type:'profile',team,race});
    if(peers.length===1){peer.send({type:'create'});await wait(()=>peer.room);}else{peer.send({type:'join',code:peers[0].room.code});await wait(()=>peer.room);}
  }
  const room=net.rooms.get(peers[0].room.code);for(const peer of peers)peer.send({type:'ready',ready:true});await wait(()=>room.members.every(id=>net.clients.get(id).ready));peers[0].send({type:'start'});await wait(()=>room.layoutRevision&&peers.every(p=>p.room.layoutRevision));
  for(const peer of peers)peer.send({type:'loaded',code:room.code,loadGeneration:room.loadGeneration,layoutRevision:room.layoutRevision});await wait(()=>room.members.every(id=>net.clients.get(id).loaded));net.tick();now+=3000;net.tick();await wait(()=>peers.every(p=>p.room.phase==='playing'));
  const players=peers.map(p=>net.clients.get(p.id));for(const player of players)player.protectedUntil=0;
  async function pose(index,position,crouched){now+=50;const peer=peers[index],player=players[index],sentAt=now;peer.send({type:'pose',position,crouched,yaw:0,pitch:0});await wait(()=>player.lastPose===sentAt);await delay(5);}
  async function shot(index,target,type='fire'){const peer=peers[index],player=players[index],count=peer.messages.filter(m=>m.type===(type==='fire'?'shot':'melee')).length;player.weapon.cooldown=0;player.weapon.releaseTrigger();player.melee={};now+=200;peer.send({type,target});await wait(()=>peer.messages.filter(m=>m.type===(type==='fire'?'shot':'melee')).length>count);return peer.messages.filter(m=>m.type===(type==='fire'?'shot':'melee')).at(-1);}
  async function step(ms=0){now+=ms;net.tick();await delay(10);}
  return {arena,net,room,peers,players,pose,shot,step,get now(){return now;}};
}

test('arena stance solver keeps the canonical feet anchor and rejects standing under a low roof',async()=>{
  const arena=await tinyArena({roof:true});try{const anchor=new arena.T.Vector3(0,2.45,0);assert.equal(arena.canStand(anchor),false);assert.equal(arena.canStand(new arena.T.Vector3(10,2.45,0)),true);assert.ok(arena.resolve(anchor,true).length()<1e-5);const sunken=anchor.clone().add(new arena.T.Vector3(0,-.2,0));closeTo(arena.resolve(sunken,true).y,.2);assert.deepEqual(anchor.toArray(),[0,2.45,0]);}finally{arena.dispose();}
});

test('network snapshots and corrections preserve crouch; low roofs refuse standing without moving feet',async t=>{
  const f=await networkFixture(t,{roof:true}),[a]=f.players,[peer]=f.peers;await f.pose(0,[0,2.45,0],true);assert.equal(a.crouched,true);assert.deepEqual(a.position,[0,2.45,0]);await f.step();assert.equal(peer.room.players.find(p=>p.id===a.id).crouched,true);
  await f.pose(0,[.1,2.45,0],false);assert.equal(a.crouched,true);closeTo(a.position[0],.1);closeTo(a.position[1],2.45);await wait(()=>peer.messages.some(m=>m.type==='correct'&&m.crouched===true));
  const before=a.position.slice();await f.pose(0,[30,2.45,0],true);assert.deepEqual(a.position,before);assert.equal(peer.messages.filter(m=>m.type==='correct').at(-1).crouched,true);
});

test('crouch uses walking speed without sprint and can stand once there is clearance',async t=>{
  const f=await networkFixture(t),[a]=f.players;await f.pose(0,[0,2.45,0],true);await f.pose(0,[.75,2.45,0],true);closeTo(a.position[0],0);await f.pose(0,[.13,2.45,0],true);closeTo(a.position[0],.13);await f.pose(0,[.88,2.45,0],false);closeTo(a.position[0],.88);assert.equal(a.crouched,false);
});

test('sprint-to-crouch transition accepts prior standing travel then enforces crouch speed',async t=>{
  const f=await networkFixture(t),[a]=f.players;
  await f.pose(0,[.45,2.45,0],true);closeTo(a.position[0],.45);assert.equal(a.crouched,true);
  await f.pose(0,[.9,2.45,0],true);closeTo(a.position[0],.45);
  const coop=await coopFixture(t);coop.environment.movementColliders=[];
  assert.equal(coop.pose([.45,2.45,0],true),true);closeTo(coop.p.position[0],.45);assert.equal(coop.p.crouched,true);
  assert.equal(coop.pose([.9,2.45,0],true),false);closeTo(coop.p.position[0],.45);
});

test('PvP shots originate lower and miss the space above a crouched hitbox',async t=>{
  const f=await networkFixture(t),[a,b]=f.players;await f.pose(1,b.position,true);let shot=await f.shot(0,[0,1.7,-6]);assert.equal(shot.hit,false);assert.equal(b.hp,100);
  await f.pose(1,b.position,false);shot=await f.shot(0,[0,1.7,-6]);assert.equal(shot.hit,true);assert.ok(b.hp<100);b.hp=100;b.lastHurt=f.now;
  await f.pose(0,a.position,true);await f.pose(1,b.position,true);shot=await f.shot(0,[0,1.2,-6]);closeTo(shot.from[1],1.25);assert.equal(shot.hit,true);assert.ok(b.hp<100);
});

test('crouched melee uses a lower origin, and a fresh spawn clears the previous stance',async t=>{
  const f=await networkFixture(t),[a,b]=f.players;b.position=[0,2.45,-1.5];await f.pose(0,a.position,true);await f.pose(1,b.position,true);const hit=await f.shot(0,[0,.8,-1.5],'melee');closeTo(hit.from[1],1.25);assert.equal(hit.hit,true);assert.equal(b.hp,0);assert.equal(b.crouched,false);await f.step(3001);assert.equal(b.hp,100);assert.equal(b.crouched,false);
});

test('sentries target crouched body height',async t=>{
  const f=await networkFixture(t),[a,b]=f.players;await f.pose(1,b.position,true);f.room.sentries.push({id:'fixture-sentry',owner:a.id,team:a.team,position:[0,0,-2],expires:f.now+10000,next:0});await f.step();const shot=f.peers[0].messages.find(m=>m.type==='shot'&&m.id==='fixture-sentry');assert.ok(shot);closeTo(shot.to[1],2.05*(1.6/2.45)*.65);assert.equal(b.hp,68);
});

async function coopFixture(t){
  const arena=await tinyArena(),{T}=arena,{ZombieMatch}=await import('../server/zombies.mjs'),messages=[];let now=10000;
  const p={id:'coop',name:'Coop',race:'human',team:'alliance',position:[0,2.45,0],hp:100,status:'alive',kills:0,deaths:0,streak:{death(){}}};
  const nodes=[-1,0,1].map((x,id)=>({id,point:new T.Vector3(x*2,0,0),edges:[0,1,2].filter(i=>i!==id)})),nav={nodes,reachable:nodes,cache:new Map()};
  const group=new T.Group(),shotCollider=new T.Group();group.add(shotCollider);const roof=new T.Group();roof.position.set(0,1.8,0);
  const environment={group,shotCollider,unlockedZones:new Set([0]),movementColliders:[{mesh:roof,width:4,depth:4,height:.2}],windows:[],interactions:[],isAccessible:()=>true,isMoveBlocked:()=>false,canTraverse:()=>true,dispose(){}};
  const match=new ZombieMatch({arena,players:()=>[p],clock:()=>now,nav,environment,send:(_p,m)=>messages.push(m),broadcast:m=>messages.push(m)});match.start();p.position=[0,2.45,0];p.protectedUntil=0;t.after(()=>{match.dispose();arena.dispose();});
  return {T,arena,p,match,environment,messages,pose(position,crouched){now+=50;return match.pose(p,new T.Vector3().fromArray(position),now,crouched);},get now(){return now;}};
}

test('co-op capsule uses crouch height for fortifications and keeps crouch through a low-roof revive',async t=>{
  const f=await coopFixture(t);assert.equal(f.pose([.1,2.45,0],true),true);closeTo(f.p.position[0],.1);closeTo(f.p.position[1],2.45);assert.equal(f.pose([.2,2.45,0],false),true);assert.equal(f.p.crouched,true);closeTo(f.p.position[0],.2);
  const wall=new f.T.Group();wall.position.set(.8,0,0);f.environment.movementColliders.push({mesh:wall,width:.2,depth:4,height:3});assert.equal(f.pose([.5,2.45,0],true),true);assert.ok(f.p.position[0]<.381);closeTo(f.p.position[1],2.45);
  f.match.damagePlayer(f.p,999,f.now);assert.equal(f.p.status,'downed');assert.equal(f.match.revive(f.p,f.now),true);assert.equal(f.p.crouched,true);assert.equal(f.messages.filter(m=>m.type==='correct').at(-1).crouched,true);f.match.deploy(f.p,f.now);assert.equal(f.p.crouched,false);
});

test('co-op shots and knife swings originate from the crouched eye',async t=>{
  const f=await coopFixture(t);f.environment.movementColliders=[];f.pose([0,2.45,0],true);assert.equal(f.match.shoot(f.p,[0,1,-5]),true);closeTo(f.messages.filter(m=>m.type==='shot').at(-1).from[1],1.25);f.p.weapon.cooldown=0;f.p.weapon.releaseTrigger();assert.equal(f.match.melee(f.p,[0,1,-2]),true);closeTo(f.messages.filter(m=>m.type==='melee').at(-1).from[1],1.25);
});

test('co-op purchase targeting traces from crouched view height',async t=>{
  const f=await coopFixture(t);f.pose([0,2.45,0],true);const item={id:'fixture-gun',type:'weapon',zone:0,position:new f.T.Vector3(0,0,-2),mesh:new f.T.Group()};f.environment.interactions.push(item);let origin;
  f.arena.trace=(from)=>{origin=from.clone();return null;};assert.equal(f.match.target(f.p),item);closeTo(origin.y,1.6);closeTo(f.match.feet(f.p).y,0);
});

test('co-op revive prompt and server agree on crouched sightlines over low cover',async t=>{
  const f=await coopFixture(t),{CoopSurvival}=await import('../src/coop-survival.js'),{stanceEye}=await import('../src/engine/player-stance.js');
  const cover=new f.T.Mesh(new f.T.BoxGeometry(2,.7,.2),new f.T.MeshBasicMaterial({side:f.T.DoubleSide}));cover.position.set(0,.35,-.7);f.environment.shotCollider.add(cover);f.environment.group.updateMatrixWorld(true);
  t.after(()=>{cover.geometry.dispose();cover.material.dispose();});
  const ally={id:'ally',position:[0,2.45,-2],status:'downed'},client=Object.create(CoopSurvival.prototype);
  Object.assign(client,{getPlayer:()=>new f.T.Vector3().fromArray(f.p.position),getEye:()=>stanceEye(new f.T.Vector3().fromArray(f.p.position),f.p.crouched),getRoom:()=>({players:[f.p,ally]}),getId:()=>f.p.id,worldCollider:f.arena.collider,environment:f.environment});
  for(const crouched of [false,true]){f.p.crouched=crouched;assert.equal(f.match.canRevive(f.p,ally),!crouched);assert.equal(!!client.reviveTarget(),!crouched);assert.deepEqual(f.p.position,[0,2.45,0]);}
});
