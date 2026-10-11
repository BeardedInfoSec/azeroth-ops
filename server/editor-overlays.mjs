import crypto from 'node:crypto';
import * as T from 'three';
import {GroundNavigation} from '../src/navigation.js';
import {SurvivalWorld} from '../src/survival-world.js';
import {COOP_PERKS} from '../src/coop-rules.mjs';
import {survivalOrigin} from './world.mjs';

export const OVERLAY_FORTIFICATIONS=['light','classic','off'];
const MAX_BARRIERS=900,MAX_SPAWNS=1200;
const r=n=>Math.round(n*100)/100,at=v=>[r(v.x),r(v.y),r(v.z)];

/** Pure: turn a constructed SurvivalWorld into light JSON (no meshes, no THREE objects). */
export function overlayFromWorld(world,{spawns=[],origin=null,authored=null}={}){
  const items=[],zoneName=zone=>world.zoneNames?.[zone]||'Zone '+(zone+1),stage=zone=>'Stage '+(zone+1);
  const counters=new Map();
  for(const w of world.windows||[]){
    const n=(counters.get(w.zone)||0)+1;counters.set(w.zone,n);
    items.push({id:w.id,kind:'breach',zone:w.zone,label:stage(w.zone)+' undead breach '+n,position:at(w.spawnPoint||w.inside),rotation:r(w.mesh?.rotation?.y||0)});
  }
  for(const m of world.machines||[]){
    const pack=m.type==='pack',p=m.mesh.position;
    items.push({id:m.id,kind:pack?'pack':'perk',zone:m.zone,label:(m.name||m.id)+' ('+m.cost+')',position:at(p),rotation:r(m.mesh.rotation.y),size:pack?[1.02,2.8,.78]:[.88,2.8,.8]});
  }
  for(const w of world.weaponBuys||[])items.push({id:w.id,kind:'weapon',zone:w.zone,label:'Wall weapon '+(w.zone+1)+' ('+w.name+', '+w.cost+')',position:at(w.mesh.position),rotation:r(w.mesh.rotation.y),size:[1.8,2.2,.2]});
  let barriers=0;
  for(const b of world.barriers||[]){
    if(b.type==='window'||barriers>=MAX_BARRIERS)continue;barriers++;
    const mid=b.mesh.position;
    items.push({id:b.id,kind:b.type==='gate'?'gate':b.type==='rail'?'rail':'wall',zone:b.level-1,label:b.type==='gate'?'Gate to '+zoneName(b.level)+' ('+b.cost+')':b.type==='rail'?'Outer rail':'Zone '+b.level+' boundary',position:at(mid),rotation:r(b.mesh.rotation.y),size:[r(b.width),r(b.height),r(b.depth)]});
  }
  const list=Array.isArray(spawns)?spawns:[],step=Math.max(1,Math.ceil(list.length/MAX_SPAWNS));
  for(let i=0,n=0;i<list.length;i+=step,n++)items.push({id:'spawn-'+n,kind:'spawn',label:'Team spawn',position:at(list[i])});
  if(origin)items.push({id:'survival-origin',kind:'origin',label:'Co-op start',position:at(origin)});
  const counts={};for(const item of items)counts[item.kind]=(counts[item.kind]||0)+1;
  // Designer spawns are drawn by the editor from the layout itself; the server only
  // reports which ones it accepted and why others failed, so none vanish silently.
  const spawnReports=authored?{accepted:authored.accepted.map(a=>a.id),rejected:authored.rejected.map(({id,reason})=>({id,reason}))}:{accepted:[],rejected:[]};
  return {fortifications:world.fortifications,zoneNames:world.zoneNames||[],items,counts,spawnReports};
}

/** Builds the real SurvivalWorld on the CPU (no renderer, no model files) for one arena. */
export function computeOverlays(arena,fortifications='light',{perks=COOP_PERKS}={}){
  const fort=OVERLAY_FORTIFICATIONS.includes(fortifications)?fortifications:'light';
  const origin=survivalOrigin(arena,arena.city),nav=new GroundNavigation(origin,arena.floorAt,arena.blocked);
  const world=new SurvivalWorld({scene:new T.Scene(),nav,spawn:origin,city:arena.city,worldCollider:arena.collider,perkDefinitions:perks,fortifications:fort,machineFactory:()=>null});
  try{return {city:arena.city,...overlayFromWorld(world,{spawns:arena.autoSpawns||arena.spawns,origin,authored:arena.authoredSpawns})};}finally{world.dispose();}
}

/** Lazy, bounded per-(city,layout,fortification) cache. Only plain JSON is retained. */
export function createOverlayService({loadArena,compute=computeOverlays,max=6}={}){
  const cache=new Map();
  async function get(city,fortifications){
    const fort=OVERLAY_FORTIFICATIONS.includes(fortifications)?fortifications:'light';
    const arena=await loadArena(city),hash=crypto.createHash('sha1').update(JSON.stringify(arena.layout?.placements||[])+JSON.stringify(arena.layout?.hiddenProps||[])+JSON.stringify(arena.layout?.spawns||[])).digest('hex').slice(0,12),key=city+'|'+fort+'|'+hash;
    const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit.promise;}
    const entry={promise:Promise.resolve().then(()=>({...compute(arena,fort),layoutHash:hash}))};
    cache.set(key,entry);entry.promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
    while(cache.size>max)cache.delete(cache.keys().next().value);
    return entry.promise;
  }
  return {get,get size(){return cache.size;}};
}
