import {Box3, Matrix4, Ray, SkinnedMesh, Sphere, Vector3} from 'three';

const geometries=new WeakMap(),states=new WeakMap();
const nativeRaycast=SkinnedMesh.prototype.raycast;

// Only indexed vertices can be hit. Cache their influence bounds on the shared
// geometry, not on a particular skeleton, bind matrix, or animation pose.
export function prepareSkinnedRaycastGeometry(geometry){
  const attributes=[geometry.attributes.position,geometry.attributes.skinIndex,geometry.attributes.skinWeight,geometry.index];
  const cached=geometries.get(geometry);
  if(cached&&attributes.every((a,i)=>a===cached.attributes[i]&&(a?.version||0)===cached.versions[i]))return cached;
  const record={attributes,versions:attributes.map(a=>a?.version||0),bones:new Map(),minSum:Infinity,maxSum:0,supported:true};
  geometries.set(geometry,record);
  const [position,indices,weights,index]=attributes;
  if(!position||!indices||!weights||Object.keys(geometry.morphAttributes).length){record.supported=false;return record;}
  const used=index?new Set(index.array):Array.from({length:position.count},(_,i)=>i),point=new Vector3();
  for(const vertex of used){
    point.fromBufferAttribute(position,vertex);let sum=0;
    if(![point.x,point.y,point.z].every(Number.isFinite)){record.supported=false;break;}
    for(let component=0;component<4;component++){
      const weight=weights.getComponent(vertex,component),bone=indices.getComponent(vertex,component);
      if(!Number.isFinite(weight)||weight<0||!Number.isInteger(bone)||bone<0){record.supported=false;break;}
      sum+=weight;if(weight===0)continue;
      let bounds=record.bones.get(bone);if(!bounds){bounds=new Box3();record.bones.set(bone,bounds);}bounds.expandByPoint(point);
    }
    record.minSum=Math.min(record.minSum,sum);record.maxSum=Math.max(record.maxSum,sum);
  }
  if(!Number.isFinite(record.minSum)||!Number.isFinite(record.maxSum))record.supported=false;
  return record;
}

function optimizedRaycast(raycaster,hits){
  const data=prepareSkinnedRaycastGeometry(this.geometry);
  if(!data.supported){this.boundingSphere=null;this.boundingBox=null;return nativeRaycast.call(this,raycaster,hits);}
  let state=states.get(this);
  if(!state){state={local:new Box3(),part:new Box3(),world:new Box3(),matrix:new Matrix4(),ray:new Ray(),point:new Vector3()};states.set(this,state);}
  const {local,part,world,matrix,ray,point}=state;local.makeEmpty();
  for(const [index,bounds] of data.bones){
    const bone=this.skeleton.bones[index],inverse=this.skeleton.boneInverses[index];
    if(!bone||!inverse){this.boundingSphere=null;this.boundingBox=null;return nativeRaycast.call(this,raycaster,hits);}
    matrix.multiplyMatrices(bone.matrixWorld,inverse).multiply(this.bindMatrix);
    local.union(part.copy(bounds).applyMatrix4(matrix));
  }
  // Each weighted vertex is sum(weights) times a convex combination of its
  // transformed influences. Interval multiplication handles sums other than 1,
  // including an all-zero vertex, without assuming normalized imported data.
  if(local.isEmpty())local.set(new Vector3(),new Vector3());
  for(const axis of ['x','y','z']){
    const a=local.min[axis],b=local.max[axis],lo=data.minSum,hi=data.maxSum;
    local.min[axis]=Math.min(a*lo,a*hi,b*lo,b*hi);local.max[axis]=Math.max(a*lo,a*hi,b*lo,b*hi);
  }
  local.applyMatrix4(this.bindMatrixInverse).expandByScalar(1e-6);
  world.copy(local).applyMatrix4(this.matrixWorld);
  ray.copy(raycaster.ray).recast(raycaster.near);
  if(!world.containsPoint(ray.origin)){
    if(!ray.intersectBox(world,point)||point.distanceTo(ray.origin)>raycaster.far-raycaster.near+1e-6)return;
  }
  // Keep the original triangle intersection and hit metadata. Supply a safe
  // sphere so native raycast need not skin every vertex just to reject bounds.
  this.boundingSphere ||= new Sphere();local.getBoundingSphere(this.boundingSphere);
  if(this.boundingBox)this.boundingBox.copy(local);
  return nativeRaycast.call(this,raycaster,hits);
}

export function installSkinnedRaycast(root){
  root.traverse(mesh=>{if(mesh.isSkinnedMesh){prepareSkinnedRaycastGeometry(mesh.geometry);mesh.raycast=optimizedRaycast;}});
  return root;
}
