const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
const {timeline}=require('./fixtures/weapon-timeline.cjs');
async function setup(){return {...await import('../src/engine/weapon-simulation.mjs'),...await import('../src/engine/firing-modes.mjs'),...await import('../src/engine/aim.mjs'),...await import('../src/weapon-data.js')};}
const idx=(GUNS,id)=>GUNS.findIndex(g=>g.id===id);
const lcg=(seed=1)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function sim(m,id){const s=new m.WeaponSimulation(m.GUNS);s.select(idx(m.GUNS,id));s.tick(.01,false,false);return s;}

test('Original four guns keep identical simulated timelines (golden values captured before the firing-mode change)',async()=>{
  const golden={
    0:{shots:33,final:'899,0,0,92,0,1.438333,0,0,0.708654',hash:'6ca0e560777dcd66b39aec7174b8f510b2b96f6095d793ed248d4c967a4b8acd'},
    1:{shots:31,final:'899,0,0,93,0,1.333333,0,0,0.708654',hash:'5144542658d018336d589a5a86e9d27939e3d6cdca0ee96ad25d44ee26c591c8'},
    2:{shots:3,final:'899,0,4,15,0.341667,0,0,0,2.576923',hash:'1e26107249b1f0e43bc8f05da1de21861fd18394d84fb3c564fc40bcff5d7266'},
    3:{shots:4,final:'899,0,5,21,1.101667,0,0,0.000625,2.576923',hash:'abefeb5f794d444d8a6434392e5dc88724c191cb3a7f6703ac72775eac36c544'}};
  for(const i of [0,1,2,3])assert.deepEqual(await timeline(i),golden[i],'gun '+i);
});
test('Weapon data exposes the expected mode for every gun and the original four are auto/bolt',async()=>{
  const m=await setup(),modes=Object.fromEntries(m.GUNS.map(g=>[g.id,m.fireModeOf(g)]));
  assert.deepEqual([0,1,2,3].map(i=>modes[m.GUNS[i].id]),['auto','auto','bolt','bolt']);
  assert.equal(modes.sig556_mp,'burst');assert.equal(modes['870mcs_mp'],'pump');assert.equal(modes.fiveseven_mp,'semi');assert.equal(modes.as50_mp,'semi');assert.equal(modes.mk48_mp,'auto');
  assert.equal(m.GUNS.length,12);
});
test('Semi-auto fires once per trigger press and needs a fresh press',async()=>{
  const m=await setup(),s=sim(m,'fiveseven_mp'),g=s.gun;
  s.tick(.01,false,false);assert.ok(s.fire());assert.equal(s.cooldown,g.interval);s.tick(g.interval+.01,false,true);assert.equal(s.fire(),false,'held trigger does not fire again');
  s.tick(.01,false,false);assert.ok(s.fire(),'release and press fires');assert.equal(s.ammo,g.capacity-2);
  s.tick(g.interval/2,false,false);assert.equal(s.fire(),false,'cooldown still enforced on a fresh press');
  // Servers only see the trigger through the pose channel, so they limit by cooldown alone.
  s.tick(1,false,true);assert.ok(s.fire({trustCooldown:true}));assert.equal(s.fire({trustCooldown:true}),false);
});
test('Burst: one press is one burst, rounds spaced by the interval, then a cooldown and a fresh press',async()=>{
  const m=await setup(),s=sim(m,'sig556_mp'),g=s.gun,b=m.burstOf(g);assert.equal(b.count,3);
  assert.ok(s.fire());assert.equal(s.burstLeft,2);assert.equal(s.cooldown,g.interval);assert.ok(s.wantsFire(false),'the burst continues after the trigger is released');
  assert.equal(s.fire(),false,'no second round before the interval');
  s.tick(g.interval,false,true);assert.ok(s.fire());s.tick(g.interval,false,true);assert.ok(s.fire());assert.equal(s.burstLeft,0);assert.equal(s.cooldown,b.cooldown);assert.equal(s.wantsFire(false),false);
  assert.equal(s.ammo,g.capacity-3);
  s.tick(b.cooldown+.01,false,true);assert.equal(s.fire(),false,'held trigger does not start another burst');
  s.tick(.01,false,false);assert.ok(s.fire());assert.equal(s.ammo,g.capacity-4);
  const t=sim(m,'sig556_mp');t.ammo=2;t.fire();t.tick(g.interval,false,true);assert.ok(t.fire());assert.equal(t.burstLeft,0,'running dry ends the burst');assert.equal(t.cooldown,b.cooldown);
  const r=sim(m,'sig556_mp');r.fire();assert.ok(r.burstLeft>0);r.ammo=5;r.cooldown=0;r.reload();assert.equal(r.burstLeft,0,'reload cancels the burst');
});
test('Full-auto SMG and LMG keep the rate of fire; LMG has a long belt reload and slow ADS',async()=>{
  const m=await setup(),s=sim(m,'mp7_mp');let shots=0;for(let i=0;i<120;i++){s.tick(1/120,false,true);if(s.fire())shots++;}
  assert.ok(shots>=14&&shots<=17,'MP7 about 15.6 rounds per second, got '+shots);
  const l=sim(m,'mk48_mp');assert.equal(l.gun.capacity,100);assert.equal(l.gun.magazine,null);l.ammo=10;assert.ok(l.reload());assert.equal(l.reloadDuration,8);assert.ok(l.gun.adsIn>m.GUNS[0].adsIn);
  l.tick(7.9,false,false);assert.equal(l.ammo,10);l.tick(.2,false,false);assert.equal(l.ammo,100);assert.equal(l.reserve,400-90);
});
test('Pump shotgun: pellets, per-pellet damage curve, falloff and body multipliers',async()=>{
  const m=await setup(),g=m.GUNS[idx(m.GUNS,'870mcs_mp')];
  assert.equal(m.pelletCount(g),8);assert.equal(m.damageAt(g,3)*m.pelletCount(g),400,'8 pellets x 50 at point blank');
  assert.ok(Math.abs(m.damageAt(g,9.525)-30)<1e-6);assert.equal(m.damageAt(g,15),10);assert.equal(m.damageAt(g,5,'locHead'),50*g.multipliers.locHead);
  assert.equal(m.pelletCount({pellets:1000}),m.MAX_PELLETS);assert.equal(m.pelletCount({pellets:0}),1);assert.equal(m.pelletCount({}),1);assert.equal(m.pelletCount({pellets:'x'}),1);
  assert.equal(m.tracerCount(g),3);assert.equal(m.tracerCount(m.GUNS[0]),1);assert.equal(m.tracerCount({pellets:2}),2);
});
test('Pellet pattern is deterministic, stays inside the cone and tightens when aimed',async()=>{
  const m=await setup(),g=m.GUNS[idx(m.GUNS,'870mcs_mp')],dir=[0,0,-1];
  const hip=m.pelletDirections(g,dir,{rng:lcg(7)}),again=m.pelletDirections(g,dir,{rng:lcg(7)}),aimed=m.pelletDirections(g,dir,{ads:1,rng:lcg(7)});
  assert.equal(hip.length,8);assert.deepEqual(hip,again);
  const angle=d=>Math.acos(Math.min(1,-d[2]))*180/Math.PI,cone=m.pelletConeDegrees(g,0,0);
  assert.equal(cone,g.hipSpread*.5);assert.ok(hip.every(d=>Math.abs(Math.hypot(...d)-1)<1e-9&&angle(d)<=cone+1e-6));
  assert.ok(Math.max(...hip.map(angle))>cone*.5,'pellets actually spread');
  assert.ok(Math.max(...aimed.map(angle))<=g.adsSpread*.5+1e-6);assert.ok(m.pelletConeDegrees(g,0,10)>cone,'movement bloom widens the cone');
  assert.deepEqual(m.pelletDirections(m.GUNS[0],dir,{rng:()=>{throw Error('no RNG for single bullets');}}),[dir]);
  assert.ok(Math.abs(Math.hypot(...m.offsetDirection([0,1,0],.1,.2))-1)<1e-9);assert.deepEqual(m.offsetDirection(dir,0,0),dir);
});
test('Pump action cycles between shots and needs a fresh press; empty magazine does not fire',async()=>{
  const m=await setup(),s=sim(m,'870mcs_mp'),g=s.gun;
  assert.ok(s.fire());assert.equal(s.cooldown,g.cycle);assert.equal(s.ammo,7);s.tick(g.cycle-.01,false,true);assert.equal(s.fire(),false,'still cycling');
  s.tick(.02,false,true);assert.equal(s.fire(),false,'held trigger');s.tick(.01,false,false);assert.ok(s.fire());
  s.ammo=0;s.tick(2,false,false);assert.equal(s.fire(),false);assert.equal(s.ammo,0);
});
test('Shell reload inserts one shell at a time with start and end phases',async()=>{
  const m=await setup(),s=sim(m,'870mcs_mp'),g=s.gun;s.ammo=2;assert.ok(s.reload());
  assert.equal(s.reloadDuration,g.reloadStart+6*g.reloadPerShell+g.reloadEnd);
  s.tick(g.reloadStart-.01,false,false);assert.equal(s.ammo,2);s.tick(g.reloadPerShell+.02,false,false);assert.equal(s.ammo,3);assert.equal(s.reserve,g.reserve-1);
  s.tick(g.reloadPerShell*2,false,false);assert.equal(s.ammo,5);
  s.tick(10,false,false);assert.equal(s.ammo,8);assert.equal(s.reserve,g.reserve-6);assert.equal(s.reloadLeft,0);assert.equal(s.reload(),false,'full');
  const t=sim(m,'870mcs_mp');t.ammo=0;t.reserve=2;t.reload();assert.equal(t.reloadDuration,g.reloadStart+2*g.reloadPerShell+g.reloadEnd,'limited by reserve');t.tick(20,false,false);assert.equal(t.ammo,2);assert.equal(t.reserve,0);
  const u=sim(m,'870mcs_mp');u.ammo=3;u.reserve=0;assert.equal(u.reload(),false);
  const fast={...g,reload:g.reload*.5},v=new m.WeaponSimulation([fast]);v.ammo=0;v.reload();assert.ok(Math.abs(v.reloadDuration-(g.reloadStart+8*g.reloadPerShell+g.reloadEnd)*.5)<1e-9,'perks that scale gun.reload scale every phase');
});
test('Firing interrupts a shell reload and keeps the shells already loaded',async()=>{
  const m=await setup(),s=sim(m,'870mcs_mp'),g=s.gun;s.ammo=0;s.reload();
  assert.equal(s.fire(),false,'nothing loaded yet');
  s.tick(g.reloadStart+g.reloadPerShell*2+.01,false,false);assert.equal(s.ammo,2);
  assert.ok(s.fire(),'fire during the reload');assert.equal(s.reloadLeft,0);assert.equal(s.shell,null);assert.equal(s.ammo,1);assert.equal(s.reserve,g.reserve-2);
  s.tick(g.cycle+.01,false,false);assert.equal(s.ammo,1,'reload does not resume by itself');assert.equal(s.reserve,g.reserve-2);
  const t=sim(m,'870mcs_mp');t.ammo=7;t.reload();t.tick(g.reloadStart+g.reloadPerShell+.01,false,false);assert.equal(t.ammo,8);assert.equal(t.reloadLeft>0,true);
  const u=sim(m,'870mcs_mp');u.ammo=6;u.reload();u.tick(g.reloadStart+g.reloadPerShell+.01,false,false);u.cooldown=1;assert.equal(u.fire(),false,'a rejected shot does not cancel the reload');assert.ok(u.reloadLeft>0);
  const w=sim(m,'870mcs_mp');w.ammo=7;w.reload();w.tick(g.reloadStart+g.reloadPerShell+.01,false,false);w.tick(g.reloadEnd*.9,false,false);assert.ok(w.reloadLeft>0);assert.equal(w.fire(),false,'the closing phase cannot be interrupted');
  const bolt=sim(m,'dsr50_mp');bolt.ammo=2;bolt.reload();assert.equal(bolt.fire(),false,'magazine reloads are never interruptible');
});
test('Selecting another gun mid shell reload keeps the loaded shells and clears the reload',async()=>{
  const m=await setup(),s=sim(m,'870mcs_mp'),g=s.gun,i=s.index;s.ammo=0;s.reload();s.tick(g.reloadStart+g.reloadPerShell+.01,false,false);s.select(0);assert.equal(s.reloadLeft,0);assert.equal(s.shell,null);s.select(i);assert.equal(s.inventory[i].ammo,1);
});
test('Per-class handling caps spread and kick; the original rifle and sniper values are unchanged',async()=>{
  const m=await setup(),by=Object.fromEntries(m.GUNS.map(g=>[g.id,g]));
  assert.equal(m.spreadDegrees(by.an94_mp,0),.55);assert.equal(m.spreadDegrees(by.dsr50_mp,0),2);
  for(const id of ['mp7_mp','vector_mp','fiveseven_mp','mk48_mp','870mcs_mp','as50_mp']){const g=by[id],cap=m.HANDLING[g.class].hipCap;assert.equal(m.spreadDegrees(g,0),Math.min(g.hipSpread,cap),id);assert.ok(m.spreadDegrees(g,0,100)<=cap*1.5+1e-9);assert.equal(m.spreadDegrees(g,1,100),0);}
  assert.ok(m.spreadDegrees(by.mk48_mp,0)>m.spreadDegrees(by.mp7_mp,0));
  assert.equal(m.kickAfterShot(0,by.an94_mp),.003);assert.equal(m.kickAfterShot(0,by.dsr50_mp),.009);assert.equal(m.kickAfterShot(0,{}),.003);
  assert.equal(m.kickAfterShot(0,{...by.mp7_mp,recoil:.5}),m.HANDLING.smg.kick*.5);
  for(const g of m.GUNS){let k=0;for(let i=0;i<50;i++)k=m.kickAfterShot(k,g);assert.ok(k<=.012);}
});
test('Weapon simulation supports every gun index',async()=>{
  const m=await setup(),s=new m.WeaponSimulation(m.GUNS);assert.equal(s.inventory.length,12);
  for(let i=0;i<12;i++){s.select(i);assert.equal(s.index,i);assert.equal(s.ammo,m.GUNS[i].capacity);}
});

// ---- Authoritative server -------------------------------------------------------------------------------------
const wait=async predicate=>{const until=Date.now()+12000;while(!predicate()){if(Date.now()>until)throw Error('Timed out');await new Promise(r=>setTimeout(r,20));}};
test('Server: pump cycle gates fire messages, one ammo per shot, pellet rays capped, damage summed',skipUnlessAssets('stormwind.json','props/stormwind.json'),async()=>{
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),T=await import('three'),{GUNS}=await import('../src/weapon-data.js');
  const server=http.createServer(),net=attachMultiplayer(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const sockets=[];
  async function connect(){const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),c={ws,messages:[],send:m=>ws.send(JSON.stringify(m))};sockets.push(ws);ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='welcome')c.id=m.id;if(m.type==='room')c.room=m.room;});await wait(()=>c.id);return c;}
  const realRandom=Math.random;let seed=3;
  try{
    const a=await connect(),b=await connect();a.send({type:'profile',name:'Alpha'});a.send({type:'create'});await wait(()=>a.room);b.send({type:'profile',name:'Bravo',team:'horde'});b.send({type:'join',code:a.room.code});await wait(()=>a.room.players.length===2);
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await wait(()=>a.room.players.every(p=>p.ready));a.send({type:'start'});await wait(()=>a.room.phase==='loading'&&a.room.layoutRevision&&b.room.layoutRevision);
    for(const peer of [a,b])peer.send({type:'loaded',code:peer.room.code,loadGeneration:peer.room.loadGeneration,layoutRevision:peer.room.layoutRevision});
    await wait(()=>a.room.phase==='countdown');const room=net.rooms.get(a.room.code);room.startsAt=Date.now()-1;await wait(()=>a.room.phase==='playing');
    const pa=net.clients.get(a.id),pb=net.clients.get(b.id),origin=room.arena.spawns[0];
    const clear=p=>!room.arena.trace(origin.clone().add(new T.Vector3(0,2.1,0)),p.clone().add(new T.Vector3(0,1.3,0)));
    const target=room.arena.spawns.find(p=>p.distanceTo(origin)>6&&p.distanceTo(origin)<11&&clear(p))||room.arena.spawns.find(p=>p.distanceTo(origin)>6&&p.distanceTo(origin)<20&&clear(p));assert.ok(target);
    const place=()=>{pa.position=origin.clone().add(new T.Vector3(0,2.45,0)).toArray();pb.position=target.clone().add(new T.Vector3(0,2.45,0)).toArray();pa.protectedUntil=pb.protectedUntil=0;pb.hp=100;};place();
    Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const shotgun=GUNS.findIndex(g=>g.id==='870mcs_mp'),aim=target.clone().add(new T.Vector3(0,1.3,0)).toArray();
    pa.weapon.select(shotgun);pa.weapon.cooldown=0;pa.trigger=false;
    const shots=()=>a.messages.filter(m=>m.type==='shot');
    a.send({type:'fire',target:aim});await wait(()=>shots().length===1);
    const first=shots()[0];assert.equal(first.gun,shotgun);assert.equal(first.pellets,8);assert.equal(first.tos.length,3);assert.deepEqual(first.to,first.tos[0]);assert.equal(pa.weapon.ammo,GUNS[shotgun].capacity-1,'one shell for the whole spread');
    assert.ok(pb.hp<100,'pellets hit the target');assert.ok(100-pb.hp<=8*50+1e-6);assert.ok(pa.weapon.cooldown>0.5,'pump cycle running');
    place();a.send({type:'fire',target:aim});a.send({type:'fire',target:aim});await new Promise(r=>setTimeout(r,150));
    assert.equal(shots().length,1,'faster than the pump cycle is rejected');assert.equal(pa.weapon.ammo,GUNS[shotgun].capacity-1);
    pa.weapon.cooldown=0;a.send({type:'fire',target:aim});await wait(()=>shots().length===2);assert.equal(pa.weapon.ammo,GUNS[shotgun].capacity-2);
    // A tampered gun definition cannot make the server trace more than MAX_PELLETS rays.
    pa.weapon.guns[shotgun]={...pa.weapon.guns[shotgun],pellets:100000};pa.weapon.cooldown=0;place();
    a.send({type:'fire',target:aim});await wait(()=>shots().length===3);assert.equal(shots()[2].pellets,16);assert.ok(shots()[2].tos.length<=3);
    // Full-auto guns still produce a plain single-ray shot message.
    pa.weapon.select(0);pa.weapon.cooldown=0;pa.weapon.triggerLatched=false;a.send({type:'fire',target:aim});await wait(()=>shots().length===4);assert.equal(shots()[3].pellets,undefined);assert.equal(shots()[3].tos,undefined);
    // Semi-auto: the server limits it by cooldown alone.
    const pistol=GUNS.findIndex(g=>g.id==='fiveseven_mp');pa.weapon.select(pistol);pa.weapon.cooldown=0;pa.weapon.triggerLatched=true;a.send({type:'fire',target:aim});await wait(()=>shots().length===5);
    a.send({type:'fire',target:aim});await new Promise(r=>setTimeout(r,20));assert.equal(shots().length,5,'second tap inside the semi interval is ignored');
  }finally{Math.random=realRandom;for(const ws of sockets)ws.terminate();net.close();await new Promise(r=>server.close(r));}
});
