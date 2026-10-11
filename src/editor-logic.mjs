// Pure, DOM-free and WebGL-free helpers for the 3D Map Workshop. Everything
// here is unit-tested on the CPU; src/editor.js only wires it to three.js.
export const LIMIT=10000,SCALE_MIN=.1,SCALE_MAX=6;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const round=(value,places=3)=>{const k=10**places;return Math.round(value*k)/k;};

export const snapValue=(value,size)=>size>0?Math.round(value/size)*size:value;
// Ground hit -> layout position. X/Z snap to the grid, Y follows the real ground.
export function placementFromHit(point,{snap=0,offset=0}={}){
  return [round(clamp(snapValue(point.x,snap),-LIMIT,LIMIT),4),round(clamp(point.y+offset,-LIMIT,LIMIT),3),round(clamp(snapValue(point.z,snap),-LIMIT,LIMIT),4)];
}
// Gizmo/object transform -> values the saved layout format accepts.
export function placementFromTransform({position,rotationY,scale}){
  const yaw=Number.isFinite(rotationY)?rotationY:0,s=Number.isFinite(scale)?scale:1;
  return {position:position.map(v=>round(clamp(Number.isFinite(v)?v:0,-LIMIT,LIMIT),3)),rotation:round(clamp(yaw,-Math.PI*199,Math.PI*199),5),scale:round(clamp(s,SCALE_MIN,SCALE_MAX),3)};
}
// Scale gizmos change one axis at a time; keep the object uniform.
export function uniformScale(start,current){
  let best=current[0],delta=0;for(let i=0;i<3;i++){const d=Math.abs(current[i]-start);if(d>delta){delta=d;best=current[i];}}
  return clamp(best,SCALE_MIN,SCALE_MAX);
}

// Cutaway: everything above `level` is hidden (roofs, upper floors).
export function cutawayRange(minY,maxY){
  if(!Number.isFinite(minY)||!Number.isFinite(maxY)||maxY<minY)return {min:-10,max:60};
  return {min:Math.floor(minY),max:Math.ceil(maxY)+1};
}
export const cutawayLevel=(t,min,max)=>min+clamp(t,0,1)*(max-min);
export const visibleAtCutaway=(y,level)=>!Number.isFinite(level)||y<=level;
export const filterByCutaway=(items,level,yOf=item=>item.position[1])=>items.filter(item=>visibleAtCutaway(yOf(item),level));
// Raycast hits are sorted near to far; the first one at or below the cutaway.
export function firstHitBelow(hits,level){for(const hit of hits||[])if(visibleAtCutaway(hit.point.y,level))return hit;return null;}

// Spatial lookup so a clicked InstancedMesh instance maps to its original prop id.
export function buildPropIndex(instances,cell=4){
  const grid=new Map();
  for(const item of instances){const key=Math.floor(item.position[0]/cell)+','+Math.floor(item.position[2]/cell);let list=grid.get(key);if(!list)grid.set(key,list=[]);list.push(item);}
  return {grid,cell};
}
export function findInstanceAt(index,position,{tolerance=.05,model=null}={}){
  const {grid,cell}=index,cx=Math.floor(position[0]/cell),cz=Math.floor(position[2]/cell);let best=null,bestDistance=tolerance;
  for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const item of grid.get(x+','+z)||[]){
    if(model!==null&&item.model!==model)continue;
    const d=Math.hypot(item.position[0]-position[0],item.position[1]-position[1],item.position[2]-position[2]);
    if(d<=bestDistance){best=item;bestDistance=d;}
  }
  return best;
}

// Collision probe: slightly shrunk and lifted so resting on the ground is not
// an overlap. Returns null if the box is too small to test.
export function probeBox(min,max,{lift=.15,shrink=.05}={}){
  const lo=[min[0]+shrink,min[1]+lift,min[2]+shrink],hi=[max[0]-shrink,max[1]-shrink,max[2]-shrink];
  return lo.every((v,i)=>v<hi[i])?{min:lo,max:hi}:null;
}

// Free-fly camera: keys are a Set of lowercase letters. Yaw 0 looks down -Z.
export function flyStep({position,yaw,pitch},keys,dt,{speed=18,fast=false}={}){
  const k=speed*(fast?4:1)*Math.min(dt,.1),cp=Math.cos(pitch),f=[-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp],r=[Math.cos(yaw),0,-Math.sin(yaw)];
  const axis=(a,b)=>(keys.has(a)?1:0)-(keys.has(b)?1:0),fw=axis('w','s'),sd=axis('d','a'),up=axis('e','q');
  return [position[0]+(f[0]*fw+r[0]*sd)*k,position[1]+(f[1]*fw+up)*k,position[2]+(f[2]*fw+r[2]*sd)*k];
}
export const lookLimits=pitch=>clamp(pitch,-Math.PI/2+.02,Math.PI/2-.02);
// Plan view: pan with WASD in screen space (up = -Z).
export function planStep({x,z},keys,dt,viewSize,fast=false){
  const k=viewSize*(fast?1.6:.7)*Math.min(dt,.1),dx=(keys.has('d')?1:0)-(keys.has('a')?1:0),dz=(keys.has('s')?1:0)-(keys.has('w')?1:0);
  return {x:x+dx*k,z:z+dz*k};
}
export function orthoFrustum(width,height,viewSize){
  const aspect=width/Math.max(1,height),h=viewSize/2;return {left:-h*aspect,right:h*aspect,top:h,bottom:-h};
}
export const clampViewSize=size=>clamp(size,8,2500);
// Never let the draw loop run flat out: the pixel ratio is capped at 1.5, and
// at 1 in low-detail mode.
export const cappedPixelRatio=(ratio,low=false)=>Math.min(Number.isFinite(ratio)&&ratio>0?ratio:1,low?1:1.5);
// Overlays: server-computed placements (undead breaches, machines, wall weapons, boundaries, spawns).
export const OVERLAY_KINDS={
  breach:{category:'breach',color:0xe0524d},perk:{category:'machine',color:0x6fd3a6},pack:{category:'machine',color:0xa3e9ed},
  weapon:{category:'weapon',color:0xe3b85a},wall:{category:'barrier',color:0xb99b6b},gate:{category:'barrier',color:0xf0d27a},rail:{category:'barrier',color:0x8e8a7a},
  spawn:{category:'spawn',color:0x76cadc},origin:{category:'spawn',color:0xffffff}
};
export const OVERLAY_CATEGORIES=['breach','machine','weapon','barrier','spawn'];
export const overlayUrl=(city,fortifications)=>'/api/editor/overlays?city='+encodeURIComponent(city)+'&fortifications='+encodeURIComponent(fortifications);
export function sanitizeOverlays(data,limit=2000){
  const items=[];if(!data||!Array.isArray(data.items))return items;
  for(const item of data.items){
    if(items.length>=limit)break;const style=OVERLAY_KINDS[item?.kind];
    if(!style||!Array.isArray(item.position)||item.position.length!==3||!item.position.every(Number.isFinite))continue;
    const size=Array.isArray(item.size)&&item.size.length===3&&item.size.every(v=>Number.isFinite(v)&&v>0&&v<100)?item.size.slice():null;
    items.push({id:String(item.id??'').slice(0,80),kind:item.kind,category:style.category,color:style.color,label:String(item.label??item.kind).slice(0,60),position:item.position.slice(),rotation:Number.isFinite(item.rotation)?item.rotation:0,size});
  }
  return items;
}
export const overlayVisible=(item,enabled)=>!!enabled?.has?.(item.category);

// ---------- placement workflow (pure, unit-tested) ----------
export const PLACEMENT_LIMIT=256,RECENT_LIMIT=12,FAVORITE_LIMIT=200;
export const normAngle=angle=>{if(!Number.isFinite(angle))return 0;let r=angle%(Math.PI*2);if(r>Math.PI)r-=Math.PI*2;if(r<=-Math.PI)r+=Math.PI*2;return round(r,5);};
// One R press: move to the next snap line in the given direction (off-grid values first land on the grid).
export function stepRotation(current,direction,snapDeg=15){
  const step=(snapDeg>0?snapDeg:15)*Math.PI/180,value=Number.isFinite(current)?current:0,ratio=value/step,near=Math.round(ratio);
  const target=Math.abs(ratio-near)<1e-4?near+(direction<0?-1:1):(direction<0?Math.floor(ratio):Math.ceil(ratio));
  return normAngle(target*step);
}
export const clampScale=value=>round(clamp(Number.isFinite(value)?value:1,SCALE_MIN,SCALE_MAX),3);
export const stepScale=(current,direction,factor=1.1)=>clampScale(clampScale(current)*(direction<0?1/factor:factor));
export function scaleRange(min,max){let a=clampScale(Number(min)),b=clampScale(Number(max));if(a>b)[a,b]=[b,a];return [a,b];}
export function mulberry32(seed){let a=(Number(seed)>>>0)||1;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
export const rollScale=(rng,min,max)=>{const [a,b]=scaleRange(min,max);return clampScale(a+(b-a)*rng());};
export const rollRotation=rng=>normAngle(rng()*Math.PI*2-Math.PI);
// Models rarely have their origin exactly on their base: lift so the lowest point rests on the surface.
export const sitOffset=(minY,scale=1)=>round(-(Number.isFinite(minY)?minY:0)*clampScale(scale),3)+0;
// The layout stores only yaw, so tilting to the normal is not saveable; instead raise the object enough to clear a slope under its footprint.
export function slopeLift(normalY,radius){
  const ny=clamp(Number.isFinite(normalY)?normalY:1,.35,1);if(ny>=.9999||!(radius>0))return 0;
  return round(Math.min(radius*Math.sqrt(1-ny*ny)/ny,radius*1.2),3);
}
export const capacityLeft=(current,adding,limit=PLACEMENT_LIMIT)=>{const allowed=Math.max(0,Math.min(adding,limit-current));return {allowed,dropped:Math.max(0,adding-allowed)};};

export function selectionCentre(items){
  if(!items?.length)return null;let x=0,y=0,z=0;for(const item of items){x+=item.position[0];y+=item.position[1];z+=item.position[2];}
  return [round(x/items.length,4),round(y/items.length,4),round(z/items.length,4)];
}
// Move, yaw (about the Y axis through the centre) and uniformly scale a set of placements in one go.
export function groupTransform(items,centre,{move=[0,0,0],yaw=0,scale=1}={}){
  const k=clamp(Number.isFinite(scale)?scale:1,SCALE_MIN,SCALE_MAX),a=Number.isFinite(yaw)?yaw:0,c=Math.cos(a),s=Math.sin(a);
  return items.map(item=>{
    const rx=(item.position[0]-centre[0])*k,ry=(item.position[1]-centre[1])*k,rz=(item.position[2]-centre[2])*k;
    const position=[centre[0]+move[0]+rx*c+rz*s,centre[1]+move[1]+ry,centre[2]+move[2]-rx*s+rz*c].map(v=>round(clamp(v,-LIMIT,LIMIT),3));
    return {...item,position,rotation:normAngle(item.rotation+a),scale:clampScale(item.scale*k)};
  });
}
// Arrow keys follow the camera heading (quantised to 90 degrees); PageUp/PageDown change height.
export function nudgeVector({key,snap=0,shift=false,yaw=0}){
  const step=(snap>0?snap:.5)*(shift?5:1);
  if(key==='PageUp')return [0,step,0];if(key==='PageDown')return [0,-step,0];
  const base={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[key];if(!base)return null;
  const q=Math.round((Number.isFinite(yaw)?yaw:0)/(Math.PI/2))*(Math.PI/2),c=Math.round(Math.cos(q)),s=Math.round(Math.sin(q));
  return [(base[0]*c+base[1]*s)*step,0,(-base[0]*s+base[1]*c)*step].map(v=>round(v,4)+0);
}
export function itemsInRect(items,{x0,z0,x1,z1}){
  const lx=Math.min(x0,x1),hx=Math.max(x0,x1),lz=Math.min(z0,z1),hz=Math.max(z0,z1);
  return items.filter(item=>item.position[0]>=lx&&item.position[0]<=hx&&item.position[2]>=lz&&item.position[2]<=hz).map(item=>item.id);
}
export const toggleId=(list,id)=>list.includes(id)?list.filter(value=>value!==id):[...list,id];
export const unionIds=(a,b)=>[...new Set([...a,...b])];
// Paste a clipboard of placements so their centre lands on the cursor ground point (or offset when there is none).
export function pasteItems(clip,point,{snap=0,makeId,fallback=[2,0,2]}={}){
  const centre=selectionCentre(clip);if(!centre)return [];
  const tx=point?snapValue(point[0],snap):centre[0]+fallback[0],tz=point?snapValue(point[2],snap):centre[2]+fallback[2],ty=point?point[1]:centre[1]+fallback[1];
  return clip.map(item=>({...item,id:makeId(),position:[tx+item.position[0]-centre[0],ty+item.position[1]-centre[1],tz+item.position[2]-centre[2]].map(v=>round(clamp(v,-LIMIT,LIMIT),3))}));
}
// Scatter: uniform random points in a circle, deterministic for a seed. Heights are resolved later by raycasting.
export function scatterPlan({seed=1,count=10,radius=6,center=[0,0],assets=[],rotation=0,randomRotation=true,scale=1,randomScale=true,range=[.8,1.25],spacing=0}={}){
  const rng=mulberry32(seed),n=Math.round(clamp(Number(count)||1,1,100)),r=clamp(Number(radius)||1,.5,150),out=[];if(!assets.length)return out;
  for(let i=0;i<n;i++){
    let x=0,z=0;
    for(let tries=0;tries<12;tries++){const d=r*Math.sqrt(rng()),t=rng()*Math.PI*2;x=center[0]+d*Math.cos(t);z=center[1]+d*Math.sin(t);if(!(spacing>0)||out.every(p=>Math.hypot(p.x-x,p.z-z)>=spacing))break;}
    out.push({prefabId:assets[Math.floor(rng()*assets.length)%assets.length],x:round(x,3),z:round(z,3),rotation:randomRotation?rollRotation(rng):normAngle(rotation),scale:randomScale?rollScale(rng,range[0],range[1]):clampScale(scale)});
  }
  return out;
}
export const acceptScatterHit=(hitY,centreY,radius)=>Math.abs(hitY-centreY)<=Math.max(2.5,radius*.5);

// Camera framing for the F key.
export function focusPose({centre,radius,yaw=0,pitch=-.5,fov=70}){
  const dist=Math.max(6,(Math.max(radius,.5)/Math.sin(clamp(fov,20,120)*Math.PI/360))*1.2),cp=Math.cos(pitch);
  return {position:[centre[0]+Math.sin(yaw)*cp*dist,centre[1]-Math.sin(pitch)*dist,centre[2]+Math.cos(yaw)*cp*dist],distance:dist};
}

// Asset browser: filtering, sorting and favorites / recents.
export function browserReducer(state={favorites:[],recent:[]},action){
  const favorites=state.favorites||[],recent=state.recent||[];
  switch(action?.type){
    case 'toggleFavorite':return {favorites:favorites.includes(action.id)?favorites.filter(id=>id!==action.id):[action.id,...favorites].slice(0,FAVORITE_LIMIT),recent};
    case 'use':return {favorites,recent:[action.id,...recent.filter(id=>id!==action.id)].slice(0,RECENT_LIMIT)};
    case 'prune':{const ok=id=>action.valid.has(id);return {favorites:favorites.filter(ok),recent:recent.filter(ok)};}
    default:return {favorites,recent};
  }
}
export function sanitizeIdList(raw,valid,max=FAVORITE_LIMIT){
  if(!Array.isArray(raw))return [];const out=[];
  for(const id of raw){if(typeof id==='string'&&(!valid||valid.has(id))&&!out.includes(id))out.push(id);if(out.length>=max)break;}
  return out;
}
export const categoriesOf=prefabs=>[...new Set(prefabs.map(item=>item.category))].sort((a,b)=>a.localeCompare(b));
export function filterTiles(prefabs,{query='',category='all',favorites=[],recent=[],limit=150}={}){
  const tokens=String(query).toLowerCase().split(/\s+/).filter(Boolean),fav=new Set(favorites);
  let list=prefabs.filter(item=>{
    if(category==='favorites'&&!fav.has(item.id))return false;if(category==='recent'&&!recent.includes(item.id))return false;
    if(category.startsWith('cat:')&&item.category!==category.slice(4))return false;
    const hay=(item.name+' '+item.category+' '+(item.source||'')).toLowerCase();return tokens.every(token=>hay.includes(token));
  });
  if(category==='recent')list.sort((a,b)=>recent.indexOf(a.id)-recent.indexOf(b.id));
  else list.sort((a,b)=>(fav.has(b.id)-fav.has(a.id))||a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
  const total=list.length;list=list.slice(0,limit);
  return {tiles:list.map(item=>({...item,favorite:fav.has(item.id)})),total,truncated:total>list.length};
}
export const moveIndex=(index,count,delta)=>count<=0?-1:clamp(index<0?(delta>0?0:count-1):index+delta,0,count-1);
// Imported world models carry a placeholder 1x1x1 size in the catalog, so only real sizes are shown.
export function sizeLabel(prefab,measured=null){
  const size=measured||(prefab.id?.startsWith('wow:')?null:prefab.size);
  return Array.isArray(size)&&size.length===3&&size.every(Number.isFinite)?size.map(v=>round(v,1)).join(' x ')+' m':'';
}
export const tileMeta=(prefab,measured=null)=>[prefab.category,sizeLabel(prefab,measured)].filter(Boolean).join(' · ');
export const placementBanner=(name,{tool='place',count=0}={})=>tool==='scatter'?`SCATTER: ${name} — click to scatter ${count}, Esc done`:`PLACING: ${name} — R rotate, Alt+wheel / [ ] scale, Esc done`;
export function formatReadout({position,rotation=0,scale=1}){
  const f=v=>String(round(v,2)),deg=round(normAngle(rotation)*180/Math.PI,1);
  return `X ${f(position[0])}  Y ${f(position[1])}  Z ${f(position[2])} · ROT ${deg}° · SCALE ${f(scale)}x`;
}

// ---------- designer spawn points (Spawns tool, key P) ----------
// Layout spawns are {id,position:[x,y,z] ground point,yaw,team}. Yaw uses the game's
// convention: facing = (-sin yaw, -cos yaw), so yaw 0 looks toward -Z.
export const SPAWN_LIMIT=64,SPAWN_TEAMS=['any','alliance','horde'];
export const SPAWN_COLORS={any:0xf2ead8,alliance:0x4b8fff,horde:0xe0524d,auto:0x76cadc,bad:0xff2bd6};
export const spawnFacing=yaw=>[-Math.sin(yaw),-Math.cos(yaw)];
export const facingYaw=(from,to)=>{const dx=to[0]-from[0],dz=to[2]-from[2];return Math.hypot(dx,dz)<1e-6?0:normAngle(Math.atan2(-dx,-dz));};
export const cycleTeam=team=>SPAWN_TEAMS[(Math.max(0,SPAWN_TEAMS.indexOf(team))+1)%SPAWN_TEAMS.length];
export function nextSpawnId(spawns){
  const used=new Set((spawns||[]).map(s=>s.id));let n=(spawns||[]).length+1;while(used.has('spawn-'+n))n++;return 'spawn-'+n;
}
export function spawnFromHit(point,{snap=0,yaw=null,team='any',id,origin=null}={}){
  const position=placementFromHit(point,{snap});
  const facing=Number.isFinite(yaw)?normAngle(yaw):origin?facingYaw(position,origin):0;
  return {id,position,yaw:facing,team:SPAWN_TEAMS.includes(team)?team:'any'};
}
// Returns the new spawn list, or the same list with added=false once the cap is reached.
export function addSpawn(spawns,spawn,limit=SPAWN_LIMIT){
  const list=Array.isArray(spawns)?spawns:[];if(list.length>=limit)return {spawns:list,added:false};
  return {spawns:[...list,spawn],added:true};
}
export function updateSpawn(spawns,id,patch){
  return (spawns||[]).map(s=>s.id!==id?s:{...s,...(patch.position?{position:patch.position.slice()}:{}),...(Number.isFinite(patch.yaw)?{yaw:normAngle(patch.yaw)}:{}),...(SPAWN_TEAMS.includes(patch.team)?{team:patch.team}:{})});
}
export const removeSpawn=(spawns,id)=>(spawns||[]).filter(s=>s.id!==id);
export function spawnCounts(spawns){
  const counts={total:0,any:0,alliance:0,horde:0};for(const s of spawns||[]){counts.total++;counts[SPAWN_TEAMS.includes(s.team)?s.team:'any']++;}return counts;
}
// Nearest designer spawn to a ground point (horizontal), within reach metres.
export function nearestSpawn(spawns,point,reach=1.6){
  let best=null,score=reach;for(const s of spawns||[]){const d=Math.hypot(s.position[0]-point[0],s.position[2]-point[2]);if(d<=score&&Math.abs(s.position[1]-point[1])<4){score=d;best=s;}}return best;
}
// Server report -> ids to flag and a one-line summary.
export function spawnReportSummary(report,spawns){
  const rejected=Array.isArray(report?.rejected)?report.rejected.filter(r=>r&&typeof r.id==='string'):[],known=new Set((spawns||[]).map(s=>s.id)),live=rejected.filter(r=>known.has(r.id));
  const accepted=Array.isArray(report?.accepted)?report.accepted.filter(id=>known.has(id)).length:0;
  return {rejected:live.map(r=>({id:r.id,reason:String(r.reason||'Rejected').slice(0,80)})),accepted,
    text:live.length?live.length+' spawn'+(live.length===1?'':'s')+' rejected by the host: '+live.slice(0,3).map(r=>r.id+' ('+String(r.reason||'rejected').slice(0,48)+')').join('; ')+(live.length>3?'…':''):accepted?accepted+' saved spawn'+(accepted===1?'':'s')+' accepted by the host.':''};
}
// Replace a layout's contents with another one, including dropping the optional spawns field.
export function replaceLayout(target,next){
  Object.assign(target,next);if(next.spawns===undefined)delete target.spawns;return target;
}
