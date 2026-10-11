export const REWARDS=[{id:'uav',kills:3,key:'3',name:'UAV'},{id:'supply',kills:5,key:'4',name:'RESUPPLY'},{id:'sentry',kills:7,key:'5',name:'SENTRY GUN'}];
export class Killstreaks{
  constructor(){this.reset();}
  reset(){this.kills=0;this.ready={uav:0,supply:0,sentry:0};}
  death(){this.reset();}
  kill(){this.kills++;const earned=REWARDS.filter(r=>r.kills===this.kills);for(const r of earned)this.ready[r.id]++;if(this.kills===REWARDS.at(-1).kills)this.kills=0;return earned;}
  consume(id){if(!this.ready[id])return false;this.ready[id]--;return true;}
}
