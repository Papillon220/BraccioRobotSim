/* BraccioSim – Co-Simulation mit MATLAB/Simulink
 *
 * Im Simulink-Modell ersetzen die Blöcke Web Scene Configuration, Web Robot und Web Actor
 * (matlab-cosim/) die Unreal-Blöcke. Web Scene Configuration öffnet einen WebSocket-Server;
 * BraccioSim verbindet sich damit und zeigt Roboter und Akteure wie zuvor Unreal.
 * Nachrichten (JSON, Labor-KS0, SI-Einheiten):
 *   { type: 'scene', actors: [{ n, shape: 'box'|'sphere', size, color, alpha, p, r, s }] }   nach dem Verbinden
 *   { type: 'frame', t, q: [q1…q5], q6, actors: [{ n, p, r, color, alpha }] }               je Bild; [] = unverändert
 *   p [m], r = [roll pitch yaw] [rad] mit R = Rz·Ry·Rx, alpha = Transparenz (0 deckend … 1 unsichtbar)
 * Während Daten eintreffen, führt Simulink den Roboter (Bedienung gesperrt, Servo-Modell aus).
 */
(function () {
  'use strict';
  const BS = window.BS;
  const TIMEOUT = 1000; // ms ohne Nachricht → nicht mehr „live“
  const RETRY = 1500; // ms bis zum nächsten Verbindungsversuch

  const CS = (BS.cosim = {
    url: BS.store.get('cosimUrl', 'ws://127.0.0.1:8766'),
    enabled: false, // Verbindung gewünscht (wird bei Abbruch wiederholt)
    state: 'off', // 'off' | 'connecting' | 'open'
    live: false, // Simulink-Daten treffen ein
    msg: null, // letztes Bild
    rate: 0, // Bilder pro Sekunde
    actors: [], // Akteure der Szene: { n, shape, size, color, alpha, p, r, s }
    hidden: new Set(BS.store.get('cosimHidden', [])), // im Simulator ausgeblendete Akteure
  });
  let ws = null,
    retryTimer = null,
    lastRx = 0,
    rateN = 0,
    rateT0 = 0,
    sceneDirty = false;

  CS.setUrl = function (u) {
    CS.url = String(u).trim();
    BS.store.set('cosimUrl', CS.url);
  };
  CS.setHidden = function (name, hide) {
    if (hide) CS.hidden.add(name);
    else CS.hidden.delete(name);
    BS.store.set('cosimHidden', [...CS.hidden]);
  };
  CS.start = function () {
    CS.enabled = true;
    open();
  };
  CS.stop = function () {
    CS.enabled = false;
    clearTimeout(retryTimer);
    if (ws) {
      const s = ws;
      ws = null;
      s.close();
    }
    CS.state = 'off';
    setLive(false);
    BS.emit('cosim');
  };

  function open() {
    clearTimeout(retryTimer);
    if (!CS.enabled || ws) return;
    let s;
    try {
      s = new WebSocket(CS.url);
    } catch (e) {
      CS.enabled = false;
      CS.state = 'off';
      BS.toast('Ungültige Adresse: ' + CS.url, 'err');
      BS.emit('cosim');
      return;
    }
    ws = s;
    CS.state = 'connecting';
    BS.emit('cosim');
    s.onopen = () => {
      if (ws !== s) return;
      CS.state = 'open';
      BS.emit('cosim');
    };
    s.onmessage = (e) => {
      if (ws !== s) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.type === 'scene') scene(m);
      else if (m.type === 'frame') frame(m);
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      setLive(false);
      CS.state = CS.enabled ? 'connecting' : 'off';
      BS.emit('cosim');
      if (CS.enabled) retryTimer = setTimeout(open, RETRY); // Simulink noch nicht gestartet oder Simulation beendet
    };
  }

  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []); // jsonencode: 1×1-Struktur → Objekt
  const has = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'number');

  function scene(m) {
    CS.actors = arr(m.actors).map((a) => ({ ...a, p0: a.p, r0: a.r, c0: a.color, a0: a.alpha }));
    sceneDirty = true;
    BS.emit('cosimScene');
  }

  function frame(m) {
    if (!Array.isArray(m.q) || m.q.length < 5) return;
    const now = performance.now();
    lastRx = now;
    rateN++;
    if (now - rateT0 >= 1000) {
      CS.rate = (rateN * 1000) / (now - rateT0);
      rateN = 0;
      rateT0 = now;
    }
    CS.msg = m;
    if (!CS.live) setLive(true);
    // Roboter
    const sim = BS.sim;
    const M = BS.labScene.qToM(m.q, typeof m.q6 === 'number' ? m.q6 : null);
    sim.external = M;
    for (let i = 0; i < 6; i++) sim.cmd[i] = sim.act[i] = M[i]; // auch bei angehaltener Simulation sichtbar
    sim.updateKinematics();
    // Akteure mit Eingängen
    for (const d of arr(m.actors)) {
      const a = CS.actors.find((x) => x.n === d.n);
      if (!a) continue;
      if (has(d.p)) a.p = d.p;
      if (has(d.r)) a.r = d.r;
      if (has(d.color)) a.color = d.color;
      if (has(d.alpha)) a.alpha = d.alpha;
    }
  }

  function setLive(on) {
    if (CS.live === on) return;
    CS.live = on;
    const sim = BS.sim;
    if (on) {
      if (BS.auto && BS.auto.running) BS.auto.stop('Co-Simulation');
      if (sim.scenario !== 'cosim') sim.loadScenario('cosim');
      sim.stopMotion();
      sim.owner = 'program'; // Bedienung gesperrt, solange Simulink führt
      rateN = 0;
      rateT0 = performance.now();
    } else {
      sim.external = null;
      if (sim.owner === 'program') sim.owner = 'manual';
      CS.rate = 0;
    }
    BS.emit('owner');
    BS.emit('cosim');
  }

  // Reiter bzw. Szenario Co-Simulation: ohne Greiferkamera und ohne Bild im Bild (wie in Unreal); danach wiederherstellen.
  // Nicht gespeichert – die eigene Einstellung bleibt erhalten.
  let camSaved = null;
  CS.camRule = function () {
    const V = BS.view,
      on = BS.ui.active === 'cosim' || BS.sim.scenario === 'cosim';
    if (on && !camSaved) {
      camSaved = { gripCam: V.gripCam, pip: V.pip };
      V.gripCam = false;
      V.pip = null;
      if (V.viewName === 'greifer') V.setView('iso');
    } else if (!on && camSaved) {
      V.gripCam = camSaved.gripCam;
      V.pip = camSaved.pip;
      camSaved = null;
    } else return;
    BS.emit('pip');
  };
  BS.on('scenario', CS.camRule);

  // Simulation pausiert oder hängt: nach TIMEOUT ohne Daten die Bedienung wieder freigeben
  setInterval(() => {
    if (CS.live && performance.now() - lastRx > TIMEOUT) setLive(false);
  }, 250);

  // ------------------------------------------------------------------
  // 3D: Akteure wie in Unreal (Quader, Kugeln), Lage im Labor-KS0
  // ------------------------------------------------------------------
  let G = null;
  /** Pose im Labor-KS (Position m, [roll pitch yaw] rad, R = Rz·Ry·Rx) → 4×4-Matrix im Simulator-KS (mm), zeilenweise */
  function poseToM(p, r) {
    r = has(r) ? r : [0, 0, 0];
    const [cr, sr] = [Math.cos(r[0]), Math.sin(r[0])],
      [cp, sp] = [Math.cos(r[1]), Math.sin(r[1])],
      [cy, sy] = [Math.cos(r[2]), Math.sin(r[2])];
    const R = [
      [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
      [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
      [-sp, cp * sr, cp * cr],
    ];
    const t = BS.labScene.toSim(p);
    // Simulator-KS = Labor-KS um +90° um z gedreht: x_sim = −y_lab, y_sim = x_lab
    return [-R[1][0], -R[1][1], -R[1][2], t[0], R[0][0], R[0][1], R[0][2], t[1], R[2][0], R[2][1], R[2][2], t[2], 0, 0, 0, 1];
  }
  CS.poseToM = poseToM;
  const rgb = (c) => new THREE.Color(...(has(c) ? c.slice(0, 3) : [0.5, 0.5, 0.5]));

  function rebuild() {
    const V = BS.view;
    if (!G) {
      G = { root: new THREE.Group(), meshes: new Map() };
      G.root.visible = false;
      V.world.add(G.root);
      // Boden wie in der Laborszene
      const floor = V.mesh(new THREE.PlaneGeometry(1600, 1200), V.std(0x7b838e, { roughness: 0.95 }), G.root, [0, 100, -25], null, false);
      floor.receiveShadow = true;
    }
    for (const m of G.meshes.values()) {
      G.root.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    G.meshes.clear();
    for (const a of CS.actors) {
      const s = (has(a.size) ? a.size : [0.05, 0.05, 0.05]).map((v) => v * 1000);
      const geo = a.shape === 'sphere' ? new THREE.SphereGeometry(s[0] / 2, 24, 16) : new THREE.BoxGeometry(s[0], s[1], s[2]);
      const mesh = new THREE.Mesh(geo, V.std(0x888888, { roughness: 0.6 }));
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = mesh.receiveShadow = true;
      G.root.add(mesh);
      G.meshes.set(a.n, mesh);
    }
    sceneDirty = false;
  }

  BS.view.onSync.push(function () {
    const V = BS.view;
    if (!V.world) return;
    if (sceneDirty || !G) rebuild();
    const on = BS.sim.scenario === 'cosim';
    G.root.visible = on;
    if (!on) return;
    if (V.table) V.table.visible = false;
    if (V.grid) V.grid.visible = false;
    const m4 = new THREE.Matrix4();
    for (const a of CS.actors) {
      const mesh = G.meshes.get(a.n);
      if (!mesh) continue;
      const alpha = typeof a.alpha === 'number' ? a.alpha : 0;
      mesh.visible = alpha < 0.99 && !CS.hidden.has(a.n);
      if (!mesh.visible) continue;
      m4.set(...poseToM(a.p, a.r));
      if (has(a.s)) m4.scale(new THREE.Vector3(...a.s));
      mesh.matrix.copy(m4);
      mesh.material.color.copy(rgb(a.color));
      mesh.material.transparent = alpha > 0.01;
      mesh.material.opacity = 1 - alpha;
      mesh.material.depthWrite = alpha <= 0.01;
    }
  });
})();
