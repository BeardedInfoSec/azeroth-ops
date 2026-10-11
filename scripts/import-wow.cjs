// Read-only local Wrath 3.3.5 WMO importer. No game files are modified.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MPQArchive } = require('../vendor/mpq/mpq');
const source = process.argv[2] || 'D:/Recovered/World of Warcraft Wrath of the Lich King - Copy';
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/assets');
const cache = path.join(root, 'cache/blp');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(cache, { recursive: true });
const archives = ['patch-3.MPQ','patch-2.MPQ','patch.MPQ','lichking.MPQ','expansion.MPQ','common-2.MPQ','common.MPQ']
  .filter(f => fs.existsSync(path.join(source, 'Data', f)))
  .map(f => new MPQArchive(path.join(source, 'Data', f)));
function read(name) {
  for (const a of archives) { const b = a.extractFile(name); if (b) return Buffer.from(b); }
  throw new Error('Missing archive asset: ' + name);
}
function chunks(b, start=0) {
  const result = {};
  for(let p=start;p+8<=b.length;) {
    const id=b.toString('ascii',p,p+4).split('').reverse().join('');
    const len=b.readUInt32LE(p+4);
    if(p+8+len>b.length) throw new Error('Invalid WMO chunk '+id);
    if(!result[id]) result[id]=b.subarray(p+8,p+8+len);
    p+=8+len;
  }
  return result;
}
const str=(b,p)=> b.toString('utf8',p, b.indexOf(0,p)<0?b.length:b.indexOf(0,p));
const floats=b=>Array.from({length:b.length/4},(_,i)=>+b.readFloatLE(i*4).toFixed(5));
const textureMap=new Map();
function texture(name) {
  if(!name) return null;
  const key=name.toLowerCase();
  if(textureMap.has(key)) return textureMap.get(key);
  const id=require('node:crypto').createHash('sha1').update(key).digest('hex').slice(0,16);
  fs.writeFileSync(path.join(cache,id+'.blp'),read(name));
  textureMap.set(key,'/assets/textures/'+id+'.png');
  return textureMap.get(key);
}
const cities = [
  ['stormwind','Stormwind','World\\wmo\\Azeroth\\Buildings\\Stormwind\\Stormwind.wmo'],
  ['dalaran','Dalaran','World\\wmo\\Northrend\\Dalaran\\ND_Dalaran.wmo'],
  ['darnassus','Darnassus','World\\wmo\\Kalimdor\\Darnassis\\Darnassis.wmo']
];
try {
for(const [id,name,file] of cities) {
  console.log('Importing '+name);
  const c=chunks(read(file));
  if(c.MVER.readUInt32LE(0)!==17) throw new Error('Expected WMO v17');
  const materials=[];
  for(let p=0;p<c.MOMT.length;p+=64) {
    materials.push({flags:c.MOMT.readUInt32LE(p),blend:c.MOMT.readUInt32LE(p+8),texture:texture(str(c.MOTX,c.MOMT.readUInt32LE(p+12)))});
  }
  const groups=[];
  const count=c.MOHD.readUInt32LE(4);
  for(let i=0;i<count;i++) {
    const groupFile=file.replace(/\.wmo$/i,'_'+String(i).padStart(3,'0')+'.wmo');
    const g=chunks(read(groupFile)).MOGP;
    const sub=chunks(g,68);
    if(!sub.MOVT||!sub.MOVI||!sub.MOBA) continue;
    const positions=floats(sub.MOVT);
    // Right-handed Z-up WoW -> right-handed Y-up Three.js.
    for(let j=0;j<positions.length;j+=3) { const y=positions[j+1];positions[j+1]=positions[j+2];positions[j+2]=-y; }
    const batches=[];
    for(let j=0;j<sub.MOBA.length;j+=24) batches.push({start:sub.MOBA.readUInt32LE(j+12),count:sub.MOBA.readUInt16LE(j+16),material:sub.MOBA[j+23]});
    const groupName=str(c.MOGN,g.readUInt32LE(0));
    groups.push({name:groupName,id:i,positions,uv:sub.MOTV?floats(sub.MOTV):[],indices:Array.from({length:sub.MOVI.length/2},(_,j)=>sub.MOVI.readUInt16LE(j*2)),batches});
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let j=0;j<positions.length;j++) {lo[j%3]=Math.min(lo[j%3],positions[j]);hi[j%3]=Math.max(hi[j%3],positions[j]);}
    console.log(' ',i,groupName,positions.length/3,'verts',lo.map(Math.round),hi.map(Math.round));
  }
  fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify({id,name,source:file,materials,groups}));
}
} finally {for(const a of archives)a.close();}
fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({client:source,build:12340,imported:new Date().toISOString(),cities:cities.map(([id,name,file])=>({id,name,file})),textures:textureMap.size},null,2));
const conversion=spawnSync('py',['-3.11',path.join(__dirname,'textures.py'),cache,path.join(out,'textures')],{stdio:'inherit'});
if(conversion.status!==0) process.exit(conversion.status||1);
console.log('Import complete. '+textureMap.size+' textures.');
