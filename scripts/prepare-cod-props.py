"""Prepare only the named BO2 perk machines and two cached knife models.

No game process is opened; run import-cod-props.ps1 to create bounded source
exports from the installed archives. The original installation is read-only.
"""
import argparse
import json
import struct
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MACHINES = {
    'juggernog': ('zm_transit', 'zombie_vending_jugg_on'),
    'quick_revive': ('zm_transit', 'zombie_vending_revive_on'),
    'double_tap': ('zm_transit', 'zombie_vending_doubletap2_on'),
    'speed_cola': ('zm_transit', 'zombie_vending_sleight_on'),
    'stamin_up': ('zm_transit', 'zombie_vending_marathon_on'),
    'tombstone': ('zm_transit', 'zombie_vending_tombstone_on'),
    'pack-a-punch': ('zm_transit', 'p6_anim_zm_buildable_pap_on'),
    'deadshot': ('zm_prison', 'p6_zm_al_vending_ads_on'),
    'phd_flopper': ('zm_prison', 'p6_zm_al_vending_nuke_on'),
    'electric_cherry': ('zm_prison', 'p6_zm_vending_electric_cherry_on'),
    'mule_kick': ('zm_buried', 'zombie_vending_three_gun_on'),
    'vulture_aid': ('zm_buried', 'p6_zm_vending_vultureaid_on'),
    'whos_who': ('zm_highrise', 'p6_zm_vending_chugabud_on'),
}
KNIVES = ['t6_wpn_knife_base_view', 't6_wpn_knife_melee']


def prepare(source, dest, model_name, output_name=None, glow=False):
    data = (source / 'model_export' / (model_name + '_lod0.glb')).read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    model = json.loads(data[20:20 + length])
    for material in model.get('materials', []):
        # COD packs normal channels differently from glTF.
        material.pop('normalTexture', None)
        material.pop('occlusionTexture', None)
        pbr = material.setdefault('pbrMetallicRoughness', {})
        pbr.pop('metallicRoughnessTexture', None)
        pbr['roughnessFactor'] = .72
        pbr['metallicFactor'] = .12
        if glow and material.get('name', '').endswith('_on') and pbr.get('baseColorTexture'):
            material['emissiveTexture'] = dict(pbr['baseColorTexture'])
            material['emissiveFactor'] = [.48, .48, .48]
        if 'glass' in material.get('name', ''):
            material['alphaMode'] = 'BLEND'
            pbr['baseColorFactor'] = [1, 1, 1, .38]

    refs = []
    def find_textures(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.endswith('Texture') and isinstance(child, dict) and 'index' in child:
                    refs.append(child)
                else:
                    find_textures(child)
        elif isinstance(value, list):
            for child in value:
                find_textures(child)
    find_textures(model.get('materials', []))
    used = sorted({ref['index'] for ref in refs})
    remap = {old: new for new, old in enumerate(used)}
    textures = [model['textures'][index] for index in used]
    images, image_remap = [], {}
    dest.mkdir(parents=True, exist_ok=True)
    for texture in textures:
        old = texture['source']
        if old not in image_remap:
            image_remap[old] = len(images)
            original = source / 'model_export' / model['images'][old]['uri']
            output = original.stem + '.png'
            with Image.open(original) as image:
                # Keep these static props modest on browser memory, including DLC textures.
                image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                image.convert('RGBA').save(dest / output)
            images.append({'uri': output})
        texture['source'] = image_remap[old]
    for ref in refs:
        ref['index'] = remap[ref['index']]
    model['textures'], model['images'] = textures, images
    encoded = json.dumps(model, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    tail = data[20 + length:]
    output = b'glTF' + struct.pack('<II', 2, 20 + len(encoded) + len(tail))
    output += struct.pack('<I', len(encoded)) + b'JSON' + encoded + tail
    (dest / ((output_name or model_name) + '.glb')).write_bytes(output)
    print('Prepared', model_name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--knife-only', action='store_true')
    args = parser.parse_args()
    weapons = ROOT / 'public/assets/weapons'
    for name in KNIVES:
        prepare(ROOT / 'cache/bo2', weapons, name, name + '_lod0')
    (weapons / 'knife-provenance.json').write_text(json.dumps({
        'source': 'Installed Black Ops II / zone/all/common_mp.ff',
        'tool': 'OpenAssetTools v0.33.0 Unlinker',
        'models': KNIVES,
        'animation': 'Procedural handling, not original BO2 animation clips',
    }, indent=2), encoding='utf-8')
    if args.knife_only:
        return
    destination = ROOT / 'public/assets/machines'
    entries = {}
    for perk, (archive, name) in MACHINES.items():
        prepare(ROOT / ('cache/bo2-machines-' + archive), destination, name, glow=True)
        entries[perk] = {'model': '/assets/machines/' + name + '.glb', 'sourceModel': name, 'sourceArchive': archive + '.ff'}
    (destination / 'manifest.json').write_text(json.dumps({'version': 1, 'machines': entries}, indent=2), encoding='utf-8')
    (destination / 'provenance.json').write_text(json.dumps({
        'source': 'User-installed Call of Duty Black Ops II',
        'tool': 'OpenAssetTools v0.33.0 Linker and Unlinker; named model selection only',
        'models': entries,
        'conversion': 'Original LOD0 meshes and diffuse textures; PNG max 1024; authored lit surfaces use emissive materials; COD shaders and machine animations are not reproduced.',
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
