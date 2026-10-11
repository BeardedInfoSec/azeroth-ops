const test=require('node:test'),assert=require('node:assert/strict');

test('Placed BO2 machines keep exact server proxy collision while rendering owned model instances',async()=>{
  const T=await import('three'),{addLayoutProps}=await import('../src/props.js'),{appendLayoutCollision,disposeLayoutObject}=await import('../src/layout-objects.js'),{clonePerkModel}=await import('../src/perk-models.js');
  const scene=new T.Group(),template=new T.Group(),texture=new T.Texture();
  template.add(new T.Mesh(new T.BoxGeometry(8,12,5),new T.MeshBasicMaterial({map:texture})));
  const placements=[{id:'machine',prefabId:'machine:juggernog',position:[4,2,-8],rotation:.6,scale:1.3,solid:true},{id:'crate',prefabId:'crate',position:[-3,0,1],rotation:.2,scale:1,solid:true}];
  const client=[[],[],[],[]],server=[[],[],[],[]];let loads=0,textureDisposed=0;
  texture.addEventListener('dispose',()=>textureDisposed++);
  const dispose=await addLayoutProps(scene,placements,...client,{loadMachines:async()=>{loads++;},makeMachine:(id,dimensions)=>clonePerkModel(template,{id,...dimensions})});
  appendLayoutCollision({placements},...server);assert.deepEqual(client,server);assert.equal(loads,1);
  const placed=scene.children[0];assert.equal(placed.children[0].visible,false);assert.equal(placed.children[1].visible,true);assert.deepEqual(placed.position.toArray(),[4,2,-8]);assert.equal(placed.rotation.y,.6);assert.equal(placed.scale.x,1.3);
  dispose();dispose();assert.equal(placed.children.length,1);assert.equal(textureDisposed,0);
  disposeLayoutObject(scene);disposeLayoutObject(template);texture.dispose();
});

test('Missing machine assets keep visible placement fallback; non-solid markers add no cover',async()=>{
  const T=await import('three'),{addLayoutProps}=await import('../src/props.js'),{disposeLayoutObject}=await import('../src/layout-objects.js');
  const group=new T.Group(),arrays=[[],[],[],[]],item={id:'fallback',prefabId:'machine:unavailable',position:[0,0,0],rotation:0,scale:1,solid:false};
  const dispose=await addLayoutProps(group,[item],...arrays,{loadMachines:async()=>{},makeMachine:()=>null});
  assert.equal(group.children[0].children[0].visible,true);assert.deepEqual(arrays,[[],[],[],[]]);dispose();disposeLayoutObject(group);
});

test('Layouts without perk machines do not trigger any model loads',async()=>{
  const T=await import('three'),{addLayoutProps}=await import('../src/props.js'),{disposeLayoutObject}=await import('../src/layout-objects.js');
  const group=new T.Group();let loads=0;
  const dispose=await addLayoutProps(group,[{id:'crate',prefabId:'crate',position:[0,0,0],rotation:0,scale:1,solid:true}],[],[],[],[],{loadMachines:async()=>{loads++;}});
  assert.equal(loads,0);dispose();disposeLayoutObject(group);
});
