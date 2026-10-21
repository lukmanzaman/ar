// State & Elements
const modelViewer = document.getElementById('ar-viewer');
const fileInput = document.getElementById('glb-file-input');
const btnBrowse = document.getElementById('btn-browse');
const modelNameEl = document.getElementById('model-name');
const modelSizeEl = document.getElementById('model-size');
const arBadge = document.getElementById('ar-badge');
const badgeLabel = arBadge.querySelector('.badge-label');
const progressBar = document.getElementById('load-progress');
const updateBar = document.getElementById('update-bar');
const dropZone = document.getElementById('drop-zone');
const dragOverlay = document.getElementById('drag-overlay');
const presetButtons = document.querySelectorAll('.preset-btn');
const btnToggleRotate = document.getElementById('btn-toggle-rotate');
const btnResetCam = document.getElementById('btn-reset-cam');

let currentObjectUrl = null;

// Format ukuran file ke KB/MB
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Update model dari File Object
function loadGLBFile(file) {
  if (!file) return;

  const validExtensions = ['.glb', '.gltf'];
  const fileName = file.name.toLowerCase();
  const isValid = validExtensions.some(ext => fileName.endsWith(ext));

  if (!isValid) {
    alert('Harap pilih file dengan format 3D .GLB atau .GLTF');
    return;
  }

  // Bersihkan object URL lama jika ada untuk hindari kebocoran memori
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  // Buat Object URL lokal
  currentObjectUrl = URL.createObjectURL(file);
  
  // Set ke model-viewer
  modelViewer.src = currentObjectUrl;

  // Update Tampilan Info
  modelNameEl.textContent = file.name;
  modelSizeEl.textContent = formatBytes(file.size);

  // Nonaktifkan styling active pada preset buttons
  presetButtons.forEach(btn => btn.classList.remove('active'));

  // Tampilkan progress bar
  progressBar.classList.remove('hide');
  updateBar.style.width = '0%';
}

// 1. File Input Picker
btnBrowse.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    loadGLBFile(e.target.files[0]);
  }
});

// 2. Drag and Drop Support
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.add('active');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragOverlay.classList.remove('active');
  }, false);
});

dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files[0]) {
    loadGLBFile(dt.files[0]);
  }
});

// 3. Preset Buttons
presetButtons.forEach(button => {
  button.addEventListener('click', () => {
    const url = button.getAttribute('data-url');
    const name = button.getAttribute('data-name');

    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    modelViewer.src = url;
    modelNameEl.textContent = `${name}.glb`;
    modelSizeEl.textContent = 'Contoh Cloud';

    presetButtons.forEach(b => b.classList.remove('active'));
    button.classList.add('active');

    progressBar.classList.remove('hide');
    updateBar.style.width = '0%';
  });
});

// 4. Progress & Loading Events
modelViewer.addEventListener('progress', (e) => {
  const progress = e.detail.totalProgress * 100;
  updateBar.style.width = `${progress}%`;
});

modelViewer.addEventListener('load', () => {
  progressBar.classList.add('hide');
  console.log('Model 3D berhasil dimuat!');
});

modelViewer.addEventListener('error', (err) => {
  progressBar.classList.add('hide');
  console.error('Gagal memuat model:', err);
  alert('Gagal memuat model 3D. Pastikan format GLB valid.');
});

// 5. Cek Kemampuan AR Kamera
function updateARSupportStatus() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  
  if (modelViewer.canActivateAR) {
    arBadge.className = 'badge badge-supported';
    badgeLabel.textContent = isMobile ? 'Kamera AR Siap' : 'AR Didukung (QR Scan)';
  } else {
    // Pada desktop modern, Scene Viewer / Quick Look menyediakan QR fallback
    arBadge.className = 'badge badge-desktop';
    badgeLabel.textContent = isMobile ? 'AR Tidak Tersedia' : 'Mode 3D Web (Desktop)';
  }
}

// Cek saat elemen siap
customElements.whenDefined('model-viewer').then(() => {
  updateARSupportStatus();
});

modelViewer.addEventListener('ar-status', (event) => {
  console.log('AR Status:', event.detail.status);
  if (event.detail.status === 'session-started') {
    console.log('Sesi kamera AR dimulai');
  } else if (event.detail.status === 'not-presenting') {
    console.log('Sesi kamera AR ditutup');
  }
});

// 6. Quick Control Buttons
let isAutoRotating = true;
btnToggleRotate.addEventListener('click', () => {
  isAutoRotating = !isAutoRotating;
  if (isAutoRotating) {
    modelViewer.setAttribute('auto-rotate', '');
    btnToggleRotate.classList.remove('active');
  } else {
    modelViewer.removeAttribute('auto-rotate');
    btnToggleRotate.classList.add('active');
  }
});

btnResetCam.addEventListener('click', () => {
  modelViewer.cameraOrbit = '0deg 75deg 105%';
  modelViewer.resetTurntableRotation();
});
