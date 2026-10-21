# Aplikasi Web AR (WebXR Hit-Test & Tap-to-Place)

Aplikasi Augmented Reality (AR) berbasis **murni HTML + CSS + JavaScript** menggunakan standar **WebXR Hit-Test API** (Three.js & Google WebXR Immersive-AR).

---

### Solusi Masalah Objek Melayang / Bergeser (Hit-Test Reticle)

Pada implementasi ini:
1. **Model Tidak Langsung Muncul**: Saat kamera AR aktif, model disembunyikan agar tidak melayang atau mengikuti gerakan kamera ponsel Anda.
2. **Deteksi Bidang Permukaan (Plane Detection)**: Sensor WebXR memindai lantai / meja fisik.
3. **Lingkaran Target (Reticle)**: Lingkaran target biru bercahaya akan muncul dan menempel di lantai saat bidang datar terdeteksi. Banner petunjuk akan berubah menjadi hijau: *"✨ Bidang Siap! Ketuk Layar"*.
4. **Klik / Tap untuk Meletakkan (Tap-to-Place)**: Ketuk layar ponsel Anda di mana saja. Model 3D akan dimunculkan dan **dikunci permanen pada koordinat dunia nyata di lantai tersebut**. Objek tidak akan bergeser mengikuti pergerakan kamera! Anda bisa bebas berjalan mengitari objek 360 derajat.
5. **Tombol Kontrol di dalam AR**:
   - 📍 **Pindahkan**: Melepas kunci model dan menampilkan lingkaran target kembali untuk memilih titik baru.
   - 🔄 **Putar**: Memutar model 45 derajat.
   - ➕ / ➖ **Skala**: Menyesuaikan besar/kecil model.
   - ❌ **Keluar**: Menutup sesi kamera AR dan kembali ke tampilan 3D.

---

### Fitur Utama

- **Load Custom GLB**: Tombol upload file untuk memilih model `.glb` / `.gltf` dari penyimpanan lokal HP atau laptop, serta fitur Drag & Drop.
- **Auto Bounding-Box Normalization**: Model otomatis diskalakan ke ukuran dunia nyata (~55 cm) dengan titik tumpu tepat di atas lantai (tidak tenggelam atau melayang).
- **Preset Model**: Tersedia model Astronaut, Rubber Duck, Kursi, dan Makanan untuk langsung dicoba.
- **Pratinjau 3D (Non-AR)**: Orbit controls interaktif sebelum masuk ke kamera AR.

---

### Cara Menjalankan

WebXR Camera Hit-Test mewajibkan koneksi aman (**localhost** atau **HTTPS**).

Jalankan perintah ini di terminal folder `KELAS`:

```bash
# Opsi 1: Menggunakan Node.js
npx serve .

# Opsi 2: Menggunakan Python
python -m http.server 8080
```

Buka URL yang ditampilkan di browser **Google Chrome** smartphone Android Anda (pastikan Google Play Services for AR / ARCore aktif).
