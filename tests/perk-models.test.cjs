const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

test('Machine instances fit the collision box, stay grounded, and share only immutable textures',async()=>{
  const T=await import('three'),{clonePerkModel}=await import('../src/perk-models.js');
  const texture=new T.Texture(),material=new T.MeshStandardMaterial({map:texture}),geometry=new T.BoxGeometry(4,8,3),scene=new T.Group();
  const mesh=new T.Mesh(geometry,material);mesh.position.set(7,9,-4);scene.add(mesh);
  const first=clonePerkModel(scene,{id:'test',width:1,height:3,depth:1}),second=clonePerkModel(scene,{id:'test',width:1,height:3,depth:1});
  const bounds=new T.Box3().setFromObject(first.group),size=bounds.getSize(new T.Vector3());
  assert.ok(size.x<=1.000001&&size.y<=3.000001&&size.z<=1.000001);assert.ok(Math.abs(bounds.min.y)<1e-8);
  assert.ok(Math.abs(bounds.getCenter(new T.Vector3()).x)<1e-8&&Math.abs(bounds.getCenter(new T.Vector3()).z)<1e-8);
  const a=first.group.children[0].children[0],b=second.group.children[0].children[0];
  assert.notEqual(a.geometry,geometry);assert.notEqual(a.material,material);assert.notEqual(a.geometry,b.geometry);assert.equal(a.material.map,texture);
  let geometryDisposals=0,textureDisposals=0,otherDisposals=0;
  a.geometry.addEventListener('dispose',()=>geometryDisposals++);texture.addEventListener('dispose',()=>textureDisposals++);b.geometry.addEventListener('dispose',()=>otherDisposals++);
  first.dispose();first.dispose();assert.equal(geometryDisposals,1);assert.equal(textureDisposals,0);assert.equal(otherDisposals,0);
  second.dispose();geometry.dispose();material.dispose();texture.dispose();
});

test('Decorative machine triangles are excluded from shot raycasts',async()=>{
  const T=await import('three'),{clonePerkModel}=await import('../src/perk-models.js'),scene=new T.Group();
  scene.add(new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial()));
  const instance=clonePerkModel(scene,{id:'test'});instance.group.updateMatrixWorld(true);
  const hits=new T.Raycaster(new T.Vector3(0,.4,5),new T.Vector3(0,0,-1)).intersectObject(instance.group,true);
  assert.equal(hits.length,0);instance.dispose();scene.children[0].geometry.dispose();scene.children[0].material.dispose();
});

test('All twelve perks and Pack-a-Punch resolve to prepared genuine BO2 models and local PNGs',async()=>{
  const {ZOMBIE_PERKS}=await import('../src/zombie-upgrades.mjs'),dir=path.resolve('public/assets/machines');
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  assert.deepEqual(Object.keys(manifest.machines).sort(),[...ZOMBIE_PERKS.map(perk=>perk.id),'pack-a-punch'].sort());
  for(const entry of Object.values(manifest.machines)){
    assert.match(entry.model,/^\/assets\/machines\/[^/]+\.glb$/);assert.match(entry.sourceArchive,/^zm_\w+\.ff$/);
    const file=fs.readFileSync(path.join('public',entry.model));assert.equal(file.readUInt32LE(8),file.length);
    const gltf=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)));assert.ok(gltf.meshes.length);
    for(const image of gltf.images){
      assert.equal(path.basename(image.uri),image.uri);const header=Buffer.alloc(24),fd=fs.openSync(path.join(dir,image.uri),'r');
      try{fs.readSync(fd,header,0,24,0);}finally{fs.closeSync(fd);}
      assert.equal(header.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(header.readUInt32BE(16)<=1024&&header.readUInt32BE(20)<=1024);
    }
    assert.ok(gltf.materials.every(material=>!material.normalTexture));
  }
});

test('Both knife exports retain original BO2 geometry and valid local texture references',()=>{
  for(const name of ['t6_wpn_knife_base_view_lod0','t6_wpn_knife_melee_lod0']){
    const file=fs.readFileSync('public/assets/weapons/'+name+'.glb'),gltf=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)));
    assert.equal(file.readUInt32LE(8),file.length);assert.ok(gltf.meshes.length);
    for(const image of gltf.images)assert.ok(fs.existsSync('public/assets/weapons/'+image.uri));
  }
});
