import * as THREE from 'three';
export function clearSpawn(point,floorAt,blocked,radius=.8,height=2.65){
  if(blocked(point.clone().add(new THREE.Vector3(0,.12,0)),point.clone().add(new THREE.Vector3(0,height,0))))return false;
  for(let i=0;i<8;i++){
    const x=Math.cos(i*Math.PI/4)*radius,z=Math.sin(i*Math.PI/4)*radius;
    const h=floorAt(point.x+x,point.z+z,point.y+.45,1.1);
    if(!h||h.face.normal.y<.7||Math.abs(h.point.y-point.y)>.3)return false;
    for(const y of [.45,1.3,2.3])if(blocked(point.clone().add(new THREE.Vector3(0,y,0)),point.clone().add(new THREE.Vector3(x,y,z))))return false;
  }
  return true;
}
export function selectSpawns(candidates,count,{center,threats=[],occupied=[],hidden=()=>false,rank=()=>0,minDistance=12,spacing=4,random=Math.random}){
  const sorted=candidates.filter(p=>threats.every(t=>p.distanceTo(t)>=minDistance)&&occupied.every(t=>p.distanceTo(t)>=spacing)).map(p=>({point:p,score:rank(p)+threats.reduce((n,t)=>n+(hidden(p,t)?8:0),0)+random()*18})).sort((a,b)=>b.score-a.score);
  const selected=[];for(const c of sorted){if(selected.some(p=>p.distanceTo(c.point)<spacing))continue;selected.push(c.point.clone());if(selected.length===count)break;}return selected;
}

// ---- Arena spawn pool -------------------------------------------------------
// Tier 1 (core) is the original rule, kept so objective placement is unchanged.
// Tier 2 adds reachable dead ends and a wider ring, Tier 3 adds the centres of
// fully connected lattice cells. Everything derives from the reachable ground
// graph, is clearance-checked and is generated without randomness, so any peer
// that builds the same graph gets the same ordered pool.
export const SPAWN_RULES=Object.freeze({coreRadius:49,maxRadius:70,minSpacing:1.7,authoredSnap:3.2,authoredLimit:64});
class PointHash{
  constructor(size){this.size=size;this.cells=new Map();}
  key(x,z){return Math.floor(x/this.size)+','+Math.floor(z/this.size);}
  add(p){const k=this.key(p.x,p.z);(this.cells.get(k)||this.cells.set(k,[]).get(k)).push(p);}
  near(p,distance){
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const q of this.cells.get(this.key(p.x+dx*this.size,p.z+dz*this.size))||[])if(Math.hypot(q.x-p.x,q.z-p.z)<distance)return true;
    return false;
  }
}
export function generateSpawnPoints({nav,origin,floorAt,blocked,coreRadius=SPAWN_RULES.coreRadius,maxRadius=SPAWN_RULES.maxRadius,minSpacing=SPAWN_RULES.minSpacing}){
  const flat=p=>Math.hypot(p.x-origin.x,p.z-origin.z),clear=p=>clearSpawn(p,floorAt,blocked);
  const stats={reachable:nav.reachable.length,core:0,deadEnd:0,ring:0,cell:0};
  const core=[],extra=[],hash=new PointHash(Math.max(.5,minSpacing)),coreIds=new Set(),accepted=new Set();
  for(const n of nav.reachable){
    if(n.edges.length>=2&&n.point.distanceTo(origin)<coreRadius&&clear(n.point)){core.push(n.point);coreIds.add(n.id);accepted.add(n.id);hash.add(n.point);stats.core++;}
  }
  for(const n of nav.reachable){
    if(coreIds.has(n.id)||n.edges.length<1||flat(n.point)>=maxRadius||!clear(n.point))continue;
    extra.push(n.point);accepted.add(n.id);hash.add(n.point);
    if(n.edges.length<2)stats.deadEnd++;else stats.ring++;
  }
  // Lattice-cell centres sit between four mutually connected nodes, so they are
  // reachable by construction; clearSpawn then rechecks footing and headroom.
  const byGrid=new Map(nav.reachable.map(n=>[n.x+','+n.z,n]));
  const linked=(a,b)=>!!b&&a.edges.includes(b.id);
  for(const a of nav.reachable){
    const r=byGrid.get((a.x+1)+','+a.z),d=byGrid.get(a.x+','+(a.z+1)),e=byGrid.get((a.x+1)+','+(a.z+1));
    if(!r||!d||!e||!linked(a,r)||!linked(a,d)||!linked(r,e)||!linked(d,e))continue;
    const x=(a.point.x+r.point.x+d.point.x+e.point.x)/4,z=(a.point.z+r.point.z+d.point.z+e.point.z)/4,y=(a.point.y+r.point.y+d.point.y+e.point.y)/4;
    if(Math.hypot(x-origin.x,z-origin.z)>=maxRadius)continue;
    const h=floorAt(x,z,y+1.5,4);if(!h||h.face.normal.y<.7||Math.abs(h.point.y-y)>.6)continue;
    const p=h.point.clone();if(hash.near(p,minSpacing)||!clear(p))continue;
    extra.push(p);hash.add(p);stats.cell++;
  }
  return {core,extra,all:[...core,...extra],stats};
}
const TEAM_TAGS=['any','alliance','horde'];
// Validates designer-placed spawns against the generated ground. Failures are
// returned with a reason so the editor can show them; nothing is dropped silently.
export function resolveAuthoredSpawns(list,{nav,origin,floorAt,blocked,maxRadius=SPAWN_RULES.maxRadius,snap=SPAWN_RULES.authoredSnap}){
  const accepted=[],rejected=[],hash=new PointHash(1);
  (Array.isArray(list)?list:[]).forEach((item,index)=>{
    const id=item?.id||'spawn-'+(index+1),fail=reason=>rejected.push({id,index,reason,position:item?.position?[...item.position]:null});
    const pos=item?.position;
    if(!Array.isArray(pos)||pos.length!==3||!pos.every(Number.isFinite))return fail('Invalid position');
    const team=TEAM_TAGS.includes(item.team)?item.team:'any';
    if(Math.hypot(pos[0]-origin.x,pos[2]-origin.z)>=maxRadius)return fail('Outside the playable area');
    const h=floorAt(pos[0],pos[2],pos[1]+2,5);
    if(!h||h.face.normal.y<.7||Math.abs(h.point.y-pos[1])>1.5)return fail('Not on walkable ground');
    const point=h.point.clone();
    if(!clearSpawn(point,floorAt,blocked))return fail('Blocked: no room to stand here');
    let best=null,score=Infinity;
    for(const n of nav.reachable){const d=Math.hypot(n.point.x-point.x,n.point.z-point.z);if(d<score&&Math.abs(n.point.y-point.y)<=1.2){score=d;best=n;}}
    if(!best||score>snap)return fail('Not connected to the main walkable area');
    if(hash.near(point,.75))return fail('Overlaps another spawn');
    hash.add(point);
    accepted.push({id,index,point,yaw:Number.isFinite(item.yaw)?item.yaw:null,team});
  });
  return {accepted,rejected};
}
