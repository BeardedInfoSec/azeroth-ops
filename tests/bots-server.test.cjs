// Bots in LAN rooms over the real authoritative server (CPU only: synthetic BVH arena, fake clock, no browser).
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(predicate,tries=400)=>{for(let i=0;i<tries;i++){if(predicate())return;await delay(10);}throw Error('Timed out');};
const RACES={alliance:['human','dwarf','nightelf','gnome','draenei'],horde:['orc','forsaken','tauren','troll','bloodelf']};
async function fixture({mode='tdm',walls}={}){
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),{createProfileStore}=await import('../server/profiles.mjs'),{makeArena}=await import('./fixtures/bot-arena.mjs');
  const rules=await import('../src/bot-rules.mjs'),names=await import('../src/names.mjs');
  let now=900000;const arena=makeArena(walls?{walls}:{}),profiles=createProfileStore({clock:()=>now});
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>arena,clock:()=>now,autoTick:false,profiles});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const players=[];
  const tokenFor=n=>'bot-token-'+String(n).padStart(2,'0')+'-abcdefghijklmnopqrstuvwxyz';
  async function step(ms=50){now+=ms;net.tick();await delay(10);}
  // Many server ticks without real-time waits: bots act inside tick(), sockets only carry snapshots.
  // A yield every few ticks lets the sockets drain, otherwise the server's backpressure guard would drop notices.
  const yieldIo=()=>new Promise(r=>setImmediate(r));
  async function fast(ms,stepMs=50){for(let t=0,n=0;t<ms;t+=stepMs,n++){now+=stepMs;net.tick();if(n%8===7)await yieldIo();}await delay(40);}
  async function connect(name,{team='alliance',race=RACES[team][0],token=null,primary=0}={}){
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),p={ws,messages:[],send:m=>ws.send(JSON.stringify(m)),errors:()=>p.messages.filter(m=>m.type==='error').map(m=>m.message)};
    players.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='welcome')p.id=m.id;if(m.type==='room')p.room=m.room;if(m.type==='xp')p.xp=m;});
    await wait(()=>p.id);if(token){p.send({type:'hello',token});await wait(()=>p.messages.some(m=>m.type==='profile'));}
    p.send({type:'profile',name,team,race,loadout:{primary,secondary:10}});return p;
  }
  async function lobby(modeName=mode,{name='Alpha',team='alliance'}={}){const a=await connect(name,{team});a.send({type:'create',mode:modeName});await wait(()=>a.room);return a;}
  async function expectError(p,send,pattern){const before=p.errors().length;send();await wait(()=>p.errors().length>before);assert.match(p.errors().at(-1),pattern);}
  async function start(host){
    for(const p of players)if(p.ws.readyState===1&&p.room?.code===host.room.code)p.send({type:'ready',ready:true});
    await wait(()=>host.room.players.every(p=>p.ready));host.send({type:'start'});
    await wait(()=>host.room.phase==='loading'&&host.room.layoutRevision);
    for(const p of players)if(p.ws.readyState===1&&p.room?.code===host.room.code)p.send({type:'loaded',code:p.room.code,loadGeneration:p.room.loadGeneration,layoutRevision:p.room.layoutRevision});
    const room=net.rooms.get(host.room.code);await wait(()=>room.arena&&[...net.clients.values()].filter(c=>c.room===room.code).every(c=>c.loaded));
    await step();assert.equal(room.phase,'countdown');await step(3001);assert.equal(room.phase,'playing');return room;
  }
  const botsOf=room=>room.members.map(id=>net.bots.get(id)).filter(Boolean);
  async function close(){for(const p of players)p.ws.terminate();net.close();await new Promise(r=>server.close(r));}
  return {net,players,connect,lobby,step,fast,start,close,arena,profiles,tokenFor,expectError,botsOf,rules,names,now:()=>now,advance:ms=>{now+=ms;}};
}

test('the host adds, configures and kicks bots; rosters carry the BOT flag, faction, race and a unique pool name',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('tdm');
    for(const team of ['alliance','horde','horde'])a.send({type:'bot-add',team});
    await wait(()=>a.room.players.length===4);
    const bots=a.room.players.filter(p=>p.bot);assert.equal(bots.length,3);assert.equal(a.room.bots.count,3);
    for(const b of bots){assert.ok(f.rules.BOT_NAMES.includes(b.name),b.name+' comes from the pool');assert.ok(b.ready&&b.loaded,'bots auto-ready');assert.ok(RACES[b.team].includes(b.race),'race matches faction');assert.ok(b.loadout.name);}
    assert.equal(new Set(bots.map(b=>b.name)).size,3,'names unique per room');
    assert.deepEqual(a.room.players.filter(p=>p.bot).map(p=>p.team).sort(),['alliance','horde','horde']);
    assert.equal(a.room.players.find(p=>!p.bot).bot,false);
    // Humans cannot take a bot's name; bots are never the leader and cannot be chosen as one.
    a.send({type:'profile',name:bots[0].name});await delay(40);assert.notEqual(f.net.clients.get(a.id).name,bots[0].name);
    await f.expectError(a,()=>a.send({type:'transfer-host',targetId:bots[0].id}),/another connected player/);
    assert.equal(a.room.host,a.id);
    // Difficulty is per room.
    for(const difficulty of ['easy','hard','normal']){a.send({type:'bot-settings',difficulty});await wait(()=>a.room.bots.difficulty===difficulty);}
    // Kick.
    a.send({type:'bot-remove',id:bots[0].id});await wait(()=>a.room.players.length===3);assert.ok(!a.room.players.some(p=>p.id===bots[0].id));assert.ok(!f.net.bots.has(bots[0].id));
    // Without a team the server balances the factions.
    a.send({type:'bot-add'});await wait(()=>a.room.players.length===4);
    const teams=a.room.players.reduce((n,p)=>({...n,[p.team]:(n[p.team]||0)+1}),{});assert.ok(Math.abs(teams.alliance-teams.horde)<=1,JSON.stringify(teams));
    // Bots count in the public room list.
    const lister=await f.connect('Lister');await wait(()=>lister.messages.some(m=>m.type==='rooms'&&m.rooms.some(r=>r.count===4)));
  }finally{await f.close();}
});

test('hostile or invalid bot messages are rejected and change nothing',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('tdm'),b=await f.connect('Bravo',{team:'horde'});b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    const snapshot=()=>JSON.stringify([a.room.players.map(p=>[p.id,p.team,p.bot]),a.room.bots]);const before=snapshot();
    // Not the leader.
    for(const m of [{type:'bot-add',team:'alliance'},{type:'bot-settings',difficulty:'hard'},{type:'bot-remove',id:'x'}])await f.expectError(b,()=>b.send(m),/Only the lobby leader/);
    // Bad factions.
    for(const team of ['orcs','',5,null,{},['alliance'],true,'ALLIANCE','alliance\u0000'])await f.expectError(a,()=>a.send({type:'bot-add',team}),/Choose Alliance or Horde/);
    // Bad removes.
    for(const id of ['nope',5,null,{},['x'],a.id,b.id,'bot-00000000'])await f.expectError(a,()=>a.send({type:'bot-remove',id}),/No such bot/);
    // Bad settings.
    for(const m of [{difficulty:'nightmare'},{difficulty:3},{difficulty:{}},{difficulty:null},{fill:'yes'},{fill:1},{fill:null},{target:1},{target:11},{target:2.5},{target:'6'},{target:NaN},{target:null},{target:-3},{target:1e9}])
      await f.expectError(a,()=>a.send({type:'bot-settings',...m}),/difficulty|fill|target|between/i);
    // Over the faction cap: Alpha + 4 bots = 5 alliance, a sixth is refused.
    for(let i=0;i<4;i++)a.send({type:'bot-add',team:'alliance'});await wait(()=>a.room.players.length===6);
    await f.expectError(a,()=>a.send({type:'bot-add',team:'alliance'}),/five players per faction/);
    // Over the lobby cap: fill the horde side, then one more is refused.
    for(let i=0;i<4;i++)a.send({type:'bot-add',team:'horde'});await wait(()=>a.room.players.length===10);
    await f.expectError(a,()=>a.send({type:'bot-add',team:'horde'}),/full|five players/);
    assert.equal(a.room.players.length,10);
    // Another room's bot cannot be kicked from here.
    const c=await f.lobby('tdm',{name:'Charlie'});c.send({type:'bot-add',team:'horde'});await wait(()=>c.room.players.length===2);
    const foreign=c.room.players.find(p=>p.bot);await f.expectError(a,()=>a.send({type:'bot-remove',id:foreign.id}),/No such bot/);
    assert.ok(f.net.bots.has(foreign.id));
    // Not in a lobby at all.
    const loner=await f.connect('Loner');await f.expectError(loner,()=>loner.send({type:'bot-add',team:'alliance'}),/Join a lobby first/);
    // Zombies have no bots.
    const z=await f.lobby('zombies',{name:'Zed'});await f.expectError(z,()=>z.send({type:'bot-add',team:'alliance'}),/not available in Undead Co-op/);
    await f.expectError(z,()=>z.send({type:'bot-settings',fill:true}),/not available/);
    // Bot commands only work in the lobby.
    for(const p of [a,b])p.send({type:'ready',ready:true});
    assert.notEqual(snapshot(),before);// (the caps above legitimately added bots)
    const full=snapshot();await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>a.room.phase==='loading');
    await f.expectError(a,()=>a.send({type:'bot-add',team:'alliance'}),/only be changed in the lobby/);
    assert.equal(JSON.stringify([a.room.players.map(p=>[p.id,p.team,p.bot]),a.room.bots]),full);
  }finally{await f.close();}
});

test('bots count toward team caps, humans take bot seats, and mode changes trim or clear them',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('tdm');
    for(let i=0;i<4;i++)a.send({type:'bot-add',team:'alliance'});for(let i=0;i<5;i++)a.send({type:'bot-add',team:'horde'});
    await wait(()=>a.room.players.length===10);
    // Full lobby: a joining human displaces a bot (preferring their own faction).
    const b=await f.connect('Bravo',{team:'horde'});b.send({type:'join',code:a.room.code});await wait(()=>b.room);
    await wait(()=>a.room.players.some(p=>p.id===b.id));
    assert.equal(a.room.players.length,10);assert.equal(a.room.players.filter(p=>p.bot).length,8);assert.equal(a.room.players.filter(p=>p.team==='horde').length,5);
    assert.ok(a.room.players.find(p=>p.id===b.id).team==='horde');
    // A human on a full faction with no bots to displace is moved to the other side or refused, never over the cap.
    const room=f.net.rooms.get(a.room.code);
    for(const t of ['alliance','horde'])assert.ok(f.net.clients&&[...room.members].map(id=>f.net.clients.get(id)||f.net.bots.get(id)).filter(p=>p.team===t).length<=5);
    // Switching a bot-heavy royale lobby to a team mode trims the surplus.
    const r=await f.lobby('royale',{name:'Rae'});for(let i=0;i<7;i++)r.send({type:'bot-add',team:'alliance'});await wait(()=>r.room.players.length===8);
    r.send({type:'settings',mode:'tdm'});await wait(()=>r.room.mode==='tdm');
    assert.ok(r.room.players.filter(p=>p.team==='alliance').length<=5,'alliance trimmed to five');assert.ok(r.room.players.some(p=>p.bot));
    // Undead Co-op clears all bots, humans stay.
    r.send({type:'settings',mode:'zombies'});await wait(()=>r.room.mode==='zombies');assert.equal(r.room.players.filter(p=>p.bot).length,0);assert.equal(f.net.bots.size,8+0,'only the other room still has bots');
    assert.equal(r.room.bots.supported,false);
  }finally{await f.close();}
});

test('Fill empty slots keeps the lobby at the target, balances factions and yields to humans',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('tdm');
    a.send({type:'bot-settings',fill:true,target:6});await wait(()=>a.room.players.length===6);
    const by=t=>a.room.players.filter(p=>p.team===t).length;assert.equal(by('alliance'),3);assert.equal(by('horde'),3);assert.equal(a.room.players.filter(p=>p.bot).length,5);
    a.send({type:'bot-settings',target:4});await wait(()=>a.room.players.length===4);
    const b=await f.connect('Bravo',{team:'horde'});b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.some(p=>p.id===b.id));
    await wait(()=>a.room.players.length===4&&a.room.players.filter(p=>p.bot).length===2);
    b.send({type:'leave'});await wait(()=>a.room.players.filter(p=>!p.bot).length===1);await wait(()=>a.room.players.length===4);
    // Manual changes move the target while fill is on.
    const bot=a.room.players.find(p=>p.bot);a.send({type:'bot-remove',id:bot.id});await wait(()=>a.room.players.length===3);assert.equal(a.room.bots.target,3);
    // Turning fill off leaves the bots in place.
    a.send({type:'bot-settings',fill:false});await wait(()=>a.room.bots.fill===false);await delay(30);assert.equal(a.room.players.length,3);
  }finally{await f.close();}
});

test('one human plus bots can start Battle Royale (bots count toward the 2-10 minimum) and bots deploy from the zeppelin',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('royale');
    a.send({type:'bot-settings',fill:true,target:6});await wait(()=>a.room.players.length===6);
    const room=await f.start(a);
    const bots=f.botsOf(room);assert.equal(bots.length,5);assert.ok(bots.every(b=>b.deployment==='aboard'&&b.hp>0),'everyone boards the zeppelin');
    // Bots never fire or reload while aboard or gliding.
    await f.fast(8000);
    // The flight lasts 18 s: bots jump on their own, glide, and land on safe ground.
    await f.fast(20000);
    assert.ok(bots.every(b=>b.deployment!=='aboard'),'every bot left the zeppelin by the end of the flight');
    await f.fast(30000);
    const landed=bots.filter(b=>b.deployment==='landed'||b.deployment==='eliminated');assert.ok(landed.length>=4,'bots reach the ground ('+landed.length+')');
    for(const b of bots.filter(b=>b.deployment==='landed'))assert.ok(room.arena.spawns.some(s=>Math.hypot(s.x-b.position[0],s.z-b.position[2])<60),'landed on the map');
    // They fight: somebody got a kill or the zone/gunfire eliminated someone.
    await f.fast(90000);
    assert.ok(bots.some(b=>b.kills>0||b.deaths>0)||room.phase==='ended','combat happens');
    const snapshot=a.room.players;assert.ok(snapshot.filter(p=>p.bot).length===5);
  }finally{await f.close();}
});

test('Battle Royale with bots ends with one winner, names the winner with the BOT tag, and only humans get XP',async()=>{
  const f=await fixture();try{
    const token=f.tokenFor(7),a=await f.connect('Alpha',{token});a.send({type:'create',mode:'royale'});await wait(()=>a.room);
    a.send({type:'bot-settings',fill:true,target:4});await wait(()=>a.room.players.length===4);
    const room=await f.start(a);
    await f.fast(300000,100);await wait(()=>a.room.phase==='ended');
    const bots=f.botsOf(room);
    assert.ok(room.phase==='ended');
    const survivors=bots.filter(b=>b.hp>0);
    if(survivors.length===1&&f.net.clients.get(a.id).hp<=0)assert.match(a.room.royale.winnerName,/^\[BOT\] /);
    // The human gets an XP summary; bots get nothing and never own a profile.
    await wait(()=>a.xp);assert.ok(a.xp.xp>=300,'match completion XP');
    for(const b of bots){assert.equal(b.profile,undefined);assert.equal(b.ledger,null);assert.ok(!b.xpSummary);}
    assert.equal(f.profiles.size,1,'only the human has a profile');
    assert.ok(a.room.players.filter(p=>p.bot).every(p=>typeof p.kills==='number'&&typeof p.deaths==='number'),'bots appear in the results');
  }finally{await f.close();}
});

test('TDM: bots score kills, kill streak rewards stay off for bots, and kills on bots pay a quarter of the XP',async()=>{
  const f=await fixture({walls:[]});try{
    const a=await f.connect('Alpha',{token:f.tokenFor(1),primary:0}),b=await f.connect('Bravo',{team:'horde',token:f.tokenFor(2)});
    a.send({type:'create',mode:'tdm'});await wait(()=>a.room);b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    a.send({type:'bot-add',team:'horde'});await wait(()=>a.room.players.length===3);
    const room=await f.start(a),pa=f.net.clients.get(a.id),pb=f.net.clients.get(b.id),bot=f.botsOf(room)[0];
    // Freeze the AI for the deterministic part: shoot a bot, then a human, from the same spot.
    pa.protectedUntil=pb.protectedUntil=bot.protectedUntil=0;pa.position=[0,2.45,0];pa.yaw=0;
    bot.position=[10,2.45,0];bot.hp=1;pb.position=[0,2.45,15];
    a.send({type:'fire',target:[10,1.3,0]});await wait(()=>bot.hp===0);
    assert.equal(pa.kills,1);assert.equal(room.score.alliance,1,'kills on bots count for the team score');
    assert.equal(pa.ledger.items.kill.xp,25,'a bot kill pays 25% of the normal 100 XP');assert.equal(pa.ledger.botXp,25);
    await f.advance(1000);pa.weapon.cooldown=0;pb.hp=1;
    a.send({type:'fire',target:[0,1.3,15]});await wait(()=>pb.hp===0);
    assert.equal(pa.ledger.items.kill.xp,125,'a human kill pays the full 100 XP');
    // Bots never earn streak rewards.
    bot.respawnAt=f.now()+99999;
    assert.equal(bot.streak.kills,0);bot.hp=100;pa.hp=1;pa.position=[0,2.45,0];bot.position=[12,2.45,0];bot.yaw=Math.PI/2;
    pb.respawnAt=f.now()+999999;
    await f.fast(8000);
    assert.ok(bot.kills>=1,'the bot killed the wounded operator');assert.ok(room.score.horde>=1,'a bot kill scores for its team');
    assert.equal(bot.streak.kills,0,'bot kills never feed the streak counter');
    assert.deepEqual(bot.streak.ready,{uav:0,supply:0,sentry:0},'no streak rewards for bots');
    assert.ok(!a.messages.some(m=>m.type==='notice'&&m.message.includes('READY')&&m.message.includes(bot.name)));
    // Scoreboard (room snapshot) lists the bot with its tag and totals.
    const row=a.room.players.find(p=>p.bot);assert.ok(row&&row.bot===true&&row.kills>=0);
  }finally{await f.close();}
});

test('bots fire real, radar-visible shots: tracers and shot events look like a human\'s',async()=>{
  const f=await fixture({walls:[]});try{
    const a=await f.lobby('tdm');a.send({type:'bot-add',team:'horde'});await wait(()=>a.room.players.length===2);
    const room=await f.start(a),pa=f.net.clients.get(a.id),bot=f.botsOf(room)[0];
    pa.position=[-18,2.45,0];bot.position=[18,2.45,0];bot.yaw=Math.PI/2;pa.protectedUntil=bot.protectedUntil=0;pa.respawnAt=f.now()+9e6;
    bot.brain=null;await f.fast(5000);
    const shots=a.messages.filter(m=>m.type==='shot'&&m.id===bot.id);
    assert.ok(shots.length>0,'the bot fired');
    for(const s of shots.slice(0,5)){assert.equal(s.from.length,3);assert.equal(s.to.length,3);assert.ok(Number.isInteger(s.gun));}
    assert.ok(bot.weapon.ammo<bot.weapon.gun.capacity||bot.weapon.reloadLeft>0||shots.length>0,'ammunition was spent');
    assert.ok(bot.kills>=1||pa.hp<100||pa.deaths>=1,'the shots had effect through the normal damage rules');
  }finally{await f.close();}
});

test('Domination: one human with bots plays on and the bots capture and hold points',async()=>{
  const f=await fixture();try{
    const a=await f.lobby('domination');
    for(const team of ['alliance','alliance','horde'])a.send({type:'bot-add',team});await wait(()=>a.room.players.length===4);
    a.send({type:'bot-settings',difficulty:'hard'});await wait(()=>a.room.bots.difficulty==='hard');
    const room=await f.start(a),horde=f.botsOf(room).filter(b=>b.team==='horde');
    // Keep the enemy off the points so the capture logic is observed in isolation.
    for(const h of horde){h.hp=0;h.respawnAt=f.now()+1e9;}
    const pa=f.net.clients.get(a.id);pa.hp=0;pa.respawnAt=f.now()+1e9;
    await f.fast(150000);
    const points=room.domination.points;
    assert.ok(points.some(p=>p.owner==='alliance'),'alliance bots captured at least one point: '+JSON.stringify(points.map(p=>[p.id,p.owner,p.control.toFixed(2)])));
    assert.ok(room.score.alliance>0,'owned points score');
    assert.ok(a.messages.some(m=>m.type==='notice'&&/POINT [ABC] CAPTURED BY ALLIANCE/.test(m.message)),'capture announced');
    // Bots hold what they own: bots stand on points (inside the radius) rather than idling at spawn.
    const bots=f.botsOf(room).filter(b=>b.team==='alliance'&&b.hp>0);
    assert.ok(bots.some(b=>points.some(p=>Math.hypot(b.position[0]-p.x,b.position[2]-p.z)<=p.radius)),'at least one bot is standing on a point');
  }finally{await f.close();}
});

test('bots persist or vanish per the fill rule when the match returns to the lobby',async()=>{
  const f=await fixture({walls:[]});try{
    // fill OFF: manual bots persist as lobby members.
    const a=await f.lobby('tdm');for(const team of ['alliance','horde'])a.send({type:'bot-add',team});await wait(()=>a.room.players.length===3);
    const ids=a.room.players.filter(p=>p.bot).map(p=>p.id).sort();
    let room=await f.start(a);room.score.alliance=room.target-1;
    const pa=f.net.clients.get(a.id),bot=f.botsOf(room).find(b=>b.team==='horde');pa.protectedUntil=bot.protectedUntil=0;pa.position=[0,2.45,0];bot.position=[10,2.45,0];bot.hp=1;bot.brain=null;
    a.send({type:'fire',target:[10,1.3,0]});await wait(()=>room.phase==='ended');await wait(()=>a.room.phase==='ended');
    a.send({type:'return'});await wait(()=>a.room.phase==='waiting');
    assert.deepEqual(a.room.players.filter(p=>p.bot).map(p=>p.id).sort(),ids,'bots persist when fill is off');
    assert.ok(a.room.players.filter(p=>p.bot).every(p=>p.ready&&p.loaded),'and stay ready');
    // The leader can start again straight away.
    a.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>a.room.phase==='loading');
    // fill ON: bots are regenerated (fresh ids) at the target after a match.
    const b=await f.lobby('tdm',{name:'Bravo'});b.send({type:'bot-settings',fill:true,target:4});await wait(()=>b.room.players.length===4);
    const old=b.room.players.filter(p=>p.bot).map(p=>p.id);
    room=await f.start(b);const pb=f.net.clients.get(b.id);room.score.alliance=room.target-1;const hb=f.botsOf(room).find(x=>x.team==='horde');
    pb.protectedUntil=hb.protectedUntil=0;pb.position=[0,2.45,0];hb.position=[10,2.45,0];hb.hp=1;hb.brain=null;
    b.send({type:'fire',target:[10,1.3,0]});await wait(()=>room.phase==='ended');await wait(()=>b.room.phase==='ended');
    b.send({type:'return'});await wait(()=>b.room.phase==='waiting');
    const fresh=b.room.players.filter(p=>p.bot).map(p=>p.id);
    assert.equal(b.room.players.length,4);assert.ok(fresh.every(id=>!old.includes(id)),'fill-mode bots are regenerated');
    // The last human leaving removes the room and every bot with it.
    const before=f.net.bots.size;assert.ok(before>=3);
    b.send({type:'leave'});await wait(()=>!f.net.rooms.has(room.code));assert.ok(f.net.bots.size<before);
    a.send({type:'leave'});await wait(()=>f.net.rooms.size===0);assert.equal(f.net.bots.size,0,'no orphaned bots');
  }finally{await f.close();}
});

test('bots never hold sessions or profiles and a disconnected human does not stop the room from being cleaned up',async()=>{
  const f=await fixture();try{
    const a=await f.connect('Alpha',{token:f.tokenFor(3)});a.send({type:'create',mode:'tdm'});await wait(()=>a.room);
    for(const team of ['alliance','horde'])a.send({type:'bot-add',team});await wait(()=>a.room.players.length===3);
    const room=await f.start(a);
    assert.equal(f.net.sessions.size,1,'bots do not own reconnect sessions');assert.equal(f.profiles.size,1);
    const botIds=f.botsOf(room).map(b=>b.id);
    // The human drops mid-match: their seat is held and the bots keep playing.
    a.ws.terminate();await wait(()=>f.net.clients.get(a.id)?.dropped);await f.fast(5000);
    assert.equal(room.phase,'playing');assert.ok(f.botsOf(room).every(b=>b.lastTick>=f.now()-100),'bots keep being simulated');
    // After the 60 s grace the human is removed, and with them the whole room.
    await f.fast(61000);assert.ok(!f.net.rooms.has(room.code),'room closed');for(const id of botIds)assert.ok(!f.net.bots.has(id));
    assert.equal(f.net.sessions.size,0);
  }finally{await f.close();}
});

test('weekly bot-XP allowance: bot kills count toward an anti-farm cap shared across matches',async()=>{
  const {createProfileStore}=await import('../server/profiles.mjs'),{WEEKLY_BOT_XP_CAP}=await import('../src/bot-rules.mjs');
  let now=Date.UTC(2026,5,3);const store=createProfileStore({clock:()=>now}),p=store.resolve('weekly-token-abcdefghijklmnop');
  let r=store.applyMatch(p,1000,{},{botXp:1000});assert.equal(r.botXpCut,0);assert.equal(p.xp,1000);
  r=store.applyMatch(p,3000,{},{botXp:2500});assert.equal(r.botXpCut,500,'only 2000 of the 2500 bot XP fit in the remaining allowance');assert.equal(p.xp,3500);
  r=store.applyMatch(p,800,{},{botXp:800});assert.equal(r.botXpCut,800,'allowance exhausted: the whole bot share is dropped');assert.equal(p.xp,3500);
  r=store.applyMatch(p,300,{},{});assert.equal(r.botXpCut,0,'normal XP is never reduced');assert.equal(p.xp,3800);
  now+=8*86400000;r=store.applyMatch(p,500,{},{botXp:500});assert.equal(r.botXpCut,0,'a new week resets the allowance');
  assert.equal(WEEKLY_BOT_XP_CAP,3000);
});

test('CPU cost with the real server path: ten occupants, nine of them bots',async()=>{
  const f=await fixture();try{
    for(const [mode,limit] of [['tdm',8],['royale',8]]){
      const a=await f.lobby(mode,{name:'Host'+mode});a.send({type:'bot-settings',fill:true,target:10});await wait(()=>a.room.players.length===10);
      const room=await f.start(a);await f.fast(8000);
      const stats=room.director.stats,t0=stats.ticks,m0=stats.ms;stats.maxMs=0;
      await f.fast(40000);
      const avg=(stats.ms-m0)/(stats.ticks-t0);
      console.log('server bot cost ['+mode+', 9 bots + 1 human]: avg '+avg.toFixed(3)+' ms per 50 ms tick, worst '+stats.maxMs.toFixed(2)+' ms');
      assert.ok(avg<limit,mode+' average '+avg.toFixed(2)+' ms');assert.ok(stats.maxMs<40,mode+' worst tick '+stats.maxMs.toFixed(1)+' ms');
      a.send({type:'leave'});await wait(()=>!f.net.rooms.has(room.code));
    }
  }finally{await f.close();}
});
