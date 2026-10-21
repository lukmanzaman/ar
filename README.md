# Aplikasi Web AR (Google Model-Viewer Standard)

Aplikasi Augmented Reality (AR) berbasis web murni (**HTML + CSS + Vanilla JavaScript**) menggunakan framework/komponen standar resmi Google saat ini: **Google `<model-viewer>`** (WebXR, Scene Viewer, dan Quick Look).

## Fitur Utama

1. **Load Custom GLB / GLTF**:
   - Pilih file dari penyimpanan lokal (HP atau PC) menggunakan tombol upload.
   - Mendukung **Drag & Drop** langsung ke dalam area viewer.
   - Menggunakan `URL.createObjectURL` lokal (file langsung tampil tanpa perlu upload ke server eksternal).
2. **Kamera AR Real-Time**:
   - Tombol **"Tampilkan Kamera AR"**:
     - **Android**: Mengaktifkan WebXR / Google Play Services for AR (Scene Viewer) untuk menempatkan objek 3D di lantai/meja fisik secara nyata.
     - **iOS (iPhone/iPad)**: Otomatis terintegrasi dengan Apple Quick Look via Safari.
     - **Desktop/Laptop**: Menyediakan fitur scan QR Code otomatis untuk membuka tampilan AR di smartphone.
3. **Preset Model Siap Pakai**:
   - Disediakan tombol cepat untuk mencoba sampel 3D populer (Astronaut, Duck, Chair, Shishkebab).
4. **Kontrol Interaktif 3D**:
   - Rotasi sentuh / mouse, zoom (pinch / scroll), tombol toggle auto-rotate, dan reset kamera.

---

## Cara Menjalankan

### Cara 1: Buka Langsung di Browser
Anda dapat membuka file `index.html` langsung di browser Chrome, Edge, atau Safari.

### Cara 2: Menjalankan Local Web Server (Direkomendasikan untuk AR HP)
WebXR dan akses kamera memerlukan koneksi yang aman (**HTTPS** atau **localhost** / IP lokal).

Jalankan perintah berikut di terminal folder ini:

**Menggunakan Node.js / npx:**
```bash
npx serve .
```

**Atau menggunakan Python:**
```bash
python -m http.server 8080
```

Buka URL yang ditampilkan (contoh: `http://localhost:8080` di PC, atau `http://<IP-Komputer-Anda>:8080` di browser Chrome/Safari smartphone yang terhubung ke Wi-Fi yang sama).

---

## Struktur File

- `index.html` — Struktur halaman & deklarasi komponen Google `<model-viewer>`.
- `style.css` — Tampilan responsif modern (Dark UI, glassmorphism, mobile-friendly).
- `app.js` — Logika load file custom GLB, drag-and-drop, deteksi status AR, dan kontrol kamera.
