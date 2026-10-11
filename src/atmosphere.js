import * as T from 'three';

// Color grading and ordinary distance fog also affect the imported unlit WoW
// materials. No shadow maps, extra light sources, or fullscreen GPU passes.
export class CityAtmosphere {
  constructor({scene,hemi,sun,ambient}){Object.assign(this,{scene,hemi,sun,ambient});this.originalColors=new WeakMap();}
  apply(world,arena,setting='day'){
    const spooky=setting==='spooky';
    this.scene.background=new T.Color(spooky?0x101723:arena.sky);
    this.scene.fog=new T.Fog(spooky?0x1b2434:arena.fog,spooky?22:150,spooky?112:850);
    this.hemi.color.set(spooky?0xa0b5e5:0xd2e6ff);this.hemi.groundColor.set(spooky?0x302831:0x4c422f);this.hemi.intensity=spooky?.85:2.5;
    this.sun.color.set(spooky?0xa0b5f0:0xffe0aa);this.sun.intensity=spooky?.65:2;
    this.ambient.intensity=spooky?.24:.65;
    const tint=new T.Color(spooky?0x8396b6:0xffffff),seen=new Set();
    world.group.traverse(object=>{
      for(const material of [].concat(object.material||[])){
        if(!material.color||seen.has(material))continue;seen.add(material);
        if(!this.originalColors.has(material))this.originalColors.set(material,material.color.clone());
        material.color.copy(this.originalColors.get(material)).multiply(tint);
      }
    });
    return spooky?'spooky':'day';
  }
}
