/* BraccioSim – Labor-Szenario (Szene der Laborübung 2: Plattform, Pick-up-Marker, Würfel, Hochregal, Sortierbox, virtuelle Wand)
 *
 * Koordinaten: Labor-KS0 in m (x nach vorne), Simulator in mm: x_sim = −y_lab, y_sim = x_lab, z_sim = z_lab.
 * Gelenkwinkel q (DH-Konvention der Übung) ↔ Servowinkel M des Simulators:
 *   M1 = q1 + 90°, M2 = 180° − q2, M3 = 90° − q3, M4 = 180° − q4, M5 = q5 + 90°, M6 = q6
 */
(function () {
  'use strict';
  const BS = window.BS;
  const D2R = Math.PI / 180;

  const S = (BS.labScene = {
    show: Object.assign({ cube1: true, cube2: true, regal: true, efence: true }, BS.store.get('labShow', {})),
    efenceX: BS.store.get('labWallX', -0.2), // Lage der virtuellen Wand im Labor-KS [m] (= y_sim / 1000)
    WALL_MIN: -350, // Einstellbereich der Wand in y_sim [mm]
    WALL_MAX: 450,
    alarm: false,
  });
  /** Virtuelle Wand verschieben: y im Simulator-KS [mm] */
  S.setWallY = function (yMm) {
    S.efenceX = BS.clamp(yMm, S.WALL_MIN, S.WALL_MAX) / 1000;
    BS.store.set('labWallX', S.efenceX);
  };

  const toSim = (p) => [-p[1] * 1000, p[0] * 1000, p[2] * 1000];
  const toLab = (p) => [p[1] / 1000, -p[0] / 1000, p[2] / 1000];
  /** Gelenkwinkel q [rad] → Servowinkel M [°] */
  const qToM = (q, q6) => [q[0] / D2R + 90, 180 - q[1] / D2R, 90 - q[2] / D2R, 180 - q[3] / D2R, q[4] / D2R + 90, q6 != null ? q6 / D2R : BS.sim.cmd[5]];
  S.toSim = toSim;
  S.toLab = toLab;
  S.qToM = qToM;

  // Szene (collisionBox-Objekte des Ini-Skripts der Übung)
  const SCENE = {
    platform: { c: [0.1, 0, -0.01], s: [0.6, 0.3, 0.02], color: 0xb4632e },
    pickupMarker1: { c: [0.25, 0, -0.005], s: [0.025, 0.025, 0.02], color: 0x5c636e },
    pickupMarker2: { c: [0.35, 0, -0.005], s: [0.025, 0.025, 0.02], color: 0x5c636e },
    regal: { c: [0.4, 0, 0.05], s: [0.04, 0.06, 0.1], color: 0x8d6e63 },
    box1_floor: { c: [0, 0.2, -0.015], s: [0.1, 0.1, 0.005], color: 0xd9c7a8 },
    box1_wall1: { c: [0, 0.15, 0.03], s: [0.1, 0.005, 0.1], color: 0xd9c7a8 },
    box1_wall2: { c: [0, 0.25, 0.03], s: [0.1, 0.005, 0.1], color: 0xd9c7a8 },
    box1_wall3: { c: [0.05, 0.2, 0.03], s: [0.005, 0.1, 0.1], color: 0xd9c7a8 },
    box1_wall4: { c: [-0.05, 0.2, 0.03], s: [0.005, 0.1, 0.1], color: 0xd9c7a8 },
  }; // prettier-ignore
  const CUBES = {
    cube1: { c: [0.25, 0, 0.015], color: '#e03131', name: 'Würfel 1' },
    cube2: { c: [0.35, 0, 0.015], color: '#1c7ed6', name: 'Würfel 2' },
  };
  const HOME_Q = [0, 90, 0, 90, 0]; // Grad, Default-Pose der Übung (alle φ = 0)

  const simBox = (b) => ({ c: toSim(b.c), s: [b.s[1] * 1000, b.s[0] * 1000, b.s[2] * 1000] });

  S.build = function () {
    const sim = BS.sim;
    sim.statics = [];
    for (const [name, b] of Object.entries(SCENE)) {
      if (name === 'platform') continue;
      if (name === 'regal' && !S.show.regal) continue;
      const sb = simBox(b);
      sim.statics.push({ name, c: sb.c, s: sb.s });
    }
    // Boden: Plattform (z = 0), Sortierbox (Boden bei −12,5 mm), sonst darunter
    sim.groundAt = (x, y) => {
      if (Math.abs(x) <= 150 && y >= -200 && y <= 400) return 0;
      if (x >= -250 && x <= -150 && Math.abs(y) <= 50) return -12.5;
      return -20;
    };
    // Roboter in die Default-Pose der Übung stellen
    const M = qToM(HOME_Q.map((v) => v * D2R), 10 * D2R);
    if (sim.play) sim.stopMotion();
    for (let i = 0; i < 6; i++) sim.cmd[i] = sim.act[i] = M[i];
    sim.updateKinematics();
    for (const [k, cb] of Object.entries(CUBES)) {
      if (!S.show[k]) continue;
      sim.addObject({ size: [20, 20, 20], pos: toSim(cb.c), yaw: 0, color: cb.color, name: cb.name, tag: k });
    }
    // Sortierbox als Zielbereich (Kontrolle im Panel „Umgebung“)
    const bf = simBox(SCENE.box1_floor);
    sim.targets.push({ id: sim.nextId++, name: 'Sortierbox', x: bf.c[0], y: bf.c[1], w: 95, h: 95, z: -12, color: '#d9c7a8', accept: '', noLabel: true });
  };

  S.setShow = function (key, on) {
    S.show[key] = on;
    BS.store.set('labShow', S.show);
    const sim = BS.sim;
    if (sim.scenario !== 'labor2') return;
    if (key === 'cube1' || key === 'cube2') {
      const o = sim.objects.find((x) => x.tag === key);
      if (!on && o) sim.removeObject(o);
      if (on && !o) sim.addObject({ size: [20, 20, 20], pos: toSim(CUBES[key].c), yaw: 0, color: CUBES[key].color, name: CUBES[key].name, tag: key });
    }
    if (key === 'regal') {
      sim.statics = sim.statics.filter((s) => s.name !== 'regal');
      if (on) {
        const sb = simBox(SCENE.regal);
        sim.statics.push({ name: 'regal', c: sb.c, s: sb.s });
      }
      sim.objects.forEach((o) => (o.resting = false));
    }
  };

  // ------------------------------------------------------------------
  // 3D
  // ------------------------------------------------------------------
  let G = null;
  function build3d() {
    const V = BS.view;
    if (!V.world || G) return;
    const g = new THREE.Group();
    g.visible = false;
    V.world.add(g);
    G = { root: g, boxes: {} };
    // Boden unter der Plattform
    const floor = V.mesh(new THREE.PlaneGeometry(1600, 1200), V.std(0x7b838e, { roughness: 0.95 }), g, [0, 100, -20], null, false);
    floor.receiveShadow = true;
    const grid = new THREE.GridHelper(1600, 32, 0x6d747e, 0x8a919b);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 100, -19.8);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    g.add(grid);
    for (const [name, b] of Object.entries(SCENE)) {
      const sb = simBox(b);
      const m = V.mesh(new THREE.BoxGeometry(sb.s[0], sb.s[1], sb.s[2]), V.std(b.color, { roughness: name === 'platform' ? 0.8 : 0.6 }), g, sb.c, null, true);
      m.castShadow = name !== 'platform';
      m.receiveShadow = true;
      G.boxes[name] = m;
    }
    // Raster auf der Plattform (Laborkoordinaten)
    const pg = new THREE.GridHelper(600, 12, 0x8a4a22, 0x9d5629);
    pg.scale.set(0.5, 1, 1);
    pg.rotation.x = Math.PI / 2;
    pg.position.set(0, 100, 0.3);
    g.add(pg);
    // virtuelle Wand
    const ef = new THREE.Mesh(new THREE.BoxGeometry(300, 2, 300), new THREE.MeshStandardMaterial({ color: 0x666666, transparent: true, opacity: 0.35, depthWrite: false }));
    ef.add(new THREE.LineSegments(new THREE.EdgesGeometry(ef.geometry), new THREE.LineBasicMaterial({ color: 0x444444 })));
    const efl = V.label('virtuelle Wand (efence1)', '#ffffff', 12);
    efl.position.set(0, 0, 165);
    ef.add(efl);
    g.add(ef);
    G.efence = ef;
    const sbl = V.label('Sortierbox', '#ffffff', 12);
    sbl.position.set(...toSim([0, 0.2, 0.1]));
    g.add(sbl);
    const rgl = V.label('Regal', '#ffffff', 12);
    rgl.position.set(...toSim([0.4, 0, 0.125]));
    g.add(rgl);
    G.regalLabel = rgl;
    // Labor-KS0
    const ax = new THREE.Group();
    const arr = (dir, col, txt) => {
      ax.add(new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(0, 0, 0.5), 90, col, 12, 6));
      const l = V.label(txt, '#' + col.toString(16).padStart(6, '0'), 13);
      l.position.set(dir[0] * 104, dir[1] * 104, dir[2] * 104 + 3);
      ax.add(l);
    };
    arr([0, 1, 0], 0xe03131, 'x₀');
    arr([-1, 0, 0], 0x2f9e44, 'y₀');
    arr([0, 0, 1], 0x1c7ed6, 'z₀');
    ax.position.set(-130, -170, 0.6);
    g.add(ax);
  }

  BS.view.onSync.push(function () {
    const V = BS.view;
    if (!G) build3d();
    if (!G) return;
    const on = BS.sim.scenario === 'labor2';
    G.root.visible = on;
    if (V.table) V.table.visible = !on;
    if (V.grid) V.grid.visible = !on;
    if (!on) return;
    G.boxes.regal.visible = S.show.regal;
    G.regalLabel.visible = S.show.regal && V.show.labels !== false;
    // virtuelle Wand: rot, sobald der TCP im Labor-KS x ≤ efence1_coord.x erreicht
    const tcp = BS.sim.F[5];
    S.alarm = S.show.efence && toLab([tcp[3], tcp[7], tcp[11]])[0] <= S.efenceX;
    G.efence.position.set(0, S.efenceX * 1000, 150);
    G.efence.visible = S.show.efence;
    G.efence.material.color.setHex(S.alarm ? 0xff0000 : 0x666666);
    G.efence.material.opacity = S.alarm ? 0.55 : 0.35;
  });
})();
