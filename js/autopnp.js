/* BraccioSim – Automatik: Pick-and-Place-Abläufe, Farbsensor am Greifer
 *  - pickPlace: über dem Objekt positionieren → absenken → greifen → anheben → über dem Ziel öffnen
 *  - Farb-Sortierung: Würfel anfahren, Farbe mit dem Sensor bestimmen, je nach Zuordnung links/rechts ablegen oder liegen lassen
 *  - Förderband: auf Würfel an der Lichtschranke warten, Farbe mit dem Sensor bestimmen, in den Behälter legen
 * Alle Bewegungen sind PTP-Fahrten (sim.moveTo) und laufen in Simulationszeit (Pause, Tempo, Bewegungs-Halt wirken mit).
 */
(function () {
  'use strict';
  const BS = window.BS;
  const C = BS.config;

  const A = (BS.auto = {
    source: BS.store.get('detectSource', 'greifer'), // Farberkennung mit 'greifer' (Greiferkamera) oder 'stativ' (Stativkamera)
    detected: [],
    running: false,
    job: '',
    status: 'bereit',
    count: { links: 0, rechts: 0, liegen: 0 },
    log: [],
  });

  class Stop extends Error {}
  let token = null,
    pending = null;
  const waiters = new Set();

  function logMsg(msg) {
    A.log.unshift({ t: BS.sim.t, msg });
    if (A.log.length > 80) A.log.length = 80;
    BS.emit('autolog');
  }
  function check() {
    if (!token || token.cancel) throw new Stop('abgebrochen');
  }

  // ------------------------------------------------------------------
  // Grundbausteine (Promise-basiert, Simulationszeit)
  // ------------------------------------------------------------------
  function move(m, label, speed) {
    check();
    const sim = BS.sim;
    return new Promise((res, rej) => {
      const p = { res, rej, plan: null };
      pending = p;
      const ok = sim.moveTo(m, {
        label: 'Automatik · ' + label,
        speed: speed || 80,
        onEnd: () => {
          if (pending === p) pending = null;
          res();
        },
      });
      if (!ok) {
        pending = null;
        rej(new Error('Bewegung nicht möglich'));
        return;
      }
      p.plan = sim.play && sim.play.plan;
      A.status = label;
    });
  }
  // Bewegung von außen unterbrochen (Stopp-Knopf, Tastatur, andere Trajektorie) → Ablauf beenden
  BS.on('owner', () => {
    const p = pending;
    if (!p) return;
    setTimeout(() => {
      if (pending === p && (!BS.sim.play || BS.sim.play.plan !== p.plan)) A.stop('Bewegung unterbrochen');
    }, 0);
  });

  /** Warten, bis cond() erfüllt ist (oder timeout s Simulationszeit vergangen sind; ruht beim Bewegungs-Halt) */
  function until(cond, timeout) {
    check();
    const sim = BS.sim;
    return new Promise((res, rej) => {
      let el = 0;
      const w = { rej, done: false };
      const fn = (dt) => {
        if (w.done || sim.hold) return;
        el += dt;
        if (cond() || (timeout != null && el >= timeout)) {
          w.done = true;
          waiters.delete(w);
          queueMicrotask(() => {
            const i = sim.preStep.indexOf(fn);
            if (i >= 0) sim.preStep.splice(i, 1);
          });
          res();
        }
      };
      w.fn = fn;
      waiters.add(w);
      sim.preStep.push(fn);
    });
  }
  const wait = (s) => until(() => false, s);

  // ------------------------------------------------------------------
  // Kinematik-Hilfen
  // ------------------------------------------------------------------
  const ikAt = (t, psiPref, cur) => BS.kin.ikAuto(t, C.geom, { psiPref: psiPref != null ? psiPref : -90, cur });

  /** Handrotation M5, bei der die Backen quer zu zwei Seitenflächen des Objekts stehen (kleinste Greifbreite) */
  function bestM5(m4, o) {
    let best = null;
    for (let a = 0; a <= 180; a += 1) {
      const T = BS.kin.frames([m4[0], m4[1], m4[2], m4[3], a, 73])[5];
      const w = 2 * BS.sim.halfExtent(o, [T[0], T[4], T[8]]);
      const score = w + Math.abs(a - 90) * 1e-3;
      if (!best || score < best.score) best = { a, w, score };
    }
    return best;
  }
  A.bestM5 = bestM5;

  /**
   * Anfahrt an ein Objekt: Greifpose in der Objektmitte und Vorposition dist mm davor auf der Werkzeugachse.
   * ψ so steil wie möglich (ab −90° = senkrecht von oben); weiter außen liegende Objekte werden schräg angefahren.
   */
  function approach(o, cur, dist) {
    dist = dist || 60;
    const c = { x: o.M[3], y: o.M[7], z: o.M[11] };
    const az = Math.atan2(c.y, c.x);
    for (let psi = -90; psi <= 0; psi += 2) {
      const grip = BS.kin.ikBest(c, psi, C.geom, cur);
      if (!grip) continue;
      const u = [Math.cos(psi * BS.D2R) * Math.cos(az), Math.cos(psi * BS.D2R) * Math.sin(az), Math.sin(psi * BS.D2R)];
      const pre = BS.kin.ikBest({ x: c.x - u[0] * dist, y: c.y - u[1] * dist, z: c.z - u[2] * dist }, psi, C.geom, cur);
      if (pre) return { psi, grip, pre, axial: true };
    }
    // Rückfallebene (nahe an der Basis, enge Gelenkgrenzen): Vorposition senkrecht über der Greifpose
    for (let psi = -90; psi <= 0; psi += 1) {
      const grip = BS.kin.ikBest(c, psi, C.geom, cur);
      if (!grip) continue;
      const pre = ikAt({ x: c.x, y: c.y, z: c.z + dist }, psi, cur);
      if (pre) return { psi, grip, pre, axial: false };
    }
    return null;
  }

  /** Warteposition über dem Arbeitsbereich (Werkzeug nach unten) */
  function waitPose() {
    const s = ikAt({ x: 0, y: 170, z: 170 }, -90, BS.sim.cmd);
    return s ? [...s.m, 90, 10] : [90, 90, 90, 90, 90, 10];
  }

  // ------------------------------------------------------------------
  // Farbsensor (Kamera am Greifer, blickt entlang der Werkzeugachse)
  // ------------------------------------------------------------------
  function hexToHsv(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255,
      g = ((n >> 8) & 255) / 255,
      b = (n & 255) / 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      d = mx - mn;
    let h = 0;
    if (d > 1e-9) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: mx ? d / mx : 0, v: mx };
  }
  /** Farbklassifikation über den Farbton H (HSV); geringe Sättigung → keine Farbe */
  A.classify = function (hex) {
    const c = hexToHsv(hex);
    let key = null;
    if (c.s >= 0.35 && c.v >= 0.25) {
      if (c.h < 20 || c.h >= 330) key = 'rot';
      else if (c.h >= 35 && c.h < 75) key = 'gelb';
      else if (c.h >= 80 && c.h < 170) key = 'gruen';
      else if (c.h >= 185 && c.h < 260) key = 'blau';
    }
    const col = BS.sim.SORT_COLORS.find((x) => x.key === key);
    return { key, name: col ? col.name : 'unbekannt', h: c.h, s: c.s, v: c.v, hex };
  };
  /** Objekt im Sichtkegel der Greiferkamera (Abstand zur Werkzeugachse < 22 mm, 0…250 mm voraus) */
  A.sense = function () {
    const sim = BS.sim;
    if (BS.view && !BS.view.gripCam) return null; // Greiferkamera deaktiviert
    const T = sim.F && sim.F[5];
    if (!T) return null;
    const p = [T[3], T[7], T[11]],
      z = [T[2], T[6], T[10]];
    let best = null;
    for (const o of sim.objects) {
      if (o.held) continue;
      const d = [o.M[3] - p[0], o.M[7] - p[1], o.M[11] - p[2]];
      const along = d[0] * z[0] + d[1] * z[1] + d[2] * z[2];
      if (along < -10 || along > 250) continue;
      const lat = Math.hypot(d[0] - along * z[0], d[1] - along * z[1], d[2] - along * z[2]);
      if (lat > Math.max(22, o.size[0] * 0.6)) continue;
      if (!best || along < best.dist) best = { obj: o, dist: along, lat };
    }
    if (!best) return null;
    return Object.assign(best, A.classify(best.obj.color));
  };

  /**
   * Erkennung mit der Stativkamera: alle Würfel im überwachten Bereich, die die Kamera sieht
   * (im Bildfeld, nicht verdeckt), mit Farbe und Lage. Liefert [] wenn die Erkennung aus ist.
   */
  A.tripodDetect = function () {
    const V = BS.view;
    if (!V || !V.tripod || !V.tripod.detect) return [];
    const out = [];
    for (const o of BS.sim.objects) {
      if (o.held || !V.inArea(o) || !V.tripodSees(o)) continue;
      out.push(Object.assign({ obj: o, x: o.M[3], y: o.M[7], z: o.M[11] }, A.classify(o.color)));
    }
    return out;
  };
  A.setSource = function (s) {
    A.source = s === 'stativ' ? 'stativ' : 'greifer';
    BS.store.set('detectSource', A.source);
    if (A.source === 'stativ' && BS.view && !BS.view.tripod.detect) {
      BS.view.tripod.detect = true;
      BS.view.saveTripod();
    }
    BS.emit('auto');
  };

  // ------------------------------------------------------------------
  // Greifen und Ablegen
  // ------------------------------------------------------------------
  /**
   * Objekt o greifen und über dem Ziel ablegen.
   * opts.onAbove(o, atGrip) wird in der Vorposition aufgerufen; Rückgabe false → Objekt liegen lassen,
   * null → noch keine Entscheidung (erneuter Aufruf mit atGrip = true an der Greifpose, z. B. Farbmessung zwischen den Backen).
   * opts.dest() liefert danach das Ziel {x, y, z} (z = TCP-Höhe beim Öffnen).
   */
  async function pickPlace(o, opts) {
    const sim = BS.sim;
    const top = o.M[11] + o.size[2] / 2;
    const ap = approach(o, sim.cmd);
    if (!ap) throw new Error(o.name + ' ist nicht erreichbar');
    const g = bestM5(ap.pre.m, o);
    if (g.w > C.gripper.wMax - 4) throw new Error(o.name + ' ist zu breit für den Greifer');
    await move([...ap.pre.m, g.a, 10], 'über ' + o.name, 90);
    let decision = opts.onAbove ? await opts.onAbove(o, false) : true;
    if (decision === false) return false;
    // entlang der Werkzeugachse zur Greifpose
    const gp = { x: o.M[3], y: o.M[7], z: o.M[11] };
    const s2 = BS.kin.ikBest(gp, ap.psi, C.geom, sim.cmd) || ap.grip;
    await move([...s2.m, g.a, 10], 'absenken', 45);
    if (decision == null && opts.onAbove) decision = await opts.onAbove(o, true);
    if (decision === false || decision == null) {
      await move([...ap.pre.m, g.a, 10], 'zurück', 60);
      return false;
    }
    await move([null, null, null, null, null, 73], 'greifen', 150);
    await wait(0.15);
    if (!sim.held || sim.held.obj !== o) throw new Error(o.name + ' wurde nicht gegriffen');
    const s3 = BS.kin.ikBest({ x: gp.x, y: gp.y, z: top + 70 }, ap.psi, C.geom, sim.cmd) || ikAt({ x: gp.x, y: gp.y, z: top + 70 }, ap.psi, sim.cmd);
    if (s3) await move([...s3.m, g.a, 73], 'anheben', 60);
    const d = opts.dest(o);
    const s4 = ikAt(d, -90, sim.cmd);
    if (!s4) throw new Error('Ablageort nicht erreichbar');
    await move([...s4.m, 90, 73], 'zum Ziel', 90);
    await move([null, null, null, null, null, 10], 'ablegen', 150);
    await wait(0.35);
    return true;
  }
  /**
   * Ablageort im Behälter: einer von drei Plätzen. Liegen schon BIN_MAX Würfel darin,
   * wird zuvor der unterste entnommen.
   */
  A.binDrop = function (side, o, noTake) {
    const sim = BS.sim;
    const t = sim.targets.find((x) => x.bin && x.name.toLowerCase().includes(side));
    if (!t) throw new Error('kein Behälter ' + side);
    if (!noTake && sim.binObjects(t).filter((x) => x !== o).length >= sim.BIN_MAX) {
      const r = sim.takeLowest(t, o);
      if (r) logMsg(`Behälter ${side} voll → unterster Würfel (${r.name}) entnommen`);
    }
    const q = t.w * 0.26;
    let best = null;
    for (const [dx, dy] of [
      [-q, -q * 0.6],
      [q, -q * 0.6],
      [0, q * 0.9],
    ]) {
      const x = t.x + dx,
        y = t.y + dy;
      let top = t.z || 0;
      for (const b of sim.objects) {
        if (b === o || b.held) continue;
        if (Math.abs(b.M[3] - x) < (b.size[0] + o.size[0]) * 0.45 && Math.abs(b.M[7] - y) < (b.size[1] + o.size[1]) * 0.45) top = Math.max(top, b.M[11] + b.size[2] / 2);
      }
      if (!best || top < best.top - 0.5) best = { x, y, top };
    }
    return { x: best.x, y: best.y, z: Math.max(best.top, t.hw) + o.size[2] / 2 + 18 };
  };

  /** Entscheidung per Farbsensor für pickPlace.onAbove: map Farbe → 'links' | 'rechts' | 'liegen' */
  function colorDecider(o, map, res) {
    return async (obj, atGrip) => {
      A.status = 'Farbe erkennen';
      let r;
      if (A.source === 'stativ') {
        // Stativkamera: Farbe aus der Bilderkennung im überwachten Bereich (der Greifer verdeckt den Würfel ggf. – daher vor dem Anfahren gemerkt)
        r = res.pre || A.tripodDetect().find((d) => d.obj === obj);
        if (!r) {
          logMsg(o.name + ': nicht im überwachten Bereich bzw. für die Stativkamera verdeckt → liegen lassen');
          A.count.liegen++;
          return false;
        }
        r.via = 'Stativkamera';
      } else {
        await wait(0.4);
        r = A.sense();
        if ((!r || r.obj !== obj) && !atGrip) return null; // Kamera sieht den Würfel noch nicht → an der Greifpose messen
        if (r) r.via = 'Greiferkamera';
      }
      A.lastDetect = r;
      if (!r || !r.key) {
        logMsg(o.name + ': Farbe nicht erkannt → liegen lassen');
        A.count.liegen++;
        return false;
      }
      res.side = map[r.key] || 'liegen';
      logMsg(`${r.via}: ${r.name} (H = ${r.h.toFixed(0)}°) → ${res.side === 'liegen' ? 'liegen lassen' : 'Behälter ' + res.side}`);
      if (res.side === 'liegen') {
        A.count.liegen++;
        return false;
      }
      return true;
    };
  }

  // ------------------------------------------------------------------
  // Ablaufsteuerung
  // ------------------------------------------------------------------
  function start(job, fn) {
    if (A.running) A.stop();
    const sim = BS.sim;
    if (A.source === 'greifer' && BS.view && !BS.view.gripCam) return BS.toast('Greiferkamera ist deaktiviert – Farberkennung auf „Stativkamera“ umstellen oder die Kamera montieren (Panel „Umgebung“ → Kameras)', 'warn');
    if (sim.estop) return BS.toast('Not-Halt aktiv – bitte zuerst quittieren', 'warn');
    if (sim.locked()) return BS.toast(sim.lockMsg(), 'warn');
    token = { cancel: false };
    const my = token;
    A.running = true;
    A.job = job;
    A.status = 'startet';
    logMsg(job + ' gestartet');
    BS.emit('auto');
    fn()
      .then(() => {
        if (my !== token) return;
        A.status = 'fertig';
        logMsg(job + ' beendet');
        BS.toast(job + ': fertig', 'ok');
      })
      .catch((e) => {
        if (my !== token && !(e instanceof Stop)) return;
        if (e instanceof Stop) A.status = 'gestoppt';
        else {
          A.status = 'Fehler: ' + e.message;
          logMsg('Fehler: ' + e.message);
          BS.toast(job + ': ' + e.message, 'warn');
          if (BS.sim.play && BS.sim.play.label.startsWith('Automatik')) BS.sim.stopMotion();
        }
      })
      .finally(() => {
        if (my === token) {
          A.running = false;
          token = null;
          BS.emit('auto');
        }
      });
  }
  A.stop = function (reason) {
    if (!token) return;
    token.cancel = true;
    const p = pending;
    pending = null;
    if (p) p.rej(new Stop(reason || 'gestoppt'));
    for (const w of waiters) {
      w.done = true;
      const i = BS.sim.preStep.indexOf(w.fn);
      if (i >= 0) BS.sim.preStep.splice(i, 1);
      w.rej(new Stop(reason || 'gestoppt'));
    }
    waiters.clear();
    if (BS.sim.play && BS.sim.play.label.startsWith('Automatik')) BS.sim.stopMotion();
    logMsg(A.job + ' gestoppt' + (reason ? ' (' + reason + ')' : ''));
    A.running = false;
    A.status = 'gestoppt';
    token = null;
    BS.emit('auto');
  };
  BS.on('stopAll', (r) => A.stop(r));
  BS.on('scenario', () => A.running && A.stop('Szenario gewechselt'));

  /** Farb-Sortierung: alle Würfel außerhalb der Behälter der Reihe nach (nach Azimut) bearbeiten */
  A.runColorSort = function () {
    const sim = BS.sim;
    if (sim.scenario !== 'farbsort') return BS.toast('Bitte zuerst das Szenario „Farb-Sortierung“ laden', 'warn');
    A.count = { links: 0, rechts: 0, liegen: 0 };
    start('Farb-Sortierung', async () => {
      const done = new Set();
      for (;;) {
        // frisch abgelegte oder gemischte Würfel erst zur Ruhe kommen lassen
        await until(() => sim.objects.every((o) => o.held || o.resting), 2);
        const cand = sim.objects.filter((o) => o.tag === 'sortcube' && !o.held && o.resting && !done.has(o.id) && !(sim.targetOf(o) || {}).bin);
        if (!cand.length) break;
        const az = (o) => Math.atan2(o.M[7], o.M[3]);
        const cur = sim.cmd[0] * BS.D2R;
        cand.sort((a, b) => Math.abs(az(a) - cur) - Math.abs(az(b) - cur));
        const o = cand[0];
        done.add(o.id);
        const res = {};
        if (A.source === 'stativ') {
          // Stativkamera: Farbe vorab aus dem Kamerabild – Würfel, die liegen bleiben sollen, gar nicht erst anfahren
          res.pre = A.tripodDetect().find((d) => d.obj === o);
          const side = res.pre ? sim.sortMap[res.pre.key] || 'liegen' : null;
          if (!res.pre || side === 'liegen') {
            logMsg(res.pre ? `Stativkamera: ${res.pre.name} → liegen lassen` : o.name + ': nicht im überwachten Bereich bzw. verdeckt → liegen lassen');
            A.count.liegen++;
            continue;
          }
        }
        try {
          const placed = await pickPlace(o, { onAbove: colorDecider(o, sim.sortMap, res), dest: (obj) => A.binDrop(res.side, obj) });
          if (placed) A.count[res.side]++;
        } catch (e) {
          if (e instanceof Stop) throw e;
          logMsg(o.name + ': ' + e.message + ' – übersprungen');
          if (sim.held) {
            await move([null, null, null, null, null, 10], 'loslassen', 150);
            await wait(0.3);
          }
        }
      }
      await move(waitPose(), 'Warteposition', 80);
    });
  };

  /** Förderband: Würfel an der Lichtschranke abholen, Farbe bestimmen und in die Behälter legen (Endlosbetrieb) */
  A.runBand = function () {
    const sim = BS.sim;
    const cv = sim.conveyor;
    if (!cv) return BS.toast('Bitte zuerst das Förderband-Szenario laden', 'warn');
    if (cv.mode === 'off') cv.mode = 'auto';
    A.count = { links: 0, rechts: 0, liegen: 0 };
    start('Förderband', async () => {
      const front = () => {
        const c = sim.conveyor;
        if (!c) return null;
        const on = sim.objects.filter((o) => !o.held && o.resting && Math.abs(o.M[3] - c.x) < c.width / 2 && o.M[7] < c.lsY + o.size[1]);
        on.sort((a, b) => a.M[7] - b.M[7]);
        return on[0] || null;
      };
      // Warteposition über dem Bandende
      const wp = ikAt({ x: cv.x, y: cv.yEnd + 30, z: 160 }, -90, sim.cmd);
      for (;;) {
        check();
        if (!sim.conveyor) throw new Stop('kein Förderband');
        if (wp) await move([...wp.m, 90, 10], 'warten auf Würfel', 80);
        A.status = 'warten auf Würfel';
        await until(() => {
          const c = sim.conveyor;
          return c && c.lsState && front();
        });
        await wait(0.3);
        const o = front();
        if (!o) continue;
        const res = {};
        if (A.source === 'stativ') res.pre = A.tripodDetect().find((d) => d.obj === o);
        try {
          const placed = await pickPlace(o, { onAbove: colorDecider(o, sim.bandMap, res), dest: (obj) => A.binDrop(res.side, obj) });
          if (placed) A.count[res.side]++;
          else {
            // nicht erkannt oder „liegen lassen“: vom Band nehmen, damit es weiterläuft
            sim.removeObject(o);
          }
        } catch (e) {
          if (e instanceof Stop) throw e;
          logMsg(o.name + ': ' + e.message + ' – vom Band entfernt');
          if (sim.held) {
            await move([null, null, null, null, null, 10], 'loslassen', 150);
            await wait(0.3);
          }
          sim.removeObject(o);
        }
      }
    });
  };
})();
