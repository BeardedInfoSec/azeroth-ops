"""Decode locally extracted BLP textures with Pillow's BLP decoder."""
from pathlib import Path
import sys
from PIL import Image
source, target = map(Path, sys.argv[1:3])
target.mkdir(parents=True, exist_ok=True)
count = 0
files = (source / name for name in sys.argv[3:]) if len(sys.argv) > 3 else source.glob('*.blp')
for file in files:
    with Image.open(file) as image:
        image = image.convert('RGBA')
        image.thumbnail((512, 512))
        image.save(target / (file.stem + '.png'), optimize=True)
        count += 1
print(f'Decoded {count} BLP textures')
