// Data-driven firing modes shared by the client (solo, undead, LAN prediction) and the authoritative servers.
// Pure maths, no three.js: directions are plain [x,y,z] arrays so server and client use the same pellet pattern code.
//
// weapon-data.js supplies class, fireMode ('auto'|'semi'|'burst'|'pump'|'bolt'), pellets, interval, cycle,
// reload timings (including reloadStart/reloadPerShell/reloadEnd for shell reloads), hipSpread and adsSpread.
// It does not supply burst length or the per-class handling limits, so those live here:

export const MAX_PELLETS=16;        // hard cap on rays traced per shot message, whatever the data or client says
export const MAX_TRACERS=3;         // shotguns draw at most this many tracers per shot (performance)
export const FIRE_MODES=Object.freeze(['auto','semi','burst','pump','bolt']);

// Burst settings by gun id. count = rounds per trigger press; the gap between rounds in a burst is gun.interval;
// cooldown = seconds after the last round of a burst before the next burst may start.
export const BURST={sig556_mp:{count:3,cooldown:.26}};
const DEFAULT_BURST={count:3,cooldown:.26};

// Hipfire spread cap (degrees) and view kick added per shot, by class. AR matches the original rifle tuning
// (0.55 deg, 0.003) and snipers the original bolt tuning (2 deg, 0.009); the others are new per-class values.
export const HANDLING=Object.freeze({
  ar:{hipCap:.55,kick:.003},
  smg:{hipCap:.7,kick:.0025},
  lmg:{hipCap:1.1,kick:.0035},
  pistol:{hipCap:.6,kick:.004},
  shotgun:{hipCap:.55,kick:.008},
  sniper:{hipCap:2,kick:.009}
});
export function handlingFor(gun){
  if(gun?.bolt)return HANDLING.sniper;
  return HANDLING[gun?.class]||HANDLING.ar;
}

export function fireModeOf(gun){
  if(gun?.bolt)return 'bolt';
  return FIRE_MODES.includes(gun?.fireMode)&&gun.fireMode!=='bolt'?gun.fireMode:'auto';
}
export function burstOf(gun){
  const b=BURST[gun?.id]||DEFAULT_BURST,count=Number.isInteger(gun?.burstCount)?gun.burstCount:b.count;
  return {count:Math.max(2,Math.min(8,count)),cooldown:Number.isFinite(gun?.burstCooldown)?gun.burstCooldown:b.cooldown};
}
export const isShellReload=gun=>Number.isFinite(gun?.reloadPerShell)&&gun.reloadPerShell>0;
// Shell timings follow gun.reload (perks, racial traits and attachments scale reload) so every scaling path applies.
export function shellTimings(gun,empty=false){
  const k=gun.reload/gun.reloadPerShell;
  return {start:(gun.reloadStart||0)*k,perShell:gun.reloadPerShell*k,end:((empty&&Number.isFinite(gun.reloadEndEmpty)?gun.reloadEndEmpty:gun.reloadEnd)||0)*k};
}

export const pelletCount=gun=>Math.max(1,Math.min(MAX_PELLETS,Math.floor(Number(gun?.pellets))||1));
export const tracerCount=gun=>Math.min(MAX_TRACERS,pelletCount(gun));

// Half-angle of the pellet cone. Hipfire uses half of gun.hipSpread and ADS half of gun.adsSpread
// (R870: 3 deg hip, 1 deg ADS), scaled by the same 50% movement bloom as the single-bullet spread.
export const PELLET_CONE_SCALE=.5;
export function pelletConeDegrees(gun,ads=0,speed=0){
  if(pelletCount(gun)<2)return 0;
  const hip=(gun.hipSpread||0)*PELLET_CONE_SCALE,aimed=(gun.adsSpread||0)*PELLET_CONE_SCALE,a=Math.min(Math.max(ads,0),1);
  const moving=1+Math.min(Math.max(speed,0)/5.2,1)*.5;
  return (aimed+(hip-aimed)*(1-a)**2)*(a<1?moving:1);
}
// Tangent-plane offsets for each pellet: stratified radius, golden-angle rotation from a random start.
export function pelletOffsets(count,coneDegrees,rng=Math.random){
  const out=[],max=Math.tan(coneDegrees*Math.PI/180),start=rng()*Math.PI*2;
  for(let i=0;i<count;i++){const r=max*Math.sqrt((i+rng())/count),a=start+i*2.399963229728653;out.push({x:Math.cos(a)*r,y:Math.sin(a)*r});}
  return out;
}
// Rotate a unit direction by a tangent offset and renormalise. No offset returns the input untouched.
export function offsetDirection(dir,x,y){
  if(!x&&!y)return dir.slice();
  let rx=dir[2],ry=0,rz=-dir[0],len=Math.hypot(rx,rz);
  if(len<1e-6){rx=1;ry=0;rz=0;len=1;}
  rx/=len;rz/=len;
  const ux=dir[1]*rz-dir[2]*ry,uy=dir[2]*rx-dir[0]*rz,uz=dir[0]*ry-dir[1]*rx;
  const nx=dir[0]+rx*x+ux*y,ny=dir[1]+ry*x+uy*y,nz=dir[2]+rz*x+uz*y,n=Math.hypot(nx,ny,nz)||1;
  return [nx/n,ny/n,nz/n];
}
// All pellet directions for one shot. Single-bullet guns return the aim direction unchanged and consume no RNG.
export function pelletDirections(gun,dir,{ads=0,speed=0,rng=Math.random}={}){
  const n=pelletCount(gun);
  if(n<2)return [dir.slice()];
  return pelletOffsets(n,pelletConeDegrees(gun,ads,speed),rng).map(o=>offsetDirection(dir,o.x,o.y));
}
