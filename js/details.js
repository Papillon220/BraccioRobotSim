/* BraccioSim – Detailgeometrie der 3D-Darstellung (Three.js r147, Einheiten mm, z nach oben)
 *  - Schrauben: Achsbolzen an den Gelenklagern, Befestigungsschrauben der Basis, Gelenkstifte im Greifer
 *  - Steuerung: Gehäuse mit DHBW-Trägerplatine, NUCLEO-H755ZI-Q und Bedienfeld neben der Basis (wie im Labor)
 *  - Servokabel (3-adrig: braun/rot/orange) von jedem Servo entlang des Arms zur Steuerung, folgen der Armbewegung
 * Maße der Lagerstellen sind aus den STL-Meshes (js/meshes.js) abgelesen.
 */
(function () {
  'use strict';
  const BS = window.BS;
  const D = (BS.details = {});


  let MAT = null;
  function mats() {
    if (MAT) return MAT;
    const S = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0, envMapIntensity: 0.5 }, o || {}));
    MAT = {
      steel: S(0xc9ccd1, { metalness: 1, roughness: 0.28, envMapIntensity: 1 }),
      recess: S(0x101113, { roughness: 0.8 }),
      pcbUno: S(0x00878f, { roughness: 0.55 }),
      black: S(0x18191b, { roughness: 0.6 }),
      gold: S(0xd8ab4c, { metalness: 1, roughness: 0.3, envMapIntensity: 1 }),
      nylon: S(0xf2efe6, { roughness: 0.7 }),
      chip: S(0x222326, { roughness: 0.4 }),
      green: S(0x1f8f3a, { roughness: 0.55 }),
      led: S(0x40ff70, { emissive: 0x30d060, emissiveIntensity: 1.2 }),
      capBody: S(0x1d2b52, { roughness: 0.4 }),
      wire: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, envMapIntensity: 0.5 }),
    };
    return MAT;
  }

  // ------------------------------------------------------------------
  // Schrauben (Achse = lokale +y, Kopfunterseite bei y = 0)
  // ------------------------------------------------------------------
  let GEO = null;
  function geos() {
    if (GEO) return GEO;
    const V2 = (x, y) => new THREE.Vector2(x, y);
    GEO = {
      // Zylinderkopf mit Innensechskant (ISO 4762 M3: d = 5,5, k = 3)
      cap: new THREE.LatheGeometry([V2(0, 0), V2(2.75, 0), V2(2.75, 2.7), V2(2.45, 3), V2(0, 3)], 28),
      hex: new THREE.CylinderGeometry(1.45, 1.45, 0.3, 6),
      // Linsenkopf mit Kreuzschlitz (Achsbolzen)
      pan: new THREE.LatheGeometry([V2(0, 0), V2(3.6, 0), V2(3.6, 0.7), V2(3.3, 1.6), V2(2.4, 2.2), V2(1.2, 2.45), V2(0, 2.5)], 28),
      slot: new THREE.BoxGeometry(3.4, 0.5, 0.7),
      // kleiner Gelenkstift im Greifer
      pin: new THREE.LatheGeometry([V2(0, 0), V2(2.3, 0), V2(2.3, 0.6), V2(1.9, 1.3), V2(0, 1.5)], 20),
    };
    return GEO;
  }
  const Y = new THREE.Vector3(0, 1, 0);
  function screw(kind, scale) {
    const G = geos(),
      M = mats();
    const g = new THREE.Group();
    if (kind === 'cap') {
      g.add(new THREE.Mesh(G.cap, M.steel));
      const h = new THREE.Mesh(G.hex, M.recess);
      h.position.y = 2.9;
      g.add(h);
    } else if (kind === 'pan') {
      g.add(new THREE.Mesh(G.pan, M.steel));
      for (const r of [0, Math.PI / 2]) {
        const s = new THREE.Mesh(G.slot, M.recess);
        s.position.y = 2.3;
        s.rotation.y = r;
        g.add(s);
      }
    } else g.add(new THREE.Mesh(G.pin, M.steel));
    if (scale) g.scale.setScalar(scale);
    return g;
  }
  function place(parent, obj, pos, n) {
    obj.position.set(pos[0], pos[1], pos[2]);
    obj.quaternion.setFromUnitVectors(Y, new THREE.Vector3(n[0], n[1], n[2]).normalize());
    parent.add(obj);
    return obj;
  }

  // ------------------------------------------------------------------
  // Steuerung: Gehäuse mit Trägerplatine (DHBW), NUCLEO-H755ZI-Q und Bedienfeld
  // Box-Koordinaten: Ursprung Bodenmitte, Kabeltülle in der Wand bei +x, Nucleo bei +y, Bedienfeld bei −y.
  // Die Box steht direkt hinter dem Roboter (gegenüber dem Förderband) und ist um 90° gedreht,
  // sodass die Kabeltülle (+x lokal) zum Roboter (+y Welt) zeigt.
  // ------------------------------------------------------------------
  const BOX = { x: 0, y: -192, w: 176, d: 196, h: 46, wall: 3, rot: Math.PI / 2 };
  /** Box-Koordinaten (x, y) → Welt */
  const toW = (x, y) => {
    const c = Math.cos(BOX.rot),
      s = Math.sin(BOX.rot);
    return [BOX.x + c * x - s * y, BOX.y + s * x + c * y];
  };
  const PCB_Z = 9; // Oberseite Trägerplatine
  const NUC = { w: 133.4, d: 70, x: 0, y: 52, z: 21 }; // Nucleo-Board (Oberseite)
  const JX = (k) => -62 + 13 * k; // Servobuchsen J9..J14 (M1..M6)
  const J_Y = 4;
  const PX = 16; // px/mm der Platinen-Texturen

  function canvasTex(w, d, draw) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * PX);
    c.height = Math.round(d * PX);
    const g = c.getContext('2d');
    const X = (x) => (x + w / 2) * PX,
      Yp = (y) => (d / 2 - y) * PX;
    draw(g, X, Yp);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }
  /** Bestückungsdruck der grünen Trägerplatine */
  function carrierTex(w, d) {
    return canvasTex(w, d, (g, X, Yp) => {
      g.fillStyle = '#0f4d3a';
      g.fillRect(0, 0, w * PX, d * PX);
      // Leiterbahnen
      g.strokeStyle = 'rgba(70,150,110,0.55)';
      g.lineWidth = 0.6 * PX;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.moveTo(X(JX(k)), Yp(J_Y + 4));
        g.lineTo(X(JX(k)), Yp(14 + k));
        g.lineTo(X(30 + 4 * k), Yp(18 + k));
        g.stroke();
      }
      g.fillStyle = '#eef3ef';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const t = (txt, x, y, s, wt) => {
        g.font = `${wt || 600} ${s * PX}px system-ui, sans-serif`;
        g.fillText(txt, X(x), Yp(y));
      };
      for (let k = 0; k < 6; k++) t('J' + (9 + k), JX(k), J_Y - 7, 2.4);
      t('LIM X', -64, -32, 2.8);
      t('LIM Y', -50, -32, 2.8);
      t('LIM Z', -36, -32, 2.8);
      t('Manual', -66, -70, 3.2);
      t('AUTO', -47, -70, 3.2);
      t('NotAus', 40, -15, 3);
      t('TBD 1', 52, -38, 3);
      t('TBD 2', 52, -58, 3);
      t('2', -18, -58, 3);
      t('1', -2, -58, 3);
      t('2', 24, -58, 3);
      t('1', 40, -58, 3);
      for (const [x, l] of [
        [-28, 'DOWN'],
        [-8, 'UP'],
        [12, 'DOWN'],
        [32, 'UP'],
      ])
        t(l, x, -91, 2.8);
      g.textAlign = 'left';
      t('Braccio Roboter', 54, -71, 3.4, 500);
      t('Tenten-2621306', 54, -76, 3.4, 500);
      t('DHBW Stuttgart', 50, 92, 3.2, 700);
      // Montagebohrungen
      g.fillStyle = '#c9a24a';
      for (const [x, y] of [
        [-w / 2 + 5, d / 2 - 5],
        [w / 2 - 5, d / 2 - 5],
        [-w / 2 + 5, -d / 2 + 5],
        [w / 2 - 5, -d / 2 + 5],
      ]) {
        g.beginPath();
        g.arc(X(x), Yp(y), 2 * PX, 0, 2 * Math.PI);
        g.fill();
      }
    });
  }
  /** Weißes Nucleo-Board mit Bestückungsdruck */
  function nucleoTex() {
    const { w, d } = NUC;
    return canvasTex(w, d, (g, X, Yp) => {
      g.fillStyle = '#f3f4f2';
      g.fillRect(0, 0, w * PX, d * PX);
      // Lötaugen der Morpho-Stiftleisten (Doppelreihen an beiden Längsseiten)
      g.fillStyle = '#c9a24a';
      for (const yy of [d / 2 - 3, d / 2 - 5.5, -d / 2 + 3, -d / 2 + 5.5])
        for (let x = -w / 2 + 18; x < w / 2 - 14; x += 2.54) {
          g.beginPath();
          g.arc(X(x), Yp(yy), 0.6 * PX, 0, 2 * Math.PI);
          g.fill();
        }
      // feine Bauteile und Leiterbahnen
      g.fillStyle = '#9aa0a6';
      for (let i = 0; i < 70; i++) {
        const x = -w / 2 + 6 + ((i * 37) % (w - 12)),
          y = -d / 2 + 10 + ((i * 53) % (d - 20));
        g.fillRect(X(x), Yp(y), 1.2 * PX, 0.7 * PX);
      }
      g.fillStyle = '#1f3c8c';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `700 ${3 * PX}px system-ui, sans-serif`;
      g.fillText('Nucleo', X(-w / 2 + 14), Yp(d / 2 - 12));
      g.fillStyle = '#ffffff';
      g.fillRect(X(-w / 2 + 12), Yp(10), 30 * PX, 9 * PX);
      g.strokeStyle = '#333';
      g.lineWidth = 0.2 * PX;
      g.strokeRect(X(-w / 2 + 12), Yp(10), 30 * PX, 9 * PX);
      g.fillStyle = '#111';
      g.font = `700 ${2.6 * PX}px system-ui, sans-serif`;
      g.fillText('NUCLEO-H755ZI-Q', X(-w / 2 + 13), Yp(7.8));
      g.font = `600 ${2.2 * PX}px system-ui, sans-serif`;
      g.fillText('NUH755ZIQ$AT3', X(-w / 2 + 13), Yp(3.6));
      // ST-Logo
      g.fillStyle = '#1f6fd1';
      g.beginPath();
      g.moveTo(X(-w / 2 + 12), Yp(-d / 2 + 16));
      g.lineTo(X(-w / 2 + 22), Yp(-d / 2 + 16));
      g.lineTo(X(-w / 2 + 18), Yp(-d / 2 + 9));
      g.lineTo(X(-w / 2 + 8), Yp(-d / 2 + 9));
      g.fill();
      g.fillStyle = '#fff';
      g.font = `800 ${3.2 * PX}px system-ui, sans-serif`;
      g.fillText('ST', X(-w / 2 + 12), Yp(-d / 2 + 12.5));
      g.fillStyle = '#333';
      g.font = `600 ${1.8 * PX}px system-ui, sans-serif`;
      g.fillText('MB1363D', X(-w / 2 + 6), Yp(-d / 2 + 20));
    });
  }

  /** Steuerung auf dem Tisch aufbauen; liefert die Steckerpositionen (Welt) der Servokabel M1..M6 */
  D.buildController = function (parent) {
    const M = mats();
    const S = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0, envMapIntensity: 0.5 }, o || {}));
    const mat = {
      housing: S(0x9a9fa6, { roughness: 0.75 }),
      lid: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, depthWrite: false }),
      white: S(0xf4f2ec, { roughness: 0.6 }),
      knobRing: S(0xd9c8a4, { roughness: 0.5 }),
      jst: S(0xf1efe8, { roughness: 0.6 }),
      red: S(0xd62828, { roughness: 0.45 }),
      yellow: S(0xe6c229, { roughness: 0.5 }),
      grey: S(0x8d939a, { roughness: 0.6 }),
    };
    const grp = new THREE.Group();
    grp.position.set(BOX.x, BOX.y, 0);
    grp.rotation.z = BOX.rot;
    parent.add(grp);
    const box = (w, h, d, m, x, y, z, shadow) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      o.castShadow = shadow !== false;
      o.receiveShadow = true;
      grp.add(o);
      return o;
    };
    const cyl = (r, h, m, x, y, z, seg, r2) => {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 != null ? r2 : r, h, seg || 20), m);
      o.rotation.x = Math.PI / 2;
      o.position.set(x, y, z);
      o.castShadow = true;
      grp.add(o);
      return o;
    };
    const { w, d, h, wall } = BOX;
    // Gehäuse: Boden, vier Wände, durchsichtiger Deckel mit Schrauben
    box(w, d, 3, mat.housing, 0, 0, 1.5);
    box(wall, d, h, mat.housing, -w / 2 + wall / 2, 0, h / 2);
    box(wall, d, h, mat.housing, w / 2 - wall / 2, 0, h / 2);
    box(w, wall, h, mat.housing, 0, -d / 2 + wall / 2, h / 2);
    box(w, wall, h, mat.housing, 0, d / 2 - wall / 2, h / 2);
    const lid = box(w - 2, d - 2, 2.5, mat.lid, 0, 0, h + 1.25, false);
    lid.renderOrder = 2;
    for (const [x, y] of [
      [-w / 2 + 6, d / 2 - 6],
      [w / 2 - 6, d / 2 - 6],
      [-w / 2 + 6, -d / 2 + 6],
      [w / 2 - 6, -d / 2 + 6],
      [w / 2 - 6, 0],
      [-w / 2 + 6, 0],
    ])
      place(grp, screw('pan', 0.9), [x, y, h + 2.5], [0, 0, 1]);
    // Trägerplatine
    const cw = w - 2 * wall - 4,
      cd = d - 2 * wall - 4;
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(cw, cd, 1.6), [M.green, M.green, M.green, M.green, new THREE.MeshStandardMaterial({ map: carrierTex(cw, cd), roughness: 0.5 }), M.green]);
    pcb.position.set(0, 0, PCB_Z - 0.8);
    pcb.receiveShadow = true;
    grp.add(pcb);
    // Nucleo-Board auf Abstandshaltern
    const nb = new THREE.Mesh(new THREE.BoxGeometry(NUC.w, NUC.d, 1.6), [M.black, M.black, M.black, M.black, new THREE.MeshStandardMaterial({ map: nucleoTex(), roughness: 0.5 }), M.black]);
    nb.position.set(NUC.x, NUC.y, NUC.z - 0.8);
    nb.castShadow = nb.receiveShadow = true;
    grp.add(nb);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) cyl(2, NUC.z - PCB_Z - 1.6, M.nylon, NUC.x + sx * (NUC.w / 2 - 4), NUC.y + sy * (NUC.d / 2 - 4), PCB_Z + (NUC.z - PCB_Z - 1.6) / 2, 12);
    const nz = NUC.z;
    // Zio-Buchsenleisten (schwarz) und Morpho-Stiftleisten
    box(44, 5, 8, M.black, NUC.x - 6, NUC.y + 17, nz + 4);
    box(26, 5, 8, M.black, NUC.x + 33, NUC.y + 17, nz + 4);
    box(48, 5, 8, M.black, NUC.x - 2, NUC.y - 17, nz + 4);
    box(26, 5, 8, M.black, NUC.x + 37, NUC.y - 17, nz + 4);
    box(100, 2.5, 2.5, M.black, NUC.x + 4, NUC.y + NUC.d / 2 - 4.2, nz + 1.25);
    box(100, 2.5, 2.5, M.black, NUC.x + 4, NUC.y - NUC.d / 2 + 4.2, nz + 1.25);
    box(13, 13, 1.6, M.chip, NUC.x + 12, NUC.y + 1, nz + 0.8); // STM32H755
    box(16, 15, 13, M.steel, NUC.x - NUC.w / 2 + 5, NUC.y - 2, nz + 6.5); // RJ45
    box(7, 6, 3, M.steel, NUC.x - NUC.w / 2 + 3, NUC.y + 18, nz + 1.5); // USB
    box(7, 6, 3, M.steel, NUC.x + NUC.w / 2 - 3, NUC.y - 12, nz + 1.5); // USB (ST-Link)
    cyl(2.4, 3, S(0x2e6fd8), NUC.x - NUC.w / 2 + 6, NUC.y + 28, nz + 1.5, 16); // blauer Taster
    // Servobuchsen J9..J14 mit eingesteckten Steckern
    const conn = [];
    for (let k = 0; k < 6; k++) {
      const x = JX(k);
      box(9, 6, 7, mat.jst, x, J_Y, PCB_Z + 3.5);
      box(7.6, 3.6, 9, M.black, x, J_Y + 0.5, PCB_Z + 8.5);
      conn.push([x, J_Y + 0.5, PCB_Z + 13]); // Box-Koordinaten, Umrechnung in route()
    }
    // Kabeltülle in der rechten Wand (zum Roboter)
    box(10, 26, 16, mat.grey, w / 2 - 2, J_Y + 2, 20);
    // Elko, Hohlstecker
    cyl(5, 10, M.black, 52, 10, PCB_Z + 5, 20);
    box(14, 12, 11, M.black, w / 2 - 10, -40, PCB_Z + 5.5);
    // Bedienfeld
    const led = (x, y, color) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x3a3d42, emissive: color, emissiveIntensity: 0, roughness: 0.3 });
      cyl(1.6, 2.4, m, x, y, PCB_Z + 1.2, 14);
      return m;
    };
    const button = (x, y) => {
      cyl(4.2, 8, mat.white, x, y, PCB_Z + 4, 20);
      cyl(3, 14, mat.white, x, y, PCB_Z + 11, 20);
    };
    const leds = {
      limX: led(-64, -26, 0xff3030),
      limY: led(-50, -26, 0xff3030),
      limZ: led(-36, -26, 0xff3030),
      manual: led(-66, -64, 0x30ff60),
      auto: led(-47, -64, 0xffffff),
      power: led(78, -84, 0x3c8cff),
    };
    button(-66, -48);
    button(-47, -48);
    for (const x of [-28, -8, 12, 32]) button(x, -80);
    button(52, -30);
    button(52, -50);
    // Drehknöpfe (Achswahl)
    for (const x of [-10, 32]) {
      cyl(13, 10, mat.knobRing, x, -38, PCB_Z + 5, 32);
      cyl(12, 18, mat.white, x, -38, PCB_Z + 19, 32, 13);
      box(3, 12, 3, mat.white, x, -38 + 5, PCB_Z + 29.5);
    }
    // NotAus
    cyl(5, 6, mat.yellow, 40, -5, PCB_Z + 3, 20);
    cyl(4, 6, mat.red, 40, -5, PCB_Z + 9, 20);
    D.controller = {
      conn: conn.map((c) => [...toW(c[0], c[1]), c[2]]),
      latAxis: Math.abs(Math.cos(BOX.rot)) > 0.5 ? 'x' : 'y', // Adern nebeneinander entlang der Buchsenreihe
      leds,
      // Kabelweg: vom Roboter zur Tülle, innen zur Buchse, von oben einstecken
      route: (k) => {
        const c = conn[k];
        const gx = w / 2,
          gy = J_Y + 2 + (k - 2.5) * 3.2; // nebeneinander durch die Tülle
        return [
          [gx + 40, gy, 4],
          [gx + 6, gy, 20],
          [gx - 14, gy, 22],
          [c[0] + 4, c[1] + 8, c[2] + 9],
          [c[0], c[1], c[2] + 5],
          [c[0], c[1], c[2]],
        ].map((q) => [...toW(q[0], q[1]), q[2]]);
      },
    };
    return D.controller;
  };
  /** LEDs der Steuerung: Manual / AUTO / LIM X–Z nach Zustand der Simulation */
  D.updateController = function () {
    const c = D.controller;
    if (!c || !c.leds) return;
    const sim = BS.sim,
      mon = BS.monitor;
    const auto = !!(BS.auto && BS.auto.running) || sim.owner === 'traj';
    const set = (m, on) => (m.emissiveIntensity = on ? 2.2 : 0);
    set(c.leds.manual, !auto);
    set(c.leds.auto, auto);
    const viol = mon && mon.enabled && mon.state !== 'ok';
    set(c.leds.limX, (BS.labScene && BS.labScene.alarm) || viol);
    set(c.leds.limY, viol);
    set(c.leds.limZ, viol);
    set(c.leds.power, true);
    for (const k of ['limX', 'limY', 'limZ']) c.leds[k].color.setHex(c.leds[k].emissiveIntensity ? 0xff5050 : 0x3a3d42);
    c.leds.manual.color.setHex(c.leds.manual.emissiveIntensity ? 0x60ff80 : 0x3a3d42);
    c.leds.auto.color.setHex(c.leds.auto.emissiveIntensity ? 0xffffff : 0x3a3d42);
    c.leds.power.color.setHex(0x6aa8ff);
  };

  // ------------------------------------------------------------------
  // Kabel: dünne Röhren entlang Catmull-Rom-Kurven, Geometrie wird in-place aktualisiert
  // ------------------------------------------------------------------
  const WIRE_COLORS = [0x6b3e1f, 0xc0281f, 0xf08a1c]; // GND, +5 V, Signal
  const WIRE_OFF = [-1.35, 0, 1.35];
  const RING = 6,
    WIRE_R = 0.62;

  function wireMesh(nWires, nPts) {
    const nv = nWires * nPts * RING;
    const pos = new Float32Array(nv * 3),
      nor = new Float32Array(nv * 3),
      col = new Float32Array(nv * 3);
    const idx = [];
    const c = new THREE.Color();
    for (let w = 0; w < nWires; w++) {
      c.setHex(WIRE_COLORS[w % 3]).convertSRGBToLinear();
      const base = w * nPts * RING;
      for (let i = 0; i < nPts * RING; i++) col.set([c.r, c.g, c.b], (base + i) * 3);
      for (let i = 0; i < nPts - 1; i++)
        for (let r = 0; r < RING; r++) {
          const a = base + i * RING + r,
            b = base + i * RING + ((r + 1) % RING);
          idx.push(a, a + RING, b, b, a + RING, b + RING);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, mats().wire);
    m.castShadow = true;
    m.frustumCulled = false;
    return m;
  }

  const _t = new THREE.Vector3(),
    _n = new THREE.Vector3(),
    _b = new THREE.Vector3(),
    _q = new THREE.Vector3();
  /** Röhre für Draht w aus Punktfolge P (parallel transportierte Normalen) */
  function writeTube(geo, w, P) {
    const pos = geo.attributes.position.array,
      nor = geo.attributes.normal.array;
    const n = P.length,
      base = w * n * RING;
    _n.set(0, 0, 0);
    for (let i = 0; i < n; i++) {
      _t.subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      if (i === 0) {
        _n.set(0, 0, 1);
        if (Math.abs(_t.z) > 0.9) _n.set(1, 0, 0);
      }
      _n.addScaledVector(_t, -_t.dot(_n)).normalize();
      _b.crossVectors(_t, _n);
      for (let r = 0; r < RING; r++) {
        const a = (r / RING) * Math.PI * 2,
          ca = Math.cos(a),
          sa = Math.sin(a);
        _q.set(_n.x * ca + _b.x * sa, _n.y * ca + _b.y * sa, _n.z * ca + _b.z * sa);
        const k = (base + i * RING + r) * 3;
        pos[k] = P[i].x + _q.x * WIRE_R;
        pos[k + 1] = P[i].y + _q.y * WIRE_R;
        pos[k + 2] = P[i].z + _q.z * WIRE_R;
        nor[k] = _q.x;
        nor[k + 1] = _q.y;
        nor[k + 2] = _q.z;
      }
    }
  }

  /*
   * Kabelführung: Stützpunkte [Frame, x, y, z, Querachse, Bündelversatz]
   * Frame 0..5 = KS0..KS5, 'fl' = Greiferflansch, 'w' = Welt. Querachse: Richtung, in der die Adern
   * (und die Kabel des Bündels) nebeneinander liegen. Arm: auf der Flanschfläche y = −18,6 des Doppel-T-Profils.
   */
  const P = (f, x, y, z, lat, o) => ({ f, p: [x, y, z], lat, o: !!o });
  const ROUTE = {
    wrist: [P(4, -21, -30.5, 6, 'x', 1)],
    fore: [P(3, 8, -18.6, 0, 'z', 1), P(3, -60, -18.6, 0, 'z', 1), P(3, -106, -18.6, 0, 'z', 1)],
    upper: [P(2, 10, -18.6, 0, 'z', 1), P(2, -60, -18.6, 0, 'z', 1), P(2, -106, -18.6, 0, 'z', 1)],
    turret: [P(1, -30, -30, 0, 'z', 1), P(1, -47, -51.5, 0, 'z', 1), P(1, -60, -60, 0, 'z', 1)],
    base: [P('w', 0, -72, 4, 'x', 1), P('w', 0, -98, 1.2, 'x', 1)],
  };
  function cableAnchors(k) {
    const R = ROUTE;
    const start = [
      [P('w', 0, -56, 6, 'x')], // M1: Basisservo
      [P(1, 18, -42, 0, 'z'), P(1, -10, -48, 0, 'z', 1)], // M2: Schulterservo im Drehturm
      [P(2, -40, -11, 0, 'z'), P(2, -50, -18.6, 0, 'z', 1)], // M3: Ellbogenservo im Oberarm
      [P(3, -40, -11, 0, 'z'), P(3, -50, -18.6, 0, 'z', 1)], // M4: Handgelenkservo im Unterarm
      [P(4, -25, 0, 33, 'x'), P(4, -23, -30.5, 28, 'x', 1)], // M5: Handrotation
      [P('fl', 12, 6, -71, 'x'), P(4, -22, -30.5, 46, 'x', 1)], // M6: Greiferservo
    ][k];
    const via = [
      R.base,
      R.turret.slice(1).concat(R.base),
      R.upper.slice(2).concat(R.turret, R.base),
      R.fore.slice(2).concat(R.upper, R.turret, R.base),
      R.wrist.concat(R.fore, R.upper, R.turret, R.base),
      R.wrist.concat(R.fore, R.upper, R.turret, R.base),
    ][k];
    return start.concat(via);
  }

  /** Details am Roboter: Schrauben + Kabel. ctx = {root, F, flange, carrier, link} */
  D.buildRobotDetails = function (ctx) {
    const { root, F, flange, carrier, link: L } = ctx;
    // Befestigung der Basis (6 Laschen, r = 60 mm, Laschenstärke 3 mm)
    for (let k = 0; k < 6; k++) {
      const a = ((30 + 60 * k) * Math.PI) / 180;
      place(F[0], screw('cap'), [60 * Math.cos(a), 60 * Math.sin(a), 3], [0, 0, 1]);
    }
    // Achsbolzen an den Lagerstellen der Gabeln (Ober-/Unterarm: Schulter- bzw. Ellbogenachse)
    for (const i of [2, 3]) {
      place(F[i], screw('pan'), [-125, 0, 28.5], [0, 0, 1]);
      place(F[i], screw('pan'), [-125, 0, -34.3], [0, 0, -1]);
    }
    place(F[4], screw('pan'), [0, 28.6, 0], [0, 1, 0]);
    place(F[4], screw('pan'), [0, -28.4, 0], [0, -1, 0]);
    // Gelenkstifte im Greifergetriebe (Seitenplatten bei x = ±7,3)
    const pinAt = (parent, yz, origin) => {
      for (const s of [1, -1]) place(parent, screw('pin'), [s * 7.35, yz[0] - origin[0], yz[1] - origin[1]], [s, 0, 0]);
    };
    for (const k of ['gL', 'aL', 'aR']) pinAt(flange, L[k], [0, 0]);
    pinAt(carrier.L, L.cL, L.cL);
    pinAt(carrier.L, L.rL, L.cL);
    pinAt(carrier.R, L.cR, L.cR);
    pinAt(carrier.R, L.rR, L.cR);

    // Servokabel
    const ctrl = D.controller;
    const SEG = 9;
    const cables = [];
    const group = new THREE.Group();
    root.add(group);
    if (ctrl) {
      for (let k = 0; k < 6; k++) {
        const a = cableAnchors(k);
        // über den Tisch zur Kabeltülle der Steuerung, innen zur Buchse J9…J14, von oben eingesteckt
        for (const q of ctrl.route(k)) a.push(P('w', q[0], q[1], q[2], ctrl.latAxis || 'x'));
        const nPts = (a.length - 1) * SEG + 1;
        const mesh = wireMesh(3, nPts);
        group.add(mesh);
        cables.push({ a, nPts, mesh, off: (k - 2.5) * 4.4, pts: [0, 1, 2].map(() => a.map(() => new THREE.Vector3())) });
      }
    }
    const last = new Float64Array(16 * 7).fill(NaN);
    const v = new THREE.Vector3();
    const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    function update() {
      if (!cables.length || !group.visible) return;
      // nur neu berechnen, wenn sich eine Gelenkstellung geändert hat
      let changed = false;
      const ms = F.map((f) => f.matrix).concat([flange.matrix]);
      ms.forEach((m, j) => {
        for (let i = 0; i < 16; i++)
          if (last[j * 16 + i] !== m.elements[i]) {
            last[j * 16 + i] = m.elements[i];
            changed = true;
          }
      });
      if (!changed) return;
      for (const cb of cables) {
        cb.a.forEach((an, i) => {
          const m = an.f === 'w' ? null : an.f === 'fl' ? flange.matrix : F[an.f].matrix;
          for (let w = 0; w < 3; w++) {
            const o = WIRE_OFF[w] + (an.o ? cb.off : 0);
            const ax = axis[an.lat];
            v.set(an.p[0] + ax[0] * o, an.p[1] + ax[1] * o, an.p[2] + ax[2] * o);
            if (m) v.applyMatrix4(m);
            cb.pts[w][i].copy(v);
          }
        });
        for (let w = 0; w < 3; w++) {
          const curve = new THREE.CatmullRomCurve3(cb.pts[w], false, 'centripetal');
          writeTube(cb.mesh.geometry, w, curve.getPoints(cb.nPts - 1));
        }
        cb.mesh.geometry.attributes.position.needsUpdate = true;
        cb.mesh.geometry.attributes.normal.needsUpdate = true;
      }
    }
    return { update, cables: group };
  };
})();
