import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==========================================
// 1. Elemen DOM
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

// Cegah tombol AR memicu event 'select' pada XR controller
[arStatusBanner, btnArReposition, btnArRotate, btnArScaleUp, btnArScaleDown, btnArExit].forEach((elem) => {
  if (elem) {
    elem.addEventListener('beforexrselect', (e) => e.preventDefault());
    elem.addEventListener('click', (e) => e.stopPropagation());
  }
});

// ==========================================
// 2. State & Three.js Core
// ==========================================
let scene, camera, renderer, controls, gltfLoader;
let currentModelRoot = null; // Container Group utama model
let baseScale = 1.0;
let userScaleMultiplier = 1.0;
let currentBlobUrl = null;

// Animasi GLTF
const clock = new THREE.Clock();
let mixer = null;

// State AR WebXR
let xrSession = null;
let xrController = null;
let xrHitTestSource = null;
let hitTestSourceRequested = false;
let reticle = null;
let isModelPlaced = false;

// ==========================================
// 3. Setup Three.js Scene & Reticle
// ==========================================
function initScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
  camera.position.set(0, 1.2, 1.8);
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  canvasContainer.appendChild(renderer.domElement);

  // OrbitControls untuk preview 3D di desktop / layar HP sebelum AR
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.3, 0);

  // Setup Pencahayaan Kuat & Merata
  setupLighting();

  // Grid pembantu saat mode preview di layar
  const gridHelper = new THREE.GridHelper(10, 20, 0x38bdf8, 0x1e293b);
  gridHelper.name = 'preview-grid';
  scene.add(gridHelper);

  // Setup Reticle (Lingkaran Target Penanda Lantai)
  createReticle();

  // Setup WebXR Controller untuk mendeteksi Tap Layar
  xrController = renderer.xr.getController(0);
  xrController.addEventListener('select', onScreenSelect);
  scene.add(xrController);

  // Inisialisasi GLTF Loader
  gltfLoader = new GLTFLoader();

  // Resize handler
  window.addEventListener('resize', onWindowResize);

  // Start Animation Loop
  renderer.setAnimationLoop(renderLoop);
}

// Pencahayaan AR yang terang dari segala sisi
function setupLighting() {
  // Cahaya atas-bawah lembut
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x555555, 3.5);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  // Cahaya terarah utama
  const dirLight = new THREE.DirectionalLight(0xffffff, 4.0);
  dirLight.position.set(3, 10, 5);
  scene.add(dirLight);

  // Cahaya pengisi dari depan
  const fillLight = new THREE.DirectionalLight(0xffffff, 2.0);
  fillLight.position.set(-3, 5, -2);
  scene.add(fillLight);

  // Cahaya senter yang selalu melekat di kamera HP
  const camLight = new THREE.PointLight(0xffffff, 2.5, 20);
  camera.add(camLight);
}

// Membuat Reticle Penanda Lantai yang Jelas & Kontras
function createReticle() {
  reticle = new THREE.Group();

  // Cincin luar biru terang
  const ringGeo = new THREE.RingGeometry(0.12, 0.16, 36).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);

  // Titik tengah putih kontras
  const dotGeo = new THREE.CircleGeometry(0.03, 24).rotateX(-Math.PI / 2);
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
// 4. Model Loading & Normalisasi Skala Bounding Box
// ==========================================
function loadGLBFromSource(source, displayName) {
  loadingOverlay.classList.remove('hidden');
  loadingText.textContent = `Memuat model ${displayName}...`;

  gltfLoader.load(
    source,
    (gltf) => {
      // Hapus model lama jika ada
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

      if (mixer) {
        mixer.stopAllAction();
        mixer = null;
      }

      const model = gltf.scene;

      // Cegah bug Frustum Culling pada SkinnedMesh & aktifkan DoubleSide
      model.traverse((child) => {
        if (child.isMesh) {
          child.frustumCulled = false; // KUNCI: Jangan hilangkan mesh jika kamera dekat/bergerak!
          if (child.material) {
            child.material.side = THREE.DoubleSide; // Pastikan terlihat dari sisi depan maupun belakang
            child.material.depthTest = true;
            child.material.depthWrite = true;
          }
        }
      });

      // Siapkan animasi jika ada (contoh: ikan berenang)
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          action.play();
        });
        console.log(`Memainkan ${gltf.animations.length} animasi untuk ${displayName}`);
      }

      // Hitung Bounding Box untuk normalisasi ukuran & titik tumpu lantai
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const targetHeight = 0.55; // Skala nyaman ~55 cm di ruangan fisik
      baseScale = targetHeight / (maxDim || 1);
      userScaleMultiplier = 1.0;

      // Posisikan alas model tepat di Y = 0 (lantai) dan di tengah X-Z
      model.position.set(-center.x, -box.min.y, -center.z);

      const wrapper = new THREE.Group();
      wrapper.add(model);
      wrapper.scale.setScalar(baseScale * userScaleMultiplier);
      wrapper.matrixAutoUpdate = true;

      currentModelRoot = wrapper;
      scene.add(currentModelRoot);

      currentModelName.textContent = displayName;
      loadingOverlay.classList.add('hidden');

      // Pengaturan visibilitas berdasarkan sesi AR
      if (xrSession) {
        currentModelRoot.visible = isModelPlaced;
      } else {
        currentModelRoot.visible = true;
        controls.target.set(0, targetHeight * 0.4, 0);
      }

      console.log(`Model ${displayName} berhasil dimuat. Skala dasar: ${baseScale}`);
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        loadingText.textContent = `Mengunduh model: ${pct}%`;
      }
    },
    (err) => {
      console.error('Error memuat model:', err);
      loadingOverlay.classList.add('hidden');
      alert('Gagal memuat file GLB. Pastikan file valid.');
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
        arSupportHint.textContent = 'Kamera AR & Sensor Hit-Test didukung penuh!';
        return;
      }
    } catch (e) {
      console.warn('Gagal cek WebXR:', e);
    }
  }

  xrBadge.className = 'badge badge-unsupported';
  xrBadgeLabel.textContent = 'WebXR Tidak Tersedia';
  arSupportHint.innerHTML = 'Buka via <strong>Google Chrome Android</strong> (dengan ARCore aktif) melalui localhost atau HTTPS.';
  btnStartAr.disabled = false;
  arBtnText.textContent = 'Coba Buka Kamera AR';
}

// Masuk ke Sesi Kamera AR
async function startARSession() {
  if (!navigator.xr) {
    alert('Browser tidak mendukung WebXR. Gunakan Google Chrome Android dengan koneksi HTTPS atau localhost.');
    return;
  }

  try {
    const sessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: arOverlay }
    };

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    onSessionStarted(session);
  } catch (err) {
    console.error('Gagal memulai AR:', err);
    alert('Tidak dapat memulai sesi AR: ' + err.message + '\n\nPastikan izin kamera diizinkan dan ARCore aktif.');
  }
}

// Saat Sesi AR Dimulai
function onSessionStarted(session) {
  xrSession = session;
  hitTestSourceRequested = false;
  xrHitTestSource = null;

  session.addEventListener('end', onSessionEnded);

  // Sembunyikan UI 2D dan tampilkan UI Overlay AR
  uiContainer.style.display = 'none';
  arOverlay.classList.remove('hidden');

  // Sembunyikan grid bantu preview
  const grid = scene.getObjectByName('preview-grid');
  if (grid) grid.visible = false;

  // Sembunyikan model sebelum user mengetuk lantai!
  isModelPlaced = false;
  if (currentModelRoot) {
    currentModelRoot.visible = false;
  }

  // Set status banner awal
  updateARBanner('searching');
  setARActionButtonsState(false);

  // Pasang sesi ke WebXR Three.js
  renderer.xr.setSession(session);
}

// Saat Sesi AR Ditutup
function onSessionEnded() {
  xrSession = null;
  hitTestSourceRequested = false;
  xrHitTestSource = null;
  isModelPlaced = false;

  if (reticle) reticle.visible = false;

  arOverlay.classList.add('hidden');
  uiContainer.style.display = 'flex';

  const grid = scene.getObjectByName('preview-grid');
  if (grid) grid.visible = true;

  if (currentModelRoot) {
    currentModelRoot.visible = true;
    currentModelRoot.position.set(0, 0, 0);
    currentModelRoot.quaternion.identity();
    currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);
    currentModelRoot.updateMatrixWorld(true);
  }

  controls.reset();
}

// User mengetuk layar saat sesi AR (Tap-to-Place)
function onScreenSelect() {
  // Hanya proses jika reticle aktif dan model belum diletakkan
  if (reticle && reticle.visible && !isModelPlaced) {
    if (currentModelRoot) {
      // Ekstrak posisi dan orientasi dari matriks reticle yang didapat langsung dari sensor lantai
      const hitPosition = new THREE.Vector3();
      const hitQuaternion = new THREE.Quaternion();
      const hitScale = new THREE.Vector3();

      reticle.matrix.decompose(hitPosition, hitQuaternion, hitScale);

      // Terapkan koordinat dunia ke container model
      currentModelRoot.position.copy(hitPosition);
      currentModelRoot.quaternion.copy(hitQuaternion);
      currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);

      // Pastikan matriks dunia langsung dihitung ulang
      currentModelRoot.updateMatrix();
      currentModelRoot.updateMatrixWorld(true);

      // Tampilkan model di posisi tersebut
      currentModelRoot.visible = true;
      isModelPlaced = true;
      reticle.visible = false;

      // Update UI Banner & aktifkan tombol aksi AR
      updateARBanner('placed');
      setARActionButtonsState(true);

      console.log('Model berhasil diletakkan pada koordinat:', hitPosition);

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
  // Update animasi model jika ada (seperti kibasan sirip ikan)
  const delta = clock.getDelta();
  if (mixer) {
    mixer.update(delta);
  }

  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    // Inisialisasi Hit-Test Source pada frame pertama WebXR
    if (!hitTestSourceRequested && session) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          xrHitTestSource = source;
        });
      });

      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        xrHitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    // Pemrosesan Hit-Test saat model belum diletakkan
    if (xrHitTestSource && referenceSpace) {
      if (!isModelPlaced) {
        const hitTestResults = frame.getHitTestResults(xrHitTestSource);

        if (hitTestResults.length > 0) {
          const hit = hitTestResults[0];
          const pose = hit.getPose(referenceSpace);

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

// Tombol Pindahkan Posisi (Ulangi Hit-Test ke lantai baru)
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
    currentModelRoot.updateMatrixWorld(true);
  }
});

// Tombol Skala +
btnArScaleUp.addEventListener('click', () => {
  if (currentModelRoot) {
    userScaleMultiplier *= 1.25;
    currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);
    currentModelRoot.updateMatrixWorld(true);
  }
});

// Tombol Skala -
btnArScaleDown.addEventListener('click', () => {
  if (currentModelRoot) {
    userScaleMultiplier *= 0.8;
    currentModelRoot.scale.setScalar(baseScale * userScaleMultiplier);
    currentModelRoot.updateMatrixWorld(true);
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

// Muat model ikan lokal sebagai default jika ada, atau fallback
loadGLBFromSource('ikan-kecil.glb', 'Ikan (Lokal)');
