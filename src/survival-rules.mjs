import {PERKS_BY_ID,PACK_COST,PACK_AMMO_COST,PERK_LIMIT,survivalMaxHealth,survivalMovement,survivalSpread} from './zombie-upgrades.mjs';
import {coopPerkInfo} from './coop-rules.mjs';
export {ZOMBIE_PERKS,PERKS_BY_ID,PACK_COST,PACK_AMMO_COST,PERK_LIMIT,survivalMaxHealth,survivalMovement,survivalSpread,survivalWeapons} from './zombie-upgrades.mjs';
export const ZONE_COSTS=Object.freeze([0,750,1500]);
export const WALL_WEAPONS=Object.freeze({
  1:Object.freeze({name:'SCAR-H',cost:1000,zone:0}),
  2:Object.freeze({name:'DSR 50',cost:1500,zone:1}),
  3:Object.freeze({name:'BALLISTA',cost:1750,zone:2}),
});

export function waveConfig(wave=1){
  const level=Number.isFinite(wave)?Math.max(1,Math.floor(wave)):1;
  const speed=Math.min(3.8,1.65+.2*(level-1));
  return Object.freeze({
    wave:level,count:Math.min(36,8+3*(level-1)),
    health:Math.min(500,80+18*(level-1)),speed,ghoulSpeed:speed*1.2,
    damage:Math.min(40,20+level),entryDelay:Math.max(.45,1.7-.08*(level-1)),
  });
}

export class SurvivalRules{
  constructor({coop=false}={}){this.coop=!!coop;this.reset();}
  reset(){
    this.points=500;this.owned=new Set([0]);this.zones=new Set([0]);
    this.perks=new Set();this.packed=new Set();this.revivePurchases=0;this.muleWeapon=null;
    this.wave=1;this.repairs=new Map();this.killed=new Set();return this;
  }
  spend(cost){
    if(!Number.isSafeInteger(cost)||cost<0||cost>this.points)return false;
    this.points-=cost;return true;
  }
  awardHit(enemyId,{damage=1,killed=false,headshot=false}={}){
    if(enemyId===null||enemyId===undefined||!Number.isFinite(damage)||damage<=0||this.killed.has(enemyId))return 0;
    const reward=10+(killed?(headshot?150:100):0);
    if(killed)this.killed.add(enemyId);
    this.points+=reward;return reward;
  }
  repair(windowId){
    if(windowId===null||windowId===undefined)return 0;
    const earned=this.repairs.get(windowId)||0;
    if(earned>=60)return 0;
    this.repairs.set(windowId,earned+10);this.points+=10;return 10;
  }
  openZone(index){
    if(!Number.isInteger(index)||index<0||index>=ZONE_COSTS.length)return {ok:false,cost:0,reason:'unknown-zone'};
    if(this.zones.has(index))return {ok:false,cost:0,reason:'already-open'};
    if(!this.zones.has(index-1))return {ok:false,cost:ZONE_COSTS[index],reason:'previous-zone-locked'};
    const cost=ZONE_COSTS[index];
    if(!this.spend(cost))return {ok:false,cost,reason:'insufficient-points'};
    this.zones.add(index);return {ok:true,cost};
  }
  get weaponCapacity(){return this.perks.has('mule_kick')?3:2;}
  get maxHealth(){return survivalMaxHealth(this);}
  get movementMultiplier(){return survivalMovement(this);}
  get spreadMultiplier(){return survivalSpread(this);}
  get recoilMultiplier(){return survivalSpread(this);}
  buyPerk(id,zone=PERKS_BY_ID[id]?.zone){
    const perk=this.coop?coopPerkInfo(id):(Object.hasOwn(PERKS_BY_ID,id)?PERKS_BY_ID[id]:null);
    if(!perk)return {ok:false,cost:0,reason:'unknown-perk'};
    const cost=perk.cost;
    if(!this.zones.has(perk.zone)||!this.zones.has(zone))return {ok:false,cost,reason:'zone-locked'};
    if(this.perks.has(id))return {ok:false,cost,reason:'already-owned'};
    if(!this.coop&&id==='quick_revive'&&this.revivePurchases>=3)return {ok:false,cost,reason:'revive-limit'};
    if(this.perks.size>=PERK_LIMIT)return {ok:false,cost,reason:'perk-limit'};
    if(!this.spend(cost))return {ok:false,cost,reason:'insufficient-points'};
    this.perks.add(id);if(id==='quick_revive')this.revivePurchases++;
    return {ok:true,cost};
  }
  packWeapon(index,zone=2){
    const cost=PACK_COST;
    if(!this.zones.has(2)||!this.zones.has(zone))return {ok:false,cost,reason:'zone-locked'};
    if(!this.owned.has(index))return {ok:false,cost,reason:'weapon-not-owned'};
    if(this.packed.has(index))return {ok:false,cost,reason:'already-packed'};
    if(!this.spend(cost))return {ok:false,cost,reason:'insufficient-points'};
    this.packed.add(index);return {ok:true,cost};
  }
  buyWeapon(index,zone=WALL_WEAPONS[index]?.zone??0,currentIndex=0){
    const weapon=WALL_WEAPONS[index]||(index===0&&this.owned.has(0)?{cost:500,zone:0}:null);
    if(!weapon)return {ok:false,cost:0,refill:false,reason:'unknown-weapon'};
    const refill=this.owned.has(index),cost=refill?(this.packed.has(index)?PACK_AMMO_COST:Math.round(weapon.cost*.4)):weapon.cost;
    if(!Number.isInteger(zone)||!this.zones.has(zone)||!this.zones.has(weapon.zone))return {ok:false,cost,refill,reason:'zone-locked'};
    if(!this.spend(cost))return {ok:false,cost,refill,reason:'insufficient-points'};
    let replaced;
    if(!refill&&this.owned.size>=this.weaponCapacity){replaced=this.owned.has(currentIndex)?currentIndex:this.owned.values().next().value;this.owned.delete(replaced);this.packed.delete(replaced);if(this.muleWeapon===replaced)this.muleWeapon=index;}
    this.owned.add(index);if(!refill&&this.owned.size===3&&this.muleWeapon===null)this.muleWeapon=index;
    return {ok:true,cost,refill,...(replaced!==undefined?{replaced}:{})};
  }
  trimWeapons(){
    const removed=[];
    while(this.owned.size>this.weaponCapacity){const index=this.owned.has(this.muleWeapon)?this.muleWeapon:[...this.owned].at(-1);this.owned.delete(index);this.packed.delete(index);removed.push(index);}
    if(!this.perks.has('mule_kick')||!this.owned.has(this.muleWeapon))this.muleWeapon=null;
    return removed;
  }
  consumePerk(id){const removed=this.perks.delete(id);this.trimWeapons();return removed;}
  losePerks(){const perks=[...this.perks];this.perks.clear();return {perks,removedWeapons:this.trimWeapons()};}
  clearPerks(){return this.losePerks();}
  resetLoadout(){this.owned=new Set([0]);this.packed.clear();this.perks.clear();this.muleWeapon=null;return this;}
  snapshotLoadout(){return {owned:[...this.owned],packed:[...this.packed],perks:[...this.perks],muleWeapon:this.muleWeapon,revivePurchases:this.revivePurchases};}
  restoreLoadout(snapshot,{exclude=[],excludePerks=[]}={}){
    const excluded=new Set([...exclude,...excludePerks]);
    this.perks=new Set((snapshot.perks||[]).filter(id=>Object.hasOwn(PERKS_BY_ID,id)&&!excluded.has(id)).slice(0,PERK_LIMIT));
    this.owned=new Set((snapshot.owned||[]).filter(index=>Number.isInteger(index)&&index>=0&&index<12));if(!this.owned.size)this.owned.add(0);
    this.packed=new Set((snapshot.packed||[]).filter(index=>this.owned.has(index)));
    this.muleWeapon=this.owned.has(snapshot.muleWeapon)?snapshot.muleWeapon:null;
    if(this.perks.has('mule_kick')&&this.owned.size===3&&this.muleWeapon===null)this.muleWeapon=[...this.owned].at(-1);
    this.revivePurchases=Math.max(this.revivePurchases,Number.isInteger(snapshot.revivePurchases)?Math.min(3,Math.max(0,snapshot.revivePurchases)):0);
    this.trimWeapons();return this;
  }
  resetWave(wave=this.wave+1){
    this.wave=waveConfig(wave).wave;this.repairs.clear();this.killed.clear();return waveConfig(this.wave);
  }
}
