import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==========================================
// 1. Inisialisasi Elemen DOM
// ==========================================
const canvasContainer = document.getElementById('canvas-container');
const uiContainer = document.getElementById('ui-container');
const arOverlay = document.getElementById('ar-overlay');
const xrBadge = document.getElementById('xr-badge');
const xrBadgeLabel = xrBadge.querySelector('.badge-label');
const btnStartAr = document.getElementById('btn-start-ar');
const arBtnText = document.getElementById('ar-btn-text');
const arSupportHint = document.getElementById('ar-support-hint');

const glbFileInput = document.getElementById('glb-file-picker');
const btnBrowseGlb = document.getElementById('btn-browse-glb');
const currentModelName = document.getElementById('current-model-name');
const presetPills = document.querySelectorAll('.preset-pill');
const dropZoneOverlay = document.getElementById('drop-zone-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Elemen Banner AR
const arStatusBanner = document.getElementById('ar-status-banner');
const arInstructionTitle = document.getElementById('ar-instruction-title');
const arInstructionSub = document.getElementById('ar-instruction-sub');

// Tombol Kontrol AR
const btnArReposition = document.getElementById('btn-ar-reposition');
const btnArRotate = document.getElementById('btn-ar-rotate');
const btnArScaleUp = document.getElementById('btn-ar-scale-up');
const btnArScaleDown = document.getElementById('btn-ar-scale-down');
const btnArExit = document.getElementById('btn-ar-exit');

// Cegah tombol AR memicu select/tap pada WebXR
[btnArReposition, btnArRotate, btnArScaleUp, btnArScaleDown, btnArExit].forEach(btn => {
  btn.addEventListener('beforexrselect', (e) => e.preventDefault());
});

// ==========================================
// 2. State & Three.js Core
// ==========================================
let scene, camera, renderer, controls, gltfLoader;
let currentModelRoot = null; // Container model yang aktif
let baseScale = 1.0;
let userScaleMultiplier = 1.0;
let currentBlobUrl = null;

// State AR WebXR
let xrSession = null;
let xrReferenceSpace = null;
let xrHitTestSource = null;
let reticle = null;
let isModelPlaced = false;

// ==========================================
// 3. Setup Three.js Scene & Reticle
// ==========================================
function initScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
  camera.position.set(0, 1.2, 1.8);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.shadowMap.enabled = true;
  canvasContainer.appendChild(renderer.domElement);

  // OrbitControls untuk preview 3D (non-AR)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.25, 0);

  // Pencahayaan
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(2, 5, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const softFillLight = new THREE.DirectionalLight(0x90b0ff, 0.8);
  softFillLight.position.set(-3, -1, -2);
  scene.add(softFillLight);

  // Grid pembantu saat mode preview di layar
  const gridHelper = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
  gridHelper.name = 'preview-grid';
  scene.add(gridHelper);

  // Setup Reticle (Lingkaran Target Penanda Lantai)
  createReticle();

  // GLTF Loader
  gltfLoader = new GLTFLoader();

  // Resize handler
  window.addEventListener('resize', onWindowResize);

  // Start Animation Loop
  renderer.setAnimationLoop(renderLoop);
}

// Membuat Reticle Penanda Bidang Lantai
function createReticle() {
  reticle = new THREE.Group();

  // Lingkaran cincin luar
  const ringGeo = new THREE.RingGeometry(0.12, 0.15, 36).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);

  // Titik pusat
  const dotGeo = new THREE.CircleGeometry(0.025, 24).rotateX(-Math.PI / 2);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);

  reticle.add(ring);
  reticle.add(dot);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// 4. Model Loading & Normalisasi Bounding Box
// ==========================================
function loadGLBFromSource(source, displayName) {
  loadingOverlay.classList.remove('hidden');
  loadingText.textContent = `Memuat model ${displayName}...`;

  gltfLoader.load(
    source,
    (gltf) => {
      // Hapus model lama dari scene jika ada
      if (currentModelRoot) {
        scene.remove(currentModelRoot);
        currentModelRoot.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else if (child.material) {
              child.material.dispose();
            }
          }
        });
        currentModelRoot = null;
      }

      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Hitung Bounding Box untuk normalisasi ukuran ke skala nyata (~50cm - 70cm di dunia fisik)
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 0.55; // Ukuran target ~55 cm
      baseScale = targetSize / (maxDim || 1);
      userScaleMultiplier = 1.0;

      // Buat container wrapper agar posisi pivot tepat berada di dasar lantai
      const wrapper = new THREE.Group();
      model.position.set(-center.x, -box.min.y, -center.z); // letakkan alas model di Y = 0
      wrapper.add(model);
      wrapper.scale.setScalar(baseScale * userScaleMultiplier);

      currentModelRoot = wrapper;
      scene.add(currentModelRoot);

      currentModelName.textContent = displayName;
      loadingOverlay.classList.add('hidden');

      // Jika saat ini di dalam AR dan belum diletakkan, sembunyikan dulu
      if (xrSession) {
        currentModelRoot.visible = isModelPlaced;
      } else {
        currentModelRoot.visible = true;
        controls.target.set(0, targetSize * 0.4, 0);
      }
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        loadingText.textContent = `Mengunduh: ${pct}%`;
      }
    },
    (err) => {
      console.error('Error memuat model:', err);
      loadingOverlay.classList.add('hidden');
      alert('Gagal memuat model GLB. Pastikan file valid.');
    }
  );
}

// Load dari file lokal pengguna
function handleLocalFile(file) {
  if (!file) return;
  const fileName = file.name.toLowerCase();
  if (!fileName.endsWith('.glb') && !fileName.endsWith('.gltf')) {
    alert('Format file harus .GLB atau .GLTF');
    return;
  }

  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
  }
  currentBlobUrl = URL.createObjectURL(file);
  presetPills.forEach((p) => p.classList.remove('active'));
  loadGLBFromSource(currentBlobUrl, file.name);
}

// ==========================================
// 5. WebXR AR Session & Hit-Testing
// ==========================================

// Cek Kompatibilitas WebXR immersive-ar
async function checkWebXRSupport() {
  if ('xr' in navigator) {
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (supported) {
        xrBadge.className = 'badge badge-ready';
        xrBadgeLabel.textContent = 'WebXR AR Siap';
        btnStartAr.disabled = false;
        arSupportHint.textContent = 'Perangkat mendukung Kamera AR interaktif (Hit-Test)';
        return;
      }
    } catch (e) {
      console.warn('Gagal cek WebXR:', e);
    }
  }

  // Jika WebXR belum aktif di browser
  xrBadge.className = 'badge badge-unsupported';
  xrBadgeLabel.textContent = 'WebXR Tidak Tersedia';
  arSupportHint.innerHTML = 'Buka via <strong>Google Chrome Android</strong> (dengan ARCore aktif) melalui localhost atau HTTPS.';
  btnStartAr.disabled = false; // Tetap izinkan klik agar menampilkan panduan lengkap jika ditekan
  arBtnText.textContent = 'Coba Buka Kamera AR';
}

// Masuk ke Sesi Kamera AR
async function startARSession() {
  if (!navigator.xr) {
    alert('Browser ini tidak mendukung WebXR. Harap buka di Google Chrome Android dengan koneksi HTTPS atau localhost.');
    return;
  }

  try {
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: arOverlay }
    };

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    onSessionStarted(session);
  } catch (err) {
    console.error('Gagal memulai AR:', err);
    alert('Tidak dapat memulai sesi AR: ' + err.message + '\n\nPastikan izin kamera diizinkan dan ARCore / Google Play Services for AR terpasang.');
  }
}

// Saat Sesi AR Dimulai
function onSessionStarted(session) {
  xrSession = session;
  session.addEventListener('end', onSessionEnded);

  // Dengarkan tap pada layar (Select) untuk meletakkan model di lantai
  session.addEventListener('select', onScreenSelect);

  // Sembunyikan UI preview dan tampilkan overlay AR
  uiContainer.style.display = 'none';
  arOverlay.classList.remove('hidden');

  // Sembunyikan grid bantu preview
  const grid = scene.getObjectByName('preview-grid');
  if (grid) grid.visible = false;

  // Reset status peletakan model
  isModelPlaced = false;
  if (currentModelRoot) {
    currentModelRoot.visible = false; // Model TIDAK langsung muncul
  }

  // Set Banner ke mode mencari lantai
  updateARBanner('searching');
  setARActionButtonsState(false);

  // Setup Three.js WebXR Manager
  renderer.xr.setReferenceSpaceType('local');
  renderer.xr.setSession(session);

  // Request Hit-Test Source dari Kamera Penampil (Viewer)
  session.requestReferenceSpace('viewer').then((viewerSpace) => {
    session.requestHitTestSource({ space: viewerSpace }).then((source) => {
      xrHitTestSource = source;
    });
  });

  // Request Reference Space Lantai (local-floor atau local)
  session.requestReferenceSpace('local-floor')
    .catch(() => session.requestReferenceSpace('local'))
    .then((refSpace) => {
      xrReferenceSpace = refSpace;
    });
}

// Saat Sesi AR Ditutup
function onSessionEnded() {
  xrSession = null;
  xrHitTestSource = null;
  xrReferenceSpace = null;
  isModelPlaced = false;

  if (reticle) reticle.visible = false;

  // Kembalikan UI Preview
  arOverlay.classList.add('hidden');
  uiContainer.style.display = 'flex';

  const grid = scene.getObjectByName('preview-grid');
  if (grid) grid.visible = true;

  if (currentModelRoot) {
    currentModelRoot.visible = true;
    currentModelRoot.position.set(0, 0, 0);
    currentModelRoot.quaternion.identity();
  }

  controls.reset();
}

// User mengetuk layar saat sesi AR (Tap-to-Place)
function onScreenSelect() {
  // Hanya proses jika reticle aktif dan model belum diletakkan
  if (reticle && reticle.visible && !isModelPlaced) {
    if (currentModelRoot) {
      // Ambil posisi dan rotasi tepat di titik permukaan lantai yang terdeteksi
      currentModelRoot.position.setFromMatrixPosition(reticle.matrix);
      currentModelRoot.quaternion.setFromRotationMatrix(reticle.matrix);

      // Hadapkan model ke arah kamera saat diletakkan
      const cameraWorldPos = new THREE.Vector3();
      camera.getWorldPosition(cameraWorldPos);
      currentModelRoot.lookAt(cameraWorldPos.x, currentModelRoot.position.y, cameraWorldPos.z);

      // Kunci dan tampilkan model di dunia fisik
      currentModelRoot.visible = true;
      isModelPlaced = true;
      reticle.visible = false;

      // Update UI Banner & aktifkan tombol kontrol
      updateARBanner('placed');
      setARActionButtonsState(true);

      // Getaran haptic di HP jika didukung
      if (navigator.vibrate) navigator.vibrate(60);
    }
  }
}

// Update Tampilan Banner Petunjuk AR
function updateARBanner(state) {
  arStatusBanner.className = 'ar-banner';

  if (state === 'searching') {
    arStatusBanner.classList.add('banner-searching');
    arInstructionTitle.textContent = 'Mencari Bidang Lantai...';
    arInstructionSub.textContent = 'Arahkan kamera ke permukaan lantai atau meja datar';
  } else if (state === 'ready') {
    arStatusBanner.classList.add('banner-ready');
    arInstructionTitle.textContent = '✨ Bidang Siap! Ketuk Layar';
    arInstructionSub.textContent = 'Ketuk di mana saja pada layar untuk meletakkan model 3D';
  } else if (state === 'placed') {
    arStatusBanner.classList.add('banner-placed');
    arInstructionTitle.textContent = '✅ Model Terkunci di Lantai';
    arInstructionSub.textContent = 'Objek diam di posisi fisik. Anda bisa berjalan mengelilinginya.';
  }
}

// Aktifkan / Nonaktifkan tombol aksi AR
function setARActionButtonsState(enabled) {
  btnArReposition.disabled = !enabled;
  btnArRotate.disabled = !enabled;
  btnArScaleUp.disabled = !enabled;
  btnArScaleDown.disabled = !enabled;
}

// ==========================================
// 6. Loop Animasi & WebXR Render
// ==========================================
function renderLoop(timestamp, frame) {
  if (frame && xrHitTestSource && xrReferenceSpace) {
    // Jika model belum diletakkan, cari bidang lantai via hit-test
    if (!isModelPlaced) {
      const hitTestResults = frame.getHitTestResults(xrHitTestSource);

      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(xrReferenceSpace);

        if (pose) {
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          updateARBanner('ready');
        }
      } else {
        reticle.visible = false;
        updateARBanner('searching');
      }
    } else {
      reticle.visible = false;
    }
  } else {
    // Mode non-AR: Update kontrol preview
    controls.update();
  }

  renderer.render(scene, camera);
}

// ==========================================
// 7. Event Listeners & Kontrol Tombol
// ==========================================

// Tombol Mulai AR
btnStartAr.addEventListener('click', () => {
  startARSession();
});

// Tombol Keluar AR
btnArExit.addEventListener('click', () => {
  if (xrSession) xrSession.end();
});

// Tombol Pindahkan Posisi (Ulangi Hit-Test)
btnArReposition.addEventListener('click', () => {
  if (isModelPlaced) {
    isModelPlaced = false;
    if (currentModelRoot) currentModelRoot.visible = false;
    setARActionButtonsState(false);
    updateARBanner('searching');
  }
});

// Tombol Putar Model 45 Derajat
btnArRotate.addEventListener('click', () => {
  if (currentModelRoot && isModelPlaced) {
    currentModelRoot.rotateY(Math.PI / 4);
  }
});

// Tombol Skala +
btnArScaleUp.addEventListener('click', () => {
  if (currentModelRoot) {
    userScaleMultiplier *= 1.25;
    currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);
  }
});

// Tombol Skala -
btnArScaleDown.addEventListener('click', () => {
  if (currentModelRoot) {
    userScaleMultiplier *= 0.8;
    currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);
  }
});

// File Picker GLB
btnBrowseGlb.addEventListener('click', () => glbFileInput.click());
glbFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleLocalFile(e.target.files[0]);
  }
});

// Drag & Drop GLB ke Layar
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZoneOverlay.classList.add('active');
});

['dragleave', 'drop'].forEach((evt) => {
  dropZoneOverlay.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZoneOverlay.classList.remove('active');
  });
});

dropZoneOverlay.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleLocalFile(e.dataTransfer.files[0]);
  }
});

// Tombol Preset Model
presetPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const url = pill.getAttribute('data-url');
    const name = pill.getAttribute('data-name');
    presetPills.forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    loadGLBFromSource(url, `${name}.glb`);
  });
});

// ==========================================
// 8. Booting Pertama Kali
// ==========================================
initScene();
checkWebXRSupport();

// Muat model awal (Astronaut)
loadGLBFromSource('https://modelviewer.dev/shared-assets/models/Astronaut.glb', 'Astronaut.glb');
