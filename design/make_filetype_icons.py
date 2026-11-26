"""Clean, crop and shrink the file-type icons for the app.

Run from the project root after changing a source icon in design/filetypeicons/:
    python design/make_filetype_icons.py design/filetypeicons public/icons/filetypes icons-preview.png

For each source PNG: keep only the icon itself (the largest solid shape, plus its soft anti-aliased edge),
dropping the stray coloured specks left around it by background removal; crop to it; centre it on a square
transparent canvas; save 128 px copies for the app, plus a white-background preview sheet for checking.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

src_dir, out_dir, preview = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)
names = ['docx', 'excel', 'ppt', 'pdf', 'image', 'zip']
SIZE = 128
sheet = Image.new('RGB', (len(names) * 160 + 20, 380), 'white')

for i, name in enumerate(names):
    im = Image.open(src_dir / f'{name}.png').convert('RGBA')
    a = np.array(im)
    alpha = a[..., 3].astype(np.int32)
    body = alpha > 200                                   # the solid icon body
    lab, n = ndimage.label(body)
    sizes = ndimage.sum(body, lab, range(1, n + 1))
    keep = ndimage.binary_fill_holes(lab == (int(np.argmax(sizes)) + 1))
    edge = ndimage.binary_dilation(keep, iterations=6)  # its soft anti-aliased rim
    a[..., 3] = np.where(edge, alpha, 0).astype(np.uint8)
    ys, xs = np.where(edge & (alpha > 0))
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    icon = Image.fromarray(a).crop((x0, y0, x1, y1))
    # Square canvas with a little padding, icon centred.
    side = int(max(icon.size) * 1.04)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2), icon)
    small = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    small.save(out_dir / f'{name}.png', optimize=True)
    removed = int(((alpha > 0) & ~edge).sum())
    print(f'{name}: kept {icon.width}x{icon.height}, removed {removed:,} stray pixels -> {(out_dir / f"{name}.png").stat().st_size // 1024} KB')
    # Preview at the sizes the app uses, on white.
    x = 20 + i * 160
    for s, y in [(128, 20), (48, 170), (32, 240), (20, 300)]:
        t = small.resize((s, s), Image.LANCZOS)
        sheet.paste(t, (x, y), t)

sheet.save(preview)
