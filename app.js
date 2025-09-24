(function () {
  // Elements
  const video = document.getElementById('camera');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('start');
  const resetBtn = document.getElementById('reset');
  const opacity = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacityVal');
  const statusEl = document.getElementById('status');
  const file = document.getElementById('file');

  const cameraFrame = document.querySelector('.camera-frame');
  const gestureArea = cameraFrame; // bind gestures only to the frame

  const ui = document.querySelector('.ui');
  const uiPanel = document.getElementById('uiPanel');
  const menuToggle = document.getElementById('menuToggle');

  let stream = null;

  // Transform state
  const state = { tx: 0, ty: 0, scale: 1, rot: 0 };
  let pointers = new Map();     // id -> {x,y}
  let gestureStart = null;      // snapshot of state + first two points at gesture start

  // --- Camera ---
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
      video.style.transform = settings.facingMode === 'environment' ? 'none' : 'scaleX(-1)';
      setStatus(settings.facingMode === 'environment' ? 'Rear camera' : 'Front camera');

      video.addEventListener('loadedmetadata', () => {
        applyCameraAspectToFrame();
      }, { once: true });
    } catch (err) {
      console.error(err);
      setStatus('Camera error. Use HTTPS & allow permission.');
      alert('Could not start camera. Open this over HTTPS (or localhost) and allow camera access.');
    }
  }

  function applyCameraAspectToFrame() {
    let vw = video.videoWidth;
    let vh = video.videoHeight;

    if (!vw || !vh) {
      const s = video.srcObject?.getVideoTracks?.()[0]?.getSettings?.() || {};
      if (s.width && s.height) { vw = s.width; vh = s.height; }
      else if (s.aspectRatio) { vw = s.aspectRatio; vh = 1; }
    }
    cameraFrame.style.aspectRatio = (vw && vh) ? `${vw} / ${vh}` : '3 / 4';
  }

  window.addEventListener('orientationchange', () => {
    setTimeout(applyCameraAspectToFrame, 300);
  });

  // --- Image upload ---
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    overlay.src = url;
    overlay.onload = () => {
      const rect = cameraFrame.getBoundingClientRect();
      const fitScale = computeInitialScale(overlay.naturalWidth, overlay.naturalHeight, rect.width, rect.height);
      state.tx = 0; state.ty = 0; state.scale = fitScale; state.rot = 0;
      applyTransform();
      setStatus('Image loaded');
      URL.revokeObjectURL(url);
    };
    file.value = ''; // allow selecting same file again later
  });

  function computeInitialScale(imgW, imgH, frameW, frameH) {
    const sx = frameW / imgW;
    const sy = frameH / imgH;
    return Math.min(sx, sy) * 0.9;
  }

  // --- Opacity ---
  function syncOpacity() {
    const v = Number(opacity.value);
    overlay.style.opacity = (v / 100).toFixed(2);
    opacityVal.textContent = `${v}%`;
  }
  opacity.addEventListener('input', syncOpacity, { passive: true });
  syncOpacity();

  // === Gestures ===
  // Prefer Pointer Events if available; also wire Touch fallback with passive:false
  const supportsPointer = 'PointerEvent' in window;

  // We ensure the *actual* targets also allow prevention
  gestureArea.style.touchAction = 'none';
  video.style.touchAction = 'none';

  // ---- Pointer Events path ----
  if (supportsPointer) {
    gestureArea.addEventListener('pointerdown', onPointerDown, { passive: false });
    gestureArea.addEventListener('pointermove', onPointerMove, { passive: false });
    gestureArea.addEventListener('pointerup', onPointerUp, { passive: false });
    gestureArea.addEventListener('pointercancel', onPointerUp, { passive: false });
    gestureArea.addEventListener('pointerleave', onPointerUp, { passive: false });
  }

  function onPointerDown(e) {
    gestureArea.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gestureStart = snapshot();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updateTransformFromPointers();
    e.preventDefault();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    gestureStart = snapshot();
    e.preventDefault();
  }

  // ---- Touch Events fallback (for devices where pointer events are flaky) ----
  gestureArea.addEventListener('touchstart', onTouchStart, { passive: false });
  gestureArea.addEventListener('touchmove', onTouchMove, { passive: false });
  gestureArea.addEventListener('touchend', onTouchEnd, { passive: false });
  gestureArea.addEventListener('touchcancel', onTouchEnd, { passive: false });

  function onTouchStart(e) {
    // Map touches to synthetic pointer IDs (use identifier)
    for (let t of Array.from(e.changedTouches)) {
      pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    gestureStart = snapshot();
    e.preventDefault();
  }

  function onTouchMove(e) {
    for (let t of Array.from(e.touches)) {
      pointers.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    updateTransformFromPointers();
    e.preventDefault();
  }

  function onTouchEnd(e) {
    for (let t of Array.from(e.changedTouches)) {
      pointers.delete(t.identifier);
    }
    gestureStart = snapshot();
    e.preventDefault();
  }

  // --- Shared gesture math ---
  function updateTransformFromPointers() {
    if (pointers.size === 0) return;

    if (pointers.size === 1) {
      const p = firstPointer();
      const s = gestureStart;
      const dx = p.x - s.p0.x;
      const dy = p.y - s.p0.y;
      state.tx = s.tx + dx;
      state.ty = s.ty + dy;
      applyTransform();
      return;
    }

    // Use first two pointers
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

  // --- UI panel toggle ---
  let menuOpen = true;
  menuToggle?.addEventListener('click', () => {
    menuOpen = !menuOpen;
    ui.classList.toggle('collapsed', !menuOpen);
    menuToggle.setAttribute('aria-expanded', String(menuOpen));
  });

  // --- Reset ---
  resetBtn.addEventListener('click', () => {
    state.tx = 0; state.ty = 0; state.scale = 1; state.rot = 0;
    applyTransform();
    opacity.value = 50; syncOpacity();
    setStatus('Reset');
  });

  // --- Start camera ---
  startBtn.addEventListener('click', startCamera);
  if (navigator.mediaDevices?.getUserMedia) {
    startCamera().catch(() => {/* handled above */});
  } else {
    setStatus('Camera not supported.');
  }

  // --- Helpers ---
  function setStatus(msg) {
    statusEl.textContent = msg;
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => statusEl.textContent = '', 2500);
  }

  // Prevent iOS page-zoom gesture default (two-finger pinch on page)
  document.addEventListener('gesturestart', e => e.preventDefault());
})();
