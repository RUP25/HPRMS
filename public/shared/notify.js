/* HPRMS notification helper
 *
 *   chord(profile)          - one-shot beep pattern
 *   notify({title, body})   - one-shot beep + browser notification + title flash
 *   startRing(key, opts)    - PERSISTENT looping chime+vibration until stopRing(key)
 *   stopRing(key)           - clear one ring (loop stops when last ring cleared)
 *   stopAllRings()          - clear all
 *
 * Web Audio is unlocked on the first user gesture (browser autoplay rule).
 * Vibration uses navigator.vibrate where supported (Android Chrome / Samsung).
 */
window.HPRMSNotify = (function () {
  let audioCtx = null;
  let pendingTitle = 0;
  let baseTitle = document.title;
  let titleHandle = null;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) {}
    return audioCtx;
  }

  function unlock() {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Mobile browsers also use this gesture to allow vibration.
    if (navigator.vibrate) try { navigator.vibrate(0); } catch (_) {}
  }
  function unlockOnce() {
    unlock();
    document.removeEventListener('pointerdown', unlockOnce);
    document.removeEventListener('keydown', unlockOnce);
  }
  document.addEventListener('pointerdown', unlockOnce);
  document.addEventListener('keydown', unlockOnce);

  function beep({ freq = 880, duration = 180, volume = 0.28, type = 'sine' } = {}) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (_) {}
  }

  function chord(profile = 'default') {
    if (profile === 'urgent') {
      beep({ freq: 660, duration: 140 });
      setTimeout(() => beep({ freq: 990, duration: 220 }), 160);
      setTimeout(() => beep({ freq: 1320, duration: 220 }), 380);
    } else if (profile === 'soft') {
      beep({ freq: 550, duration: 220, volume: 0.18 });
    } else {
      beep({ freq: 880, duration: 180 });
      setTimeout(() => beep({ freq: 1175, duration: 220 }), 200);
    }
  }

  function flashTitle(label) {
    pendingTitle++;
    document.title = `(${pendingTitle}) ${label || baseTitle}`;
    if (titleHandle) clearInterval(titleHandle);
    let on = true;
    titleHandle = setInterval(() => {
      on = !on;
      document.title = on ? `(${pendingTitle}) ${label || baseTitle}` : baseTitle;
    }, 1500);
  }

  function clearTitle() {
    pendingTitle = 0;
    if (titleHandle) { clearInterval(titleHandle); titleHandle = null; }
    document.title = baseTitle;
  }

  function setBaseTitle(t) { baseTitle = t || baseTitle; }

  function requestDesktop() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  function desktop(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    try {
      new Notification(title, { body, tag, icon: '/assets/logo.png', badge: '/assets/logo.png' });
    } catch (_) {}
  }

  function notify({ title, body, profile = 'default', tag, flash = true }) {
    chord(profile);
    if (flash) flashTitle(title);
    desktop(title, body, tag);
  }

  // ----- Persistent ring loop --------------------------------------------
  const ringing = new Map();   // key -> {label, profile, startedAt}
  let ringHandle = null;
  let firstRingPlayed = false;

  function ringChime(profile) {
    if (profile === 'soft') {
      beep({ freq: 660, duration: 200, volume: 0.22 });
      setTimeout(() => beep({ freq: 990, duration: 280, volume: 0.22 }), 220);
    } else {
      // Bright, attention-grabbing 3-note chime
      beep({ freq: 988,  duration: 180, volume: 0.32 });
      setTimeout(() => beep({ freq: 1318, duration: 180, volume: 0.32 }), 200);
      setTimeout(() => beep({ freq: 1568, duration: 320, volume: 0.32 }), 400);
    }
    if (navigator.vibrate) {
      try { navigator.vibrate([220, 90, 220, 90, 360]); } catch (_) {}
    }
  }

  function tickRing() {
    if (ringing.size === 0) {
      stopAllRings();
      return;
    }
    let profile = 'default';
    for (const v of ringing.values()) if (v && v.profile === 'soft') profile = 'soft';
    ringChime(profile);
  }

  function startRingLoop() {
    if (ringHandle) return;
    firstRingPlayed = false;
    // Play the first chime immediately, then every 3 seconds.
    if (!firstRingPlayed) { tickRing(); firstRingPlayed = true; }
    ringHandle = setInterval(tickRing, 3000);
    document.body && document.body.classList && document.body.classList.add('hprms-ringing');
  }

  function clearRingLoop() {
    if (ringHandle) clearInterval(ringHandle);
    ringHandle = null;
    document.body && document.body.classList && document.body.classList.remove('hprms-ringing');
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (_) {} }
  }

  function startRing(key, opts = {}) {
    if (key == null) return;
    ringing.set(String(key), {
      label: opts.label || null,
      profile: opts.profile || 'default',
      startedAt: Date.now(),
    });
    if (opts.flashTitle !== false) flashTitle(opts.label || baseTitle);
    if (opts.desktop) desktop(opts.desktop.title, opts.desktop.body, opts.desktop.tag);
    startRingLoop();
  }

  function stopRing(key) {
    if (key == null) return;
    ringing.delete(String(key));
    if (ringing.size === 0) {
      clearRingLoop();
      clearTitle();
    }
  }

  function stopAllRings() {
    ringing.clear();
    clearRingLoop();
    clearTitle();
  }

  function ringingCount() { return ringing.size; }

  // When the page becomes hidden we keep ringing (so phones still buzz),
  // but when it becomes visible again we clear the title flash.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ringing.size === 0) clearTitle();
  });

  return {
    beep, chord, notify, flashTitle, clearTitle, setBaseTitle, requestDesktop,
    startRing, stopRing, stopAllRings, ringingCount,
  };
})();
