import {Vector3,Line3,Box3} from 'three';
import {PLAYER_EYE_HEIGHT,PLAYER_CROUCH_EYE_HEIGHT,PLAYER_RADIUS,playerHeightOffset} from '../player-config.js';
import {resolveFortificationMove} from './fortification-motion.js';

export function stanceEye(position,crouched){return position.clone().add(new Vector3(0,-playerHeightOffset(crouched),0));}

// Test the entire expanded head capsule, including a roof crossing its axis.
// A separation solver alone cannot reliably detect a zero-distance crossing.
const segment=new Line3(),bounds=new Box3(),trianglePoint=new Vector3(),capsulePoint=new Vector3();
export function canStandAt(position,collider,fortifications=[]){
  segment.start.copy(position).y-=PLAYER_RADIUS;
  segment.end.copy(position).y-=PLAYER_EYE_HEIGHT-PLAYER_CROUCH_EYE_HEIGHT+PLAYER_RADIUS;
  bounds.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(PLAYER_RADIUS);
  const blocked=collider.geometry.boundsTree.shapecast({
    intersectsBounds:box=>box.intersectsBox(bounds),
    intersectsTriangle:triangle=>triangle.closestPointToSegment(segment,trianglePoint,capsulePoint)<PLAYER_RADIUS-.002
  });
  if(blocked)return false;
  return resolveFortificationMove(position,position,fortifications,PLAYER_RADIUS,PLAYER_EYE_HEIGHT).distanceToSquared(position)<1e-6;
}
