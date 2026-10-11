const test=require('node:test'),assert=require('node:assert/strict');
test('Rewards repeat every seven kills and consumption uses one charge',async()=>{
 const {Killstreaks}=await import('../src/streaks.mjs'),s=new Killstreaks();
 for(let i=1;i<=14;i++){const rewards=s.kill();assert.equal(rewards.length,[3,5,7].includes((i-1)%7+1)?1:0);}
 assert.equal(s.kills,0);assert.deepEqual(s.ready,{uav:2,supply:2,sentry:2});assert.equal(s.consume('sentry'),true);assert.equal(s.ready.sentry,1);s.consume('sentry');assert.equal(s.consume('sentry'),false);
});
test('Death and restart clear progress and every reward',async()=>{
 const {Killstreaks}=await import('../src/streaks.mjs'),s=new Killstreaks();for(let i=0;i<6;i++)s.kill();s.death();assert.equal(s.kills,0);assert.deepEqual(s.ready,{uav:0,supply:0,sentry:0});for(let i=0;i<3;i++)s.kill();assert.equal(s.ready.uav,1);s.reset();assert.equal(s.kills,0);assert.deepEqual(s.ready,{uav:0,supply:0,sentry:0});
});
