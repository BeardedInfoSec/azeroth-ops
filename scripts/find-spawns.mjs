import fs from 'node:fs';
import * as T from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
T.Mesh.prototype.raycast=acceleratedRaycast;
for(const id of process.argv.slice(2).length?process.argv.slice(2):['stormwind','dalaran','darnassus']){
const data=JSON.parse(fs.readFileSync(`public/assets/${id}.json`));
const p=[],ind=[];
for(const g of data.groups){const offset=p.length/3;for(const n of g.positions)p.push(n);for(const b of g.batches){if(data.materials[b.material]?.blend>1)continue;for(let j=b.start;j<b.start+b.count;j++)ind.push(g.indices[j]+offset);}}
const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(p,3));geo.setIndex(ind);geo.boundsTree=new MeshBVH(geo);
const mesh=new T.Mesh(geo,new T.MeshBasicMaterial({side:T.DoubleSide}));const ray=new T.Raycaster();ray.firstHitOnly=true;
const range=id==='stormwind'?[-165,-70,-25,65,-15,0]:id==='dalaran'?[-80,80,-140,120,-5,15]:[-370,-170,330,460,-40,10];
const candidates=[];
for(let x=range[0];x<=range[1];x+=4)for(let z=range[2];z<=range[3];z+=4){
ray.set(new T.Vector3(x,650,z),new T.Vector3(0,-1,0));ray.far=800;const hit=ray.intersectObject(mesh)[0];if(!hit||hit.point.y<range[4]||hit.point.y>range[5]||hit.face.normal.y<.9)continue;
const eye=hit.point.clone().add(new T.Vector3(0,1.72,0));let total=0,min=100;let bestDirection=0,bestDistance=0;
for(let i=0;i<16;i++){const angle=i*Math.PI/8;ray.set(eye,new T.Vector3(Math.sin(angle),0,Math.cos(angle)));ray.far=45;const wall=ray.intersectObject(mesh)[0];const dist=wall?.distance??45;total+=Math.min(25,dist);min=Math.min(min,dist);if(dist>bestDistance){bestDistance=dist;bestDirection=angle+Math.PI;}}
if(min<4)continue;candidates.push({x,y:+hit.point.y.toFixed(2),z,score:+(total+min*8).toFixed(0),yaw:+bestDirection.toFixed(3)});
}
candidates.sort((a,b)=>b.score-a.score);console.log(id,JSON.stringify(candidates.slice(0,12)));
}
