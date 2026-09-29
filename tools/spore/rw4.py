"""Decode Spore RenderWare 4 textures (.rw4, type 0x2F4E681B) to PIL images.

The raster header sits at the D3D format code (DXT1/DXT3/DXT5):
    fourcc u32, flags u32, ptr u32, width u16, height u16, depth u8, mip_count u8
Pixel data (all mip levels, largest first) is the tail of the file.
(The same resource type also holds 3D models; those have no raster header.)
"""
import io
import struct

from PIL import Image

FORMATS = {b'DXT1': 8, b'DXT3': 16, b'DXT5': 16}


def info(data):
    for fc in FORMATS:
        i = data.find(fc, 0, 65536)
        if i >= 0:
            w, h = struct.unpack_from('<HH', data, i + 12)
            mips = data[i + 17]
            return fc, w, h, max(1, mips)
    return None


def mip_sizes(fc, w, h, mips):
    bs = FORMATS[fc]
    out = []
    for _ in range(mips):
        out.append(max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * bs)
        w, h = max(1, w // 2), max(1, h // 2)
    return out


def decode(data):
    inf = info(data)
    if not inf:
        return None
    fc, w, h, mips = inf
    sizes = mip_sizes(fc, w, h, mips)
    start = len(data) - sum(sizes)
    if start < 0:
        return None
    body = data[start:start + sizes[0]]
    # wrap in a DDS header and let Pillow decode the block compression
    ddspf = struct.pack('<II4s5I', 32, 0x4, fc, 0, 0, 0, 0, 0)
    hdr = (b'DDS ' + struct.pack('<7I', 124, 0x1007 | 0x80000, h, w, len(body), 0, 1)
           + bytes(44) + ddspf + struct.pack('<5I', 0x1000, 0, 0, 0, 0))
    return Image.open(io.BytesIO(hdr + body)).convert('RGBA')
