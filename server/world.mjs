import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createMapLayouts} from './map-layouts.cjs';
import {layoutInstances,appendLayoutCollision} from '../src/layout-objects.js';
const layouts=createMapLayouts({root:fileURLToPath(new URL('..',import.meta.url))});
import * as T from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {GroundNavigation} from '../src/navigation.js';
import {clearSpawn,generateSpawnPoints,resolveAuthoredSpawns,SPAWN_RULES} from '../src/spawns.js';
import {CharacterCollision} from '../src/engine/character-collision.js';
import {PLAYER_EYE_HEIGHT,PLAYER_CROUCH_EYE_HEIGHT,PLAYER_RADIUS} from '../src/player-config.js';
import {stanceEye,canStandAt} from '../src/engine/player-stance.js';
T.Mesh.prototype.raycast=acceleratedRaycast;
const origins={stormwind:[-141,-8.02,3],dalaran:[4,5.72,32],darnassus:[-310,-4.88,398]},cache=new Map();
const read=async file=>JSON.parse(await fs.readFile(new URL('../public/assets/'+file,import.meta.url),'utf8'));
export function createArenaStance(collider){
  const standing=new CharacterCollision(PLAYER_EYE_HEIGHT,PLAYER_RADIUS),crouching=new CharacterCollision(PLAYER_CROUCH_EYE_HEIGHT,PLAYER_RADIUS);
  return {
    // Both eye poses have the same feet. The solver's delta also applies to the
    // canonical standing-eye anchor carried by every network packet.
    resolve:(position,crouched=false)=>(crouched?crouching:standing).resolve(stanceEye(position,crouched),collider),
    canStand:(position,forts=[])=>canStandAt(position,collider,forts),
  };
}
export async function loadArena(city){if(!Object.hasOwn(origins,city))throw Error('Unknown map');const layout=await layouts.readLayout(city),key=JSON.stringify(layout);let entry=cache.get(city);if(!entry||entry.key!==key){entry={key,promise:build(city,layout).catch(e=>{if(cache.get(city)===entry)cache.delete(city);throw e;})};cache.set(city,entry);}return entry.promise;}
// Identical to the playable client's safe-origin search. Fortification IDs and
// navigation cuts must be built from this origin on both peers.
export function survivalOrigin(arena,city=arena.city){
  if(arena.survivalSpawn)return arena.survivalSpawn.clone();
  const base=origins[city];if(!base)throw Error('Unknown survival map');let best=null;
  for(let radius=0;radius<=24;radius+=3)for(let k=0;k<16;k++){
    const x=base[0]+Math.cos(k*Math.PI/8)*radius,z=base[2]+Math.sin(k*Math.PI/8)*radius,h=arena.floorAt(x,z,base[1]+8,50);
    if(!h||h.face.normal.y<.7||!clearSpawn(h.point,arena.floorAt,arena.blocked,1.2,2.65))continue;
    if(arena.blocked(h.point.clone().add(new T.Vector3(0,.15,0)),h.point.clone().add(new T.Vector3(0,PLAYER_EYE_HEIGHT+.35,0))))continue;
    const score=radius+Math.abs(h.point.y-base[1])*2;if(!best||score<best.score)best={point:h.point,score};
  }
  if(!best)throw Error('Map has no safe survival deployment');
  return best.point.clone().add(new T.Vector3(0,PLAYER_EYE_HEIGHT,0));
}
// Points and actor positions here are ground-level. Visibility is a hard ranking
// tier, so random variety can never outweigh an available safer deployment.
export function chooseTeamSpawn(candidates,{threats=[],occupied=[],allies=[],last=null,hidden=()=>false,weigh=null,random=Math.random,maxCandidates=Infinity}={}){
  let eligible=[];
  for(const point of candidates){
    if(last&&point.distanceTo(last)<=8)continue;
    if(threats.some(p=>point.distanceTo(p)<14)||occupied.some(p=>point.distanceTo(p)<3))continue;
    eligible.push(point);
  }
  // Large pools: look at a random subset first. Only when that subset has no
  // fully concealed point is the remainder examined, so safety is never traded
  // for speed.
  if(eligible.length>maxCandidates){
    eligible=eligible.slice();
    for(let i=0;i<maxCandidates;i++){const j=i+Math.min(eligible.length-i-1,Math.floor(Math.min(1-Number.EPSILON,Math.max(0,random()))*(eligible.length-i)));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}
  }
  let safest=Infinity,pool=[];
  for(let k=0;k<eligible.length;k++){
    if(k>=maxCandidates&&safest===0&&pool.length)break;
    const point=eligible[k];let exposed=0;
    for(const p of threats){if(!hidden(point,p)&&++exposed>safest)break;}
    if(exposed>safest)continue;
    if(exposed<safest){safest=exposed;pool=[];}
    // Mild squad cohesion still leaves every equally safe point eligible. This
    // is deliberately subordinate to enemy exposure and occupancy checks.
    const nearest=allies.length?Math.min(...allies.map(p=>point.distanceTo(p))):Infinity;
    pool.push({point,weight:(1+(Number.isFinite(nearest)?Math.max(0,1-Math.abs(nearest-12)/24):0))*(weigh?Math.max(.05,weigh(point)):1)});
  }
  if(!pool.length)return null; // Retry later instead of spawning into an enemy.
  let pick=Math.min(1-Number.EPSILON,Math.max(0,random()))*pool.reduce((sum,p)=>sum+p.weight,0);
  for(const entry of pool){pick-=entry.weight;if(pick<0)return entry.point.clone();}
  return pool.at(-1).point.clone();
}
export function spawnHasCover(candidate,enemy,trace){
  // Use the attacker's actual muzzle height and conservatively cover the
  // tallest selectable race, rather than testing only a crouch-height ray.
  const from=enemy.clone().add(new T.Vector3(0,PLAYER_EYE_HEIGHT-.35,0));
  return [1.4,2.5].every(height=>!!trace(from,candidate.clone().add(new T.Vector3(0,height,0))));
}
// Team-tagged points are preferred by their own side and avoided by the other;
// this only reweights points that already passed the safety tiers.
export const teamSpawnWeight=(tag,team)=>!tag||tag==='any'?1:tag===team?4:.15;
// Generated pool first (order is stable), then accepted designer spawns. Rejected
// designer spawns are kept in `authored.rejected` with a reason for the editor.
export function assembleSpawns({nav,origin,floorAt,blocked,authored:list}){
  const pool=generateSpawnPoints({nav,origin,floorAt,blocked}),authored=resolveAuthoredSpawns(list,{nav,origin,floorAt,blocked});
  const spawns=[...pool.all],teamOf=new Map(),yawOf=new Map();
  for(const a of authored.accepted){spawns.push(a.point);if(a.team!=='any')teamOf.set(a.point,a.team);if(a.yaw!==null)yawOf.set(a.point.x.toFixed(2)+','+a.point.z.toFixed(2),a.yaw);}
  if(pool.core.length<20)throw Error('Map has insufficient safe spawns');
  const spawnYaw=position=>yawOf.get(position[0].toFixed(2)+','+position[2].toFixed(2))??null;
  return {spawns,autoSpawns:pool.all,coreSpawns:pool.core,authored,teamOf,spawnYaw,stats:pool.stats};
}
export function createSpawner(spawns,teamOf,trace,{random=Math.random,maxCandidates=320}={}){
  return function spawn(players,team,last,weigh=null){
    const ground=p=>new T.Vector3().fromArray(p).add(new T.Vector3(0,-PLAYER_EYE_HEIGHT,0)),alive=players.filter(p=>p.hp>0);
    const threats=alive.filter(p=>p.team!==team).map(p=>ground(p.position)),allies=alive.filter(p=>p.team===team).map(p=>ground(p.position));
    const point=chooseTeamSpawn(spawns,{threats,allies,occupied:[...threats,...allies],last:last?ground(last):null,maxCandidates,random,
      hidden:(a,b)=>spawnHasCover(a,b,trace),weigh:p=>(weigh?weigh(p):1)*teamSpawnWeight(teamOf?.get(p),team)});
    return point?.add(new T.Vector3(0,PLAYER_EYE_HEIGHT,0)).toArray()||null;
  };
}
async function build(city,layout){
  const data=await read(city+'.json'),positions=[],indices=[],shotPositions=[],shotIndices=[];
  for(const g of data.groups){const base=positions.length/3;for(const v of g.positions)positions.push(v);for(const batch of g.batches)if(data.materials[batch.material]?.blend<=1)for(let i=batch.start;i<batch.start+batch.count;i++)indices.push(base+g.indices[i]);}
  {
    const props=await read('props/'+city+'.json'),m=new T.Matrix4(),v=new T.Vector3();
    for(const instance of layoutInstances(props,layout)){if(!instance.solid)continue;const model=props.models[instance.model];m.compose(new T.Vector3().fromArray(instance.position),new T.Quaternion().fromArray(instance.rotation).normalize(),new T.Vector3().setScalar(instance.scale));
      for(const [input,out,idx,source] of [[model.collision,positions,indices,model.collision.indices],[model,shotPositions,shotIndices,model.parts.filter(p=>p.blend===0).flatMap(p=>p.indices)]]){const base=out.length/3;for(let j=0;j<input.positions.length;j+=3){v.fromArray(input.positions,j).applyMatrix4(m);out.push(v.x,v.y,v.z);}for(const i of source)idx.push(base+i);}
    }
  }
  appendLayoutCollision(layout,positions,indices,shotPositions,shotIndices);
  function mesh(p,i){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(i);g.boundsTree=new MeshBVH(g,{maxLeafSize:12});return new T.Mesh(g,new T.MeshBasicMaterial({side:T.DoubleSide}));}
  const collider=mesh(positions,indices),base=positions.length/3;for(const p of shotPositions)positions.push(p);for(const i of shotIndices)indices.push(base+i);const shots=shotIndices.length?mesh(positions,indices):collider;
  function trace(from,to,object=shots){const d=to.clone().sub(from),length=d.length();if(length<1e-6)return null;const ray=new T.Raycaster(from,d.divideScalar(length),0,length);ray.firstHitOnly=true;return ray.intersectObject(object)[0]||null;}
  const blocked=(a,b,padding=0)=>{const d=b.clone().sub(a),length=d.length();return length>.001&&!!trace(a,b.clone().addScaledVector(d,padding/length),collider);},floorAt=(x,z,top=80,max=200)=>{const ray=new T.Raycaster(new T.Vector3(x,top,z),new T.Vector3(0,-1,0),0,max);ray.firstHitOnly=true;return ray.intersectObject(collider)[0]||null;};
  // Authored cover can occupy the original marker. Use the same full-footprint
  // safe-ground search as the client before constructing the navigation graph.
  const origin=survivalOrigin({city,floorAt,blocked},city);
  // The spawn pool needs a wider ground graph than the co-op one (same lattice,
  // more cells), so it is built here and discarded after generation.
  const nav=new GroundNavigation(origin,floorAt,blocked,{radius:Math.ceil(SPAWN_RULES.maxRadius/2.5)+1});
  const pool=assembleSpawns({nav,origin,floorAt,blocked,authored:layout?.spawns}),spawn=createSpawner(pool.spawns,pool.teamOf,trace);
  return {city,layout,origin,nav,survivalSpawn:origin.clone(),collider,shots,trace,blocked,floorAt,spawns:pool.spawns,autoSpawns:pool.autoSpawns,coreSpawns:pool.coreSpawns,authoredSpawns:pool.authored,spawnTeams:pool.teamOf,spawnYaw:pool.spawnYaw,spawn,...createArenaStance(collider)};
}
