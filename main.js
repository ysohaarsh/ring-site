(() => {
  "use strict";

  /* ── edit me ──────────────────────────────────────────────────────────
     Everything personal on the page comes from here.                    */
  const PROFILE = {
    name: "Harsh Yadav",
    ring: "Harsh Yadav makes things with code from India: 3D worlds, live maps, pixel games. One commit a day.",
    tagline: "You don't have to go home but you can't stay here.",
  };

  // Each wall bounce moves to the next one.
  const THEMES = [
    { bg: "#050805", fg: "#3dff7c", glow: "rgba(61,255,124,0.45)" }, // phosphor
    { bg: "#3dff7c", fg: "#041006", glow: "transparent" },
    { bg: "#0a0a1f", fg: "#ffb000", glow: "rgba(255,176,0,0.45)" }, // amber
    { bg: "#ffb000", fg: "#1a0e00", glow: "transparent" },
    { bg: "#12021f", fg: "#ff4fd8", glow: "rgba(255,79,216,0.45)" }, // magenta
    { bg: "#00e5ff", fg: "#001318", glow: "transparent" },
    { bg: "#0b24fb", fg: "#ffffff", glow: "rgba(255,255,255,0.35)" }, // blue screen
    { bg: "#f2f0e6", fg: "#111111", glow: "transparent" }, // paper
  ];

  const CFG = {
    spinSeconds: 60,
    maxFont: 26,
    gapSlots: 2.4,
    bounce: 0.94,
    friction: 0.975,
    gravity: 0.0005,
    maxSquish: 0.7,
    popDepth: 0.5,
    popHold: 900,
    burstMs: 1400,
    gatherMs: 950,
    roundMs: 15000,
    goalSize: 2,
    puckFriction: 0.012,
  };
  const TWEAK_DEFAULTS = { goalSize: CFG.goalSize, puckFriction: CFG.puckFriction };

  /* ── setup ─────────────────────────────────────────────────────────── */

  const $ = (selector) => document.querySelector(selector);
  const TAU = Math.PI * 2;
  const FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapAngle = (a) => {
    let v = (a + Math.PI) % TAU;
    if (v < 0) v += TAU;
    return v - Math.PI;
  };

  const store = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* private mode or blocked storage: the page works without it */
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* same */
      }
    },
  };

  const root = document.documentElement;
  const canvas = $(".stage");
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const isIOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const query = new URLSearchParams(window.location.search);

  document.title = PROFILE.name;
  canvas.setAttribute("aria-label", PROFILE.ring);
  document.querySelectorAll("[data-profile]").forEach((node) => {
    node.textContent = PROFILE[node.dataset.profile] ?? node.textContent;
  });
  $(".hint-text").textContent = coarse
    ? "drag · squeeze into a wall · pinch · tilt · double-tap to play"
    : "drag · squeeze into a wall · scroll to resize · double-click to play";

  const CHARS = Array.from(PROFILE.ring);
  const CURSOR = CHARS.length; // a blinking block sits right after the last letter
  const SLOTS = CHARS.length + 1 + CFG.gapSlots;
  const WORDS = [];
  {
    let start = -1;
    for (let i = 0; i <= CHARS.length; i += 1) {
      const isSpace = i === CHARS.length || /\s/.test(CHARS[i]);
      if (!isSpace && start < 0) start = i;
      if (isSpace && start >= 0) {
        WORDS.push({ i0: start, i1: i - 1, text: CHARS.slice(start, i) });
        start = -1;
      }
    }
  }

  let W = 0;
  let H = 0;
  let dpr = 1;
  let advRatio = 0.6;
  let fg = THEMES[0].fg;
  let themeIndex = 0;
  let bouncesSinceTheme = 0;

  const N = 64; // soft-body points around each ring
  const COS = new Float32Array(N);
  const SIN = new Float32Array(N);
  for (let k = 0; k < N; k += 1) {
    COS[k] = Math.cos((k / N) * TAU);
    SIN[k] = Math.sin((k / N) * TAU);
  }

  const bodies = [];
  const pointers = new Map();
  let hockey = null;
  let pop = null;
  let pinch = null;
  let lastTap = null;
  let lastFrame = 0;

  const makeBody = (id, passive = false) => ({
    id,
    passive,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    scale: 1,
    scaleAnim: null,
    spin: Math.PI,
    spinVel: 0,
    d: new Float32Array(N),
    dv: new Float32Array(N),
    tmp: new Float32Array(N),
    drag: null,
    press: { l: 0, r: 0, t: 0, b: 0 },
    chargeStart: 0,
    awake: false,
    hidden: false,
    inGoal: false,
    respawnAt: 0,
    layout: null,
  });

  /* ── theme ─────────────────────────────────────────────────────────── */

  const applyTheme = () => {
    const theme = THEMES[themeIndex];
    fg = theme.fg;
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--fg", theme.fg);
    root.style.setProperty("--glow", theme.glow);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  };

  const registerBounce = () => {
    if (pop) return;
    bouncesSinceTheme += 1;
    if (bouncesSinceTheme < Math.max(1, bodies.length)) return;
    bouncesSinceTheme = 0;
    themeIndex = (themeIndex + 1) % THEMES.length;
    applyTheme();
  };

  /* ── sound (all synthesized, no audio files) ───────────────────────── */

  let soundOn = store.get("hy-ring-sound") !== "off";
  let ac = null;
  let master = null;
  let noiseBuffer = null;
  let squeakVoice = null;
  let lastThump = -1;
  const soundButton = $(".sound");

  const renderSoundButton = () => {
    soundButton.textContent = soundOn ? "[sound on]" : "[sound off]";
    soundButton.setAttribute("aria-pressed", String(soundOn));
  };

  const wakeAudio = () => {
    if (!soundOn) return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!ac) {
      try {
        ac = new AudioCtor();
      } catch {
        return null;
      }
      master = ac.createGain();
      master.gain.value = 0.8;
      master.connect(ac.destination);
      noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (ac.state === "suspended") ac.resume().catch(() => {});
    return ac;
  };

  const liveAudio = () => (soundOn && ac && ac.state === "running" ? ac : null);

  const tone = (type, from, to, duration, gain, delay = 0) => {
    const a = liveAudio();
    if (!a) return;
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const amp = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  };

  const noise = (duration, gain, filterType, frequency, q = 1) => {
    const a = liveAudio();
    if (!a) return;
    const t = a.currentTime;
    const src = a.createBufferSource();
    const filter = a.createBiquadFilter();
    const amp = a.createGain();
    src.buffer = noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(amp).connect(master);
    src.start(t, Math.random() * 0.5, duration + 0.02);
  };

  const thump = (impact, gainScale = 1) => {
    const a = liveAudio();
    if (!a || a.currentTime - lastThump < 0.045) return;
    lastThump = a.currentTime;
    const level = clamp(impact / 1.6, 0.06, 1) * 0.5 * gainScale;
    tone("sine", 150 + impact * 40, 52, 0.16, level);
    noise(0.035, level * 0.3, "bandpass", 900, 0.8);
  };

  const popSound = () => {
    noise(0.2, 0.9, "highpass", 600);
    tone("sine", 260, 55, 0.14, 0.6);
  };

  const goalSound = () => {
    tone("square", 880, 880, 0.07, 0.1);
    tone("square", 1320, 1320, 0.12, 0.1, 0.07);
  };

  const buzzer = () => tone("square", 220, 110, 0.45, 0.12);

  // Rubber squeak while a ring is being pressed into a wall: two detuned saws
  // through a band-pass, chopped by a fast LFO for the stick-slip texture.
  const squeak = (pressure, moving) => {
    const a = liveAudio();
    if (!a) return;
    if (!squeakVoice) {
      if (pressure < 0.03) return;
      const osc1 = a.createOscillator();
      const osc2 = a.createOscillator();
      const band = a.createBiquadFilter();
      const chop = a.createGain();
      const lfo = a.createOscillator();
      const lfoDepth = a.createGain();
      const out = a.createGain();
      osc1.type = "sawtooth";
      osc2.type = "sawtooth";
      band.type = "bandpass";
      band.Q.value = 5;
      chop.gain.value = 0.55;
      lfo.type = "square";
      lfoDepth.gain.value = 0.45;
      out.gain.value = 0;
      lfo.connect(lfoDepth).connect(chop.gain);
      osc1.connect(band);
      osc2.connect(band);
      band.connect(chop).connect(out).connect(master);
      osc1.start();
      osc2.start();
      lfo.start();
      squeakVoice = { osc1, osc2, band, lfo, out, last: pressure };
    }
    const voice = squeakVoice;
    const t = a.currentTime;
    const change = Math.abs(pressure - voice.last);
    voice.last = pressure;
    const level =
      moving && pressure > 0.04 ? clamp(0.02 + change * 7 + pressure * 0.04, 0, 0.22) : 0;
    const pitch = 280 + pressure * 620;
    voice.out.gain.setTargetAtTime(level, t, level > 0 ? 0.02 : 0.06);
    voice.osc1.frequency.setTargetAtTime(pitch, t, 0.03);
    voice.osc2.frequency.setTargetAtTime(pitch * 1.5 + 7, t, 0.03);
    voice.band.frequency.setTargetAtTime(pitch * 2.2, t, 0.03);
    voice.lfo.frequency.setTargetAtTime(22 + pressure * 44, t, 0.03);
  };

  const hushSqueak = () => {
    if (squeakVoice && ac) squeakVoice.out.gain.setTargetAtTime(0, ac.currentTime, 0.03);
  };

  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    store.set("hy-ring-sound", soundOn ? "on" : "off");
    renderSoundButton();
    if (soundOn) wakeAudio();
    else hushSqueak();
  });
  renderSoundButton();

  /* ── tilt gravity ──────────────────────────────────────────────────── */

  const motion = { x: 0, y: 0, at: -1e9, asked: false };

  const onMotion = (event) => {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    if (Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z || 0) < 0.5) return;
    // iOS reports the opposite sign from the spec.
    const nx = isIOS ? a.x : -a.x;
    const ny = isIOS ? -a.y : a.y;
    const angle = ((window.screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    const sx = nx * Math.cos(angle) + ny * Math.sin(angle);
    const sy = -nx * Math.sin(angle) + ny * Math.cos(angle);
    const strength = 0.0016 / 9.81;
    motion.x = lerp(motion.x, sx * strength, 0.2);
    motion.y = lerp(motion.y, sy * strength, 0.2);
    motion.at = performance.now();
  };

  const requestMotion = () => {
    if (motion.asked) return;
    motion.asked = true;
    const Motion = window.DeviceMotionEvent;
    if (!Motion) return;
    if (typeof Motion.requestPermission === "function") {
      Motion.requestPermission()
        .then((state) => {
          if (state === "granted") window.addEventListener("devicemotion", onMotion);
        })
        .catch(() => {});
    } else {
      window.addEventListener("devicemotion", onMotion);
    }
  };

  if (isIOS) {
    // iOS only grants motion access from inside a tap.
    document.addEventListener("touchend", requestMotion, { once: true });
  } else if (coarse) {
    requestMotion();
  }

  const gravityNow = (time) =>
    time - motion.at < 600 ? motion : { x: 0, y: CFG.gravity };

  /* ── layout ────────────────────────────────────────────────────────── */

  const MIN_SCALE = 0.45;
  const baseRadius = () => clamp(Math.min(W, H) * 0.34, 90, 300);
  const maxScale = () => clamp((Math.min(W, H) * 0.47) / (baseRadius() * 1.1), 1, 1.7);

  const measureAdvance = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `500 100px ${FONT}`;
    advRatio = ctx.measureText("M").width / 100 || 0.6;
    ctx.restore();
  };

  const layoutBody = (b) => {
    const R = baseRadius() * b.scale;
    const font = Math.min(CFG.maxFont * b.scale, (TAU * R) / (SLOTS * advRatio));
    b.layout = { R, font, step: TAU / SLOTS, Rc: R + font * 0.62 };
  };

  const clampBody = (b) => {
    const { Rc } = b.layout;
    b.x = clamp(b.x, Rc, Math.max(Rc, W - Rc));
    if (!b.inGoal) b.y = Math.max(b.y, Rc);
    b.y = Math.min(b.y, Math.max(Rc, H - Rc));
  };

  const resize = () => {
    const first = W === 0;
    const prevW = W;
    const prevH = H;
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(H * dpr);
    for (const b of bodies) {
      layoutBody(b);
      if (first) {
        b.x = W / 2;
        b.y = H / 2;
      } else if (!b.awake) {
        b.x = (b.x / prevW) * W;
        b.y = (b.y / prevH) * H;
      }
      clampBody(b);
    }
  };

  const slotAngle = (b, index) => b.spin + (CFG.gapSlots / 2 + index + 0.5) * b.layout.step;

  /* ── soft body ─────────────────────────────────────────────────────── */

  const STIFFNESS = 0.09;
  const TENSION = 0.22;
  const DAMPING = 0.92;

  const sample = (b, angle) => {
    let u = angle / TAU;
    u -= Math.floor(u);
    const x = u * N;
    const i = Math.floor(x) % N;
    const t = x - Math.floor(x);
    return b.d[i] * (1 - t) + b.d[(i + 1) % N] * t;
  };

  // A squashed ring is no longer a circle, so equal angles stop meaning equal
  // spacing and letters pile up on the flat side. These two walk the deformed
  // outline and hand back the angle that sits a given fraction along it.
  const ARC_STEPS = 128;
  const arcLength = new Float32Array(ARC_STEPS + 1);

  const buildArc = (b) => {
    let deformed = 0;
    for (let k = 0; k < N; k += 1) deformed = Math.max(deformed, Math.abs(b.d[k]));
    if (deformed < 0.5) return false;
    const { R } = b.layout;
    let px = R + sample(b, 0);
    let py = 0;
    arcLength[0] = 0;
    for (let m = 1; m <= ARC_STEPS; m += 1) {
      const theta = (m / ARC_STEPS) * TAU;
      const r = R + sample(b, theta);
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      arcLength[m] = arcLength[m - 1] + Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    return true;
  };

  const arcAngle = (angle) => {
    let u = angle / TAU;
    u -= Math.floor(u);
    const target = u * arcLength[ARC_STEPS];
    let lo = 0;
    let hi = ARC_STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arcLength[mid] <= target) lo = mid;
      else hi = mid;
    }
    const span = arcLength[hi] - arcLength[lo];
    return ((lo + (span > 0 ? (target - arcLength[lo]) / span : 0)) / ARC_STEPS) * TAU;
  };

  // Dent the ring at `angle` and let the sides bulge out.
  const inject = (b, angle, impact) => {
    const strength = clamp(impact, 0, 2.5) * b.layout.R * 0.035;
    for (let k = 0; k < N; k += 1) {
      const delta = wrapAngle((k / N) * TAU - angle);
      const c = Math.cos(delta);
      const s = Math.sin(delta);
      b.dv[k] += -strength * (c > 0 ? c * c * c : 0) + strength * 0.3 * s * s;
    }
  };

  const stepSoft = (b, f) => {
    const { d, dv, tmp } = b;
    const { R, font } = b.layout;
    const steps = f > 1.2 ? 2 : 1;
    const h = f / steps;
    const damp = Math.pow(DAMPING, h);
    // Air squeezed out of the flattened side pushes the rest of the ring out.
    const bulge = (b.press.l + b.press.r + b.press.t + b.press.b) * 0.02;

    for (let step = 0; step < steps; step += 1) {
      for (let k = 0; k < N; k += 1) {
        const lap = d[(k + N - 1) % N] + d[(k + 1) % N] - 2 * d[k];
        tmp[k] = dv[k] + (-STIFFNESS * d[k] + TENSION * lap + bulge) * h;
      }
      for (let k = 0; k < N; k += 1) {
        dv[k] = tmp[k] * damp;
        d[k] += dv[k] * h;
      }
    }

    // Nothing may poke through a wall: flatten whatever would.
    const inset = font * 0.62;
    for (let k = 0; k < N; k += 1) {
      const c = COS[k];
      const s = SIN[k];
      let limit = Infinity;
      if (c < -0.08) limit = Math.min(limit, (inset - b.x) / c);
      if (c > 0.08) limit = Math.min(limit, (W - inset - b.x) / c);
      if (s < -0.08 && !b.inGoal) limit = Math.min(limit, (inset - b.y) / s);
      if (s > 0.08) limit = Math.min(limit, (H - inset - b.y) / s);
      if (R + d[k] > limit) {
        d[k] = Math.max(limit, R * 0.15) - R;
        if (dv[k] > 0) dv[k] = 0;
      }
      if (d[k] < -R * 0.82) d[k] = -R * 0.82;
    }
  };

  /* ── walls and collisions ──────────────────────────────────────────── */

  const goalRange = () => {
    const puck = bodies[1];
    const width = Math.min(W * 0.86, puck.layout.Rc * 2 * CFG.goalSize);
    return [W / 2 - width / 2, W / 2 + width / 2];
  };

  const wallHit = (b, angle, impact, spinKick) => {
    if (impact < 0.06) return;
    inject(b, angle, impact);
    thump(impact);
    b.spinVel = clamp(b.spinVel + (spinKick / b.layout.R) * 0.35, -0.012, 0.012);
    if (impact > 0.12) registerBounce();
  };

  // Bounce a free body off the viewport edges. Returns true if it left through the goal.
  const walls = (b, dt) => {
    const { Rc } = b.layout;
    const e = hockey ? 0.98 : CFG.bounce;
    const settle = (v) => (Math.abs(v) < 0.03 ? 0 : v);

    if (b.x < Rc) {
      b.x = Rc;
      if (b.vx < 0) {
        const impact = -b.vx;
        b.vx = settle(impact * e);
        wallHit(b, Math.PI, impact, b.vy);
      }
    } else if (b.x > W - Rc) {
      b.x = W - Rc;
      if (b.vx > 0) {
        const impact = b.vx;
        b.vx = settle(-impact * e);
        wallHit(b, 0, impact, -b.vy);
      }
    }

    if (b.passive && hockey && !hockey.over) {
      const [g0, g1] = goalRange();
      const lined = b.x > g0 + Rc * 0.55 && b.x < g1 - Rc * 0.55;
      if (b.y < Rc && (b.inGoal || (lined && b.vy < 0))) {
        b.inGoal = true;
        const lo = g0 + Rc;
        const hi = g1 - Rc;
        if (lo < hi) {
          // Ease a puck that clipped a post into the mouth.
          if (b.x < lo) {
            b.x += (lo - b.x) * 0.25;
            if (b.vx < 0) b.vx *= -0.4;
          } else if (b.x > hi) {
            b.x += (hi - b.x) * 0.25;
            if (b.vx > 0) b.vx *= -0.4;
          }
        }
        b.vy -= 0.0006 * dt;
        return b.y < -Rc * 0.5;
      }
    }
    if (b.inGoal && b.y >= Rc) b.inGoal = false;

    if (b.y < Rc) {
      b.y = Rc;
      if (b.vy < 0) {
        const impact = -b.vy;
        b.vy = settle(impact * e);
        wallHit(b, -Math.PI / 2, impact, -b.vx);
      }
    } else if (b.y > H - Rc) {
      b.y = H - Rc;
      if (b.vy > 0) {
        const impact = b.vy;
        b.vy = settle(-impact * e);
        wallHit(b, Math.PI / 2, impact, b.vx);
      }
    }
    return false;
  };

  const collideBodies = () => {
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.hidden || b.hidden || a.inGoal || b.inGoal) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const min = a.layout.Rc + b.layout.Rc;
        if (dist >= min) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = min - dist;
        const invA = a.drag ? 0 : 1;
        const invB = b.drag ? 0 : 1;
        const inv = invA + invB;
        if (inv === 0) continue;
        a.x -= nx * overlap * (invA / inv);
        a.y -= ny * overlap * (invA / inv);
        b.x += nx * overlap * (invB / inv);
        b.y += ny * overlap * (invB / inv);

        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const impulse = (-(1 + 0.96) * rv) / inv;
          a.vx -= impulse * nx * invA;
          a.vy -= impulse * ny * invA;
          b.vx += impulse * nx * invB;
          b.vy += impulse * ny * invB;
          const impact = -rv;
          if (impact > 0.06) {
            const angle = Math.atan2(ny, nx);
            inject(a, angle, impact * 0.8);
            inject(b, angle + Math.PI, impact * 0.8);
            thump(impact, 0.9);
            if (impact > 0.12) registerBounce();
          }
        }
        if (!a.drag) clampBody(a);
        if (!b.drag) clampBody(b);
      }
    }
  };

  /* ── dragging, squeezing, launching ────────────────────────────────── */

  const pickBody = (x, y) => {
    let best = null;
    let bestDist = Infinity;
    for (const b of bodies) {
      if (b.hidden) continue;
      const dist = Math.hypot(x - b.x, y - b.y);
      if (dist <= b.layout.Rc + 10 && dist < bestDist) {
        best = b;
        bestDist = dist;
      }
    }
    return best;
  };

  const beginDrag = (b, id, x, y, now) => {
    b.drag = { id, ox: x - b.x, oy: y - b.y, lastX: x, lastY: y, lastT: now, moveT: -1e9, vx: 0, vy: 0 };
    b.vx = 0;
    b.vy = 0;
    b.awake = true;
    b.scaleAnim = b.scaleAnim && hockey ? b.scaleAnim : null;
    canvas.style.cursor = "grabbing";
  };

  // Follow the pointer; pushing past a wall compresses the ring with rising resistance.
  const applyDragTarget = (b, x, y) => {
    const { R, Rc } = b.layout;
    const cmax = R * CFG.maxSquish;
    const squash = (raw) => (hockey ? 0 : cmax * Math.tanh(raw / cmax));
    const press = b.press;
    let tx = x - b.drag.ox;
    let ty = y - b.drag.oy;
    press.l = press.r = press.t = press.b = 0;
    if (tx < Rc) {
      press.l = squash(Rc - tx);
      tx = Rc - press.l;
    } else if (tx > W - Rc) {
      press.r = squash(tx - (W - Rc));
      tx = W - Rc + press.r;
    }
    if (ty < Rc) {
      press.t = squash(Rc - ty);
      ty = Rc - press.t;
    } else if (ty > H - Rc) {
      press.b = squash(ty - (H - Rc));
      ty = H - Rc + press.b;
    }
    b.x = tx;
    b.y = ty;
  };

  const maxPress = (b) => Math.max(b.press.l, b.press.r, b.press.t, b.press.b);
  const clearPress = (b) => {
    b.press.l = b.press.r = b.press.t = b.press.b = 0;
    b.chargeStart = 0;
  };

  const launch = (b) => {
    const { R, Rc } = b.layout;
    const press = b.press;
    const full = Math.max(30, R * CFG.popDepth);
    const speed = (compression, span) =>
      (0.5 + span * 0.0028) * Math.pow(Math.min(1, compression / full), 2.4) * 1.7;
    const horizontal = Math.max(press.l, press.r);
    const vertical = Math.max(press.t, press.b);
    b.vx = 0;
    b.vy = 0;
    if (horizontal > 4) {
      const fromLeft = press.l >= press.r;
      b.x = fromLeft ? Rc : W - Rc;
      b.vx = (fromLeft ? 1 : -1) * speed(horizontal, W - 2 * Rc);
      inject(b, fromLeft ? Math.PI : 0, Math.abs(b.vx) * 0.7);
    }
    if (vertical > 4) {
      const fromTop = press.t >= press.b;
      b.y = fromTop ? Rc : H - Rc;
      b.vy = (fromTop ? 1 : -1) * speed(vertical, H - 2 * Rc);
      inject(b, fromTop ? -Math.PI / 2 : Math.PI / 2, Math.abs(b.vy) * 0.7);
    }
    thump(Math.hypot(b.vx, b.vy));
    registerBounce();
  };

  const releaseDrag = (b, now, cancelled) => {
    const drag = b.drag;
    b.drag = null;
    canvas.style.cursor = "";
    hushSqueak();
    if (!hockey && maxPress(b) > 6) {
      launch(b);
    } else if (!cancelled && now - drag.moveT < 90) {
      const speed = Math.hypot(drag.vx, drag.vy);
      const cap = speed > 4 ? 4 / speed : 1;
      b.vx = drag.vx * cap;
      b.vy = drag.vy * cap;
    } else {
      b.vx = 0;
      b.vy = 0;
    }
    clearPress(b);
  };

  /* ── pinch and wheel resize ────────────────────────────────────────── */

  const rubber = (value, min, max) => {
    if (value < min) return min * Math.pow(value / min, 0.4);
    if (value > max) return max * Math.pow(value / max, 0.4);
    return value;
  };

  const pinchPoints = () => {
    const a = pointers.get(pinch.idA);
    const b = pointers.get(pinch.idB);
    return a && b ? [a, b] : null;
  };

  const beginPinch = (idA, idB) => {
    const a = pointers.get(idA);
    const c = pointers.get(idB);
    if (!a || !c) return;
    const p = bodies[0];
    pinch = {
      idA,
      idB,
      startDist: Math.max(24, Math.hypot(a.x - c.x, a.y - c.y)),
      startScale: p.scale,
      ox: (a.x + c.x) / 2 - p.x,
      oy: (a.y + c.y) / 2 - p.y,
    };
    p.scaleAnim = null;
    p.vx = 0;
    p.vy = 0;
    clearPress(p);
    hushSqueak();
  };

  const updatePinch = () => {
    const points = pinchPoints();
    if (!points) return;
    const [a, c] = points;
    const p = bodies[0];
    const raw = (pinch.startScale * Math.hypot(a.x - c.x, a.y - c.y)) / pinch.startDist;
    p.scale = rubber(raw, MIN_SCALE, maxScale());
    layoutBody(p);
    p.x = (a.x + c.x) / 2 - pinch.ox;
    p.y = (a.y + c.y) / 2 - pinch.oy;
    clampBody(p);
  };

  const finishPinch = () => {
    const p = bodies[0];
    pinch = null;
    p.drag = null;
    canvas.style.cursor = "";
    p.scaleAnim = { to: clamp(p.scale, MIN_SCALE, maxScale()), v: 0 };
  };

  const stepScale = (b, dt) => {
    const anim = b.scaleAnim;
    if (!anim) return;
    const h = Math.min(0.032, dt / 1000);
    anim.v += (-210 * (b.scale - anim.to) - 20 * anim.v) * h;
    b.scale = Math.max(0.05, b.scale + anim.v * h);
    if (Math.abs(b.scale - anim.to) < 0.0008 && Math.abs(anim.v) < 0.01) {
      b.scale = anim.to;
      b.scaleAnim = null;
    }
    layoutBody(b);
    if (!b.drag) clampBody(b);
  };

  canvas.addEventListener(
    "wheel",
    (event) => {
      const p = bodies[0];
      if (hockey || pop || pinch || pickBody(event.clientX, event.clientY) !== p) return;
      event.preventDefault();
      const from = p.scaleAnim ? p.scaleAnim.to : p.scale;
      const to = clamp(from * Math.exp(-event.deltaY * 0.0016), MIN_SCALE, maxScale());
      p.scaleAnim = { to, v: p.scaleAnim ? p.scaleAnim.v : 0 };
    },
    { passive: false },
  );

  /* ── pop into words, then reassemble ───────────────────────────────── */

  const triggerPop = (b, time) => {
    const { R, step, font } = b.layout;
    const press = b.press;
    const away = { x: (press.l > 4 ? 1 : 0) - (press.r > 4 ? 1 : 0), y: (press.t > 4 ? 1 : 0) - (press.b > 4 ? 1 : 0) };
    const warped = buildArc(b);
    const words = WORDS.map((word) => {
      const nominal = slotAngle(b, (word.i0 + word.i1) / 2);
      const angle = warped ? arcAngle(nominal) : nominal;
      const radius = R + sample(b, angle);
      const x = b.x + Math.cos(angle) * radius;
      const y = b.y + Math.sin(angle) * radius;
      const power = 0.55 + Math.random() * 0.9;
      return {
        text: word.text,
        mid: (word.i0 + word.i1) / 2,
        x,
        y,
        rot: angle + Math.PI / 2,
        vx: Math.cos(angle) * power + away.x * 0.5 + (Math.random() - 0.5) * 0.3,
        vy: Math.sin(angle) * power + away.y * 0.5 + (Math.random() - 0.5) * 0.3,
        vr: (Math.random() - 0.5) * 0.012,
        from: null,
      };
    });
    pop = { t0: time, phase: "burst", words, font, slot: step * R, body: b };
    b.hidden = true;
    b.drag = null;
    b.vx = 0;
    b.vy = 0;
    b.d.fill(0);
    b.dv.fill(0);
    clearPress(b);
    canvas.style.cursor = "";
    hushSqueak();
    popSound();
  };

  const updatePop = (time, dt, f) => {
    const b = pop.body;
    if (pop.phase === "burst") {
      const g = gravityNow(time);
      const drag = Math.pow(0.99, f);
      for (const word of pop.words) {
        word.vx = (word.vx + g.x * 2.4 * dt) * drag;
        word.vy = (word.vy + g.y * 2.4 * dt) * drag;
        word.x += word.vx * dt;
        word.y += word.vy * dt;
        word.rot += word.vr * dt;
        const margin = 18;
        if (word.x < margin && word.vx < 0) (word.x = margin), (word.vx *= -0.6);
        if (word.x > W - margin && word.vx > 0) (word.x = W - margin), (word.vx *= -0.6);
        if (word.y < margin && word.vy < 0) (word.y = margin), (word.vy *= -0.6);
        if (word.y > H - margin && word.vy > 0) {
          word.y = H - margin;
          word.vy *= -0.6;
          word.vr *= 0.6;
        }
      }
      if (time - pop.t0 >= CFG.burstMs) {
        pop.phase = "gather";
        pop.t0 = time;
        b.x = W / 2;
        b.y = H / 2;
        for (const word of pop.words) word.from = { x: word.x, y: word.y, rot: word.rot };
      }
      return;
    }

    const t = clamp((time - pop.t0) / CFG.gatherMs, 0, 1);
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const { R } = b.layout;
    for (const word of pop.words) {
      const angle = slotAngle(b, word.mid);
      word.x = lerp(word.from.x, b.x + Math.cos(angle) * R, ease);
      word.y = lerp(word.from.y, b.y + Math.sin(angle) * R, ease);
      word.rot = word.from.rot + wrapAngle(angle + Math.PI / 2 - word.from.rot) * ease;
    }
    pop.blend = clamp((t - 0.78) / 0.22, 0, 1);
    if (t >= 1) {
      b.hidden = false;
      b.awake = false; // floats in the middle again until touched
      pop = null;
    }
  };

  /* ── air hockey ────────────────────────────────────────────────────── */

  const hud = $(".hud");
  const hudTimer = $(".hud-timer");
  const hudScore = $(".hud-score");
  const burstEl = $(".burst");
  const endCard = $(".end-card");
  const endScore = $(".end-score");
  const endLabel = $(".end-label");
  const boardList = $(".board-list");
  const boardForm = $(".board-form");
  const boardStatus = $(".board-status");
  const initialInputs = [...document.querySelectorAll(".initials input")];
  const BOARD_KEY = "hy-ring-leaderboard-v1";
  const BOARD_SIZE = 8;

  const loadBoard = () => {
    try {
      const parsed = JSON.parse(store.get(BOARD_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e) => e && Number.isFinite(e.score) && /^[A-Z]{3}$/.test(e.initials))
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, BOARD_SIZE);
    } catch {
      return [];
    }
  };

  const renderBoard = (highlightAt) => {
    const entries = loadBoard();
    boardList.textContent = "";
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.textContent = "no scores yet. be the first.";
      boardList.append(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement("li");
      if (entry.at === highlightAt) row.classList.add("is-new");
      for (const [cls, text] of [
        ["rank", String(index + 1).padStart(2, "0")],
        ["name", entry.initials],
        ["score", String(entry.score)],
      ]) {
        const cell = document.createElement("span");
        cell.className = cls;
        cell.textContent = text;
        row.append(cell);
      }
      boardList.append(row);
    });
  };

  const qualifies = (score) => {
    if (score <= 0) return false;
    const entries = loadBoard();
    return entries.length < BOARD_SIZE || score > entries[entries.length - 1].score;
  };

  initialInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^a-z]/gi, "").slice(-1).toUpperCase();
      if (input.value && index < initialInputs.length - 1) initialInputs[index + 1].focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        initialInputs[index - 1].focus();
      }
    });
  });

  boardForm.addEventListener("paste", (event) => {
    const letters = (event.clipboardData?.getData("text") || "").replace(/[^a-z]/gi, "").toUpperCase();
    if (!letters) return;
    event.preventDefault();
    initialInputs.forEach((input, index) => {
      input.value = letters[index] || "";
    });
    initialInputs[Math.min(letters.length, initialInputs.length) - 1].focus();
  });

  boardForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!hockey) return;
    const initials = initialInputs.map((input) => input.value).join("");
    if (!/^[A-Z]{3}$/.test(initials)) {
      boardStatus.textContent = "three letters, please.";
      (initialInputs.find((input) => !input.value) || initialInputs[0]).focus();
      return;
    }
    const at = Date.now();
    const entries = [...loadBoard(), { initials, score: hockey.score, at }];
    store.set(BOARD_KEY, JSON.stringify(entries));
    boardForm.hidden = true;
    boardStatus.textContent = "signed. saved on this device.";
    renderBoard(at);
    $(".end-replay").focus();
  });

  const renderHud = (time) => {
    const left = Math.max(0, Math.ceil((hockey.endsAt - time) / 1000));
    const text = `:${String(left).padStart(2, "0")}`;
    if (hudTimer.textContent !== text) hudTimer.textContent = text;
    hud.classList.toggle("is-urgent", left <= 3 && !hockey.over);
  };

  const startRound = () => {
    hockey.score = 0;
    hockey.over = false;
    hockey.flash = -1e9;
    hockey.endsAt = performance.now() + CFG.roundMs;
    hudScore.textContent = "0";
    endCard.hidden = true;
    renderHud(performance.now());
  };

  const finishRound = () => {
    hockey.over = true;
    for (const b of bodies) {
      b.drag = null;
      b.inGoal = false;
      clearPress(b);
    }
    pointers.clear();
    canvas.style.cursor = "";
    buzzer();
    endScore.textContent = String(hockey.score);
    endLabel.textContent = hockey.score === 1 ? "goal" : "goals";
    boardStatus.textContent = "";
    initialInputs.forEach((input) => {
      input.value = "";
    });
    boardForm.hidden = !qualifies(hockey.score);
    renderBoard();
    endCard.hidden = false;
    (boardForm.hidden ? $(".end-replay") : initialInputs[0]).focus();
  };

  const placePuck = (puck, x, y) => {
    puck.x = x;
    puck.y = y;
    puck.vx = 0;
    puck.vy = 0;
    puck.inGoal = false;
    puck.hidden = false;
    puck.d.fill(0);
    puck.dv.fill(3); // arrives with a little outward wobble
    clampBody(puck);
  };

  const scoreGoal = (puck, time) => {
    hockey.score += 1;
    hockey.flash = time;
    hudScore.textContent = String(hockey.score);
    burstEl.classList.remove("is-live");
    void burstEl.offsetWidth;
    burstEl.classList.add("is-live");
    goalSound();
    puck.hidden = true;
    puck.respawnAt = time + 240;
  };

  const enterHockey = (tapX, tapY) => {
    if (hockey || pop || pinch) return;
    const striker = bodies[0];
    if (striker.drag) return;
    hockey = { baseScale: striker.scaleAnim ? striker.scaleAnim.to : striker.scale, score: 0, over: false, endsAt: 0, flash: -1e9 };
    const half = clamp(hockey.baseScale * 0.5, 0.4, 0.6);
    striker.scaleAnim = { to: half, v: 0 };
    striker.awake = true;
    striker.vx = 0;
    striker.vy = 0;

    const puck = makeBody(1, true);
    puck.scale = half;
    puck.spin = striker.spin + 0.6;
    puck.awake = true;
    layoutBody(puck);
    bodies.push(puck);

    // Spawn on the side that was tapped, or above if the tap was dead centre.
    let angle = Math.atan2(tapY - striker.y, tapX - striker.x);
    if (Math.hypot(tapX - striker.x, tapY - striker.y) < 12) angle = -Math.PI / 2;
    const reach = baseRadius() * half * 2.4 + 20;
    placePuck(puck, striker.x + Math.cos(angle) * reach, striker.y + Math.sin(angle) * reach);
    // A gentle drift away from the striker, never toward the goal.
    puck.vx = Math.cos(angle) * 0.1;
    puck.vy = Math.max(0, Math.sin(angle) * 0.1);
    if (puck.y < H * 0.3) puck.y = H * 0.3;

    document.body.classList.add("hockey");
    startRound();
  };

  const exitHockey = () => {
    if (!hockey) return;
    const striker = bodies[0];
    bodies.length = 1;
    striker.scaleAnim = { to: hockey.baseScale, v: 0 };
    striker.drag = null;
    clearPress(striker);
    hockey = null;
    pointers.clear();
    canvas.style.cursor = "";
    endCard.hidden = true;
    hud.classList.remove("is-urgent");
    document.body.classList.remove("hockey");
  };

  $(".end-replay").addEventListener("click", () => {
    if (!hockey) return;
    const [striker, puck] = bodies;
    striker.vx = striker.vy = 0;
    striker.x = W / 2;
    striker.y = H * 0.7;
    clampBody(striker);
    placePuck(puck, W / 2, H * 0.38);
    startRound();
  });
  $(".end-done").addEventListener("click", exitHockey);

  const updateHockey = (time) => {
    renderHud(time);
    if (hockey.over) return;
    const puck = bodies[1];
    if (puck.hidden && time >= puck.respawnAt) {
      const striker = bodies[0];
      const y = Math.abs(striker.y - H * 0.5) < striker.layout.Rc * 2 && Math.abs(striker.x - W / 2) < striker.layout.Rc * 2 ? H * 0.28 : H * 0.5;
      placePuck(puck, W / 2, y);
    }
    if (time >= hockey.endsAt) finishRound();
  };

  /* ── pointer input ─────────────────────────────────────────────────── */

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    wakeAudio();
    if (pop || (hockey && hockey.over)) return;
    const now = performance.now();
    const primary = bodies[0];
    const body = pickBody(event.clientX, event.clientY);
    const secondFinger = primary.drag && primary.drag.id !== event.pointerId;
    if (!body && !secondFinger) return;

    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone */
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
      t: now,
      body,
      moved: false,
      multi: false,
    });

    if (secondFinger) {
      for (const p of pointers.values()) p.multi = true;
      if (!hockey && !pinch) beginPinch(primary.drag.id, event.pointerId);
      return;
    }
    if (body.passive) return; // the puck can be hit, not carried
    beginDrag(body, event.pointerId, event.clientX, event.clientY, now);
  });

  canvas.addEventListener("pointermove", (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) {
      if (!pop && event.pointerType === "mouse") {
        const hover = pickBody(event.clientX, event.clientY);
        canvas.style.cursor = hover && !hover.passive ? "grab" : "";
      }
      return;
    }
    p.x = event.clientX;
    p.y = event.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 11) p.moved = true;

    if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
      updatePinch();
      return;
    }
    const b = p.body;
    if (!b || !b.drag || b.drag.id !== event.pointerId) return;
    const drag = b.drag;
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastT);
    drag.vx = lerp(drag.vx, (p.x - drag.lastX) / elapsed, 0.6);
    drag.vy = lerp(drag.vy, (p.y - drag.lastY) / elapsed, 0.6);
    drag.lastX = p.x;
    drag.lastY = p.y;
    drag.lastT = now;
    drag.moveT = now;
    b.vx = drag.vx;
    b.vy = drag.vy;
    applyDragTarget(b, p.x, p.y);
  });

  const onPointerEnd = (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    pointers.delete(event.pointerId);
    const now = performance.now();
    const cancelled = event.type === "pointercancel";

    if (pinch && (event.pointerId === pinch.idA || event.pointerId === pinch.idB)) {
      finishPinch();
      return;
    }
    const b = p.body;
    if (b && b.drag && b.drag.id === event.pointerId) releaseDrag(b, now, cancelled);
    if (cancelled || !b || p.moved || p.multi || now - p.t > 260 || pop) return;

    // Two quick taps on a ring start or stop the game.
    if (
      lastTap &&
      lastTap.id === b.id &&
      now - lastTap.t <= 320 &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= 32
    ) {
      lastTap = null;
      const { clientX, clientY } = event;
      window.requestAnimationFrame(() => {
        if (hockey) exitHockey();
        else enterHockey(clientX, clientY);
      });
    } else {
      lastTap = { id: b.id, t: now, x: event.clientX, y: event.clientY };
    }
  };
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);
  canvas.addEventListener("dblclick", (event) => event.preventDefault());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  /* ── keyboard: arrows nudge, G plays, M mutes, Esc leaves the game ─── */

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape" && hockey) {
      exitHockey();
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, button, summary")) return;
    const p = bodies[0];
    const nudges = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (nudges[event.key] && !pop && !(hockey && hockey.over)) {
      event.preventDefault();
      wakeAudio();
      p.awake = true;
      p.vx += nudges[event.key][0] * 0.9;
      p.vy += nudges[event.key][1] * 0.9;
    } else if (event.key === "g" || event.key === "G") {
      wakeAudio();
      if (hockey) exitHockey();
      else enterHockey(p.x, p.y);
    } else if (event.key === "m" || event.key === "M") {
      soundButton.click();
    }
  });

  /* ── tweaks panel (?tweaks) ────────────────────────────────────────── */

  const TWEAK_KEY = "hy-ring-tweaks-v1";
  const tweakInputs = [...document.querySelectorAll("[data-tweak]")];
  const formatTweak = (key, value) =>
    key === "goalSize" ? `${value.toFixed(2)}×` : `${(value * 100).toFixed(1)}%`;
  const syncTweaks = () => {
    for (const input of tweakInputs) {
      const key = input.dataset.tweak;
      input.value = String(CFG[key]);
      document.querySelector(`[data-out="${key}"]`).textContent = formatTweak(key, CFG[key]);
    }
  };
  try {
    const saved = JSON.parse(store.get(TWEAK_KEY) || "{}");
    for (const key of Object.keys(TWEAK_DEFAULTS)) {
      if (Number.isFinite(saved[key])) CFG[key] = saved[key];
    }
  } catch {
    /* ignore a corrupt save */
  }
  tweakInputs.forEach((input) => {
    input.addEventListener("input", () => {
      CFG[input.dataset.tweak] = Number(input.value);
      syncTweaks();
    });
  });
  $(".tweaks-save").addEventListener("click", () => {
    store.set(TWEAK_KEY, JSON.stringify({ goalSize: CFG.goalSize, puckFriction: CFG.puckFriction }));
  });
  $(".tweaks-reset").addEventListener("click", () => {
    Object.assign(CFG, TWEAK_DEFAULTS);
    store.remove(TWEAK_KEY);
    syncTweaks();
  });
  syncTweaks();
  $(".tweaks").hidden = !query.has("tweaks");

  /* ── drawing ───────────────────────────────────────────────────────── */

  const place = (x, y, rot) => {
    const c = Math.cos(rot) * dpr;
    const s = Math.sin(rot) * dpr;
    ctx.setTransform(c, s, -s, c, x * dpr, y * dpr);
  };

  const drawBody = (b, time, alpha) => {
    const { R, font, step } = b.layout;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fg;
    ctx.font = `500 ${font}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Tremble harder the closer the ring is to popping.
    let shakeX = 0;
    let shakeY = 0;
    if (b.chargeStart && !reduceMotion.matches) {
      const charge = clamp((time - b.chargeStart) / CFG.popHold, 0, 1);
      shakeX = (Math.random() - 0.5) * charge * 7;
      shakeY = (Math.random() - 0.5) * charge * 7;
    }

    const eps = step * 0.5;
    const warped = buildArc(b);
    for (let i = 0; i <= CURSOR; i += 1) {
      const isCursor = i === CURSOR;
      if (isCursor ? Math.floor(time / 530) % 2 : /\s/.test(CHARS[i])) continue;
      const a = warped ? arcAngle(slotAngle(b, i)) : slotAngle(b, i);
      const r = R + sample(b, a);
      const r0 = R + sample(b, a - eps);
      const r1 = R + sample(b, a + eps);
      const rot = Math.atan2(
        Math.sin(a + eps) * r1 - Math.sin(a - eps) * r0,
        Math.cos(a + eps) * r1 - Math.cos(a - eps) * r0,
      );
      place(b.x + Math.cos(a) * r + shakeX, b.y + Math.sin(a) * r + shakeY, rot);
      if (isCursor) ctx.fillRect(-font * 0.3, -font * 0.56, font * 0.6, font * 1.12);
      else ctx.fillText(CHARS[i], 0, 0);
    }
    ctx.globalAlpha = 1;
  };

  const drawPop = () => {
    ctx.fillStyle = fg;
    ctx.font = `500 ${pop.font}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 1 - (pop.blend || 0);
    for (const word of pop.words) {
      place(word.x, word.y, word.rot);
      const half = (word.text.length - 1) / 2;
      for (let j = 0; j < word.text.length; j += 1) {
        ctx.fillText(word.text[j], (j - half) * pop.slot, 0);
      }
    }
    ctx.globalAlpha = 1;
  };

  const drawGoal = (time) => {
    const [g0, g1] = goalRange();
    const flash = clamp(1 - (time - hockey.flash) / 420, 0, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = fg;
    ctx.fillRect(g0 - 5, 0, 5, 24);
    ctx.fillRect(g1, 0, 5, 24);
    for (let x = g0 + 8; x < g1 - 14; x += 22) ctx.fillRect(x, 0, 12, 3);
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.9;
      ctx.fillRect(g0, 0, g1 - g0, 24);
      ctx.globalAlpha = 1;
    }
  };

  /* ── main loop ─────────────────────────────────────────────────────── */

  const stepBody = (b, time, dt, f) => {
    stepScale(b, dt);
    if (b.hidden) return;
    const pinching = pinch && b === bodies[0];

    if (!b.drag) {
      const base = reduceMotion.matches ? 0 : TAU / (CFG.spinSeconds * 1000);
      b.spin += (base + b.spinVel) * dt;
    }
    b.spinVel *= Math.pow(0.985, f);

    if (b.drag) {
      if (time - b.drag.moveT > 70) {
        b.drag.vx = b.drag.vy = 0;
        b.vx = b.vy = 0;
      }
    } else if (!pinching) {
      if (b.awake && !hockey) {
        const g = gravityNow(time);
        b.vx += g.x * dt;
        b.vy += g.y * dt;
      }
      const friction = Math.pow(hockey ? 1 - CFG.puckFriction : CFG.friction, f);
      b.vx *= friction;
      b.vy *= friction;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (walls(b, dt)) scoreGoal(b, time);
    }
    stepSoft(b, f);
  };

  const updateSqueeze = (time) => {
    const b = bodies[0];
    if (!b.drag || hockey || pop) {
      b.chargeStart = 0;
      return;
    }
    const full = b.layout.R * CFG.popDepth;
    const compression = maxPress(b);
    squeak(compression / full, time - b.drag.moveT < 70);
    if (compression >= full) {
      if (!b.chargeStart) b.chargeStart = time;
      else if (time - b.chargeStart >= CFG.popHold) triggerPop(b, time);
    } else {
      b.chargeStart = 0;
    }
  };

  const frame = (time) => {
    const dt = clamp(time - lastFrame, 1, 34);
    lastFrame = time;
    const f = dt / 16.667;

    for (const b of bodies) stepBody(b, time, dt, f);
    if (bodies.length > 1) collideBodies();
    if (hockey) updateHockey(time);
    if (pop) updatePop(time, dt, f);
    else updateSqueeze(time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hockey) drawGoal(time);
    for (const b of bodies) {
      if (!b.hidden) drawBody(b, time, 1);
    }
    if (pop) {
      drawPop();
      if (pop.blend > 0) drawBody(pop.body, time, pop.blend);
    }

    document.body.classList.toggle("is-busy", pointers.size > 0 || !!pop || !!hockey);
    window.requestAnimationFrame(frame);
  };

  /* ── go ────────────────────────────────────────────────────────────── */

  bodies.push(makeBody(0));
  applyTheme();
  measureAdvance();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hushSqueak();
  });

  // The web font changes glyph widths, so lay the ring out again once it lands.
  if (document.fonts?.load) {
    document.fonts
      .load('500 20px "JetBrains Mono"')
      .then(() => {
        measureAdvance();
        for (const b of bodies) layoutBody(b);
      })
      .catch(() => {});
  }

  // Small handle for poking at the page from the console.
  window.ringSite = {
    CFG,
    bodies,
    get hockey() {
      return hockey;
    },
    get pop() {
      return pop;
    },
    get theme() {
      return themeIndex;
    },
  };

  window.requestAnimationFrame((time) => {
    lastFrame = time;
    window.requestAnimationFrame(frame);
  });
})();
