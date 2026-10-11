// Local handling tuning; imported BO2 weapon data remains unchanged. Per-class limits live in firing-modes.mjs.
import {handlingFor} from './firing-modes.mjs';
export function spreadDegrees(gun,ads,speed=0){
  const hip=Math.min(gun.hipSpread,handlingFor(gun).hipCap);
  const moving=1+Math.min(Math.max(speed,0)/5.2,1)*.5;
  return hip*moving*(1-Math.min(Math.max(ads,0),1))**2;
}
export function kickAfterShot(kick,gun){return Math.min(kick+handlingFor(gun).kick*(gun.recoil??1),.012);}
export function recoverKick(kick,dt){return kick*Math.exp(-16*dt);}
