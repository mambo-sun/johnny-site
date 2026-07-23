// JOHNNY! TAKES SAN FRANCISCO — on-screen touch controls
//
// Bridges the DOM control bar in game.html to kaplay's virtual buttons. Every
// input the game reads is a named button (see BUTTONS in game.js); a keydown
// presses it via kaplay's own key->button map, and this file presses the very
// same names from pointer events. So the game code has one input path, and the
// touch bar needs no hooks inside the game itself.
//
// Loaded BEFORE game.js, which calls initTouchControls(K) right after kaplay()
// boots — pressButton() lives on the kaplay context, which doesn't exist until
// then.
//
// Wrapped in an IIFE for the same reason audio.js is: two classic scripts share
// one global lexical scope and would collide on top-level declarations.

(function (root) {
"use strict";

function initTouchControls(K) {
  const bar = document.getElementById("touch-controls");
  if (!bar || typeof K.pressButton !== "function") return;

  // Desktop is left completely alone: the bar stays display:none and not one
  // listener is attached. `pointer: coarse` is the real test — a laptop with a
  // touchscreen still reports a fine pointer and wants the keyboard.
  const coarse = (root.matchMedia && root.matchMedia("(pointer: coarse)").matches)
    || (typeof K.isTouchscreen === "function" && K.isTouchscreen());
  if (!coarse) return;
  bar.hidden = false;

  const held = new Map();   // pointerId -> the [data-btn] element it holds
  const taps = new Map();   // pointerId -> the [data-act] element it started on

  const btnAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-btn]") : null;
  };

  function grab(id, el) {
    if (held.get(id) === el) return;
    drop(id);
    if (!el) return;
    held.set(id, el);
    el.classList.add("is-on");
    K.pressButton(el.dataset.btn);
  }

  function drop(id) {
    const el = held.get(id);
    if (!el) return;
    held.delete(id);
    // A second finger may be on the same button — only the last one releases it.
    for (const other of held.values()) if (other === el) return;
    el.classList.remove("is-on");
    K.releaseButton(el.dataset.btn);
  }

  function dropAll() {
    for (const id of [...held.keys()]) drop(id);
    for (const el of taps.values()) el.classList.remove("is-on");
    taps.clear();
  }

  function syncMute() {
    const el = bar.querySelector('[data-act="mute"]');
    if (!el || typeof root.isMuted !== "function") return;
    const muted = root.isMuted();
    el.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
    el.setAttribute("aria-pressed", muted ? "true" : "false");
    el.setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }

  function fire(action) {
    if (action === "mute") { if (root.toggleMute) root.toggleMute(); syncMute(); }
    else if (action === "quit") { K.go("select"); }
  }

  bar.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-btn]");
    const act = e.target.closest("[data-act]");
    if (!btn && !act) return;

    // Kills the synthetic mouse events iOS fires after a touch, the focus ring
    // left behind by a tap, and the selection a slow press would start.
    e.preventDefault();

    // On touch the element receiving pointerdown implicitly captures the
    // pointer, so a thumb sliding from LEFT onto RIGHT would keep reporting
    // LEFT forever. Hand the pointer back so pointermove can re-hit-test.
    const target = btn || act;
    if (target.hasPointerCapture && target.hasPointerCapture(e.pointerId))
      target.releasePointerCapture(e.pointerId);

    if (btn) grab(e.pointerId, btn);
    else { taps.set(e.pointerId, act); act.classList.add("is-on"); }
  }, { passive: false });

  // On window, not on the bar: once capture is released a drag that wanders off
  // the bar delivers its events elsewhere, and a button whose pointerup we never
  // saw would stay pressed — the player would sprint into a wall forever.
  root.addEventListener("pointermove", (e) => {
    if (held.has(e.pointerId)) grab(e.pointerId, btnAt(e.clientX, e.clientY));
  });

  root.addEventListener("pointerup", (e) => {
    drop(e.pointerId);
    const act = taps.get(e.pointerId);
    if (!act) return;
    taps.delete(e.pointerId);
    act.classList.remove("is-on");
    // Only fire if the finger lifted on the chip it started on, so a mis-tap
    // can be dragged off and cancelled — QUIT sits next to the action buttons.
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && over.closest("[data-act]") === act) fire(act.dataset.act);
  });

  root.addEventListener("pointercancel", (e) => {
    drop(e.pointerId);
    const act = taps.get(e.pointerId);
    if (act) { act.classList.remove("is-on"); taps.delete(e.pointerId); }
  });

  // Backgrounding the tab mid-run must not leave a direction stuck down.
  root.addEventListener("blur", dropAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) dropAll(); });

  // Long-press on a button otherwise raises the callout menu on iOS.
  bar.addEventListener("contextmenu", (e) => e.preventDefault());

  syncMute();   // audio.js restores the muted flag from localStorage on boot
}

root.initTouchControls = initTouchControls;

})(typeof window !== "undefined" ? window : globalThis);
