const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(weights=[.65,.35,0,0]){
  const T=await import('three'),api=await import('../src/engine/skinned-raycast.js');
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0,999,999,999],3));
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute([0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0],4));
  geometry.setAttribute('skinWeight',new T.Float32BufferAttribute([...weights,...weights,...weights,...weights],4));geometry.setIndex([0,1,2]);
  const mesh=new T.SkinnedMesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide})),bone=new T.Bone(),child=new T.Bone();bone.add(child);mesh.add(bone);mesh.position.set(.2,.1,-6);mesh.updateMatrixWorld(true);mesh.bind(new T.Skeleton([bone,child]));
  let calls=0;const original=mesh.getVertexPosition;mesh.getVertexPosition=function(...args){calls++;return original.apply(this,args);};
  api.installSkinnedRaycast(mesh);
  return {T,api,mesh,bone,child,get calls(){return calls;},reset(){calls=0;}};
}

test('Off-ray and solid-cover-occluded skinned actors evaluate no vertices',async()=>{
  const f=await fixture(),{T,mesh}=f,{traceShot}=await import('../src/ballistics.js');
  const wall=new T.Mesh(new T.BoxGeometry(4,4,.2),new T.MeshBasicMaterial());wall.position.z=-2;wall.updateMatrixWorld(true);
  let shot=traceShot(new T.Vector3(),new T.Vector3(0,0,-20),wall,[mesh]);assert.ok(shot.blocked);assert.equal(f.calls,0);
  mesh.position.x=30;mesh.updateMatrixWorld(true);wall.position.x=-30;wall.updateMatrixWorld(true);
  shot=traceShot(new T.Vector3(),new T.Vector3(0,0,-20),wall,[mesh]);assert.equal(shot.hit,null);assert.equal(f.calls,0);
});

test('Conservative bounds retain native exact hits through animated poses, binds, scale and nonunit weights',async()=>{
  for(const weights of [[.65,.35,0,0],[1.2,.8,0,0],[0,0,0,0],[-.2,1.2,0,0]]){
    const f=await fixture(weights),{T,mesh,bone,child}=f;const optimized=mesh.raycast;
    const marker={id:'target'};mesh.userData={bot:marker,characterBody:true};
    for(let pose=0;pose<3;pose++){
      bone.rotation.z=pose*.2;child.position.x=pose*.3;child.rotation.y=pose*.15;mesh.scale.set(1+pose*.2,.9,1.1);mesh.rotation.y=pose*.1;mesh.updateMatrixWorld(true);
      for(let x=-2;x<=2;x+=.5){
        const ray=new T.Raycaster(new T.Vector3(x,0,2),new T.Vector3(0,0,-1),0,30),expected=[],actual=[];
        mesh.boundingSphere=null;mesh.boundingBox=null;T.SkinnedMesh.prototype.raycast.call(mesh,ray,expected);
        mesh.boundingSphere=null;optimized.call(mesh,ray,actual);
        assert.equal(actual.length,expected.length,JSON.stringify({weights,pose,x}));
        if(actual.length){assert.ok(actual[0].point.distanceTo(expected[0].point)<1e-8);assert.equal(actual[0].faceIndex,expected[0].faceIndex);assert.equal(actual[0].object.userData.bot,marker);assert.equal(actual[0].object.userData.characterBody,true);}
      }
    }
  }
});

test('Influence cache ignores unreferenced vertices and is shared by compatible geometry clones',async()=>{
  const {T,api,mesh}=await fixture();const prepared=api.prepareSkinnedRaycastGeometry(mesh.geometry);
  assert.equal(prepared.bones.get(0).max.x,1);
  const other=new T.SkinnedMesh(mesh.geometry,mesh.material);assert.equal(api.installSkinnedRaycast(other),other);
  assert.equal(api.prepareSkinnedRaycastGeometry(other.geometry),prepared);
  mesh.geometry.attributes.position.setX(0,-2);mesh.geometry.attributes.position.needsUpdate=true;
  const updated=api.prepareSkinnedRaycastGeometry(mesh.geometry);assert.notEqual(updated,prepared);assert.equal(updated.bones.get(0).min.x,-2);
});

test('Accepted candidate skips full-vertex sphere rebuild and retains gun annotations',async()=>{
  const f=await fixture(),{T,mesh}=f;mesh.userData={bot:{id:7}};
  const ray=new T.Raycaster(new T.Vector3(0,0,0),new T.Vector3(0,0,-1),0,30),hits=[];
  mesh.boundingSphere=null;mesh.raycast(ray,hits);assert.equal(hits.length,1);assert.equal(f.calls,3);assert.equal(hits[0].object.userData.bot.id,7);assert.equal(hits[0].object.userData.characterBody,undefined);
});
