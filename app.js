(function () {
  const video = document.getElementById('camera');
  const overlay = document.getElementById('overlay');
  const file = document.getElementById('file');
  const startBtn = document.getElementById('start');
  const resetBtn = document.getElementById('reset');
  const opacity = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacityVal');
  const app = document.getElementById('app');
  const statusEl = document.getElementById('status');

  let stream = null;

  // Transform state
  const state = { tx: 0, ty: 0, scale: 1, rot: 0 };
  let pointers = new Map();
  let gestureStart = null;

  // ---- Camera ----
  async function startCamera() {
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' }, // rear camera if possible
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });
      video.srcObject = stream;

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      // If we got the rear camera, no mirroring needed. If front, we leave it as-is.
      video.style.transform = settings.facingMode === 'environment' ? 'none' : 'scaleX(-1)';
      setStatus(settings.facingMode === 'environment' ? 'Rear camera' : 'Front camera');
    } catch (err) {
      console.error(err);
      setStatus('Camera error. Use HTTPS & allow permission.');
      alert('Could not start camera. Open this over HTTPS (or localhost) and allow camera access.');
    }
  }

  // ---- Overlay loading ----
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    overlay.src = url;
    overlay.onload = () => {
      // Fit image to screen initially (keep aspect ratio), slightly smaller than viewport
      const fitScale = computeInitialScale(overlay.naturalWidth, overlay.naturalHeight);
      state.tx = 0;
      state.ty = 0;
      state.scale = fitScale;
      state.rot = 0;
      applyTransform();
      setStatus('Image loaded');
    };
  });

  function computeInitialScale(w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sx = vw / w;
    const sy = vh / h;
    return Math.min(sx, sy) * 0.9;
  }

  // ---- Opacity ----
  function syncOpacity() {
    const v = Number(opacity.value);
    overlay.style.opacity = (v / 100).toFixed(2);
    opacityVal.textContent = `${v}%`;
  }
  opacity.addEventListener('input', syncOpacity);
  syncOpacity(); // set default 50%

  // ---- Gestures (Pointer Events) ----
  app.addEventListener('pointerdown', onPointerDown);
  app.addEventListener('pointermove', onPointerMove);
  app.addEventListener('pointerup', onPointerUp);
  app.addEventListener('pointercancel', onPointerUp);
  app.addEventListener('pointerleave', onPointerUp);

  function onPointerDown(e) {
    app.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureStart = snapshot();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // Pan
      const p = firstPointer();
      const s = gestureStart;
      const dx = p.x - s.p0.x;
      const dy = p.y - s.p0.y;
      state.tx = s.tx + dx;
      state.ty = s.ty + dy;
      applyTransform();
    } else if (pointers.size >= 2) {
      // Pinch + Rotate + Translate by centroid move
      const [a, b] = firstTwo();
      const s = gestureStart;

      const dist0 = distance(s.p0, s.p1);
      const dist1 = distance(a, b);
      const scaleChange = dist1 / (dist0 || 1);
      state.scale = clamp(s.scale * scaleChange, 0.1, 10);

      const ang0 = angle(s.p0, s.p1);
      const ang1 = angle(a, b);
      state.rot = s.rot + (ang1 - ang0);

      const c0 = midpoint(s.p0, s.p1);
      const c1 = midpoint(a, b);
      state.tx = s.tx + (c1.x - c0.x);
      state.ty = s.ty + (c1.y - c0.y);

      applyTransform();
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    gestureStart = snapshot();
    e.preventDefault();
  }

  function snapshot() {
    const arr = [...pointers.values()];
    return {
      tx: state.tx, ty: state.ty, scale: state.scale, rot: state.rot,
      p0: arr[0] ? { x: arr[0].x, y: arr[0].y } : { x: 0, y: 0 },
      p1: arr[1] ? { x: arr[1].x, y: arr[1].y } : { x: 0, y: 0 }
    };
  }

  function firstPointer() { return [...pointers.values()][0]; }
  function firstTwo() { const a = [...pointers.values()]; return [a[0], a[1]]; }
  function distance(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
  function angle(p, q) { return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; }
  function midpoint(p, q) { return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function applyTransform() {
    overlay.style.transform =
      `translate(calc(-50% + ${state.tx}px), calc(-50% + ${state.ty}px)) ` +
      `scale(${state.scale}) rotate(${state.rot}deg)`;
  }

  const cameraFrame = document.querySelector('.camera-frame');

async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    video.srcObject = stream;

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();

    // Mirror only if front-facing
    video.style.transform = settings.facingMode === 'environment' ? 'none' : 'scaleX(-1)';
    setStatus(settings.facingMode === 'environment' ? 'Rear camera' : 'Front camera');

    // Apply camera aspect ratio to the frame as soon as metadata is ready
    video.addEventListener('loadedmetadata', () => {
      applyCameraAspectToFrame();
    }, { once: true });

  } catch (err) {
    console.error(err);
    setStatus('Camera error. Use HTTPS & allow permission.');
    alert('Could not start camera. Open this over HTTPS (or localhost) and allow camera access.');
  }
}

// Reads the true aspect ratio and sets it on the frame to avoid black bands
function applyCameraAspectToFrame() {
  // Prefer actual video dimensions
  let vw = video.videoWidth;
  let vh = video.videoHeight;

  // Fallback to track settings if needed
  if (!vw || !vh) {
    const s = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.() || {};
    if (s.width && s.height) { vw = s.width; vh = s.height; }
    else if (s.aspectRatio) { vw = s.aspectRatio; vh = 1; }
  }

  if (vw && vh) {
    const ar = vw / vh;
    // CSS aspect-ratio supports "<number> / <number>"
    cameraFrame.style.aspectRatio = `${vw} / ${vh}`;
    // If you want to ensure no bars appear at all costs, keep object-fit: cover on the <video>.
    // You can switch to 'contain' if you prefer full frame with letterboxing:
    // video.style.objectFit = 'cover';
  } else {
    // Leave default 3/4 if we couldn't read dimensions
    cameraFrame.style.aspectRatio = '3 / 4';
  }
}

const ui = document.querySelector('.ui');
const uiPanel = document.getElementById('uiPanel');
const menuToggle = document.getElementById('menuToggle');

// Start open
let menuOpen = true;

// Toggle handler
menuToggle.addEventListener('click', () => {
  menuOpen = !menuOpen;
  ui.classList.toggle('collapsed', !menuOpen);
  menuToggle.setAttribute('aria-expanded', String(menuOpen));
});


function isInUI(target) {
  return target.closest('.ui') !== null;
}

function onPointerDown(e) {
  if (isInUI(e.target)) return;
  app.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gestureStart = snapshot();
  e.preventDefault();
}
function onPointerMove(e) {
  if (isInUI(e.target)) return;
  if (!pointers.has(e.pointerId)) return;
  // ... existing move logic ...
  e.preventDefault();
}
function onPointerUp(e) {
  if (isInUI(e.target)) return;
  pointers.delete(e.pointerId);
  gestureStart = snapshot();
  e.preventDefault();
}


// Optional: re-evaluate on orientation change
window.addEventListener('orientationchange', () => {
  // Some devices keep same stream; still useful to reapply
  setTimeout(applyCameraAspectToFrame, 300);
});


  // ---- Reset ----
  resetBtn.addEventListener('click', () => {
    state.tx = 0; state.ty = 0; state.scale = 1; state.rot = 0;
    applyTransform();
    opacity.value = 50; syncOpacity();
    setStatus('Reset');
  });

  // ---- Start camera (button + attempt on load) ----
  startBtn.addEventListener('click', startCamera);
  if (navigator.mediaDevices?.getUserMedia) {
    // Some browsers (Android/Chrome) can start right away; iOS needs user gesture
    startCamera().catch(() => {/* handled above */});
  } else {
    setStatus('Camera not supported.');
  }

  // ---- Helpers ----
  function setStatus(msg) {
    statusEl.textContent = msg;
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => statusEl.textContent = '', 2500);
  }

  // Prevent iOS zoom gesture default
  document.addEventListener('gesturestart', e => e.preventDefault());
})();
