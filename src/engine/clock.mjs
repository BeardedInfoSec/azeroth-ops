// Bounded fixed-step simulation; rendering can run at any refresh rate.
export class SimulationClock{
  constructor(now=0,rate=120){this.last=now;this.step=1/rate;this.accumulator=0;}
  advance(now){const delta=Math.max(0,Math.min((now-this.last)/1000,.1));this.last=now;this.accumulator+=delta;const steps=[];while(this.accumulator+1e-10>=this.step){steps.push(this.step);this.accumulator-=this.step;}return {delta,steps};}
}
