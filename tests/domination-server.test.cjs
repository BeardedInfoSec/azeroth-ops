const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await delay(10);}throw Error('Timed out');};
async function fixture({duration}={}){
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),T=await import('three'),{PLAYER_EYE_HEIGHT}=await import('../src/player-config.js');
  let now=100000;const spawns=[];for(let x=-40;x<=40;x+=2)for(let z=-40;z<=40;z+=2)spawns.push(new T.Vector3(x,0,z));
  const weights=[];
  const arena={origin:new T.Vector3(0,PLAYER_EYE_HEIGHT,0),spawns,trace:()=>null,blocked:()=>false,resolve:()=>new T.Vector3(),floorAt:(x,z)=>({point:new T.Vector3(x,0,z)}),
    spawn:(players,team,last,weigh)=>{weights.push({team,weigh});return [0,PLAYER_EYE_HEIGHT,0];}};
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const players=[];
  async function step(ms=50){now+=ms;net.tick();await delay(10);}
  async function connect(name,team,race){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),p={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};players.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='welcome')p.id=m.id;if(m.type==='room')p.room=m.room;});await wait(()=>p.id);p.send({type:'profile',name,team,race,loadout:{primary:2,secondary:0}});return p;}
  const a=await connect('Alpha','alliance','human'),b=await connect('Bravo','horde','orc');
  a.send({type:'create',mode:'domination'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
  if(duration)a.send({type:'settings',duration});
  async function start(){for(const p of players)p.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>a.room.phase==='loading'&&players.every(p=>p.room.layoutRevision));for(const p of players)p.send({type:'loaded',code:p.room.code,loadGeneration:p.room.loadGeneration,layoutRevision:p.room.layoutRevision});const room=net.rooms.get(a.room.code);await wait(()=>room.arena&&[...net.clients.values()].every(p=>p.loaded));await step();assert.equal(room.phase,'countdown');await step(3001);assert.equal(room.phase,'playing');return room;}
  const at=(point,client)=>{client.position=[point.x,PLAYER_EYE_HEIGHT+point.y,point.z];client.lastPose=now;client.protectedUntil=0;};
  async function close(){for(const p of players)p.ws.terminate();net.close();await new Promise(r=>server.close(r));}
  return {net,players,a,b,start,step,close,at,weights,now:()=>now};
}

test('Lobby validates Domination settings and keeps TDM limits intact',async()=>{
  const f=await fixture();try{
    const {a}=f;assert.equal(a.room.mode,'domination');assert.equal(a.room.target,200);
    a.send({type:'settings',mode:'domination',target:300});await wait(()=>a.room.target===300);
    a.send({type:'settings',target:50});await delay(40);assert.equal(a.room.target,300,'TDM-only limits are rejected in Domination');
    a.send({type:'settings',mode:'tdm',target:50});await wait(()=>a.room.mode==='tdm'&&a.room.target===50);
    a.send({type:'settings',mode:'domination',target:50});await wait(()=>a.room.mode==='domination'&&a.room.target===200);
    a.send({type:'settings',mode:'bogus'});await delay(40);assert.equal(a.room.mode,'domination');
    f.b.send({type:'settings',target:100});await delay(40);assert.equal(a.room.target,200,'Only the leader changes settings');
    assert.equal(a.room.domination,null);
  }finally{await f.close();}
});

test('Server places three points and captures only from authoritative positions',async()=>{
  const f=await fixture();try{
    const room=await f.start(),{a,b}=f,pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id);
    const points=a.room.domination.points;assert.deepEqual(points.map(p=>p.id),['A','B','C']);assert.ok(points.every(p=>p.owner===null&&p.progress===0));
    assert.ok(room.arena.spawns.some(s=>s.x===points[0].x&&s.z===points[0].z));
    const [A,B]=points;
    // Teleport request far from the allowed range is corrected and never captures.
    pa.position=[0,2.45,30];pb.position=[0,2.45,-30];
    a.send({type:'pose',position:[B.x,pa.position[1],B.z],yaw:0,pitch:0});await wait(()=>a.messages.some(m=>m.type==='correct'));
    await f.step(6000);assert.ok(a.room.domination.points.every(p=>p.owner===null));
    // Standing on A for five seconds captures it.
    f.at(A,pa);f.at({x:0,y:0,z:-30},pb);
    for(let i=0;i<24;i++)await f.step(200);
    assert.equal(room.domination.points[0].owner,null,'Not captured before five seconds');assert.ok(a.room.domination.points[0].progress>.9&&a.room.domination.points[0].progress<1);
    await f.step(400);await wait(()=>a.room.domination.points[0].owner==='alliance');
    assert.equal(a.room.domination.points[0].progress,1);assert.ok(a.messages.some(m=>m.type==='notice'&&/POINT A CAPTURED BY ALLIANCE/.test(m.message)));
    assert.equal(a.room.domination.points[1].owner,null);
  }finally{await f.close();}
});

test('Contested points freeze, scoring ticks every five seconds and kills never score',async()=>{
  const f=await fixture();try{
    const room=await f.start(),{a,b}=f,pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id),[A]=a.room.domination.points;
    f.at(A,pa);f.at({x:A.x+2,y:A.y,z:A.z},pb);
    await f.step(250);
    const control=room.domination.points[0].control;
    for(let i=0;i<30;i++)await f.step(200);
    assert.equal(a.room.domination.points[0].contested,true);assert.equal(room.domination.points[0].control,control,'Contested capture is frozen');assert.deepEqual(room.score,{alliance:0,horde:0});
    // Alpha shoots Bravo: a kill is recorded but the match score is unchanged.
    pa.protectedUntil=pb.protectedUntil=0;pa.yaw=0;
    a.send({type:'fire',target:[A.x+2,PLAYER_EYE(A)-1.15,A.z]});await wait(()=>pb.hp===0);
    assert.equal(pa.kills,1);assert.deepEqual(room.score,{alliance:0,horde:0});
    // Alone, Alpha captures and then earns one point per tick.
    for(let i=0;i<40;i++){pb.respawnAt=f.now()+99999;await f.step(150);}
    assert.equal(room.domination.points[0].owner,'alliance');
    const before=room.score.alliance;await f.step(200);
    const ticks=[];for(let i=0;i<40;i++){await f.step(250);ticks.push(room.score.alliance);}
    assert.ok(room.score.alliance>before+1&&room.score.alliance<=before+3,'about 10 s of holding = 2 ticks');assert.equal(room.score.horde,0);
    assert.equal(room.domination.points[0].owner,'alliance');
  }finally{await f.close();}
  function PLAYER_EYE(A){return A.y+2.45;}
});

test('Reaching the score limit ends the match with the holder winning, then the lobby resets',async()=>{
  const f=await fixture();try{
    const room=await f.start(),{a,b}=f,pa=f.net.clients.get(a.id),[A]=a.room.domination.points;
    f.at(A,pa);f.at({x:0,y:0,z:-30},f.net.clients.get(b.id));
    for(let i=0;i<30;i++)await f.step(200);assert.equal(room.domination.points[0].owner,'alliance');
    room.score.alliance=room.target-1;
    for(let i=0;i<30&&room.phase==='playing';i++)await f.step(250);
    assert.equal(room.phase,'ended');await wait(()=>a.room.phase==='ended');assert.equal(a.room.winner,'alliance');assert.ok(a.room.score.alliance>=200);
    a.send({type:'return'});await wait(()=>a.room.phase==='waiting');assert.equal(a.room.domination,null);assert.equal(a.room.mode,'domination');
  }finally{await f.close();}
});

test('At the time limit the higher score wins and equal scores draw',async()=>{
  const f=await fixture({duration:300});try{
    const room=await f.start(),pb=f.net.clients.get(f.b.id),pa=f.net.clients.get(f.a.id);
    f.at({x:0,y:0,z:-30},pa);f.at({x:0,y:0,z:30},pb);
    room.score.horde=7;room.score.alliance=3;
    await f.step(299000);assert.equal(room.phase,'playing');
    f.at({x:0,y:0,z:-30},pa);f.at({x:0,y:0,z:30},pb);
    await f.step(2000);assert.equal(room.phase,'ended');assert.equal(room.winner,'horde');
  }finally{await f.close();}
  const g=await fixture({duration:300});try{
    const room=await g.start();room.score.alliance=room.score.horde=4;
    await g.step(301000);assert.equal(room.phase,'ended');assert.equal(room.winner,'draw');
  }finally{await g.close();}
});

test('Spawns are weighted towards the team\'s owned points through the safety-first spawn chooser',async()=>{
  const f=await fixture();try{
    const room=await f.start();
    const first=f.weights.filter(w=>w.team==='alliance').at(-1);assert.ok(first.weigh,'Domination passes an objective weight to the arena');
    const [A,B,C]=room.domination.points;
    assert.equal(first.weigh({x:A.x,y:0,z:A.z}),1,'No owned points: neutral weighting');
    room.domination.points[0].owner='alliance';room.domination.points[2].owner='horde';
    const pb=f.net.clients.get(f.b.id);pb.hp=0;pb.respawnAt=0;
    await f.step(50);
    const latest=f.weights.filter(w=>w.team==='alliance');
    const pa=f.net.clients.get(f.a.id);pa.hp=0;pa.respawnAt=0;await f.step(50);
    const weigh=f.weights.filter(w=>w.team==='alliance').at(-1).weigh;assert.ok(latest.length>=1);
    assert.ok(weigh({x:A.x+2,y:0,z:A.z})>weigh({x:B.x,y:0,z:B.z}),'Owned point preferred');
    assert.equal(weigh({x:C.x,y:0,z:C.z+1}),.25,'Enemy-held point discouraged');
  }finally{await f.close();}
});

test('TDM still scores kills and has no Domination state',async()=>{
  const f=await fixture();try{
    f.a.send({type:'settings',mode:'tdm'});await wait(()=>f.a.room.mode==='tdm');
    const room=await f.start(),pa=f.net.clients.get(f.a.id),pb=f.net.clients.get(f.b.id);
    assert.equal(room.domination,null);assert.equal(f.a.room.domination,null);
    pa.protectedUntil=pb.protectedUntil=0;pa.position=[0,2.45,0];pb.position=[10,2.45,0];
    f.a.send({type:'fire',target:[10,1.3,0]});await wait(()=>pb.hp===0);assert.equal(room.score.alliance,1);
  }finally{await f.close();}
});
