import re
from PIL import Image, ImageDraw
src = open('charsets.js').read()
cset = [int(x) for x in re.search(r'VP_CSET = new Uint8Array\(\[([^\]]*)\]', src).group(1).split(',')]
GLYPHS = [36, 15, 16]          # V, P, +  (8244 character codes)
def icon(size, path):
    im = Image.new('RGB', (size, size), (19, 20, 24))
    d = ImageDraw.Draw(im)
    m = round(size * 0.14)                       # keep art inside the maskable safe zone
    d.rounded_rectangle([m, m + size * 0.06, size - m, size - m - size * 0.06], radius=size * 0.06, fill=(14, 61, 212))
    px = (size - 2 * m) * 0.84 / 24              # 3 glyphs x 8 px
    ox = (size - 24 * px) / 2 + px * 0.5; oy = (size - 7 * px) / 2
    for gi, g in enumerate(GLYPHS):
        colour = (244, 166, 42) if g == 16 else (255, 255, 255)
        for row in range(7):
            bits = cset[g * 8 + row]
            for b in range(8):
                if bits & (0x80 >> b):
                    x = ox + (gi * 8 + b) * px; y = oy + row * px
                    d.rectangle([x, y, x + px - 0.5, y + px - 0.5], fill=colour)
    im.save(path)
for s, n in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    icon(s, 'site/' + n)
print('ok')
