import json,hashlib
from pathlib import Path
from PIL import Image
out=Path('public/assets/effects');out.mkdir(parents=True,exist_ok=True)
entries=[]
for name in ['fxt_fire_gas_flash','fxt_fire_flame_vert_e','fxt_fire_flame_vert_d','fxt_fire_flame_vert_c']:
 source=Path('cache/bo2-core/images')/(name+'.dds');im=Image.open(source);im.save(out/(name+'.png'));entries.append({'image':name,'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'size':im.size,'file':'/assets/effects/'+name+'.png'})
weapons={}
for name in ['an94_mp','scar_mp']:
 words=Path('cache/bo2-fx/weapons',name).read_text().split('\\');weapons[name]={key:words[words.index(key)+1] for key in ['viewFlashEffect','worldFlashEffect','viewShellEjectEffect']}
(out/'provenance.json').write_text(json.dumps({'game':'Black Ops II','images':entries,'weapons':weapons,'limitation':'Original DDS images converted to PNG. FX element graphs are not exported by OpenAssetTools; timing, sizing and layer playback are implemented locally.'},indent=2))
