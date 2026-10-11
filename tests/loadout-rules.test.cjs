const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const load=async()=>({R:await import('../src/loadout-rules.mjs'),L:await import('../src/loadouts.mjs'),A:await import('../src/attachments.mjs'),D:await import('../src/weapon-data.js'),P:await import('../src/progression.mjs')});
const L1={level:1,unlocked:[]},L30={level:30,unlocked:[]};
const gunIdx=(D,id)=>D.GUNS.findIndex(g=>g.id===id);

test('catalogs are complete, tiered and every id has an unlock entry',async()=>{
  const {R,P}=await load();
  for(const t of R.PERK_TIERS){const list=R.perksForTier(t);assert.equal(list.length,4,'tier '+t);assert.ok(list.some(p=>P.requiredLevel(p.id)===1||t===3),'a free pick or tier 3');}
  assert.equal(R.PERK_CATALOG.length,12);assert.equal(new Set(R.PERK_CATALOG.map(p=>p.id)).size,12);
  for(const p of R.PERK_CATALOG){assert.ok(P.UNLOCKS[p.id]?.kind==='perk',p.id);assert.ok([1,2].includes(p.cost));assert.ok(Object.isFrozen(p));assert.ok(Object.keys(p.effect).every(k=>['speed','reload','adsIn','recoil','reserve','regen'].includes(k)));}
  assert.deepEqual(R.PERK_CATALOG.filter(p=>p.cost===2).map(p=>p.id),['marathon','gunslinger','fieldMedic']);
  assert.equal(R.LETHALS.length,3);assert.equal(R.TACTICALS.length,3);
  for(const e of [...R.LETHALS,...R.TACTICALS]){assert.equal(e.implemented,false,'placeholders are flagged');assert.match(e.summary,/COMING SOON/);assert.ok(P.UNLOCKS[e.id]?.kind===e.kind);}
  for(const w of R.WILDCARDS)assert.equal(P.UNLOCKS[w.id]?.kind,'wildcard');
  assert.equal(R.WILDCARDS.length,6);
  for(const id of R.CAMO_IDS)assert.equal(P.UNLOCKS[id].kind,'camo');
  assert.ok(R.CAMO_IDS.includes('camo:stock')&&R.CAMO_IDS.length>=13);
  assert.equal(R.BUDGET,10);
});

test('v1 saves migrate without loss: gun pair, perk, attachments, name',async()=>{
  const {R,L,D}=await load();
  const v1={name:'Old Faithful',primary:2,secondary:3,perk:'fastHands',attachments:{primary:'suppressor',secondary:'extMags'}};
  const c=R.normalizeClass(v1).loadout;
  assert.equal(c.version,2);assert.equal(c.name,'Old Faithful');assert.equal(c.primary,2);assert.equal(c.secondary,3);
  assert.deepEqual(c.attachments,{primary:'suppressor',secondary:'extMags'});assert.deepEqual(c.perks,{t1:[],t2:['fastHands'],t3:[]});
  assert.deepEqual(c.wildcards,['wildcard:overkill'],'a non-pistol secondary needs Overkill');assert.equal(c.perk,'fastHands');
  assert.equal(R.classCost(c).total,2+2+1+1+1+1);
  // exhaustive: every v1 combination survives with all its parts
  const ATT={0:['extMags','fastMags','foregrip','suppressor','redDot'],1:['extMags','fastMags','foregrip','suppressor','redDot'],2:['fastMags','suppressor'],3:['extMags','fastMags','suppressor']};
  let checked=0;
  for(const p of [0,1,2,3])for(const s of [0,1,2,3]){
    if(p===s)continue;
    for(const perk of ['balanced','lightweight','fastHands','stockpile'])for(const ap of [null,...ATT[p]])for(const as of [null,...ATT[s]]){
      const m=L.cleanLoadout({name:'x',primary:p,secondary:s,perk,attachments:{primary:ap,secondary:as}});
      assert.deepEqual([m.primary,m.secondary,m.perk,m.attachments.primary,m.attachments.secondary],[p,s,perk,ap,as]);
      assert.ok(R.classCost(m).total<=R.BUDGET);checked++;
    }
  }
  assert.ok(checked>1000);
  // derived legacy perk drives the old API shape
  const w=L.classWeapons(D.GUNS,L.cleanLoadout({primary:0,secondary:1,perk:'stockpile'}));assert.equal(w[0].reserve,Math.floor(D.GUNS[0].reserve*1.5));
});

test('store migration: v1 and garbage stores become five clean v2 classes',async()=>{
  const {R}=await load();
  const v1={classes:[{name:'A',primary:0,secondary:1,perk:'balanced'},{name:'B',primary:2,secondary:0,perk:'lightweight'},{name:'C',primary:1,secondary:3,perk:'stockpile'},{name:'D',primary:3,secondary:2,perk:'fastHands'},{name:'E',primary:1,secondary:0,perk:'balanced'}],active:3};
  const s=R.migrateStore(v1);assert.equal(s.version,2);assert.equal(s.active,3);assert.equal(s.classes.length,5);
  assert.deepEqual(s.classes.map(c=>c.name),['A','B','C','D','E']);assert.equal(s.classes[1].primary,2);assert.deepEqual(s.classes[1].perks.t1,['lightweight']);
  assert.deepEqual(R.migrateStore(s),s,'v2 stores are stable');
  const d=R.migrateStore(null);assert.deepEqual(d.classes.map(c=>c.name),['Assault','Close Quarters','Support','Marksman','Run & Gun']);assert.equal(d.active,0);
  for(const junk of [undefined,5,'x',[],{classes:'no'},{classes:[null,5,'x']},{classes:[],active:99},{active:-1}]){const m=R.migrateStore(junk);assert.equal(m.classes.length,5);assert.ok(m.active>=0&&m.active<5);}
  assert.equal(R.migrateStore({classes:v1.classes.slice(0,2),active:1}).classes.length,5,'short stores are padded with presets');
  assert.equal(R.migrateStore({classes:[...v1.classes,...v1.classes]}).classes.length,5,'long stores are truncated');
});

test('Pick 10 cost table and budget enforcement',async()=>{
  const {R,D}=await load();
  const an=gunIdx(D,'an94_mp'),scar=gunIdx(D,'scar_mp'),dsr=gunIdx(D,'dsr50_mp'),mk=gunIdx(D,'mk48_mp'),pistol=gunIdx(D,'fiveseven_mp');
  assert.deepEqual({...R.GUN_COSTS},{ar:1,smg:1,shotgun:1,pistol:1,sniper:2,lmg:2});
  assert.equal(R.gunCost(D.GUNS[an]),1);assert.equal(R.gunCost(D.GUNS[dsr]),2);assert.equal(R.gunCost(D.GUNS[mk]),2);assert.equal(R.gunCost(D.GUNS[pistol]),1);
  const base={version:2,primary:an,secondary:pistol};
  assert.equal(R.classCost(R.normalizeClass(base).loadout).total,2);
  const full=R.normalizeClass({...base,attachments:{primary:'fastMags',secondary:'suppressor'},perks:{t1:['marathon'],t2:['gunslinger'],t3:['fieldMedic']},lethal:'lethal:frag',tactical:'tactical:flashbang',wildcards:['wildcard:perk1Greed']},{trim:false}).loadout;
  const lines=R.classCost(full).lines;assert.deepEqual(lines.map(l=>l.cost),[1,1,1,1,2,2,2,1,1,1]);
  assert.equal(R.classCost(full).total,13);
  // the server-side normalizer never lets a class exceed 10
  const r=R.normalizeClass({...base,attachments:{primary:'fastMags',secondary:'suppressor'},perks:{t1:['marathon'],t2:['gunslinger'],t3:['fieldMedic']},lethal:'lethal:frag',tactical:'tactical:flashbang',wildcards:['wildcard:perk1Greed']},{});
  assert.ok(r.cost.total<=10&&r.trimmed&&!r.ok);assert.equal(r.loadout.primary,an);assert.equal(r.loadout.secondary,pistol,'weapons are never trimmed');
  assert.equal(r.loadout.tactical,null);assert.equal(r.loadout.lethal,null,'equipment goes first');
  assert.ok(r.notes.some(n=>/Pick 10/.test(n)));
  // worst case: every slot filled, two 2-point guns
  const worst=R.normalizeClass({version:2,primary:dsr,secondary:mk,wildcards:['wildcard:overkill','wildcard:gunfighter','wildcard:sidearmFighter'],attachments:{primary:'fastMags',secondary:'compensator'},attachments2:{primary:'suppressor',secondary:'quickdraw'},perks:{t1:['marathon'],t2:['gunslinger'],t3:['fieldMedic']},lethal:'lethal:frag',tactical:'tactical:smokeScreen'});
  assert.ok(worst.cost.total<=10);assert.equal(worst.loadout.primary,dsr);
  // trimming is deterministic and idempotent
  assert.deepEqual(R.normalizeClass(worst.loadout).loadout,worst.loadout);
  assert.equal(R.normalizeClass(worst.loadout).ok,true);
});

test('wildcards open and close slots',async()=>{
  const {R,D}=await load();
  const an=gunIdx(D,'an94_mp'),scar=gunIdx(D,'scar_mp'),mp7=gunIdx(D,'mp7_mp'),pistol=gunIdx(D,'fiveseven_mp'),shotgun=gunIdx(D,'870mcs_mp');
  const norm=c=>R.normalizeClass({version:2,...c});
  // Overkill: any non-pistol secondary
  assert.equal(norm({primary:an,secondary:scar,wildcards:['wildcard:overkill']}).loadout.secondary,scar);
  const noOk=norm({primary:an,secondary:scar});assert.equal(noOk.loadout.secondary,pistol,'falls back to a pistol');assert.ok(noOk.notes.some(n=>/Overkill/.test(n)));
  assert.equal(norm({primary:an,secondary:pistol}).loadout.secondary,pistol,'pistol secondary needs no wildcard');
  // primary may not be a pistol
  assert.notEqual(norm({primary:pistol,secondary:scar,wildcards:['wildcard:overkill']}).loadout.primary,pistol);
  // Gunfighter: second primary attachment only with the wildcard, one per group
  const gf={primary:an,secondary:pistol,attachments:{primary:'foregrip'},attachments2:{primary:'suppressor'}};
  assert.equal(norm(gf).loadout.attachments2.primary,null);
  const wf=norm({...gf,wildcards:['wildcard:gunfighter']}).loadout;assert.deepEqual([wf.attachments.primary,wf.attachments2.primary],['foregrip','suppressor']);
  assert.equal(norm({...gf,attachments2:{primary:'quickdraw'},wildcards:['wildcard:gunfighter']}).loadout.attachments2.primary,null,'two grips conflict');
  assert.equal(norm({...gf,attachments2:{primary:'foregrip'},wildcards:['wildcard:gunfighter']}).loadout.attachments2.primary,null,'no duplicates');
  const sf=norm({primary:an,secondary:pistol,attachments:{secondary:'fastMags'},attachments2:{secondary:'reflex'},wildcards:['wildcard:sidearmFighter']}).loadout;assert.deepEqual([sf.attachments.secondary,sf.attachments2.secondary],['fastMags','reflex']);
  // Perk greed
  const pg={primary:an,secondary:pistol,perks:{t1:['lightweight','scavenger'],t2:['fastHands','steadyAim']}};
  assert.deepEqual(norm(pg).loadout.perks,{t1:['lightweight'],t2:['fastHands'],t3:[]});
  assert.deepEqual(norm({...pg,wildcards:['wildcard:perk1Greed']}).loadout.perks,{t1:['lightweight','scavenger'],t2:['fastHands'],t3:[]});
  assert.deepEqual(norm({...pg,wildcards:['wildcard:perk1Greed','wildcard:perk2Greed']}).loadout.perks.t2,['fastHands','steadyAim']);
  // at most three wildcards, unique, valid only
  assert.equal(norm({primary:an,secondary:pistol,wildcards:['wildcard:overkill','wildcard:overkill','x','wildcard:gunfighter','wildcard:perk1Greed','wildcard:perk2Greed']}).loadout.wildcards.length,3);
  assert.deepEqual(norm({primary:an,secondary:pistol,wildcards:['wildcard:overkill','wildcard:overkill']}).loadout.wildcards,['wildcard:overkill']);
  // removing a wildcard removes what depended on it (and shotguns/pistols with no attachments stay clean)
  assert.equal(norm({primary:shotgun,secondary:mp7,attachments:{primary:'fastMags'},wildcards:['wildcard:overkill']}).loadout.attachments.primary,null);
});

test('invalid ids, junk types and prototype keys never survive',async()=>{
  const {R,L,D}=await load();
  const junk=[undefined,null,5,'x',[],true,()=>1,{},{version:2},{version:3,primary:'a'},JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1}}')];
  for(const j of junk){const r=R.normalizeClass(j);assert.equal(r.loadout.version,2);assert.ok(r.cost.total<=10);assert.ok(Number.isInteger(r.loadout.primary)&&Number.isInteger(r.loadout.secondary)&&r.loadout.primary!==r.loadout.secondary);}
  assert.equal({}.polluted,undefined);
  const bad=R.normalizeClass({version:2,primary:'0',secondary:1.5,name:{},wildcards:'wildcard:overkill',perks:{t1:['__proto__','toString','secondWind',7,null],t2:['secondWind'],t3:'stockpile'},attachments:{primary:['fastMags'],secondary:{}},attachments2:null,lethal:'lethal:nope',tactical:'lethal:frag',camo:{primary:'title:recruit',secondary:'camo:gold'},title:'camo:gold',emblem:'emblem:shield',nicknames:{primary:'<b>'+'x'.repeat(100)+'</b>',secondary:7}}).loadout;
  assert.equal(bad.name,'Custom');assert.deepEqual(bad.perks,{t1:['secondWind'],t2:[],t3:[]},'perks only in their own tier, junk dropped');
  assert.equal(bad.lethal,null);assert.equal(bad.tactical,null,'wrong kind of equipment is rejected');assert.equal(bad.camo.primary,'camo:stock');assert.equal(bad.camo.secondary,'camo:gold');
  assert.equal(bad.title,null);assert.equal(bad.emblem,'emblem:shield');assert.ok(bad.nicknames.primary.length<=16&&!/[<>]/.test(bad.nicknames.primary));assert.equal(bad.nicknames.secondary,'');
  assert.deepEqual(bad.attachments,{primary:null,secondary:null});
  for(const huge of [{version:2,wildcards:Array(5000).fill('wildcard:overkill'),perks:{t1:Array(5000).fill('secondWind')}}]){const r=R.normalizeClass(huge);assert.ok(r.loadout.wildcards.length<=3&&r.loadout.perks.t1.length<=1);}
  // guns: out of range, NaN, negative, floats
  for(const g of [99,-1,NaN,Infinity,1.5,'1',null]){const c=L.cleanLoadout({version:2,primary:g,secondary:g});assert.ok(c.primary>=0&&c.primary<D.GUNS.length&&c.secondary>=0&&c.secondary<D.GUNS.length&&c.primary!==c.secondary);}
  // the legacy perk field sent by a v2 client is ignored
  assert.deepEqual(R.normalizeClass({version:2,primary:0,secondary:10,perk:'stockpile'}).loadout.perks,{t1:[],t2:[],t3:[]});
});

test('profile gating swaps locked picks for free defaults with violations',async()=>{
  const {R,L,D,P}=await load();
  const mp7=gunIdx(D,'mp7_mp'),an=gunIdx(D,'an94_mp'),as50=gunIdx(D,'as50_mp'),pistol=gunIdx(D,'fiveseven_mp');
  const wish={version:2,name:'Wish',primary:mp7,secondary:as50,wildcards:['wildcard:overkill','wildcard:gunfighter','wildcard:perk1Greed'],attachments:{primary:'suppressor'},attachments2:{primary:'redDot'},perks:{t1:['marathon','secondWind'],t2:['gunslinger'],t3:['fieldMedic']},lethal:'lethal:throwingAxe',tactical:'tactical:flashbang',camo:{primary:'camo:gold',secondary:'camo:stock'},title:'title:legend'};
  const v=[],c=L.cleanLoadout(wish,L1,v);
  for(const id of ['mp7_mp','as50_mp','suppressor','wildcard:gunfighter','wildcard:perk1Greed','marathon','gunslinger','fieldMedic','lethal:throwingAxe','camo:gold','title:legend'])assert.ok(v.includes(id),'violation '+id);
  assert.ok(!v.includes('wildcard:overkill')&&!v.includes('secondWind')&&!v.includes('lethal:frag'));
  assert.ok(c.primary<4&&c.secondary<4&&c.primary!==c.secondary);assert.deepEqual(c.perks,{t1:['secondWind'],t2:[],t3:[]});
  assert.equal(c.lethal,null);assert.equal(c.tactical,'tactical:flashbang');assert.equal(c.camo.primary,'camo:stock');assert.equal(c.title,null);
  assert.equal(c.attachments.primary,null);assert.equal(c.attachments2.primary,null);
  // every item allowed at level 30
  const v30=[],c30=L.cleanLoadout({...wish,attachments:{},attachments2:{},lethal:null,tactical:null,perks:{t1:['marathon','secondWind']}},L30,v30);
  assert.deepEqual(v30,[]);assert.equal(c30.primary,mp7);assert.equal(c30.secondary,as50);assert.deepEqual(c30.perks.t1,['marathon','secondWind']);assert.ok(R.classCost(c30).total<=10);
  // a level-3 player owns the pistol; level 1 owns no pistol so a missing Overkill falls back to it being added
  const l3={level:3,unlocked:[]};assert.equal(L.cleanLoadout({version:2,primary:an,secondary:pistol},l3).secondary,pistol);
  const v1p=[],c1=L.cleanLoadout({version:2,primary:an,secondary:pistol},L1,v1p);assert.ok(v1p.includes('fiveseven_mp'));assert.ok(c1.wildcards.includes('wildcard:overkill'),'level 1 players always get a working secondary');
  assert.ok(c1.secondary<2&&c1.secondary!==c1.primary);
  // explicit unlocks via profile.unlocked work
  assert.equal(L.cleanLoadout({version:2,primary:mp7,secondary:an,wildcards:['wildcard:overkill']},{level:1,unlocked:['mp7_mp']}).primary,mp7);
  // defaults are always valid for a brand new player
  for(const d of L.DEFAULT_CLASSES){const r=R.normalizeClass(d,{profile:L1});assert.ok(r.ok,d.name+' '+r.notes+r.violations);assert.deepEqual(r.loadout,d);}
  assert.equal(L.DEFAULT_CLASSES.length,5);
});

test('all 12 guns accept exactly the attachments their type allows',async()=>{
  const {R,L,A,D}=await load();
  assert.equal(D.GUNS.length,12);
  const expectType={ar:'rifle',smg:'rifle',lmg:'rifle',sniper:'sniper',shotgun:'shotgun',pistol:'pistol'};
  for(const [index,g] of D.GUNS.entries()){
    const type=A.weaponType(g);assert.equal(type,g.scope?'sniper':expectType[g.class],g.id);
    const allowed=A.attachmentsFor(g).map(a=>a.id);
    for(const a of A.ATTACHMENTS){
      const should=a.types.includes(type)&&!a.exclude.includes(g.id);
      assert.equal(A.canEquip(g,a.id),should,g.id+' '+a.id);assert.equal(allowed.includes(a.id),should);
      // through the class pipeline
      const secondary=g.class==='pistol'?index:(index===0?1:0),primary=g.class==='pistol'?0:index;
      const c=L.cleanLoadout({version:2,primary,secondary,wildcards:['wildcard:overkill'],attachments:{primary:a.id,secondary:a.id}});
      if(g.class!=='pistol')assert.equal(c.attachments.primary,should?a.id:null,g.id+' primary '+a.id);
      else assert.equal(c.attachments.secondary,should?a.id:null,g.id+' secondary '+a.id);
      if(should){
        const before=JSON.stringify(g),spec=L.classWeapons(D.GUNS,c)[index];
        assert.equal(JSON.stringify(g),before,'base gun untouched');
        for(const k of ['capacity','reload','reloadEmpty','adsIn','adsFov'])assert.ok(Number.isFinite(spec[k])&&spec[k]>0,g.id+' '+a.id+' '+k);
        assert.equal(spec.attachment,a.id);
      }
    }
  }
  assert.deepEqual(A.attachmentsFor(D.GUNS[gunIdx(D,'870mcs_mp')]),[],'shotguns take no attachments yet (shell reload timings differ)');
  assert.ok(!A.canEquip(D.GUNS[gunIdx(D,'mk48_mp')],'extMags'));assert.ok(A.canEquip(D.GUNS[gunIdx(D,'mk48_mp')],'foregrip'));
  assert.ok(!A.canEquip(D.GUNS[gunIdx(D,'fiveseven_mp')],'foregrip'));assert.ok(A.canEquip(D.GUNS[gunIdx(D,'fiveseven_mp')],'reflex'));
  // every gun can be a primary except pistols, any gun can be a secondary with Overkill
  for(const [i,g] of D.GUNS.entries()){
    const p=L.cleanLoadout({version:2,primary:i,secondary:i===0?1:0,wildcards:['wildcard:overkill']});assert.equal(p.primary,g.class==='pistol'?0:i,g.id+' as primary');
    const s=L.cleanLoadout({version:2,primary:i===0?1:0,secondary:i,wildcards:['wildcard:overkill']});assert.equal(s.secondary,i,g.id+' as secondary');
  }
  // same-group attachments are exclusive when stacked through applyAttachments
  const an=D.GUNS[0],both=A.applyAttachments(an,['foregrip','quickdraw']);assert.deepEqual(both.attachmentIds,['foregrip']);
  const two=A.applyAttachments(an,['foregrip','suppressor']);assert.equal(two.recoil,.7);assert.equal(two.quiet,true);assert.deepEqual(two.attachmentIds,['foregrip','suppressor']);
  assert.equal(A.applyAttachments(two,['redDot']),two,'applies once');
});

test('perk effects map onto real stats with exact math',async()=>{
  const {R,L,D}=await load();
  const mk=extra=>L.cleanLoadout({version:2,primary:0,secondary:1,wildcards:['wildcard:overkill'],...extra});
  const g0=D.GUNS[0],w=c=>L.classWeapons(D.GUNS,c)[0];
  assert.equal(w(mk({perks:{t2:['fastHands']}})).reload,g0.reload*.85);
  assert.equal(w(mk({perks:{t2:['quickDraw']}})).adsIn,g0.adsIn*.85);
  assert.equal(w(mk({perks:{t2:['steadyAim']}})).recoil,.85);
  assert.equal(w(mk({perks:{t1:['scavenger']}})).reserve,Math.floor(g0.reserve*1.25));
  assert.equal(w(mk({perks:{t3:['stockpile']}})).reserve,Math.floor(g0.reserve*1.5));
  const gs=w(mk({perks:{t2:['gunslinger']}}));assert.equal(gs.reload,g0.reload*.92);assert.equal(gs.adsIn,g0.adsIn*.9);
  const ir=w(mk({perks:{t3:['ironNerves']}}));assert.equal(ir.recoil,.9);assert.equal(ir.adsIn,g0.adsIn*.95);
  const bd=w(mk({perks:{t3:['bandolier']}}));assert.equal(bd.reserve,Math.floor(g0.reserve*1.15));assert.equal(bd.reload,g0.reload*.95);
  assert.equal(L.classSpeed(mk({perks:{t1:['lightweight']}})),1.08);assert.equal(L.classSpeed(mk({perks:{t1:['marathon']}})),1.14);assert.equal(L.classSpeed(mk({})),1);
  assert.equal(L.classRegen(mk({perks:{t1:['secondWind']}})),1.4);assert.equal(L.classRegen(mk({perks:{t3:['fieldMedic']}})),2);
  assert.equal(L.classRegen({perks:{t1:['secondWind'],t3:['fieldMedic']}}),R.REGEN_CAP,'regen is capped');
  assert.equal(L.classRegen({perk:'balanced'}),1);assert.equal(L.classSpeed({perk:'lightweight'}),1.08,'legacy shape still works');
  // stacked greed perks multiply, recoil is floored
  assert.ok(R.perkEffects({perks:{t2:['steadyAim'],t3:['ironNerves']}}).recoil>=.6);
  // perks and attachments compose: base -> attachment -> perk
  const both=w(mk({attachments:{primary:'fastMags'},perks:{t2:['fastHands']}}));assert.equal(both.reload,g0.reload*.85*.85);
  // shell reload fields follow Fast Hands too
  const shot=gunIdx(D,'870mcs_mp'),sw=L.classWeapons(D.GUNS,mk({primary:shot,perks:{t2:['fastHands']}}))[shot];assert.equal(sw.reloadPerShell,D.GUNS[shot].reloadPerShell*.85);
  // only the equipped guns carry attachments, perks still apply to the list
  assert.equal(L.classWeapons(D.GUNS,mk({attachments:{primary:'extMags'}}))[3].capacity,D.GUNS[3].capacity);
});

test('class JSON export/import round trips and rejects hostile text',async()=>{
  const {R,L,D}=await load();
  for(const c of [...L.DEFAULT_CLASSES,R.normalizeClass({version:2,name:'Round Trip',primary:4,secondary:10,attachments:{primary:'compensator',secondary:'reflex'},perks:{t1:['marathon'],t2:['gunslinger'],t3:['bandolier']},lethal:'lethal:frag',wildcards:['wildcard:perk1Greed'],nicknames:{primary:'Bessie'},camo:{primary:'camo:gold'}}).loadout]){
    const text=R.exportClass(c);assert.ok(text.length<R.MAX_EXPORT_CHARS,'export fits the import limit '+text.length);
    const back=R.importClass(text);assert.ok(back.ok,back.error);assert.deepEqual(back.loadout,R.normalizeClass(c).loadout);
    assert.ok(!('perk' in JSON.parse(text).class),'derived legacy perk is not exported');
  }
  const huge=R.exportClass(R.normalizeClass({version:2,name:'N'.repeat(20),primary:4,secondary:10,attachments:{primary:'compensator',secondary:'reflex'},nicknames:{primary:'x'.repeat(16),secondary:'y'.repeat(16)}}).loadout);assert.ok(huge.length<R.MAX_EXPORT_CHARS);
  // imports are re-validated against the importing profile
  const gold=R.exportClass(R.normalizeClass({version:2,primary:0,secondary:10,camo:{primary:'camo:gold'},perks:{t1:['marathon']},wildcards:[]}).loadout);
  const swapped=R.importClass(gold,{profile:L1});assert.ok(swapped.ok);assert.ok(swapped.violations.includes('camo:gold')&&swapped.violations.includes('marathon'));assert.equal(swapped.loadout.camo.primary,'camo:stock');
  // v1 export strings import too
  const old=R.importClass(JSON.stringify({ao:'class',version:1,class:{name:'Legacy',primary:0,secondary:1,perk:'stockpile'}}));assert.ok(old.ok);assert.deepEqual(old.loadout.perks.t3,['stockpile']);
  const hostile=['',' ','null','[]','5','"x"','{','{}','{"ao":"class"}','{"ao":"class","version":2}','{"ao":"class","version":9,"class":{}}','{"ao":"other","version":2,"class":{}}','{"ao":"class","version":2,"class":[]}','x'.repeat(R.MAX_EXPORT_CHARS+1),'{"ao":"class","version":2,"class":'+'['.repeat(5000)+'}',undefined,null,5,{},[]];
  for(const h of hostile){const r=R.importClass(h);assert.equal(r.ok,false,String(h).slice(0,30));assert.equal(typeof r.error,'string');}
  const pollute=R.importClass('{"ao":"class","version":2,"class":{"__proto__":{"polluted":true},"primary":0,"secondary":10,"perks":{"__proto__":{"t1":["marathon"]}}}}');
  assert.ok(pollute.ok);assert.equal({}.polluted,undefined);assert.equal(pollute.loadout.polluted,undefined);assert.deepEqual(pollute.loadout.perks,{t1:[],t2:[],t3:[]});
  const long='{"ao":"class","version":2,"class":{"primary":0,"secondary":10,"name":"'+'a'.repeat(R.MAX_EXPORT_CHARS)+'"}}';assert.equal(R.importClass(long).ok,false);
  assert.equal(R.importClass('{"ao":"class","version":2,"class":{"name":"<script>alert(1)</script>","primary":0,"secondary":10}}').loadout.name.includes('<'),false);
});

test('authoritative server path: budget, profile locks, placeholders and new guns',async()=>{
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),{createProfileStore}=await import('../server/profiles.mjs');
  const {R,L,D,P}=await load();
  const profiles=createProfileStore(),server=http.createServer(),net=attachMultiplayer(server,{profiles,autoTick:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));const sockets=[];
  const wait=async p=>{const until=Date.now()+8000;while(!p()){if(Date.now()>until)throw Error('Timed out');await new Promise(r=>setTimeout(r,15));}};
  async function client(token){
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),c={errors:[]};sockets.push(ws);
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')c.id=m.id;if(m.type==='error')c.errors.push(m.message);if(m.type==='profile')c.profile=m.profile;});
    await wait(()=>c.id);if(token){ws.send(JSON.stringify({type:'hello',token}));await wait(()=>c.profile);}
    c.send=m=>ws.send(JSON.stringify(m));c.state=()=>net.clients.get(c.id);return c;
  }
  try{
    const anon=await client(null);
    // over budget: server trims, never trusts the client
    anon.send({type:'profile',loadout:{version:2,primary:4,secondary:10,attachments:{primary:'compensator',secondary:'fastMags'},attachments2:{primary:'reflex'},perks:{t1:['marathon','secondWind'],t2:['gunslinger'],t3:['fieldMedic','stockpile']},lethal:'lethal:frag',tactical:'tactical:smokeScreen',wildcards:['wildcard:gunfighter','wildcard:perk1Greed','wildcard:perk3Greed']}});
    await wait(()=>anon.state().pending.primary===4);
    const p=anon.state().pending;assert.ok(R.classCost(p).total<=10,'trimmed to '+R.classCost(p).total);assert.equal(p.secondary,10);
    anon.send({type:'profile',loadout:{version:2,primary:4,secondary:10,attachments:{primary:'compensator',secondary:'fastMags'},perks:{t1:['marathon'],t2:['gunslinger']}}});
    await wait(()=>anon.state().pending.attachments.primary==='compensator');
    const q=anon.state().pending;
    // new guns reach the weapon simulation inputs
    const specs=L.classWeapons(D.GUNS,q);assert.equal(specs[4].id,'mp7_mp');assert.equal(specs[4].attachment,'compensator');
    // lethal/tactical are data only: identical weapon stats with or without them
    anon.send({type:'profile',loadout:{version:2,primary:4,secondary:10,lethal:'lethal:frag',tactical:'tactical:flashbang'}});await wait(()=>anon.state().pending.lethal==='lethal:frag');
    const withEq=JSON.stringify(L.classWeapons(D.GUNS,anon.state().pending));
    anon.send({type:'profile',loadout:{version:2,primary:4,secondary:10}});await wait(()=>anon.state().pending.lethal===null);
    assert.equal(JSON.stringify(L.classWeapons(D.GUNS,anon.state().pending)),withEq);assert.equal(L.classSpeed(anon.state().pending),1);
    // hostile payloads do not crash the handler
    for(const loadout of [null,5,'x',[],{version:2,perks:'x',wildcards:{},attachments:5},{primary:{},secondary:[]}]){anon.send({type:'profile',loadout});}
    anon.send({type:'profile',loadout:{version:2,primary:5,secondary:11,wildcards:['wildcard:overkill']}});await wait(()=>anon.state().pending.primary===5);assert.equal(anon.state().pending.secondary,11);
    // a profiled level-1 player cannot field locked guns, items or wildcards
    const rookie=await client('rookieRookie_0123456789-abcdef');
    rookie.send({type:'profile',slot:0,loadout:{version:2,primary:5,secondary:11,wildcards:['wildcard:overkill','wildcard:gunfighter'],attachments:{primary:'suppressor'},perks:{t1:['marathon'],t2:['quickDraw']}}});
    await wait(()=>rookie.errors.some(m=>/Locked until you level up/.test(m)));
    const r=rookie.state().pending;assert.ok(r.primary<2&&r.secondary<2&&r.primary!==r.secondary);assert.deepEqual(r.perks,{t1:[],t2:['quickDraw'],t3:[]});assert.equal(r.attachments.primary,null);assert.ok(!r.wildcards.includes('wildcard:gunfighter'));
    assert.match(rookie.errors.at(-1),/Gunfighter \(LVL 10\)/);
    // the same wish succeeds once the profile has the levels
    const vet=await client('veteranVeteran_0123456789-abcd');
    profiles.applyMatch(vet.state().profile,P.xpForLevel(30));
    vet.send({type:'profile',slot:0,loadout:{version:2,primary:5,secondary:11,wildcards:['wildcard:overkill','wildcard:gunfighter'],attachments:{primary:'suppressor'},attachments2:{primary:'quickdraw'},perks:{t1:['marathon']}}});
    await wait(()=>vet.state().pending.primary===5);const v=vet.state().pending;assert.equal(v.secondary,11);assert.deepEqual(v.attachments2,{primary:'quickdraw',secondary:null});assert.deepEqual(v.perks.t1,['marathon']);assert.ok(R.classCost(v).total<=10);
    // locked class slot still refused
    const before=JSON.stringify(rookie.state().pending);rookie.send({type:'profile',slot:4,loadout:{version:2,primary:1,secondary:0,wildcards:['wildcard:overkill']}});
    await wait(()=>rookie.errors.some(m=>/unlocks at level 14/.test(m)));assert.equal(JSON.stringify(rookie.state().pending),before);
  }finally{for(const s of sockets)s.terminate();net.close?.();await new Promise(r=>server.close(r));}
});
