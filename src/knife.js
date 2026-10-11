import * as THREE from 'three';
import {loadCachedGLTF} from './asset-loaders.js';

/** One reusable view model; no particles, lights, or geometry allocation per stab. */
export function createKnifeView(camera){
  const root=new THREE.Group(),model=new THREE.Group();root.name='quick-knife';root.visible=false;root.add(model);camera.add(root);
  const fallback=new THREE.Group(),steel=new THREE.MeshStandardMaterial({color:0xb7c2c3,metalness:.8,roughness:.3}),rubber=new THREE.MeshStandardMaterial({color:0x242925,roughness:.95});
  const part=(geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);fallback.add(mesh);return mesh;};
  part(new THREE.BoxGeometry(.035,.025,.13),rubber,0,0,-.03);
  part(new THREE.BoxGeometry(.075,.015,.014),steel,0,0,-.102);
  part(new THREE.BoxGeometry(.035,.008,.19),steel,0,0,-.2);
  const tip=part(new THREE.ConeGeometry(.022,.065,3),steel,0,0,-.327);tip.rotation.x=-Math.PI/2;tip.scale.z=.2;model.add(fallback);
  const fist=new THREE.Mesh(new THREE.BoxGeometry(.075,.09,.09),rubber);fist.position.set(0,-.025,.005);root.add(fist);
  let age=1,disposed=false,imported=null;
  const ready=loadCachedGLTF('/assets/weapons/t6_wpn_knife_base_view_lod0.glb').then(gltf=>{
    imported=gltf.scene;
    if(disposed){disposeObject(imported);return false;}
    imported.scale.setScalar(.0254);imported.rotation.y=Math.PI/2;imported.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(imported),center=bounds.getCenter(new THREE.Vector3());
    // Keep the hilt beside the hand and the blade facing forward in view space.
    imported.position.set(-center.x,-center.y,-bounds.max.z+.035);
    imported.traverse(object=>{if(object.isMesh){object.frustumCulled=false;for(const material of Array.isArray(object.material)?object.material:[object.material])material.side=THREE.DoubleSide;}});
    model.add(imported);fallback.visible=false;return true;
  }).catch(error=>{console.warn('Imported knife unavailable; using local knife model.',error);return false;});
  return {
    root,ready,get active(){return age<.48;},get imported(){return !!imported;},
    swing(){age=0;},
    reset(){age=1;root.visible=false;},
    update(dt,{visible=true}={}){
      age=Math.min(1,age+Math.max(0,dt));root.visible=visible&&age<.48;if(!root.visible)return;
      const phase=Math.min(1,age/.48),stroke=Math.sin(phase*Math.PI),sweep=Math.sin(phase*Math.PI*1.3);
      root.position.set(.31-.43*sweep,-.3+.13*stroke,-.43-.19*stroke);
      root.rotation.set(-.12-.22*stroke,-.38+.78*sweep,-.6+.85*sweep);
    },
    dispose(){disposed=true;root.removeFromParent();disposeObject(root);}
  };
}

function disposeObject(object){
  const resources=new Set();object.traverse(node=>{if(node.geometry)resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);}});for(const resource of resources)resource.dispose();
}
