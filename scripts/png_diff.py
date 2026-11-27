"""Says how two PNG files differ: container, compression, or decoded pixels.

Diagnostic for the cross-platform comparison in CI. Standard library only, so
it does not depend on the imaging stack whose output it inspects. Handles
8-bit, non-interlaced greyscale, RGB and RGBA images; anything else is reported
as not decodable and the script exits 2 rather than guessing.

usage: python scripts/png_diff.py A.png B.png
exit:  0 pixels equal, 1 pixels differ, 2 could not compare
"""
from __future__ import annotations

import hashlib
import struct
import sys
import zlib
from pathlib import Path

CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}


class CannotDecode(Exception):
    pass


def read(path: Path) -> dict:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise CannotDecode(f"{path}: not a PNG file")
    chunks, idat, position = [], b"", 8
    while position < len(data):
        (length,) = struct.unpack(">I", data[position:position + 4])
        kind = data[position + 4:position + 8].decode("latin-1")
        body = data[position + 8:position + 8 + length]
        chunks.append((kind, length, hashlib.sha256(body).hexdigest()[:12]))
        if kind == "IHDR":
            width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", body)
        if kind == "IDAT":
            idat += body
        position += 12 + length
    if depth != 8 or colour not in CHANNELS or interlace != 0:
        raise CannotDecode(f"{path}: bit depth {depth}, colour type {colour}, interlace {interlace} is not handled")
    bpp = CHANNELS[colour]
    stride = width * bpp
    raw = zlib.decompress(idat)
    pixels = bytearray()
    previous = bytearray(stride)
    for row in range(height):
        start = row * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            left = line[i - bpp] if i >= bpp else 0
            up = previous[i]
            upper_left = previous[i - bpp] if i >= bpp else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                p = left + up - upper_left
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - upper_left)
                line[i] = (line[i] + (left if pa <= pb and pa <= pc else up if pb <= pc else upper_left)) & 255
            elif kind != 0:
                raise CannotDecode(f"{path}: unknown filter type {kind}")
        pixels += line
        previous = line
    return {
        "size": (width, height), "channels": bpp, "chunks": chunks, "pixels": bytes(pixels),
        "idat_bytes": len(idat), "zlib_header": idat[:2].hex(), "file_sha256": hashlib.sha256(data).hexdigest(),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        a, b = (read(Path(arg)) for arg in sys.argv[1:])
    except (CannotDecode, OSError, zlib.error, struct.error) as error:
        print(f"could not compare: {error}")
        return 2
    for name, image in zip(sys.argv[1:], (a, b)):
        print(f"{name}: sha256 {image['file_sha256']}, {image['size'][0]}x{image['size'][1]}, {image['channels']} channels, "
              f"IDAT {image['idat_bytes']} bytes, zlib header {image['zlib_header']}")
        print("  chunks: " + ", ".join(f"{kind}({length})" for kind, length, _ in image["chunks"]))
    metadata_a = [c for c in a["chunks"] if c[0] != "IDAT"]
    metadata_b = [c for c in b["chunks"] if c[0] != "IDAT"]
    print("non-image chunks: " + ("equal" if metadata_a == metadata_b else "DIFFER"))
    if a["size"] != b["size"] or a["channels"] != b["channels"]:
        print("result: dimensions or channel count differ")
        return 1
    if a["pixels"] == b["pixels"]:
        print("result: decoded pixels are EQUAL; the files differ only in how the same image is encoded")
        return 0
    width, bpp = a["size"][0], a["channels"]
    differing, largest, rows, columns = 0, 0, set(), set()
    for index in range(0, len(a["pixels"]), bpp):
        pa, pb = a["pixels"][index:index + bpp], b["pixels"][index:index + bpp]
        if pa != pb:
            differing += 1
            largest = max(largest, max(abs(x - y) for x, y in zip(pa, pb)))
            pixel = index // bpp
            rows.add(pixel // width)
            columns.add(pixel % width)
    total = len(a["pixels"]) // bpp
    print(f"result: decoded pixels DIFFER: {differing} of {total} pixels ({100 * differing / total:.3f}%), "
          f"largest channel difference {largest} of 255, within rows {min(rows)}-{max(rows)} and columns {min(columns)}-{max(columns)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
