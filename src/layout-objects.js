import * as T from 'three';

// This same geometry feeds rendering and server/client cover. Layout edits do
// not introduce invisible barriers or client-only paths through solid props.
// District packs keep only nearby props; each carries its original array position as
// `index`, which is what hiddenProps refers to.
export function layoutInstances(data,layout){
  const hidden=new Set(layout?.hiddenProps||[]);
  const instances=data.instances.filter((instance,i)=>!hidden.has(instance.index??i)).map(instance=>({...instance,solid:true}));
  for(const item of layout?.placements||[]){
    if(!item.prefabId.startsWith('wow:'))continue;
    const model=Number(item.prefabId.slice(4));
    if(!Number.isInteger(model)||!data.models[model])continue;
    instances.push({model,position:item.position,rotation:[0,Math.sin(item.rotation/2),0,Math.cos(item.rotation/2)],scale:item.scale,solid:item.solid,placementId:item.id});
  }
  return instances;
}

const part=(size,position,color=0x796448,kind='box')=>({size,position,color,kind});
export function prefabParts(id){
  if(id==='crate')return [part([1.5,1.4,1.5],[0,.7,0]),...[-.52,.52].map(x=>part([.08,1.44,1.54],[x,.7,0],0x343c3e))];
  if(id==='barricade')return [part([3,.22,.35],[0,.35,0]),part([3,.22,.35],[0,1.04,0]),...[-1.3,1.3].map(x=>part([.16,1.2,.35],[x,.6,0],0x343c3e))];
  if(id==='cart')return [part([2.6,.18,1.25],[0,.55,0]),part([1.3,.84,1.1],[0,1.02,0]),...[-1,1].flatMap(x=>[-.64,.64].map(z=>part([.65,.15,.65],[x,.34,z],0x30373b,'wheel')))];
  if(id.startsWith('machine:'))return [part([1.05,2.65,.9],[0,1.325,0],0x586671)];
  return [];
}

export function createLayoutPrefab(item){
  const group=new T.Group();group.name='Placed '+item.prefabId;group.userData.placementId=item.id;
  for(const piece of prefabParts(item.prefabId)){
    const geometry=piece.kind==='wheel'?new T.CylinderGeometry(piece.size[0]/2,piece.size[0]/2,piece.size[1],12):new T.BoxGeometry(...piece.size);
    const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:piece.color,side:T.DoubleSide}));
    mesh.position.fromArray(piece.position);if(piece.kind==='wheel')mesh.rotation.x=Math.PI/2;group.add(mesh);
  }
  group.position.fromArray(item.position);group.rotation.y=item.rotation;group.scale.setScalar(item.scale);group.updateMatrixWorld(true);
  return group;
}

export function appendObjectGeometry(group,positions,indices){
  group.updateMatrixWorld(true);const v=new T.Vector3();
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const geometry=mesh.geometry,base=positions.length/3,attribute=geometry.attributes.position;
    for(let i=0;i<attribute.count;i++){v.fromBufferAttribute(attribute,i).applyMatrix4(mesh.matrixWorld);positions.push(v.x,v.y,v.z);}
    if(geometry.index)for(const i of geometry.index.array)indices.push(base+i);
    else for(let i=0;i<attribute.count;i++)indices.push(base+i);
  });
}
export function disposeLayoutObject(group){group.traverse(mesh=>{mesh.geometry?.dispose();for(const material of [].concat(mesh.material||[]))material.dispose();});}

export function appendLayoutCollision(layout,positions,indices,shotPositions,shotIndices){
  for(const item of layout?.placements||[]){
    if(item.prefabId.startsWith('wow:')||!item.solid)continue;
    const group=createLayoutPrefab(item);
    appendObjectGeometry(group,positions,indices);appendObjectGeometry(group,shotPositions,shotIndices);disposeLayoutObject(group);
  }
}
