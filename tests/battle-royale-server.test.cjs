const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await delay(10);}throw Error('Timed out');};
async function fixture(count=3){
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),T=await import('three');
  let now=100000;const spawns=[];for(let x=-40;x<=40;x+=2)for(let z=-40;z<=40;z+=2)spawns.push(new T.Vector3(x,0,z));
  const arena={origin:new T.Vector3(0,2.45,0),spawns,trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3(),floorAt:(x,z)=>({point:new T.Vector3(x,0,z)}),spawn:()=>[0,2.45,0]};
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const players=[];
  async function step(ms=50){now+=ms;net.tick();await delay(10);}
  async function connect(name){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),p={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};players.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='welcome')p.id=m.id;if(m.type==='room')p.room=m.room;});await wait(()=>p.id);p.send({type:'profile',name,team:'alliance',race:'human',loadout:{primary:2,secondary:0}});return p;}
  for(let i=0;i<count;i++)await connect('Player '+i);
  const host=players[0];host.send({type:'create',mode:'royale'});await wait(()=>host.room);
  for(const p of players.slice(1))p.send({type:'join',code:host.room.code});await wait(()=>host.room.players.length===count);
  async function start(){for(const p of players)p.send({type:'ready',ready:true});await wait(()=>host.room.players.every(p=>p.ready));host.send({type:'start'});await wait(()=>host.room.phase==='loading'&&players.every(p=>p.room.layoutRevision));for(const p of players)p.send({type:'loaded',code:p.room.code,loadGeneration:p.room.loadGeneration,layoutRevision:p.room.layoutRevision});const room=net.rooms.get(host.room.code);await wait(()=>room.arena&&[...net.clients.values()].every(p=>p.loaded));await step();assert.equal(room.phase,'countdown');await step(3001);assert.equal(room.phase,'playing');return room;}
  async function close(){for(const p of players)p.ws.terminate();net.close();await new Promise(r=>server.close(r));}
  return {net,players,host,start,step,close,now:()=>now};
}
test('FFA supports same-faction lobbies, authoritative flight/glide, elimination and no respawns',async()=>{
  const f=await fixture();try{
    const room=await f.start(),[a,b,c]=f.players,pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id),pc=f.net.clients.get(c.id);
    assert.ok(room.members.every(id=>f.net.clients.get(id).team==='alliance'));assert.equal(a.room.mode,'royale');
    assert.equal(pa.deployment,'aboard');assert.equal(a.room.royale.alive,3);assert.equal(pa.weapon.ammo,5);
    a.send({type:'fire',target:[10,1.3,0]});await delay(20);assert.equal(pa.weapon.ammo,5,'No firing aboard');
    a.send({type:'jump'});await wait(()=>pa.deployment==='gliding');const before=pa.position.slice();await f.step(100);
    a.send({type:'fire',target:[10,1.3,0]});a.send({type:'reload'});await delay(20);assert.equal(pa.weapon.ammo,5);assert.equal(pa.weapon.reloadLeft,0,'Airborne weapons remain disabled');
    a.send({type:'pose',position:[before[0]+.5,0,before[2]],yaw:0,pitch:0});await delay(20);
    assert.equal(pa.position[0],before[0]+.5);assert.ok(pa.position[1]>30,'Client cannot teleport glide to ground');
    a.send({type:'pose',position:[900,900,900],yaw:0,pitch:0});await delay(20);assert.notEqual(pa.position[0],900);
    for(let i=0;i<64;i++)await f.step(250);assert.equal(pa.deployment,'landed');assert.equal(pa.position[1],2.45);assert.ok(room.arena.spawns.some(p=>p.x===pa.position[0]&&p.z===pa.position[2]));
    await f.step(18000);assert.equal(pb.deployment,'gliding','Passengers autojump at flight end');
    pa.position=[0,2.45,0];pb.position=[10,2.45,0];pc.position=[-20,2.45,0];pa.deployment=pb.deployment=pc.deployment='landed';
    a.send({type:'fire',target:[10,1.3,0]});await wait(()=>pb.hp===0);assert.equal(pa.kills,1);assert.equal(pb.deployment,'eliminated');assert.equal(room.phase,'playing');
    const deadPosition=pb.position.slice(),deadAmmo=pb.weapon.ammo;
    b.send({type:'jump'});b.send({type:'reload'});b.send({type:'fire',target:[0,1.3,0]});b.send({type:'pose',position:[9,2.45,0],yaw:0,pitch:0});await f.step(5000);
    assert.equal(pb.hp,0);assert.deepEqual(pb.position,deadPosition);assert.equal(pb.weapon.ammo,deadAmmo);assert.equal(pb.respawnAt,0);
    c.ws.close();await wait(()=>room.phase==='ended');assert.equal(room.winner,a.id);assert.equal(a.room.royale.winnerName,'Player 0');
  }finally{await f.close();}
});
test('Zone damage resolves simultaneous final-circle deaths as a draw, with no regeneration',async()=>{
  const f=await fixture(2);try{
    const room=await f.start();for(const p of f.net.clients.values()){p.deployment='landed';p.position=[0,2.45,0];p.hp=10;}
    await f.step(300000);assert.equal(room.phase,'ended');assert.equal(room.winner,'draw');assert.equal(f.host.room.royale.alive,0);assert.equal(f.host.room.royale.winnerId,null);
  }finally{await f.close();}
});
test('Shrinking storm eliminates outside players and leaves the safe survivor as winner',async()=>{
  const f=await fixture(2);try{
    const room=await f.start(),[a,b]=f.players,pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id);
    pa.deployment=pb.deployment='landed';pa.position=[0,2.45,0];pb.position=[47,2.45,0];pb.hp=1;
    await f.step(110000);assert.equal(pb.hp,0);assert.equal(pa.hp,100);assert.equal(room.winner,a.id);
  }finally{await f.close();}
});
test('Host disconnect during loading returns remaining player to lobby and removes abandoned rooms',async()=>{
  const f=await fixture(2);try{
    const [a,b]=f.players;for(const p of f.players)p.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>a.room.phase==='loading');
    a.ws.close();await wait(()=>b.room.host===b.id&&b.room.phase==='waiting');assert.equal(b.room.players.length,1);assert.equal(b.room.royale,null);
    b.send({type:'leave'});await wait(()=>f.net.rooms.size===0);
  }finally{await f.close();}
});
test('Ten players may share one faction in FFA and host departure keeps a populated match running',async()=>{
  const f=await fixture(10);try{
    const room=await f.start();assert.equal(room.members.length,10);assert.ok([...f.net.clients.values()].every(p=>p.team==='alliance'));
    f.host.ws.close();await wait(()=>room.members.length===9);assert.equal(room.phase,'playing');assert.equal(room.host,f.players[1].id);assert.equal(room.royale.winnerId,null);
  }finally{await f.close();}
});
