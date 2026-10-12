const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const {createAssetCatalog,TYPES} = require('../server/asset-catalog.cjs');
const {createMapLayouts,CITIES} = require('../server/map-layouts.cjs');
const ROOT = path.resolve(__dirname, '..');
const types = {...TYPES,'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};
function resolveFile(url, root = ROOT) {
  let name;try{name=decodeURIComponent(new URL(url,'http://localhost').pathname);}catch{return null;}
  const routes = [['/vendor/three/', 'node_modules/three/'], ['/vendor/bvh/', 'node_modules/three-mesh-bvh/'], ['/src/', 'src/']];
  const route=routes.find(([prefix])=>name.startsWith(prefix));
  const base=path.resolve(root,route?route[1]:'public');
  const file=path.resolve(base,route?name.slice(route[0].length):'.'+(name==='/'?'/index.html':name));
  return file.startsWith(base+path.sep)?file:null;
}
function acceptsGzip(header = '') {
  const encodings = header.split(',').map(item => {
    const [name,...params] = item.trim().toLowerCase().split(';');
    const quality = params.find(value => value.trim().startsWith('q='));
    return {name,q:quality ? Number(quality.trim().slice(2)) : 1};
  });
  return (encodings.find(item => item.name === 'gzip') || encodings.find(item => item.name === '*'))?.q > 0;
}
function freshRequest(req, etag, modified) {
  const condition = req.headers['if-none-match'];
  if(condition !== undefined) return condition.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//,'') === etag.replace(/^W\//,''));
  const since = Date.parse(req.headers['if-modified-since'] || '');
  return Number.isFinite(since) && Math.floor(modified.getTime()/1000) <= Math.floor(since/1000);
}
// Editor overlays run the game's own fortification/machine placement on the CPU. The
// service (and the full arena it loads) is only created when the editor asks.
function lazyOverlayService() {
  let service;
  return {get:async(city,fortifications) => {
    service ||= import('../server/editor-overlays.mjs').then(async({createOverlayService}) => createOverlayService({loadArena:(await import('../server/world.mjs')).loadArena}));
    return (await service).get(city,fortifications);
  }};
}
async function handleOverlays(req,res,pathname,overlays) {
  if(pathname !== '/api/editor/overlays') return false;
  const send = (status,value,headers = {}) => {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));};
  if(req.method !== 'GET' && req.method !== 'HEAD') {send(405,{error:'Method not allowed'},{'Allow':'GET, HEAD'});return true;}
  const params = new URL(req.url,'http://localhost').searchParams,city = params.get('city'),fortifications = params.get('fortifications') || 'light';
  if(!CITIES.has(city)) {send(400,{error:'Unknown city'});return true;}
  if(!['light','classic','off'].includes(fortifications)) {send(400,{error:'Unknown fortification preset'});return true;}
  try {send(200,await overlays.get(city,fortifications));}
  catch(error) {console.error('Editor overlays:',error.message);send(503,{error:'Overlay placements are unavailable. Check the imported city files.'});}
  return true;
}
function createAssetServer({root = ROOT, catalog = createAssetCatalog({assetRoot:path.join(root,'public/assets')}), layouts = createMapLayouts({root}), overlays = lazyOverlayService()} = {}) {
  const server = http.createServer(async(req,res) => {
    let pathname;
    try { pathname = new URL(req.url,'http://localhost').pathname; } catch {res.writeHead(400);res.end();return;}
    if(await layouts.handle(req,res,pathname))return;
    if(await handleOverlays(req,res,pathname,overlays))return;
    if(req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    if(pathname === '/api/server') {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const port=server.address()?.port||8097;
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({version:'0.14.0',multiplayer:true,addresses:Object.values(os.networkInterfaces()).flat().filter(n=>n.family==='IPv4'&&!n.internal).map(n=>'http://'+n.address+':'+port)}));return;
    }
    if(pathname === '/api/assets/manifest') {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      try {const manifest = await catalog.getManifest();res.end(req.method === 'HEAD' ? undefined : JSON.stringify(manifest));}
      catch(error) {console.error('Asset catalog:',error.message);res.writeHead(503);res.end(req.method === 'HEAD' ? undefined : JSON.stringify({error:'Asset catalog unavailable. Check imported runtime files.'}));}
      return;
    }
    const file = resolveFile(req.url,root);
    let stat;
    try {stat = file && await fs.promises.stat(file);} catch {}
    if(!stat?.isFile()) {res.writeHead(404);res.end('Not found');return;}
    const compressed = /\.(json|js|mjs|css|html|svg)$/i.test(file);
    const gzip = compressed && acceptsGzip(req.headers['accept-encoding']);
    const etag = 'W/"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + (gzip ? '-gzip' : '') + '"';
    res.setHeader('Content-Type',types[path.extname(file).toLowerCase()]||'application/octet-stream');
    // These URLs are stable between imports. Revalidate the HTTP cache; the
    // explicit browser packs use manifest revisions for durable local copies.
    res.setHeader('Cache-Control',file.includes(path.sep+'assets'+path.sep)?'public, no-cache':'no-cache');
    res.setHeader('ETag',etag);res.setHeader('Last-Modified',stat.mtime.toUTCString());
    if(compressed) res.setHeader('Vary','Accept-Encoding');
    if(gzip) res.setHeader('Content-Encoding','gzip');
    if(freshRequest(req,etag,stat.mtime)) {res.writeHead(304);res.end();return;}
    if(!gzip) res.setHeader('Content-Length',stat.size);
    if(req.method === 'HEAD') {res.end();return;}
    const stream = fs.createReadStream(file);
    stream.on('error',() => {if(!res.headersSent) {res.removeHeader('Content-Length');res.writeHead(500);res.end('Read failed');} else res.destroy();});
    res.on('close',() => stream.destroy());
    if(gzip) {const encoder=zlib.createGzip({level:1});encoder.on('error',() => res.destroy());stream.pipe(encoder).pipe(res);}
    else stream.pipe(res);
  });
  return server;
}
const server=createAssetServer();
if(require.main===module)import('../server/multiplayer.mjs').then(async({attachMultiplayer})=>{
  const {createProfileStore}=await import('../server/profiles.mjs');
  // LAN gag profiles: token-keyed JSON file, no accounts. See README "Sessions and ranks".
  const profiles=createProfileStore({file:process.env.AO_PROFILES||path.join(ROOT,'data','profiles.json'),log:m=>console.warn(m)});
  const net=attachMultiplayer(server,{profiles});for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{profiles.close();process.exit(0);});server.listen(Number(process.env.PORT)||8097,process.env.HOST||'0.0.0.0',()=>console.log('Azeroth Ops LAN: http://127.0.0.1:'+(process.env.PORT||8097)));
}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={handleOverlays,resolveFile,server,createAssetServer,acceptsGzip,freshRequest};
