import {fireModeOf,burstOf,isShellReload,shellTimings} from './firing-modes.mjs';
// Rendering-independent weapon simulation. World distances use metres.
export function damageAt(gun,metres,region='locTorsoUpper'){
  const points=gun.damageCurve;let base=points[points.length-1][1];
  if(metres<=points[0][0])base=points[0][1];
  else for(let i=1;i<points.length;i++)if(metres<=points[i][0]){const [a,av]=points[i-1],[b,bv]=points[i];base=av+(bv-av)*(metres-a)/Math.max(.00001,b-a);break;}
  return Math.max(0,base*(gun.multipliers[region]??1));
}
export function hitRegion(heightFraction){return heightFraction>.84?'locHead':heightFraction>.73?'locNeck':heightFraction>.57?'locTorsoUpper':heightFraction>.45?'locTorsoMid':heightFraction>.34?'locTorsoLower':'locRightLegUpper';}
export class WeaponSimulation{
  constructor(guns){this.guns=guns;this.index=0;this.inventory=guns.map(g=>({ammo:g.capacity,reserve:g.reserve}));this.resetAction();}
  get gun(){return this.guns[this.index];}get ammo(){return this.inventory[this.index].ammo;}set ammo(v){this.inventory[this.index].ammo=v;}get reserve(){return this.inventory[this.index].reserve;}set reserve(v){this.inventory[this.index].reserve=v;}
  get mode(){return fireModeOf(this.gun);}
  resetAction(){this.ads=0;this.reloadLeft=0;this.reloadDuration=0;this.cooldown=0;this.triggerLatched=false;this.burstShots=0;this.burstLeft=0;this.shell=null;}
  releaseTrigger(){this.triggerLatched=false;this.burstShots=0;}
  // True while the player should keep calling fire(): trigger held, or a burst already started and still owed rounds.
  wantsFire(trigger){return !!trigger||this.burstLeft>0;}
  select(index){if(!this.guns[index])return;this.index=index;this.ads=0;this.reloadLeft=0;this.triggerLatched=true;this.burstShots=0;this.burstLeft=0;this.shell=null;/* Preserve cooldown so switching cannot bypass the bolt. */}
  refill(){this.inventory=this.guns.map(g=>({ammo:g.capacity,reserve:g.reserve}));this.resetAction();}
  reload(){
    if(this.reloadLeft>0||this.ammo===this.gun.capacity||this.reserve<=0)return false;
    this.burstLeft=0;
    if(isShellReload(this.gun)){
      const need=Math.min(this.gun.capacity-this.ammo,this.reserve),t=shellTimings(this.gun,this.ammo===0);
      this.shell={need,inserted:0,start:t.start,perShell:t.perShell};
      this.reloadDuration=t.start+need*t.perShell+t.end;this.reloadLeft=this.reloadDuration;return true;
    }
    this.reloadDuration=this.ammo===0?this.gun.reloadEmpty:this.gun.reload;this.reloadLeft=this.reloadDuration;return true;
  }
  // Shell reloads insert one round per perShell seconds after the start phase; progress is derived from reloadLeft.
  stepShells(){
    const s=this.shell;if(!s)return;
    const elapsed=this.reloadDuration-this.reloadLeft,count=Math.max(0,Math.min(s.need,Math.floor((elapsed-s.start)/s.perShell+1e-9)));
    if(count>s.inserted){const n=Math.min(count-s.inserted,this.reserve);this.ammo+=n;this.reserve-=n;s.inserted=count;}
    if(this.reloadLeft<=0)this.shell=null;
  }
  // A shell reload may be interrupted by firing while shells are still being inserted, keeping what is loaded.
  canInterruptReload(){
    const s=this.shell;if(!s||this.ammo<=0)return false;
    return this.reloadDuration-this.reloadLeft<s.start+s.need*s.perShell-1e-9;
  }
  tick(dt,aim,trigger){
    this.cooldown=Math.max(0,this.cooldown-dt);
    const target=aim&&this.reloadLeft<=0?1:0;this.ads=target?Math.min(1,this.ads+dt/this.gun.adsIn):Math.max(0,this.ads-dt/this.gun.adsOut);
    if(!trigger){this.triggerLatched=false;this.burstShots=0;}
    if(this.reloadLeft>0){
      this.reloadLeft=Math.max(0,this.reloadLeft-dt);
      if(this.shell)this.stepShells();
      else if(this.reloadLeft===0){const n=Math.min(this.gun.capacity-this.ammo,this.reserve);this.ammo+=n;this.reserve-=n;}
    }
  }
  // options.trustCooldown (authoritative servers): the trigger state arrives over a lossy 20 Hz pose channel, so
  // semi/burst/pump presses are limited by the cooldown alone instead of a re-press. Bolt rifles always latch.
  fire(options={}){
    const gun=this.gun,mode=fireModeOf(gun);
    if(this.cooldown>0||this.ammo<=0)return false;
    const owed=mode==='burst'&&this.burstLeft>0;
    if(this.reloadLeft>0){if(!this.canInterruptReload())return false;this.reloadLeft=0;this.shell=null;}
    if(!owed&&this.triggerLatched&&(mode==='bolt'||(mode!=='auto'&&!options.trustCooldown)))return false;
    this.ammo--;this.triggerLatched=true;this.burstShots++;
    if(mode==='bolt'||mode==='pump')this.cooldown=gun.cycle;
    else if(mode==='semi')this.cooldown=gun.interval;
    else if(mode==='burst'){
      const b=burstOf(gun);if(!owed)this.burstLeft=b.count;
      this.burstLeft--;if(this.ammo<=0)this.burstLeft=0;
      this.cooldown=this.burstLeft>0?gun.interval:b.cooldown;
    }
    else this.cooldown=this.burstShots===1&&gun.introInterval>0?gun.introInterval:gun.interval;
    return true;
  }
}
