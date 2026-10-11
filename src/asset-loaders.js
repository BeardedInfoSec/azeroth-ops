import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetFetch} from './asset-cache.mjs';

// Limit image decoding as well as downloads. A city's many small textures should
// not all create Image elements and upload-ready pixel buffers at once.
const textureQueue=[];
let activeTextures=0;
function drainTextures(){
  while(activeTextures<2&&textureQueue.length){
    const job=textureQueue.shift();activeTextures++;
    Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{activeTextures--;drainTextures();});
  }
}

// The consumer must settle only after it has finished reading/decoding the URL.
// No blob URLs are retained in persistent storage or left alive after a load.
export async function withAssetObjectURL(url,consume){
  const response=await assetFetch(url);
  if(!response.ok)throw new Error('Asset '+url+': HTTP '+response.status);
  const objectURL=URL.createObjectURL(await response.blob());
  try{return await consume(objectURL);}finally{URL.revokeObjectURL(objectURL);}
}

export function loadCachedTexture(url){
  return new Promise((resolve,reject)=>{
    textureQueue.push({resolve,reject,run:()=>withAssetObjectURL(url,objectURL=>new THREE.TextureLoader().loadAsync(objectURL))});
    drainTextures();
  });
}

// One decoded texture per distinct URL in this model/city. Wait for all loads
// before failing, so late successful loads cannot leak after cleanup.
export async function loadCachedTextureSet(urls,configure=()=>{}){
  const textures=new Map();
  const results=await Promise.allSettled([...new Set(urls)].filter(Boolean).map(async url=>{
    const texture=await loadCachedTexture(url);
    try{configure(texture,url);}catch(error){texture.dispose();throw error;}
    textures.set(url,texture);
  }));
  const failure=results.find(result=>result.status==='rejected');
  if(failure){for(const texture of textures.values())texture.dispose();throw failure.reason;}
  return textures;
}

// GLB models here have external PNGs. Redirect those dependencies to cached
// blobs too; caching only the GLB would still download every gun texture again.
export async function loadCachedGLTF(url){
  const response=await assetFetch(url);
  if(!response.ok)throw new Error('Model '+url+': HTTP '+response.status);
  const bytes=await response.arrayBuffer(),view=new DataView(bytes);
  if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(16,true)!==0x4e4f534a)throw new Error('Invalid GLB '+url);
  const jsonLength=view.getUint32(12,true);
  if(jsonLength>bytes.byteLength-20)throw new Error('Truncated GLB '+url);
  const document=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)).trim());
  const sourceURL=new URL(url,globalThis.location?.href||'http://localhost/'),base=new URL('.',sourceURL).href;
  const dependencies=new Set([...document.images||[],...document.buffers||[]].map(item=>item.uri).filter(uri=>uri&&!/^(?:data|blob):/i.test(uri)).map(uri=>{
    const resolved=new URL(uri,base);
    if(resolved.origin!==sourceURL.origin||!resolved.pathname.startsWith('/assets/'))throw new Error('Model dependency outside local assets: '+uri);
    return resolved.href;
  }));
  const objectURLs=new Map();
  try{
    const results=await Promise.allSettled([...dependencies].map(async dependency=>{
      const resource=await assetFetch(dependency);
      if(!resource.ok)throw new Error('Model dependency '+dependency+': HTTP '+resource.status);
      objectURLs.set(dependency,URL.createObjectURL(await resource.blob()));
    }));
    const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    const manager=new THREE.LoadingManager();
    manager.setURLModifier(resource=>{
      if(/^(?:data|blob):/i.test(resource))return resource;
      const objectURL=objectURLs.get(new URL(resource,base).href);
      if(!objectURL)throw new Error('Uncached model dependency '+resource);
      return objectURL;
    });
    return await new GLTFLoader(manager).parseAsync(bytes,base);
  }finally{for(const objectURL of objectURLs.values())URL.revokeObjectURL(objectURL);}
}
