import * as THREE from 'three';
import {loadCachedTexture} from './asset-loaders.js';
import {createMuzzleEffect,createMuzzlePool} from './muzzle-effects.mjs';
export {createMuzzleLights} from './muzzle-effects.mjs';
const atlases=new Map(),pending=[];
for(const name of ['fxt_fire_gas_flash','fxt_fire_flame_vert_c','fxt_fire_flame_vert_e']){
  const frames=[];
  for(let i=0;i<2;i++){
    const texture=new THREE.Texture();texture.colorSpace=THREE.SRGBColorSpace;texture.repeat.set(.5,1);texture.offset.set(i*.5,0);frames.push(texture);
  }
  atlases.set(name,frames);
  pending.push(loadCachedTexture('/assets/effects/'+name+'.png').then(source=>{
    // Materials already hold these frame textures; fill them without replacing
    // their identities. Both frames share the single decoded atlas image.
    for(const texture of frames){texture.image=source.image;texture.needsUpdate=true;}
    source.dispose();
  }));
}
export const muzzleAssetsReady=Promise.allSettled(pending).then(results=>{
  const failure=results.find(result=>result.status==='rejected');
  if(failure){for(const frames of atlases.values())frames.forEach(texture=>texture.dispose());throw failure.reason;}
});
// Original BO2 texture atlases. Timing/layer playback is local, not the native FX graph.
export function createMuzzle(lights){return createMuzzleEffect(atlases,lights);}
export function createWorldMuzzlePool(scene,lights,capacity=16){return createMuzzlePool(scene,()=>createMuzzle(lights),capacity);}
