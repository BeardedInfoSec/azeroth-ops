import {PLAYER_EYE_HEIGHT} from './player-config.js';
// Zeppelin cruises well above rooftops so the drop is a real descent.
export const FLIGHT_CLEARANCE=120,GLIDE_DESCENT=10;
const xyz=p=>Array.isArray(p)?p:[p.x,p.y,p.z];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Navigation points are ground coordinates; flight and glide positions are eyes.
export function createRoyalePlan(groundPoints,origin){
  const points=groundPoints.map(xyz);if(!points.length)throw Error('Battle royale requires safe ground');
  const desired=xyz(origin||points[0]);
  const center=points.reduce((a,b)=>Math.hypot(b[0]-desired[0],b[2]-desired[2])<Math.hypot(a[0]-desired[0],a[2]-desired[2])?b:a).slice();
  const radius=clamp(Math.max(...points.map(p=>Math.hypot(p[0]-center[0],p[2]-center[2]))),36,48);
  const altitude=Math.max(...points.map(p=>p[1]))+FLIGHT_CLEARANCE+PLAYER_EYE_HEIGHT;
  return {center,initialRadius:radius,flight:{start:[center[0]-radius,altitude,center[2]],end:[center[0]+radius,altitude,center[2]],duration:18},stages:[
    {hold:25,shrink:25,radius:radius*.75,damage:2},
    {hold:20,shrink:25,radius:radius*.5,damage:4},
    {hold:15,shrink:20,radius:radius*.25,damage:8},
    {hold:10,shrink:20,radius:0,damage:20},
  ]};
}
export function flightAt(plan,elapsed){const f=plan.flight,t=clamp(elapsed/f.duration,0,1);return {...f,start:f.start.slice(),end:f.end.slice(),position:f.start.map((v,i)=>v+(f.end[i]-v)*t)};}
export function zoneAt(plan,elapsed){
  let time=Math.max(0,elapsed-plan.flight.duration),radius=plan.initialRadius;
  for(let i=0;i<plan.stages.length;i++){
    const s=plan.stages[i];
    if(time<s.hold+s.shrink){const progress=clamp((time-s.hold)/s.shrink,0,1);return {center:plan.center.slice(),radius:radius+(s.radius-radius)*progress,nextRadius:s.radius,stage:i+1,timeToShrink:Math.max(0,s.hold-time),timeToClose:Math.max(0,s.hold+s.shrink-time),damage:s.damage,shrinking:time>=s.hold};}
    time-=s.hold+s.shrink;radius=s.radius;
  }
  return {center:plan.center.slice(),radius:0,nextRadius:0,stage:plan.stages.length+1,timeToShrink:0,timeToClose:0,damage:40,shrinking:false};
}
export function royaleState(plan,elapsed){return {phase:elapsed<plan.flight.duration?'flight':'combat',elapsed:Math.max(0,elapsed),flight:flightAt(plan,elapsed),zone:zoneAt(plan,elapsed)};}
export function advanceGlide(position,groundPoint,dt){
  const p=xyz(position),ground=xyz(groundPoint),floor=ground[1]+PLAYER_EYE_HEIGHT,y=Math.max(floor,p[1]-GLIDE_DESCENT*Math.max(0,dt));
  const landed=y<=floor;return {position:landed?[ground[0],floor,ground[2]]:[p[0],y,p[2]],landed};
}
