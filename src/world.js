import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import {loadProps} from './props.js';
import {assetFetch} from './asset-cache.mjs';
import {defaultLayout,validateLayout} from './map-layout.mjs';
import {loadCachedTextureSet} from './asset-loaders.js';
import {DISTRICTS,cityAssetCandidates} from './districts.mjs';
THREE.Mesh.prototype.raycast = acceleratedRaycast;
export const ARENAS = {
  ...Object.fromEntries(DISTRICTS.map(d=>[d.id,{name:d.name,subtitle:d.subtitle,spawn:[...d.origin],yaw:d.yaw,sky:d.sky,fog:d.fog,district:true,radius:d.radius}])),
  dalaran:{name:'Dalaran',subtitle:'The Eventide',spawn:[4,5.72,32],yaw:0,sky:0x9999c5,fog:0xb6aecb},
  darnassus:{name:'Darnassus',subtitle:'Temple Gardens',spawn:[-310,-4.88,398],yaw:3.142,sky:0x586878,fog:0x779299},
};
export async function loadWorld(id, progress,layoutOverride=null) {
  let layout=layoutOverride;
  if(!layout){const response=await fetch('/api/layouts/'+id,{cache:'no-store'});if(response.status===404)layout=defaultLayout(id);else{if(!response.ok)throw new Error('Could not load saved map layout');layout=await response.json();}}
  layout=validateLayout(layout,{city:id});
  progress('Reading '+ARENAS[id].name+' geometry…');
  // Districts load their small generated pack and fall back to the full city (same coordinates).
  let response;
  for(const candidate of cityAssetCandidates(id)){response=await assetFetch('/assets/'+candidate.geometry);if(response.ok)break;}
  if(!response.ok)throw new Error('City assets missing. Run npm run import first.');
  const data=await response.json();
  progress('Building surfaces and collision…');
  await new Promise(r=>setTimeout(r,30));
  const vertexCount=data.groups.reduce((n,g)=>n+g.positions.length/3,0);
  const positions=new Float32Array(vertexCount*3),uv=new Float32Array(vertexCount*2);
  const buckets=data.materials.map(()=>[]);let offset=0;
  for(const g of data.groups){
    positions.set(g.positions,offset*3);uv.set(g.uv,offset*2);
    for(const b of g.batches){const bucket=buckets[b.material];if(!bucket)continue;for(let i=b.start;i<b.start+b.count;i++)bucket.push(g.indices[i]+offset);}
    offset+=g.positions.length/3;
  }
  const pos=new THREE.BufferAttribute(positions,3),uvAttr=new THREE.BufferAttribute(uv,2);
  progress('Loading original city textures...');
  const textures=await loadCachedTextureSet(data.materials.filter((m,i)=>buckets[i].length).map(m=>m.texture),texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
  });
  const group=new THREE.Group(),ownedTextures=new Set(textures.values()),placedAssetDisposers=[];
  const disposeGroup=()=>{for(const dispose of placedAssetDisposers)dispose();placedAssetDisposers.length=0;group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();o.dispose?.();});for(const texture of ownedTextures)texture.dispose();};
  let colliderGeometry,collider,shotCollider;
  try{
  const allIndices=[];
  for(let i=0;i<buckets.length;i++){
    if(!buckets[i].length)continue;
    const m=data.materials[i],map=textures.get(m.texture)||null;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',pos);geometry.setAttribute('uv',uvAttr);geometry.setIndex(buckets[i]);
    geometry.computeBoundingSphere();
    const material=new THREE.MeshBasicMaterial({map,color:map?0xffffff:0x99978f,side:THREE.DoubleSide,alphaTest:m.blend===1?.45:0,transparent:m.blend>1,opacity:1});
    if(m.blend>1)material.depthWrite=false;
    const mesh=new THREE.Mesh(geometry,material);mesh.name='material-'+i;group.add(mesh);
    // Ignore translucent decorative surfaces for physical collision.
    if(m.blend<=1)for(const idx of buckets[i])allIndices.push(idx);
  }
  const props=await loadProps(id,progress,layout);
  let collisionPos=pos;
  if(props){
    group.add(props.group);
    if(props.disposePlacedAssets)placedAssetDisposers.push(props.disposePlacedAssets);
    const combined=new Float32Array(positions.length+props.positions.length);combined.set(positions);combined.set(props.positions,positions.length);collisionPos=new THREE.BufferAttribute(combined,3);
    for(const index of props.indices)allIndices.push(index+vertexCount);
    for(const texture of props.textures.values())ownedTextures.add(texture);
  }
  colliderGeometry=new THREE.BufferGeometry();colliderGeometry.setAttribute('position',collisionPos);colliderGeometry.setIndex(allIndices);
  colliderGeometry.boundsTree=new MeshBVH(colliderGeometry,{maxLeafSize:12});
  collider=new THREE.Mesh(colliderGeometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  shotCollider=collider;
  if(props){
    const shotPositions=new Float32Array(collisionPos.array.length+props.shotPositions.length);shotPositions.set(collisionPos.array);shotPositions.set(props.shotPositions,collisionPos.array.length);
    const indices=allIndices.slice();for(const index of props.shotIndices)indices.push(index+collisionPos.count);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(shotPositions,3));geometry.setIndex(indices);geometry.boundsTree=new MeshBVH(geometry,{maxLeafSize:12});shotCollider=new THREE.Mesh(geometry,collider.material);
  }
  progress('Finishing original city textures...');
  let waterTime=0;
  return {group,collider,shotCollider,layout,fountainCount:props?.fountains.length||0,update(dt){waterTime+=dt;for(const f of props?.fountains||[])f.update(waterTime);},propCount:props?.count||0,propModels:props?.models||0,triangles:allIndices.length/3,dispose(){disposeGroup();colliderGeometry.dispose();if(shotCollider!==collider)shotCollider.geometry.dispose();collider.material.dispose();}};
  }catch(error){disposeGroup();colliderGeometry?.dispose();if(shotCollider&&shotCollider!==collider)shotCollider.geometry.dispose();collider?.material.dispose();throw error;}
}
