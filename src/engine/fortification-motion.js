import {Vector3} from 'three';
const EPS=.001;
function frame(wall,p){
  const c=Math.cos(wall.mesh.rotation.y),s=Math.sin(wall.mesh.rotation.y),x=p.x-wall.mesh.position.x,z=p.z-wall.mesh.position.z;
  return {x:c*x-s*z,y:p.y-wall.mesh.position.y,z:s*x+c*z,c,s};
}
function worldNormal(local,c,s){return new Vector3(c*local.x+s*local.z,local.y,-s*local.x+c*local.z);}
function sweep(origin,delta,min,max,axes){
  let enter=0,leave=1,normal=new Vector3();
  for(const axis of axes){
    if(Math.abs(delta[axis])<1e-10){if(origin[axis]<min[axis]||origin[axis]>max[axis])return null;continue;}
    let near=(min[axis]-origin[axis])/delta[axis],far=(max[axis]-origin[axis])/delta[axis],sign=-1;
    if(near>far){[near,far]=[far,near];sign=1;}
    if(near>=enter){enter=near;normal.set(0,0,0);normal[axis]=sign;}
    leave=Math.min(leave,far);if(enter>leave)return null;
  }
  return enter<=1&&leave>=0?{time:enter,normal}:null;
}
function inside(p,min,max,axes){return axes.every(axis=>p[axis]>min[axis]&&p[axis]<max[axis]);}
function exitFace(p,min,max,axes){
  let depth=Infinity,normal=new Vector3();
  for(const axis of axes)for(const sign of [-1,1]){const d=sign<0?p[axis]-min[axis]:max[axis]-p[axis];if(d<depth){depth=d;normal.set(0,0,0);normal[axis]=sign;}}
  return {depth,normal};
}

// Navigation uses a swept point with padding, rather than an eye-height capsule.
// A point already penetrating a boundary may leave through its nearest face.
export function blocksFortificationMove(from,to,colliders,padding=.32){
  const radius=Math.max(0,padding);
  for(const wall of colliders){
    if(wall.open)continue;const a=frame(wall,from),b=frame(wall,to),d=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z);
    const min={x:-wall.width/2-radius,y:-radius,z:-wall.depth/2-radius},max={x:wall.width/2+radius,y:wall.height+radius,z:wall.depth/2+radius};
    if(inside(a,min,max,['x','y','z'])){const face=exitFace(a,min,max,['x','y','z']);if(d.dot(face.normal)>0)continue;return true;}
    if(sweep(a,d,min,max,['x','y','z']))return true;
  }
  return false;
}

export function resolveFortificationMove(fromEyes,toEyes,colliders,radius=.32,height=2.45){
  radius=Math.max(0,radius);height=Math.max(0,height);
  const result=fromEyes.clone(),requested=toEyes.clone().sub(fromEyes);requested.y=0;
  const overlaps=(wall,y)=>y>wall.mesh.position.y+EPS&&y-height<wall.mesh.position.y+wall.height-EPS;
  const bounds=wall=>({min:{x:-wall.width/2-radius,z:-wall.depth/2-radius},max:{x:wall.width/2+radius,z:wall.depth/2+radius}});
  function depenetrate(){
    for(let pass=0;pass<12;pass++){
      let moved=false;
      for(const wall of colliders){if(wall.open||!overlaps(wall,result.y))continue;const p=frame(wall,result),{min,max}=bounds(wall);if(!inside(p,min,max,['x','z']))continue;
        const exit=exitFace(p,min,max,['x','z']);result.addScaledVector(worldNormal(exit.normal,p.c,p.s),exit.depth+EPS);moved=true;
      }
      if(!moved)break;
    }
  }
  // Recovery from a city-collision push must work even with no movement input.
  depenetrate();
  for(let pass=0;pass<5&&requested.lengthSq()>1e-12;pass++){
    let hit=null;
    for(const wall of colliders){
      if(wall.open||(!overlaps(wall,result.y)&&!overlaps(wall,toEyes.y)))continue;
      const p=frame(wall,result),localEnd=frame(wall,result.clone().add(requested)),delta=new Vector3(localEnd.x-p.x,0,localEnd.z-p.z),{min,max}=bounds(wall),contact=sweep(p,delta,min,max,['x','z']);
      if(contact&&contact.normal.lengthSq()>0&&(!hit||contact.time<hit.time))hit={time:contact.time,normal:worldNormal(contact.normal,p.c,p.s)};
    }
    if(!hit){result.add(requested);requested.set(0,0,0);break;}
    const fraction=Math.max(0,hit.time-EPS/Math.max(EPS,requested.length()));result.addScaledVector(requested,fraction);requested.multiplyScalar(1-hit.time);
    const inward=requested.dot(hit.normal);if(inward<0)requested.addScaledVector(hit.normal,-inward);else break;
  }
  result.y=toEyes.y;depenetrate();return result;
}
