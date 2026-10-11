const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../src/progression.mjs');
test('level curve is monotonic, gentle and invertible',async()=>{
  const P=await load();let prev=-1;
  for(let l=1;l<=P.MAX_LEVEL;l++){const xp=P.xpForLevel(l);assert.ok(xp>prev||l===1);prev=xp;assert.equal(P.levelForXp(xp),l);if(l>1)assert.equal(P.levelForXp(xp-1),l-1);}
  assert.equal(P.xpForLevel(1),0);assert.equal(P.xpForLevel(2),400);assert.equal(P.xpForLevel(30),52200);
  assert.equal(P.levelForXp(1e12),30);assert.equal(P.levelForXp(-5),1);assert.equal(P.levelForXp(NaN),1);
  assert.equal(P.levelProgress(P.xpForLevel(30)).fraction,1);assert.equal(P.levelProgress(200).fraction,.5);
});
test('thirty unique rank names',async()=>{
  const P=await load();assert.equal(P.RANKS.length,30);assert.equal(new Set(P.RANKS).size,30);
  assert.equal(P.rankName(1),'Peon');assert.equal(P.rankName(30),'Warchief');assert.equal(P.rankName(99),'Warchief');
});
test('award table matches the spec',async()=>{
  const P=await load(),a=(e,l)=>P.awardXp(l||P.createLedger(),e).xp;
  assert.equal(a({type:'kill',victimId:'a'}),100);assert.equal(a({type:'kill',victimId:'a',headshot:true}),150);assert.equal(a({type:'kill',victimId:'a',knife:true}),125);
  assert.equal(a({type:'capture'}),150);assert.equal(a({type:'domTick'}),10);assert.equal(a({type:'zombieKill'}),50);assert.equal(a({type:'zombieKill',headshot:true}),100);
  assert.equal(a({type:'wave'}),200);assert.equal(a({type:'revive'}),150);assert.equal(a({type:'matchComplete'}),300);assert.equal(a({type:'win'}),500);
  assert.equal(a({type:'kill',victimId:'a',friendly:true}),0);assert.equal(a({type:'bogus'}),0);assert.equal(a(null),0);
});
test('awardXp is pure and tracks a breakdown',async()=>{
  const P=await load(),l0=P.createLedger(),r=P.awardXp(l0,{type:'kill',victimId:'v',headshot:true});
  assert.equal(l0.total,0);assert.equal(r.ledger.total,150);
  const b=P.breakdown(r.ledger);assert.deepEqual(b.map(i=>i.id).sort(),['headshot','kill']);
});
test('farming the same victim decays to zero',async()=>{
  const P=await load();let l=P.createLedger();const got=[];
  for(let i=0;i<6;i++){const r=P.awardXp(l,{type:'kill',victimId:'friend'});l=r.ledger;got.push(r.xp);}
  assert.deepEqual(got,[100,100,50,25,0,0]);
  assert.equal(P.awardXp(l,{type:'kill',victimId:'other'}).xp,100);
});
test('undead farming is halved then capped; match cap spares completion and win',async()=>{
  const P=await load();let l=P.createLedger();
  for(let i=0;i<P.ZOMBIE_FULL_KILLS;i++)l=P.awardXp(l,{type:'zombieKill'}).ledger;
  assert.equal(P.awardXp(l,{type:'zombieKill'}).xp,25);
  for(let i=0;i<500;i++)l=P.awardXp(l,{type:'zombieKill',headshot:true}).ledger;
  assert.ok(l.kinds.zombie<=P.KIND_CAPS.zombie);assert.ok(l.capped>0);
  for(let i=0;i<50;i++)l=P.awardXp(l,{type:'revive'}).ledger;
  for(let i=0;i<50;i++)l=P.awardXp(l,{type:'wave'}).ledger;
  const before=l.total;assert.ok(before<=P.MATCH_CAP);
  l=P.awardXp(l,{type:'matchComplete'}).ledger;l=P.awardXp(l,{type:'win'}).ledger;assert.equal(l.total,before+800);
  assert.equal(P.awardXp(l,{type:'kill',victimId:'x'}).xp,P.MATCH_CAP>=before?Math.max(0,Math.min(100,P.MATCH_CAP-before)):0);
});
test('domination ticks are capped',async()=>{
  const P=await load();let l=P.createLedger();for(let i=0;i<1000;i++)l=P.awardXp(l,{type:'domTick'}).ledger;
  assert.equal(l.total,P.KIND_CAPS.objective);
});
test('unlock catalog matches the design and covers every gun',async()=>{
  const P=await load(),{GUNS}=await import('../src/weapon-data.js');
  const want={an94_mp:1,scar_mp:1,fastMags:1,extMags:4,foregrip:6,redDot:8,suppressor:10,dsr50_mp:12,ballista_mp:16,'slot:4':8,'slot:5':14};
  for(const [id,level] of Object.entries(want))assert.equal(P.UNLOCKS[id]?.level,level,id);
  for(const g of GUNS)assert.ok(P.unlockInfo(g.id),'catalog entry for '+g.id);
  for(const u of Object.values(P.UNLOCKS)){assert.ok(P.UNLOCK_KINDS.includes(u.kind));assert.ok(u.level>=1&&u.level<=P.MAX_LEVEL);}
  for(const kind of P.UNLOCK_KINDS)assert.ok(Object.values(P.UNLOCKS).some(u=>u.kind===kind),kind);
  const {ATTACHMENT_IDS}=await import('../src/attachments.mjs'),{PERKS}=await import('../src/loadouts.mjs');
  for(const id of [...ATTACHMENT_IDS,...Object.keys(PERKS)])assert.ok(P.UNLOCKS[id],id);
});
test('isUnlocked allows everything without a profile and gates by level',async()=>{
  const P=await load();assert.equal(P.isUnlocked(null,'ballista_mp'),true);
  const p={level:5,unlocked:[]};assert.equal(P.isUnlocked(p,'extMags'),true);assert.equal(P.isUnlocked(p,'foregrip'),false);assert.equal(P.isUnlocked(p,'brand_new_gun'),true);
  assert.equal(P.isUnlocked({level:1,unlocked:['foregrip']},'foregrip'),true);
});
test('applyXp reports level-ups and newly unlocked ids',async()=>{
  const P=await load(),p={xp:0,level:1,unlocked:[]};
  const r=P.applyXp(p,P.xpForLevel(8));
  assert.equal(r.levelAfter,8);assert.equal(r.levelUps,7);
  for(const id of ['extMags','foregrip','redDot','slot:4'])assert.ok(r.unlocked.includes(id),id);
  assert.ok(!r.unlocked.includes('suppressor'));
  assert.deepEqual(P.applyXp(p,1).unlocked,[]);
});
test('cleanLoadout enforcement is opt-in and swaps locked picks',async()=>{
  const {cleanLoadout}=await import('../src/loadouts.mjs'),P=await load();
  const wish={primary:3,secondary:2,perk:'stockpile',attachments:{primary:'suppressor',secondary:null}};
  assert.equal(cleanLoadout(wish).primary,3);
  const v=[],c=cleanLoadout(wish,{level:1,unlocked:[]},v);
  assert.ok(!v.length===false);assert.ok(v.includes('ballista_mp')&&v.includes('dsr50_mp')&&v.includes('stockpile'));
  assert.ok([0,1].includes(c.primary)&&[0,1].includes(c.secondary)&&c.primary!==c.secondary);assert.equal(c.perk,'balanced');assert.equal(c.attachments.primary,null);
  const ok=cleanLoadout(wish,{level:30,unlocked:[]},[]);assert.equal(ok.primary,3);assert.equal(ok.attachments.primary,'suppressor');
  assert.ok(P.isUnlocked({level:30,unlocked:[]},'slot:5'));
});
