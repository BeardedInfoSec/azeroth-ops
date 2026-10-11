// Runs every World of Warcraft importer in sequence against one install path.
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=process.argv[2];if(!root){console.error('Usage: node scripts/import-wow-all.cjs "<path to WoW 3.3.5 12340 folder>"');process.exit(1);}
for(const script of ['import-wow.cjs','import-characters.cjs','import-props.cjs','import-zeppelin.cjs']){
  console.log('\n== '+script+' ==');const run=spawnSync(process.execPath,[path.join(__dirname,script),root],{stdio:'inherit'});
  if(run.status!==0){console.error(script+' failed (exit '+run.status+')');process.exit(run.status||1);}
}
console.log('\nWoW imports finished. BO2 imports: see README (import-bo2/effects/armory/audio .ps1).');
