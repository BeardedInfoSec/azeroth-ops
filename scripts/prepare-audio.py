"""Copy original BO2 PCM recordings and describe our local gameplay cue schedules.

Run scripts/import-audio.ps1 first. No game files are modified; no audio is
synthesized, resampled, normalized or re-encoded by this preparation step.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import shutil
import wave

ROOT = Path(__file__).resolve().parents[1]
DUMP = ROOT / 'cache/bo2-audio'
OUTPUT = ROOT / 'public/assets/audio'
ALIAS_FILE = DUMP / 'soundbank/mpl_common.all.aliases.csv'


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-path', type=Path, default=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Call of Duty Black Ops II'))
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    aliases = {}
    with ALIAS_FILE.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            aliases.setdefault(row['Name'].lower(), []).append(row)
    files, sources = {}, {}

    def clip(alias):
        rows = aliases.get(alias.lower())
        if not rows:
            raise ValueError(f'Missing BO2 sound alias: {alias}')
        row = rows[0]
        original = row['FileSource']
        relative = original.replace('\\', '/').removeprefix('raw/')
        path = DUMP / relative
        if not path.is_file():
            raise FileNotFoundError(f'Missing recording for {alias}: {path}')
        if original not in sources:
            digest = sha256(path)
            basename = path.name.split('.')[0] + '-' + digest[:10] + '.wav'
            destination = OUTPUT / basename
            shutil.copyfile(path, destination)
            with wave.open(str(destination), 'rb') as audio:
                if audio.getcomptype() != 'NONE' or audio.getsampwidth() != 2:
                    raise ValueError(f'Expected original PCM16 WAV: {path}')
                format_info = {'channels': audio.getnchannels(), 'sampleRate': audio.getframerate(),
                               'bitsPerSample': audio.getsampwidth()*8, 'frames': audio.getnframes(),
                               'duration': audio.getnframes()/audio.getframerate()}
            url = '/assets/audio/' + basename
            sources[original] = url
            files[url] = {'sha256': digest, 'sourcePath': original, 'bytes': destination.stat().st_size,
                          'aliases': [], 'format': format_info}
        url = sources[original]
        if alias not in files[url]['aliases']:
            files[url]['aliases'].append(alias)
        return url

    def cue(at, alias):
        return {'at': at, 'clips': [clip(alias)], 'alias': alias}

    weapons = {}
    specs = [
        ('an94_mp', 'an94', [(0.30, 'mag_out'), (1.50, 'mag_in')], [(2.25, 'bolt_back'), (2.60, 'bolt_release')], []),
        ('scar_mp', 'scar', [(0.28, 'mag_out'), (1.40, 'mag_in'), (1.87, 'tap')], [(2.27, 'bolt_back'), (2.62, 'bolt_release')], []),
        ('dsr50_mp', 'dsr50', [(0.45, 'mag_out'), (2.15, 'mag_in')], [(2.80, 'bolt_up'), (2.94, 'bolt_back'), (3.27, 'bolt_forward'), (3.48, 'bolt_down')], [(0.40, 'bolt_up'), (0.53, 'bolt_back'), (0.97, 'bolt_forward'), (1.15, 'bolt_down')]),
        ('ballista_mp', 'ballista', [(0.35, 'mag_out'), (1.92, 'mag_in'), (2.38, 'tap')], [(2.68, 'bolt_up'), (2.82, 'bolt_back'), (3.10, 'bolt_forward'), (3.32, 'bolt_down')], [(0.30, 'bolt_up'), (0.42, 'bolt_back'), (0.80, 'bolt_forward'), (1.02, 'bolt_down')]),
        # Additional archetypes. Cue times are local reconstructions scaled by the
        # weapon's reload time; aliases are the original fly_<gun>_* foley.
        ('mp7_mp', 'mp7', [(0.35, 'mag_out'), (1.15, 'mag_in')], [(1.95, 'charge')], []),
        ('vector_mp', 'vector', [(0.40, 'mag_out'), (1.40, 'mag_in')], [(2.15, 'charge')], []),
        ('type95_mp', 'type95', [(0.35, 'mag_out'), (1.55, 'mag_in')], [(2.45, 'bolt_back'), (2.80, 'bolt_release')], []),
        ('sig556_mp', 'sig556', [(0.35, 'mag_out'), (1.40, 'mag_in')], [(2.20, 'bolt_back'), (2.55, 'bolt_release')], []),
        ('mk48_mp', 'mk48', [(0.60, 'open'), (1.80, 'mag_out'), (3.20, 'lift_belt'), (4.60, 'mag_in'), (5.60, 'seat_belt'), (6.50, 'close')], [(7.20, 'pull'), (7.70, 'release')], []),
        ('870mcs_mp', '870mcs', [(0.10, 'shell_in')], [(0.30, 'pull'), (0.45, 'release')], [(0.15, 'pull'), (0.35, 'release')]),
        ('fiveseven_mp', 'fiveseven', [(0.30, 'mag_out'), (1.00, 'mag_in')], [(1.45, 'slide_back'), (1.65, 'slide_forward')], []),
        ('as50_mp', 'as50', [(0.40, 'mag_out'), (2.30, 'mag_in')], [(3.20, 'bolt_up'), (3.40, 'bolt_back'), (3.70, 'bolt_forward'), (3.95, 'bolt_down')], []),
    ]
    for gun_id, prefix, reload_cues, empty_extra, bolt_cues in specs:
        make = lambda data: [cue(at, 'fly_' + prefix + '_' + event) for at, event in data]
        shot_alias = 'wpn_' + prefix + '_fire_plr'
        remote_alias = 'wpn_' + prefix + '_fire_npc'
        weapons[gun_id] = {'shot': [clip(shot_alias)], 'shotAlias': shot_alias,
                           'remoteShot': [clip(remote_alias)], 'remoteShotAlias': remote_alias,
                           'reload': make(reload_cues), 'reloadEmpty': make(reload_cues + empty_extra),
                           'bolt': make(bolt_cues)}

    inputs = []
    # Record both alias-bearing zones and the sample banks available to the
    # exporter. Per-recording hashes above identify exactly what is published.
    for relative in ['zone/all/code_post_gfx_mp.ff', 'zone/all/common_mp.ff',
                     'sound/cmn_root.all.sabl', 'sound/cmn_root.all.sabs',
                     'sound/mpl_code_post_gfx.all.sabl', 'sound/mpl_code_post_gfx.all.sabs',
                     'sound/mpl_common.all.sabl', 'sound/mpl_common.all.sabs']:
        path = args.game_path / relative
        if path.is_file():
            inputs.append({'path': relative, 'bytes': path.stat().st_size, 'sha256': sha256(path)})
    manifest = {
        'version': 1,
        'source': {'game': 'Call of Duty: Black Ops II', 'tool': 'OpenAssetTools Unlinker v0.33.0',
                   'aliasBank': 'mpl_common.all', 'aliasCsvSha256': sha256(ALIAS_FILE), 'inputs': inputs,
                   'recordings': 'Original PCM WAV samples copied byte-for-byte from the installed game sound banks.',
                   'timing': 'Reload and bolt cue schedules are local reconstructions in seconds, not extracted animation notetracks.',
                   'mixing': 'Primary unsuppressed player firing samples; native BO2 secondary LFE/decay/context alias mixing is not reproduced.',
                   'reuse': 'The original alias bank maps all four NPC firing aliases to their player recording; assault and sniper reload Foley is shared across weapons according to the original aliases.',
                   'rebuild': 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/import-audio.ps1'},
        'weapons': weapons, 'files': files,
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(f'Prepared {len(files)} original WAV recordings for {len(weapons)} weapons ({sum(f["bytes"] for f in files.values()):,} bytes).')


if __name__ == '__main__':
    main()
