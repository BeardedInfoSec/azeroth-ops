// Shared melee rules use metres and a monotonic millisecond clock.
export const MELEE=Object.freeze({range:2,cooldown:.8,damage:130,playerDamage:100,coneDegrees:40});
const valid=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));

/** A knife never cancels a reload, resets a bolt, or spends ammunition. */
export function tryMelee(weapon,state,now,{alive=true,reviving=false,landed=true}={}){
  if(!weapon||!state||!Number.isFinite(now)||!alive||reviving||!landed||weapon.reloadLeft>0||weapon.cooldown>1e-6||now<(state.nextAt??-Infinity))return false;
  state.nextAt=now+MELEE.cooldown*1000;
  weapon.cooldown=Math.max(weapon.cooldown||0,MELEE.cooldown);
  weapon.ads=0;
  return true;
}

/**
 * Find the nearest body touched by a short forward knife arc. Candidates supply
 * feet positions, avoiding expensive skinned-mesh raycasts. Cover is checked
 * against the actual contact point, including partially boarded entrances.
 */
export function selectMeleeTarget({origin,direction,candidates,blocked=()=>false,range=MELEE.range}){
  if(!valid(origin)||!valid(direction)||!Number.isFinite(range)||range<=0)return null;
  const length=Math.hypot(...direction);if(length<1e-6)return null;
  const look=direction.map(v=>v/length),cos=Math.cos(MELEE.coneDegrees*Math.PI/180),hits=[];
  for(const candidate of candidates){
    if(candidate.alive===false||!valid(candidate.position)||!Number.isFinite(candidate.height)||candidate.height<=0)continue;
    const feet=candidate.position,radius=Number.isFinite(candidate.radius)?clamp(candidate.radius,.05,.6):.34;
    const point=[clamp(origin[0],feet[0]-radius,feet[0]+radius),clamp(origin[1],feet[1]+.05,feet[1]+candidate.height),clamp(origin[2],feet[2]-radius,feet[2]+radius)];
    const delta=point.map((v,i)=>v-origin[i]),distance=Math.hypot(...delta),forward=delta.reduce((sum,v,i)=>sum+v*look[i],0);
    if(distance>range||forward<0||distance>1e-6&&forward/distance<cos)continue;
    hits.push({candidate,point,distance});
  }
  hits.sort((a,b)=>a.distance-b.distance);
  for(const hit of hits)if(!blocked(origin,hit.point,hit.candidate))return hit;
  return null;
}
