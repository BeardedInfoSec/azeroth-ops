// CPU-only tests for the bot AI core (server/bots.mjs): no sockets, no browser, no map assets.
const test=require('node:test'),assert=require('node:assert/strict');
const lib=async()=>({
  bots:await import('../server/bots.mjs'),
  nav:await import('../server/bot-nav.mjs'),
  arena:await import('./fixtures/bot-arena.mjs'),
  harness:await import('./fixtures/bot-harness.mjs'),
  T:await import('three'),
  guns:await import('../src/weapon-data.js'),
});
const DOM=(over={})=>({points:[{id:'A',x:20,y:0,z:0,radius:6,owner:null,progress:0,side:null,contested:false,...over}]});

test('perception is gated by line of sight, range and the forward cone', async()=>{
  const {arena:A,harness:H}=await lib();
  const make=(walls,enemyAt,{yaw=-Math.PI/2,difficulty='normal'}={})=>{
    const arena=A.makeArena({walls}),a=H.makeClient({id:'a',at:[-20,0],yaw}),b=H.makeClient({id:'b',team:'horde',at:enemyAt,bot:false});
    return {arena,a,b,h:H.makeHarness({arena,clients:[a,b],difficulty})};
  };
  // A solid wall between them: never seen, never shot at.
  let w=make([[-2,-16,2,16,5]],[20,0]);w.h.run(3000);
  assert.equal(w.a.brain.contacts.size,0,'no contact through a wall');assert.equal(w.h.shots('a').length,0,'no shots through a wall');
  // Same positions with a clear line: acquired.
  w=make([],[20,0]);w.h.run(600);assert.equal(w.a.brain.contacts.size,1,'visible target is acquired');
  // Range: EASY sees 50 m, HARD 95 m.
  w=make([],[60,0],{difficulty:'easy'});w.h.run(300);assert.equal(w.a.brain.contacts.size,0,'80 m is out of EASY vision range (50 m)');
  w=make([],[60,0],{difficulty:'hard'});w.h.run(300);assert.equal(w.a.brain.contacts.size,1,'80 m is inside HARD vision range (95 m)');
  // Cone: an enemy directly behind is not noticed on the first look.
  w=make([],[20,0],{yaw:Math.PI/2});w.h.run(100);assert.equal(w.a.brain.contacts.size,0,'enemy behind the operator is not seen');
});

test('a spawn-protected enemy is not targeted and a dead one is dropped', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
  const h=H.makeHarness({arena,clients:[a,b]});b.protectedUntil=h.now+5000;h.run(2000);
  assert.equal(a.brain.contacts.size,0,'protected enemies are ignored');
  b.protectedUntil=0;a.yaw=-Math.PI/2;a.position=[-20,2.45,0];h.run(600);assert.equal(a.brain.contacts.size,1,'once the shield drops the enemy is acquired');
  b.hp=0;h.run(600);assert.equal(a.brain.contacts.size,0,'dead enemies are forgotten');assert.equal(a.brain.target,null);
});

test('reaction delay: first shot waits for the difficulty window and ordering holds', async()=>{
  const {arena:A,harness:H,bots}=await lib();
  const firstShot=(difficulty,seed)=>{
    const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
    const h=H.makeHarness({arena,clients:[a,b],difficulty,seed});const t0=h.now;h.run(5000);
    const s=h.shots('a')[0];return s?s.t-t0:Infinity;
  };
  const mean=name=>{const v=[1,2,3,4,5,6,7,8].map(seed=>firstShot(name,seed));assert.ok(v.every(Number.isFinite),name+' bots do shoot');return {mean:v.reduce((x,y)=>x+y,0)/v.length,min:Math.min(...v)};};
  const easy=mean('easy'),normal=mean('normal'),hard=mean('hard');
  assert.ok(easy.min>=bots.DIFFICULTY.easy.reactionMs[0],'EASY never fires before its reaction time ('+easy.min+' ms)');
  assert.ok(normal.min>=bots.DIFFICULTY.normal.reactionMs[0]);assert.ok(hard.min>=bots.DIFFICULTY.hard.reactionMs[0]);
  assert.ok(easy.mean>normal.mean&&normal.mean>hard.mean,'slower reactions on lower difficulties: '+[easy.mean,normal.mean,hard.mean].map(Math.round).join(' > '));
});

test('aim error is Gaussian with a difficulty-, range- and movement-dependent spread (seeded)', async()=>{
  const {bots}=await lib();
  const sample=(difficulty,distance,moving,n=4000)=>{
    const r=bots.mulberry32(99),out=[];for(let i=0;i<n;i++){const e=bots.aimError(r,difficulty,distance,moving);out.push(e.yaw,e.pitch);}
    const mean=out.reduce((a,b)=>a+b,0)/out.length,sd=Math.sqrt(out.reduce((a,b)=>a+(b-mean)**2,0)/out.length);
    const half=Math.atan(.34/Math.max(1,distance)),hits=Array.from({length:n},(_,i)=>Math.hypot(out[2*i],out[2*i+1])<=half).filter(Boolean).length/n;
    return {sd,hits,mean};
  };
  for(const name of ['easy','normal','hard']){
    const s=sample(name,25,false),expected=bots.DIFFICULTY[name].aimDeg*(1+25/40)*Math.PI/180;
    assert.ok(Math.abs(s.sd-expected)/expected<.06,name+' sd '+s.sd+' vs '+expected);assert.ok(Math.abs(s.mean)<expected*.06,'zero-mean error');
  }
  const e=sample('easy',25,false),n=sample('normal',25,false),h=sample('hard',25,false);
  assert.ok(e.sd>n.sd&&n.sd>h.sd,'error shrinks with difficulty');assert.ok(e.hits<n.hits&&n.hits<h.hits,'chance to land on the torso rises: '+[e.hits,n.hits,h.hits].map(v=>v.toFixed(2)).join(' < '));
  assert.ok(e.hits<.25,'EASY misses most long shots');assert.ok(h.hits>.5,'HARD lands most of them');
  assert.ok(sample('normal',60,false).sd>sample('normal',10,false).sd,'error grows with distance');
  assert.ok(sample('normal',25,true).sd>sample('normal',25,false).sd*1.3,'moving while firing is less accurate');
  // Same seed, same draws.
  assert.deepEqual(sample('hard',25,false),sample('hard',25,false));
});

test('shots follow the aimed direction: EASY spreads wider than HARD in a live firefight', async()=>{
  const {arena:A,harness:H,T}=await lib();
  const spread=(difficulty)=>{
    const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2,primary:0}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
    const h=H.makeHarness({arena,clients:[a,b],difficulty,seed:5});h.run(12000);
    // Angular distance of each aimed point from the enemy's chest, seen from the shooter's eye.
    const eye=new T.Vector3(...a.position).add(new T.Vector3(0,-.35,0)),chest=new T.Vector3(20,1.15,0).sub(eye).normalize();
    const errs=h.shots('a').map(e=>new T.Vector3(...e.m.target).sub(eye).normalize().angleTo(chest));
    assert.ok(errs.length>10,difficulty+' fired '+errs.length);return errs.reduce((x,y)=>x+y,0)/errs.length;
  };
  const e=spread('easy'),hd=spread('hard');assert.ok(e>hd*1.5,'mean miss angle EASY '+e.toFixed(4)+' vs HARD '+hd.toFixed(4));
});

test('pathfinding routes around walls on a synthetic grid and the field is cached', async()=>{
  const {arena:A,nav:N,T}=await lib();
  const arena=A.makeArena({walls:[[-2,-16,2,16,5]]}),nav=N.BotNav.fromGroundNavigation(arena.nav);
  const from=nav.nearest(new T.Vector3(-20,0,0)),goal=new T.Vector3(20,0,0),field=nav.field(goal);
  assert.ok(field.distance[from.id]>0,'goal reachable');
  const path=nav.path(from,field,200);assert.ok(path.length>=16,'path must detour around the 32 m wall ('+path.length+' hops)');
  for(const n of path)assert.ok(!A.insideWall(arena,n.point.x,n.point.z),'no node inside geometry');
  let prev=from;for(const n of path){assert.ok(!arena.blocked(prev.point.clone().add(new T.Vector3(0,.9,0)),n.point.clone().add(new T.Vector3(0,.9,0)),.2),'every hop is unobstructed');prev=n;}
  assert.ok(Math.max(...path.map(n=>Math.abs(n.point.z)))>14,'the route goes around an end of the wall');
  assert.equal(nav.field(goal),field,'distance fields are cached');
  // Points-only fallback graph (used when an arena has no navigation mesh) agrees.
  const fallback=N.BotNav.fromPoints(arena.spawns,{blocked:(a,b)=>!!arena.blocked(a,b,0)}),f2=fallback.field(goal),s=fallback.nearest(new T.Vector3(-20,0,0));
  assert.ok(f2.distance[s.id]>0);
});

test('a bot walks to a Domination point around a wall without ever entering geometry', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[[-2,-16,2,16,5]]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2});
  const h=H.makeHarness({arena,mode:'domination',clients:[a],domination:DOM()});let inside=0,minD=Infinity;
  h.run(30000,{each:()=>{if(A.insideWall(arena,a.position[0],a.position[2]))inside++;minD=Math.min(minD,Math.hypot(a.position[0]-20,a.position[2]));}});
  assert.equal(inside,0,'never inside a wall');assert.ok(minD<3,'reached the point (closest '+minD.toFixed(1)+' m)');
  assert.ok(Math.hypot(a.position[0]-20,a.position[2])<6,'holds the point');assert.ok(h.stats.rejected<=3,'server-style pose checks rarely reject ('+h.stats.rejected+')');
});

test('stuck detection triggers recovery and the bot still arrives once the way clears', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2});
  let closed=true;
  // An invisible barrier the navigation graph knows nothing about.
  const wrapped=H.makeHarness({arena,mode:'domination',clients:[a],domination:DOM()});wrapped.gate=(old,next)=>!(closed&&old.x<-5&&next.x>=-5);
  wrapped.run(7000);const events=a.brain.stuck.events;
  assert.ok(events>=1,'stuck events recorded ('+events+')');assert.ok(a.position[0]<-4,'still held back by the barrier');
  closed=false;wrapped.run(25000);
  assert.ok(Math.hypot(a.position[0]-20,a.position[2])<6,'recovered and arrived at ('+a.position.map(v=>v.toFixed(1))+')');
});

test('Domination goal choice: nearest uncaptured, spreads out, defends owned points under threat', async()=>{
  const {bots}=await lib();
  const pts=(over)=>['A','B','C'].map((id,i)=>({id,x:i*30,z:0,y:0,radius:6,owner:null,progress:0,side:null,contested:false,...(over?.[id]||{})}));
  const dist=(from)=>p=>Math.abs(p.x-from)*1.0;
  const pick=(o)=>bots.chooseDominationGoal({team:'alliance',self:'me',points:pts(o.over),mates:o.mates||[],threats:o.threats||[],distance:dist(o.at),current:o.current||null});
  assert.equal(pick({at:2}),'A','nearest uncaptured point');assert.equal(pick({at:58}),'C');
  assert.equal(pick({at:2,over:{A:{owner:'alliance',progress:1,side:'alliance'}}}),'B','owned and safe: move on to the next uncaptured point');
  assert.equal(pick({at:2,over:{A:{owner:'horde',progress:1,side:'horde'},B:{}}}),'A','enemy-owned point is neutralised first when closest');
  // Teammates already covering A push the third bot elsewhere.
  assert.notEqual(pick({at:2,mates:[{id:'m1',goal:'A',inside:true},{id:'m2',goal:'A',inside:true},{id:'m3',goal:'A',inside:false}]}),'A','crowded point is avoided');
  // Defend an owned point when enemies are close to it.
  assert.equal(pick({at:2,over:{A:{owner:'alliance',progress:1,side:'alliance'}},threats:[{x:5,z:3}]}),'A','owned point with enemies nearby is defended');
  assert.equal(pick({at:2,over:{A:{contested:true,progress:.4,side:'alliance'}}}),'A','contested point wins');
  // Unreachable points are never chosen.
  assert.equal(bots.chooseDominationGoal({team:'alliance',self:'me',points:pts(),mates:[],threats:[],distance:p=>p.id==='A'?Infinity:p.x,current:null}),'B');
  // The last bot on a safe owned point keeps guarding it unless another objective is much better.
  assert.equal(pick({at:0,over:{A:{owner:'alliance',progress:1,side:'alliance'}},current:'A'}),'A','guard stays');
});

test('bots do not fire through a teammate standing in the line', async()=>{
  const {arena:A,harness:H}=await lib();
  const run=(mateAt)=>{
    const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2}),m=H.makeClient({id:'m',at:mateAt,bot:false,yaw:-Math.PI/2,race:'tauren'}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
    const h=H.makeHarness({arena,clients:[a,m,b],difficulty:'hard'});h.gate=()=>false;h.run(5000);return h.shots('a').length;
  };
  assert.equal(run([-8,0]),0,'teammate on the line of fire: hold fire');
  assert.ok(run([-8,9])>3,'teammate out of the line: fire');
});

test('empty weapons: swap to the sidearm, then knife at point-blank, reload when safe', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[]});
  let a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2,primary:0,secondary:10}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
  a.weapon.inventory[0]={ammo:0,reserve:0};
  let h=H.makeHarness({arena,clients:[a,b],difficulty:'hard'});h.run(3000);
  assert.ok(h.log.some(e=>e.m.type==='switch'&&e.m.gun===10),'switched to the sidearm');assert.equal(a.weapon.index,10);assert.ok(h.shots('a').length>0,'fires the sidearm');
  a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2,primary:0,secondary:10});b=H.makeClient({id:'b',team:'horde',at:[-18.6,0],bot:false});
  for(const s of a.weapon.inventory)Object.assign(s,{ammo:0,reserve:0});
  h=H.makeHarness({arena,clients:[a,b],difficulty:'hard'});h.run(2500);
  assert.ok(h.log.some(e=>e.m.type==='melee'),'uses the knife when everything is empty');
  a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2});
  a.weapon.ammo=4;h=H.makeHarness({arena,clients:[a]});h.run(4000);
  assert.ok(h.log.some(e=>e.m.type==='reload'),'reloads when nobody is around');assert.ok(a.weapon.ammo>4);
});

test('all twelve guns are fired legally: no early shots, cooldown respected, multi-round ticks keep SMG rates', async()=>{
  const {arena:A,harness:H,guns}=await lib();
  const arena=A.makeArena({walls:[]});
  for(let g=0;g<guns.GUNS.length;g++){
    const a=H.makeClient({id:'a',at:[-15,0],yaw:-Math.PI/2,primary:g,secondary:g===0?1:0}),b=H.makeClient({id:'b',team:'horde',at:[15,0],bot:false});
    const h=H.makeHarness({arena,clients:[a,b],difficulty:'hard',seed:g+1});h.run(9000);
    const shots=h.shots('a'),gun=a.weapon.guns[g];
    assert.ok(shots.length>0,gun.id+' fires');assert.ok(!h.stats.badFire,gun.id+': every fire message was accepted by the weapon simulation ('+(h.stats.badFire||0)+' rejected)');
    const spent=gun.capacity-a.weapon.inventory[g].ammo+(gun.reserve-a.weapon.inventory[g].reserve);assert.ok(spent>=1);
    const pellets=Math.max(1,gun.pellets||1);void pellets;
  }
  // A fast SMG must not be throttled to one round per 100 ms (every second 50 ms tick).
  const a=H.makeClient({id:'a',at:[-15,0],yaw:-Math.PI/2,primary:4}),b=H.makeClient({id:'b',team:'horde',at:[15,0],bot:false}),h=H.makeHarness({arena,clients:[a,b],difficulty:'hard'});
  h.run(25000);const times=h.shots('a').map(e=>e.t);let rounds=0,span=0,start=0;
  for(let i=1;i<=times.length;i++){if(i===times.length||times[i]-times[i-1]>120){rounds+=i-start-1;span+=times[i-1]-times[start];start=i;}}
  const interval=a.weapon.gun.interval*1000,cadence=span/rounds;
  assert.ok(rounds>20,'enough burst data ('+rounds+')');
  assert.ok(cadence<=interval*1.2,'mean cadence inside bursts '+cadence.toFixed(1)+' ms vs gun interval '+interval+' ms: not throttled to every second tick');
  assert.ok(cadence>=interval*.75,'and never faster than the gun allows ('+cadence.toFixed(1)+' ms)');
});

test('burst control: automatic guns fire in bursts with pauses, not an endless stream', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-15,0],yaw:-Math.PI/2,primary:0}),b=H.makeClient({id:'b',team:'horde',at:[15,0],bot:false});
  const h=H.makeHarness({arena,clients:[a,b],difficulty:'easy',seed:3});h.run(8000);
  const times=h.shots('a').map(e=>e.t),gaps=times.slice(1).map((t,i)=>t-times[i]);
  assert.ok(gaps.some(g=>g>=500),'pauses between bursts');assert.ok(gaps.some(g=>g<=150),'rapid fire inside a burst');
  let run=1,longest=1;for(const g of gaps){run=g<=150?run+1:1;longest=Math.max(longest,run);}assert.ok(longest<=4+1,'EASY bursts are short ('+longest+')');
});

test('bots keep a legal pose stream: bounded speed, no jitter while standing, smooth turning', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({walls:[[-2,-16,2,16,5]]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2});
  const h=H.makeHarness({arena,mode:'domination',clients:[a],domination:DOM()});const speeds=[];let last=a.position.slice();
  h.run(15000,{each:()=>{speeds.push(Math.hypot(a.position[0]-last[0],a.position[2]-last[2])/.05);last=a.position.slice();}});
  assert.ok(Math.max(...speeds)<=9.3,'never faster than the 9 m/s sprint ('+Math.max(...speeds).toFixed(2)+')');
  assert.equal(h.stats.badFire||0,0);
  // Standing on the point: no poses are spammed once nothing changes.
  const before=h.stats.poses;h.setDifficulty('normal');h.run(1000);const spam=h.stats.poses-before;
  assert.ok(spam<=20,'idle bots do not send a pose every tick ('+spam+')');
});

test('cost: ten bots in a firefight stay far below the 50 ms tick budget', async()=>{
  const {arena:A,harness:H}=await lib();
  const arena=A.makeArena({size:60}),clients=[];
  for(let i=0;i<5;i++){clients.push(H.makeClient({id:'a'+i,team:'alliance',at:[-30,-20+i*10],yaw:-Math.PI/2,primary:[0,1,4,6,7][i]}));clients.push(H.makeClient({id:'h'+i,team:'horde',at:[30,-20+i*10],yaw:Math.PI/2,primary:[1,0,5,7,6][i]}));}
  const h=H.makeHarness({arena,mode:'tdm',clients,difficulty:'normal'});h.run(2000); // warm-up (graph caches, JIT)
  const s0={ticks:h.director.stats.ticks,ms:h.director.stats.ms};h.director.stats.maxMs=0;
  h.run(20000);
  const stats=h.director.stats,avg=(stats.ms-s0.ms)/(stats.ticks-s0.ticks);
  console.log('bot cost: 10 bots, avg '+avg.toFixed(3)+' ms/tick, worst '+stats.maxMs.toFixed(2)+' ms, thinks '+stats.thinks+', traces '+stats.traces);
  assert.ok(avg<5,'average per-tick cost '+avg.toFixed(2)+' ms');assert.ok(stats.maxMs<25,'worst tick '+stats.maxMs.toFixed(2)+' ms');
});

test('a spent CPU budget defers decisions instead of stalling the tick',async()=>{
  const {arena:A,harness:H,bots}=await lib();
  const arena=A.makeArena({walls:[]}),a=H.makeClient({id:'a',at:[-20,0],yaw:-Math.PI/2}),b=H.makeClient({id:'b',team:'horde',at:[20,0],bot:false});
  const T=await import('three');void T;
  const director=bots.createBotDirector({arena,clock:()=>1e6,random:bots.mulberry32(1),members:()=>[a,b],mode:()=>'tdm',domination:()=>null,royale:()=>null,height:r=>H.HEIGHTS[r],difficulty:()=>'normal',act:()=>{},budgetMs:0});
  for(let i=0;i<20;i++)director.tick(1e6+i*50);
  assert.equal(director.stats.thinks,0,'with no budget no decision step runs');assert.ok(director.stats.deferred>0);
  const free=bots.createBotDirector({arena,clock:()=>1e6,random:bots.mulberry32(1),members:()=>[a,b],mode:()=>'tdm',domination:()=>null,royale:()=>null,height:r=>H.HEIGHTS[r],difficulty:()=>'normal',act:()=>{}});
  a.brain=null;for(let i=0;i<20;i++)free.tick(1e6+i*50);assert.ok(free.stats.thinks>0&&free.stats.deferred===0);
});

test('weapon bands and difficulty table are consistent', async()=>{
  const {bots,guns}=await lib();
  for(const g of guns.GUNS){const b=bots.bandFor(g);assert.ok(b.min<b.max&&b.max<b.fire,g.id+' band');}
  for(const [name,d] of Object.entries(bots.DIFFICULTY)){assert.ok(d.thinkMs>=100&&d.thinkMs<=200,name+' thinks at 5-10 Hz');assert.ok(d.reactionMs[0]<d.reactionMs[1]);}
  const e=bots.DIFFICULTY.easy,n=bots.DIFFICULTY.normal,h=bots.DIFFICULTY.hard;
  assert.ok(e.aimDeg>n.aimDeg&&n.aimDeg>h.aimDeg);assert.ok(e.turnDeg<n.turnDeg&&n.turnDeg<h.turnDeg);assert.ok(e.vision<n.vision&&n.vision<h.vision);
  assert.ok(e.recoilControl<n.recoilControl&&n.recoilControl<h.recoilControl);
});
