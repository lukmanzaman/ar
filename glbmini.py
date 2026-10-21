#!/usr/bin/env python3
"""
GLB Minifier (glbmini.py)
-------------------------
Membaca model 3D GLB dan mengompresi tekstur-tekstur di dalamnya
menjadi JPEG (default kompresi 75%).
Tidak ada yang diubah selain kompresi tekstur dan pembaruan tautan/mimeType.
Output file default: <namafileasli>-kecil.glb

Penggunaan:
    python glbmini.py <namafileglbinput>
    python glbmini.py <namafileglbinput> --quality 75
    python glbmini.py <namafileglbinput> -q 80 -o custom-output.glb
"""

import sys
import os
import io
import struct
import json
import argparse
import base64

try:
    from PIL import Image
except ImportError:
    print("[ERROR] Library Pillow belum terpasang.")
    print("Silakan install terlebih dahulu dengan perintah: pip install Pillow")
    sys.exit(1)


GLTF_MAGIC = 0x46546C67  # b'glTF'
CHUNK_TYPE_JSON = 0x4E4F534A  # b'JSON'
CHUNK_TYPE_BIN = 0x004E4942   # b'BIN\x00'


def format_bytes(num_bytes: int) -> str:
    """Format ukuran byte menjadi string yang mudah dibaca (B, KB, MB)."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:3.2f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.2f} TB"


def compress_image_to_jpeg(image_bytes: bytes, quality: int = 75) -> tuple[bytes, bool]:
    """
    Mengompresi raw image bytes menjadi format JPEG.
    Mengembalikan (compressed_bytes, has_transparency).
    """
    img = Image.open(io.BytesIO(image_bytes))
    has_transparency = False

    # Deteksi dan tangani transparansi / alpha channel
    if img.mode in ('RGBA', 'LA'):
        # Cek apakah alpha benar-benar digunakan (< 255)
        alpha = img.getchannel('A')
        min_alpha, _ = alpha.getextrema()
        if min_alpha < 255:
            has_transparency = True
        
        # Konversi ke RGB / L tanpa alpha
        img = img.convert('RGB' if img.mode == 'RGBA' else 'L')
    elif img.mode == 'P':
        # Paletted image
        if 'transparency' in img.info:
            has_transparency = True
        img = img.convert('RGB')
    elif img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')

    out_io = io.BytesIO()
    img.save(out_io, format='JPEG', quality=quality, optimize=True)
    return out_io.getvalue(), has_transparency


def update_image_filename(name: str) -> str:
    """Mengubah ekstensi nama file tekstur menjadi .jpg."""
    if not name:
        return name
    base, ext = os.path.splitext(name)
    if ext.lower() in ('.png', '.webp', '.bmp', '.tiff', '.tif', '.tga', '.jpeg', '.jpg'):
        return f"{base}.jpg"
    return f"{name}.jpg"


def minify_glb(input_path: str, output_path: str = None, quality: int = 75) -> bool:
    if not os.path.isfile(input_path):
        print(f"[ERROR] File input tidak ditemukan: {input_path}")
        return False

    if not output_path:
        base, _ = os.path.splitext(input_path)
        output_path = f"{base}-kecil.glb"

    orig_file_size = os.path.getsize(input_path)
    print("=" * 60)
    print(f"GLB Minifier: Mengompresi tekstur ke JPEG (Quality: {quality}%)")
    print(f"Input : {input_path} ({format_bytes(orig_file_size)})")
    print(f"Output: {output_path}")
    print("=" * 60)

    # 1. Baca GLB Container
    with open(input_path, 'rb') as f:
        header = f.read(12)
        if len(header) < 12:
            print("[ERROR] File GLB rusak atau terlalu pendek.")
            return False

        magic, version, total_length = struct.unpack('<4sII', header)
        if magic != b'glTF':
            print(f"[ERROR] Header magic tidak valid: {magic}. Bukan file GLB valid.")
            return False
        if version != 2:
            print(f"[ERROR] Versi glTF tidak didukung: {version}. Hanya glTF 2.0 yang didukung.")
            return False

        # Baca Chunk 0 (JSON)
        c0_header = f.read(8)
        if len(c0_header) < 8:
            print("[ERROR] Gagal membaca chunk 0 header.")
            return False
        c0_len, c0_type = struct.unpack('<II', c0_header)
        if c0_type != CHUNK_TYPE_JSON:
            print("[ERROR] Chunk 0 bukan berjenis JSON.")
            return False
        json_data = f.read(c0_len)
        try:
            gltf = json.loads(json_data.decode('utf-8'))
        except Exception as e:
            print(f"[ERROR] Gagal melakukan parsing JSON glTF: {e}")
            return False

        # Baca Chunk 1 (BIN) jika ada
        bin_data = b''
        c1_header = f.read(8)
        if len(c1_header) == 8:
            c1_len, c1_type = struct.unpack('<II', c1_header)
            if c1_type == CHUNK_TYPE_BIN:
                bin_data = f.read(c1_len)

    images = gltf.get('images', [])
    if not images:
        print("[INFO] Tidak ada tekstur/gambar ditemukan di dalam file GLB ini.")
        # Simpan salinan langsung jika tidak ada gambar
        with open(output_path, 'wb') as f_out, open(input_path, 'rb') as f_in:
            f_out.write(f_in.read())
        print(f"[SELESAI] File disimpan tanpa perubahan ke: {output_path}")
        return True

    print(f"Ditemukan {len(images)} referensi gambar/tekstur.")

    # 2. Proses Kompresi Gambar
    compressed_bvs = {}  # bv_index -> compressed_jpeg_bytes
    processed_count = 0
    total_orig_img_bytes = 0
    total_new_img_bytes = 0

    for i, img in enumerate(images):
        img_name = img.get('name', f'image_{i}')
        old_mime = img.get('mimeType', 'unknown')

        # A. Kasus bufferView (standard GLB binary chunk)
        if 'bufferView' in img:
            bv_idx = img['bufferView']
            bv = gltf['bufferViews'][bv_idx]
            bv_buffer = bv.get('buffer', 0)

            # Hanya proses jika buffer adalah buffer 0 (internal BIN chunk)
            if bv_buffer == 0:
                if bv_idx in compressed_bvs:
                    # Sudah dikompresi sebelumnya (shared bufferView)
                    compressed_bytes = compressed_bvs[bv_idx]
                else:
                    offset = bv.get('byteOffset', 0)
                    length = bv['byteLength']
                    raw_bytes = bin_data[offset : offset + length]
                    total_orig_img_bytes += length

                    try:
                        compressed_bytes, has_transparency = compress_image_to_jpeg(raw_bytes, quality=quality)
                        compressed_bvs[bv_idx] = compressed_bytes
                        total_new_img_bytes += len(compressed_bytes)

                        transp_warn = " [Alpha dropped]" if has_transparency else ""
                        saved_pct = (1.0 - len(compressed_bytes) / length) * 100 if length > 0 else 0
                        print(f"  [{i+1}/{len(images)}] Tekstur '{img_name}': {format_bytes(length)} -> {format_bytes(len(compressed_bytes))} (-{saved_pct:.1f}%){transp_warn}")
                        processed_count += 1
                    except Exception as err:
                        print(f"  [PERINGATAN] Gagal mengompresi gambar '{img_name}': {err}. Menggunakan data asli.")
                        compressed_bvs[bv_idx] = raw_bytes
                        total_new_img_bytes += length

            # Update mimeType dan nama
            img['mimeType'] = 'image/jpeg'
            if 'name' in img and img['name']:
                img['name'] = update_image_filename(img['name'])

        # B. Kasus URI (data URI base64 atau path file eksternal)
        elif 'uri' in img:
            uri = img['uri']
            if uri.startswith('data:'):
                try:
                    header_part, data_part = uri.split(',', 1)
                    raw_bytes = base64.b64decode(data_part)
                    orig_len = len(raw_bytes)
                    total_orig_img_bytes += orig_len

                    compressed_bytes, has_transparency = compress_image_to_jpeg(raw_bytes, quality=quality)
                    total_new_img_bytes += len(compressed_bytes)

                    new_b64 = base64.b64encode(compressed_bytes).decode('ascii')
                    img['uri'] = f"data:image/jpeg;base64,{new_b64}"
                    img['mimeType'] = 'image/jpeg'
                    if 'name' in img and img['name']:
                        img['name'] = update_image_filename(img['name'])

                    saved_pct = (1.0 - len(compressed_bytes) / orig_len) * 100 if orig_len > 0 else 0
                    print(f"  [{i+1}/{len(images)}] Data URI '{img_name}': {format_bytes(orig_len)} -> {format_bytes(len(compressed_bytes))} (-{saved_pct:.1f}%)")
                    processed_count += 1
                except Exception as err:
                    print(f"  [PERINGATAN] Gagal mengompresi data URI '{img_name}': {err}")
            else:
                # File URI eksternal
                img['uri'] = update_image_filename(uri)
                img['mimeType'] = 'image/jpeg'
                if 'name' in img and img['name']:
                    img['name'] = update_image_filename(img['name'])
                print(f"  [{i+1}/{len(images)}] Link URI eksternal diperbarui: {img['uri']}")

    # Perbarui juga nama pada array textures jika ada
    for tex in gltf.get('textures', []):
        if 'name' in tex and tex['name']:
            tex['name'] = update_image_filename(tex['name'])

    # 3. Rekonstruksi Binary Buffer (BIN Chunk)
    new_bin = bytearray()
    slice_map = {}  # (orig_offset, orig_len) -> (new_offset, new_len)

    # Urutkan bufferViews buffer 0 berdasarkan urutan byteOffset aslinya
    bvs = gltf.get('bufferViews', [])
    bvs_sorted_indices = sorted(
        [idx for idx, bv in enumerate(bvs) if bv.get('buffer', 0) == 0],
        key=lambda idx: bvs[idx].get('byteOffset', 0)
    )

    for bv_idx in bvs_sorted_indices:
        bv = bvs[bv_idx]
        orig_offset = bv.get('byteOffset', 0)
        orig_len = bv['byteLength']
        key = (orig_offset, orig_len)

        if key in slice_map:
            # Re-use slice jika ada beberapa bufferView merujuk ke blok biner yang sama persis
            new_offset, new_len = slice_map[key]
            bv['byteOffset'] = new_offset
            bv['byteLength'] = new_len
        else:
            # Pastikan byteOffset baru selalu kelipatan 4 (alignment wajib glTF 2.0)
            pad_needed = (4 - (len(new_bin) % 4)) % 4
            if pad_needed > 0:
                new_bin.extend(b'\x00' * pad_needed)

            new_offset = len(new_bin)

            if bv_idx in compressed_bvs:
                chunk_data = compressed_bvs[bv_idx]
            else:
                chunk_data = bin_data[orig_offset : orig_offset + orig_len]

            new_len = len(chunk_data)
            new_bin.extend(chunk_data)

            slice_map[key] = (new_offset, new_len)
            bv['byteOffset'] = new_offset
            bv['byteLength'] = new_len

    # GLB BIN chunk padding ke kelipatan 4
    bin_pad = (4 - (len(new_bin) % 4)) % 4
    if bin_pad > 0:
        new_bin.extend(b'\x00' * bin_pad)

    # Perbarui ukuran buffer di JSON
    if 'buffers' in gltf and len(gltf['buffers']) > 0:
        gltf['buffers'][0]['byteLength'] = len(new_bin)

    # 4. Rekonstruksi JSON Chunk
    new_json_str = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False)
    new_json_bytes = new_json_str.encode('utf-8')

    # glTF JSON chunk padding ke kelipatan 4 menggunakan spasi (0x20)
    json_pad = (4 - (len(new_json_bytes) % 4)) % 4
    if json_pad > 0:
        new_json_bytes += b' ' * json_pad

    # 5. Tulis File GLB Baru
    # Header (12 bytes) + Chunk 0 Header (8 bytes) + JSON Data + Chunk 1 Header (8 bytes) + BIN Data
    total_glb_len = 12 + (8 + len(new_json_bytes)) + (8 + len(new_bin))

    with open(output_path, 'wb') as f_out:
        # GLB Header
        f_out.write(struct.pack('<4sII', b'glTF', 2, total_glb_len))
        # Chunk 0 (JSON)
        f_out.write(struct.pack('<II', len(new_json_bytes), CHUNK_TYPE_JSON))
        f_out.write(new_json_bytes)
        # Chunk 1 (BIN)
        f_out.write(struct.pack('<II', len(new_bin), CHUNK_TYPE_BIN))
        f_out.write(new_bin)

    new_file_size = os.path.getsize(output_path)
    saved_bytes = orig_file_size - new_file_size
    saved_pct = (saved_bytes / orig_file_size * 100) if orig_file_size > 0 else 0

    print("=" * 60)
    print(f"Hasil Minifikasi:")
    print(f"  Tekstur dikompresi : {processed_count} gambar")
    print(f"  Ukuran asli        : {format_bytes(orig_file_size)} ({orig_file_size:,} bytes)")
    print(f"  Ukuran minified    : {format_bytes(new_file_size)} ({new_file_size:,} bytes)")
    print(f"  Pengurangan        : -{format_bytes(saved_bytes)} (-{saved_pct:.2f}%)")
    print(f"  File tersimpan di  : {output_path}")
    print("=" * 60)
    return True


def main():
    parser = argparse.ArgumentParser(
        description="GLB Minifier: Mengompresi tekstur dalam model 3D GLB menjadi JPEG."
    )
    parser.add_argument(
        "input",
        help="Path ke file model GLB yang akan diminifikasi."
    )
    parser.add_argument(
        "-q", "--quality",
        type=int,
        default=75,
        help="Kualitas kompresi JPEG (1-100, default: 75)."
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Nama/path file output (default: <namafileasli>-kecil.glb)."
    )

    args = parser.parse_args()

    if args.quality < 1 or args.quality > 100:
        print("[ERROR] Nilai quality harus antara 1 dan 100.")
        sys.exit(1)

    success = minify_glb(args.input, args.output, args.quality)
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
