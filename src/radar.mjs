export const RADAR_SHOT_MS=2000;

// A shot reveals its location, not a moving opponent's subsequent position.
export function recordRadarShot(unit,position,now=performance.now()){
  if(!unit?.alive||!position||![position.x,position.y,position.z,now].every(Number.isFinite))return;
  unit.radarShot={position:[position.x,position.y,position.z],at:now,spawn:unit.networkSpawn};
}

export function radarContact(unit,{uav=false,now=performance.now()}={}){
  if(!unit.alive){unit.radarShot=null;return null;}
  if(uav)return {position:unit.mesh.position.toArray(),alpha:1};
  const shot=unit.radarShot,age=shot?now-shot.at:Infinity;
  if(!shot||shot.spawn!==unit.networkSpawn||age<0||age>=RADAR_SHOT_MS)return null;
  return {position:shot.position,alpha:1-age/RADAR_SHOT_MS};
}
