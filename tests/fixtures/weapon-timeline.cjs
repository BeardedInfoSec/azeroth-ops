// Deterministic scripted weapon timeline used to prove the original four guns behave identically after the firing-mode work.
const crypto=require('node:crypto');
async function timeline(index){
  const {WeaponSimulation}=await import('../../src/engine/weapon-simulation.mjs'),{spreadDegrees,kickAfterShot,recoverKick}=await import('../../src/engine/aim.mjs'),{GUNS}=await import('../../src/weapon-data.js');
  const s=new WeaponSimulation(GUNS);s.select(index);const dt=1/120,lines=[];let kick=0,shots=0;const r=n=>Math.round(n*1e6)/1e6;
  for(let i=0;i<900;i++){
    const trigger=(i>=5&&i<100)||(i>=112&&i<330)||(i>=420&&i<900&&(i%40)<22),aim=i>=50&&i<300||i>=600&&i<700;
    if(i===340)s.reload();if(i===700){s.ammo=0;s.reload();}
    s.tick(dt,aim,trigger);let fired=false;
    if(trigger){fired=s.fire();if(fired){shots++;kick=kickAfterShot(kick,s.gun);}}
    kick=recoverKick(kick,dt);
    lines.push([i,fired?1:0,s.ammo,s.reserve,r(s.cooldown),r(s.reloadLeft),r(s.ads),r(kick),r(spreadDegrees(s.gun,s.ads,i%7))].join(','));
  }
  return {shots,final:lines[lines.length-1],hash:crypto.createHash('sha256').update(lines.join('\n')).digest('hex')};
}
module.exports={timeline};
