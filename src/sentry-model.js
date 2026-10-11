import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {loadCachedGLTF} from './asset-loaders.js';

export const SENTRY_MODEL_URL='/assets/streaks/t6_wpn_turret_sentry_gun.glb';
const INCH=.0254,RECOIL_INCHES=2.2,RECOIL_RECOVERY=14,FLASH_TIME=.05;
let template=null,loading=null;
export const sentryModelStatus={ready:false,error:null};

// One decoded GLB template per page. Instances own cloned geometry, materials
// and skeletons; decoded texture maps are immutable and shared.
export function loadSentryModel(){
  if(template)return Promise.resolve(sentryModelStatus);
  if(loading)return loading;
  loading=loadCachedGLTF(SENTRY_MODEL_URL).then(gltf=>{
    gltf.scene.updateMatrixWorld(true);template=gltf.scene;sentryModelStatus.ready=true;sentryModelStatus.error=null;return sentryModelStatus;
  }).catch(error=>{sentryModelStatus.error=error.message;return sentryModelStatus;}).finally(()=>{loading=null;});
  return loading;
}

// BO2 axes: +X forward, +Z up inside tag_origin's -90 degree X rotation, so the
// exported scene is Y-up with the barrel along +X. The bones tag_aim (yaw about
// its local Z) and tag_aim_pitch (pitch about its local Y) move the skinned mesh.
export function yawToDirection(dx,dz){return Math.atan2(-dz,dx);}
export function instantiateSentry(scene,{scale=INCH}={}){
  const group=new THREE.Group(),model=cloneSkeleton(scene),geometries=new Set(),materials=new Set(),skeletons=new Set();
  const geometryCopies=new Map(),materialCopies=new Map();
  model.traverse(object=>{
    if(object.geometry){
      if(!geometryCopies.has(object.geometry))geometryCopies.set(object.geometry,object.geometry.clone());
      object.geometry=geometryCopies.get(object.geometry);geometries.add(object.geometry);
    }
    if(object.material){
      const copy=material=>{if(!materialCopies.has(material)){const result=material.clone();result.side=THREE.DoubleSide;materialCopies.set(material,result);}const result=materialCopies.get(material);materials.add(result);return result;};
      object.material=Array.isArray(object.material)?object.material.map(copy):copy(object.material);
    }
    if(object.skeleton)skeletons.add(object.skeleton);
    if(object.isMesh){object.frustumCulled=false;object.raycast=()=>{};}
  });
  model.scale.setScalar(scale);group.add(model);group.name='BO2 sentry gun';
  const aim=model.getObjectByName('tag_aim'),pitchBone=model.getObjectByName('tag_aim_pitch'),flash=model.getObjectByName('tag_flash');
  const pitchRest=pitchBone?.position.clone()??null;
  let recoil=0,flashLeft=0,disposed=false;
  const api={
    group,aim,pitchBone,flash,
    // Yaw is world-space radians about +Y with 0 pointing along +X (see yawToDirection).
    setYaw(yaw){if(aim)aim.rotation.z=yaw;},
    aimAt(from,to){
      const dx=to.x-from.x,dz=to.z-from.z,flat=Math.hypot(dx,dz);
      api.setYaw(yawToDirection(dx,dz));
      if(pitchBone)pitchBone.rotation.y=-Math.atan2(to.y-from.y,Math.max(flat,.001));
    },
    fire(){recoil=1;flashLeft=FLASH_TIME;},
    get recoil(){return recoil;},
    get flashing(){return flashLeft>0;},
    update(dt){
      if(disposed)return;
      flashLeft=Math.max(0,flashLeft-dt);recoil=Math.max(0,recoil-dt*RECOIL_RECOVERY);
      if(pitchBone&&pitchRest)pitchBone.position.set(pitchRest.x-recoil*RECOIL_INCHES,pitchRest.y,pitchRest.z);
    },
    muzzleWorld(target=new THREE.Vector3()){
      group.updateMatrixWorld(true);
      return flash?flash.getWorldPosition(target):group.getWorldPosition(target).add(new THREE.Vector3(0,1.15,0));
    },
    dispose(){
      if(disposed)return;disposed=true;group.removeFromParent();
      for(const resource of [...geometries,...materials,...skeletons])resource.dispose();
    },
  };
  group.userData.sentry=api;
  return api;
}

export function createSentryModel(options){return template?instantiateSentry(template,options):null;}
