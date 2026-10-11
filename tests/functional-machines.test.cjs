const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(imported,pack=false){
  const T=await import('three'),{SurvivalWorld}=await import('../src/survival-world.js'),{clonePerkModel}=await import('../src/perk-models.js'),{installStaticCoverRaycast}=await import('../src/engine/static-cover-raycast.js');
  const scene=new T.Scene(),nav={nodes:[],reachable:[],nearest:()=>null},template=new T.Group(),texture=new T.Texture();
  template.add(new T.Mesh(new T.BoxGeometry(1,2,.5),new T.MeshStandardMaterial({map:texture})));
  let copies=0,textureDisposals=0,geometryDisposals=0;texture.addEventListener('dispose',()=>textureDisposals++);
  const env=new SurvivalWorld({scene,nav,spawn:new T.Vector3(),machineFactory:(id,dimensions)=>{
    if(!imported)return null;copies++;const result=clonePerkModel(template,{id,...dimensions});
    result.group.traverse(object=>object.geometry?.addEventListener('dispose',()=>geometryDisposals++));return result;
  }});
  env.machinePlacement=()=>{
    const mesh=new T.Group();mesh.position.set(3,1,-4);mesh.rotation.y=.6;
    return {node:{point:new T.Vector3(2,1,-3)},mesh,collider:{mesh,width:pack?1.02:.88,height:2.8,depth:pack?.78:.8,open:false}};
  };
  const perk={id:pack?'pack-a-punch':'juggernog',name:pack?'Pack-a-Punch':'Juggernog',cost:pack?5000:2500,zone:0,color:'#d94a42'};
  assert.equal(env.addMachine(perk,pack),true);installStaticCoverRaycast(env.machines[0].mesh);
  const clean=()=>{env.dispose();template.children[0].geometry.dispose();template.children[0].material.dispose();texture.dispose();};
  return {T,env,perk,scene,clean,get copies(){return copies;},get textureDisposals(){return textureDisposals;},get geometryDisposals(){return geometryDisposals;}};
}

test('Functional imported perks and fallback cabinets have identical shot and movement footprints',async()=>{
  for(const pack of [false,true]){
    const imported=await fixture(true,pack),fallback=await fixture(false,pack);
    try{
      const {T}=imported,a=imported.env.machineColliders[0],b=fallback.env.machineColliders[0];
      assert.deepEqual([a.width,a.height,a.depth],[b.width,b.height,b.depth]);
      for(const x of [0,a.width*.48,a.width*.65])for(const y of [.025,1.4,2.79,2.9]){
        const from=new T.Vector3(x,y,2).applyMatrix4(a.mesh.matrixWorld),to=new T.Vector3(x,y,-2).applyMatrix4(a.mesh.matrixWorld),direction=to.clone().sub(from).normalize();
        const first=new T.Raycaster(from,direction,0,4).intersectObject(a.mesh,true),second=new T.Raycaster(from,direction,0,4).intersectObject(b.mesh,true);
        assert.equal(first.length,second.length);assert.equal(first.length>0,Math.abs(x)<a.width/2&&y<a.height);
        if(first.length){assert.equal(first[0].object.name,'Machine collision proxy');assert.ok(Math.abs(first[0].distance-second[0].distance)<1e-8);}
        assert.equal(imported.env.isMoveBlocked(from,to,.1),fallback.env.isMoveBlocked(from,to,.1));
      }
      assert.equal(imported.copies,1);assert.equal(fallback.copies,0);
    }finally{imported.clean();fallback.clean();}
  }
});

test('Functional model replacement preserves perk/upgrade interaction metadata and owns cleanup',async()=>{
  for(const pack of [false,true]){
    const f=await fixture(true,pack);
    try{
      const interaction=f.env.machines[0];assert.equal(f.env.interactions[0],interaction);assert.equal(interaction.type,pack?'pack':'perk');assert.equal(interaction.cost,f.perk.cost);assert.equal(interaction.perkId,pack?undefined:'juggernog');assert.equal(f.env.nearestInteraction(interaction.position),interaction);
      assert.equal(interaction.mesh.getObjectByName('Machine collision proxy').visible,false);
      f.env.dispose();assert.equal(f.geometryDisposals,1);assert.equal(f.textureDisposals,0);assert.equal(f.env.machineVisuals.length,0);assert.equal(f.scene.children.length,0);
      f.env.dispose();assert.equal(f.geometryDisposals,1);
    }finally{f.clean();}
  }
});
