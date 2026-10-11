// CPU-only synthetic arena for bot tests: a flat BVH collision mesh with axis-aligned wall boxes.
// It exposes the same surface as server/world.mjs loadArena() (trace, blocked, floorAt, resolve, spawn,
// spawns, nav, origin) so the real authoritative code paths run without importing any map assets.
import * as T from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {GroundNavigation} from '../../src/navigation.js';
import {createArenaStance,createSpawner} from '../../server/world.mjs';
import {PLAYER_EYE_HEIGHT} from '../../src/player-config.js';
T.Mesh.prototype.raycast=acceleratedRaycast;

// wall: [minX,minZ,maxX,maxZ,height]
export const DEFAULT_WALLS=Object.freeze([[8,-16,12,16,5],[18,-30,22,-8,4],[-26,8,-14,12,4]]);

function boxTriangles(w,positions,indices){
  const [x0,z0,x1,z1,h]=w,base=positions.length/3;
  for(const y of [0,h])for(const [x,z] of [[x0,z0],[x1,z0],[x1,z1],[x0,z1]])positions.push(x,y,z);
  const quad=(a,b,c,d)=>indices.push(base+a,base+b,base+c,base+a,base+c,base+d);
  quad(0,1,2,3);quad(4,7,6,5);quad(0,4,5,1);quad(1,5,6,2);quad(2,6,7,3);quad(3,7,4,0);
}
export function makeArena({walls=DEFAULT_WALLS,size=60,navRadius=null,withNav=true}={}){
  const positions=[-size,0,-size,-size,0,size,size,0,size,size,0,-size],indices=[0,1,2,0,2,3];
  for(const wall of walls)boxTriangles(wall,positions,indices);
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.boundsTree=new MeshBVH(geometry,{maxLeafSize:12});
  const collider=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
  const trace=(from,to,object=collider)=>{const d=to.clone().sub(from),length=d.length();if(length<1e-6)return null;const ray=new T.Raycaster(from,d.divideScalar(length),0,length);ray.firstHitOnly=true;return ray.intersectObject(object)[0]||null;};
  const blocked=(a,b,padding=0)=>{const d=b.clone().sub(a),length=d.length();return length>.001&&!!trace(a,b.clone().addScaledVector(d,padding/length),collider);};
  const floorAt=(x,z,top=80,max=200)=>{const ray=new T.Raycaster(new T.Vector3(x,top,z),new T.Vector3(0,-1,0),0,max);ray.firstHitOnly=true;return ray.intersectObject(collider)[0]||null;};
  const origin=new T.Vector3(0,PLAYER_EYE_HEIGHT,0);
  const arena={city:'stormwind',layout:null,origin,collider,shots:collider,trace,blocked,floorAt,...createArenaStance(collider),walls};
  if(withNav){
    const nav=new GroundNavigation(new T.Vector3(0,0,0),floorAt,blocked,{radius:navRadius??Math.ceil(size/2.5)});
    arena.nav=nav;
    const spawns=nav.reachable.filter(n=>n.edges.length>=3&&Math.hypot(n.point.x,n.point.z)<=49).map(n=>n.point.clone());
    arena.spawns=spawns;arena.coreSpawns=spawns;arena.autoSpawns=spawns;arena.spawn=createSpawner(spawns,new Map(),trace,{});
  }
  return arena;
}
// True when a ground point lies inside any wall footprint (used to prove nobody walked through geometry).
export const insideWall=(arena,x,z,pad=0)=>arena.walls.some(([x0,z0,x1,z1])=>x>x0-pad&&x<x1+pad&&z>z0-pad&&z<z1+pad);
