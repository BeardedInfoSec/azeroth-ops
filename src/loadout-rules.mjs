// Create-a-Class rules: catalogs, Pick-10 costs, validation, normalization and migration.
// Pure and DOM-free. The server is authoritative and runs the very same functions through
// cleanLoadout() (src/loadouts.mjs); the lobby only uses them to draw the builder.
//
// Data model v2 (one class):
//   {version:2, name, primary, secondary,                 gun indices into GUNS
//    attachments:{primary,secondary},                     first attachment id | null
//    attachments2:{primary,secondary},                    extra attachment (needs a Gunfighter wildcard)
//    perks:{t1:[ids],t2:[ids],t3:[ids]},                  one per tier (two with that tier's Greed wildcard)
//    lethal, tactical,                                    placeholder equipment ids | null (NO effect yet)
//    wildcards:[ids],                                     up to 3
//    camo:{primary,secondary}, title, emblem,             cosmetic ids from src/progression.mjs
//    nicknames:{primary,secondary},                       cosmetic text
//    perk}                                                legacy single perk, derived, never trusted
// v1 saves ({name,primary,secondary,perk,attachments}) migrate without loss: the single perk moves to
// its tier and a non-pistol secondary gains the Overkill wildcard (1 point).
import {GUNS} from './weapon-data.js';
import {ATTACHMENTS_BY_ID,canEquip,cleanAttachmentList} from './attachments.mjs';
import {isUnlocked,UNLOCKS} from './progression.mjs';

export const SCHEMA_VERSION=2,BUDGET=10,MAX_WILDCARDS=3,MAX_NAME=20,MAX_NICKNAME=16,MAX_EXPORT_CHARS=2400,CLASS_COUNT=5;

// ---- Catalogs ----------------------------------------------------------------
// Weapon cost by gun class. Pistols, shotguns, ARs and SMGs cost 1; snipers and LMGs cost 2.
export const GUN_COSTS=Object.freeze({ar:1,smg:1,shotgun:1,pistol:1,sniper:2,lmg:2});
export const gunClass=gun=>gun?.class||'ar';
export const gunCost=gun=>GUN_COSTS[gunClass(gun)]??1;
export const isPistol=gun=>gunClass(gun)==='pistol';

const freeze=o=>Object.freeze(o);
const P=(id,tier,name,cost,summary,effect)=>freeze({id,tier,name,cost,summary,effect:freeze(effect)});
// effect keys: speed, reload, adsIn, recoil, reserve, regen (all multipliers, see perkEffects).
export const PERK_CATALOG=freeze([
  P('secondWind',1,'Second Wind',1,'Health regeneration is 40% faster. Not active in Battle Royale.',{regen:1.4}),
  P('lightweight',1,'Lightweight',1,'8% faster movement.',{speed:1.08}),
  P('scavenger',1,'Scavenger',1,'25% more reserve ammunition.',{reserve:1.25}),
  P('marathon',1,'Marathon',2,'14% faster movement.',{speed:1.14}),
  P('quickDraw',2,'Fast Draw',1,'Aim down sights is 15% faster.',{adsIn:.85}),
  P('fastHands',2,'Fast Hands',1,'15% shorter reloads.',{reload:.85}),
  P('steadyAim',2,'Steady Aim',1,'15% less recoil kick.',{recoil:.85}),
  P('gunslinger',2,'Gunslinger',2,'8% shorter reloads and 10% faster aim down sights.',{reload:.92,adsIn:.9}),
  P('stockpile',3,'Stockpile',1,'50% more reserve ammunition.',{reserve:1.5}),
  P('ironNerves',3,'Iron Nerves',1,'10% less recoil kick and 5% faster aim down sights.',{recoil:.9,adsIn:.95}),
  P('bandolier',3,'Bandolier',1,'15% more reserve ammunition and 5% shorter reloads.',{reserve:1.15,reload:.95}),
  P('fieldMedic',3,'Field Medic',2,'Health regeneration is twice as fast. Not active in Battle Royale.',{regen:2}),
]);
export const PERKS_BY_ID=freeze(Object.fromEntries(PERK_CATALOG.map(p=>[p.id,p])));
export const PERK_TIERS=freeze([1,2,3]);
export const TIER_NAMES=freeze({1:'PERK 1 / FIELD',2:'PERK 2 / HANDLING',3:'PERK 3 / COMBAT'});
export const perksForTier=tier=>PERK_CATALOG.filter(p=>p.tier===tier);

// Lethal and tactical: selectable DATA ONLY. The engine has no grenade support yet, so the server
// ignores these ids entirely (implemented:false). They still cost points, so saved classes stay
// valid the day the effects ship.
const E=(id,kind,name,summary)=>freeze({id,kind,name,cost:1,summary,implemented:false});
export const LETHALS=freeze([
  E('lethal:frag','lethal','Frag Grenade','Cookable explosive. COMING SOON: no effect yet.'),
  E('lethal:stickyCharge','lethal','Sticky Charge','Adheres to surfaces. COMING SOON: no effect yet.'),
  E('lethal:throwingAxe','lethal','Throwing Axe','Silent, recoverable. COMING SOON: no effect yet.'),
]);
export const TACTICALS=freeze([
  E('tactical:flashbang','tactical','Flashbang','Blinds nearby enemies. COMING SOON: no effect yet.'),
  E('tactical:smokeScreen','tactical','Smoke Screen','Blocks line of sight. COMING SOON: no effect yet.'),
  E('tactical:concussion','tactical','Concussion Grenade','Slows and rattles enemies. COMING SOON: no effect yet.'),
]);
export const EQUIPMENT_BY_ID=freeze(Object.fromEntries([...LETHALS,...TACTICALS].map(e=>[e.id,e])));

const W=(id,name,cost,summary)=>freeze({id,name,cost,summary});
export const WILDCARDS=freeze([
  W('wildcard:overkill','Overkill',1,'Carry two primary weapons: the secondary slot accepts any non-pistol.'),
  W('wildcard:gunfighter','Gunfighter',1,'One extra attachment on your primary weapon (each still costs a point).'),
  W('wildcard:sidearmFighter','Sidearm Gunfighter',1,'One extra attachment on your secondary weapon.'),
  W('wildcard:perk1Greed','Perk 1 Greed',1,'A second Perk 1 slot.'),
  W('wildcard:perk2Greed','Perk 2 Greed',1,'A second Perk 2 slot.'),
  W('wildcard:perk3Greed','Perk 3 Greed',1,'A second Perk 3 slot.'),
]);
export const WILDCARDS_BY_ID=freeze(Object.fromEntries(WILDCARDS.map(w=>[w.id,w])));
export const OVERKILL='wildcard:overkill';

export const CAMO_IDS=freeze(Object.values(UNLOCKS).filter(u=>u.kind==='camo').map(u=>u.id));
const kindOfUnlock=(id,kind)=>typeof id==='string'&&Object.hasOwn(UNLOCKS,id)&&UNLOCKS[id].kind===kind;

// ---- Cost table (exported for the UI and the report) --------------------------------------
export const COST_TABLE=freeze({
  weapon:freeze({...GUN_COSTS}),attachment:1,perk:'1 (Marathon, Gunslinger, Field Medic cost 2)',lethal:1,tactical:1,wildcard:1,
  free:freeze(['class name','camo','title','emblem','weapon nickname']),
});

// ---- Small sanitizers -------------------------------------------------------------------
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max,fallback='')=>typeof v==='string'?(v.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||fallback):fallback;
const idOrNull=v=>typeof v==='string'&&v.length<=40?v:null;
const slots=['primary','secondary'];
const tierKey=t=>'t'+t;

// ---- Draft: untrusted input -> typed fields (no catalog knowledge yet) ----------------------
function draftOf(raw){
  const r=plain(raw)?raw:{},v2=r.version===2;
  const pair=o=>({primary:idOrNull(plain(o)?o.primary:null),secondary:idOrNull(plain(o)?o.secondary:null)});
  const d={
    legacy:!v2,name:text(r.name,MAX_NAME,'Custom'),
    primary:Number.isInteger(r.primary)?r.primary:-1,secondary:Number.isInteger(r.secondary)?r.secondary:-1,
    attachments:pair(r.attachments),attachments2:v2?pair(r.attachments2):{primary:null,secondary:null},
    perks:{t1:[],t2:[],t3:[]},lethal:idOrNull(r.lethal),tactical:idOrNull(r.tactical),
    wildcards:v2&&Array.isArray(r.wildcards)?r.wildcards.filter(x=>typeof x==='string').slice(0,8):[],
    camo:pair(r.camo),title:idOrNull(r.title),emblem:idOrNull(r.emblem),
    nicknames:{primary:text(plain(r.nicknames)?r.nicknames.primary:'',MAX_NICKNAME),secondary:text(plain(r.nicknames)?r.nicknames.secondary:'',MAX_NICKNAME)},
  };
  if(v2&&plain(r.perks))for(const t of PERK_TIERS){const list=r.perks[tierKey(t)];if(Array.isArray(list))d.perks[tierKey(t)]=list.filter(x=>typeof x==='string').slice(0,4);}
  else if(!v2&&typeof r.perk==='string'&&Object.hasOwn(PERKS_BY_ID,r.perk))d.perks['t'+PERKS_BY_ID[r.perk].tier]=[r.perk];   // v1 migration
  return d;
}
// A clean loadout is also a valid draft (used by the budget trimmer and by edits).
const draftFromClean=c=>({...structuredClone(c),legacy:false});

// ---- Settle: drafts -> authoritative loadout ------------------------------------------------
function settle(d,{profile=null,guns=GUNS,violations=null,notes=null}={}){
  const note=m=>notes?.push(m),open=id=>!profile||isUnlocked(profile,id);
  const allow=id=>{if(open(id))return true;violations?.push(id);return false;};
  const out={version:SCHEMA_VERSION};
  out.name=d.name;
  // Wildcards first: they open or close the other slots.
  const wild=[];
  for(const id of d.wildcards){if(wild.length>=MAX_WILDCARDS)break;if(!Object.hasOwn(WILDCARDS_BY_ID,id)||wild.includes(id)){continue;}if(allow(id))wild.push(id);}
  const addOverkill=()=>{if(wild.includes(OVERKILL))return true;if(wild.length>=MAX_WILDCARDS||!open(OVERKILL))return false;wild.push(OVERKILL);return true;};
  const gunOk=i=>Number.isInteger(i)&&i>=0&&i<guns.length;
  const gunOpen=i=>open(guns[i].id);
  // Primary: any non-pistol.
  let primary=gunOk(d.primary)&&!isPistol(guns[d.primary])?d.primary:-1;
  if(primary>=0&&!gunOpen(primary)){violations?.push(guns[primary].id);primary=-1;}
  if(primary<0){primary=guns.findIndex((g,i)=>!isPistol(g)&&gunOpen(i));if(primary<0)primary=guns.findIndex(g=>!isPistol(g));if(primary<0)primary=0;
    if(d.primary>=0)note('Primary weapon replaced.');}
  // Secondary: pistol, or any non-pistol with Overkill.
  const legacyOverkill=d.legacy&&gunOk(d.secondary)&&d.secondary!==primary&&!isPistol(guns[d.secondary]);
  if(legacyOverkill)addOverkill();
  const eligible=i=>gunOk(i)&&i!==primary&&(isPistol(guns[i])||wild.includes(OVERKILL));
  let secondary=eligible(d.secondary)?d.secondary:-1;
  if(secondary>=0&&!gunOpen(secondary)){violations?.push(guns[secondary].id);secondary=-1;}
  if(secondary<0){
    if(gunOk(d.secondary)&&d.secondary!==primary&&!isPistol(guns[d.secondary])&&!wild.includes(OVERKILL)&&!d.legacy)note('Secondary weapon needs the Overkill wildcard.');
    const rest=[...guns.keys()].filter(i=>i!==primary),pistols=rest.filter(i=>isPistol(guns[i])),others=rest.filter(i=>!isPistol(guns[i]));
    const legacyPick=d.legacy?(primary+1)%Math.min(4,guns.length):-1;   // the pre-v2 default partner
    const order=d.legacy?[legacyPick,...pistols,...others]:[...pistols,...others];
    secondary=-1;
    for(const i of order){if(i===primary||!gunOpen(i))continue;if(isPistol(guns[i])||addOverkill()){secondary=i;break;}}
    if(secondary<0)secondary=rest.find(gunOpen)??rest[0]??0;
    if(!isPistol(guns[secondary]))addOverkill();
  }
  out.primary=primary;out.secondary=secondary;
  // Attachments. A second one needs the matching Gunfighter wildcard; one per exclusivity group.
  const extra={primary:wild.includes('wildcard:gunfighter'),secondary:wild.includes('wildcard:sidearmFighter')};
  out.attachments={primary:null,secondary:null};out.attachments2={primary:null,secondary:null};
  for(const slot of slots){
    const gun=guns[out[slot]],first=d.attachments[slot],second=extra[slot]?d.attachments2[slot]:null;
    const wanted=[first,second].filter(id=>{if(id==null)return false;if(!canEquip(gun,id)){note('Attachment '+id+' does not fit '+gun.name+'.');return false;}return allow(id);});
    const list=cleanAttachmentList(gun,wanted,extra[slot]?2:1);
    out.attachments[slot]=list[0]??null;out.attachments2[slot]=list[1]??null;
  }
  // Perks: one per tier, two with that tier's Greed wildcard.
  out.perks={t1:[],t2:[],t3:[]};
  for(const t of PERK_TIERS){
    const room=1+(wild.includes('wildcard:perk'+t+'Greed')?1:0),list=out.perks[tierKey(t)];
    for(const id of d.perks[tierKey(t)]){
      if(list.length>=room)break;
      if(id==='balanced'||list.includes(id))continue;
      if(!Object.hasOwn(PERKS_BY_ID,id)||PERKS_BY_ID[id].tier!==t){note('Perk '+id+' is not a Tier '+t+' perk.');continue;}
      if(allow(id))list.push(id);
    }
  }
  const equip=(id,kind)=>id&&Object.hasOwn(EQUIPMENT_BY_ID,id)&&EQUIPMENT_BY_ID[id].kind===kind&&allow(id)?id:null;
  out.lethal=equip(d.lethal,'lethal');out.tactical=equip(d.tactical,'tactical');
  out.wildcards=wild;
  const camo=id=>kindOfUnlock(id,'camo')&&allow(id)?id:'camo:stock';
  out.camo={primary:camo(d.camo.primary),secondary:camo(d.camo.secondary)};
  out.title=kindOfUnlock(d.title,'title')&&allow(d.title)?d.title:null;
  out.emblem=kindOfUnlock(d.emblem,'emblem')&&allow(d.emblem)?d.emblem:null;
  out.nicknames={...d.nicknames};
  out.perk=legacyPerk(out);
  return out;
}
// The single legacy perk id older clients and tests read: the first equipped original perk.
const LEGACY_PERKS=['lightweight','fastHands','stockpile'];
function legacyPerk(c){for(const id of LEGACY_PERKS)if(c.perks[tierKey(PERKS_BY_ID[id].tier)].includes(id))return id;return 'balanced';}

// ---- Cost -------------------------------------------------------------------------------
export function classCost(c,guns=GUNS){
  const lines=[],add=(kind,id,label,cost)=>lines.push({kind,id,label,cost});
  for(const slot of slots){
    const g=guns[c?.[slot]];if(g)add('weapon',g.id,g.name,gunCost(g));
    for(const key of ['attachments','attachments2']){const id=c?.[key]?.[slot];if(id&&Object.hasOwn(ATTACHMENTS_BY_ID,id))add('attachment',id,ATTACHMENTS_BY_ID[id].name,1);}
  }
  for(const t of PERK_TIERS)for(const id of c?.perks?.[tierKey(t)]||[])if(Object.hasOwn(PERKS_BY_ID,id))add('perk',id,PERKS_BY_ID[id].name,PERKS_BY_ID[id].cost);
  for(const key of ['lethal','tactical']){const id=c?.[key];if(id&&Object.hasOwn(EQUIPMENT_BY_ID,id))add(key,id,EQUIPMENT_BY_ID[id].name,1);}
  for(const id of c?.wildcards||[])if(Object.hasOwn(WILDCARDS_BY_ID,id))add('wildcard',id,WILDCARDS_BY_ID[id].name,1);
  return {total:lines.reduce((n,l)=>n+l.cost,0),lines,budget:BUDGET};
}

// ---- Budget trim: drops the least important items until the class fits Pick 10 ------------------
function trimOnce(d){
  const take=f=>{const had=f();if(had)return true;return false;};
  const steps=[
    ()=>{if(d.tactical){d.tactical=null;return true;}},
    ()=>{if(d.lethal){d.lethal=null;return true;}},
    ()=>{if(d.attachments2.secondary){d.attachments2.secondary=null;return true;}},
    ()=>{if(d.attachments2.primary){d.attachments2.primary=null;return true;}},
    ...[3,2,1].map(t=>()=>{if(d.perks[tierKey(t)].length>1){d.perks[tierKey(t)].pop();return true;}}),
    ()=>{if(d.attachments.secondary){d.attachments.secondary=null;return true;}},
    ()=>{if(d.attachments.primary){d.attachments.primary=null;return true;}},
    ...[3,2,1].map(t=>()=>{if(d.perks[tierKey(t)].length){d.perks[tierKey(t)].pop();return true;}}),
    // Wildcards last; removing one may also remove what depended on it, which the next settle handles.
    ()=>{const id=d.wildcards.findLast(w=>w!==OVERKILL)??d.wildcards.at(-1);if(id){d.wildcards.splice(d.wildcards.indexOf(id),1);return true;}},
  ];
  for(const step of steps)if(take(step))return true;
  return false;
}

// ---- Public: normalize -----------------------------------------------------------------------
// raw: any untrusted value. profile: optional, locked picks are swapped for free ones and their ids
// pushed to `violations`. Returns {loadout,cost,violations,notes,ok,trimmed}. Never throws.
export function normalizeClass(raw,{profile=null,guns=GUNS,trim=true}={}){
  const violations=[],notes=[];
  let loadout=settle(draftOf(raw),{profile,guns,violations,notes}),trimmed=false;
  for(let i=0;trim&&i<24&&classCost(loadout,guns).total>BUDGET;i++){
    const d=draftFromClean(loadout);if(!trimOnce(d))break;trimmed=true;
    loadout=settle(d,{profile,guns});
  }
  if(trimmed)notes.push('Over the Pick '+BUDGET+' budget: lower priority items were removed.');
  const cost=classCost(loadout,guns);
  return {loadout,cost,violations,notes,trimmed,ok:!violations.length&&!notes.length};
}
export const cleanClass=(raw,profile=null,violations=null,guns=GUNS)=>{const r=normalizeClass(raw,{profile,guns});violations?.push(...r.violations);return r.loadout;};
// {ok,errors[]}: errors lists every violation or correction the server would make to `raw`.
export function validateClass(raw,{profile=null,guns=GUNS}={}){
  const r=normalizeClass(raw,{profile,guns});
  return {ok:r.ok,errors:[...r.violations.map(id=>'locked: '+id),...r.notes],cost:r.cost.total,loadout:r.loadout};
}

// ---- Effects (the only place perk numbers are read) ---------------------------------------------
export function perkIds(loadout){
  if(plain(loadout?.perks)){const out=[];for(const t of PERK_TIERS){const list=loadout.perks[tierKey(t)];if(Array.isArray(list))for(const id of list)if(Object.hasOwn(PERKS_BY_ID,id)&&!out.includes(id))out.push(id);}return out;}
  return typeof loadout?.perk==='string'&&Object.hasOwn(PERKS_BY_ID,loadout.perk)?[loadout.perk]:[];   // legacy shape
}
export const REGEN_CAP=2.5;
export function perkEffects(loadout){
  const fx={speed:1,reload:1,adsIn:1,recoil:1,reserve:1,regen:1};
  for(const id of perkIds(loadout))for(const [k,v] of Object.entries(PERKS_BY_ID[id].effect))fx[k]*=v;
  fx.regen=Math.min(REGEN_CAP,fx.regen);fx.recoil=Math.max(.6,fx.recoil);return fx;
}
export const slotAttachmentIds=(loadout,slot)=>[loadout?.attachments?.[slot],loadout?.attachments2?.[slot]].filter(Boolean);

// ---- Defaults ----------------------------------------------------------------------------------
// Presets use only level-1 items: AN-94 and SCAR-H, the Overkill wildcard, Fast Mags and the level-1
// perks. (New players own no other guns, so every default carries two primaries via Overkill.)
const preset=(name,primary,secondary,att,perks)=>({version:2,name,primary,secondary,wildcards:[OVERKILL],attachments:att,perks});
export const DEFAULT_PRESETS=freeze([
  preset('Assault',0,1,{primary:'fastMags'},{t2:['quickDraw']}),
  preset('Close Quarters',1,0,{secondary:'fastMags'},{t1:['secondWind'],t2:['quickDraw']}),
  preset('Support',0,1,{primary:'fastMags',secondary:'fastMags'},{t1:['secondWind']}),
  preset('Marksman',1,0,{primary:'fastMags'},{t2:['quickDraw']}),
  preset('Run & Gun',0,1,{},{t1:['secondWind'],t2:['quickDraw']}),
]);
export const defaultClasses=()=>DEFAULT_PRESETS.map(p=>normalizeClass(p).loadout);
export const defaultClass=index=>normalizeClass(DEFAULT_PRESETS[index]||DEFAULT_PRESETS[0]).loadout;

// ---- Storage migration (client): ao-classes-v1 / v2 -> {version:2,classes:[5],active} -------------
export function migrateStore(saved){
  const defaults=defaultClasses(),list=plain(saved)&&Array.isArray(saved.classes)?saved.classes.slice(0,CLASS_COUNT):[];
  const classes=defaults.map((d,i)=>plain(list[i])?normalizeClass(list[i]).loadout:d);
  const active=plain(saved)&&Number.isInteger(saved.active)&&saved.active>=0&&saved.active<CLASS_COUNT?saved.active:0;
  return {version:SCHEMA_VERSION,classes,active};
}

// ---- JSON export / import ---------------------------------------------------------------------
export function exportClass(loadout){
  const {loadout:clean}=normalizeClass(loadout),{perk,...rest}=clean;void perk;
  return JSON.stringify({ao:'class',version:SCHEMA_VERSION,class:rest});
}
// Hostile text is rejected, never evaluated. Returns {ok:true,loadout,notes,violations,cost} or {ok:false,error}.
export function importClass(textValue,{profile=null,guns=GUNS}={}){
  if(typeof textValue!=='string')return {ok:false,error:'Paste a class string.'};
  const s=textValue.trim();
  if(!s)return {ok:false,error:'Paste a class string.'};
  if(s.length>MAX_EXPORT_CHARS)return {ok:false,error:'That string is too long to be a class.'};
  let data;try{data=JSON.parse(s);}catch{return {ok:false,error:'That is not valid class data.'};}
  if(!plain(data)||data.ao!=='class'||!(data.version===1||data.version===2)||!plain(data.class))return {ok:false,error:'That is not an Azeroth Ops class.'};
  const raw=data.version===1?{...data.class,version:undefined}:data.class;
  const r=normalizeClass(raw,{profile,guns});
  return {ok:true,loadout:r.loadout,notes:r.notes,violations:r.violations,cost:r.cost};
}
