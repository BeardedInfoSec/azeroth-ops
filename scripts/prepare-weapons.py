"""Convert a bounded set of local BO2 exports to browser-readable GLB + PNG."""
import hashlib, json, struct
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = root / 'cache/bo2'
dest = root / 'public/assets/weapons'
dest.mkdir(parents=True, exist_ok=True)
models = ['t6_wpn_ar_an94_view', 't6_attach_mag_an94_view', 't6_wpn_ar_scarh_view', 't6_attach_mag_scar_view'] + [n for gun in ['dsr50','ballista'] for n in ['t6_wpn_sniper_'+gun+'_view','t6_wpn_sniper_'+gun+'_scope_view','t6_attach_mag_'+gun+'_view']]
# Additional archetypes (SMG, assault, LMG, shotgun, pistol, sniper). Names come from the
# patched weapon definitions' gunModel / attachViewModel7 (magazine) / scope fields.
EXTRA = [
    't6_wpn_smg_mp7_view', 't6_attach_mag_mp7_view',
    't6_wpn_smg_vector_view', 't6_attach_mag_vector_view',
    't6_wpn_ar_type95_view', 't6_attach_mag_type95_view',
    't6_wpn_ar_sig556_view', 't6_attach_mag_sig556_view',
    't6_wpn_lmg_mk48_view',
    't6_wpn_shotty_870mcs_view',
    't6_wpn_pistol_fiveseven_view',
    't6_wpn_sniper_xpr50_view', 't6_wpn_sniper_xpr50_scope_view', 't6_attach_mag_xpr50_view',
]
models += EXTRA
hashes = {}

def sha256(data):
    return hashlib.sha256(data).hexdigest()
for name in models:
    data = (source / 'model_export' / (name + '_lod0.glb')).read_bytes()
    hashes[name] = {'source': sha256(data)}
    length = struct.unpack_from('<I', data, 12)[0]
    model = json.loads(data[20:20+length])
    for image in model.get('images', []):
        original = source / 'model_export' / image['uri']
        output = original.stem + '.png'
        with Image.open(original) as im:
            im.convert('RGBA').save(dest / output)
        image['uri'] = output
    for material in model.get('materials', []):
        material.pop('normalTexture', None)  # COD packed normals are not standard glTF normals.
        material['pbrMetallicRoughness']['roughnessFactor'] = .7
        material['pbrMetallicRoughness']['metallicFactor'] = .12
        if 'clan_tag' in material['name'] or 'player_icon' in material['name']:
            material['alphaMode'] = 'BLEND'
    encoded = json.dumps(model, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    tail = data[20+length:]
    output = b'glTF' + struct.pack('<II', 2, 20+len(encoded)+len(tail))
    output += struct.pack('<I', len(encoded)) + b'JSON' + encoded + tail
    (dest / (name + '.glb')).write_bytes(output)
    hashes[name]['output'] = sha256(output)
    print('Prepared', name)
(dest / 'provenance.json').write_text(json.dumps({'source': 'Installed Black Ops II / zone/all/common_mp.ff', 'tool': 'OpenAssetTools v0.33.0 Unlinker', 'models': models, 'hashes': hashes, 'animations': 'Prototype procedural handling, not original BO2 animation clips'}, indent=2))

for gun in ["dsr50", "ballista", "xpr50"]:
    with Image.open(source / "images" / ("scope_overlay_"+gun+"_1024.dds")) as im:
        im.save(dest / ("scope_overlay_"+gun+".png"))
