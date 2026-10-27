/* BraccioSim – 3D-Ansicht (Three.js r147, z-Achse nach oben, Einheiten in mm) */
(function () {
  'use strict';
  const BS = window.BS;
  const C = BS.config;

  const V = (BS.view = {
    show: { frames: false, trace: false, ghost: false, wsPlane: false, wsHull: false, zones: false, markers: false, tcp: false, path: false, labels: false }, // beim Start alles aus
    selected: null,
    ghostPose: null,
    ghostReason: '',
    onSync: [], // Rückrufe nach jeder Synchronisation (z. B. Laborszene)
    viewName: 'iso',
  });

  let renderer, scene, camera, controls, tctrl, container;
  let robot, ghost;
  const objMeshes = new Map(),
    targetMeshes = new Map(),
    zoneMeshes = new Map();
  let staticsGroup = null,
    staticsRef = null;
  let markerGroup, conveyorGroup, traceLine, pathLine, wsPlane, wsHull, ikTarget, worldGroup;

  // ------------------------------------------------------------------
  // Hilfen
  // ------------------------------------------------------------------
  function std(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.65, metalness: 0.08, envMapIntensity: 0.35 }, opts || {}));
  }
  function mesh(geo, mat, parent, pos, rot, shadow) {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    if (shadow !== false) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    parent.add(m);
    return m;
  }
  function box(w, h, d, mat, parent, pos, rot, shadow) {
    return mesh(new THREE.BoxGeometry(w, h, d), mat, parent, pos, rot, shadow);
  }
  function label(text, color, size) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const fs = 44;
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    c.width = w;
    c.height = fs + 16;
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(20,24,30,0.72)';
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, c.height, r);
    ctx.arcTo(w, c.height, 0, c.height, r);
    ctx.arcTo(0, c.height, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.fill();
    ctx.fillStyle = color || '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 10, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const s = size || 18;
    sp.scale.set((s * w) / c.height, s, 1);
    sp.renderOrder = 10;
    // Beschriftungen gemeinsam ein-/ausblendbar (Schalter „Text“)
    sp.visible = V.show.labels !== false;
    labelSprites.add(sp);
    return sp;
  }
  const labelSprites = new Set();
  function setMatrixRowMajor(obj, M) {
    obj.matrix.set(M[0], M[1], M[2], M[3], M[4], M[5], M[6], M[7], M[8], M[9], M[10], M[11], M[12], M[13], M[14], M[15]);
    obj.matrixWorldNeedsUpdate = true;
  }
  V.label = label;

  // ------------------------------------------------------------------
  // Roboter-Modell (Geometrie in den DH-Koordinatensystemen)
  // ------------------------------------------------------------------
  function buildRobot(isGhost) {
    const g = C.geom;
    const root = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.22, depthWrite: false });
    const M = isGhost
      ? { base: ghostMat, link: ghostMat, servo: ghostMat, horn: ghostMat, pad: ghostMat, up: ghostMat, fore: ghostMat, hand: ghostMat }
      : {
          base: std(0x2c3036),
          servo: std(0x121417, { roughness: 0.5 }),
          horn: std(0xe9ecef, { roughness: 0.4 }),
          pad: std(0x5c636c, { roughness: 0.9 }),
          up: std(0x26292e),
          fore: std(0x26292e),
          hand: std(0x26292e),
          ring: std(0xf08c00, { roughness: 0.5 }),
        };
    const sh = !isGhost;
    const F = [];
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      grp.matrixAutoUpdate = false;
      root.add(grp);
      F.push(grp);
      if (!isGhost) {
        const ax = new THREE.AxesHelper(i === 5 ? 45 : 55);
        ax.visible = false;
        ax.renderOrder = 5;
        ax.material.depthTest = false;
        grp.add(ax);
        grp.userData.axes = ax;
        const lb = label(i === 0 ? 'KS0' : i === 5 ? 'KS5 (TCP)' : 'KS' + i, '#fff', 13);
        lb.position.set(14, 14, 14);
        lb.visible = false;
        grp.add(lb);
        grp.userData.label = lb;
      }
    }
    const cylZ = (r1, r2, h, mat, parent, pos, seg) => mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 40), mat, parent, pos, [Math.PI / 2, 0, 0], sh);
    const cylY = (r1, r2, h, mat, parent, pos, seg) => mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 40), mat, parent, pos, null, sh);
    // Frame 0: feste Basis
    cylZ(76, 80, 26, M.base, F[0], [0, 0, 13], 56);
    if (!isGhost) cylZ(77, 77, 3, M.ring, F[0], [0, 0, 27.5], 56);
    // Frame 1: Drehteller + Schulterlager (y1 = oben, z1 = Schulterachse)
    const yb = 29 - g.d1;
    cylY(60, 62, 14, M.base, F[1], [0, yb + 7, 0], 48);
    box(56, 48, 5, M.base, F[1], [0, yb + 14 + 24 - 10, 31], null, sh);
    box(56, 48, 5, M.base, F[1], [0, yb + 14 + 24 - 10, -31], null, sh);
    box(22, 44, 40, M.servo, F[1], [0, -14, 0], null, sh);
    cylZ(11, 11, 3, M.horn, F[1], [0, 0, 35]);
    cylZ(11, 11, 3, M.horn, F[1], [0, 0, -35]);
    // Frame 2: Oberarm (x2 zeigt von der Schulter zum Ellbogen, Ursprung im Ellbogen)
    box(g.a2 + 28, 26, 5, M.up, F[2], [-g.a2 / 2, 0, 27], null, sh);
    box(g.a2 + 28, 26, 5, M.up, F[2], [-g.a2 / 2, 0, -27], null, sh);
    box(10, 18, 50, M.up, F[2], [-g.a2 * 0.55, 0, 0], null, sh);
    box(42, 22, 40, M.servo, F[2], [-10, 0, 0], null, sh);
    cylZ(10, 10, 3, M.horn, F[2], [0, 0, 31]);
    cylZ(10, 10, 3, M.horn, F[2], [0, 0, -31]);
    // Frame 3: Unterarm
    box(g.a3 + 24, 22, 4, M.fore, F[3], [-g.a3 / 2, 0, 22], null, sh);
    box(g.a3 + 24, 22, 4, M.fore, F[3], [-g.a3 / 2, 0, -22], null, sh);
    box(10, 16, 40, M.fore, F[3], [-g.a3 * 0.55, 0, 0], null, sh);
    box(32, 17, 34, M.servo, F[3], [-8, 0, 0], null, sh);
    cylZ(8, 8, 3, M.horn, F[3], [0, 0, 25]);
    cylZ(8, 8, 3, M.horn, F[3], [0, 0, -25]);
    // Frame 4: Handgelenk (z4 = Werkzeugachse, y4 = Handgelenkachse)
    box(24, 4, 62, M.hand, F[4], [0, 19, 22], null, sh);
    box(24, 4, 62, M.hand, F[4], [0, -19, 22], null, sh);
    box(22, 30, 34, M.servo, F[4], [0, 0, 64], null, sh);
    // Frame 5: Greifer (rotiert mit M5), Ursprung = TCP
    const zb = -g.lTcp + 88;
    box(78, 36, 10, M.hand, F[5], [0, 0, zb], null, sh);
    box(30, 18, 30, M.servo, F[5], [22, 24, zb - 18], null, sh);
    const tipZ = g.lTip - g.lTcp;
    const fz0 = zb + 5,
      fl = tipZ - fz0;
    const fingers = [];
    for (const s of [-1, 1]) {
      const fg = new THREE.Group();
      F[5].add(fg);
      box(6, 22, fl, M.hand, fg, [0, 0, fz0 + fl / 2], null, sh);
      box(2.5, 18, 34, M.pad, fg, [-s * 4.2, 0, tipZ - 19], null, sh);
      fingers.push({ grp: fg, s });
    }
    let tcpMarker = null;
    if (!isGhost) {
      tcpMarker = mesh(new THREE.SphereGeometry(4.5, 18, 12), new THREE.MeshBasicMaterial({ color: 0xff7a00, depthTest: false }), F[5], [0, 0, 0], null, false);
      tcpMarker.renderOrder = 6;
    }
    return {
      root,
      F,
      fingers,
      tcpMarker,
      mats: M,
      setPose(Fr, jaw) {
        for (let i = 0; i < 6; i++) setMatrixRowMajor(F[i], Fr[i]);
        for (const f of fingers) f.grp.position.x = f.s * (jaw / 2 + 3);
      },
      highlight(state) {
        if (isGhost) return;
        const col = (s) => (s === 'viol' ? 0x9c0000 : s === 'warn' ? 0x7a4a00 : 0x000000);
        M.up.emissive.setHex(col(state['Oberarm']));
        M.fore.emissive.setHex(col(state['Unterarm']));
        M.hand.emissive.setHex(col(state['Greifer'] || state['Greiferfinger']));
      },
    };
  }


  // ------------------------------------------------------------------
  // Roboter-Modell aus STL-Geometrie (js/meshes.js)
  // ------------------------------------------------------------------
  let meshGeo = null;
  function b64(s, T) {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new T(u8.buffer);
  }
  /**
   * Dreiecksorientierung reparieren: die reduzierten STL-Netze sind (überwiegend) nach innen orientiert,
   * dadurch verwirft das Backface-Culling die Außenhaut und man blickt ins Innere (Basis wirkte durchsichtig).
   * Je Zusammenhangskomponente: Nachbardreiecke gegenläufig an der gemeinsamen Kante ausrichten,
   * dann über das Vorzeichen des eingeschlossenen Volumens nach außen drehen.
   */
  function fixWinding(pos, idx) {
    const nV = pos.length / 3;
    const canon = new Int32Array(nV);
    const seen = new Map();
    for (let i = 0; i < nV; i++) {
      const k = Math.round(pos[3 * i] * 1e3) + ',' + Math.round(pos[3 * i + 1] * 1e3) + ',' + Math.round(pos[3 * i + 2] * 1e3);
      let c = seen.get(k);
      if (c == null) seen.set(k, (c = i));
      canon[i] = c;
    }
    const nT = idx.length / 3;
    const V = (t, e) => canon[idx[3 * t + (e % 3)]];
    const edges = new Map();
    const ek = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
    for (let t = 0; t < nT; t++)
      for (let e = 0; e < 3; e++) {
        const a = V(t, e),
          b = V(t, e + 1);
        if (a === b) continue;
        const k = ek(a, b);
        const l = edges.get(k);
        if (l) l.push(t);
        else edges.set(k, [t]);
      }
    const dir = (t, a, b) => {
      for (let e = 0; e < 3; e++) {
        const p = V(t, e),
          q = V(t, e + 1);
        if (p === a && q === b) return 1;
        if (p === b && q === a) return -1;
      }
      return 0;
    };
    const flip = new Int8Array(nT),
      comp = new Int32Array(nT);
    let nc = 0;
    for (let s0 = 0; s0 < nT; s0++) {
      if (flip[s0]) continue;
      flip[s0] = 1;
      comp[s0] = nc;
      const st = [s0];
      while (st.length) {
        const t = st.pop();
        for (let e = 0; e < 3; e++) {
          const a = V(t, e),
            b = V(t, e + 1);
          const l = edges.get(ek(a, b));
          if (!l || l.length !== 2) continue; // nur eindeutige Kanten
          const u = l[0] === t ? l[1] : l[0];
          if (flip[u]) continue;
          flip[u] = dir(u, a, b) === -dir(t, a, b) * flip[t] ? 1 : -1;
          comp[u] = nc;
          st.push(u);
        }
      }
      nc++;
    }
    const vol = new Float64Array(nc);
    for (let t = 0; t < nT; t++) {
      const i0 = 3 * idx[3 * t];
      let i1 = 3 * idx[3 * t + 1],
        i2 = 3 * idx[3 * t + 2];
      if (flip[t] < 0) [i1, i2] = [i2, i1];
      const a0 = pos[i0], a1 = pos[i0 + 1], a2 = pos[i0 + 2];
      const b0 = pos[i1], b1 = pos[i1 + 1], b2 = pos[i1 + 2];
      const c0 = pos[i2], c1 = pos[i2 + 1], c2 = pos[i2 + 2];
      vol[comp[t]] += a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
    } // prettier-ignore
    const out = new idx.constructor(idx);
    for (let t = 0; t < nT; t++)
      if (flip[t] * (vol[comp[t]] < 0 ? -1 : 1) < 0) {
        const tmp = out[3 * t + 1];
        out[3 * t + 1] = out[3 * t + 2];
        out[3 * t + 2] = tmp;
      }
    return out;
  }
  function meshGeometries() {
    if (meshGeo) return meshGeo;
    const M = window.BS_MESHES;
    // Normalen glätten, Kanten über 35° bleiben scharf (statt Flat-Shading der reduzierten STL-Meshes)
    const crease = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.toCreasedNormals;
    const mk = (pos, idx) => {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(fixWinding(pos, idx), 1));
      if (crease) g = crease(g, (35 * Math.PI) / 180);
      else g.computeVertexNormals();
      g.computeBoundingSphere();
      return g;
    };
    /**
     * Teile der STL-Visuals auf die Drehachse von M5 zentrieren (nur Darstellung):
     * Die runde Greifer-Grundplatte (Drehteil, unterste ~10 mm des Greiferkörpers) liegt im Modell bei (6,1 | −5,7) mm,
     * die Abtriebswelle von M5 bei (4,75 | −0,39) mm neben der kinematischen Achse. Beide werden auf die Achse
     * verschoben – so sitzt das Drehteil mittig auf der Welle und dreht konzentrisch; Finger und TCP bleiben unverändert.
     */
    const centerOnAxis = (pos, idx, dx, dy, zSel) => {
      const out = pos.slice();
      const done = new Set();
      for (const i of idx) {
        if (done.has(i) || !zSel(pos[3 * i + 2])) continue;
        done.add(i);
        out[3 * i] += dx;
        out[3 * i + 1] += dy;
      }
      return out;
    };
    const part = (k, ik) => mk(b64(M[k].v, Float32Array), b64(M[k][ik || 'i'], Uint16Array));
    const gv = b64(M.grip.v, Float32Array);
    const gp = (k) => mk(gv, b64(M.grip[k], Uint16Array));
    const bodyIdx = b64(M.grip.iBody, Uint16Array);
    const gripBody = mk(centerOnAxis(gv, bodyIdx, -6.1, 5.7, (z) => z < -65.5), bodyIdx);
    const shaftIdx = b64(M.wrist.iShaft, Uint16Array);
    const wristShaft = mk(centerOnAxis(b64(M.wrist.v, Float32Array), shaftIdx, -4.75, 0.39, () => true), shaftIdx);
    meshGeo = {
      base: part('base'),
      link1: part('link1'),
      arm: part('arm'),
      armServo: part('arm', 'iServo'),
      armShaft: part('arm', 'iShaft'),
      wrist: part('wrist'),
      wristServo: part('wrist', 'iServo'),
      wristShaft,
      gripServo: gp('iServo'),
      gripBody,
      gripL: gp('iL'),
      gripR: gp('iR'),
      // Greifergetriebe: Zahnrad mit Kurbel, Schwinge, Fingerträger je Seite
      gearL: gp('iGearL'),
      gearR: gp('iGearR'),
      linkL: gp('iLinkL'),
      linkR: gp('iLinkR'),
      carL: gp('iCarL'),
      carR: gp('iCarR'),
      link: M.grip.link,
      w0: M.grip.w0,
    };
    return meshGeo;
  }

  /**
   * Sitz des Greifers auf der Abtriebswelle von M5 [mm]: In den STL-Visuals beginnt die runde Greifer-Grundplatte
   * bei 55,0 mm über der Handgelenkachse, das orange Handgelenkteil endet aber erst bei 60,7 mm (Welle bis 63,9 mm) –
   * ohne Versatz steckt der Greifer im Handgelenk. Nur Darstellung; die Kinematik (TCP, Fingerspitze) bleibt unverändert.
   */
  const GRIP_SEAT = 6.5;
  function buildMeshRobot(isGhost) {
    const G = meshGeometries();
    const root = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.22, depthWrite: false });
    // Kunststoffteile mit leichtem Klarlack-Glanz, Servos schwarz, Abtriebswellen weiß
    const plastic = (color, o) =>
      new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35, envMapIntensity: 0.45 }, o || {}));
    const orange = () => plastic(0xff5500);
    const M = isGhost
      ? { base: ghostMat, l1: ghostMat, up: ghostMat, fore: ghostMat, hand: ghostMat, grip: ghostMat, servo: ghostMat, shaft: ghostMat }
      : {
          base: orange(),
          l1: orange(),
          up: orange(),
          fore: orange(),
          hand: orange(),
          grip: plastic(0xaaaa7f, { roughness: 0.5, clearcoat: 0.15 }),
          servo: plastic(0x1c1d20, { roughness: 0.5, clearcoat: 0.2 }),
          shaft: plastic(0xf1f1ee, { roughness: 0.35, clearcoat: 0.1 }),
        };
    const F = [];
    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      grp.matrixAutoUpdate = false;
      root.add(grp);
      F.push(grp);
      if (!isGhost) addFrameHelpers(grp, i);
    }
    const add = (geo, mat, parent) => {
      const m = new THREE.Mesh(geo, mat);
      if (!isGhost) m.castShadow = m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    add(G.base, M.base, F[0]);
    add(G.link1, M.l1, F[1]);
    add(G.arm, M.up, F[2]);
    add(G.arm, M.fore, F[3]);
    add(G.wrist, M.hand, F[4]);
    // Servos (Ellbogen M3 im Oberarm, Handgelenk M4 im Unterarm, Handrotation M5) mit Abtriebswelle
    for (const i of [2, 3]) {
      add(G.armServo, M.servo, F[i]);
      add(G.armShaft, M.shaft, F[i]);
    }
    add(G.wristServo, M.servo, F[4]);
    add(G.wristShaft, M.shaft, F[4]);
    // Greiferflansch: KS5 der STL-Geometrie (d5), gegenüber dem TCP-System um −90° um z gedreht
    const flange = new THREE.Group();
    flange.matrixAutoUpdate = false;
    root.add(flange);
    add(G.gripBody, M.grip, flange);
    add(G.gripServo, M.servo, flange);
    // Drehgelenk um die x-Achse des Flanschs im Punkt (y, z); die Meshes liegen in Flanschkoordinaten
    const pivot = (pt, geos) => {
      const grp = new THREE.Group();
      grp.position.set(0, pt[0], pt[1]);
      for (const geo of geos) add(geo, M.grip, grp).position.set(0, -pt[0], -pt[1]);
      flange.add(grp);
      return grp;
    };
    const L = G.link;
    const gear = { L: pivot(L.gL, [G.gearL]), R: pivot(L.gR, [G.gearR]) };
    const rocker = { L: pivot(L.aL, [G.linkL]), R: pivot(L.aR, [G.linkR]) };
    // Fingerträger samt Finger: Bezugspunkt = Koppelpunkt c der Kurbel
    const carrier = { L: pivot(L.cL, [G.carL, G.gripL]), R: pivot(L.cR, [G.carR, G.gripR]) };
    // Schrauben, Gelenkstifte und Servokabel (js/details.js)
    const details = !isGhost && BS.details ? BS.details.buildRobotDetails({ root, F, flange, carrier, link: L }) : null;
    let tcpMarker = null;
    if (!isGhost) {
      tcpMarker = mesh(new THREE.SphereGeometry(4.5, 18, 12), new THREE.MeshBasicMaterial({ color: 0xff7a00, depthTest: false }), F[5], [0, 0, 0], null, false);
      tcpMarker.renderOrder = 6;
    }
    const off = new THREE.Matrix4(),
      tmp = new THREE.Matrix4();
    let lastJaw = null;
    return {
      root,
      F,
      tcpMarker,
      mats: M,
      details,
      setPose(Fr, jaw) {
        for (let i = 0; i < 6; i++) setMatrixRowMajor(F[i], Fr[i]);
        off.makeRotationZ(-Math.PI / 2).setPosition(0, 0, C.geom.d5 - C.geom.lTcp + GRIP_SEAT);
        tmp.copy(F[5].matrix).multiply(off);
        flange.matrix.copy(tmp);
        flange.matrixWorldNeedsUpdate = true;
        if (details) details.update();
        if (jaw !== lastJaw) {
          lastJaw = jaw;
          const s = BS.kin.gripLinkage(L, jaw);
          for (const k of ['L', 'R']) {
            gear[k].rotation.x = s[k].crank;
            rocker[k].rotation.x = s[k].rocker;
            carrier[k].position.set(0, s[k].c[0], s[k].c[1]);
            carrier[k].rotation.x = s[k].beta;
          }
        }
      },
      highlight(state) {
        if (isGhost) return;
        const col = (s) => (s === 'viol' ? 0x9c0000 : s === 'warn' ? 0x7a4a00 : 0x000000);
        M.up.emissive.setHex(col(state['Oberarm']));
        M.fore.emissive.setHex(col(state['Unterarm']));
        M.hand.emissive.setHex(col(state['Greifer'] || state['Greiferfinger']));
        M.grip.emissive.setHex(col(state['Greifer'] || state['Greiferfinger']));
      },
    };
  }

  function addFrameHelpers(grp, i) {
    const ax = new THREE.AxesHelper(i === 5 ? 45 : 55);
    ax.visible = false;
    ax.renderOrder = 5;
    ax.material.depthTest = false;
    grp.add(ax);
    grp.userData.axes = ax;
    const lb = label(i === 0 ? 'KS0' : i === 5 ? 'KS5 (TCP)' : 'KS' + i, '#fff', 13);
    lb.position.set(14, 14, 14);
    lb.visible = false;
    grp.add(lb);
    grp.userData.label = lb;
  }

  V.useStl = BS.store.get('useStl', true);
  V.hasStl = () => !!window.BS_MESHES;

  V.rebuildRobot = function () {
    if (robot) worldGroup.remove(robot.root);
    if (ghost) worldGroup.remove(ghost.root);
    const stl = V.useStl && V.hasStl();
    robot = stl ? buildMeshRobot(false) : buildRobot(false);
    ghost = stl ? buildMeshRobot(true) : buildRobot(true);
    ghost.root.visible = false;
    worldGroup.add(robot.root);
    worldGroup.add(ghost.root);
    applyFrameVisibility();
  };
  function applyFrameVisibility() {
    for (const f of robot.F) {
      f.userData.axes.visible = V.show.frames;
      f.userData.label.visible = V.show.frames && V.show.labels !== false;
    }
  }

  // ------------------------------------------------------------------
  // Szene
  // ------------------------------------------------------------------
  V.init = function (el) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    el.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    // Umgebungsbeleuchtung für Reflexe auf Kunststoff und Metall
    if (THREE.RoomEnvironment) {
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    camera = new THREE.PerspectiveCamera(40, 1, 5, 20000);
    camera.up.set(0, 0, 1);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    // Maus oder Rad während eines Rundflugs: Flug abbrechen und direkt die Zielansicht einnehmen
    const skipFly = () => flight && endFlight();
    renderer.domElement.addEventListener('pointerdown', skipFly);
    renderer.domElement.addEventListener('wheel', skipFly, { passive: true });
    V.setView('iso');

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7380, scene.environment ? 0.45 : 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.85);
    dl.position.set(350, -250, 900);
    dl.castShadow = true;
    dl.shadow.mapSize.set(2048, 2048);
    const sc = dl.shadow.camera;
    sc.left = -650;
    sc.right = 650;
    sc.top = 650;
    sc.bottom = -650;
    sc.near = 100;
    sc.far = 2000;
    dl.shadow.bias = -0.0004;
    dl.target.position.set(0, 150, 0);
    scene.add(dl, dl.target);
    const fill = new THREE.DirectionalLight(0xdbe4ff, 0.3);
    fill.position.set(-600, 500, 400);
    scene.add(fill);

    // Tisch
    const table = mesh(new THREE.BoxGeometry(1400, 1000, 20), std(0xe7e3da, { roughness: 0.9 }), worldGroup, [0, 150, -10.05], null, false);
    table.receiveShadow = true;
    table.name = 'table';
    V.table = table;
    const grid = new THREE.GridHelper(1300, 26, 0x9aa1aa, 0xc5c9cf);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 150, 0.15);
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    worldGroup.add(grid);
    V.world = worldGroup;
    V.grid = grid;
    V.std = std;
    V.mesh = mesh;
    // Weltachsen
    const axes = new THREE.Group();
    const arr = (dir, col, txt) => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(0, 0, 0.5), 140, col, 18, 9);
      axes.add(a);
      const l = label(txt, '#' + col.toString(16).padStart(6, '0'), 16);
      l.position.set(dir[0] * 160, dir[1] * 160, dir[2] * 160 + 4);
      axes.add(l);
    };
    arr([1, 0, 0], 0xe03131, 'x');
    arr([0, 1, 0], 0x2f9e44, 'y');
    arr([0, 0, 1], 0x1c7ed6, 'z');
    axes.position.set(-560, -250, 0);
    worldGroup.add(axes);
    // Maßstab-Beschriftung am Raster
    for (const r of [100, 200, 300, 400]) {
      const l = label(r + ' mm', '#dfe3e8', 11);
      l.position.set(r, -8, 2);
      l.material.opacity = 0.75;
      worldGroup.add(l);
    }

    // Steuerung (Gehäuse mit Nucleo-Board und Bedienfeld) neben der Basis; Kabel enden an ihren Buchsen
    if (BS.details) BS.details.buildController(worldGroup);
    V.rebuildRobot();

    // Spur
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 3), 3));
    tg.setDrawRange(0, 0);
    traceLine = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.85 }));
    traceLine.frustumCulled = false;
    worldGroup.add(traceLine);
    // Trajektorienvorschau
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20000 * 3), 3));
    pg.setDrawRange(0, 0);
    pathLine = new THREE.Line(pg, new THREE.LineDashedMaterial({ color: 0x15aabf, dashSize: 6, gapSize: 4 }));
    pathLine.frustumCulled = false;
    worldGroup.add(pathLine);

    // IK-Ziel
    ikTarget = new THREE.Group();
    const sph = mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd6336c, emissive: 0x5a0f2c }), ikTarget, [0, 0, 0], null, false);
    sph.name = 'ikTargetSphere';
    ikTarget.userData.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 60, 0xd6336c, 14, 8);
    ikTarget.add(ikTarget.userData.arrow);
    ikTarget.visible = false;
    worldGroup.add(ikTarget);
    tctrl = new THREE.TransformControls(camera, renderer.domElement);
    tctrl.setSize(0.8);
    tctrl.addEventListener('dragging-changed', (e) => (controls.enabled = !e.value));
    tctrl.addEventListener('objectChange', () => {
      const p = ikTarget.position;
      BS.emit('ikTargetDrag', { x: p.x, y: p.y, z: p.z });
    });
    scene.add(tctrl);

    markerGroup = new THREE.Group();
    worldGroup.add(markerGroup);
    V.rebuildMarkers();

    // Auswahl per Klick
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || tctrl.dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, V.viewName === 'greifer' ? camG : V.viewName === 'stativ' ? camT : camera);
      const objs = [...objMeshes.values()];
      const hit = rc.intersectObjects(objs, false)[0];
      if (hit) {
        BS.emit('pickObject', hit.object.userData.obj);
        return;
      }
      const th = rc.intersectObject(table, false)[0];
      if (th) BS.emit('pickTable', { x: th.point.x, y: th.point.y, z: 0, shift: e.shiftKey });
    });

    new ResizeObserver(() => V.resize()).observe(el);
    V.resize();
    V.setView('iso');
  };

  V.resize = function () {
    if (!renderer) return;
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  /** Ansichten (Tasten 1–8, 0); Roboter blickt in +y, „links“ ist also −x */
  V.VIEWS = [
    ['iso', 'Isometrisch', '1'],
    ['vorne', 'Vorne', '2'],
    ['hinten', 'Hinten', '3'],
    ['links', 'Seite links', '4'],
    ['rechts', 'Seite rechts', '5'],
    ['oben', 'Oben', '6'],
    ['stativ', 'Stativkamera', '7'],
    ['demo', 'Demo-Ansicht', '8'],
    ['greifer', 'Greiferkamera', '0'],
  ];
  const CAM_VIEWS = { greifer: 1, stativ: 1 }; // Ansichten aus einer festen Kamera (ohne Maussteuerung)

  /** Kamera-Rundflug: eine volle Umrundung des Roboters, die spiralförmig in der Zielansicht endet */
  const FLY_CENTER = [0, 140, 130]; // Blickpunkt zu Beginn (Roboter)
  let flight = null;
  function endFlight() {
    const f = flight;
    flight = null;
    camera.position.set(...f.pos);
    controls.target.set(...f.target);
    controls.enabled = true;
    controls.update();
  }
  function updateFlight() {
    const f = flight;
    const s = Math.min(1, (performance.now() - f.t0) / f.dur);
    const e = s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s); // sanft anfahren und abbremsen
    const tg = FLY_CENTER.map((c, i) => c + (f.target[i] - c) * e);
    const az = f.az - 2 * Math.PI * (1 - e); // gegen den Uhrzeigersinn um den Roboter
    const el = Math.min(1.35, f.el + 0.35 * Math.sin(Math.PI * e)); // unterwegs etwas höher …
    const r = f.r * (1 + 0.3 * Math.sin(Math.PI * e)); // … und weiter entfernt
    camera.position.set(tg[0] + r * Math.cos(el) * Math.cos(az), tg[1] + r * Math.cos(el) * Math.sin(az), tg[2] + r * Math.sin(el));
    controls.target.set(...tg);
    if (s >= 1) endFlight();
  }
  V.flying = () => !!flight;

  /** Freie Ansicht schrittweise bewegen (Controller): Umkreisen (rad), Zoomfaktor, seitliches Verschieben (Anteil der Entfernung) */
  V.moveCam = function (dAz, dEl, zoom, pan) {
    if (CAM_VIEWS[V.viewName]) return false;
    if (flight) endFlight();
    const t = controls.target,
      o = camera.position.clone().sub(t);
    const r = BS.clamp(o.length() * zoom, 150, 6000);
    const az = Math.atan2(o.y, o.x) + dAz;
    const el = BS.clamp(Math.asin(BS.clamp(o.z / o.length(), -1, 1)) + dEl, -0.15, 1.5);
    t.x += -Math.sin(az) * pan * r;
    t.y += Math.cos(az) * pan * r;
    camera.position.set(t.x + r * Math.cos(el) * Math.cos(az), t.y + r * Math.cos(el) * Math.sin(az), t.z + r * Math.sin(el));
    return true;
  };

  /** Ansicht einnehmen; mit { fly: true } per Rundflug um den Roboter */
  V.setView = function (name, opts) {
    flight = null;
    const views = {
      iso: [
        [760, -560, 600],
        [0, 140, 130],
      ],
      vorne: [
        [0, 1250, 260],
        [0, 100, 180],
      ],
      hinten: [
        [0, -900, 450],
        [0, 120, 150],
      ],
      links: [
        [-1250, 120, 260],
        [0, 120, 180],
      ],
      rechts: [
        [1250, 120, 260],
        [0, 120, 180],
      ],
      oben: [
        [0, 149, 1500],
        [0, 150, 0],
      ],
      // Ansicht 8 (Demo): von vorne links auf Band, Behälter und Roboter (aus einem Bildschirmfoto rekonstruiert)
      demo: [
        [-587, 718, 397],
        [-138, 66, 60],
      ],
    };
    if (name === 'seite') name = 'rechts';
    if (name === 'greifer' && !V.gripCam) {
      BS.toast('Greiferkamera ist deaktiviert (Panel „Umgebung“ → Kameras)', 'warn');
      name = V.viewName === 'greifer' ? 'iso' : V.viewName;
    }
    V.viewName = CAM_VIEWS[name] ? name : views[name] ? name : 'iso';
    BS.emit('view', V.viewName);
    if (CAM_VIEWS[V.viewName]) {
      controls.enabled = false;
      return;
    }
    controls.enabled = true;
    camera.up.set(0, 0, 1);
    const v = views[V.viewName];
    // bei schmalen Fenstern weiter herauszoomen, damit Roboter und Tisch sichtbar bleiben
    const f = Math.max(1, 1.6 / Math.max(0.3, camera.aspect || 1.6));
    const pos = [0, 1, 2].map((i) => v[1][i] + (v[0][i] - v[1][i]) * f);
    if (opts && opts.fly) {
      const d = pos.map((p, i) => p - v[1][i]);
      const r = Math.hypot(...d);
      flight = { pos, target: v[1].slice(), r, az: Math.atan2(d[1], d[0]), el: Math.asin(d[2] / r), t0: performance.now(), dur: opts.duration || 12000 };
      controls.enabled = false;
      updateFlight();
      controls.update();
      return;
    }
    camera.position.set(...pos);
    controls.target.set(...v[1]);
    controls.update();
  };

  // ------------------------------------------------------------------
  // Kameras: Greiferkamera, Stativkamera, Bild-im-Bild
  // ------------------------------------------------------------------
  const camG = window.THREE ? new THREE.PerspectiveCamera(72, 4 / 3, 4, 20000) : null;
  const camT = window.THREE ? new THREE.PerspectiveCamera(50, 4 / 3, 5, 20000) : null;
  /** Stativkamera: Standort (mm), Schwenk ψ um z (0° = Blick in +x), Neigung (negativ = nach unten), Brennweite als Öffnungswinkel */
  V.tripod = Object.assign({ x: 520, y: 560, z: 330, pan: -128, tilt: -27, fov: 50 }, BS.store.get('tripod', {}));
  V.pip = BS.store.get('pip', null); // Bild-im-Bild: null | 'greifer' | 'stativ'
  V.setPip = function (v) {
    V.pip = v || null;
    BS.store.set('pip', V.pip);
    BS.emit('pip', V.pip);
  };
  V.saveTripod = () => BS.store.set('tripod', V.tripod);
  /** Greiferkamera montiert (aus: kein Gehäuse am Greifer, keine Ansicht 0, kein Farbsensor) */
  V.gripCam = BS.store.get('gripCam', true);
  V.setGripCam = function (on) {
    V.gripCam = !!on;
    BS.store.set('gripCam', V.gripCam);
    if (!V.gripCam && V.viewName === 'greifer') V.setView('iso');
    BS.emit('pip', V.pip);
  };
  /** Standardpositionen der Stativkamera: Standort und Zielpunkt */
  V.TRIPOD_PRESETS = [
    ['ueberblick', 'Überblick vorne rechts', { x: 520, y: 560, z: 330, fov: 50 }, [0, 150, 60]],
    ['band', 'Förderband seitlich', { x: 420, y: 330, z: 190, fov: 48 }, [0, 200, 45]],
    ['bediener', 'Bedienerplatz hinter dem Roboter', { x: 40, y: -520, z: 430, fov: 52 }, [0, 140, 40]],
  ];
  V.setTripodPreset = function (key) {
    const p = V.TRIPOD_PRESETS.find((x) => x[0] === key);
    if (!p) return;
    Object.assign(V.tripod, p[2]);
    V.aimTripod(p[3]);
  };
  /** Stativkamera auf einen Punkt ausrichten */
  V.aimTripod = function (t) {
    const T = V.tripod;
    const d = [t[0] - T.x, t[1] - T.y, t[2] - T.z];
    T.pan = Math.round(Math.atan2(d[1], d[0]) * BS.R2D);
    T.tilt = Math.round(Math.atan2(d[2], Math.hypot(d[0], d[1])) * BS.R2D);
    V.saveTripod();
  };
  /** Stativkamera an die Stelle der aktuellen Maus-Ansicht setzen */
  V.tripodFromView = function () {
    const T = V.tripod;
    const p = camera.position,
      t = controls.target;
    Object.assign(T, { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(Math.max(20, p.z)) });
    V.aimTripod([t.x, t.y, t.z]);
  };

  /** Greiferkamera: seitlich am Greifer auf der vom Roboter abgewandten Seite (−y₅), blickt entlang der Werkzeugachse */
  function gripperCamPose() {
    const T = BS.sim.F && BS.sim.F[5];
    if (!T) return null;
    const p = [T[3], T[7], T[11]],
      x = [T[0], T[4], T[8]],
      y = [T[1], T[5], T[9]],
      z = [T[2], T[6], T[10]];
    const back = 92,
      off = 44; // mm hinter dem TCP, seitlich versetzt (quer zu den Backen)
    const pos = [0, 1, 2].map((i) => p[i] - z[i] * back - y[i] * off);
    return { pos, x, y, z, p };
  }
  function placeGripperCam(cam) {
    const g = gripperCamPose();
    if (!g) return;
    cam.position.set(...g.pos);
    cam.up.set(-g.y[0], -g.y[1], -g.y[2]); // oberer Bildrand zeigt vom Roboter weg
    cam.lookAt(g.p[0] + g.z[0] * 160, g.p[1] + g.z[1] * 160, g.p[2] + g.z[2] * 160);
  }
  function tripodDir() {
    const T = V.tripod;
    const pa = T.pan * BS.D2R,
      ti = T.tilt * BS.D2R;
    return [Math.cos(ti) * Math.cos(pa), Math.cos(ti) * Math.sin(pa), Math.sin(ti)];
  }
  function placeTripodCam(cam) {
    const T = V.tripod;
    const d = tripodDir();
    cam.position.set(T.x, T.y, T.z);
    cam.up.set(0, 0, 1);
    cam.lookAt(T.x + d[0] * 100, T.y + d[1] * 100, T.z + d[2] * 100);
    if (cam.fov !== T.fov) {
      cam.fov = T.fov;
      cam.updateProjectionMatrix();
    }
  }

  // sichtbare Kameras: Gehäuse am Greifer, Stativ mit Kamera
  let gripCamMesh = null,
    tripodMesh = null,
    tripodKey = '';
  function buildCamMeshes() {
    const dark = std(0x202327, { roughness: 0.45 }),
      lensM = std(0x0b0c0e, { roughness: 0.2, metalness: 0.4 }),
      glass = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.1, metalness: 0.6 });
    // Greiferkamera: Gehäuse blickt entlang lokal +z
    gripCamMesh = new THREE.Group();
    gripCamMesh.matrixAutoUpdate = false;
    box(22, 16, 18, dark, gripCamMesh, [0, 0, 0]);
    mesh(new THREE.CylinderGeometry(5.5, 6, 8, 20), lensM, gripCamMesh, [0, 0, 13], [Math.PI / 2, 0, 0]);
    mesh(new THREE.CircleGeometry(4.2, 20), glass, gripCamMesh, [0, 0, 17.1], null, false);
    box(8, 20, 6, std(0x8a9099), gripCamMesh, [0, 12, -4]); // Halter zum Greifer
    worldGroup.add(gripCamMesh);
    tripodMesh = new THREE.Group();
    worldGroup.add(tripodMesh);
  }
  function rebuildTripod() {
    const T = V.tripod;
    tripodMesh.clear();
    const legM = std(0x2b2f35, { roughness: 0.5, metalness: 0.3 }),
      dark = std(0x1d2024, { roughness: 0.45 }),
      lensM = std(0x0b0c0e, { roughness: 0.2, metalness: 0.4 });
    const head = [T.x, T.y, T.z - 26];
    const h = Math.max(30, head[2]);
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3 + 0.4;
      const foot = [T.x + Math.cos(a) * h * 0.38, T.y + Math.sin(a) * h * 0.38, 0];
      const va = new THREE.Vector3(...foot),
        vb = new THREE.Vector3(...head);
      const len = va.distanceTo(vb);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, len, 10), legM);
      leg.position.copy(va).add(vb).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      leg.castShadow = true;
      tripodMesh.add(leg);
    }
    mesh(new THREE.CylinderGeometry(9, 9, 16, 16), legM, tripodMesh, [head[0], head[1], head[2] + 4], [Math.PI / 2, 0, 0]);
    // Kamerakörper, zeigt entlang lokal +x
    const body = new THREE.Group();
    body.position.set(T.x, T.y, T.z);
    body.rotation.order = 'ZYX';
    body.rotation.set(0, -T.tilt * BS.D2R, T.pan * BS.D2R);
    box(46, 30, 32, dark, body, [0, 0, 0]);
    mesh(new THREE.CylinderGeometry(11, 12, 22, 24), lensM, body, [32, 0, 0], [0, 0, Math.PI / 2]);
    const lbl = label('Stativkamera', '#fff', 12);
    lbl.position.set(0, 0, 34);
    body.add(lbl);
    tripodMesh.add(body);
    tripodMesh.userData.body = body;
  }
  function syncCamMeshes() {
    if (!gripCamMesh) buildCamMeshes();
    const g = gripperCamPose();
    if (g) {
      // Basis wie KS5: Gehäuse sitzt auf −y₅, der Halter (lokal +y) zeigt zum Greifer, Blick entlang z₅
      const m = new THREE.Matrix4().set(g.x[0], g.y[0], g.z[0], g.pos[0], g.x[1], g.y[1], g.z[1], g.pos[1], g.x[2], g.y[2], g.z[2], g.pos[2], 0, 0, 0, 1);
      gripCamMesh.matrix.copy(m);
      gripCamMesh.matrixWorldNeedsUpdate = true;
    }
    const T = V.tripod;
    const key = [T.x, T.y, T.z, T.pan, T.tilt].join();
    if (key !== tripodKey) {
      tripodKey = key;
      rebuildTripod();
    }
    tripodMesh.visible = V.viewName === 'stativ' || V.pip === 'stativ' || !!T.show;
  }

  /** Bereich des Bild-im-Bild-Fensters in CSS-Pixeln (links/oben bezogen auf die 3D-Ansicht) */
  V.pipRect = function () {
    if (!V.pip || V.pip === V.viewName || !container || (V.pip === 'greifer' && !V.gripCam)) return null;
    const W = container.clientWidth,
      H = container.clientHeight;
    const w = Math.round(BS.clamp(W * (V.pipScale || 0.3), 200, 640));
    const h = Math.round(w * 0.75);
    const B = V.PIP_BORDER;
    return { x: W - w - 12 - B, y: H - h - 12 - B, w, h, W, H, title: V.pip === 'greifer' ? 'Greiferkamera' : 'Stativkamera' };
  };
  V.PIP_BORDER = 5; // Rahmenbreite des Bild-im-Bild-Fensters [px]

  // ------------------------------------------------------------------
  // Erkennung mit der Stativkamera: überwachter Bereich auf dem Tisch, Sichtprüfung, Markierungen
  // ------------------------------------------------------------------
  V.AREA_PRESETS = [
    ['wuerfel', 'Würfelfeld vor dem Roboter', { x: 0, y: 230, w: 560, h: 240 }],
    ['band', 'Bandende (Förderband)', { x: 0, y: 200, w: 140, h: 140 }],
    ['tisch', 'ganzer Arbeitsbereich', { x: 0, y: 150, w: 900, h: 600 }],
  ];
  if (!V.tripod.area) V.tripod.area = Object.assign({}, V.AREA_PRESETS[0][2]);
  V.setAreaPreset = function (key) {
    const p = V.AREA_PRESETS.find((x) => x[0] === key);
    if (!p) return;
    V.tripod.area = Object.assign({}, p[2]);
    V.saveTripod();
  };
  V.inArea = function (o) {
    const a = V.tripod.area;
    return Math.abs(o.M[3] - a.x) <= a.w / 2 && Math.abs(o.M[7] - a.y) <= a.h / 2;
  };
  const rcSee = window.THREE ? new THREE.Raycaster() : null;
  /** Sieht die Stativkamera das Objekt? (im Bildfeld und nicht vom Roboter oder anderen Objekten verdeckt) */
  V.tripodSees = function (o) {
    placeTripodCam(camT);
    camT.updateMatrixWorld();
    const c = new THREE.Vector3(o.M[3], o.M[7], o.M[11] + o.size[2] * 0.3);
    const ndc = c.clone().project(camT);
    if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return false;
    const from = camT.position.clone();
    const dir = c.clone().sub(from);
    const dist = dir.length();
    rcSee.set(from, dir.normalize());
    rcSee.camera = camT; // nötig für Sprites (Beschriftungen) im Strahlengang
    rcSee.far = dist - o.size[0] * 0.45;
    const blockers = [robot.root];
    for (const [id, m] of objMeshes) if (m.userData.obj !== o) blockers.push(m);
    if (staticsGroup) blockers.push(staticsGroup);
    if (conveyorGroup) blockers.push(conveyorGroup);
    return !rcSee.intersectObjects(blockers, true).some((h) => h.object.isMesh && h.object.visible);
  };
  let detectGroup = null,
    areaKey = '';
  const detMarks = new Map();
  /** Bereich und erkannte Würfel im 3D-Bild markieren (Liste aus BS.auto.tripodDetect) */
  V.syncDetect = function (list) {
    if (!detectGroup) {
      detectGroup = new THREE.Group();
      worldGroup.add(detectGroup);
    }
    const T = V.tripod,
      on = !!T.detect;
    detectGroup.visible = on;
    if (!on) return;
    const a = T.area;
    const key = [a.x, a.y, a.w, a.h].join();
    if (key !== areaKey) {
      areaKey = key;
      if (detectGroup.userData.area) detectGroup.remove(detectGroup.userData.area);
      const g = new THREE.Group();
      const z = 1.2;
      const pts = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ].map(([u, v]) => new THREE.Vector3(a.x + (u * a.w) / 2, a.y + (v * a.h) / 2, z));
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x7048e8, dashSize: 10, gapSize: 6 }));
      ln.computeLineDistances();
      g.add(ln);
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.h), new THREE.MeshBasicMaterial({ color: 0x7048e8, transparent: true, opacity: 0.06, depthWrite: false }));
      fill.position.set(a.x, a.y, z - 0.4);
      g.add(fill);
      const lb = label('Überwachter Bereich (Stativkamera)', '#d0bfff', 12);
      lb.position.set(a.x, a.y - a.h / 2 - 14, 4);
      g.add(lb);
      detectGroup.add(g);
      detectGroup.userData.area = g;
    }
    // Markierungen: Rahmen um jeden erkannten Würfel, Beschriftung mit der erkannten Farbe
    const seen = new Set();
    for (const d of list || []) {
      const o = d.obj;
      seen.add(o.id);
      let m = detMarks.get(o.id);
      if (m && m.userData.name !== d.name) {
        detectGroup.remove(m);
        m = null;
      }
      if (!m) {
        m = new THREE.Group();
        const s = o.size[0] + 8;
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, o.size[2] + 8)), new THREE.LineBasicMaterial({ color: 0x9775fa })));
        const lb = label(d.name, '#ffffff', 10);
        lb.position.set(0, 0, o.size[2] / 2 + 14);
        m.add(lb);
        m.userData.name = d.name;
        detectGroup.add(m);
        detMarks.set(o.id, m);
      }
      m.position.set(o.M[3], o.M[7], o.M[11]);
      m.rotation.set(0, 0, Math.atan2(o.M[4], o.M[0]));
    }
    for (const [id, m] of detMarks)
      if (!seen.has(id)) {
        detectGroup.remove(m);
        detMarks.delete(id);
      }
  };

    // ------------------------------------------------------------------
  // Synchronisation mit der Simulation
  // ------------------------------------------------------------------
  V.sync = function () {
    const sim = BS.sim;
    if (!sim.F) sim.updateKinematics();
    robot.setPose(sim.F, sim.jawWidth());
    robot.highlight(BS.monitor.linkState || {});
    robot.tcpMarker.visible = V.show.tcp;
    // Ghost
    if (V.ghostPose) {
      ghost.root.visible = true;
      const m = V.ghostPose;
      ghost.setPose(BS.kin.frames(m), sim.jawFromAngle(m[5] != null ? m[5] : sim.cmd[5]));
    } else ghost.root.visible = false;
    // Spur
    traceLine.visible = V.show.trace;
    if (sim.traceDirty) {
      sim.traceDirty = false;
      const a = traceLine.geometry.attributes.position;
      const n = Math.min(sim.trace.length, 4000);
      for (let i = 0; i < n; i++) a.setXYZ(i, sim.trace[i][0], sim.trace[i][1], sim.trace[i][2]);
      a.needsUpdate = true;
      traceLine.geometry.setDrawRange(0, n);
      traceLine.geometry.computeBoundingSphere();
    }
    pathLine.visible = V.show.path;
    syncObjects();
    syncTargets();
    syncZones();
    syncConveyor();
    syncStatics();
    syncBinTags();
    if (BS.details && BS.details.updateController) BS.details.updateController();
    markerGroup.visible = V.show.markers;
    if (wsPlane) {
      wsPlane.visible = V.show.wsPlane;
      const a = sim.act[0] * BS.D2R + (sim.errOn ? sim.errOff[0] * BS.D2R : 0);
      wsPlane.rotation.set(0, 0, a);
    }
    if (wsHull) wsHull.visible = V.show.wsHull;
    for (const fn of V.onSync) fn();
  };

  function syncObjects() {
    const sim = BS.sim;
    const seen = new Set();
    for (const o of sim.objects) {
      seen.add(o.id);
      let m = objMeshes.get(o.id);
      const key = o.size.join('x') + o.color;
      if (m && m.userData.key !== key) {
        worldGroup.remove(m);
        objMeshes.delete(o.id);
        m = null;
      }
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2]), std(o.color, { roughness: 0.55 }));
        m.castShadow = m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.userData = { obj: o, key };
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffffff }));
        edges.visible = false;
        m.add(edges);
        m.userData.edges = edges;
        worldGroup.add(m);
        objMeshes.set(o.id, m);
      }
      m.userData.obj = o;
      setMatrixRowMajor(m, o.M);
      m.userData.edges.visible = V.selected === o;
    }
    for (const [id, m] of objMeshes)
      if (!seen.has(id)) {
        worldGroup.remove(m);
        objMeshes.delete(id);
      }
  }

  function syncTargets() {
    const sim = BS.sim;
    const seen = new Set();
    for (const t of sim.targets) {
      seen.add(t.id);
      let g = targetMeshes.get(t.id);
      const key = [t.x, t.y, t.z, t.w, t.h, t.color, t.name].join();
      if (g && g.userData.key !== key) {
        worldGroup.remove(g);
        g = null;
      }
      if (!g) {
        g = new THREE.Group();
        g.userData.key = key;
        const tz = t.z || 0.4;
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(t.w, t.h), new THREE.MeshBasicMaterial({ color: t.color, transparent: true, opacity: 0.22, depthWrite: false }));
        pl.position.set(t.x, t.y, tz);
        g.add(pl);
        const pts = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1],
        ].map(([a, b]) => new THREE.Vector3(t.x + (a * t.w) / 2, t.y + (b * t.h) / 2, tz + 0.2));
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: t.color })));
        if (!t.noLabel) {
          const lb = label(t.name, '#fff', 13);
          lb.position.set(t.x, t.y - t.h / 2 - 12, 4);
          g.add(lb);
        }
        worldGroup.add(g);
        targetMeshes.set(t.id, g);
      }
    }
    for (const [id, g] of targetMeshes)
      if (!seen.has(id)) {
        worldGroup.remove(g);
        targetMeshes.delete(id);
      }
  }

  function syncZones() {
    const sim = BS.sim;
    const seen = new Set();
    for (const z of sim.zones) {
      seen.add(z.id);
      let g = zoneMeshes.get(z.id);
      const key = [...z.c, ...z.s, z.type, z.name].join();
      if (g && g.userData.key !== key) {
        worldGroup.remove(g);
        g = null;
      }
      if (!g) {
        g = new THREE.Group();
        g.userData.key = key;
        const geo = new THREE.BoxGeometry(z.s[0], z.s[1], z.s[2]);
        const mat = new THREE.MeshBasicMaterial({ color: z.type === 'allowed' ? 0x2f9e44 : 0xe03131, transparent: true, opacity: z.type === 'allowed' ? 0.04 : 0.14, depthWrite: false });
        const m = new THREE.Mesh(geo, mat);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: z.type === 'allowed' ? 0x2f9e44 : 0xe03131 }));
        g.add(m, e);
        g.position.set(...z.c);
        const lb = label(z.name, z.type === 'allowed' ? '#8ce99a' : '#ffa8a8', 13);
        lb.position.set(0, 0, z.s[2] / 2 + 12);
        g.add(lb);
        g.userData.mat = mat;
        g.userData.edge = e.material;
        worldGroup.add(g);
        zoneMeshes.set(z.id, g);
      }
      g.visible = V.show.zones;
      const st = BS.monitor.zoneState[z.id];
      const base = z.type === 'allowed' ? 0x2f9e44 : 0xe03131;
      const col = st === 'viol' ? 0xff0000 : st === 'warn' ? 0xf59f00 : base;
      g.userData.mat.color.setHex(col);
      g.userData.mat.opacity = st ? 0.3 : z.type === 'allowed' ? 0.04 : 0.14;
      g.userData.edge.color.setHex(col);
    }
    for (const [id, g] of zoneMeshes)
      if (!seen.has(id)) {
        worldGroup.remove(g);
        zoneMeshes.delete(id);
      }
  }

  /** Feste Quader mit Farbe (z. B. Auffangbehälter); ohne Farbe zeichnet sie die jeweilige Szene selbst */
  function syncStatics() {
    const st = BS.sim.statics;
    const key = st.map((b) => [b.c, b.s, b.color].join()).join('|');
    if (staticsGroup && staticsRef === key) return;
    if (staticsGroup) worldGroup.remove(staticsGroup);
    staticsGroup = new THREE.Group();
    staticsRef = key;
    for (const b of st) {
      if (!b.color) continue;
      const m = box(b.s[0], b.s[1], b.s[2], std(b.color, { roughness: 0.7 }), staticsGroup, b.c);
      m.castShadow = b.s[2] > 6;
      if (b.label) {
        const lb = label(b.label, '#fff', 13);
        lb.position.set(b.c[0], b.c[1], b.labelZ || b.c[2] + b.s[2] / 2 + 14);
        staticsGroup.add(lb);
      }
    }
    worldGroup.add(staticsGroup);
  }

  /**
   * Farbschilder auf der in +y weisenden Außenwand der Auffangbehälter: je zugeordneter Farbe ein Plättchen.
   * Die Zuordnung (Panel bzw. Reiter Förderband) kann sich jederzeit ändern – dann werden sie neu aufgebaut.
   */
  let binTagGroup = null,
    binTagKey = '';
  function syncBinTags() {
    const sim = BS.sim;
    const bins = sim.targets.filter((t) => t.bin);
    const tags = bins.map((t) => {
      const a = typeof t.accept === 'function' ? t.accept() : t.accept || [];
      return (Array.isArray(a) ? a : [a]).filter((c) => typeof c === 'string' && c.startsWith('#'));
    });
    const key = bins.map((t, i) => [t.x, t.y, t.w, t.hw, ...tags[i]].join()).join('|');
    if (key === binTagKey) return;
    binTagKey = key;
    if (binTagGroup) worldGroup.remove(binTagGroup);
    binTagGroup = new THREE.Group();
    const S = 15, GAP = 5, T = 1.2; // Kantenlänge, Abstand, Dicke [mm]
    const frame = new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.6 });
    bins.forEach((t, i) => {
      const cols = tags[i];
      if (!cols.length) return;
      const yFace = t.y + t.h / 2 + 5; // Außenseite der +y-Wand (Wandstärke 5 mm)
      const z = t.hw * 0.55;
      const total = cols.length * S + (cols.length - 1) * GAP;
      cols.forEach((c, k) => {
        const x = t.x - total / 2 + S / 2 + k * (S + GAP);
        box(S + 3, T, S + 3, frame, binTagGroup, [x, yFace + T / 2, z], null, false); // weißer Rand
        box(S, T, S, std(c, { roughness: 0.45 }), binTagGroup, [x, yFace + T + T / 2, z], null, false);
      });
    });
    worldGroup.add(binTagGroup);
  }

  let convKey = null;
  function syncConveyor() {
    const cv = BS.sim.conveyor;
    const key = cv ? [cv.x, cv.yStart, cv.yEnd, cv.width, cv.height].join() : null;
    if (key !== convKey) {
      if (conveyorGroup) worldGroup.remove(conveyorGroup);
      conveyorGroup = null;
      convKey = key;
      if (cv) {
        const g = new THREE.Group();
        const len = cv.yStart - cv.yEnd + 30;
        const cy = (cv.yStart + cv.yEnd) / 2 + 15;
        box(cv.width + 16, len, cv.height - 4, std(0x868e96), g, [cv.x, cy, (cv.height - 4) / 2]);
        box(cv.width, len, 4, std(0x343a40, { roughness: 0.95 }), g, [cv.x, cy, cv.height - 2]);
        box(cv.width + 20, 8, cv.height + 22, std(0x868e96), g, [cv.x, cv.yEnd - 4, (cv.height + 22) / 2]); // Anschlag
        const postMat = std(0x495057);
        const beams = [];
        for (const side of [-1, 1]) {
          const px = cv.x + side * (cv.width / 2 + 16);
          mesh(new THREE.CylinderGeometry(4, 4, cv.lsZ + 14, 16), postMat, g, [px, cv.lsY, (cv.lsZ + 14) / 2], [Math.PI / 2, 0, 0]);
        }
        for (const z of [cv.lsZ]) {
          const pts = [new THREE.Vector3(cv.x - cv.width / 2 - 16, cv.lsY, z), new THREE.Vector3(cv.x + cv.width / 2 + 16, cv.lsY, z)];
          const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x40c057 }));
          g.add(ln);
          beams.push(ln);
        }
        const lb = label('Förderband', '#fff', 13);
        lb.position.set(cv.x, cv.yStart + 30, cv.height + 10);
        g.add(lb);
        const l2 = label('Lichtschranke', '#fff', 11);
        l2.position.set(cv.x + cv.width / 2 + 40, cv.lsY, cv.lsZ + 18);
        g.add(l2);
        g.userData.beams = beams;
        worldGroup.add(g);
        conveyorGroup = g;
      }
    }
    if (conveyorGroup && cv) {
      conveyorGroup.userData.beams[0].material.color.setHex(cv.lsState ? 0xff2020 : 0x40c057);
    }
  }

  V.rebuildMarkers = function () {
    markerGroup.clear();
    const pinMat = std(0x868e96),
      ballMat = new THREE.MeshStandardMaterial({ color: 0xfab005, emissive: 0x4a3200 });
    for (const mk of BS.sim.markers) {
      const [x, y, z] = mk.p;
      mesh(new THREE.CylinderGeometry(2, 2, z - 5, 10), pinMat, markerGroup, [x, y, (z - 5) / 2], [Math.PI / 2, 0, 0]);
      mesh(new THREE.SphereGeometry(5, 18, 12), ballMat, markerGroup, [x, y, z]);
      const lb = label(mk.name, '#ffe066', 13);
      lb.position.set(x, y, z + 16);
      markerGroup.add(lb);
    }
  };

  // ------------------------------------------------------------------
  // IK-Ziel, Pfadvorschau, Arbeitsraum
  // ------------------------------------------------------------------
  V.setIkTarget = function (t, psi, visible) {
    ikTarget.visible = !!visible;
    if (!t) return;
    ikTarget.position.set(t.x, t.y, t.z);
    if (psi != null) {
      const az = Math.atan2(t.y, t.x);
      const p = psi * BS.D2R;
      const dir = new THREE.Vector3(Math.cos(p) * Math.cos(az), Math.cos(p) * Math.sin(az), Math.sin(p));
      ikTarget.userData.arrow.setDirection(dir.normalize());
      ikTarget.userData.arrow.visible = true;
    } else ikTarget.userData.arrow.visible = false;
  };
  V.setTargetDrag = function (on) {
    if (on) {
      ikTarget.visible = true;
      tctrl.attach(ikTarget);
    } else tctrl.detach();
  };

  V.setPath = function (xyz) {
    const a = pathLine.geometry.attributes.position;
    const n = xyz ? Math.min(xyz.length, 20000) : 0;
    for (let i = 0; i < n; i++) a.setXYZ(i, xyz[i][0], xyz[i][1], xyz[i][2]);
    a.needsUpdate = true;
    pathLine.geometry.setDrawRange(0, n);
    pathLine.computeLineDistances();
    pathLine.geometry.computeBoundingSphere();
  };

  V.clearTrace = function () {
    BS.sim.trace = [];
    BS.sim.traceDirty = true;
  };

  /** Arbeitsraum-Schnitt als Textur in der Armebene + Rotationshülle */
  V.setWorkspace = function (ws) {
    if (wsPlane) worldGroup.remove(wsPlane);
    if (wsHull) worldGroup.remove(wsHull);
    wsPlane = wsHull = null;
    if (!ws) return;
    const c = document.createElement('canvas');
    c.width = ws.nr;
    c.height = ws.nz;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(ws.nr, ws.nz);
    for (let iz = 0; iz < ws.nz; iz++)
      for (let ir = 0; ir < ws.nr; ir++) {
        const v = ws.grid[iz * ws.nr + ir];
        const o = ((ws.nz - 1 - iz) * ws.nr + ir) * 4;
        if (v === 1) {
          img.data[o] = 64;
          img.data[o + 1] = 192;
          img.data[o + 2] = 87;
          img.data[o + 3] = 150;
        } else if (v === 2) {
          img.data[o] = 253;
          img.data[o + 1] = 126;
          img.data[o + 2] = 20;
          img.data[o + 3] = 120;
        }
      }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    const W = ws.r1 - ws.r0,
      H = ws.z1 - ws.z0;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    // Ebene: lokales x = radial, lokales y = z (Welt)
    pl.rotation.x = Math.PI / 2;
    pl.position.set((ws.r0 + ws.r1) / 2, 0, (ws.z0 + ws.z1) / 2);
    wsPlane = new THREE.Group();
    wsPlane.add(pl);
    worldGroup.add(wsPlane);
    // Hülle: äußere Reichweite je Höhe (vorne)
    const prof = [];
    for (let iz = 0; iz < ws.nz; iz++) {
      let rmax = -1;
      for (let ir = ws.nr - 1; ir >= 0; ir--) {
        const r = ws.r0 + (ir + 0.5) * ws.cell;
        if (r < 0) break;
        if (ws.grid[iz * ws.nr + ir] === 1) {
          rmax = r;
          break;
        }
      }
      if (rmax > 0) prof.push(new THREE.Vector2(rmax, ws.z0 + (iz + 0.5) * ws.cell));
    }
    if (prof.length > 2) {
      const pts = [new THREE.Vector2(0, prof[0].y), ...prof, new THREE.Vector2(0, prof[prof.length - 1].y)];
      const geo = new THREE.LatheGeometry(pts, 72);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x40c057, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = Math.PI / 2;
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.LatheGeometry(pts.filter((_, i) => i % 6 === 0), 36)), new THREE.LineBasicMaterial({ color: 0x2f9e44, transparent: true, opacity: 0.25 }));
      wire.rotation.x = Math.PI / 2;
      wsHull = new THREE.Group();
      wsHull.add(m, wire);
      worldGroup.add(wsHull);
    }
  };

  V.cam = () => ({ camera, controls });

  V.applyShow = function () {
    const on = V.show.labels !== false;
    for (const sp of labelSprites) sp.visible = on;
    applyFrameVisibility(); // KS-Beschriftungen zusätzlich nur bei eingeblendeten KS
  };

  let pipLabel = null;
  V.render = function () {
    syncCamMeshes();
    const W = container.clientWidth,
      H = container.clientHeight;
    // Hauptansicht
    let main = camera;
    if (V.viewName === 'greifer') (main = camG), placeGripperCam(camG);
    else if (V.viewName === 'stativ') (main = camT), placeTripodCam(camT);
    else {
      camera.up.set(0, 0, 1);
      if (flight) updateFlight();
      controls.update();
    }
    if (main !== camera && Math.abs(main.aspect - W / H) > 1e-3) {
      main.aspect = W / H;
      main.updateProjectionMatrix();
    }
    gripCamMesh.visible = V.gripCam && V.viewName !== 'greifer';
    if (V.viewName === 'stativ' && tripodMesh.userData.body) tripodMesh.userData.body.visible = false;
    const tcpOn = robot.tcpMarker.visible,
      traceOn = traceLine.visible;
    if (main !== camera) robot.tcpMarker.visible = traceLine.visible = false; // Kamerabilder ohne TCP-Marker und Spur
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, main);
    robot.tcpMarker.visible = tcpOn;
    traceLine.visible = traceOn;
    if (tripodMesh.userData.body) tripodMesh.userData.body.visible = true;
    gripCamMesh.visible = V.gripCam;
    // Bild im Bild
    const r = V.pipRect();
    if (r) {
      const cam = V.pip === 'greifer' ? camG : camT;
      if (V.pip === 'greifer') placeGripperCam(camG);
      else placeTripodCam(camT);
      if (Math.abs(cam.aspect - r.w / r.h) > 1e-3) {
        cam.aspect = r.w / r.h;
        cam.updateProjectionMatrix();
      }
      if (V.pip === 'greifer') gripCamMesh.visible = false;
      else if (tripodMesh.userData.body) tripodMesh.userData.body.visible = false;
      robot.tcpMarker.visible = traceLine.visible = false;
      const yb = H - r.y - r.h; // WebGL: Ursprung unten links
      renderer.setScissorTest(true);
      renderer.setScissor(r.x, yb, r.w, r.h);
      renderer.setViewport(r.x, yb, r.w, r.h);
      renderer.setClearColor(document.documentElement.dataset.theme === 'light' ? 0xe9e9e4 : 0x9ea8b4, 1);
      renderer.render(scene, cam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      renderer.setClearColor(0x000000, 0);
      robot.tcpMarker.visible = tcpOn;
      traceLine.visible = traceOn;
      gripCamMesh.visible = V.gripCam;
      if (tripodMesh.userData.body) tripodMesh.userData.body.visible = true;
    }
    // Beschriftung des Bild-im-Bild-Fensters
    if (!pipLabel) {
      pipLabel = document.createElement('div');
      pipLabel.className = 'pip-frame';
      pipLabel.innerHTML = '<span class="pip-title"></span>';
      container.appendChild(pipLabel);
    }
    pipLabel.style.display = r ? '' : 'none';
    if (r) {
      const B = V.PIP_BORDER;
      pipLabel.firstChild.textContent = r.title;
      Object.assign(pipLabel.style, { left: r.x - B + 'px', top: r.y - B + 'px', width: r.w + 2 * B + 'px', height: r.h + 2 * B + 'px' });
    }
  };
  /** Zeichenfläche der 3D-Ansicht (für die Videoaufnahme direkt nach render() auslesen) */
  V.canvas = () => renderer && renderer.domElement;
})();
