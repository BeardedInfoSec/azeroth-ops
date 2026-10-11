import * as THREE from 'three';
// One nearest-impact rule for aiming, bullets and line-of-sight checks.
export function traceShot(origin,target,collider,actors=[]){
  const direction=target.clone().sub(origin),distance=direction.length();
  if(distance<1e-6)return {point:origin.clone(),blocked:false,hit:null};
  const ray=new THREE.Raycaster(origin,direction.divideScalar(distance),0,distance+.001);ray.firstHitOnly=true;
  const wall=ray.intersectObject(collider)[0];
  if(wall)ray.far=Math.min(ray.far,wall.distance+.001);
  const hit=ray.intersectObjects(actors,true)[0];
  const blocked=!!wall&&(!hit||wall.distance<=hit.distance+.001);
  return {point:(blocked?wall:hit)?.point.clone()||target.clone(),blocked,hit:blocked?null:hit||null};
}
export function shotBlocked(origin,target,collider){return traceShot(origin,target,collider).blocked;}
