const test=require('node:test'),assert=require('node:assert/strict');

async function fixture({races=['human','orc'],start=true}={}){
  const T=await import('three'),{ZombieMatch}=await import('../server/zombies.mjs');
  let now=10000,ended=null,cityWall=false;const messages=[];
  const players=races.map((race,i)=>({id:'p'+i,name:'Player '+i,race,team:i%2?'horde':'alliance',position:[i*2,2.45,0],hp:100,status:'alive',kills:0,deaths:0,spawnNumber:0,streak:{death(){}}}));
  const nodes=[],grid=new Map();for(let z=-4;z<=4;z++)for(let x=-4;x<=4;x++){const n={id:nodes.length,x,z,point:new T.Vector3(x*2.5,0,z*2.5),edges:[]};nodes.push(n);grid.set(x+','+z,n);}
  for(const n of nodes)for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=grid.get((n.x+x)+','+(n.z+z));if(next)n.edges.push(next.id);}
  const nav={nodes,reachable:nodes,cell:2.5,cache:new Map(),nearest:p=>nodes.reduce((a,b)=>a.point.distanceToSquared(p)<b.point.distanceToSquared(p)?a:b),step(u,target,speed,dt){const delta=target.clone().sub(u.position);if(delta.length()<.01)return false;u.position.addScaledVector(delta,Math.min(speed*dt,delta.length())/delta.length());return true;}};
  const collider=new T.Group(),shotCollider=new T.Group(),group=new T.Group();group.add(shotCollider);
  const arena={city:'stormwind',survivalSpawn:new T.Vector3(0,2.45,0),origin:new T.Vector3(0,2.45,0),collider,shots:collider,spawns:nodes.map(n=>n.point),trace:(a,b)=>cityWall?{point:a.clone().lerp(b,Math.min(.1,2/a.distanceTo(b)))}:null,blocked:()=>cityWall,floorAt:(x,z)=>({point:new T.Vector3(x,0,z),face:{normal:new T.Vector3(0,1,0)}}),resolve:()=>new T.Vector3(),spawn:()=>[0,2.45,0]};
  const environment={group,shotCollider,unlockedZones:new Set([0]),movementColliders:[],windows:[],interactions:[],gates:[],isMoveBlocked:()=>false,isAccessible:()=>true,canTraverse:()=>true,canEntryMove:()=>true,setBoards(w,n){if(typeof w==='string')w=this.windows.find(v=>v.id===w);w.boards=Math.min(6,Math.max(0,n));},openZone(zone){if(!this.unlockedZones.has(zone-1)||this.unlockedZones.has(zone))return false;this.unlockedZones.add(zone);for(const w of this.windows)if(w.zone<zone){w.retired=true;w.boards=0;}return true;},dispose(){this.disposed=true;}};
  Object.defineProperty(environment,'activeWindows',{get(){return this.windows.filter(w=>w.zone===Math.max(...this.unlockedZones)&&!w.retired);}});
  for(let zone=0;zone<3;zone++){
    const mesh=new T.Group(),inside=new T.Vector3(0,0,-2.5-zone*2.5),outside=inside.clone().add(new T.Vector3(0,0,-2.5));mesh.position.copy(inside);
    const window={id:'window-'+zone,type:'window',zone,boards:6,mesh,position:inside.clone(),inside,outside,spawnPoint:outside.clone().add(new T.Vector3(1,0,-1)),approachPath:[outside.clone(),outside.clone().lerp(inside,.3)],releasePath:[inside.clone()]};environment.windows.push(window);environment.interactions.push(window);group.add(mesh);
    if(zone<2){const gate={id:'gate-'+(zone+1),type:'gate',level:zone+1,zone,cost:zone?1500:750,position:new T.Vector3(0,0,-2.5),mesh:new T.Group()};environment.gates.push(gate);environment.interactions.push(gate);}
  }
  const match=new ZombieMatch({arena,players:()=>players,clock:()=>now,random:()=>.1,nav,environment,send:(p,m)=>messages.push({...m,recipient:p.id}),broadcast:m=>messages.push(m),end:winner=>ended=winner});
  if(start)match.start(now);
  return {T,ZombieMatch,players,match,arena,nav,environment,messages,get now(){return now;},get ended(){return ended;},wall:yes=>cityWall=yes,advance(seconds,{hold=[]}={}){for(let i=0;i<Math.ceil(seconds/.05);i++){now+=50;for(const p of hold)match.interact(p,{held:true},now);match.tick(now);}},setTime:n=>now=n};
}

test('Co-op starts with race health, AN-94, individual wallets and isolated board/zone state',async()=>{
  const a=await fixture({races:['tauren','bloodelf']}),b=await fixture();
  try{
    assert.equal(a.players[0].hp,105);assert.equal(a.players[0].weapon.index,0);assert.deepEqual([...a.players[0].survival.owned],[0]);assert.equal(a.players[0].survival.points,500);assert.equal(a.players[1].weapon.reserve,Math.floor(a.players[0].weapon.gun.reserve*1.1));
    a.environment.setBoards(a.environment.windows[0],0);assert.equal(b.environment.windows[0].boards,6);
    a.players[0].survival.points=1000;assert.equal(a.match.purchase(a.players[0],a.environment.gates[0]).ok,true);assert.equal(a.players[0].survival.points,250);assert.equal(a.players[1].survival.points,500);assert.ok(a.players[1].survival.zones.has(1));assert.equal(b.environment.unlockedZones.has(1),false);
    const before=a.players[1].survival.points;a.players[1].survival.points=2000;assert.equal(a.match.purchase(a.players[1],a.environment.gates[0]).ok,false);assert.equal(a.players[1].survival.points,2000);assert.equal(before,500);assert.equal(a.environment.activeWindows[0].zone,1);
  }finally{a.match.dispose();b.match.dispose();}
});

test('Downed bodies stay fixed; no shots/purchases; revive requires one sustained nearby helper',async()=>{
  const f=await fixture({races:['orc','forsaken','gnome']}),[a,b,c]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];b.position=[1,2.45,0];c.position=[1.5,2.45,0];b.protectedUntil=0;b.survival.perks.add('juggernog');m.damagePlayer(b,999,f.now);
    assert.equal(b.status,'downed');assert.equal(b.bleedoutAt-f.now,36000);assert.equal(b.survival.perks.size,0);const old=b.position.slice(),ammo=b.weapon.ammo;
    assert.equal(m.pose(b,new f.T.Vector3(9,2.45,0),f.now),false);assert.deepEqual(b.position,old);assert.equal(m.shoot(b,[0,1,0]),false);assert.equal(b.weapon.ammo,ammo);assert.equal(m.purchase(b,m.environment.gates[0]).ok,false);
    m.interact(a,{held:true});m.interact(c,{held:true});a.weapon.ammo--;a.survival.owned.add(1);const helperAmmo=a.weapon.ammo;assert.equal(m.shoot(a,[0,1,-5]),false);assert.equal(a.weapon.ammo,helperAmmo);assert.equal(m.reload(a),false);assert.equal(m.switchWeapon(a,1),false);assert.equal(a.weapon.index,0);
    m.tickInteractions(1,f.now);assert.equal(b.revive.by,a.id);assert.equal(b.revive.progress,1,'helpers cannot add two seconds per second');
    a.position=[7,2.45,0];m.tickInteractions(.1,f.now);assert.equal(b.revive.by,c.id);assert.equal(b.revive.progress,.1,'changing helper resets progress');
    m.interact(c,{held:false});assert.equal(b.revive,null);a.position=[0,2.45,0];
    f.advance(3.8,{hold:[a]});assert.equal(b.status,'downed');f.advance(.25,{hold:[a]});assert.equal(b.status,'alive');assert.equal(b.hp,40);assert.ok(b.protectedUntil>f.now);assert.equal(a.revives,1);
  }finally{m.dispose();}
});

test('LOS, stale heartbeat, release, damage and target changes interrupt revive progress',async()=>{
  const f=await fixture({races:['orc','orc','orc']}),[a,b,c]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];b.position=[1,2.45,0];c.position=[-2,2.45,0];b.protectedUntil=c.protectedUntil=0;m.damagePlayer(b,999);m.damagePlayer(c,999);m.interact(a,{held:true});m.tickInteractions(.5,f.now);assert.ok(b.revive);
    f.wall(true);m.tickInteractions(.1,f.now);assert.equal(b.revive,null);f.wall(false);m.tickInteractions(.5,f.now);assert.ok(b.revive);
    f.setTime(f.now+400);m.tickInteractions(.1,f.now);assert.equal(b.revive,null);m.interact(a,{held:true});m.tickInteractions(.5,f.now);a.protectedUntil=0;m.damagePlayer(a,1);assert.equal(b.revive,null);m.tickInteractions(.5,f.now);assert.equal(b.revive,null,'taking damage requires a fresh hold');
    m.interact(a,{held:false});m.interact(a,{held:true});m.tickInteractions(.5,f.now);assert.ok(b.revive);
    m.interact(a,{held:true,target:c.id});assert.equal(b.revive,null);m.tickInteractions(.1,f.now);assert.equal(c.revive.progress,.1,'explicit farther target wins over nearest');
    m.interact(a,{held:true,target:b.id});assert.equal(c.revive,null);m.tickInteractions(.5,f.now);assert.ok(b.revive);m.interact(a,{held:true});a.position=[-1.5,2.45,0];m.tickInteractions(.1,f.now);assert.equal(b.revive,null);assert.equal(c.revive.progress,.1);
    f.players.splice(f.players.indexOf(a),1);m.leave(a.id);assert.equal(c.revive,null);
  }finally{m.dispose();}
});

test('Quick Revive and Human aid teammates; bleedout returns next wave and squad wipe ends',async()=>{
  const f=await fixture(),[a,b]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];b.position=[1,2.45,0];b.protectedUntil=0;a.survival.perks.add('quick_revive');m.damagePlayer(b,999);m.interact(a,{held:true});m.tickInteractions(.1,f.now);assert.equal(b.revive.duration,1.7);
    f.advance(1.65,{hold:[a]});assert.equal(b.status,'alive');m.interact(a,{held:false});b.protectedUntil=0;m.damagePlayer(b,999);b.bleedoutAt=f.now+50;m.countdown=0;m.config={speed:0,damage:0,entryDelay:1};m.queued=1;m.spawnDelay=100;f.advance(.05);assert.equal(b.status,'dead');m.queued=0;f.advance(.05);assert.equal(b.status,'alive');assert.equal(m.wave,2);assert.deepEqual([...b.survival.owned],[0]);
    a.protectedUntil=b.protectedUntil=0;m.damagePlayer(a,999);m.damagePlayer(b,999);f.advance(.05);assert.equal(f.ended,'scourge');
  }finally{m.dispose();}
});

test('Authoritative undead hits stop at city and fort cover and never hurt teammates',async()=>{
  const f=await fixture(),[a,b]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];b.position=[0,2.45,-3];a.weapon.releaseTrigger();m.shoot(a,[0,1.5,-3]);assert.equal(b.hp,100,'opposing factions cooperate');
    m.config={health:80};m.spawnUnit();const u=m.units[0];u.entry=null;u.position.set(0,0,-5);a.weapon.cooldown=0;a.weapon.releaseTrigger();f.wall(true);m.shoot(a,[0,1.2,-5]);assert.equal(u.hp,80);f.wall(false);
    const wall=new f.T.Mesh(new f.T.BoxGeometry(2,3,.2),new f.T.MeshBasicMaterial());wall.position.set(0,1.5,-2);m.environment.shotCollider.add(wall);a.weapon.cooldown=0;a.weapon.releaseTrigger();m.shoot(a,[0,1.2,-5]);assert.equal(u.hp,80);wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();
    a.weapon.cooldown=0;a.weapon.releaseTrigger();m.shoot(a,[0,1.2,-5]);assert.ok(u.hp<80);assert.equal(a.survival.points,510);assert.equal(b.hp,100);
  }finally{m.dispose();}
});

test('Queued undead walk covered approach, break boards, then cross the entry before chasing',async()=>{
  const f=await fixture(),m=f.match;
  try{
    m.config={health:80,speed:1.6,damage:20,entryDelay:1};m.queued=2;m.spawnUnit();const u=m.units[0],entry=u.entry,start=u.position.clone();
    m.tickUnit(u,.1,f.now);assert.ok(u.position.distanceTo(start)>0);assert.equal(entry.boards,6);assert.ok(u.entry);
    for(let i=0;i<180&&entry.boards;i++)m.tickUnit(u,.1,f.now+i*100);
    assert.equal(entry.boards,0);assert.ok(u.entry,'board break does not teleport unit');
    for(let i=0;i<60&&u.entry;i++)m.tickUnit(u,.1,f.now+20000+i*100);
    assert.equal(u.entry,null);assert.ok(u.position.distanceTo(entry.inside)<1);
  }finally{m.dispose();}
});

test('Authoritative knife works empty, earns normal kill points, and cannot cross cover or interrupt revive',async()=>{
  const f=await fixture(),[a,b]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];b.position=[1,2.45,0];a.weapon.ammo=0;a.weapon.reserve=0;m.config={health:80};m.spawnUnit();const unit=m.units[0];unit.entry=null;unit.position.set(0,0,-1.5);
    f.wall(true);assert.equal(m.melee(a,[0,1.6,-2]),true);assert.equal(unit.hp,80);assert.equal(a.survival.points,500);assert.equal(a.weapon.ammo,0);
    f.wall(false);assert.equal(m.melee(a,[0,1.6,-2]),false);f.setTime(f.now+800);a.weapon.tick(.8,false,false);
    const wall=new f.T.Mesh(new f.T.BoxGeometry(2,3,.2),new f.T.MeshBasicMaterial());wall.position.set(0,1.5,-.7);m.environment.shotCollider.add(wall);
    assert.equal(m.melee(a,[0,1.6,-2]),true);assert.equal(unit.hp,80,'board geometry blocks knife');wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();
    f.setTime(f.now+800);a.weapon.tick(.8,false,false);assert.equal(m.melee(a,[0,1.6,-2]),true);assert.equal(unit.alive,false);assert.equal(a.kills,1);assert.equal(a.survival.points,610);assert.equal(b.hp,100);assert.equal(f.messages.at(-1).type,'melee');assert.equal(f.messages.at(-1).killed,true);
    assert.equal(m.shoot(a,[0,1.6,-2]),false);f.setTime(f.now+800);a.weapon.tick(.8,false,false);b.protectedUntil=0;m.damagePlayer(b,999);m.interact(a,{held:true});assert.equal(m.melee(a,[0,1.6,-2]),false,'reviving disables knife');assert.equal(m.melee(b,[0,1.6,-2]),false,'downed disables knife');
  }finally{m.dispose();}
});

test('Purchases require nearby accessible targets and repairs take held time',async()=>{
  const f=await fixture(),[a]=f.players,m=f.match;
  try{
    a.position=[0,2.45,0];a.yaw=0;a.pitch=0;a.survival.points=3000;m.interact(a,{held:true,target:'gate-1'});f.wall(true);m.tickInteractions(.1,f.now);assert.equal(a.survival.points,3000);f.wall(false);a.position=[50,2.45,0];m.tickInteractions(.1,f.now);assert.equal(a.survival.points,3000);
    a.position=[0,2.45,0];m.tickInteractions(.1,f.now);assert.equal(a.survival.points,2250);assert.ok(m.environment.unlockedZones.has(1));m.tickInteractions(.1,f.now);assert.equal(a.survival.points,2250);
    const w=m.environment.activeWindows[0];a.position=w.inside.clone().add(new f.T.Vector3(0,2.45,2)).toArray();m.environment.setBoards(w,0);m.interact(a,{held:false});m.interact(a,{held:true,target:w.id});m.tickInteractions(.7,f.now);assert.equal(w.boards,0);m.tickInteractions(.05,f.now);assert.equal(w.boards,1);assert.equal(a.survival.points,2260);
  }finally{m.dispose();}
});

test("Last survivor's Who's Who delays squad wipe, needs a fresh hold, and expires after fifteen seconds",async()=>{
  const a=await fixture({races:['orc']}),b=await fixture({races:['orc']});
  try{
    for(const f of [a,b]){const p=f.players[0];p.survival.perks.add('whos_who');p.protectedUntil=0;f.match.damagePlayer(p,999);f.advance(.05);assert.equal(p.status,'downed');assert.equal(f.ended,null);}
    a.advance(7.9,{hold:a.players});assert.equal(a.players[0].status,'downed');a.advance(.2,{hold:a.players});assert.equal(a.players[0].status,'alive');assert.equal(a.ended,null);assert.equal(a.players[0].survival.perks.has('whos_who'),false);
    b.advance(15);assert.equal(b.ended,'scourge');
  }finally{a.match.dispose();b.match.dispose();}
});

test('WebSocket lobby supports one-to-four mixed-faction survivors, rejects fifth and migrates host',async()=>{
  const http=require('node:http'),{WebSocket}=require('ws'),{attachMultiplayer}=await import('../server/multiplayer.mjs'),f=await fixture({start:false});
  const server=http.createServer(),net=attachMultiplayer(server,{autoTick:false,clock:()=>f.now,arenaLoader:async()=>f.arena,zombieFactory:opts=>new f.ZombieMatch({...opts,nav:f.nav,environment:f.environment})}),sockets=[];
  const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  async function connect(){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),client={messages:[],send:m=>ws.send(JSON.stringify(m)),ws};sockets.push(ws);ws.on('message',raw=>{const m=JSON.parse(raw);client.messages.push(m);if(m.type==='welcome')client.id=m.id;if(m.type==='room')client.room=m.room;});await wait(()=>client.id);return client;}
  try{
    const a=await connect();a.send({type:'create',mode:'zombies'});await wait(()=>a.room);a.send({type:'ready',ready:true});await wait(()=>a.room.players[0].ready);a.send({type:'start'});await wait(()=>a.room.zombies);assert.equal(a.room.phase,'loading');assert.deepEqual(a.room.zombies.spawn,[0,2.45,0]);a.send({type:'loaded',code:a.room.code,loadGeneration:a.room.loadGeneration,layoutRevision:a.room.layoutRevision});await wait(()=>net.clients.get(a.id).loaded);net.tick();assert.equal(net.rooms.get(a.room.code).phase,'countdown');f.setTime(f.now+3100);net.tick();assert.equal(net.rooms.get(a.room.code).phase,'playing');assert.equal(net.clients.get(a.id).weapon.index,0);
    const room=net.rooms.get(a.room.code);room.phase='ended';a.send({type:'return'});await wait(()=>a.room.phase==='waiting');
    const b=await connect(),c=await connect(),d=await connect(),e=await connect();for(const peer of [b,c,d]){peer.send({type:'profile',team:'horde',race:'orc'});peer.send({type:'join',code:a.room.code});await wait(()=>peer.room);}assert.equal(d.room.players.length,4);e.send({type:'join',code:a.room.code});await wait(()=>e.messages.some(m=>m.type==='error'));assert.equal(room.members.length,4);
    a.send({type:'settings',mode:'tdm'});await wait(()=>room.mode==='tdm');a.send({type:'profile',team:'alliance',race:'draenei'});await wait(()=>net.clients.get(a.id).race==='draenei');for(const peer of [a,b,c,d])peer.send({type:'ready',ready:true});await wait(()=>[...room.members].every(id=>net.clients.get(id).ready));a.send({type:'start'});await wait(()=>room.phase==='loading'&&room.arena&&[a,b,c,d].every(peer=>peer.room.layoutRevision===room.layoutRevision));for(const peer of [a,b,c,d])peer.send({type:'loaded',code:peer.room.code,loadGeneration:peer.room.loadGeneration,layoutRevision:peer.room.layoutRevision});await wait(()=>room.members.every(id=>net.clients.get(id).loaded));net.tick();f.setTime(f.now+3100);net.tick();const player=net.clients.get(a.id);assert.equal(room.phase,'playing');player.hp=10;player.lastHurt=0;
    // Reload/fire share the weapon clock; they must not truncate health regeneration's elapsed time.
    for(let i=0;i<20;i++){f.setTime(f.now+50);a.send({type:'reload'});await wait(()=>player.lastTick===f.now);f.setTime(f.now+50);net.tick();}
    assert.ok(Math.abs(player.hp-37.6)<.0001,'Draenei regeneration remains 13.8 HP/sec while weapon actions advance their own clock');
    room.phase='ended';a.send({type:'return'});await wait(()=>a.room.phase==='waiting');a.ws.close();await wait(()=>b.room?.host===b.id);assert.equal(b.room.players.length,3);assert.equal(b.room.players.every(p=>p.team==='horde'),true);
  }finally{for(const ws of sockets)ws.terminate();net.close();await new Promise(r=>server.close(r));f.match.dispose();}
});
