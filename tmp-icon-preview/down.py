import os
from PIL import Image

src = r"E:\my\build\icon.png"
out = r"E:\my\tmp-icon-preview"
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert("RGBA")
print("mode", im.mode, "size", im.size)
a = im.getchannel("A")
print("alpha extrema:", a.getextrema())
for s in (256, 64, 32, 16):
    small = im.resize((s, s), Image.LANCZOS)
    small.save(os.path.join(out, "n%d.png" % s))
    small.resize((s * 8, s * 8), Image.NEAREST).save(os.path.join(out, "z%d.png" % s))
    print("wrote", s)
