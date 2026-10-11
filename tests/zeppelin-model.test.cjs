const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

async function fixture(){
  const T=await import('three'),api=await import('../src/zeppelin-model.js'),texture=new T.Texture();
  const mesh={positions:[9,5,1,11,5,1,10,5,3],normals:[0,1,0,0,1,0,0,1,0],uv:[0,0,1,0,.5,1],indices:[0,2,1]};
  const model={source:'tiny-fixture.m2',positions:[0,0,0,1,0,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,0,1],joints:Array(12).fill(0),weights:[1,0,0,0,1,0,0,0,1,0,0,0],bones:[{parent:-1,pivot:[0,0,0]}],parts:[{indices:[0,1,2],texture:'/fixture.png',blend:0,flags:0}],clips:[{name:'idle',duration:1,tracks:[{bone:0,type:'position',times:[0,1],values:[0,0,0,1,0,0],interpolation:1}]}]};
  const data={source:'fixture-horde.wmo',materials:[{texture:'/fixture.png',blend:0,flags:0}],groups:[{...mesh,batches:[{start:0,count:3,material:0}]}],models:[model],instances:[{model:0,position:[0,0,0],rotation:[0,0,0,1],scale:1}],presentation:{length:38,scale:2,yaw:Math.PI/2,deckAnchor:[10,5,2]}};
  const template=api.buildZeppelinTemplate(data,new Map([['/fixture.png',texture]]));
  return {T,api,template,texture,data};
}

test('Original transport deck stays exactly below flight eye and its bow follows local forward',async()=>{
  const {T,api,template,data}=await fixture(),model=api.instantiateZeppelin(template,{eyeHeight:2.45});
  try{
    model.group.position.set(7,80,-3);model.group.rotation.y=-.4;model.group.updateMatrixWorld(true);
    const deck=new T.Vector3(...data.presentation.deckAnchor).applyMatrix4(model.group.children[0].matrixWorld);
    assert.ok(deck.distanceTo(new T.Vector3(7,77.55,-3))<1e-9);
    const facing=new T.Vector3(1,0,0).applyQuaternion(model.group.children[0].quaternion);
    assert.ok(facing.distanceTo(new T.Vector3(0,0,-1))<1e-9);
  }finally{model.dispose();template.dispose();}
});

test('Zeppelin instances animate independently and release skeletons without destroying cached resources',async()=>{
  const {api,template,texture}=await fixture(),a=api.instantiateZeppelin(template),b=api.instantiateZeppelin(template);
  let geometryDisposals=0,textureDisposals=0;
  template.parts[0].geometry.addEventListener('dispose',()=>geometryDisposals++);texture.addEventListener('dispose',()=>textureDisposals++);
  const boneA=a.group.getObjectByName('bone_0'),boneB=b.group.getObjectByName('bone_0');assert.notEqual(boneA,boneB);
  a.update(.1);assert.ok(boneA.position.x>0);assert.equal(boneB.position.x,0);
  a.dispose();a.dispose();assert.equal(geometryDisposals,0);assert.equal(textureDisposals,0);
  const position=boneA.position.x;a.update(.1);assert.equal(boneA.position.x,position);b.update(.1);assert.ok(boneB.position.x>0);
  b.dispose();template.dispose();assert.equal(geometryDisposals,1);assert.equal(textureDisposals,1);
});

test('Named Horde export contains the full hull, all authored doodads, animation tracks, and existing original textures',async()=>{
  // Only this small named transport is read. No city, browser, GPU or image decode.
  const data=JSON.parse(fs.readFileSync('public/assets/transports/horde-zeppelin.json'));
  assert.match(data.source,/transport_horde_zeppelin\/Transport_Horde_Zeppelin\.wmo$/);assert.equal(data.groups.length,1);assert.equal(data.instances.length,7);assert.equal(data.presentation.yaw,-Math.PI/2,'stern (rudder/engine bones) sits at native +X, so the bow needs -90 degrees to lead');assert.equal(data.models.length,3);
  assert.ok(data.models.some(model=>/hordezeppel[in]+animation|hordezepanimation/i.test(model.source)&&model.clips.some(clip=>clip.tracks.length>0)));
  const textures=new Set(data.materials.map(material=>material.texture));
  for(const group of data.groups){assert.equal(group.positions.length%3,0);assert.ok(group.indices.every(index=>index>=0&&index<group.positions.length/3));for(const batch of group.batches)assert.ok(batch.start+batch.count<=group.indices.length&&batch.material<data.materials.length);}
  for(const model of data.models)for(const part of model.parts){textures.add(part.texture);assert.ok(part.indices.every(index=>index>=0&&index<model.positions.length/3));}
  // Twenty-five diffuse maps are used by the base passes; two additional
  // source maps belong to WoW secondary shader passes outside these materials.
  assert.equal(textures.size,25);
  for(const texture of textures){assert.match(texture,/^\/assets\/transports\/textures\/[a-f0-9]+\.png$/);assert.ok(fs.existsSync(path.join('public',texture)));}
  assert.equal(data.presentation.length,38);assert.ok(data.presentation.deckAnchor[1]>-20&&data.presentation.deckAnchor[1]<-15);
  const T=await import('three'),{buildZeppelinTemplate,instantiateZeppelin}=await import('../src/zeppelin-model.js');
  // Texture placeholders avoid decoding images or creating any renderer.
  const template=buildZeppelinTemplate(data,new Map([...textures].map(url=>[url,new T.Texture()]))),model=instantiateZeppelin(template);
  try{model.update(.05);model.group.updateMatrixWorld(true);const size=new T.Box3().setFromObject(model.group).getSize(new T.Vector3());assert.ok(size.toArray().every(value=>Number.isFinite(value)&&value>0&&value<100));assert.equal(model.group.children[0].children.filter(child=>child.type==='Group').length,7);}
  finally{model.dispose();template.dispose();}
});
