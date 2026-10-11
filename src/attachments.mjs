// Data-driven weapon attachments. Applied on top of the generated weapon-data.js
// definitions (never edit those by hand). All functions are pure and return new
// specs. Gameplay and UI only: attachments add no extracted models or textures.
//
// Composition order for a class weapon: base -> attachment -> class perk -> racial.
// Undead modes never use class attachments, but Pack-a-Punch composes safely
// either way because every modifier is multiplicative and an already-attached
// spec is never attached twice.
export const SUPPRESSOR_FALLOFF_START=20,SUPPRESSOR_FALLOFF_END=40,SUPPRESSOR_LONG_RANGE=.85;

const freeze=a=>Object.freeze({...a,types:Object.freeze([...a.types]),exclude:Object.freeze([...(a.exclude||[])])});
// `types` are weapon types (see weaponType): rifle = AR/SMG/LMG, sniper = scoped, pistol, shotgun.
// `group` is the BO2-style exclusivity group: one attachment per group on a weapon, so the
// stat modifiers can never stack inside the same family.
export const ATTACHMENTS=Object.freeze([
  {id:'extMags',name:'Extended Mags',types:['rifle','sniper','pistol'],exclude:['dsr50_mp','mk48_mp'],group:'mag',summary:'+50% magazine capacity (rounded up). Reloads take 10% longer.',magazine:1.5,reload:1.1},
  {id:'fastMags',name:'Fast Mags',types:['rifle','sniper','pistol'],group:'mag',summary:'Reloads take 15% less time. Magazine size is unchanged.',reload:.85},
  {id:'foregrip',name:'Foregrip',types:['rifle'],group:'grip',summary:'30% less recoil kick. Aim down sights takes 10% longer.',recoil:.7,adsIn:1.1},
  {id:'suppressor',name:'Suppressor',types:['rifle','sniper','pistol'],group:'barrel',summary:'Your shots do not ping the enemy radar (UAV still sees you). Damage fades 15% by 40 m.',quiet:true,longRange:SUPPRESSOR_LONG_RANGE},
  {id:'redDot',name:'Red Dot',types:['rifle'],group:'optic',summary:'Tighter aim down sights zoom (50 to 46 degrees) with a clearer sight picture. Aim takes 5% longer.',adsFovScale:.92,adsIn:1.05},
  {id:'quickdraw',name:'Quickdraw Grip',types:['rifle','pistol'],group:'grip',summary:'Aim down sights is 15% faster. 10% more recoil kick.',adsIn:.85,recoil:1.1},
  {id:'reflex',name:'Reflex Sight',types:['rifle','pistol'],group:'optic',summary:'Slightly tighter aim down sights zoom (4%). Aim takes 3% longer.',adsFovScale:.96,adsIn:1.03},
  {id:'compensator',name:'Compensator',types:['rifle','sniper','pistol'],group:'barrel',summary:'15% less recoil kick. Aim down sights takes 4% longer.',recoil:.85,adsIn:1.04},
].map(freeze));
export const ATTACHMENTS_BY_ID=Object.freeze(Object.fromEntries(ATTACHMENTS.map(a=>[a.id,a])));
export const ATTACHMENT_IDS=Object.freeze(ATTACHMENTS.map(a=>a.id));

export const weaponType=gun=>gun?.scope?'sniper':gun?.class==='pistol'?'pistol':gun?.class==='shotgun'?'shotgun':'rifle';
export function canEquip(gun,id){
  if(!gun||typeof id!=='string'||!Object.hasOwn(ATTACHMENTS_BY_ID,id))return false;
  const a=ATTACHMENTS_BY_ID[id];return a.types.includes(weaponType(gun))&&!a.exclude.includes(gun.id);
}
export const attachmentsFor=gun=>ATTACHMENTS.filter(a=>canEquip(gun,a.id));
export const cleanAttachmentId=(gun,id)=>canEquip(gun,id)?id:null;
// Cleans an ordered list of attachment ids for one gun: valid, unique, one per group.
export function cleanAttachmentList(gun,ids,max=1){
  const out=[],groups=new Set();
  for(const id of Array.isArray(ids)?ids:[]){
    if(out.length>=max)break;if(!canEquip(gun,id)||out.includes(id))continue;
    const g=ATTACHMENTS_BY_ID[id].group;if(groups.has(g))continue;groups.add(g);out.push(id);
  }
  return out;
}

// Multiply a damage curve by a distance falloff, keeping breakpoints of both
// piecewise-linear functions so the product stays exact.
function fadeCurve(curve,factor){
  const at=d=>{
    if(d<=curve[0][0])return curve[0][1];
    for(let i=1;i<curve.length;i++)if(d<=curve[i][0]){const [a,av]=curve[i-1],[b,bv]=curve[i];return av+(bv-av)*(d-a)/Math.max(.00001,b-a);}
    return curve[curve.length-1][1];
  };
  const fade=d=>d<=SUPPRESSOR_FALLOFF_START?1:d>=SUPPRESSOR_FALLOFF_END?factor:1+(factor-1)*(d-SUPPRESSOR_FALLOFF_START)/(SUPPRESSOR_FALLOFF_END-SUPPRESSOR_FALLOFF_START);
  const xs=[...new Set([...curve.map(p=>p[0]),SUPPRESSOR_FALLOFF_START,SUPPRESSOR_FALLOFF_END])].sort((a,b)=>a-b);
  return xs.map(d=>[d,at(d)*fade(d)]);
}

function applyOne(spec,a){
  const out={...spec};
  if(a.magazine)out.capacity=Math.ceil(spec.capacity*a.magazine);
  if(a.reload){out.reload=spec.reload*a.reload;out.reloadEmpty=spec.reloadEmpty*a.reload;}
  if(a.adsIn)out.adsIn=spec.adsIn*a.adsIn;
  if(a.recoil)out.recoil=(spec.recoil??1)*a.recoil;
  if(a.adsFovScale)out.adsFov=Math.round(spec.adsFov*a.adsFovScale);
  if(a.quiet)out.quiet=true;
  if(a.longRange)out.damageCurve=fadeCurve(spec.damageCurve,a.longRange);
  return out;
}
// Applies several attachments in order (invalid, duplicate or same-group ids are skipped).
// `attachment` stays the first id for older callers; `attachmentIds` lists them all.
export function applyAttachments(spec,ids){
  if(!spec||spec.attachment)return spec;
  const list=cleanAttachmentList(spec,ids,8);if(!list.length)return spec;
  let out=spec;for(const id of list)out=applyOne(out,ATTACHMENTS_BY_ID[id]);
  return {...out,attachment:list[0],attachmentIds:list};
}
export function applyAttachment(spec,id){return applyAttachments(spec,[id]);}
