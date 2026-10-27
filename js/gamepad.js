/* Gamepad-Steuerung (PS4-Controller, „Standard“-Belegung der Gamepad-API)
 *   Gelenke (Euro-Baggersteuerung):
 *     linker Stick  ←/→ M1 Basis,     ↑/↓ M3 Ellbogen
 *     rechter Stick ←/→ M4 Handgelenk, ↑/↓ M2 Schulter
 *   L2 gehalten: kartesisch – linker Stick x/y, rechter Stick ↑/↓ z, ←/→ ψ
 *   L1 gehalten: Kamera – linker Stick umkreisen, rechter Stick ↑/↓ zoomen, ←/→ verschieben
 *   Steuerkreuz ←/→ M5 Greifer drehen, ↑/↓ Tempo; R2 Greifer stufenlos schließen, ✕ Greifer auf/zu,
 *   ○ Stopp, △ Aufrecht, □ Pose als Teach-In-Punkt, Options Demo, Touchpad-Taste Ansicht wechseln
 *   Vibration an Gelenkanschlägen, an der virtuellen Wand und bei Verletzung der Arbeitsraumüberwachung
 */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h,
    C = BS.config;

  // Tastennummern der Standard-Belegung
  const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9, l3: 10, up: 12, down: 13, left: 14, right: 15, touch: 17 };
  const DEAD = 0.1, // Totzone in der Stickmitte (gegen Wegdriften)
    BAND = 0.05; // Totband je Achse: kleine Nebenauslenkung verfährt keine zweite Achse
  const JOG_RATE = [60, 45, 50, 60, 90]; // °/s je Gelenk bei Tempo 1 und Vollausschlag (wie Tastatur)
  const CART_RATE = 80, // mm/s
    PSI_RATE = 60; // °/s
  const CAM_ORBIT = 1.6, // rad/s
    CAM_ZOOM = 1.5, // 1/s (logarithmisch)
    CAM_PAN = 0.6; // Entfernungen/s
  const SPEEDS = [0.25, 0.5, 1, 2];

  const P = (BS.pad = {
    supported: !!navigator.getGamepads && window.isSecureContext !== false,
    id: null, // Name des verbundenen Controllers
    mode: 'joint', // 'joint' | 'cart' (L2 gehalten) | 'cam' (L1 gehalten)
    baseFrame: BS.store.get('padBaseFrame', true), // kartesisch im mit der Basis gedrehten KS (sonst Welt-KS); L3 schaltet um
    axes: [0, 0, 0, 0],
    buttons: [],
  });
  let prev = [],
    r2Active = false,
    atLimit = false,
    wallHit = false,
    monViol = new Set(),
    lastColl = null,
    collPulse = 0,
    lastWarn = 0;

  /** Kollision des Arms mit Tisch, Basis oder festen Quadern (Regal, Behälter …) – unabhängig von der Arbeitsraumüberwachung */
  function collision() {
    const sim = BS.sim;
    if (!sim.F) return null;
    const ap = BS.kin.armPoints(sim.F, C.geom, sim.jawWidth());
    for (const q of ap.pts) {
      const p = q.p;
      if (p[2] < -1) return 'Tisch';
      if (q.link !== 'Oberarm' && Math.hypot(p[0], p[1]) < 62 && p[2] < 85) return 'Basis';
      for (const st of sim.statics) if ([0, 1, 2].every((i) => Math.abs(p[i] - st.c[i]) < st.s[i] / 2 - 1)) return st.name;
    }
    return null;
  }

  function pad() {
    if (!P.supported) return null;
    const list = Array.from(navigator.getGamepads() || []).filter(Boolean);
    return list.find((g) => g.mapping === 'standard') || list[0] || null;
  }
  const band = (v, b) => (Math.abs(v) <= b ? 0 : (v - Math.sign(v) * b) / (1 - b));
  /** Stick (x, y): runde Totzone in der Mitte, danach Totband je Achse */
  function stickVal(x, y) {
    const r = Math.hypot(x, y);
    if (r <= DEAD) return [0, 0];
    const k = Math.min(1, band(r, DEAD)) / r;
    return [band(BS.clamp(x * k, -1, 1), BAND), band(BS.clamp(y * k, -1, 1), BAND)];
  }
  /** Vibration: Chrome/Edge (vibrationActuator), Firefox (hapticActuators) */
  function rumble(g, strong) {
    const ms = strong ? 300 : 150,
      mag = strong ? 1 : 0.6;
    const a = g && g.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag, weakMagnitude: mag * 0.6 }).catch(() => {});
    else if (g && g.hapticActuators && g.hapticActuators[0]) g.hapticActuators[0].pulse(mag, ms);
  }
  function warn(msg) {
    const now = performance.now();
    if (now - lastWarn < 2500) return;
    lastWarn = now;
    BS.toast(msg, 'warn');
  }

  window.addEventListener('gamepadconnected', (e) => BS.toast('Controller verbunden: ' + e.gamepad.id.replace(/\s*\(.*$/, ''), 'ok'));
  window.addEventListener('gamepaddisconnected', () => BS.toast('Controller getrennt', 'warn'));

  /** Einmal je Bild aus der Hauptschleife */
  P.tick = function (dt) {
    const g = pad();
    P.id = g ? g.id.replace(/\s*\(.*$/, '') : null;
    if (!g) {
      prev = [];
      return;
    }
    const btn = g.buttons.map((b) => b.value);
    const old = prev;
    const pressed = (i) => btn[i] > 0.5 && !(old[i] > 0.5);
    const ax = (i) => g.axes[i] || 0;
    P.axes = [...stickVal(ax(0), ax(1)), ...stickVal(ax(2), ax(3))];
    P.buttons = btn;
    prev = btn;
    BS.emit('pad');

    // Options: Demo starten/beenden – in der Demo wirkt sonst nichts
    if (pressed(B.options)) U.demoState ? U.stopDemo() : U.startDemo();
    if (U.demoState) return;

    const sim = BS.sim;
    // Kollision, virtuelle Wand (Labor-Szenario) oder neue Verletzung der Arbeitsraumüberwachung: kräftig vibrieren,
    // bei andauernder Kollision im Takt wiederholen
    const coll = collision(),
      wall = !!(BS.labScene && BS.labScene.alarm),
      viol = new Set(BS.monitor.issues.filter((i) => i.level === 'viol').map((i) => i.key));
    const now = performance.now();
    if ((coll && (coll !== lastColl || now - collPulse > 600)) || (wall && !wallHit) || [...viol].some((k) => !monViol.has(k))) {
      rumble(g, true);
      collPulse = now;
    }
    lastColl = coll;
    wallHit = wall;
    monViol = viol;

    P.mode = btn[B.l1] > 0.5 ? 'cam' : btn[B.l2] > 0.5 ? 'cart' : 'joint';
    if (pressed(B.l3)) {
      P.baseFrame = !P.baseFrame;
      BS.store.set('padBaseFrame', P.baseFrame);
      BS.toast(P.baseFrame ? 'Kartesisch im Basis-KS (dreht mit M1)' : 'Kartesisch im Welt-KS (x/y fest)', 'ok');
    }
    if (pressed(B.r1)) U.toggleFull();
    if (pressed(B.circle)) {
      if (BS.auto.running) BS.auto.stop('Stopp (Controller)');
      sim.stopMotion();
    }
    if (pressed(B.triangle)) sim.moveTo(C.home);
    if (pressed(B.square)) {
      BS.emit('addWaypoint', sim.cmd.slice());
      BS.toast('Pose gespeichert (Reiter Teach-In und Replay)', 'ok');
    }
    if (pressed(B.cross)) U.toggleGripper();
    if (pressed(B.up) || pressed(B.down)) {
      const k = SPEEDS.indexOf(U.jogSpeed);
      const step = pressed(B.up) ? 1 : -1;
      U.setJogSpeed(SPEEDS[BS.clamp((k < 0 ? 2 : k) + step, 0, SPEEDS.length - 1)]);
      BS.toast('Tempo ' + Math.round(U.jogSpeed * 100) + ' %');
    }
    if (pressed(B.touch)) {
      const list = BS.view.VIEWS.filter((v) => v[0] !== 'greifer' || BS.view.gripCam);
      const i = list.findIndex((v) => v[0] === BS.view.viewName);
      const next = list[(i + 1) % list.length];
      BS.view.setView(next[0]);
      BS.toast('Ansicht: ' + next[1]);
    }

    // R2: Greifer stufenlos schließen (losgelassen = offen)
    const r2 = btn[B.r2] || 0;
    if (r2 > 0.05 || r2Active) {
      r2Active = r2 > 0.05;
      const a = C.gripper.open + (C.gripper.closed - C.gripper.open) * (r2Active ? r2 : 0);
      if (Math.abs(a - sim.cmd[5]) > 0.2 && !sim.setManual([null, null, null, null, null, a])) warn(sim.lockMsg());
    }

    const [lx, ly, rx, ry] = P.axes;
    // L1 gehalten: Sticks bewegen die Kamera (auch während der Pause)
    if (P.mode === 'cam') {
      atLimit = false;
      if ((lx || ly || rx || ry) && !BS.view.moveCam(lx * CAM_ORBIT * dt, -ly * CAM_ORBIT * dt, Math.exp(ry * CAM_ZOOM * dt), rx * CAM_PAN * dt))
        warn('Kamera lässt sich nur in den Ansichten 1–6 und 8 bewegen');
      return;
    }

    // Sticks und Steuerkreuz ←/→ – gleiten mit der Auslenkung, ruhen während der Pause
    const rot = (btn[B.right] > 0.5 ? 1 : 0) - (btn[B.left] > 0.5 ? 1 : 0);
    if (sim.paused || (!lx && !ly && !rx && !ry && !rot)) {
      atLimit = false;
      return;
    }
    if (sim.locked()) return warn(sim.lockMsg());
    const v = U.jogSpeed * dt;
    const m = [null, null, null, null, null, null];
    let limit = false;
    const add = (j, d) => {
      if (!d) return;
      const [lo, hi] = C.limits[j];
      const val = sim.cmd[j] + d * JOG_RATE[j] * v;
      m[j] = BS.clamp(val, lo, hi);
      if (val !== m[j]) limit = true;
    };
    add(4, rot);
    if (P.mode === 'cart') {
      // Welt-KS: Stick nach vorne = +y (Blickrichtung des Roboters in Grundstellung).
      // Basis-KS: Stick nach vorne = radial entlang der Armebene (Richtung M1), rechts = quer dazu. Rechter Stick nach vorne = nach oben.
      const cur = sim.cmd.slice();
      const p = BS.kin.tcp(cur);
      if (lx || ly || rx || ry) {
        const a = P.baseFrame ? cur[0] * BS.D2R : Math.PI / 2;
        const fx = Math.cos(a),
          fy = Math.sin(a); // „vorne“
        const s = CART_RATE * v;
        const t = { x: p.x + (lx * fy - ly * fx) * s, y: p.y + (-lx * fx - ly * fy) * s, z: p.z - ry * s };
        const r = BS.kin.cartMove(cur, t, p.psi + rx * PSI_RATE * v, C.geom);
        if (r.frac > 0) for (let j = 0; j < 4; j++) m[j] = r.m[j];
        if (!r.ok) {
          limit = true;
          warn('Kartesisch nicht weiter möglich (Arbeitsraum, Gelenkgrenze oder Singularität)');
        }
      }
    } else {
      // Euro-Baggersteuerung; „Senken“ = Servowinkel größer
      add(0, -lx); // Basis: Stick rechts = nach rechts drehen
      add(2, ly); // Ellbogen: Stick nach hinten = senken
      add(1, -ry); // Schulter
      add(3, -rx); // Handgelenk: Stick links = senken
    }
    if (m.some((x) => x != null) && !sim.setManual(m)) warn(sim.lockMsg());
    if (limit && !atLimit) rumble(g);
    atLimit = limit;
  };

  // ------------------------------------------------------------------
  // Karte im Reiter „Manuelle Steuerung“
  // ------------------------------------------------------------------
  const MAP = [
    ['L ←/→', 0, 'Basis drehen'],
    ['L ↑/↓', 2, 'Ellbogen (hinten = senken)'],
    ['R ↑/↓', 1, 'Schulter (vorne = senken)'],
    ['R ←/→', 3, 'Handgelenk (links = senken)'],
    ['✛ ←/→', 4, 'Greifer drehen − / +'],
    ['R2', 5, 'Greifer stufenlos schließen'],
    ['✕', 5, 'Greifer auf / zu (Umschalten)'],
  ];
  const MORE = [
    ['L2 halten', 'kartesisch: L x/y, R ↑/↓ z, ←/→ ψ'],
    ['L3 (drücken)', 'kartesisches KS: mit Basis gedreht / Welt'],
    ['L1 halten', 'Kamera: L umkreisen, R ↑/↓ zoomen, ←/→ verschieben'],
    ['✛ ↑/↓', 'Tempo schneller / langsamer'],
    ['R1', 'Vollbild: Hauptansicht, Greiferkamera und Scope'],
    ['○', 'Stopp'],
    ['△', 'Aufrecht (90°)'],
    ['□', 'Pose als Teach-In-Punkt'],
    ['Options', 'Demo starten / beenden'],
    ['Touchpad', 'Ansicht wechseln'],
  ];
  let status, mode, sticks;
  function stick() {
    const dot = h('span', { class: 'pad-dot' });
    return { el: h('span', { class: 'pad-stick' }, dot), dot };
  }
  U.gamepadCard = function () {
    status = h('div', { class: 'hint' });
    mode = h('span', { class: 'pad-mode' });
    sticks = [stick(), stick()];
    const grid = h('div', { class: 'keymap' });
    for (const [k, j, desc] of MAP) grid.append(h('span', { class: 'pair' }, h('span', { class: 'kbd wide' }, k)), h('span', { class: 'joint', style: { color: C.colors[j] } }, C.short[j]), h('span', { class: 'desc' }, desc));
    for (const [k, desc] of MORE) grid.append(h('span', { class: 'pair' }, h('span', { class: 'kbd wide' }, k)), h('span'), h('span', { class: 'desc' }, desc));
    return U.card(
      'Controller (PS4-Gamepad)',
      status,
      h('div', { class: 'pad-sticks' }, h('span', null, 'L'), sticks[0].el, sticks[1].el, h('span', null, 'R'), mode),
      grid,
      U.hint('Per USB oder Bluetooth verbinden und eine Taste drücken – erst dann meldet der Browser den Controller. Belegung wie eine Euro-Baggersteuerung. Der Controller wirkt in allen Reitern; die Sticks übernehmen laufende Bewegungen. Er vibriert an Gelenkanschlägen, bei Kollisionen (Tisch, Basis, Regal, Behälter), an der virtuellen Wand und bei Verletzung der Arbeitsraumüberwachung.')
    );
  };
  U.updateGamepadCard = function () {
    if (!status) return;
    const txt = !P.supported
      ? 'Gamepads werden hier nicht unterstützt (Seite über http://localhost öffnen, nicht als Datei).'
      : P.id
        ? '● Verbunden: ' + P.id
        : 'Kein Controller erkannt – verbinden und eine Taste drücken.';
    if (status.textContent !== txt) {
      status.textContent = txt;
      status.className = 'hint ' + (!P.supported ? 'warn' : P.id ? 'ok' : '');
    }
    mode.textContent = { joint: 'Gelenke', cart: 'kartesisch', cam: 'Kamera' }[P.mode] + ' · KS ' + (P.baseFrame ? 'Basis' : 'Welt');
    const a = P.id ? P.axes : [0, 0, 0, 0];
    sticks.forEach((s, i) => (s.dot.style.transform = `translate(${a[2 * i] * 14}px, ${a[2 * i + 1] * 14}px)`));
  };
})();
