import * as THREE from 'three';
import {assetFetch} from './asset-cache.mjs';
import {loadCachedTextureSet} from './asset-loaders.js';
import {installSkinnedRaycast,prepareSkinnedRaycastGeometry} from './engine/skinned-raycast.js';
export const FACTIONS={
  alliance:{name:'Alliance',color:0x70b8ff,races:['human','dwarf','nightelf','gnome','draenei']},
  horde:{name:'Horde',color:0xf06a50,races:['orc','forsaken','tauren','troll','bloodelf']}
};
const templates=new Map();
let characterLoad=null;
export function loadCharacters(){
  if(!characterLoad)characterLoad=loadCharacterAssets().catch(error=>{characterLoad=null;throw error;});
  return characterLoad;
}
async function loadCharacterAssets(){
  const response=await assetFetch('/assets/characters/manifest.json');if(!response.ok)throw new Error('Character assets missing. Run npm run import:characters.');
  const manifest=await response.json();
  const characters=await Promise.all(manifest.characters.map(async info=>{
    const r=await assetFetch(info.file);if(!r.ok)throw new Error('Missing character '+info.name);return {info,data:await r.json()};
  }));
  const textures=await loadCachedTextureSet(characters.flatMap(({data})=>data.parts.map(part=>part.texture)),texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.anisotropy=4;
  });
  const pendingTemplates=new Map(),ownedGeometries=[],ownedMaterials=[];
  try{
  for(const {info,data} of characters){
    const geometries=[],materials=[];
    for(const part of data.parts){
      const geo=new THREE.BufferGeometry();ownedGeometries.push(geo);
      geo.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));
      geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.joints,4));
      geo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(data.weights,4));geo.setIndex(part.indices);
      prepareSkinnedRaycastGeometry(geo);
      const material=new THREE.MeshStandardMaterial({map:textures.get(part.texture),roughness:.95,metalness:0,side:THREE.DoubleSide,alphaTest:part.blend===1?.5:0});
      geometries.push(geo);materials.push(material);ownedMaterials.push(material);
    }
    pendingTemplates.set(info.id,{data,geometries,materials});
  }
  for(const [id,template] of pendingTemplates)templates.set(id,template);
  return manifest.characters;
  }catch(error){ownedGeometries.forEach(geometry=>geometry.dispose());ownedMaterials.forEach(material=>material.dispose());for(const texture of textures.values())texture.dispose();throw error;}
}
export function characterInfo(id){return templates.get(id)?.data;}

// Additive pose over the currently playing imported animation. Restoring the
// saved animation pose before each mixer update prevents drift at dt=0 and
// makes standing restore exact local bone transforms without scaling a model.
export function createCrouchPose(data,bones,visual,{ratio=1.6/2.45}={}){
  const rootIndex=data.bones.findIndex(bone=>bone.key===26),pelvisIndex=data.bones.findIndex(bone=>bone.key===5),spineIndex=data.bones.findIndex(bone=>bone.key===4),headIndex=data.bones.findIndex(bone=>bone.key===6);
  const children=data.bones.map(()=>[]);data.bones.forEach((bone,index)=>{if(bone.parent>=0)children[bone.parent].push(index);});
  const candidates=[],pelvis=data.bones[pelvisIndex];
  if(pelvis)for(const hip of children[pelvisIndex]){
    const at=data.bones[hip].pivot,side=at[2]-pelvis.pivot[2];if(Math.abs(side)<.02||at[1]>pelvis.pivot[1]+.1)continue;
    for(const knee of children[hip])for(let foot of children[knee]){
      const kneeAt=data.bones[knee].pivot;if(kneeAt[1]>=at[1]-.03||data.bones[foot].pivot[1]>=kneeAt[1]-.03)continue;
      // Hooved races have an extra hock between the knee and planted foot.
      while(data.bones[foot].pivot[1]>pelvis.pivot[1]*.25){const next=children[foot].filter(index=>data.bones[index].pivot[1]<data.bones[foot].pivot[1]-.03).sort((a,b)=>data.bones[a].pivot[1]-data.bones[b].pivot[1])[0];if(next===undefined)break;foot=next;}
      candidates.push({hip,knee,foot,side,span:at[1]-data.bones[foot].pivot[1]});
    }
  }
  const legs=[-1,1].map(side=>candidates.filter(leg=>Math.sign(leg.side)===side).sort((a,b)=>b.span-a.span)[0]).filter(Boolean).map(leg=>({...leg,target:new THREE.Vector3(),orientation:new THREE.Quaternion()}));
  const supported=rootIndex>=0&&spineIndex>=0&&headIndex>=0&&legs.length===2;
  const changed=[...new Set([rootIndex,spineIndex,headIndex,...legs.flatMap(leg=>[leg.hip,leg.knee,leg.foot])].filter(index=>index>=0))].map(index=>({bone:bones[index],position:new THREE.Vector3(),quaternion:new THREE.Quaternion()}));
  const position=new THREE.Vector3(),scale=new THREE.Vector3(),q=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),delta=new THREE.Quaternion(),right=new THREE.Vector3(),forward=new THREE.Vector3(),headBefore=new THREE.Vector3(),headOrientation=new THREE.Quaternion();
  const hipAt=new THREE.Vector3(),kneeAt=new THREE.Vector3(),footAt=new THREE.Vector3(),direction=new THREE.Vector3(),bend=new THREE.Vector3(),desiredKnee=new THREE.Vector3(),from=new THREE.Vector3(),to=new THREE.Vector3(),headDelta=new THREE.Vector3();
  let enabled=false,applied=false,heightRatio=1;
  const worldRotation=(bone,out)=>{bone.matrixWorld.decompose(position,out,scale);return out;};
  function restore(){if(!applied)return;for(const record of changed){record.bone.position.copy(record.position);record.bone.quaternion.copy(record.quaternion);}applied=false;}
  function rotateWorld(bone,rotation){worldRotation(bone,q).premultiply(rotation);worldRotation(bone.parent,parentQ).invert();bone.quaternion.copy(parentQ.multiply(q));bone.updateWorldMatrix(false,true);}
  function preserveWorldRotation(bone,orientation){worldRotation(bone.parent,parentQ).invert();bone.quaternion.copy(parentQ.multiply(orientation));bone.updateWorldMatrix(false,true);}
  function apply(){
    restore();if(!enabled||!supported){heightRatio=1;return;}
    for(const record of changed){record.position.copy(record.bone.position);record.quaternion.copy(record.bone.quaternion);}applied=true;
    visual.updateWorldMatrix(true,true);visual.matrixWorld.decompose(position,q,scale);
    const worldScale=scale.y,standingHeight=data.height*(worldScale/visual.scale.y),desiredDrop=standingHeight*(1-ratio);
    headBefore.setFromMatrixPosition(bones[headIndex].matrixWorld);worldRotation(bones[headIndex],headOrientation);
    right.set(0,0,1).transformDirection(visual.matrixWorld);forward.set(1,0,0).transformDirection(visual.matrixWorld);
    let hipLimit=Infinity;
    for(const leg of legs){leg.target.setFromMatrixPosition(bones[leg.foot].matrixWorld);worldRotation(bones[leg.foot],leg.orientation);hipAt.setFromMatrixPosition(bones[leg.hip].matrixWorld);hipLimit=Math.min(hipLimit,Math.max(0,hipAt.y-leg.target.y)*.82);}
    const drop=Math.min(desiredDrop,hipLimit);bones[rootIndex].position.y-=drop/worldScale;bones[rootIndex].position.x-=drop/worldScale*.18;
    bones[rootIndex].updateWorldMatrix(false,true);
    // Short-legged races fold at the spine as well as the hips. Keep the head's
    // animated orientation, so this lowers its position without tipping a face
    // or weapon directly into the ground.
    headDelta.setFromMatrixPosition(bones[headIndex].matrixWorld);position.setFromMatrixPosition(bones[spineIndex].matrixWorld);headDelta.sub(position);
    const needed=Math.max(0,desiredDrop-drop);let low=.14,high=1.05;
    for(let i=0;i<9;i++){const angle=(low+high)/2,predicted=from.copy(headDelta).applyAxisAngle(right,-angle);if(headDelta.y-predicted.y<needed)low=angle;else high=angle;}
    rotateWorld(bones[spineIndex],delta.setFromAxisAngle(right,-high));preserveWorldRotation(bones[headIndex],headOrientation);
    for(const leg of legs){
      const hip=bones[leg.hip],knee=bones[leg.knee],foot=bones[leg.foot];
      hipAt.setFromMatrixPosition(hip.matrixWorld);kneeAt.setFromMatrixPosition(knee.matrixWorld);footAt.setFromMatrixPosition(foot.matrixWorld);
      const upper=hipAt.distanceTo(kneeAt),lower=kneeAt.distanceTo(footAt);if(upper<1e-5||lower<1e-5)continue;
      direction.subVectors(leg.target,hipAt);const distance=THREE.MathUtils.clamp(direction.length(),Math.abs(upper-lower)+1e-5,upper+lower-1e-5);direction.normalize();
      bend.copy(forward).addScaledVector(direction,-forward.dot(direction));if(bend.lengthSq()<1e-8)bend.copy(right);bend.normalize();
      const along=(upper*upper-lower*lower+distance*distance)/(2*distance),across=Math.sqrt(Math.max(0,upper*upper-along*along));
      desiredKnee.copy(hipAt).addScaledVector(direction,along).addScaledVector(bend,across);
      from.subVectors(kneeAt,hipAt).normalize();to.subVectors(desiredKnee,hipAt).normalize();rotateWorld(hip,delta.setFromUnitVectors(from,to));
      kneeAt.setFromMatrixPosition(knee.matrixWorld);footAt.setFromMatrixPosition(foot.matrixWorld);from.subVectors(footAt,kneeAt).normalize();to.subVectors(leg.target,kneeAt).normalize();rotateWorld(knee,delta.setFromUnitVectors(from,to));
      preserveWorldRotation(foot,leg.orientation);
    }
    heightRatio=1-(headBefore.y-position.setFromMatrixPosition(bones[headIndex].matrixWorld).y)/standingHeight;
  }
  return {supported,legs:legs.map(({hip,knee,foot})=>({hip,knee,foot})),restore,apply,setEnabled(value){value=!!value;if(value===enabled)return;enabled=value;apply();},get enabled(){return enabled;},get heightRatio(){return heightRatio;}};
}

export function createCharacter(id){
  const template=templates.get(id);if(!template)throw new Error('Character not loaded: '+id);
  return createCharacterInstance(id,template);
}
export function createCharacterInstance(id,template){
  const {data,geometries,materials}=template;
  const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
  const bones=data.bones.map((b,i)=>{const bone=new THREE.Bone();bone.name='bone_'+i;bone.position.fromArray(b.pivot);if(b.parent>=0)bone.position.sub(new THREE.Vector3().fromArray(data.bones[b.parent].pivot));return bone;});
  bones.forEach((bone,i)=>{const parent=data.bones[i].parent;if(parent>=0)bones[parent].add(bone);else visual.add(bone);});
  visual.updateMatrixWorld(true);const skeleton=new THREE.Skeleton(bones);
  const meshes=geometries.map((geo,i)=>{const m=new THREE.SkinnedMesh(geo,materials[i]);m.name=id+'-part-'+i;visual.add(m);m.bind(skeleton);m.frustumCulled=false;return m;});
  installSkinnedRaycast(root);
  const clips=data.clips.map(c=>{
    const tracks=c.tracks.map(t=>{
      const name='bone_'+t.bone,values=t.values.slice();
      if(t.type==='position')for(let j=0;j<values.length;j+=3){values[j]+=bones[t.bone].position.x;values[j+1]+=bones[t.bone].position.y;values[j+2]+=bones[t.bone].position.z;}
      const Type=t.type==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
      return new Type(name+'.'+(t.type==='rotation'?'quaternion':t.type),t.times,values,t.interpolation===0?THREE.InterpolateDiscrete:THREE.InterpolateLinear);
    });
    return new THREE.AnimationClip(c.name,c.duration,tracks);
  });
  let minY=Infinity,maxY=-Infinity;
  for(const part of data.parts)for(const i of part.indices){minY=Math.min(minY,data.positions[i*3+1]);maxY=Math.max(maxY,data.positions[i*3+1]);}
  const scale=data.height/(maxY-minY);visual.scale.setScalar(scale);visual.position.y=-minY*scale;visual.rotation.y=-Math.PI/2;
  const mixer=new THREE.AnimationMixer(visual);let current=null,currentName='',crouch=null;
  function animate(name,once=false){
    const clip=clips.find(c=>c.name===name)||(name==='walk'?clips.find(c=>c.name==='run'):null)||clips.find(c=>c.name==='idle');if(!clip)return;
    const speed=name==='walk'&&clip.name==='run'?.5:1;
    if(currentName===clip.name){if(current.timeScale!==speed)current.setEffectiveTimeScale(speed);return;}
    crouch?.restore();
    const action=mixer.clipAction(clip);action.reset().setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;action.play();if(current)action.crossFadeFrom(current,.12,true);action.setEffectiveTimeScale(speed);current=action;currentName=clip.name;
  }
  animate('idle');mixer.update(.01);
  const hand=data.attachments.find(a=>a.id===1);
  const grip=new THREE.Object3D();
  if(hand&&bones[hand.bone]){grip.position.fromArray(hand.position).sub(new THREE.Vector3().fromArray(data.bones[hand.bone].pivot));bones[hand.bone].add(grip);}else{grip.position.set(.3,data.height*.65,.15);root.add(grip);}
  crouch=createCrouchPose(data,bones,visual);
  return {id,root,visual,meshes,skeleton,mixer,grip,height:data.height,animate,setCrouched(value){if(crouch.enabled===!!value)return;crouch.setEnabled(value);for(const mesh of meshes){mesh.boundingSphere=null;mesh.boundingBox=null;}},get crouched(){return crouch.enabled;},get crouchHeightRatio(){return crouch.heightRatio;},get animation(){return currentName;},update(dt){crouch.restore();mixer.update(dt);crouch.apply();for(const mesh of meshes)mesh.boundingSphere=null;},dispose(){crouch.restore();mixer.stopAllAction();mixer.uncacheRoot(visual);skeleton.dispose();root.removeFromParent();}};
}
