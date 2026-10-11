// All twelve machines are offered in this custom mode; a survivor may carry four perks.
export const ZOMBIE_PERKS=Object.freeze([
  {id:'juggernog',name:'Juggernog',cost:2500,zone:0,color:'#d94a42',short:'JUG',description:'Raise maximum health to 250.'},
  {id:'quick_revive',name:'Quick Revive',cost:500,zone:0,color:'#70c6ef',short:'REV',description:'Recover from a solo down. Three purchases per match.'},
  {id:'double_tap',name:'Double Tap II',cost:2000,zone:1,color:'#e69d39',short:'2X',description:'Double bullet damage and fire 33% faster.'},
  {id:'speed_cola',name:'Speed Cola',cost:3000,zone:1,color:'#66c06a',short:'SPD',description:'Reload twice as fast.'},
  {id:'stamin_up',name:'Stamin-Up',cost:2000,zone:0,color:'#efd24c',short:'RUN',description:'Move 25% faster.'},
  {id:'deadshot',name:'Deadshot Daiquiri',cost:1500,zone:0,color:'#b4bdc8',short:'AIM',description:'Reduce hip spread and recoil by 35%.'},
  {id:'mule_kick',name:'Mule Kick',cost:4000,zone:1,color:'#68974c',short:'III',description:'Carry a third weapon. Losing this perk loses that weapon.'},
  {id:'phd_flopper',name:'PhD Flopper',cost:2000,zone:1,color:'#af78d0',short:'PHD',description:'Hard landings release an explosive blast.'},
  {id:'tombstone',name:'Tombstone Soda',cost:2000,zone:2,color:'#bcbab6',short:'RIP',description:'Return once and recover a dropped equipment stash.'},
  {id:'whos_who',name:"Who's Who",cost:2000,zone:2,color:'#55c7c4',short:'WHO',description:'Become a ghost for 15 seconds and revive your own body.'},
  {id:'electric_cherry',name:'Electric Cherry',cost:2000,zone:2,color:'#cc76ae',short:'ZAP',description:'Reloading shocks nearby undead.'},
  {id:'vulture_aid',name:'Vulture Aid',cost:3000,zone:2,color:'#dc7d55',short:'EYE',description:'Reveal enemies, collect kill drops and hide in their mist.'},
].map(p=>Object.freeze(p)));
export const PERKS_BY_ID=Object.freeze(Object.fromEntries(ZOMBIE_PERKS.map(p=>[p.id,p])));
export const PACK_COST=5000,PACK_AMMO_COST=4500,PERK_LIMIT=4;
export const survivalMaxHealth=rules=>rules.perks.has('juggernog')?250:100;
export const survivalMovement=rules=>rules.perks.has('stamin_up')?1.25:1;
export const survivalSpread=rules=>rules.perks.has('deadshot')?.65:1;
export function survivalWeapons(baseGuns,rules){
  const double=rules.perks.has('double_tap'),rate=double?1.33:1,reload=rules.perks.has('speed_cola')?.5:1;
  return baseGuns.map((g,index)=>{
    const packed=rules.packed.has(index),damage=(packed?2:1)*(double?2:1);
    return {...g,name:packed?'PACKED '+g.name:g.name,baseName:g.name,packed,
      damage:g.damage*damage,damageCurve:g.damageCurve.map(([distance,value])=>[distance,value*damage]),multipliers:{...g.multipliers},
      capacity:packed?Math.ceil(g.capacity*1.5):g.capacity,reserve:packed?g.reserve*2:g.reserve,
      interval:g.interval/rate,introInterval:g.introInterval/rate,cycle:g.cycle/rate,
      reload:g.reload*reload,reloadEmpty:g.reloadEmpty*reload,
    };
  });
}
