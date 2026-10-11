import * as THREE from 'three';
// Reusable capsule solver independent of cameras, input, factions and rendering.
export class CharacterCollision{
  constructor(height,radius){this.height=height;this.radius=radius;this.segment=new THREE.Line3();this.bounds=new THREE.Box3();this.trianglePoint=new THREE.Vector3();this.capsulePoint=new THREE.Vector3();this.triangleNormal=new THREE.Vector3();this.push=new THREE.Vector3();this.grounded=false;this.ceiling=false;}
  resolve(position,collider){
    const {segment,bounds,trianglePoint,capsulePoint,triangleNormal,push,radius,height}=this;
    this.grounded=this.ceiling=false;segment.start.copy(position).y-=radius;segment.end.copy(position).y-=height-radius;
    bounds.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
    collider.geometry.boundsTree.shapecast({intersectsBounds:box=>box.intersectsBox(bounds),intersectsTriangle:triangle=>{
      const distance=triangle.closestPointToSegment(segment,trianglePoint,capsulePoint);
      if(distance<=radius+1e-6){
        push.subVectors(capsulePoint,trianglePoint);if(push.lengthSq()<1e-12)return;push.normalize();
        triangle.getNormal(triangleNormal);
        const walkable=push.y>=.65&&Math.abs(triangleNormal.y)>=.65;
        if(walkable)this.grounded=true;if(push.y<=-.65)this.ceiling=true;
        if(distance<radius){
          // Resolve floor penetration vertically: following the slope normal
          // would turn gravity and ground snapping into downhill input.
          // Requiring a walkable face keeps rounded wall edges from climbing.
          const depth=radius-distance;
          if(walkable)push.set(0,depth/push.y,0);else push.multiplyScalar(depth);
          segment.start.add(push);segment.end.add(push);
        }
      }
    }});
    return segment.start.clone().add(new THREE.Vector3(0,radius,0)).sub(position);
  }
}
