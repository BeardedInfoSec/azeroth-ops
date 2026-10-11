// Pure view-models for the Armory / Create-a-Class builder. No DOM here: src/loadout-ui.js draws
// whatever these functions return, and tests exercise them directly.
//
// Slot ids understood by slotOptions()/applyChoice():
//   primary, secondary, primary.att0, primary.att1, secondary.att0, secondary.att1,
//   perk.1.0 perk.1.1 perk.2.0 perk.2.1 perk.3.0 perk.3.1, lethal, tactical,
//   wildcard.0 wildcard.1 wildcard.2, camo.primary, camo.secondary, title, emblem
import {GUNS} from './weapon-data.js';
import {ATTACHMENTS_BY_ID,attachmentsFor} from './attachments.mjs';
import {classWeapons,classSpeed,classRegen} from './loadouts.mjs';
import {isUnlocked,requiredLevel,UNLOCKS} from './progression.mjs';
import {racialWeapons} from './racial-traits.mjs';
import {
  BUDGET,MAX_WILDCARDS,OVERKILL,PERK_TIERS,TIER_NAMES,LETHALS,TACTICALS,WILDCARDS,WILDCARDS_BY_ID,PERKS_BY_ID,EQUIPMENT_BY_ID,CAMO_IDS,
  classCost,gunCost,gunClass,isPistol,normalizeClass,perksForTier,defaultClass,
} from './loadout-rules.mjs';

const tierKey=t=>'t'+t;
export const CLASS_LABELS=Object.freeze({ar:'ASSAULT RIFLE',smg:'SMG',lmg:'LMG',sniper:'SNIPER RIFLE',shotgun:'SHOTGUN',pistol:'PISTOL'});

export const lockState=(id,profile)=>({locked:!!profile&&!isUnlocked(profile,id),level:requiredLevel(id)});
const named=id=>UNLOCKS[id]?.name||id;

// ---- Tabs -------------------------------------------------------------------------------------
export function classTabs(classes,active,profile=null,guns=GUNS){
  return classes.map((c,index)=>{
    const lock=lockState('slot:'+(index+1),profile);
    return {index,number:String(index+1).padStart(2,'0'),name:c.name,primary:guns[c.primary]?.name||'',secondary:guns[c.secondary]?.name||'',
      cost:classCost(c,guns).total,locked:lock.locked,level:lock.level,active:index===active};
  });
}

// ---- Budget meter -----------------------------------------------------------------------------------
export function budgetMeter(c,guns=GUNS){
  const cost=classCost(c,guns),used=cost.total;
  return {used,max:BUDGET,remaining:BUDGET-used,over:used>BUDGET,fraction:Math.min(1,used/BUDGET),text:used+' / '+BUDGET,
    pips:Array.from({length:BUDGET},(_,i)=>i<used),lines:cost.lines};
}

// ---- Slot grid ------------------------------------------------------------------------------------------
const has=(c,id)=>c.wildcards.includes(id);
export function slotGrid(c,guns=GUNS){
  const out=[],add=s=>out.push({empty:!s.value,available:true,hint:'',cost:0,...s});
  for(const slot of ['primary','secondary']){
    const g=guns[c[slot]];
    add({id:slot,group:'weapons',label:slot==='primary'?'PRIMARY WEAPON':'SECONDARY WEAPON',value:g?.name||'',cost:g?gunCost(g):0,hint:g?CLASS_LABELS[gunClass(g)]:''});
    const second=slot==='primary'?'wildcard:gunfighter':'wildcard:sidearmFighter',fits=attachmentsFor(g).length>0;
    for(const n of [0,1]){
      const id=c[n?'attachments2':'attachments'][slot],extraLocked=n===1&&!has(c,second);
      add({id:slot+'.att'+n,group:'attachments',label:(slot==='primary'?'PRIMARY':'SECONDARY')+' ATTACHMENT'+(n?' 2':''),value:id?ATTACHMENTS_BY_ID[id].name:'',cost:id?1:0,
        available:fits&&!extraLocked,hint:!fits?'NONE FOR '+(g?.name||'WEAPON').toUpperCase():extraLocked?'NEEDS '+WILDCARDS_BY_ID[second].name.toUpperCase()+' WILDCARD':''});
    }
  }
  for(const t of PERK_TIERS)for(const n of [0,1]){
    const id=c.perks[tierKey(t)][n],greed=has(c,'wildcard:perk'+t+'Greed');
    add({id:'perk.'+t+'.'+n,group:'perks',label:TIER_NAMES[t]+(n?' 2':''),value:id?PERKS_BY_ID[id].name:'',cost:id?PERKS_BY_ID[id].cost:0,available:n===0||greed,hint:n&&!greed?'NEEDS PERK '+t+' GREED WILDCARD':''});
  }
  for(const key of ['lethal','tactical']){
    const id=c[key];add({id:key,group:'equipment',label:key.toUpperCase(),value:id?EQUIPMENT_BY_ID[id].name:'',cost:id?1:0,hint:'COMING SOON / NO EFFECT YET'});
  }
  for(let i=0;i<MAX_WILDCARDS;i++){const id=c.wildcards[i];add({id:'wildcard.'+i,group:'wildcards',label:'WILDCARD '+(i+1),value:id?WILDCARDS_BY_ID[id].name:'',cost:id?1:0});}
  for(const slot of ['primary','secondary'])add({id:'camo.'+slot,group:'style',label:slot.toUpperCase()+' CAMO',value:named(c.camo[slot])});
  add({id:'title',group:'style',label:'TITLE',value:c.title?named(c.title):'PROFILE DEFAULT'});
  add({id:'emblem',group:'style',label:'EMBLEM',value:c.emblem?named(c.emblem):'PROFILE DEFAULT'});
  return out;
}
export const GROUP_TITLES=Object.freeze({weapons:'WEAPONS',attachments:'ATTACHMENTS',perks:'PERKS',equipment:'EQUIPMENT',wildcards:'WILDCARDS',style:'APPEARANCE'});

// ---- Slot reading / writing -----------------------------------------------------------------------------
function readSlot(c,slotId){
  const [kind,a,b]=slotId.split('.');
  switch(kind){
    case 'primary':case 'secondary':return a===undefined?c[kind]:c[a==='att0'?'attachments':'attachments2'][kind];
    case 'perk':return c.perks[tierKey(Number(a))]?.[Number(b)]??null;
    case 'lethal':case 'tactical':return c[kind];
    case 'wildcard':return c.wildcards[Number(a)]??null;
    case 'camo':return c.camo[a];
    case 'title':case 'emblem':return c[kind];
    default:return undefined;
  }
}
export const SLOT_IDS=Object.freeze(slotGrid(defaultClass(0)).map(s=>s.id));
function writeSlot(d,slotId,value){
  const [kind,a,b]=slotId.split('.'),v=value===''||value===undefined?null:value;
  switch(kind){
    case 'primary':case 'secondary':
      if(a===undefined)d[kind]=Number(v);else d[a==='att0'?'attachments':'attachments2'][kind]=v;return true;
    case 'perk':{const list=d.perks[tierKey(Number(a))];if(!list)return false;if(v==null)list.splice(Number(b),1);else list[Number(b)]=v;return true;}
    case 'lethal':case 'tactical':d[kind]=v;return true;
    case 'wildcard':{const i=Number(a);if(!(i>=0&&i<MAX_WILDCARDS))return false;if(v==null)d.wildcards.splice(i,1);else d.wildcards[i]=v;return true;}
    case 'camo':if(a!=='primary'&&a!=='secondary')return false;d.camo[a]=v||'camo:stock';return true;
    case 'title':case 'emblem':d[kind]=v;return true;
    default:return false;
  }
}
const sameValue=(a,b)=>(a??null)===(b??null);

// Tries a change. Returns {ok,loadout,reason,notes}; the server would reach the same answer.
export function applyChoice(c,slotId,value,profile=null,guns=GUNS){
  if(typeof slotId!=='string'||!SLOT_IDS.includes(slotId))return {ok:false,loadout:c,reason:'Unknown slot.',notes:[]};
  const clearing=value==null||value==='',before=classCost(c,guns).total;
  if(!clearing){
    const unlockId=slotId==='primary'||slotId==='secondary'?guns[Number(value)]?.id:value,lock=unlockId?lockState(unlockId,profile):{locked:false};
    if(lock.locked)return {ok:false,loadout:c,reason:'Unlocks at level '+lock.level+'.',notes:[]};
  }
  if(!clearing){
    const [kind,a,b]=slotId.split('.'),dup=why=>({ok:false,loadout:c,reason:why,notes:[]});
    if((slotId==='primary'&&Number(value)===c.secondary)||(slotId==='secondary'&&Number(value)===c.primary))return dup('Already equipped in your other weapon slot.');
    if(a==='att0'||a==='att1'){
      const other=c[a==='att0'?'attachments2':'attachments'][kind];
      if(other===value&&readSlot(c,slotId)!==value)return dup('Already equipped.');
      if(other&&other!==value&&ATTACHMENTS_BY_ID[other]?.group===ATTACHMENTS_BY_ID[value]?.group)return dup('One '+ATTACHMENTS_BY_ID[value].group+' attachment per weapon.');
    }
    if(kind==='perk'&&c.perks[tierKey(Number(a))].some((id,i)=>id===value&&i!==Number(b)))return dup('Already equipped.');
    if(kind==='wildcard'&&c.wildcards.some((id,i)=>id===value&&i!==Number(a)))return dup('Already equipped.');
  }
  const d=structuredClone(c);
  if(slotId==='secondary'&&!clearing){const g=guns[Number(value)];if(g&&!isPistol(g)&&!has(c,OVERKILL))return {ok:false,loadout:c,reason:'Needs the Overkill wildcard.',notes:[]};}
  if((slotId==='primary'||slotId==='secondary')&&clearing)return {ok:false,loadout:c,reason:'A weapon is required.',notes:[]};
  if(!writeSlot(d,slotId,value))return {ok:false,loadout:c,reason:'Unknown slot.',notes:[]};
  const trial=normalizeClass(d,{profile,guns,trim:false});
  if(!clearing&&!sameValue(readSlot(trial.loadout,slotId),slotId==='primary'||slotId==='secondary'?Number(value):value))
    return {ok:false,loadout:c,reason:trial.notes[0]||'That item does not fit this class.',notes:trial.notes};
  if(trial.cost.total>BUDGET&&trial.cost.total>before)return {ok:false,loadout:c,reason:'Over budget: '+trial.cost.total+' / '+BUDGET+'.',notes:[]};
  return {ok:true,loadout:trial.loadout,reason:'',notes:trial.notes};
}

// ---- Option lists -------------------------------------------------------------------------------------------
function weaponBars(g){
  const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));
  return [{label:'Damage',fill:clamp(g.damage)},{label:'Fire rate',fill:clamp(60/(g.cycle||g.interval)/10)},{label:'Magazine',fill:clamp(g.capacity)},{label:'Handling',fill:clamp(100-g.adsIn/.6*100)}];
}
const fireModeText=g=>({auto:'FULL AUTO',semi:'SEMI-AUTO',burst:'BURST',bolt:'BOLT ACTION',pump:'PUMP ACTION'}[g.fireMode]||(g.bolt?'BOLT ACTION':'FULL AUTO'));
export const fireModeLabel=fireModeText;

export function slotOptions(c,slotId,profile=null,guns=GUNS){
  const kind=slotId.split('.')[0],list=[];
  const make=(id,name,extra)=>{
    const unlockId=extra.unlockId??id,lock=id==null?{locked:false,level:1}:lockState(unlockId,profile);
    const trial=lock.locked?null:applyChoice(c,slotId,extra.value??id,profile,guns);
    const selected=sameValue(readSlot(c,slotId),extra.value??id);
    list.push({id:extra.value??id,name,cost:0,summary:'',stats:null,placeholder:false,tag:'',...extra,
      locked:lock.locked,level:lock.level,selected,disabled:!!trial&&!trial.ok&&!selected,reason:lock.locked?'LVL '+lock.level:(trial&&!trial.ok&&!selected?trial.reason:'')});
  };
  const none=label=>make(null,label,{value:null,unlockId:null,summary:'Leave this slot empty.'});
  if(slotId==='primary'||slotId==='secondary'){
    guns.forEach((g,i)=>{if(slotId==='primary'&&isPistol(g))return;make(g.id,g.name,{value:i,unlockId:g.id,cost:gunCost(g),tag:CLASS_LABELS[gunClass(g)],summary:CLASS_LABELS[gunClass(g)]+' / '+fireModeText(g)+' / '+g.caliber,stats:weaponBars(g)});});
  }else if(slotId.includes('.att')){
    const slot=kind,g=guns[c[slot]];none('NO ATTACHMENT');
    for(const a of attachmentsFor(g))make(a.id,a.name,{cost:1,summary:a.summary,tag:a.group.toUpperCase()});
  }else if(kind==='perk'){
    const tier=Number(slotId.split('.')[1]);none('NO PERK');
    for(const p of perksForTier(tier))make(p.id,p.name,{cost:p.cost,summary:p.summary});
  }else if(kind==='lethal'||kind==='tactical'){
    none('NONE');for(const e of kind==='lethal'?LETHALS:TACTICALS)make(e.id,e.name,{cost:1,summary:e.summary,placeholder:true,tag:'COMING SOON'});
  }else if(kind==='wildcard'){
    none('NO WILDCARD');for(const w of WILDCARDS)make(w.id,w.name,{cost:1,summary:w.summary});
  }else if(kind==='camo'){
    for(const id of CAMO_IDS)make(id,named(id),{summary:UNLOCKS[id].tint?'Tint '+UNLOCKS[id].tint:'No tint.',tint:UNLOCKS[id].tint||null});
  }else if(kind==='title'||kind==='emblem'){
    none('PROFILE DEFAULT');for(const u of Object.values(UNLOCKS))if(u.kind===kind)make(u.id,u.name,{});
  }
  return list;
}

// ---- Weapon stat card ----------------------------------------------------------------------------------------------
const pct=n=>Math.round(n*100)+'%';
// Rows use the real numbers the server will simulate (base + attachments + perks + racial).
// trend: 'up' better than the unmodified gun, 'down' worse, '' unchanged.
export function statCard(c,slot,{race=null,guns=GUNS}={}){
  const index=c[slot],base=guns[index];if(!base)return null;
  const mine=classWeapons(guns,c),real=race?racialWeapons(mine,race):mine,g=real[index];
  const trend=(now,was,lowerBetter=false)=>Math.abs(now-was)<1e-9?'':((now<was)===lowerBetter?'up':'down');
  const rpm=Math.round(60/(g.cycle||g.interval)),baseRpm=Math.round(60/(base.cycle||base.interval));
  const clamp=n=>Math.max(0,Math.min(100,n));
  const rows=[
    {label:'Damage',value:String(g.damage)+(g.pellets>1?' x '+g.pellets:''),fill:clamp(g.damage),trend:trend(g.damage,base.damage)},
    {label:'Fire rate',value:rpm+' RPM',fill:clamp(rpm/10),trend:trend(rpm,baseRpm)},
    {label:'Magazine / reserve',value:g.capacity+' / '+g.reserve,fill:clamp(g.capacity),trend:trend(g.capacity+g.reserve,base.capacity+base.reserve)},
    {label:'Aim down sights',value:Math.round(g.adsIn*1000)+' ms',fill:clamp(g.adsIn/.5*100),trend:trend(g.adsIn,base.adsIn,true)},
    {label:'Recoil kick',value:pct(g.recoil??1),fill:clamp((g.recoil??1)*100),trend:trend(g.recoil??1,base.recoil??1,true)},
    {label:'Zoom FOV',value:g.adsFov+' deg',fill:clamp(g.adsFov/78*100),trend:trend(g.adsFov,base.adsFov,true)},
    {label:'Reload / empty',value:g.reload.toFixed(2)+' / '+g.reloadEmpty.toFixed(2)+' s',fill:clamp(g.reloadEmpty/4*100),trend:trend(g.reload,base.reload,true)},
  ];
  const attachments=[c.attachments[slot],c.attachments2[slot]].filter(Boolean).map(id=>ATTACHMENTS_BY_ID[id]);
  return {slot,index,id:g.id,name:c.nicknames?.[slot]||g.name,gunName:g.name,caliber:g.caliber,class:CLASS_LABELS[gunClass(g)]||'',fireMode:fireModeText(g),
    nickname:c.nicknames?.[slot]||'',rows,attachments:attachments.map(a=>({id:a.id,name:a.name,summary:a.summary}))};
}
// Class-wide numbers from perks (movement, regeneration).
export function classRows(c){
  const speed=classSpeed(c),regen=classRegen(c);
  return [{label:'Movement speed',value:pct(speed),fill:Math.min(100,speed*70),trend:speed>1?'up':''},
    {label:'Health regeneration',value:pct(regen)+' (not in Battle Royale)',fill:Math.min(100,regen*40),trend:regen>1?'up':''}];
}
export function classNotes(c){
  const notes=[];
  if(c.lethal||c.tactical)notes.push('Lethal and tactical equipment are placeholders: the server ignores them until grenades ship, but they still cost points.');
  return notes;
}
export const summaryLine=(c,guns=GUNS)=>c.name+' / '+(guns[c.primary]?.name||'?')+' + '+(guns[c.secondary]?.name||'?');

// ---- Class list edits (immutable) ---------------------------------------------------------------------------------
export function copyClassTo(classes,from,to){
  if(!classes[from]||!classes[to]||from===to)return classes;
  const next=classes.slice();next[to]=structuredClone(classes[from]);return next;
}
export function resetClassAt(classes,index){if(!classes[index])return classes;const next=classes.slice();next[index]=defaultClass(index);return next;}
export function renameClass(c,name){return normalizeClass({...c,name}).loadout;}
export function setNickname(c,slot,name){if(slot!=='primary'&&slot!=='secondary')return c;return normalizeClass({...c,nicknames:{...c.nicknames,[slot]:name}}).loadout;}
