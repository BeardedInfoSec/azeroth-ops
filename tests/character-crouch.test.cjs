const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(shortLegs=false){
  const T=await import('three'),{createCrouchPose}=await import('../src/characters.js');
  const hip=shortLegs?.38:1,knee=shortLegs?.23:.55,foot=.08,spine=hip+.1,head=shortLegs?1:1.8,height=shortLegs?1.2:2;
  const bone=(parent,key,pivot)=>({parent,key,pivot}),records=[bone(-1,-1,[0,0,0]),bone(0,26,[0,spine,0]),bone(1,4,[0,spine,0]),bone(1,5,[0,hip+.05,0]),bone(2,6,[.02,head,0]),bone(3,-1,[0,hip,-.16]),bone(5,-1,[0,knee,-.16]),bone(6,-1,[0,foot,-.16]),bone(3,-1,[0,hip,.16]),bone(8,-1,[0,knee,.16]),bone(9,-1,[0,foot,.16]),bone(2,-1,[.3,spine+.3,.2])];
  const root=new T.Group(),visual=new T.Group();root.add(visual);root.position.set(3,2,-4);root.rotation.y=.4;visual.rotation.y=-Math.PI/2;visual.scale.setScalar(.9);
  const bones=records.map((record,index)=>{const b=new T.Bone();b.name='bone_'+index;b.position.fromArray(record.pivot);if(record.parent>=0)b.position.sub(new T.Vector3(...records[record.parent].pivot));return b;});
  bones.forEach((b,index)=>{const parent=records[index].parent;if(parent>=0)bones[parent].add(b);else visual.add(b);});root.updateMatrixWorld(true);
  const pose=createCrouchPose({bones:records,height},bones,visual),at=index=>bones[index].getWorldPosition(new T.Vector3());
  return {T,root,visual,bones,pose,at,height,records};
}

test('Crouching lowers the skeleton and grip while keeping feet, actor root, scale and height unchanged',async()=>{
  const f=await fixture(),head=f.at(4),hand=f.at(11),left=f.at(7),right=f.at(10),origin=f.root.position.clone(),scale=f.visual.scale.clone();
  assert.equal(f.pose.supported,true);f.pose.setEnabled(true);
  assert.ok(f.at(4).y<head.y-.5);assert.ok(f.at(11).y<hand.y-.4);assert.ok(f.at(7).distanceTo(left)<1e-7);assert.ok(f.at(10).distanceTo(right)<1e-7);
  assert.deepEqual(f.root.position.toArray(),origin.toArray());assert.deepEqual(f.visual.scale.toArray(),scale.toArray());assert.equal(f.height,2);assert.ok(Math.abs(f.pose.heightRatio-1.6/2.45)<.025);
  const spine=f.bones[2].quaternion.clone();assert.ok(Math.abs(spine.z)>.01);
});

test('Zero-time updates and repeated crouch calls never accumulate and standing restores the exact animation pose',async()=>{
  const f=await fixture(),baseline=f.bones.map(bone=>({p:bone.position.clone(),q:bone.quaternion.clone()}));f.pose.setEnabled(true);const head=f.at(4),foot=f.at(7);
  for(let i=0;i<120;i++){f.pose.setEnabled(true);f.pose.restore();f.pose.apply();assert.ok(f.at(4).distanceTo(head)<1e-8);assert.ok(f.at(7).distanceTo(foot)<1e-8);}
  f.pose.setEnabled(false);f.bones.forEach((bone,index)=>{assert.ok(bone.position.distanceTo(baseline[index].p)<1e-10);assert.ok(bone.quaternion.angleTo(baseline[index].q)<1e-8);});assert.equal(f.pose.heightRatio,1);
  // A newly sampled animation's ankle position becomes the next planted target.
  f.bones[5].rotation.z=.12;f.root.updateMatrixWorld(true);const animatedFoot=f.at(7);f.pose.setEnabled(true);assert.ok(f.at(7).distanceTo(animatedFoot)<1e-7);
});

test('Short-legged rigs fold the torso to reach the crouch height without squashing or losing planted feet',async()=>{
  const f=await fixture(true),left=f.at(7),right=f.at(10),orientation=f.bones[4].getWorldQuaternion(new f.T.Quaternion());f.pose.setEnabled(true);
  assert.ok(f.at(7).distanceTo(left)<1e-7);assert.ok(f.at(10).distanceTo(right)<1e-7);assert.ok(Math.abs(f.pose.heightRatio-1.6/2.45)<.025);
  assert.ok(f.bones[4].getWorldQuaternion(new f.T.Quaternion()).angleTo(orientation)<1e-7);
});

test('Missing walk uses a slower run clip and switching back to run preserves playback time',async()=>{
  const {T,records}=await fixture(),{createCharacterInstance}=await import('../src/characters.js');
  const positions=[0,0,0,0,2,0,.1,0,0],geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(Array(12).fill(0),4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));geometry.setIndex([0,1,2]);
  const material=new T.MeshBasicMaterial(),data={bones:records,height:2,positions,parts:[{indices:[0,1,2]}],attachments:[],clips:['idle','run'].map(name=>({name,duration:10,tracks:[{bone:0,type:'position',times:[0,10],values:[0,0,0,name==='run'?10:0,0,0],interpolation:1}]}))};
  const actor=createCharacterInstance('fixture',{data,geometries:[geometry],materials:[material]});
  try{
    actor.animate('walk');actor.update(.3);assert.equal(actor.animation,'run');const bone=actor.visual.getObjectByName('bone_0'),first=bone.position.x;actor.animate('walk');actor.update(.1);assert.ok(Math.abs(bone.position.x-first-.05)<1e-7);
    const before=bone.position.x;actor.animate('run');actor.update(.1);assert.ok(Math.abs(bone.position.x-before-.1)<1e-7);
    const after=bone.position.x;actor.animate('walk');actor.update(.1);assert.ok(Math.abs(bone.position.x-after-.05)<1e-7);
    actor.setCrouched(true);const head=actor.visual.getObjectByName('bone_4').getWorldPosition(new T.Vector3());actor.update(0);actor.setCrouched(true);actor.update(0);assert.ok(actor.visual.getObjectByName('bone_4').getWorldPosition(new T.Vector3()).distanceTo(head)<1e-7);assert.equal(actor.height,2);
  }finally{actor.dispose();geometry.dispose();material.dispose();}
});
