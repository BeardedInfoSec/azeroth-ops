import * as THREE from 'three';
import {loadCachedGLTF} from './asset-loaders.js';
import {GUNS} from './weapon-data.js';
export {GUNS};
export async function loadWeapons(){
  // Parse one weapon at a time to avoid a burst of simultaneous image decodes.
  const models=[];
  try{
  for(const gun of GUNS){
    const model=new THREE.Group();models.push(model);
    for(const spec of [{model:gun.model},...gun.attachments]){
      const gltf=await loadCachedGLTF('/assets/weapons/'+spec.model+'.glb');
      model.add(gltf.scene);
      gltf.scene.traverse(o=>{if(o.isMesh){o.frustumCulled=false;o.material.side=THREE.DoubleSide;}});
      if(spec.position){const [x,y,z]=spec.position;gltf.scene.position.set(x,z,-y);const [pitch,yaw,roll]=spec.rotation.map(v=>THREE.MathUtils.degToRad(v)),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(roll,pitch,yaw));gltf.scene.quaternion.set(q.x,q.z,-q.y,q.w);}
    }
    model.scale.setScalar(.0254);model.rotation.y=Math.PI/2;model.updateMatrixWorld(true);
    const sight=model.getObjectByName(gun.sightTag||'tag_sights'),front=model.getObjectByName('tag_sights_front');
    const rear=sight?.getWorldPosition(new THREE.Vector3())||new THREE.Vector3(0,.133,0);
    const ahead=front?.getWorldPosition(new THREE.Vector3());
    const angle=ahead?-Math.atan2(ahead.y-rear.y,-(ahead.z-rear.z)):0;
    const aligned=rear.clone().applyAxisAngle(new THREE.Vector3(1,0,0),angle);
    model.userData.adsPitch=angle;model.userData.adsOffset=[-aligned.x,-aligned.y,-.22-aligned.z];
    model.userData.flash=model.getObjectByName('tag_flash')?.getWorldPosition(new THREE.Vector3()).toArray()||[0,.01,-.77];
    model.visible=false;
  }
  return models;
  }catch(error){
    const textures=new Set(),materials=new Set(),geometries=new Set();
    for(const model of models)model.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:object.material?[object.material]:[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
    for(const resource of [...geometries,...materials,...textures])resource.dispose();throw error;
  }
}
