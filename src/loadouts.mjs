import {GUNS} from './weapon-data.js';
import {applyAttachments} from './attachments.mjs';
import {PERK_CATALOG,cleanClass,defaultClasses,perkEffects,slotAttachmentIds} from './loadout-rules.mjs';
// Legacy id -> label map (kept for older callers/tests). The full tiered catalog lives in loadout-rules.mjs.
export const PERKS=Object.freeze({balanced:'Balanced',...Object.fromEntries(PERK_CATALOG.map(p=>[p.id,p.name+' · '+p.summary]))});
export const DEFAULT_CLASSES=defaultClasses();
// Authoritative class cleaning (v1 and v2 inputs). Optional `profile` (server only): locked picks
// are swapped for free ones and their ids pushed to `violations`; the Pick-10 budget is always
// enforced. With no profile every unlocked-by-default pick is allowed, as before.
export function cleanLoadout(value={},profile=null,violations=null){return cleanClass(value,profile,violations,GUNS);}
// Order: base -> attachments -> perks. Callers apply racialWeapons afterwards.
// Perk effects apply to every gun in the class list (as the original Fast Hands/Stockpile did);
// attachments only to the equipped primary/secondary.
const SHELL_RELOAD=['reloadPerShell','reloadStart','reloadEnd'];
export function classWeapons(guns,loadout){
  const fx=perkEffects(loadout);
  return guns.map((base,index)=>{
    const slot=index===loadout?.primary?'primary':index===loadout?.secondary?'secondary':null,g=slot?applyAttachments(base,slotAttachmentIds(loadout,slot)):base;
    const out={...g,reload:g.reload*fx.reload,reloadEmpty:g.reloadEmpty*fx.reload,reserve:Math.floor(g.reserve*fx.reserve)};
    if(fx.reload!==1)for(const key of SHELL_RELOAD)if(typeof g[key]==='number')out[key]=g[key]*fx.reload;
    if(fx.adsIn!==1)out.adsIn=g.adsIn*fx.adsIn;
    if(fx.recoil!==1)out.recoil=(g.recoil??1)*fx.recoil;
    return out;
  });
}
export function classSpeed(loadout){return perkEffects(loadout).speed;}
// Multiplier for natural health regeneration. Callers skip it in Battle Royale.
export function classRegen(loadout){return perkEffects(loadout).regen;}
