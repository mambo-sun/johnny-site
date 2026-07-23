// JOHNNY! TAKES SAN FRANCISCO — sound effects
//
// Every sound is synthesized at load time into a WAV data URL, exactly the way
// every sprite is drawn into a PNG data URL. kaplay's loadSound() detects a
// `data:...;base64,` string and base64-decodes it straight into decodeAudioData,
// so there are no audio files and no fetches.
//
// Loaded BEFORE game.js, which calls initAudio(K) right after kaplay() boots —
// loadSound needs kaplay's asset registry, which doesn't exist until then.
//
// Wrapped in an IIFE: game.js declares its own `rngFrom`, `mix`, `hex` etc. at
// top level, and two classic scripts sharing the global lexical scope would
// either collide (const) or silently shadow each other (function).

(function (root) {
"use strict";

const AUDIO_SR = 22050;        // sample rate; the WAV header must match this
const VOICE_CAP = 4;           // max distinct sounds started in one frame
const RETRIGGER_MS = 60;       // min gap before the same sound may play again
const MUTE_KEY = "johnny.muted";
const SCREEN_W = 800;          // for panning; matches GAME_W

let audioMuted = false;
let frameStamp = -1, frameVoices = 0;
const framePlayed = new Set();
const lastPlayed = new Map();

// Diagnostics for ?audio=debug — a phone can't be inspected from here, so the
// page has to be able to say what its own audio stack is doing.
let audioCtx = null, sfxAsked = 0, sfxPlayed = 0;
const loadErrors = [];

// ============================================================
// SYNTH PRIMITIVES
// ============================================================
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Deterministic noise in [-1,1]. Never Math.random() at generation time, so the
// output is byte-reproducible and any nondeterminism fails a test.
function noiseRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
}

const sine     = (ph) => Math.sin(ph * TAU);
const square   = (ph) => ((ph % 1) + 1) % 1 < 0.5 ? 1 : -1;
const triangle = (ph) => 4 * Math.abs((((ph % 1) + 1) % 1) - 0.5) - 1;
const saw      = (ph) => 2 * ((((ph % 1) + 1) % 1)) - 1;

// Soft-clip: drive > 1 adds grit without the harsh fold of a hard clip.
const crunch = (v, drive) => Math.tanh(v * drive);

// Phase accumulator. A glided pitch MUST be integrated -- sine(freq*t) is not
// phase, and for a falling sweep its instantaneous frequency goes negative.
function phasor() {
  let ph = 0;
  return (f) => { const v = ph; ph += f / AUDIO_SR; return v; };
}

// Stateful one-pole lowpass, fixed cutoff.
function lowpass(cutoff) {
  const a = 1 - Math.exp((-TAU * cutoff) / AUDIO_SR);
  let z = 0;
  return (v) => (z += a * (v - z));
}
// Stateful one-pole lowpass with a per-sample cutoff (for filter sweeps).
function sweepLp() {
  let z = 0;
  return (v, cutoff) => {
    const a = 1 - Math.exp((-TAU * cutoff) / AUDIO_SR);
    return (z += a * (v - z));
  };
}
function highpass(cutoff) {
  const lp = lowpass(cutoff);
  return (v) => v - lp(v);
}

// Percussive exponential decay.
const decayEnv = (t, dur, k) => Math.exp((-k * t) / dur);
// Attack/decay with a guaranteed zero at BOTH ends, so nothing clicks.
function ad(t, dur, attack, k) {
  const atk = Math.min(1, t / attack);
  const rel = Math.min(1, (dur - t) / 0.006);
  return atk * rel * Math.exp((-k * t) / dur);
}
// Linear glide between two values across the sound's life.
const glide = (t, dur, from, to) => from + (to - from) * (t / dur);
// Bell: swells in, falls away, zero at both ends. A rising filter sweep cancels
// out a plain decay envelope and leaves a flat hiss -- this gives it a shape.
const bell = (t, dur, p) => Math.pow(Math.sin(Math.PI * clamp(t / dur, 0, 1)), p);

// ============================================================
// WAV ENCODING
// ============================================================
function base64Bytes(bytes) {
  // String.fromCharCode(...bytes) on a long buffer blows the engine's argument
  // limit (RangeError) and would kill the game at module load. Chunk it.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return root.btoa(bin);
}

// genWav(durationSec, sampleFn) -> "data:audio/wav;base64,..."
// sampleFn(t, i) returns a float in [-1,1]. Called with i ascending, so stateful
// filters and phasors created outside the callback stay coherent.
function genWav(dur, sampleFn) {
  const n = Math.max(1, Math.floor(AUDIO_SR * dur));
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);       // RIFF size = total - 8
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);              // subchunk1 size (PCM)
  view.setUint16(20, 1, true);               // audioFormat = PCM
  view.setUint16(22, 1, true);               // mono
  view.setUint32(24, AUDIO_SR, true);
  view.setUint32(28, AUDIO_SR * 2, true);    // byteRate = rate * blockAlign
  view.setUint16(32, 2, true);               // blockAlign
  view.setUint16(34, 16, true);              // bitsPerSample
  str(36, "data");
  view.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    const v = clamp(sampleFn(i / AUDIO_SR, i), -1, 1);
    view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
  }
  return "data:audio/wav;base64," + base64Bytes(bytes);
}

// ============================================================
// THE SOUNDS
// Impacts are noisy and soft-clipped. Menus and stings are clean chiptune.
// ============================================================

// notes = [[freqHz, startSec, lenSec], ...] — constant pitch, so freq*t is phase.
function arp(notes, wave, vol) {
  return (t) => {
    let out = 0;
    for (let k = 0; k < notes.length; k++) {
      const f = notes[k][0], start = notes[k][1], len = notes[k][2];
      if (t < start || t >= start + len) continue;
      const lt = t - start;
      out += wave(f * lt) * ad(lt, len, 0.003, 3.5) * vol;
    }
    return out;
  };
}

const SFX = {
  // ── impacts: gritty ───────────────────────────────────────
  swing: () => {
    const dur = 0.09, rnd = noiseRng(101), lp = sweepLp(), hp = highpass(800);
    return genWav(dur, (t) => hp(lp(rnd(), glide(t, dur, 2200, 8000))) * bell(t, dur, 1.6) * 0.42);
  },

  hit_block: () => {
    const dur = 0.14, rnd = noiseRng(202), lp = lowpass(1800), p = phasor();
    return genWav(dur, (t) => {
      const thud = sine(p(glide(t, dur, 190, 55))) * decayEnv(t, dur, 7);
      const grit = lp(rnd()) * decayEnv(t, dur, 14);
      return crunch(thud * 0.9 + grit * 0.55, 2.2) * ad(t, dur, 0.001, 3.2) * 0.7;
    });
  },

  destroy_block: () => {
    const dur = 0.70, rnd = noiseRng(303), lp = lowpass(2600), rum = lowpass(140), p = phasor();
    return genWav(dur, (t) => {
      const boom  = sine(p(glide(t, dur, 120, 32))) * decayEnv(t, dur, 4.5);
      const crash = lp(rnd()) * decayEnv(t, dur, 5.5);
      const sub   = rum(rnd()) * decayEnv(t, dur, 3);
      return crunch(boom * 0.85 + crash * 0.6 + sub * 0.5, 1.9) * ad(t, dur, 0.001, 2.6) * 0.72;
    });
  },

  hit_enemy: () => {
    const dur = 0.10, rnd = noiseRng(404), lp = lowpass(3200), p = phasor();
    return genWav(dur, (t) => {
      const body = triangle(p(glide(t, dur, 420, 150))) * decayEnv(t, dur, 10);
      const slap = lp(rnd()) * decayEnv(t, dur, 22);
      return crunch(body * 0.7 + slap * 0.7, 2.4) * ad(t, dur, 0.001, 5) * 0.6;
    });
  },

  kill_enemy: () => {
    const dur = 0.25, rnd = noiseRng(505), lp = lowpass(2400), p = phasor();
    return genWav(dur, (t) => {
      const body  = saw(p(glide(t, dur, 380, 70))) * decayEnv(t, dur, 5);
      const splat = lp(rnd()) * decayEnv(t, dur, 12);
      return crunch(body * 0.6 + splat * 0.6, 2.0) * ad(t, dur, 0.001, 3.4) * 0.6;
    });
  },

  player_hurt: () => {
    const dur = 0.18, rnd = noiseRng(606), p = phasor();
    return genWav(dur, (t) => {
      const buzz = square(p(glide(t, dur, 240, 90)));
      return crunch(buzz * 0.8 + rnd() * 0.25, 3.0) * ad(t, dur, 0.002, 4.5) * 0.5;
    });
  },

  throw: () => {
    const dur = 0.12, rnd = noiseRng(707), lp = sweepLp(), hp = highpass(600);
    return genWav(dur, (t) => hp(lp(rnd(), glide(t, dur, 6000, 1200))) * bell(t, dur, 1.2) * 0.36);
  },

  splat: () => {
    const dur = 0.15, rnd = noiseRng(808), lp = lowpass(900), p = phasor();
    return genWav(dur, (t) => {
      const thud = sine(p(glide(t, dur, 150, 42))) * decayEnv(t, dur, 9);
      const wet  = lp(rnd()) * decayEnv(t, dur, 18);
      return crunch(thud * 0.9 + wet * 0.5, 1.8) * ad(t, dur, 0.001, 4) * 0.62;
    });
  },

  land: () => {
    const dur = 0.09, rnd = noiseRng(909), lp = lowpass(700), p = phasor();
    return genWav(dur, (t) => {
      const thud = sine(p(glide(t, dur, 140, 55))) * decayEnv(t, dur, 11);
      return (thud * 0.75 + lp(rnd()) * 0.3) * ad(t, dur, 0.001, 6) * 0.4;
    });
  },

  // Clean rising square blip — a movement cue, not an impact, so no grit.
  jump: () => {
    const dur = 0.12, p = phasor();
    return genWav(dur, (t) => square(p(glide(t, dur, 340, 720))) * ad(t, dur, 0.003, 4.5) * 0.24);
  },

  // ── creatures ─────────────────────────────────────────────
  rat_squeak: () => {
    const dur = 0.07, p = phasor();
    return genWav(dur, (t) => square(p(glide(t, dur, 1900, 2900))) * ad(t, dur, 0.004, 6) * 0.22);
  },

  // Descending wail with vibrato — the Rampage moment.
  scream: () => {
    const dur = 0.70, p1 = phasor(), p2 = phasor();
    return genWav(dur, (t) => {
      const f = glide(t, dur, 780, 200) * (1 + 0.045 * Math.sin(TAU * 6.5 * t));
      const tone = saw(p1(f)) * 0.45 + triangle(p2(f * 2)) * 0.2;
      return crunch(tone, 1.5) * ad(t, dur, 0.02, 2.2) * 0.42;
    });
  },

  // ── UI + stings: clean chiptune ───────────────────────────
  menu_move:   () => genWav(0.05, arp([[880, 0, 0.05]], square, 0.26)),
  menu_select: () => genWav(0.18, arp([[660, 0, 0.06], [990, 0.06, 0.12]], square, 0.30)),

  level_start: () => genWav(0.45, arp([
    [523, 0.00, 0.11], [659, 0.12, 0.11], [784, 0.24, 0.20],
  ], square, 0.30)),

  level_clear: () => genWav(0.80, arp([
    [523, 0.00, 0.10], [659, 0.10, 0.10], [784, 0.20, 0.10],
    [1047, 0.30, 0.14], [784, 0.44, 0.10], [1047, 0.54, 0.24],
  ], square, 0.30)),

  game_over: () => genWav(0.90, arp([
    [440, 0.00, 0.16], [392, 0.17, 0.16], [330, 0.34, 0.18], [262, 0.53, 0.36],
  ], triangle, 0.34)),

  win: () => genWav(1.20, arp([
    [523, 0.00, 0.10], [523, 0.11, 0.09], [523, 0.21, 0.09], [659, 0.31, 0.18],
    [784, 0.50, 0.10], [659, 0.61, 0.09], [784, 0.71, 0.10], [1047, 0.82, 0.36],
  ], square, 0.30)),
};

// ============================================================
// PLAYBACK
// ============================================================

// The ONLY place SFX playback happens. Calls the global play() by name rather
// than capturing a reference, so tests can spy on window.play.
function sfx(name, opts) {
  sfxAsked++;
  if (audioMuted) return;
  if (!(name in SFX)) { console.error("unknown sfx:", name); return; }   // never throws

  const o = opts || {};
  const now = (typeof root.time === "function") ? root.time() : Date.now() / 1000;

  // Per-frame de-dup + voice cap, reset lazily off kaplay's monotonic clock
  // rather than a top-level onUpdate, which a scene change would wipe. This is
  // what collapses N simultaneous screams (one collapse, several people) into 1.
  if (now !== frameStamp) { frameStamp = now; frameVoices = 0; framePlayed.clear(); }
  if (framePlayed.has(name)) return;
  if (frameVoices >= VOICE_CAP) return;

  const prev = lastPlayed.get(name);
  if (prev !== undefined && (now - prev) * 1000 < RETRIGGER_MS) return;

  framePlayed.add(name);
  frameVoices++;
  lastPlayed.set(name, now);

  const w = (typeof root.GAME_W === "number") ? root.GAME_W : SCREEN_W;
  root.play(name, {
    volume: o.vol === undefined ? 1 : o.vol,
    detune: o.detune || 0,
    pan: (o.x === undefined || o.x === null) ? 0 : clamp((o.x / w) * 2 - 1, -1, 1),
  });
  sfxPlayed++;
}

// ============================================================
// ?audio=debug — an on-page readout, because a phone that makes no sound
// can't tell you why from here. Reports whether the browser opened the
// context, whether the WAVs decoded, and whether play() is being reached.
// ============================================================
function startAudioDebug() {
  const el = document.createElement("pre");
  el.id = "audio-debug";
  el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;margin:0;" +
    "padding:6px 8px;font:11px/1.4 monospace;color:#0f0;background:rgba(0,0,0,.85);" +
    "white-space:pre-wrap;pointer-events:none";
  document.body.appendChild(el);
  setInterval(() => {
    el.textContent = [
      "ctx.state   " + (audioCtx ? audioCtx.state : "NO CONTEXT"),
      "sampleRate  " + (audioCtx ? audioCtx.sampleRate : "-"),
      "muted       " + audioMuted,
      "volume      " + (typeof root.getVolume === "function" ? root.getVolume() : "?"),
      "sfx asked   " + sfxAsked + "   played " + sfxPlayed,
      "load errors " + (loadErrors.length ? loadErrors.join(" / ") : "none"),
    ].join("\n");
  }, 400);
}

// ±cents of pitch variation at PLAY time, so repeated hits don't machine-gun.
const vary = (cents) => Math.round((Math.random() * 2 - 1) * cents);

const isMuted = () => audioMuted;

function setMuted(v) {
  audioMuted = !!v;
  if (typeof root.setVolume === "function") root.setVolume(audioMuted ? 0 : 1);
  try { root.localStorage.setItem(MUTE_KEY, audioMuted ? "1" : "0"); } catch (e) { /* private mode */ }
}
const toggleMute = () => setMuted(!audioMuted);

// ============================================================
// INIT — called from game.js immediately after kaplay() boots
// ============================================================
function initAudio(K) {
  for (const name of Object.keys(SFX)) {
    const asset = root.loadSound(name, SFX[name]());
    // A decodeAudioData failure is otherwise silent — literally. Record it so
    // ?audio=debug can say "this browser refused the WAV" instead of leaving a
    // mute game with no explanation.
    if (asset && typeof asset.onError === "function")
      asset.onError((err) => { loadErrors.push(name + ": " + err); });
  }

  let saved = false;
  try { saved = root.localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { saved = false; }
  audioMuted = saved;
  if (typeof root.setVolume === "function") root.setVolume(audioMuted ? 0 : 1);

  // kaplay NEVER resumes the AudioContext on input — only on tab-visibility,
  // music playback, or debug-unpause. Browsers start it suspended, so without
  // this every sound is silent forever.
  //
  // iOS needs more than resume(), which is why this is not three lines:
  //   · Safari only truly opens the output once a buffer has been STARTED from
  //     inside a real gesture. resume() alone can report "running" and still
  //     play nothing, so every gesture also fires a one-sample silent buffer.
  //   · Safari has a WebKit-only "interrupted" state and can drop a running
  //     context back to it (a call, another app, a backgrounded tab). Tearing
  //     the listeners down after the first success — which is what this used to
  //     do — meant silence for the rest of the session with no way back, so
  //     they now stay armed and a statechange re-arms the buffer kick.
  //   · Capture phase, so nothing downstream can stopPropagation() the gesture
  //     away before the unlock sees it.
  const ctx = K && K.audioCtx;
  audioCtx = ctx || null;
  if (ctx) {
    let opened = false, resuming = false;

    const kick = () => {
      // Must run synchronously inside the gesture — a promise callback has
      // already lost the user activation Safari is looking for.
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || AUDIO_SR);
        src.connect(ctx.destination);
        src.start(0);
        opened = true;
      } catch (e) { /* context torn down mid-gesture */ }
    };

    const unlock = (e) => {
      if (e && e.repeat) return;                 // a held key repeats; one attempt is enough
      if (!opened) kick();
      if (ctx.state === "running" || resuming) return;
      resuming = true;
      ctx.resume().catch(() => {}).then(() => { resuming = false; });
    };

    // Every gesture flavour, because which one arrives first differs by
    // platform and any of them is a valid activation.
    ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "click", "keydown"]
      .forEach((ev) => root.addEventListener(ev, unlock, { capture: true, passive: true }));

    if (typeof ctx.addEventListener === "function")
      ctx.addEventListener("statechange", () => { if (ctx.state !== "running") opened = false; });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && ctx.state !== "running") ctx.resume().catch(() => {});
    });
  }

  if (String(root.location && root.location.search).indexOf("audio=debug") !== -1) startAudioDebug();

  // Mute must work in every scene, including the transition scenes. kaplay's
  // onKeyPress is scene-scoped and go() clears it, so use a raw DOM listener.
  root.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "m" || e.key === "M") toggleMute();
  });
}

// Exports (classic script — no modules).
root.genWav = genWav;
root.SFX = SFX;
root.sfx = sfx;
root.vary = vary;
root.initAudio = initAudio;
root.toggleMute = toggleMute;
root.isMuted = isMuted;
root.setMuted = setMuted;
root.AUDIO_SR = AUDIO_SR;

})(typeof window !== "undefined" ? window : globalThis);
