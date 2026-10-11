const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const manifest=JSON.parse(fs.readFileSync('public/assets/characters/manifest.json'));
test('Wrath factions contain exactly their five races; Scourge is separate',async()=>{
  const {ROSTERS,rosterFor,opposite}=await import('../src/rules.mjs');
  for(const faction of ['alliance','horde']){
    const actual=manifest.characters.filter(c=>c.faction===faction).map(c=>c.id);assert.deepEqual(actual,ROSTERS[faction]);
    for(const race of actual){const allies=rosterFor(faction,race);assert.equal(allies.length,4);assert.ok(!allies.includes(race));}
    assert.throws(()=>rosterFor(faction,ROSTERS[opposite(faction)][0]));
  }
  assert.equal(manifest.characters.find(c=>c.id==='forsaken').faction,'horde');
  assert.deepEqual(manifest.characters.filter(c=>c.faction==='scourge').map(c=>c.id),['zombie','ghoul']);
});
test('Friendly kills never score; opposing kills reach the win condition',async()=>{
  const {awardScore}=await import('../src/rules.mjs');const scores={alliance:0,horde:0};
  assert.equal(awardScore(scores,'horde','horde'),null);assert.equal(scores.horde,0);
  for(let i=0;i<19;i++)assert.equal(awardScore(scores,'alliance','horde'),null);
  assert.equal(awardScore(scores,'alliance','horde'),'horde');assert.equal(scores.horde,20);
});
test('Survival waves increase and cap their population and difficulty',async()=>{
  const {waveSettings}=await import('../src/rules.mjs');assert.equal(waveSettings(1).count,6);assert.equal(waveSettings(2).count,8);assert.equal(waveSettings(100).count,18);assert.ok(waveSettings(5).health>waveSettings(1).health);
});
for(const info of manifest.characters)test(info.name+' has usable geometry, textures, bones and original animations',()=>{
  const c=JSON.parse(fs.readFileSync('public'+info.file));assert.ok(c.bones.length>20);assert.ok(c.parts.length>0);
  for(const p of c.parts){assert.ok(fs.existsSync('public'+p.texture));assert.equal(p.indices.length%3,0);assert.ok(p.indices.every(i=>i<c.positions.length/3));}
  assert.ok(c.joints.every(j=>j<c.bones.length));assert.equal(c.weights.length,c.joints.length);
  for(let i=0;i<c.weights.length;i+=4)assert.ok(Math.abs(c.weights.slice(i,i+4).reduce((a,b)=>a+b,0)-1)<.01);
  for(const name of ['idle','walk','run','death','attack'])assert.ok(c.clips.find(a=>a.name===name)?.tracks.length>0);
  for(const clip of c.clips)for(const t of clip.tracks){const stride=t.type==='rotation'?4:3;assert.equal(t.values.length,t.times.length*stride);assert.ok(t.values.every(Number.isFinite));assert.ok(t.times.every((v,i)=>v>=0&&(i===0||v>=t.times[i-1])));}
});
