const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const names=()=>import('../src/names.mjs'),rules=()=>import('../src/bot-rules.mjs');

test('callsign validation: lengths, charset, edges, collapse, trim', async()=>{
  const {checkCallsign}=await names();
  const ok=(raw,expected=raw)=>{const r=checkCallsign(raw);assert.ok(r.ok,JSON.stringify(raw)+' should pass: '+r.reason);assert.equal(r.name,expected);};
  const bad=(raw,code)=>{const r=checkCallsign(raw);assert.equal(r.ok,false,JSON.stringify(raw)+' should fail');if(code)assert.equal(r.code,code,JSON.stringify(raw));};
  ok('Alpha');ok('abc');ok('A_b-c.d');ok("O'Brien");ok('Operator 417');ok('X'.repeat(16));ok('007 Agent');
  ok('  Alpha  ','Alpha');ok('Two   Spaces','Two Spaces');ok('  a   b   c  ','a b c');
  bad('ab','short');bad('','short');bad('   ','short');bad('X'.repeat(17),'long');bad('X'.repeat(65),'long');
  bad('_Alpha','edge');bad('Alpha_','edge');bad('-Alpha','edge');bad("Alpha'",'edge');bad('.Alpha','edge');bad('a . ','edge');
  for(const c of ['Al<pha','Al>pha','Al&pha','Al"pha','Al;pha','Al/pha','Al\\pha','Al(pha)','Al!pha','Al@pha','Al#pha','Al$pha','Al%pha','Al{pha}','Al`pha','Al~pha','Al=pha','Al+pha','Al*pha','Al,pha','Al:pha','Al?pha','Al|pha','Al^pha'])bad(c,'chars');
  bad(null,'type');bad(undefined,'type');bad(42,'type');bad({},'type');bad(['Alpha'],'type');bad(true,'type');
  bad({toString(){return 'Alpha';}},'type');
});

test('hostile unicode: control, zero-width, bidi, homoglyphs, emoji and whitespace are rejected, never stripped', async()=>{
  const {checkCallsign,acceptCallsign}=await names();
  const hostile=['Al\u0000pha','Al\u0007pha','Al\npha','Al\rpha','Al\tpha','Al\u007fpha','Al\u0085pha',
    'Al​pha','Al‌pha','Al‍pha','Al﻿pha','Al⁠pha','Al­pha',
    '‮Alpha','Alpha‮','Al‭pha','Al⁦pha','Al⁧pha','Al⁩pha','Al‎pha','Al‏pha',
    'Al pha','Al pha','Al　pha','Al pha','Al pha',
    'Аlpha' /* Cyrillic A */,'Alphа','Ａlpha' /* fullwidth A */,'Aĺpha' /* combining accent */,
    '😀Alpha','Alpha😀','Al\ud800pha' /* lone surrogate */,'Z̡͜͡alg̴o','العربية','Ａｌｐｈａ'];
  for(const raw of hostile){assert.equal(checkCallsign(raw).ok,false,'rejected: '+JSON.stringify(raw));assert.equal(acceptCallsign(raw).ok,false);}
  // Oversized input is rejected before any processing.
  assert.equal(checkCallsign('a'.repeat(1e6)).code,'long');
});

test('reserved names and the bot name pool cannot be claimed', async()=>{
  const {checkCallsign,checkTag}=await names(),{BOT_NAMES}=await rules();
  for(const raw of ['BOT','bot','Bot','Admin','ADMIN','admin','Server','SERVER','System','system','b o t','A.d.m.i.n','S_y_s_t_e_m','Bot 7','Bot9','admin01','server 2','System-'.slice(0,6),'  Admin  '])
    assert.equal(checkCallsign(raw).ok,false,raw+' is reserved');
  assert.equal(checkCallsign('Botanist').ok,true,'only exact reserved words, not words that merely start with them');
  assert.equal(checkCallsign('Administrator').ok,true);
  for(const name of BOT_NAMES){
    assert.equal(checkCallsign(name.toUpperCase()).code,'reserved',name+' is reserved for bots');
    assert.equal(checkCallsign(name.replace(/ /g,'')).code,'reserved','spacing does not bypass '+name);
  }
  assert.equal(checkTag('BOT').code,'reserved');assert.equal(checkTag('bot').code,'reserved');assert.equal(checkTag('GM').code,'reserved');
});

test('the bot name pool is valid, unique, bounded and Azeroth-flavoured', async()=>{
  const {BOT_NAMES,pickBotName}=await rules();
  assert.ok(BOT_NAMES.length>=40);assert.equal(new Set(BOT_NAMES.map(n=>n.toLowerCase())).size,BOT_NAMES.length);
  for(const n of BOT_NAMES){assert.ok(n.length>=3&&n.length<=16,n);assert.match(n,/^[A-Za-z0-9](?:[A-Za-z0-9 _\-.']*[A-Za-z0-9])?$/,n);}
  const used=new Set(),r=(()=>{let s=1;return ()=>(s=(s*16807)%2147483647)/2147483647;})();
  for(let i=0;i<BOT_NAMES.length;i++){const n=pickBotName(used,r);assert.ok(!used.has(n));used.add(n);}
  assert.equal(used.size,BOT_NAMES.length,'every pool entry is handed out once');
  assert.ok(pickBotName(used).length<=16,'fallback stays valid when the pool is exhausted');
});

test('profanity filter: leetspeak, spacing, repeats; no Scunthorpe false positives', async()=>{
  const {isProfane,acceptCallsign,normalizeForFilter}=await names();
  const w=(...p)=>p.join('');                       // keep the test source tame
  const f=w('fu','ck'),s=w('sh','it'),b=w('bi','tch');
  for(const raw of [f,f.toUpperCase(),w('fu','(k'),w('f u c k'),w('f.u.c.k'),w('fuuu','ccck'),w('5','h1','7'),w('$','hit'),w(b,'es'),w('b1','7ch'),w('xx',s,'xx'),w('mother',f,'er')])
    assert.equal(isProfane(raw),true,raw);
  for(const raw of ['Scunthorpe','Assassin','Classic','Bassist','Cockpit','Peacock','Dickens','Hancock','Therapist','Passage','Analyst','Cumberland','Document','Alpha','Operator 417','Leetspeak 1337','Gruntling','Ironforge Vet'])
    assert.equal(isProfane(raw),false,raw+' must be allowed');
  const r=acceptCallsign(f+'er',{random:()=>0});
  assert.equal(r.ok,true);assert.equal(r.replaced,true);assert.equal(r.name,'Operator 100');assert.match(r.notice,/not allowed/);
  assert.equal(acceptCallsign('Alpha').replaced,false);
  assert.equal(normalizeForFilter('5H1T!'),'shiti');
  // The word list is obfuscated at rest.
  const source=fs.readFileSync(path.join(__dirname,'..','src','names.mjs'),'utf8');
  assert.ok(!source.includes(f)&&!source.includes(s)&&!source.includes(b),'no plain-text entries in the source');
});

test('default callsigns follow Operator NNN and are valid', async()=>{
  const {defaultCallsign,checkCallsign}=await names();
  for(const v of [0,.25,.5,.999999,1]){const n=defaultCallsign(()=>v);assert.match(n,/^Operator [1-9]\d\d$/);assert.equal(checkCallsign(n).ok,true);}
  assert.equal(defaultCallsign(()=>0),'Operator 100');
});

test('clan tags: 2-4 letters or digits, upper-cased, optional', async()=>{
  const {checkTag}=await names();
  assert.deepEqual(checkTag(''),{ok:true,tag:''});assert.deepEqual(checkTag(undefined),{ok:true,tag:''});assert.deepEqual(checkTag(null),{ok:true,tag:''});assert.deepEqual(checkTag('   '),{ok:true,tag:''});
  assert.equal(checkTag('ab').tag,'AB');assert.equal(checkTag(' wow1 ').tag,'WOW1');assert.equal(checkTag('A1B2').tag,'A1B2');
  for(const bad of ['a','abcde','a b','a-b','a_b','<b>','[x]','Ａ１','​ab','ab‮',7,{},[],'x'.repeat(100)])assert.equal(checkTag(bad).ok,false,JSON.stringify(bad));
  assert.equal(checkTag('NAZI').ok,false,'profane tags are refused');
});

test('room uniqueness: case-insensitive, automatic numeric suffix, always within 16 characters', async()=>{
  const {uniqueName,checkCallsign}=await names();
  assert.equal(uniqueName('Alpha',[]),'Alpha');assert.equal(uniqueName('Alpha',['Bravo']),'Alpha');
  assert.equal(uniqueName('Alpha',['alpha']),'Alpha (2)');assert.equal(uniqueName('alpha',['ALPHA','Alpha (2)']),'alpha (3)');
  assert.equal(uniqueName('Alpha',['ALPHA','alpha (2)','Alpha (3)']),'Alpha (4)');
  const long='X'.repeat(16),u=uniqueName(long,[long]);assert.equal(u.length,16);assert.equal(u,'X'.repeat(12)+' (2)');
  const edge=uniqueName('Abcdefghijkl_-.m',['Abcdefghijkl_-.m']);assert.ok(edge.length<=16&&edge.endsWith(' (2)'));
  const taken=[];for(let i=0;i<30;i++){const n=uniqueName('Same',taken);assert.ok(!taken.map(t=>t.toLowerCase()).includes(n.toLowerCase()));assert.ok(n.length<=16);taken.push(n);}
  assert.equal(checkCallsign('Alpha (2)').ok,false,'players cannot type the suffix themselves');
});

test('one formatter: [TAG] Name, [BOT] for bots, plain text only', async()=>{
  const {formatName}=await names();
  assert.equal(formatName({name:'Alpha'}),'Alpha');assert.equal(formatName({name:'Alpha',tag:'WOW'}),'[WOW] Alpha');
  assert.equal(formatName({name:'Gruntling',bot:true}),'[BOT] Gruntling');assert.equal(formatName({name:'Gruntling',tag:'WOW',bot:true}),'[BOT] Gruntling','a bot tag cannot be overridden');
  assert.equal(formatName(null),'');assert.equal(formatName({}),'');
  assert.equal(formatName({name:'<img src=x onerror=alert(1)>',tag:'AB'}),'[AB] <img src=x onerror=alert(1)>','the formatter never escapes or interprets: callers use textContent');
});

test('XSS safety: no innerHTML/insertAdjacentHTML/outerHTML/document.write receives a player name', async()=>{
  const root=path.join(__dirname,'..'),files=[];
  const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(!['node_modules','assets','vendor'].includes(e.name))walk(p);}else if(/\.(js|mjs)$/.test(e.name))files.push(p);}};
  walk(path.join(root,'src'));walk(path.join(root,'public'));
  const sinks=/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write(?:ln)?)\b/;
  const nameLike=/\b(name|callsign|tag|baseName|playerName|winnerName|killer|victim|leader|host|player|remote|p\.|room\.players)\b/i;
  const offenders=[];let sinkLines=0;
  for(const file of files){
    const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
    lines.forEach((line,i)=>{
      if(!sinks.test(line))return;sinkLines++;
      // Only the statements that assign/insert are interesting; static markup literals are fine.
      for(const statement of line.split(';').filter(s=>sinks.test(s))){
        const dynamic=/\+|\$\{/.test(statement);
        if(dynamic&&nameLike.test(statement))offenders.push(path.relative(root,file)+':'+(i+1)+': '+statement.trim().slice(0,160));
      }
    });
  }
  assert.deepEqual(offenders,[],'dynamic HTML built from names:\n'+offenders.join('\n'));
  assert.ok(sinkLines>=1,'scanner actually visited HTML sinks');
  // Name-rendering code paths use textContent.
  for(const rel of ['src/lobby.js','src/match-ui.js']){
    const text=fs.readFileSync(path.join(root,rel),'utf8');
    assert.ok(/formatName\(/.test(text),rel+' uses the shared formatter');
    assert.ok(!/formatName\([^)]*\)[^;]*innerHTML/.test(text),rel+' never writes a formatted name as HTML');
  }
  const game=fs.readFileSync(path.join(root,'src/game.js'),'utf8');
  assert.ok(/networkName\(unit,formatName\(remote\)/.test(game),'nameplates use the shared formatter');
  assert.ok(/for\(const text of \[formatName\(p\)/.test(game),'scoreboard uses the shared formatter');
  assert.ok(/ctx\.fillText\(name,/.test(game),'nameplates are drawn on a canvas, never parsed as HTML');
});
