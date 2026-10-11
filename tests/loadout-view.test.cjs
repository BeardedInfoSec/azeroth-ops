const test=require('node:test'),assert=require('node:assert/strict');
const load=async()=>({V:await import('../src/loadout-view.mjs'),R:await import('../src/loadout-rules.mjs'),L:await import('../src/loadouts.mjs'),D:await import('../src/weapon-data.js'),Rc:await import('../src/racial-traits.mjs')});
const L1={level:1,unlocked:[]},L30={level:30,unlocked:[]};
const names=list=>list.map(o=>o.name);

test('class tabs show lock levels, costs and the active class',async()=>{
  const {V,L}=await load();
  const tabs=V.classTabs(L.DEFAULT_CLASSES,2,L1);
  assert.equal(tabs.length,5);assert.deepEqual(tabs.map(t=>t.number),['01','02','03','04','05']);
  assert.deepEqual(tabs.map(t=>t.locked),[false,false,false,true,true]);assert.deepEqual([tabs[3].level,tabs[4].level],[8,14]);
  assert.deepEqual(tabs.map(t=>t.active),[false,false,true,false,false]);assert.equal(tabs[0].primary,'AN-94');assert.ok(tabs.every(t=>t.cost>0&&t.cost<=10));
  assert.ok(V.classTabs(L.DEFAULT_CLASSES,0,null).every(t=>!t.locked),'no profile: nothing locked');
  assert.ok(V.classTabs(L.DEFAULT_CLASSES,0,{level:14,unlocked:[]}).every(t=>!t.locked));
});

test('Pick-10 meter reports used, remaining and over-budget state',async()=>{
  const {V,R,L}=await load();
  const m=V.budgetMeter(L.DEFAULT_CLASSES[0]);assert.equal(m.max,10);assert.equal(m.used+m.remaining,10);assert.equal(m.pips.length,10);assert.equal(m.pips.filter(Boolean).length,m.used);assert.equal(m.text,m.used+' / 10');assert.equal(m.over,false);
  const over=R.normalizeClass({version:2,primary:2,secondary:3,wildcards:['wildcard:overkill','wildcard:gunfighter','wildcard:sidearmFighter'],attachments:{primary:'fastMags',secondary:'suppressor'},attachments2:{primary:'suppressor',secondary:'compensator'},perks:{t1:['marathon'],t2:['gunslinger'],t3:['fieldMedic']}},{trim:false}).loadout;
  const o=V.budgetMeter(over);assert.equal(o.over,true);assert.equal(o.fraction,1);assert.equal(o.remaining<0,true);
});

test('slot grid exposes every slot, with extra slots gated by wildcards',async()=>{
  const {V,R,L}=await load();
  const c=L.DEFAULT_CLASSES[0],grid=V.slotGrid(c),byId=Object.fromEntries(grid.map(s=>[s.id,s]));
  assert.deepEqual(grid.map(s=>s.id),V.SLOT_IDS);
  for(const id of ['primary','secondary','primary.att0','primary.att1','secondary.att0','secondary.att1','perk.1.0','perk.1.1','perk.2.0','perk.3.1','lethal','tactical','wildcard.0','wildcard.1','wildcard.2','camo.primary','camo.secondary','title','emblem'])assert.ok(byId[id],id);
  assert.equal(byId['primary'].value,'AN-94');assert.equal(byId['primary.att1'].available,false);assert.match(byId['primary.att1'].hint,/GUNFIGHTER/);
  assert.equal(byId['perk.1.1'].available,false);assert.match(byId['perk.1.1'].hint,/PERK 1 GREED/);
  assert.match(byId.lethal.hint,/COMING SOON/);assert.match(byId.tactical.hint,/COMING SOON/);
  const wf=V.applyChoice(V.applyChoice(c,'wildcard.1','wildcard:gunfighter').loadout,'wildcard.2','wildcard:perk1Greed').loadout;
  const g2=Object.fromEntries(V.slotGrid(wf).map(s=>[s.id,s]));assert.equal(g2['primary.att1'].available,true);assert.equal(g2['perk.1.1'].available,true);
  // shotguns have no attachments at all
  const sh=R.normalizeClass({version:2,primary:9,secondary:10}).loadout,g3=Object.fromEntries(V.slotGrid(sh).map(s=>[s.id,s]));
  assert.equal(g3['primary.att0'].available,false);assert.match(g3['primary.att0'].hint,/NONE FOR/);
  assert.deepEqual([...new Set(V.slotGrid(c).map(s=>s.group))],['weapons','attachments','perks','equipment','wildcards','style']);
});

test('option lists mark locks, placeholders, reasons and the selection',async()=>{
  const {V,L,D}=await load();
  const c=L.DEFAULT_CLASSES[0];
  const sec=V.slotOptions(c,'secondary',L1);
  assert.equal(sec.length,12);const scar=sec.find(o=>o.name==='SCAR-H');assert.equal(scar.selected,true);
  const dsr=sec.find(o=>o.name==='DSR 50');assert.deepEqual([dsr.locked,dsr.level,dsr.reason],[true,12,'LVL 12']);assert.equal(dsr.cost,2);assert.ok(dsr.stats.length===4&&dsr.stats.every(s=>s.fill>=0&&s.fill<=100));
  assert.equal(sec.find(o=>o.name==='AN-94').disabled,true,'already the primary');
  const pri=V.slotOptions(c,'primary',L30);assert.equal(pri.length,11,'no pistols as a primary');assert.ok(!pri.some(o=>o.name==='FIVE-SEVEN'));assert.ok(pri.every(o=>!o.locked));
  // without Overkill a rifle secondary is disabled with the reason
  const noOk=V.applyChoice(c,'wildcard.0',null).loadout;
  const sec2=V.slotOptions(noOk,'secondary',L30),mp7=sec2.find(o=>o.name==='MP7');assert.equal(mp7.disabled,true);assert.match(mp7.reason,/Overkill/);assert.equal(sec2.find(o=>o.name==='FIVE-SEVEN').disabled,false);
  const leth=V.slotOptions(c,'lethal',L30);assert.deepEqual(names(leth),['NONE','Frag Grenade','Sticky Charge','Throwing Axe']);assert.ok(leth.slice(1).every(o=>o.placeholder&&o.tag==='COMING SOON'));assert.equal(leth[0].selected,true);
  assert.deepEqual(names(V.slotOptions(c,'perk.1.0',L30)),['NO PERK','Second Wind','Lightweight','Scavenger','Marathon']);
  assert.equal(V.slotOptions(c,'perk.1.0',L1).find(o=>o.name==='Marathon').level,14);
  assert.deepEqual(names(V.slotOptions(c,'primary.att0',L30)),['NO ATTACHMENT','Extended Mags','Fast Mags','Foregrip','Suppressor','Red Dot','Quickdraw Grip','Reflex Sight','Compensator']);
  const camos=V.slotOptions(c,'camo.primary',L1);assert.ok(camos.find(o=>o.id==='camo:stock').selected);assert.equal(camos.find(o=>o.id==='camo:gold').locked,true);assert.equal(camos.find(o=>o.id==='camo:desert').tint,'#c2a36b');
  assert.equal(V.slotOptions(c,'title',L1).find(o=>o.id==='title:recruit').locked,false);
  assert.ok(V.slotOptions(c,'wildcard.1',L30).find(o=>o.name==='Overkill').disabled,'already equipped');
});

test('applyChoice accepts valid edits and explains refusals',async()=>{
  const {V,R,L,D}=await load();
  const c=L.DEFAULT_CLASSES[0],cost=x=>R.classCost(x).total;
  let r=V.applyChoice(c,'perk.1.0','secondWind',L1);assert.ok(r.ok);assert.deepEqual(r.loadout.perks.t1,['secondWind']);assert.equal(cost(r.loadout),cost(c)+1);assert.notEqual(r.loadout,c,'does not mutate');assert.deepEqual(c.perks.t1,[]);
  r=V.applyChoice(c,'perk.1.0','marathon',L1);assert.equal(r.ok,false);assert.match(r.reason,/level 14/);
  r=V.applyChoice(c,'perk.2.0','secondWind',L30);assert.equal(r.ok,false,'wrong tier');
  r=V.applyChoice(c,'secondary',gunIdx(D,'mp7_mp'),L30);assert.ok(r.ok);assert.equal(r.loadout.secondary,gunIdx(D,'mp7_mp'));
  r=V.applyChoice(c,'secondary',0,L30);assert.equal(r.ok,false);assert.match(r.reason,/other weapon slot/);
  r=V.applyChoice(c,'primary.att1','suppressor',L30);assert.equal(r.ok,false,'needs Gunfighter');
  r=V.applyChoice(c,'primary.att0','foregrip',L30);assert.ok(r.ok);assert.equal(r.loadout.attachments.primary,'foregrip');
  r=V.applyChoice(c,'primary.att0',null,L30);assert.ok(r.ok);assert.equal(r.loadout.attachments.primary,null);
  r=V.applyChoice(c,'primary',null);assert.equal(r.ok,false);
  r=V.applyChoice(c,'not.a.slot','x');assert.equal(r.ok,false);assert.equal(V.applyChoice(c,'__proto__','x').ok,false);assert.equal(V.applyChoice(c,'constructor','x').ok,false);
  // budget
  let big=R.normalizeClass({version:2,primary:2,secondary:3,wildcards:['wildcard:overkill','wildcard:gunfighter','wildcard:sidearmFighter'],attachments:{primary:'fastMags',secondary:'suppressor'},attachments2:{primary:'compensator',secondary:'extMags'},perks:{t1:['marathon'],t2:['gunslinger']}},{trim:false}).loadout;
  big=R.normalizeClass(big).loadout;assert.ok(cost(big)<=10);
  const room=10-cost(big);
  const add=V.applyChoice(big,'perk.3.0','fieldMedic',L30);
  if(room<2){assert.equal(add.ok,false);assert.match(add.reason,/Over budget/);}
  const ten=R.normalizeClass({version:2,primary:2,secondary:3,wildcards:['wildcard:overkill'],perks:{t1:['marathon'],t2:['gunslinger']},attachments:{primary:'fastMags'}}).loadout;assert.equal(cost(ten),10);
  const full=V.applyChoice(ten,'lethal','lethal:frag',L30);
  assert.equal(full.ok,false);assert.match(full.reason,/Over budget/);
  // removing something is always allowed when over budget would otherwise block
  assert.equal(V.applyChoice(big,'perk.2.0',null,L30).ok,true);
  // changing weapon drops attachments that no longer fit and says nothing is lost silently
  const swapped=V.applyChoice(V.applyChoice(c,'primary.att0','foregrip',L30).loadout,'primary',gunIdx(D,'dsr50_mp'),L30);assert.ok(swapped.ok);assert.equal(swapped.loadout.attachments.primary,null);
  // wildcards cannot be duplicated
  assert.equal(V.applyChoice(c,'wildcard.1','wildcard:overkill',L30).ok,false);
});
function gunIdx(D,id){return D.GUNS.findIndex(g=>g.id===id);}

test('stat card uses the same numbers the server simulates',async()=>{
  const {V,R,L,D,Rc}=await load();
  const c=R.normalizeClass({version:2,primary:0,secondary:1,wildcards:['wildcard:overkill'],attachments:{primary:'fastMags'},perks:{t2:['fastHands'],t3:['stockpile']},nicknames:{primary:'Old Reliable'}}).loadout;
  const card=V.statCard(c,'primary',{race:'human'}),real=Rc.racialWeapons(L.classWeapons(D.GUNS,c),'human')[0];
  const row=l=>card.rows.find(r=>r.label===l);
  assert.equal(card.name,'Old Reliable');assert.equal(card.gunName,'AN-94');assert.equal(card.nickname,'Old Reliable');
  assert.equal(row('Reload / empty').value,real.reload.toFixed(2)+' / '+real.reloadEmpty.toFixed(2)+' s');assert.equal(row('Magazine / reserve').value,real.capacity+' / '+real.reserve);
  assert.equal(row('Reload / empty').trend,'up');assert.equal(row('Magazine / reserve').trend,'up');assert.equal(row('Damage').trend,'');
  assert.equal(real.reload,D.GUNS[0].reload*.85*.85);
  assert.equal(card.fireMode,'FULL AUTO');assert.deepEqual(card.attachments.map(a=>a.id),['fastMags']);
  // each of the 12 guns renders finite numbers
  for(let i=0;i<D.GUNS.length;i++){
    const k=R.normalizeClass({version:2,primary:D.GUNS[i].class==='pistol'?0:i,secondary:D.GUNS[i].class==='pistol'?i:(i===0?1:0),wildcards:['wildcard:overkill']}).loadout;
    for(const slot of ['primary','secondary']){const cc=V.statCard(k,slot,{race:'orc'});assert.ok(cc.rows.length===7&&cc.rows.every(r=>r.value&&!/NaN|undefined/.test(r.value)&&r.fill>=0&&r.fill<=100),D.GUNS[i].id);}
  }
  assert.equal(V.statCard(c,'primary').rows.length,7,'race is optional');
  const shot=V.statCard(R.normalizeClass({version:2,primary:gunIdx(D,'870mcs_mp'),secondary:10}).loadout,'primary');assert.match(shot.rows[0].value,/ x 8$/);assert.equal(shot.fireMode,'PUMP ACTION');
  assert.equal(V.statCard(c,'bogus'),null);
  const rows=V.classRows(R.normalizeClass({version:2,primary:0,secondary:10,perks:{t1:['lightweight']}}).loadout);assert.equal(rows[0].value,'108%');assert.equal(rows[0].trend,'up');assert.equal(rows[1].trend,'');
  assert.equal(V.classNotes(R.normalizeClass({version:2,primary:0,secondary:10,lethal:'lethal:frag'}).loadout).length,1);assert.equal(V.classNotes(c).length,0);
});

test('copy, reset, rename and nickname helpers are immutable and validated',async()=>{
  const {V,L}=await load();
  const classes=L.DEFAULT_CLASSES.map(c=>structuredClone(c)),snap=JSON.stringify(classes);
  const copied=V.copyClassTo(classes,0,3);assert.equal(JSON.stringify(classes),snap);assert.deepEqual(copied[3],classes[0]);assert.notEqual(copied[3],classes[0]);assert.equal(copied[1],classes[1]);
  assert.equal(V.copyClassTo(classes,0,0),classes);assert.equal(V.copyClassTo(classes,0,9),classes);assert.equal(V.copyClassTo(classes,-1,2),classes);
  const edited=V.applyChoice(classes[2],'perk.3.0','stockpile').loadout,list=classes.slice();list[2]=edited;
  assert.deepEqual(V.resetClassAt(list,2)[2],L.DEFAULT_CLASSES[2]);assert.equal(V.resetClassAt(list,7),list);
  assert.equal(V.renameClass(classes[0],'  Spacey   Name  ').name,'Spacey Name');assert.equal(V.renameClass(classes[0],'<b>'+'x'.repeat(40)).name.length,20);assert.equal(V.renameClass(classes[0],'').name,'Custom');
  assert.equal(V.setNickname(classes[0],'primary','Bessie').nicknames.primary,'Bessie');assert.equal(V.setNickname(classes[0],'bogus','x'),classes[0]);assert.equal(V.setNickname(classes[0],'secondary','y'.repeat(50)).nicknames.secondary.length,16);
  assert.match(V.summaryLine(classes[1]),/Close Quarters \/ SCAR-H \+ AN-94/);
});

test('Lobby class bookkeeping: slot locks, persistence and v1 storage migration',async t=>{
  const store=new Map(),old=global.localStorage,oldDoc=global.document;global.document={activeElement:null};
  global.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};t.after(()=>{if(old)global.localStorage=old;else delete global.localStorage;if(oldDoc)global.document=oldDoc;else delete global.document;});
  const {Lobby,CLASS_STORAGE_KEY,LEGACY_CLASS_STORAGE_KEY}=await import('../src/lobby.js'),{migrateStore}=await import('../src/loadout-rules.mjs'),{DEFAULT_CLASSES}=await import('../src/loadouts.mjs');
  assert.equal(CLASS_STORAGE_KEY,'ao-classes-v2');assert.equal(LEGACY_CLASS_STORAGE_KEY,'ao-classes-v1');
  const lobby=Object.create(Lobby.prototype);lobby.classes=DEFAULT_CLASSES.map(c=>structuredClone(c));lobby.activeClass=1;lobby.progress=null;lobby.renderClass=()=>{lobby.renders=(lobby.renders||0)+1;};lobby.profile=()=>{lobby.sent=(lobby.sent||0)+1;};lobby.status=text=>{lobby.last=text;};
  assert.equal(lobby.slotLock(4),0,'no profile: nothing locked');lobby.progress={level:1,unlocked:[]};assert.deepEqual([0,1,2,3,4].map(i=>lobby.slotLock(i)),[0,0,0,8,14]);lobby.progress={level:8,unlocked:[]};assert.deepEqual([3,4].map(i=>lobby.slotLock(i)),[0,14]);
  lobby.builder={openSlot:'perk.1.0'};
  lobby.selectClass(4);assert.equal(lobby.activeClass,1,'locked slots cannot be selected');assert.match(lobby.last,/unlocks at level 14/);
  lobby.selectClass(3);assert.equal(lobby.activeClass,3);assert.equal(lobby.builder.openSlot,null);assert.ok(lobby.sent>=1);
  const saved=JSON.parse(store.get('ao-classes-v2'));assert.equal(saved.version,2);assert.equal(saved.active,3);assert.equal(saved.classes.length,5);
  const edit=structuredClone(lobby.loadout);edit.name='Edited';lobby.commitClass(edit);assert.equal(JSON.parse(store.get('ao-classes-v2')).classes[3].name,'Edited');assert.match(lobby.last,/saved/i);
  const before=lobby.sent;lobby.setClasses(lobby.classes.map(c=>c),'Copied');assert.equal(lobby.sent,before,'unchanged active class is not re-sent');
  lobby.setClasses(lobby.classes.map((c,i)=>i===3?{...c,name:'Changed'}:c),'Edited');assert.equal(lobby.sent,before+1);
  // a v1 save loads through migrateStore without touching the v1 key
  const v1=JSON.stringify({classes:[{name:'A',primary:2,secondary:3,perk:'fastHands'},{name:'B',primary:0,secondary:1},{name:'C',primary:1,secondary:0},{name:'D',primary:0,secondary:2},{name:'E',primary:3,secondary:0}],active:2});
  const m=migrateStore(JSON.parse(v1));assert.equal(m.classes[0].perks.t2[0],'fastHands');assert.equal(m.active,2);assert.equal(v1,JSON.stringify(JSON.parse(v1)));
});
