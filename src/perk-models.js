import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {assetFetch} from './asset-cache.mjs';
import {loadCachedGLTF} from './asset-loaders.js';

const templates=new Map();
let loading=null;
export const perkModelStatus={loaded:[],missing:[],warnings:[]};

// Templates live for this page. Instances own geometry/material/skeleton clones;
// decoded texture maps are immutable and shared, so unloading a city cannot
// invalidate a machine used in another city or the editor preview.
export function loadPerkModels(){
  if(loading)return loading;
  loading=(async()=>{
    const response=await assetFetch('/assets/machines/manifest.json');
    if(!response.ok)throw new Error('Perk model manifest: HTTP '+response.status);
    const manifest=await response.json();
    for(const [id,entry] of Object.entries(manifest.machines||{})){
      if(typeof entry.model!=='string'||!entry.model.startsWith('/assets/machines/'))continue;
      try{
        // Do not decode all thirteen textured models at once on startup.
        const gltf=await loadCachedGLTF(entry.model);
        gltf.scene.updateMatrixWorld(true);
        templates.set(id,{scene:gltf.scene,source:entry});
        perkModelStatus.loaded.push(id);
      }catch(error){
        perkModelStatus.missing.push(id);
        perkModelStatus.warnings.push(id+': '+error.message);
      }
    }
    return perkModelStatus;
  })().catch(error=>{
    perkModelStatus.warnings.push(error.message);
    return perkModelStatus;
  });
  return loading;
}

export function createPerkModel(id,{width=.88,height=2.8,depth=.8}={}){
  const template=templates.get(id);
  if(!template)return null;
  return clonePerkModel(template.scene,{id,sourceModel:template.source.sourceModel,width,height,depth});
}

export function clonePerkModel(scene,{id,sourceModel='',width=.88,height=2.8,depth=.8}={}){
  if(![width,height,depth].every(value=>Number.isFinite(value)&&value>0))throw new Error('Machine dimensions must be positive');
  const group=new THREE.Group(),model=cloneSkeleton(scene);
  const geometries=new Set(),materials=new Set(),skeletons=new Set();
  const geometryCopies=new Map(),materialCopies=new Map();
  model.traverse(object=>{
    if(object.geometry){
      if(!geometryCopies.has(object.geometry))geometryCopies.set(object.geometry,object.geometry.clone());
      object.geometry=geometryCopies.get(object.geometry);geometries.add(object.geometry);
    }
    if(object.material){
      const cloneMaterial=material=>{
        if(!materialCopies.has(material))materialCopies.set(material,material.clone());
        const copy=materialCopies.get(material);materials.add(copy);return copy;
      };
      object.material=Array.isArray(object.material)?object.material.map(cloneMaterial):cloneMaterial(object.material);
    }
    if(object.skeleton)skeletons.add(object.skeleton);
    // Machine picking/collision uses the deliberately simple authored box.
    // Avoid expensive ray tests against decorative skinned machine meshes.
    object.raycast=()=>{};
  });
  model.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const scale=Math.min(width/Math.max(size.x,.001),height/Math.max(size.y,.001),depth/Math.max(size.z,.001));
  model.scale.multiplyScalar(scale);
  model.position.add(new THREE.Vector3(-center.x*scale,-box.min.y*scale,-center.z*scale));
  group.add(model);group.name='BO2 '+id;
  group.userData.perkId=id;group.userData.sourceModel=sourceModel;
  group.userData.machineSize=size.multiplyScalar(scale).toArray();
  let disposed=false;
  const dispose=()=>{
    if(disposed)return;disposed=true;
    group.removeFromParent();
    for(const resource of [...geometries,...materials,...skeletons])resource.dispose();
  };
  group.userData.dispose=dispose;
  return {group,dispose};
}

export const instantiatePerkModel=createPerkModel;
