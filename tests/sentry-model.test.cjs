const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {skipUnlessAssets}=require('./helpers/assets.cjs');

// Tiny skinned fixture with the BO2 turret tag names; no GPU, no network.
async function fixture(){
  const T=await import('three'),root=new T.Group(),origin=new T.Bone(),aim=new T.Bone(),pitch=new T.Bone(),flash=new T.Bone();
  origin.name='tag_origin';origin.rotation.x=-Math.PI/2;aim.name='tag_aim';aim.position.set(0,0,31);
  pitch.name='tag_aim_pitch';pitch.position.set(0,0,19);flash.name='tag_flash';flash.position.set(42,0,4);
  pitch.add(flash);aim.add(pitch);origin.add(aim);
  const geometry=new T.BoxGeometry(10,10,10),count=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Array(count*4).fill(0),4));
  geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(Array.from({length:count*4},(_,i)=>i%4===0?1:0),4));
  const mesh=new T.SkinnedMesh(geometry,new T.MeshStandardMaterial({map:new T.Texture()})),skeleton=new T.Skeleton([origin,aim,pitch,flash]);
  root.add(origin);root.add(mesh);mesh.bind(skeleton);root.updateMatrixWorld(true);
  return {T,root,geometry,texture:mesh.material.map};
}

test('Sentry instances yaw to the target in the game direction and put the muzzle on tag_flash',async()=>{
  const {T,root}=await fixture(),{instantiateSentry,yawToDirection}=await import('../src/sentry-model.js'),sentry=instantiateSentry(root);
  assert.ok(sentry.aim&&sentry.pitchBone&&sentry.flash);
  sentry.group.position.set(10,2,-5);
  const forward=()=>{const a=sentry.muzzleWorld(),b=sentry.group.getWorldPosition(new T.Vector3());return a.sub(b).setY(0).normalize();};
  for(const [dx,dz] of [[1,0],[0,-1],[-1,0],[0,1],[3,-4]]){
    sentry.aimAt(new T.Vector3(0,0,0),new T.Vector3(dx,0,dz));
    const f=forward(),length=Math.hypot(dx,dz);
    assert.ok(Math.abs(f.x-dx/length)<1e-6&&Math.abs(f.z-dz/length)<1e-6,'muzzle points at '+dx+','+dz);
  }
  assert.ok(Math.abs(yawToDirection(1,0))<1e-12);
  sentry.aimAt(new T.Vector3(0,0,0),new T.Vector3(10,10,0));
  assert.ok(sentry.muzzleWorld().y>sentry.group.position.y+0.45,'pitches up toward elevated targets');
  sentry.dispose();
});

test('Sentry recoil kicks the barrel bone back and recovers; flash is brief',async()=>{
  const {root}=await fixture(),{instantiateSentry}=await import('../src/sentry-model.js'),sentry=instantiateSentry(root),rest=sentry.pitchBone.position.x;
  sentry.fire();sentry.update(0);assert.ok(sentry.pitchBone.position.x<rest);assert.ok(sentry.flashing);
  sentry.update(.06);assert.equal(sentry.flashing,false);
  sentry.update(1);assert.equal(sentry.pitchBone.position.x,rest);assert.equal(sentry.recoil,0);
  sentry.dispose();
});

test('Sentry instances own geometry and materials, share textures, and dispose once',async()=>{
  const {root,geometry,texture}=await fixture(),{instantiateSentry}=await import('../src/sentry-model.js'),a=instantiateSentry(root),b=instantiateSentry(root);
  const meshA=a.group.getObjectByProperty('isSkinnedMesh',true),meshB=b.group.getObjectByProperty('isSkinnedMesh',true);
  assert.notEqual(meshA.geometry,geometry);assert.notEqual(meshA.geometry,meshB.geometry);assert.notEqual(meshA.material,meshB.material);assert.equal(meshA.material.map,texture);
  assert.notEqual(a.aim,b.aim,'bones are cloned per instance');
  let disposed=0,other=0,textureDisposed=0;meshA.geometry.addEventListener('dispose',()=>disposed++);meshB.geometry.addEventListener('dispose',()=>other++);texture.addEventListener('dispose',()=>textureDisposed++);
  a.dispose();a.dispose();assert.equal(disposed,1);assert.equal(other,0);assert.equal(textureDisposed,0);assert.equal(a.group.parent,null);
  b.dispose();
});

test('Prepared BO2 sentry export keeps its animation tags, local PNG textures and provenance hashes',skipUnlessAssets('streaks/provenance.json'),()=>{
  const dir=path.resolve('public/assets/streaks'),provenance=JSON.parse(fs.readFileSync(path.join(dir,'provenance.json'),'utf8'));
  assert.equal(provenance.sourceModel,'t6_wpn_turret_sentry_gun');assert.match(provenance.archive,/common_mp\.ff$/);
  const file=fs.readFileSync(path.join('public',provenance.model));
  assert.equal(file.readUInt32LE(8),file.length);assert.equal(crypto.createHash('sha256').update(file).digest('hex'),provenance.modelSha256);
  const gltf=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12))),names=new Set(gltf.nodes.map(node=>node.name));
  for(const tag of ['tag_origin','tag_aim','tag_aim_pitch','tag_flash'])assert.ok(names.has(tag),tag);
  assert.ok(gltf.skins.length&&gltf.meshes.length);assert.ok(gltf.materials.every(material=>!material.normalTexture&&!material.pbrMetallicRoughness.metallicRoughnessTexture));
  assert.equal(gltf.images.length,provenance.textures.length);
  for(const image of gltf.images){
    assert.equal(path.basename(image.uri),image.uri);assert.match(image.uri,/\.png$/);
    const data=fs.readFileSync(path.join(dir,image.uri));assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(data.readUInt32BE(16)<=1024&&data.readUInt32BE(20)<=1024);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),provenance.textures.find(item=>item.file===image.uri).sha256);
  }
});

test('Game wires the BO2 sentry in solo and network paths without changing gameplay constants',()=>{
  const game=fs.readFileSync('src/game.js','utf8');
  assert.match(game,/createSentryModel/);assert.match(game,/time:25,cooldown:0/);assert.match(game,/origin\.distanceTo\(to\)>40/);assert.match(game,/sentry\.cooldown=\.2/);
  assert.match(game,/tickNetworkSentries/);
});
