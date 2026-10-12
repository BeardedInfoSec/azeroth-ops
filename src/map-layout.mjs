import {DISTRICTS,defaultLighting} from './districts.mjs';
export const LAYOUT_VERSION = 1;
export const EDITOR_CITIES = Object.freeze({
  ...Object.fromEntries(DISTRICTS.map(d=>[d.id,{name:d.name,spawn:[...d.origin]}])),
  dalaran:{name:'Dalaran',spawn:[4,5.72,32]},
  darnassus:{name:'Darnassus',spawn:[-310,-4.88,398]}
});
export const SPAWN_TEAMS = Object.freeze(['any','alliance','horde']);
export const MAX_LAYOUT_SPAWNS = 64;
export const LAYOUT_PREFABS = Object.freeze([
  {id:'crate',name:'Supply crate',category:'Cover',size:[1.5,1.4,1.5]},
  {id:'cart',name:'Supply cart',category:'Cover',size:[2.6,1.5,1.5]},
  {id:'barricade',name:'Low barricade',category:'Cover',size:[3,1.2,.35]}
]);
export function defaultLayout(city='stormwind') {
  if(!Object.hasOwn(EDITOR_CITIES,city))throw new Error('Unknown city');
  return {version:LAYOUT_VERSION,city,settings:{fortifications:'light',lighting:defaultLighting(city)},placements:[],hiddenProps:[]};
}
const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export function validateLayout(input,{city=input?.city,prefabIds=null,instanceCount=20000}={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||input.version!==LAYOUT_VERSION)throw new Error('Unsupported layout version');
  const output=defaultLayout(city);if(input.city!==city)throw new Error('Layout belongs to a different city');
  if(!['light','classic','off'].includes(input.settings?.fortifications))throw new Error('Choose light, classic, or off fortifications');
  if(!['spooky','day'].includes(input.settings?.lighting))throw new Error('Choose spooky or daylight lighting');
  output.settings={fortifications:input.settings.fortifications,lighting:input.settings.lighting};
  if(!Array.isArray(input.placements)||input.placements.length>256)throw new Error('A layout supports up to 256 added assets');
  const ids=new Set();
  for(const placement of input.placements){
    if(!placement||typeof placement!=='object'||typeof placement.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(placement.id)||ids.has(placement.id))throw new Error('Each placement needs a unique simple ID');
    ids.add(placement.id);
    if(typeof placement.prefabId!=='string'||!(/^(crate|cart|barricade|wow:\d{1,5}|machine:[a-z0-9_-]{1,48})$/.test(placement.prefabId))||(prefabIds&&!prefabIds.has(placement.prefabId)))throw new Error('Unavailable asset: '+placement.prefabId);
    if(!Array.isArray(placement.position)||placement.position.length!==3||!placement.position.every(v=>finite(v,-10000,10000)))throw new Error('Asset positions must be finite coordinates within the city');
    if(!finite(placement.rotation,-Math.PI*200,Math.PI*200)||!finite(placement.scale,.1,6)||typeof placement.solid!=='boolean')throw new Error('Invalid rotation, scale, or collision setting');
    output.placements.push({id:placement.id,prefabId:placement.prefabId,position:[...placement.position],rotation:placement.rotation,scale:placement.scale,solid:placement.solid});
  }
  if(!Array.isArray(input.hiddenProps)||input.hiddenProps.length>20000)throw new Error('Invalid hidden prop list');
  for(const index of input.hiddenProps){if(!Number.isSafeInteger(index)||index<0||index>=instanceCount)throw new Error('Unknown original prop');}
  output.hiddenProps=[...new Set(input.hiddenProps)].sort((a,b)=>a-b);
  // Optional designer spawns. Layouts saved before this field existed carry no
  // `spawns` key and are returned unchanged (no key added).
  if(input.spawns!==undefined){
    if(!Array.isArray(input.spawns)||input.spawns.length>MAX_LAYOUT_SPAWNS)throw new Error('A layout supports up to '+MAX_LAYOUT_SPAWNS+' spawn points');
    const spawnIds=new Set();output.spawns=[];
    input.spawns.forEach((spawn,index)=>{
      if(!spawn||typeof spawn!=='object'||Array.isArray(spawn))throw new Error('Invalid spawn point');
      const id=spawn.id===undefined?'spawn-'+(index+1):spawn.id;
      if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(id)||spawnIds.has(id))throw new Error('Each spawn needs a unique simple ID');
      spawnIds.add(id);
      if(!Array.isArray(spawn.position)||spawn.position.length!==3||!spawn.position.every(v=>finite(v,-10000,10000)))throw new Error('Spawn positions must be finite coordinates within the city');
      if(!finite(spawn.yaw,-Math.PI*200,Math.PI*200))throw new Error('Invalid spawn direction');
      const team=spawn.team===undefined?'any':spawn.team;
      if(!SPAWN_TEAMS.includes(team))throw new Error('Spawn team must be any, alliance, or horde');
      output.spawns.push({id,position:[...spawn.position],yaw:spawn.yaw,team});
    });
  }
  return output;
}
export function layoutSnapshot(layout){return JSON.stringify(layout);}
export class LayoutHistory {
  constructor(layout,limit=80){this.limit=limit;this.reset(layout);}
  reset(layout){this.entries=[layoutSnapshot(layout)];this.index=0;}
  push(layout){const next=layoutSnapshot(layout);if(next===this.entries[this.index])return false;this.entries.splice(this.index+1);this.entries.push(next);if(this.entries.length>this.limit)this.entries.shift();this.index=this.entries.length-1;return true;}
  undo(){if(this.index>0)this.index--;return JSON.parse(this.entries[this.index]);}
  redo(){if(this.index<this.entries.length-1)this.index++;return JSON.parse(this.entries[this.index]);}
  get canUndo(){return this.index>0;}get canRedo(){return this.index<this.entries.length-1;}
}
