// Small, explicit passives. These do not change damage, shot cadence, magazines,
// or character geometry. Human and Forsaken are intentionally revival support
// choices: their benefits are conditional, not hidden bonuses in every mode.
const DEFAULTS=Object.freeze({healthBonus:0,movement:1,reload:1,adsIn:1,reserve:1,recoil:1,spread:1,regenDelay:6,regenRate:12,revive:1,bleedout:1});
const trait=(name,description,values={})=>Object.freeze({...DEFAULTS,name,description,...values});
export const RACE_TRAITS=Object.freeze({
  human:trait('Helping Hand','Revive actions take 15% less time. Support bonus: only applies when a revival is available.',{revive:.85}),
  dwarf:trait('Steady Hands','8% less recoil kick. Bullet damage and spread stay the same.',{recoil:.92}),
  nightelf:trait('Fleet Footed','3% faster movement. Stacks with movement perks.',{movement:1.03}),
  gnome:trait('Nimble Reload','Reloads take 5% less time, including empty reloads.',{reload:.95}),
  draenei:trait('Gift of Recovery','Natural health regeneration heals 15% faster once it starts. Does not shorten the delay.',{regenRate:13.8}),
  orc:trait('Battle Focus','Aim down sights takes 6% less time. Does not change accuracy or fire rate.',{adsIn:.94}),
  forsaken:trait('Lingering Spirit','20% longer bleedout timer when downed in co-op. Support bonus: no effect without a bleedout timer.',{bleedout:1.2}),
  tauren:trait('Endurance','5 extra maximum health: 105 normally, 255 with Juggernog.',{healthBonus:5}),
  troll:trait('Regenerative Instinct','Natural health regeneration starts after 5.5 seconds without damage instead of 6.',{regenDelay:5.5}),
  bloodelf:trait('Arcane Reserves','10% more reserve ammunition, rounded down. Magazine size stays the same.',{reserve:1.1}),
});
const NEUTRAL=trait('No racial trait','Choose a race to view its passive.');
export const raceTraits=race=>Object.hasOwn(RACE_TRAITS,race)?RACE_TRAITS[race]:NEUTRAL;
export const racialMaxHealth=(base,race)=>base+raceTraits(race).healthBonus;
export const racialMovement=race=>raceTraits(race).movement;
export const racialRegenDelay=race=>raceTraits(race).regenDelay;
export const racialRegenRate=race=>raceTraits(race).regenRate;
export const racialReviveDuration=(base,race)=>base*raceTraits(race).revive;
export const racialBleedoutDuration=(base,race)=>base*raceTraits(race).bleedout;
export const racialSpread=race=>raceTraits(race).spread;
export const racialRecoil=race=>raceTraits(race).recoil;
// Pass the current base/class/zombie-upgraded definitions, never the previous
// result, so reequip and UI refreshes cannot compound the passive repeatedly.
export function racialWeapons(baseGuns,race){
  const t=raceTraits(race);
  return baseGuns.map(base=>({...structuredClone(base),reload:base.reload*t.reload,reloadEmpty:base.reloadEmpty*t.reload,adsIn:base.adsIn*t.adsIn,reserve:Math.floor(base.reserve*t.reserve)}));
}
