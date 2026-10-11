// Shared, pure progression rules: level curve, rank names, XP awards and the
// unlock catalog. Used by the server (authoritative) and the lobby UI.
// This is a LAN gag project: there are no accounts or passwords.

import {BOT_XP_FACTOR} from './bot-rules.mjs';

export const MAX_LEVEL=30;

// XP needed to advance FROM level n TO n+1. Gentle linear curve:
// 400 at level 1 up to 3300 at level 29 (52,200 XP total for level 30).
export const xpStep=level=>400+100*(Math.max(1,Math.min(MAX_LEVEL-1,level))-1);
export function xpForLevel(level){
  level=Math.max(1,Math.min(MAX_LEVEL,Math.floor(level)||1));
  let total=0;for(let n=1;n<level;n++)total+=xpStep(n);return total;
}
export function levelForXp(xp){
  xp=Number.isFinite(xp)?Math.max(0,xp):0;let level=1;
  while(level<MAX_LEVEL&&xp>=xpForLevel(level+1))level++;return level;
}
export function levelProgress(xp){
  xp=Number.isFinite(xp)?Math.max(0,xp):0;const level=levelForXp(xp);
  if(level>=MAX_LEVEL)return {level,into:0,needed:0,fraction:1};
  const base=xpForLevel(level),needed=xpStep(level);
  return {level,into:xp-base,needed,fraction:Math.min(1,(xp-base)/needed)};
}

export const RANKS=Object.freeze([
  'Peon','Grunt','Recruit','Footman','Scout','Private','Rifleman','Raider','Corporal','Sergeant',
  'Blademaster','Headhunter','Staff Sergeant','Sentinel','Knight','Lieutenant','Captain','Stalker','Battlemage','Major',
  'Champion','Shadow Hunter','Lt. Colonel','Colonel','Knight-Captain','Brigadier','Marshal','Overlord','High Warlord','Warchief',
]);
export const rankName=level=>RANKS[Math.max(1,Math.min(MAX_LEVEL,Math.floor(level)||1))-1];

// ---- XP awards -------------------------------------------------------------
export const XP={
  kill:100,headshot:50,knife:25,capture:150,domTick:10,zombieKill:50,zombieHeadshot:100,
  wave:200,revive:150,matchComplete:300,win:500,
};
export const MATCH_CAP=6000;                      // everything except completion/win bonuses
export const KIND_CAPS=Object.freeze({kill:3500,objective:2000,zombie:5000,wave:2400,revive:1200});
// Kills on the same victim: 1st/2nd full, then decaying to nothing (spawn-trade farming).
export const REPEAT_VICTIM=Object.freeze([1,1,.5,.25,0]);
// Undead kills beyond this many in one match pay half (bot farming).
export const ZOMBIE_FULL_KILLS=60;
const LABELS={kill:'Kills',headshot:'Headshots',knife:'Knife kills',capture:'Point captures',domTick:'Point control',zombieKill:'Undead kills',zombieHeadshot:'Undead headshots',wave:'Waves survived',revive:'Revives',matchComplete:'Match complete',win:'Victory'};

export function createLedger(){return {total:0,capped:0,kinds:{},counts:{},victims:{},items:{}};}
const copy=l=>({...(l.botXp?{botXp:l.botXp}:{}),total:l.total,capped:l.capped,kinds:{...l.kinds},counts:{...l.counts},victims:{...l.victims},items:Object.fromEntries(Object.entries(l.items).map(([k,v])=>[k,{...v}]))});
const kindOf=type=>type==='kill'?'kill':type==='capture'||type==='domTick'?'objective':type==='zombieKill'?'zombie':type;

// Returns the XP bonus lines for one event before caps/multipliers.
function lines(event,ledger){
  switch(event?.type){
    case 'kill':{
      if(event.friendly)return [];
      const seen=ledger.victims[event.victimId]||0,mult=REPEAT_VICTIM[Math.min(seen,REPEAT_VICTIM.length-1)]*(event.bot?BOT_XP_FACTOR:1);
      const out=[['kill',XP.kill*mult]];
      if(event.headshot)out.push(['headshot',XP.headshot*mult]);
      if(event.knife)out.push(['knife',XP.knife*mult]);
      return out;
    }
    case 'capture':return [['capture',XP.capture]];
    case 'domTick':return [['domTick',XP.domTick]];
    case 'zombieKill':{
      const half=(ledger.counts.zombieKill||0)>=ZOMBIE_FULL_KILLS?.5:1;
      return [[event.headshot?'zombieHeadshot':'zombieKill',(event.headshot?XP.zombieHeadshot:XP.zombieKill)*half]];
    }
    case 'wave':return [['wave',XP.wave]];
    case 'revive':return [['revive',XP.revive]];
    case 'matchComplete':return [['matchComplete',XP.matchComplete]];
    case 'win':return [['win',XP.win]];
    default:return [];
  }
}
// Pure: returns {ledger,xp}. Completion and win bonuses bypass the caps.
export function awardXp(ledger,event){
  const next=copy(ledger||createLedger());let granted=0;
  const free=event?.type==='matchComplete'||event?.type==='win';
  const kind=kindOf(event?.type),kindCap=KIND_CAPS[kind]??Infinity;
  for(const [id,raw] of lines(event,next)){
    let amount=Math.round(raw);if(amount<=0)continue;
    if(!free){
      amount=Math.min(amount,kindCap-(next.kinds[kind]||0),MATCH_CAP-(next.total-(next.items.matchComplete?.xp||0)-(next.items.win?.xp||0)));
      if(amount<Math.round(raw))next.capped++;
      if(amount<=0)continue;
      next.kinds[kind]=(next.kinds[kind]||0)+amount;
    }
    next.total+=amount;granted+=amount;
    // Bot kills are tracked separately: they share a weekly allowance applied when the profile is credited.
    if(event?.bot&&event.type==='kill')next.botXp=(next.botXp||0)+amount;
    const item=next.items[id]||={label:LABELS[id],count:0,xp:0};item.count++;item.xp+=amount;
    next.counts[id]=(next.counts[id]||0)+1;
  }
  if(event?.type==='kill'&&!event.friendly&&event.victimId!=null)next.victims[event.victimId]=(next.victims[event.victimId]||0)+1;
  return {ledger:next,xp:granted};
}
export const breakdown=ledger=>Object.entries(ledger?.items||{}).map(([id,i])=>({id,label:i.label,count:i.count,xp:i.xp})).filter(i=>i.xp>0);

// ---- Unlock catalog --------------------------------------------------------
// id -> {level, kind, name}. Gun ids match src/weapon-data.js GUNS[].id; attachment
// ids match src/attachments.mjs; perk ids match src/loadouts.mjs PERKS.
// level 1 == available from the start.
export const UNLOCK_KINDS=Object.freeze(['weapon','attachment','perk','slot','title','emblem','camo','lethal','tactical','wildcard']);
const U=(id,level,kind,name,extra={})=>[id,{id,level,kind,name,...extra}];
export const UNLOCKS=Object.freeze(Object.fromEntries([
  U('an94_mp',1,'weapon','AN-94'),U('scar_mp',1,'weapon','SCAR-H'),
  U('dsr50_mp',12,'weapon','DSR 50'),U('ballista_mp',16,'weapon','Ballista'),
  U('fastMags',1,'attachment','Fast Mags'),U('extMags',4,'attachment','Extended Mags'),U('foregrip',6,'attachment','Foregrip'),
  U('redDot',8,'attachment','Red Dot'),U('suppressor',10,'attachment','Suppressor'),
  U('quickdraw',3,'attachment','Quickdraw Grip'),U('reflex',5,'attachment','Reflex Sight'),U('compensator',7,'attachment','Compensator'),
  U('balanced',1,'perk','Balanced'),U('lightweight',2,'perk','Lightweight'),U('fastHands',3,'perk','Fast Hands'),U('stockpile',5,'perk','Stockpile'),
  // Create-a-Class perks (src/loadout-rules.mjs). Tier 1: secondWind/lightweight/scavenger/marathon.
  // Tier 2: quickDraw/fastHands/steadyAim/gunslinger. Tier 3: stockpile/ironNerves/bandolier/fieldMedic.
  U('secondWind',1,'perk','Second Wind'),U('quickDraw',1,'perk','Fast Draw'),U('scavenger',6,'perk','Scavenger'),U('steadyAim',4,'perk','Steady Aim'),
  U('ironNerves',7,'perk','Iron Nerves'),U('bandolier',10,'perk','Bandolier'),U('gunslinger',12,'perk','Gunslinger'),U('marathon',14,'perk','Marathon'),U('fieldMedic',16,'perk','Field Medic'),
  U('wildcard:overkill',1,'wildcard','Overkill'),U('wildcard:gunfighter',10,'wildcard','Gunfighter'),U('wildcard:sidearmFighter',12,'wildcard','Sidearm Gunfighter'),
  U('wildcard:perk1Greed',7,'wildcard','Perk 1 Greed'),U('wildcard:perk2Greed',11,'wildcard','Perk 2 Greed'),U('wildcard:perk3Greed',15,'wildcard','Perk 3 Greed'),
  U('lethal:frag',1,'lethal','Frag Grenade'),U('lethal:stickyCharge',6,'lethal','Sticky Charge'),U('lethal:throwingAxe',12,'lethal','Throwing Axe'),
  U('tactical:flashbang',1,'tactical','Flashbang'),U('tactical:smokeScreen',4,'tactical','Smoke Screen'),U('tactical:concussion',10,'tactical','Concussion Grenade'),
  // Guns 5..12 of src/weapon-data.js (levels were reserved earlier; same levels, now announced on level-up).
  U('mp7_mp',2,'weapon','MP7'),U('fiveseven_mp',3,'weapon','Five-seven'),U('vector_mp',5,'weapon','Vector K10'),U('type95_mp',7,'weapon','Type 25'),
  U('sig556_mp',9,'weapon','SWAT-556'),U('870mcs_mp',11,'weapon','R870 MCS'),U('mk48_mp',13,'weapon','MK 48'),U('as50_mp',18,'weapon','XPR-50'),
  U('slot:1',1,'slot','Class 1'),U('slot:2',1,'slot','Class 2'),U('slot:3',1,'slot','Class 3'),U('slot:4',8,'slot','Class 4'),U('slot:5',14,'slot','Class 5'),
  U('title:recruit',1,'title','Recruit'),U('title:scrapper',3,'title','Scrapper'),U('title:veteran',7,'title','Veteran'),U('title:ghost',11,'title','Ghost'),
  U('title:bannerman',15,'title','Bannerman'),U('title:slayer',19,'title','Undead Slayer'),U('title:warlord',24,'title','Warlord'),U('title:legend',30,'title','Legend of Azeroth'),
  U('emblem:shield',1,'emblem','Shield'),U('emblem:skull',5,'emblem','Skull'),U('emblem:crossblades',9,'emblem','Crossblades'),
  U('emblem:wolf',13,'emblem','Wolf'),U('emblem:lion',17,'emblem','Lion'),U('emblem:crown',22,'emblem','Crown'),U('emblem:dragon',27,'emblem','Dragon'),
  U('camo:stock',1,'camo','Stock',{tint:null}),U('camo:desert',2,'camo','Desert',{tint:'#c2a36b'}),U('camo:forest',6,'camo','Forest',{tint:'#4f6b3a'}),
  U('camo:arctic',10,'camo','Arctic',{tint:'#cfd8dc'}),U('camo:crimson',14,'camo','Crimson',{tint:'#9c2a22'}),U('camo:fel',18,'camo','Fel Green',{tint:'#7bd13b'}),
  U('camo:arcane',21,'camo','Arcane',{tint:'#6f5bd6'}),U('camo:gold',25,'camo','Gold',{tint:'#d4a82a'}),U('camo:frost',28,'camo','Frostmourne',{tint:'#7fd4ff'}),
  U('camo:urban',4,'camo','Urban',{tint:'#6d7480'}),U('camo:ember',8,'camo','Ember',{tint:'#d9631e'}),U('camo:jade',12,'camo','Jade',{tint:'#2f9e7a'}),U('camo:bone',20,'camo','Bone',{tint:'#e6dcc3'}),
]));
// Reserved levels for guns that exist in weapon-data.js but are not selectable yet (the
// class picker currently offers GUNS[0..3]); move an entry into UNLOCKS when it ships.
// Placeholder for guns added later (weapon id -> level). Guns that appear in
// GUNS but have no entry anywhere stay free so new content is never bricked.
export const FUTURE_WEAPON_LEVELS={};   // all shipped: the guns above live in UNLOCKS now
export const unlockInfo=id=>UNLOCKS[id]||(Object.hasOwn(FUTURE_WEAPON_LEVELS,id)?{id,level:FUTURE_WEAPON_LEVELS[id],kind:'weapon',name:id}:null);
export const requiredLevel=id=>unlockInfo(id)?.level??1;
export const unlocksAtLevel=level=>Object.values(UNLOCKS).filter(u=>u.level===level);
export function newlyUnlocked(from,to){return Object.values(UNLOCKS).filter(u=>u.level>from&&u.level<=to).map(u=>u.id);}
// profile == null means "no profile": everything is allowed (tests, offline).
export function isUnlocked(profile,id){
  if(!profile)return true;
  const info=unlockInfo(id);if(!info)return true;
  return info.level<=(profile.level||1)||(Array.isArray(profile.unlocked)&&profile.unlocked.includes(id));
}
export function allUnlockedIds(level){return Object.values(UNLOCKS).filter(u=>u.level<=level).map(u=>u.id);}

// Applies match XP to a profile-shaped object (mutates, returns the summary).
export function applyXp(profile,xp){
  const before=profile.level||levelForXp(profile.xp||0);
  profile.xp=Math.max(0,Math.floor((profile.xp||0)+xp));profile.level=levelForXp(profile.xp);
  const unlocked=newlyUnlocked(before,profile.level);
  for(const id of unlocked)if(!profile.unlocked.includes(id))profile.unlocked.push(id);
  return {levelBefore:before,levelAfter:profile.level,levelUps:profile.level-before,unlocked};
}

// Server-side class validation: swaps locked picks for free ones and says why.
// Used only when a profile exists; callers without one skip it entirely.
export function enforceLoadout(profile,loadout,guns){
  if(!profile)return {loadout,violations:[]};
  const out={...loadout,attachments:{...loadout.attachments}},violations=[];
  const gid=i=>guns[i]?.id;
  const free=guns.findIndex(g=>isUnlocked(profile,g.id));
  for(const slot of ['primary','secondary']){
    if(!isUnlocked(profile,gid(out[slot]))){
      violations.push(gid(out[slot]));
      const other=slot==='primary'?'secondary':'primary';
      const pick=guns.findIndex((g,i)=>isUnlocked(profile,g.id)&&i!==out[other]);
      out[slot]=pick>=0?pick:(free>=0?free:0);
    }
  }
  if(out.primary===out.secondary)out.secondary=guns.findIndex((g,i)=>i!==out.primary&&isUnlocked(profile,g.id));
  if(out.secondary<0)out.secondary=(out.primary+1)%guns.length;
  for(const slot of ['primary','secondary']){const a=out.attachments[slot];if(a&&!isUnlocked(profile,a)){violations.push(a);out.attachments[slot]=null;}}
  if(!isUnlocked(profile,out.perk)){violations.push(out.perk);out.perk='balanced';}
  return {loadout:out,violations};
}
