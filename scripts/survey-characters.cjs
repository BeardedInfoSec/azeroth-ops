const {WowArchive,dbc}=require('./wow-archive.cjs');
const a=new WowArchive();
console.log(a.files.filter(n=>/^(creature\\(ghoul|zombie|skeleton)|character\\)/i.test(n)&&/\.m2$/i.test(n)).join('\n'));
const d=dbc(a.read('DBFilesClient/CreatureDisplayInfoExtra.dbc'));
console.log('EXTRA',d.rows.length,d.rows[0],d.str(d.rows[0].at(-1)));
require('fs').writeFileSync('cache/npc-extra.json',JSON.stringify(d.rows.map(r=>({r,texture:d.str(r.at(-1))}))));
for(const race of [1,2,3,4,5,6,7,8,10,11])console.log('RACE',race,d.rows.filter(r=>r[1]===race&&r[2]===0&&r[7]===0&&r[8]===0&&r[12]>0&&r[15]>0).slice(0,4).map(r=>({r,tex:d.str(r.at(-1))})));
a.close();
