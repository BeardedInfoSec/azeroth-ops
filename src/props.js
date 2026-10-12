import * as THREE from 'three';
import {createFountain} from './fountains.js';
import {assetFetch} from './asset-cache.mjs';
import {layoutInstances,createLayoutPrefab,appendObjectGeometry} from './layout-objects.js';
import {loadCachedTextureSet} from './asset-loaders.js';
import {loadPerkModels,createPerkModel} from './perk-models.js';
import {cityAssetCandidates,getDistrict} from './districts.mjs';

export async function addLayoutProps(group,placements,collisionPositions,collisionIndices,shotPositions,shotIndices,{loadMachines=loadPerkModels,makeMachine=createPerkModel}={}){
  const machines=[];
  const dispose=()=>{for(const machine of machines)machine.dispose();machines.length=0;};
  try{
    if(placements.some(item=>item.prefabId.startsWith('machine:')))await loadMachines();
    for(const item of placements){
      if(item.prefabId.startsWith('wow:'))continue;
      const object=createLayoutPrefab(item);group.add(object);
      // Keep this exact proxy geometry in sync with appendLayoutCollision on
      // the server. Decorative BO2 surfaces never change the walk/shot hull.
      if(item.solid){appendObjectGeometry(object,collisionPositions,collisionIndices);appendObjectGeometry(object,shotPositions,shotIndices);}
      if(item.prefabId.startsWith('machine:')){
        const machine=makeMachine(item.prefabId.slice(8),{width:1.05,height:2.65,depth:.9});
        if(machine){for(const child of object.children)child.visible=false;object.add(machine.group);machines.push(machine);}
      }
    }
    return dispose;
  }catch(error){dispose();throw error;}
}

export async function loadProps(city,progress,layout=null){
  if(!getDistrict(city)&&!['dalaran','darnassus'].includes(city))throw new Error('Unknown prop city '+city);
  progress('Loading original '+city+' props...');
  let response;
  for(const candidate of cityAssetCandidates(city)){response=await assetFetch('/assets/'+candidate.props);if(response.ok)break;}
  if(!response.ok)throw new Error(city+' props missing. Run npm run import:props.');
  const data=await response.json(),group=new THREE.Group();
  const collisionPositions=[],collisionIndices=[],shotPositions=[],shotIndices=[],fountains=[];
  const byModel=data.models.map(()=>[]),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3(),v=new THREE.Vector3();
  const instances=layoutInstances(data,layout);
  for(const instance of instances){
    position.fromArray(instance.position);quaternion.fromArray(instance.rotation).normalize();scale.setScalar(instance.scale);
    const transform=matrix.compose(position,quaternion,scale).clone();transform.layoutSolid=instance.solid!==false;byModel[instance.model].push(transform);
  }
  const textures=await loadCachedTextureSet(data.models.flatMap((model,i)=>byModel[i].length?model.parts.map(part=>part.texture):[]),texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
  });
  let disposePlacedAssets=()=>{};
  try{
  for(let i=0;i<data.models.length;i++){
    const model=data.models[i],transforms=byModel[i];if(!transforms.length)continue;
    const positions=new THREE.Float32BufferAttribute(model.positions,3),uv=new THREE.Float32BufferAttribute(model.uv,2);
    for(const part of model.parts){
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',positions);geometry.setAttribute('uv',uv);geometry.setIndex(part.indices);geometry.computeBoundingSphere();
      const material=new THREE.MeshBasicMaterial({map:textures.get(part.texture),side:THREE.DoubleSide,alphaTest:part.blend===1?.45:0,transparent:part.blend>1,depthWrite:part.blend<=1});
      if(part.blend===3||part.blend===4)material.blending=THREE.AdditiveBlending;
      if(part.blend===5||part.blend===6)material.blending=THREE.MultiplyBlending;
      const mesh=new THREE.InstancedMesh(geometry,material,transforms.length);mesh.name=model.source;
      transforms.forEach((m,index)=>mesh.setMatrixAt(index,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
    }
    // Use the original collision hull: foliage and effects remain non-solid.
    for(const transform of transforms){
      const offset=collisionPositions.length/3;
      if(transform.layoutSolid){
      for(let p=0;p<model.collision.positions.length;p+=3){v.fromArray(model.collision.positions,p).applyMatrix4(transform);collisionPositions.push(v.x,v.y,v.z);}
      for(const index of model.collision.indices)collisionIndices.push(index+offset);
      // Opaque visible surfaces also stop bullets, even where M2 walking hulls omit detail.
      const shotOffset=shotPositions.length/3;
      for(let p=0;p<model.positions.length;p+=3){v.fromArray(model.positions,p).applyMatrix4(transform);shotPositions.push(v.x,v.y,v.z);}
      for(const part of model.parts)if(part.blend===0)for(const index of part.indices)shotIndices.push(index+shotOffset);
      }
      if(/(?:stormwindfountain01|elvenfountain)\.m2$/i.test(model.source)){
        const fountain=createFountain(model.source);fountain.group.applyMatrix4(transform);group.add(fountain.group);fountains.push(fountain);
      }
    }
  }
  disposePlacedAssets=await addLayoutProps(group,layout?.placements||[],collisionPositions,collisionIndices,shotPositions,shotIndices);
  return {group,positions:collisionPositions,indices:collisionIndices,shotPositions,shotIndices,fountains,count:instances.length+(layout?.placements||[]).filter(p=>!p.prefabId.startsWith('wow:')).length,models:data.models.length,textures,disposePlacedAssets};
  }catch(error){disposePlacedAssets();group.traverse(object=>{object.geometry?.dispose();for(const material of [].concat(object.material||[]))material.dispose();object.dispose?.();});for(const texture of textures.values())texture.dispose();throw error;}
}
