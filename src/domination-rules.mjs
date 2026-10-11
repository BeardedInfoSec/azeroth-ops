// Domination rules shared by the authoritative server and the browser HUD.
// Pure functions only: no Three.js, DOM or clock access. Positions are
// ground-level {x,y,z} objects (Three.js Vector3 values qualify).
// Scoring: only owned points score. Eliminations never change the score.
export const DOMINATION={
  radius:6,           // metres, horizontal capture radius
  captureSeconds:5,   // neutral to owned with one player present
  maxCapturers:3,     // additional players beyond this add no speed
  tickSeconds:5,      // one score per owned point per tick
  heightReach:4,      // vertical reach so players above/below do not capture
  defaultTarget:200,
  targets:[100,200,300],
  ids:['A','B','C']
};
export const dominationTargets=mode=>mode==='domination'?DOMINATION.targets:[10,20,50,75];
export const defaultTarget=mode=>mode==='domination'?DOMINATION.defaultTarget:50;
export const isTeamMode=mode=>mode==='tdm'||mode==='domination';
const TEAMS=['alliance','horde'],other=t=>t==='alliance'?'horde':'alliance',sign=t=>t==='alliance'?1:-1;
const flat=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

// Choose three capture points from connected safe ground (the arena spawn
// set). They sit on the longest axis of the set, one near each end and one in
// the middle, on flat footing with plenty of safe ground around them.
export function placeCapturePoints(spawns,{radius=DOMINATION.radius,minSeparation=15}={}){
  if(!Array.isArray(spawns)||spawns.length<3)throw new Error('Domination needs at least three safe ground points');
  const n=spawns.length,cx=spawns.reduce((s,p)=>s+p.x,0)/n,cz=spawns.reduce((s,p)=>s+p.z,0)/n;
  let sxx=0,szz=0,sxz=0;for(const p of spawns){const dx=p.x-cx,dz=p.z-cz;sxx+=dx*dx;szz+=dz*dz;sxz+=dx*dz;}
  const angle=.5*Math.atan2(2*sxz,sxx-szz);let ax=Math.cos(angle),az=Math.sin(angle);
  if(ax<-1e-9||Math.abs(ax)<1e-9&&az<0){ax=-ax;az=-az;} // stable direction: A is the low-x/low-z end
  const along=p=>(p.x-cx)*ax+(p.z-cz)*az,across=p=>-(p.x-cx)*az+(p.z-cz)*ax;
  const proj=spawns.map(along),lo=Math.min(...proj),hi=Math.max(...proj),span=hi-lo;
  const quality=spawns.map(p=>{
    let near=0,drop=0;for(const q of spawns){const d=flat(p,q);if(d<=radius){near++;drop=Math.max(drop,Math.abs(q.y-p.y));}}
    return {near,drop};
  });
  const wantedNear=Math.max(...quality.map(q=>q.near))*.6;
  const chosen=[];
  for(const fraction of [.14,.5,.86]){
    const target=lo+span*fraction;let best=-1,bestScore=Infinity;
    for(let i=0;i<n;i++){
      const p=spawns[i];if(chosen.some(c=>flat(c.p,p)<minSeparation))continue;
      const q=quality[i],score=Math.abs(along(p)-target)+Math.abs(across(p))*.35+Math.max(0,wantedNear-q.near)*3+q.drop*10;
      // Strict comparison keeps the first (input order) point on ties.
      if(score<bestScore-1e-9){bestScore=score;best=i;}
    }
    if(best<0)throw new Error('Map has no room for three separated capture points');
    chosen.push({p:spawns[best],i:best});
  }
  chosen.sort((a,b)=>along(a.p)-along(b.p)||a.i-b.i);
  return chosen.map(({p},k)=>({id:DOMINATION.ids[k],x:p.x,y:p.y,z:p.z,radius}));
}

export function createDominationState(points){
  return {
    points:points.map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,radius:p.radius??DOMINATION.radius,control:0,owner:null,contested:false,present:{alliance:0,horde:0}})),
    clock:0,ticks:0
  };
}

// players: [{team,x,y,z}] already filtered to living participants.
export function presenceAt(points,players,{reach=DOMINATION.heightReach}={}){
  return points.map(point=>{
    const present={alliance:0,horde:0};
    for(const p of players)if(TEAMS.includes(p.team)&&Math.hypot(p.x-point.x,p.z-point.z)<=point.radius&&Math.abs(p.y-point.y)<=reach)present[p.team]++;
    return present;
  });
}

// Advances capture progress and score by dt seconds. `presence[i]` is
// {alliance,horde} counts for point i. Returns events for UI/notices.
// control runs from -1 (full Horde) to +1 (full Alliance); a point stays
// owned until an enemy pushes control through zero, so it must be neutralised
// before it can be captured.
export function stepDomination(state,presence,dt,score={alliance:0,horde:0}){
  const events=[];dt=Math.max(0,Math.min(1,dt));
  state.points.forEach((point,i)=>{
    const present=presence[i]||{alliance:0,horde:0},a=present.alliance>0,h=present.horde>0;
    point.present={alliance:present.alliance,horde:present.horde};point.contested=a&&h;
    if(a!==h){
      const team=a?'alliance':'horde',rate=Math.min(DOMINATION.maxCapturers,present[team])/DOMINATION.captureSeconds;
      point.control=Math.max(-1,Math.min(1,point.control+sign(team)*rate*dt));
      const before=point.owner;
      if(point.owner&&(point.control===0||Math.sign(point.control)!==sign(point.owner)))point.owner=null;
      if(Math.abs(point.control)>=1)point.owner=point.control>0?'alliance':'horde';
      if(point.owner!==before)events.push({type:point.owner?'capture':'neutralize',point:point.id,team:point.owner||other(before),previous:before});
    }
  });
  state.clock+=dt;
  while(state.clock>=DOMINATION.tickSeconds-1e-9){
    state.clock-=DOMINATION.tickSeconds;state.ticks++;
    for(const point of state.points)if(point.owner){score[point.owner]++;}
    events.push({type:'tick',score:{...score}});
  }
  if(state.clock<1e-9)state.clock=0;
  return events;
}

// Returns 'alliance' | 'horde' | 'draw' | null. The score limit ends the match
// immediately; otherwise the higher score wins when time expires.
export function dominationWinner(score,target,timeUp=false){
  const a=score.alliance,h=score.horde;
  if(a>=target||h>=target)return a===h?'draw':a>h?'alliance':'horde';
  if(timeUp)return a===h?'draw':a>h?'alliance':'horde';
  return null;
}

// Spawn preference multiplier (> 0). Applied after the safety tiers, so it can
// only choose among equally safe candidates. Candidates near points the team
// owns are favoured; those sitting on enemy-owned points are discouraged.
export function spawnObjectiveWeight(candidate,state,team){
  if(!state)return 1;let weight=1;
  for(const point of state.points){
    if(!point.owner)continue;const d=flat(candidate,point);
    if(point.owner===team)weight=Math.max(weight,1+3*Math.max(0,1-d/60));
    else if(d<point.radius+8)weight=Math.min(weight,.25);
  }
  return weight;
}

export function dominationSnapshot(state,{tickSeconds=DOMINATION.tickSeconds}={}){
  return {
    nextTick:Math.max(0,tickSeconds-state.clock),
    points:state.points.map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,radius:p.radius,owner:p.owner,progress:Math.abs(p.control),side:p.control>0?'alliance':p.control<0?'horde':null,contested:p.contested,alliance:p.present.alliance,horde:p.present.horde}))
  };
}

// View model for the HUD strip. No DOM here so the rules stay testable.
export function dominationHudModel(domination,score,target){
  const frac=v=>Math.max(0,Math.min(1,target>0?v/target:0));
  return {
    points:(domination?.points||[]).map(p=>({id:p.id,owner:p.owner,side:p.side,progress:p.progress,contested:!!p.contested,state:p.contested?'contested':p.owner&&p.progress>=1?'owned':p.progress>0?'capturing':'neutral'})),
    bars:{alliance:frac(score?.alliance||0),horde:frac(score?.horde||0)},
    label:{alliance:score?.alliance||0,horde:score?.horde||0,target}
  };
}
