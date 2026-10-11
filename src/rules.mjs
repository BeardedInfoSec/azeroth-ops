export const ROSTERS={alliance:['human','dwarf','nightelf','gnome','draenei'],horde:['orc','forsaken','tauren','troll','bloodelf']};
export const opposite=faction=>faction==='alliance'?'horde':'alliance';
export const friendly=(a,b)=>a===b;
export function rosterFor(faction,playerRace){if(!ROSTERS[faction]?.includes(playerRace))throw new Error('Race does not belong to selected faction');return ROSTERS[faction].filter(r=>r!==playerRace);}
export function waveSettings(wave){return{count:Math.min(6+(wave-1)*2,18),health:Math.min(80+(wave-1)*12,200),speed:Math.min(1.25+(wave-1)*.15,2.65)};}
export function awardScore(scores,victimFaction,killerFaction,limit=20){if(friendly(victimFaction,killerFaction))return null;scores[killerFaction]++;return scores[killerFaction]>=limit?killerFaction:null;}
