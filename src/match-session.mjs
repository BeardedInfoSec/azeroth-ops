export const inMatchPhase=phase=>['loading','countdown','playing','ended'].includes(phase);
export const matchStamp=room=>room?{code:room.code,loadGeneration:room.loadGeneration,layoutRevision:room.layoutRevision}:null;
export const sameDeployment=(a,b)=>!!a&&!!b&&a.code===b.code&&a.loadGeneration===b.loadGeneration&&a.layoutRevision===b.layoutRevision;
export function sessionScreen(room,{locked=false,focused=true}={}){
  if(!room||!inMatchPhase(room.phase))return 'lobby';
  if(room.phase==='playing')return locked?'live':focused?'resume':'away';
  return room.phase;
}
export function countdownRemaining(room,receivedAt,now){
  if(room?.phase!=='countdown')return 0;
  const remaining=Number.isFinite(room.startsAt)&&Number.isFinite(room.serverNow)?(room.startsAt-room.serverNow)/1000:room.countdown||0;
  return Math.max(0,remaining-Math.max(0,now-receivedAt)/1000);
}
export function loadStageProgress(stage){
  const text=String(stage).toLowerCase();
  if(text.includes('finishing'))return .88;
  if(text.includes('props'))return .68;
  if(text.includes('texture'))return .48;
  if(text.includes('building'))return .28;
  if(text.includes('reading'))return .12;
  return .05;
}
