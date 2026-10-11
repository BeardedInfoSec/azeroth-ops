"""Prepare the BO2 scorestreak sentry gun turret (one named model).

Reads a bounded OpenAssetTools export (cache/bo2 from import-bo2.ps1, or
cache/bo2-sentry from import-sentry.ps1), converts its colour textures to PNG
(max 1024) and records provenance with SHA-256 hashes. The installation is
never modified; no browser or GPU is involved.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = 't6_wpn_turret_sentry_gun'
# Tags the client animates; recorded so tests can verify the export kept them.
TAGS = ['tag_origin', 'tag_aim', 'tag_aim_pitch', 'tag_flash', 'tag_brass', 'tag_spin']


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_prepare():
    spec = importlib.util.spec_from_file_location('prepare_cod_props', ROOT / 'scripts/prepare-cod-props.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.prepare


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT / 'cache/bo2')
    args = parser.parse_args()
    source = args.source
    raw = source / 'model_export' / (MODEL + '_lod0.glb')
    if not raw.is_file():
        raise SystemExit('Missing ' + str(raw) + '; run scripts/import-sentry.ps1 first.')
    dest = ROOT / 'public/assets/streaks'
    load_prepare()(source, dest, MODEL)
    out = dest / (MODEL + '.glb')
    data = out.read_bytes()
    length = int.from_bytes(data[12:16], 'little')
    gltf = json.loads(data[20:20 + length])
    names = {node.get('name') for node in gltf['nodes']}
    missing = [tag for tag in TAGS if tag not in names]
    if missing:
        raise SystemExit('Sentry export lacks tags: ' + ', '.join(missing))
    textures = []
    for image in gltf.get('images', []):
        png = dest / image['uri']
        textures.append({'file': image['uri'], 'sha256': sha256(png)})
    (dest / 'provenance.json').write_text(json.dumps({
        'source': 'User-installed Call of Duty Black Ops II',
        'tool': 'OpenAssetTools v0.33.0 Unlinker; named xmodel export only',
        'archive': 'zone/all/common_mp.ff',
        'sourceModel': MODEL,
        'sourceModelSha256': sha256(raw),
        'model': '/assets/streaks/' + MODEL + '.glb',
        'modelSha256': sha256(out),
        'textures': textures,
        'tags': TAGS,
        'conversion': 'Original LOD0 skinned mesh; colour textures only as PNG (max 1024); COD packed normal/spec maps dropped; no original turret animation or sound is reproduced (procedural yaw, pitch and recoil bones).',
    }, indent=2), encoding='utf-8')
    print('Prepared', MODEL, len(textures), 'textures')


if __name__ == '__main__':
    main()
