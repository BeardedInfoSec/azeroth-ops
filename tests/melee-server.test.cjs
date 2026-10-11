const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Timed out');};

test('LAN knife validates reach, cover, cooldown, protection, teams, death and Royale deployment',async()=>{
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),T=await import('three');
  let now=10000,wall=false;const server=http.createServer(),net=attachMultiplayer(server,{clock:()=>now,autoTick:false}),peers=[];
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  async function connect(){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),peer={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};peers.push(peer);ws.on('message',raw=>{const message=JSON.parse(raw);peer.messages.push(message);if(message.type==='welcome')peer.id=message.id;});await wait(()=>peer.id);return peer;}
  try{
    const a=await connect(),b=await connect(),attacker=net.clients.get(a.id),victim=net.clients.get(b.id);
    const room={code:'KNIFE',members:[a.id,b.id],host:a.id,phase:'playing',mode:'tdm',city:'stormwind',target:50,duration:600,score:{alliance:0,horde:0},winner:null,sentries:[],startsAt:0,endsAt:now+600000,arena:{trace:(from,to)=>wall?{point:from.clone().lerp(to,.5)}:null,origin:new T.Vector3(),spawn:()=>[0,2.45,0]}};
    net.rooms.set(room.code,room);for(const p of [attacker,victim]){p.room=room.code;p.hp=100;p.deployment='landed';p.weapon.ammo=0;p.weapon.reserve=0;}
    attacker.position=[0,2.45,0];victim.position=[0,2.45,-1.5];victim.team='horde';victim.race='orc';
    const events=()=>a.messages.filter(m=>m.type==='melee');
    async function action(message){const old=a.messages.filter(m=>m.type==='rooms').length;a.send(message);a.send({type:'list'});await wait(()=>a.messages.filter(m=>m.type==='rooms').length>old);}
    function recover(){for(let i=0;i<5;i++){now+=200;net.tick();}victim.hp=100;victim.respawnAt=0;victim.protectedUntil=0;}
    const knife={type:'melee',target:[0,1.5,-2]};
    await action(knife);assert.equal(victim.hp,0);assert.equal(attacker.weapon.ammo,0);assert.equal(attacker.kills,1);assert.equal(events().at(-1).killed,true);assert.equal(room.score.alliance,1);
    victim.hp=100;await action(knife);assert.equal(victim.hp,100);assert.equal(events().length,1,'request spam cannot bypass cooldown');
    recover();wall=true;await action(knife);assert.equal(victim.hp,100);assert.equal(events().at(-1).hit,false);wall=false;
    recover();victim.position=[0,2.45,-3];await action(knife);assert.equal(victim.hp,100,'out of reach');victim.position=[0,2.45,-1.5];
    recover();victim.protectedUntil=now+2000;await action(knife);assert.equal(victim.hp,100,'spawn protection');
    recover();victim.team='alliance';await action(knife);assert.equal(victim.hp,100,'friendly fire disabled');
    recover();attacker.hp=0;const before=events().length;await action(knife);assert.equal(events().length,before,'dead players cannot attack');attacker.hp=100;
    recover();room.mode='royale';attacker.deployment='gliding';await action(knife);assert.equal(events().length,before,'airborne players cannot attack');
    attacker.deployment='landed';victim.deployment='landed';await action(knife);assert.equal(victim.hp,0,'same faction is hostile in FFA');assert.equal(events().at(-1).hit,true);
  }finally{for(const peer of peers)peer.ws.terminate();net.close();await new Promise(resolve=>server.close(resolve));}
});
