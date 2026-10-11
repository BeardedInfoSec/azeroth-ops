import {ZOMBIE_PERKS} from './zombie-upgrades.mjs';

// Durations are seconds. The server converts its wall-clock deadlines to ms.
export const COOP_RULES=Object.freeze({maxPlayers:4,bleedout:30,revive:4,quickRevive:2,reviveRange:2.5,reviveHealth:.4,reviveShield:2,selfRevive:8,selfReviveWindow:15,stashLifetime:45,stashHold:1});
const overrides={
  quick_revive:{cost:1500,description:'Revive teammates in 2 seconds instead of 4. No self-revive in co-op.'},
  whos_who:{description:'On your next down, hold E for 8 seconds within 15 seconds to rescue yourself. Consumed on use.'},
  tombstone:{description:'Drop an equipment stash when downed. Recover it after revival or next-wave return; expires 45 seconds after you return.'},
};
export const COOP_PERKS=Object.freeze(ZOMBIE_PERKS.map(p=>Object.freeze({...p,...overrides[p.id]})));
const byId=Object.freeze(Object.fromEntries(COOP_PERKS.map(p=>[p.id,p])));
export const coopPerkInfo=id=>Object.hasOwn(byId,id)?byId[id]:null;
