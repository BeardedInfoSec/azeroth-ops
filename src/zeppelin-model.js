import * as THREE from 'three';
import {assetFetch} from './asset-cache.mjs';
import {loadCachedTextureSet} from './asset-loaders.js';
import {PLAYER_EYE_HEIGHT} from './player-config.js';

let loadedTemplate=null,loading=null;
export const zeppelinStatus={ready:false,source:null,error:null};

export function loadZeppelin(){
  if(loadedTemplate)return Promise.resolve(zeppelinStatus);
  if(loading)return loading;
  loading=(async()=>{
    const response=await assetFetch('/assets/transports/horde-zeppelin.json');
    if(!response.ok)throw new Error('Horde zeppelin assets missing: HTTP '+response.status);
    const data=await response.json();
    const textures=await loadCachedTextureSet([...data.materials.map(material=>material.texture),...data.models.flatMap(model=>model.parts.map(part=>part.texture))],texture=>{
      texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=4;
    });
    try{loadedTemplate=buildZeppelinTemplate(data,textures);}
    catch(error){for(const texture of textures.values())texture.dispose();throw error;}
    zeppelinStatus.ready=true;zeppelinStatus.source=data.source;zeppelinStatus.error=null;return zeppelinStatus;
  })().catch(error=>{zeppelinStatus.error=error.message;throw error;}).finally(()=>{loading=null;});
  return loading;
}

// Geometry/material/texture templates remain cached for the document lifetime.
// Each BR view owns only its scene nodes, skeletons and animation mixers.
export function buildZeppelinTemplate(data,textures){
  const geometries=new Set(),materials=new Set(),parts=[];
  const material=spec=>{
    const Type=spec.flags&1?THREE.MeshBasicMaterial:THREE.MeshStandardMaterial;
    const options={map:textures.get(spec.texture)||null,side:THREE.DoubleSide,alphaTest:spec.blend===1?.45:0,transparent:spec.blend>1,depthWrite:spec.blend<=1};
    if(Type===THREE.MeshStandardMaterial)Object.assign(options,{roughness:.96,metalness:0});
    const result=new Type(options);materials.add(result);
    if(spec.blend===3||spec.blend===4)result.blending=THREE.AdditiveBlending;
    if(spec.blend===5||spec.blend===6)result.blending=THREE.MultiplyBlending;
    return result;
  };
  const geometry=(data,indices,skinned=false)=>{
    const result=new THREE.BufferGeometry();geometries.add(result);
    result.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
    result.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));
    result.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));result.setIndex(indices);
    if(skinned){result.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.joints,4));result.setAttribute('skinWeight',new THREE.Float32BufferAttribute(data.weights,4));}
    result.computeBoundingSphere();return result;
  };
  try{
    for(const group of data.groups)for(const batch of group.batches){
      const spec=data.materials[batch.material];if(!spec)throw new Error('Invalid zeppelin WMO material');
      parts.push({geometry:geometry(group,group.indices.slice(batch.start,batch.start+batch.count)),material:material(spec)});
    }
    const models=data.models.map(model=>({data:model,parts:model.parts.map(part=>({geometry:geometry(model,part.indices,model.bones.length>0),material:material(part)}))}));
    let disposed=false;
    return {data,parts,models,dispose(){if(disposed)return;disposed=true;for(const resource of [...geometries,...materials,...textures.values()])resource.dispose();}};
  }catch(error){for(const resource of [...geometries,...materials])resource.dispose();throw error;}
}

export function instantiateZeppelin(template,{eyeHeight=PLAYER_EYE_HEIGHT}={}){
  const {data,parts,models}=template,group=new THREE.Group(),content=new THREE.Group(),skeletons=[],mixers=[];
  group.name='Original Horde deployment zeppelin';content.name='Wrath transport hull and doodads';group.add(content);
  for(const part of parts){const mesh=new THREE.Mesh(part.geometry,part.material);mesh.raycast=()=>{};content.add(mesh);}
  for(const item of data.instances){
    const model=models[item.model];if(!model)throw new Error('Invalid zeppelin doodad model');
    const visual=new THREE.Group();visual.name=model.data.source;
    const bones=model.data.bones.map((record,index)=>{const bone=new THREE.Bone();bone.name='bone_'+index;bone.position.fromArray(record.pivot);if(record.parent>=0)bone.position.sub(new THREE.Vector3().fromArray(model.data.bones[record.parent].pivot));return bone;});
    bones.forEach((bone,index)=>{const parent=model.data.bones[index].parent;if(parent>=0)bones[parent].add(bone);else visual.add(bone);});
    visual.updateMatrixWorld(true);const skeleton=bones.length?new THREE.Skeleton(bones):null;if(skeleton)skeletons.push(skeleton);
    for(const part of model.parts){const mesh=skeleton?new THREE.SkinnedMesh(part.geometry,part.material):new THREE.Mesh(part.geometry,part.material);visual.add(mesh);if(skeleton){mesh.bind(skeleton);mesh.frustumCulled=false;}mesh.raycast=()=>{};}
    if(skeleton&&model.data.clips?.length){
      const mixer=new THREE.AnimationMixer(visual);mixers.push(mixer);
      for(const clip of model.data.clips){
        const tracks=clip.tracks.map(track=>{
          const values=track.values.slice();if(track.type==='position')for(let i=0;i<values.length;i+=3){values[i]+=bones[track.bone].position.x;values[i+1]+=bones[track.bone].position.y;values[i+2]+=bones[track.bone].position.z;}
          const Type=track.type==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
          return new Type('bone_'+track.bone+'.'+(track.type==='rotation'?'quaternion':track.type),track.times,values,track.interpolation===0?THREE.InterpolateDiscrete:THREE.InterpolateLinear);
        });
        mixer.clipAction(new THREE.AnimationClip(clip.name,clip.duration,tracks)).play();
      }
      mixer.update(0);
    }
    visual.position.fromArray(item.position);visual.quaternion.fromArray(item.rotation).normalize();visual.scale.setScalar(item.scale);content.add(visual);
  }
  const anchor=new THREE.Vector3().fromArray(data.presentation.deckAnchor),scale=data.presentation.scale,yaw=data.presentation.yaw;
  content.scale.setScalar(scale);content.rotation.y=yaw;
  content.position.copy(anchor.applyAxisAngle(new THREE.Vector3(0,1,0),yaw).multiplyScalar(-scale));content.position.y-=eyeHeight;
  group.updateMatrixWorld(true);group.userData.source=data.source;group.userData.deckHeight=-eyeHeight;group.userData.length=data.presentation.length;
  let disposed=false;
  return {group,update(dt){if(!disposed)for(const mixer of mixers)mixer.update(Math.max(0,Math.min(.1,dt)));},dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const mixer of mixers){mixer.stopAllAction();mixer.uncacheRoot(mixer.getRoot());}for(const skeleton of skeletons)skeleton.dispose();}};
}

export function createZeppelinModel(options){return loadedTemplate?instantiateZeppelin(loadedTemplate,options):null;}
