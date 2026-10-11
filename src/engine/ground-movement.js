export const GROUND_MOVEMENT=Object.freeze({jumpSpeed:7,gravity:20,stepUp:.4,snapDown:.14,walkableNormal:.65,jumpBuffer:.12,coyoteTime:.1});

/** Keep a grounded capsule on nearby walkable slopes without snapping a jump. */
export function groundStepHeight(position,next,{grounded,vertical,floorAt,height=2.45}={}){
  if(!grounded||vertical>0)return null;
  const feet=position.y-height,hit=floorAt(next.x,next.z,feet+GROUND_MOVEMENT.stepUp+.01,GROUND_MOVEMENT.stepUp+GROUND_MOVEMENT.snapDown+.02);
  if(!hit||!hit.face?.normal||hit.face.normal.y<GROUND_MOVEMENT.walkableNormal)return null;
  const change=hit.point.y-feet;
  return change<=GROUND_MOVEMENT.stepUp+.001&&change>=-GROUND_MOVEMENT.snapDown-.001?hit.point.y+height:null;
}

/** A press just before landing or leaving a slope is retained briefly. */
export class GroundJump {
  constructor(){this.reset();}
  reset(){this.queuedUntil=-Infinity;this.lastGrounded=-Infinity;}
  press(now){if(Number.isFinite(now))this.queuedUntil=now+GROUND_MOVEMENT.jumpBuffer;}
  update(now,{grounded,vertical=0,enabled=true}={}){
    if(!enabled||!Number.isFinite(now)){this.reset();return null;}
    if(grounded&&vertical<=0)this.lastGrounded=now;
    if(this.queuedUntil>=now&&now-this.lastGrounded<=GROUND_MOVEMENT.coyoteTime){
      this.queuedUntil=this.lastGrounded=-Infinity;
      return GROUND_MOVEMENT.jumpSpeed;
    }
    return null;
  }
}
