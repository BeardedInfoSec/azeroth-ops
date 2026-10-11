// Token-keyed profile store. LAN gag project: a token is a bearer secret kept in
// the player's browser, there are no accounts or passwords. Raw tokens are never
// stored or logged; profiles are keyed by a salted SHA-256 of the token.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acceptCallsign,checkCallsign,checkTag} from '../src/names.mjs';
import {WEEKLY_BOT_XP_CAP} from '../src/bot-rules.mjs';
import {levelForXp,levelProgress,rankName,allUnlockedIds,applyXp,isUnlocked,UNLOCKS,MAX_LEVEL} from '../src/progression.mjs';

export const SCHEMA_VERSION=1;
export const TOKEN_PATTERN=/^[A-Za-z0-9_-]{16,64}$/;
export const validToken=t=>typeof t==='string'&&TOKEN_PATTERN.test(t);
export const hashToken=t=>createHash('sha256').update('ao-profile-v1:'+t).digest('hex').slice(0,32);
const STATS=['kills','deaths','headshots','captures','waves','wins','matches'];
const MAX_XP=1e9;

const cleanText=(v,n,fallback)=>typeof v==='string'?(v.replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,n)||fallback):fallback;
export function newProfile(id,now){
  return {id,callsign:'Operator',tag:'',xp:0,level:1,unlocked:allUnlockedIds(1),stats:Object.fromEntries(STATS.map(k=>[k,0])),title:'title:recruit',emblem:'emblem:shield',camo:{primary:'camo:stock',secondary:'camo:stock'},created:now,updated:now,lastSeen:now};
}
// Rebuilds a profile from untrusted JSON, clamping every field.
export function cleanProfile(raw,id,now=Date.now()){
  const base=newProfile(id,now);if(!raw||typeof raw!=='object')return base;
  const num=(v,max)=>Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):0;
  const p=base;const stored=checkCallsign(raw.callsign),tagged=checkTag(raw.tag);p.callsign=stored.ok?stored.name:'Operator';p.tag=tagged.ok?tagged.tag:'';if(raw.botWeek&&Number.isFinite(raw.botWeek.week)&&Number.isFinite(raw.botWeek.xp))p.botWeek={week:Math.max(0,Math.floor(raw.botWeek.week)),xp:Math.max(0,Math.min(1e6,Math.floor(raw.botWeek.xp)))};p.xp=num(raw.xp,MAX_XP);p.level=levelForXp(p.xp);
  p.unlocked=[...new Set([...allUnlockedIds(p.level),...(Array.isArray(raw.unlocked)?raw.unlocked.filter(x=>typeof x==='string'&&Object.hasOwn(UNLOCKS,x)).slice(0,200):[])])];
  for(const k of STATS)p.stats[k]=num(raw.stats?.[k],1e8);
  const pick=(v,fallback)=>typeof v==='string'&&isUnlocked(p,v)&&Object.hasOwn(UNLOCKS,v)?v:fallback;
  p.title=pick(raw.title,p.title);p.emblem=pick(raw.emblem,p.emblem);
  p.camo={primary:pick(raw.camo?.primary,'camo:stock'),secondary:pick(raw.camo?.secondary,'camo:stock')};
  for(const k of ['created','updated','lastSeen'])p[k]=Number.isFinite(raw[k])?raw[k]:now;
  return p;
}
export function publicProfile(p){
  return {callsign:p.callsign,tag:p.tag||'',xp:p.xp,level:p.level,rank:rankName(p.level),progress:levelProgress(p.xp),unlocked:p.unlocked,stats:p.stats,title:p.title,emblem:p.emblem,camo:p.camo,maxLevel:MAX_LEVEL};
}

export function createProfileStore({file=null,debounceMs=1500,maxEntries=2000,maxBytes=4*1024*1024,clock=Date.now,log=()=>{}}={}){
  let profiles=new Map(),timer=null,dirty=false,closed=false;
  function backupCorrupt(reason){
    try{const dest=file+'.corrupt-'+clock();fs.renameSync(file,dest);log('profiles: unreadable file ('+reason+') moved to '+path.basename(dest));}catch{}
  }
  function load(){
    if(!file)return;
    let text;try{const stat=fs.statSync(file);if(stat.size>maxBytes){backupCorrupt('too large');return;}text=fs.readFileSync(file,'utf8');}catch(e){if(e.code!=='ENOENT')log('profiles: read failed '+e.code);return;}
    try{
      const data=JSON.parse(text);
      if(!data||typeof data!=='object'||data.version!==SCHEMA_VERSION||typeof data.profiles!=='object'||!data.profiles)throw new Error('schema');
      for(const [id,raw] of Object.entries(data.profiles).slice(0,maxEntries))if(/^[0-9a-f]{32}$/.test(id))profiles.set(id,cleanProfile(raw,id,clock()));
    }catch(e){profiles=new Map();backupCorrupt(e.message);}
  }
  function writeNow(){
    timer=null;if(!file||!dirty)return false;dirty=false;
    const data=JSON.stringify({version:SCHEMA_VERSION,saved:clock(),profiles:Object.fromEntries(profiles)});
    const tmp=file+'.'+process.pid+'.tmp';
    try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(tmp,data);fs.renameSync(tmp,file);return true;}
    catch(e){dirty=true;try{fs.unlinkSync(tmp);}catch{}log('profiles: write failed '+e.code);return false;}
  }
  function markDirty(){
    dirty=true;if(!file||closed||timer)return;
    timer=setTimeout(writeNow,debounceMs);timer.unref?.();
  }
  function evict(){
    while(profiles.size>maxEntries){let oldest=null;for(const p of profiles.values())if(!oldest||p.lastSeen<oldest.lastSeen)oldest=p;profiles.delete(oldest.id);}
  }
  load();
  return {
    // Returns the profile for a token, creating it. Throws on a malformed token.
    resolve(token){
      if(!validToken(token))throw new Error('Invalid session token');
      const id=hashToken(token);let p=profiles.get(id);
      if(!p){p=newProfile(id,clock());profiles.set(id,p);evict();}
      p.lastSeen=clock();markDirty();return p;
    },
    get:id=>profiles.get(id)||null,
    get size(){return profiles.size;},
    // Callsigns are validated again here (names.mjs): the store never holds a name the server would refuse.
    setCallsign(p,name,tag){
      const r=acceptCallsign(name),t=tag===undefined?{ok:true,tag:p.tag||''}:checkTag(tag);let changed=false;
      if(r.ok&&!r.replaced&&r.name!==p.callsign){p.callsign=r.name;changed=true;}
      if(t.ok&&t.tag!==(p.tag||'')){p.tag=t.tag;changed=true;}
      if(changed){p.updated=clock();markDirty();}return changed;
    },
    // Cosmetic choices must be unlocked; returns false if anything was rejected.
    setCosmetics(p,{title,emblem,camo}={}){
      let ok=true;const take=(value,prefix)=>{if(value==null)return null;if(typeof value==='string'&&value.startsWith(prefix)&&Object.hasOwn(UNLOCKS,value)&&isUnlocked(p,value))return value;ok=false;return null;};
      const t=take(title,'title:'),e=take(emblem,'emblem:'),cp=take(camo?.primary,'camo:'),cs=take(camo?.secondary,'camo:');
      if(t)p.title=t;if(e)p.emblem=e;if(cp)p.camo.primary=cp;if(cs)p.camo.secondary=cs;
      p.updated=clock();markDirty();return ok;
    },
    // Adds match XP and stat deltas; returns the level-up summary.
    // opts.botXp: the part of `xp` earned from bot kills; it is limited by a weekly allowance (anti-farm).
    applyMatch(p,xp,stats={},{botXp=0}={}){
      let cut=0;
      if(botXp>0){
        const week=Math.floor((clock()-4*86400000)/(7*86400000));
        if(!p.botWeek||p.botWeek.week!==week)p.botWeek={week,xp:0};
        const allowed=Math.max(0,WEEKLY_BOT_XP_CAP-p.botWeek.xp),counted=Math.min(botXp,allowed);cut=botXp-counted;p.botWeek.xp+=counted;
      }
      const result=applyXp(p,Math.max(0,xp-cut));result.botXpCut=cut;
      for(const k of STATS)p.stats[k]=Math.min(1e8,p.stats[k]+Math.max(0,Math.floor(stats[k]||0)));
      p.xp=Math.min(MAX_XP,p.xp);p.updated=clock();markDirty();return result;
    },
    touch:markDirty,
    flush(){if(timer){clearTimeout(timer);timer=null;}return writeNow();},
    close(){this.flush();closed=true;},
  };
}
