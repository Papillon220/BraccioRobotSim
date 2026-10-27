/* Reiter „Manuelle Steuerung“: Servo-Slider, Tastatursteuerung, Vorwärtskinematik, kartesisches Verfahren */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h,
    C = BS.config;

  let rows = [],
    lockNote,
    tcpBox,
    keyEls = {},
    jogStep = 5;

  function jog(axis, dir) {
    const sim = BS.sim;
    if (!sim.canManual() && sim.owner !== 'traj') return BS.toast(sim.lockMsg(), 'warn');
    const cur = sim.cmd.slice();
    const p = BS.kin.tcp(cur);
    const t = { x: p.x, y: p.y, z: p.z };
    let psi = p.psi;
    if (axis === 'psi') psi += dir * jogStep;
    else t[axis] += dir * jogStep;
    const r = BS.kin.cartMove(cur, t, psi, C.geom);
    if (r.frac > 0) sim.setManual(r.m.slice(0, 4));
    if (r.ok) return;
    if (BS.kin.ikBest(t, psi, C.geom, cur))
      BS.toast('Singularität: Weiterfahren erfordert einen Konfigurationswechsel (vorne/hinten) – kartesisch nicht stetig möglich. Bitte per PTP (Reiter Inverse Kinematik) umorientieren.', 'warn');
    else {
      const any = BS.kin.ik(t, psi, C.geom, { m1: cur[0] }).find((x) => x.reachable);
      BS.toast(any ? 'Nicht zulässig: ' + any.reasons[0] : 'Außerhalb des Arbeitsraums', 'warn');
    }
  }

  /** Tastenbelegung: [Tasten, Gelenk, Beschreibung] */
  const KEYMAP = [
    [['a', 'd'], ['A', 'D'], 0, 'Basis drehen links / rechts'],
    [['arrowup', 'arrowdown'], ['↑', '↓'], 1, 'Schulter heben / senken'],
    [['w', 's'], ['W', 'S'], 2, 'Ellbogen senken / heben'],
    [['arrowleft', 'arrowright'], ['←', '→'], 3, 'Handgelenk heben / senken'],
    [['t', 'g'], ['T', 'G'], 4, 'Greifer drehen + / −'],
  ];

  function keyCard() {
    const grid = h('div', { class: 'keymap' });
    for (const [keys, labels, j, desc] of KEYMAP) {
      const pair = h('span', { class: 'pair' });
      keys.forEach((k, i) => {
        keyEls[k] = h('span', { class: 'kbd' }, labels[i]);
        pair.appendChild(keyEls[k]);
      });
      grid.append(pair, h('span', { class: 'joint', style: { color: C.colors[j] } }, C.short[j]), h('span', { class: 'desc' }, desc));
    }
    keyEls.control = h('span', { class: 'kbd wide' }, 'Strg');
    grid.append(h('span', { class: 'pair' }, keyEls.control), h('span', { class: 'joint', style: { color: C.colors[5] } }, C.short[5]), h('span', { class: 'desc' }, 'Greifer öffnen / schließen (Umschalten)'));
    const speed = U.sel(
      [
        ['0.25', 'fein (25 %)'],
        ['0.5', 'langsam (50 %)'],
        ['1', 'normal'],
        ['2', 'schnell (200 %)'],
      ],
      String(U.jogSpeed),
      (v) => U.setJogSpeed(+v)
    );
    BS.on('jogSpeed', (v) => (speed.value = String(v))); // auch vom Controller (Steuerkreuz)
    return U.card(
      'Tastatursteuerung',
      grid,
      U.row(U.field('Tempo', speed)),
      U.hint('Tasten gedrückt halten. Sie wirken in diesem Reiter, solange kein Eingabefeld den Fokus hat. Allgemein: <b>Leertaste</b> Roboterbewegung anhalten/fortsetzen, <b>P</b> Simulation anhalten, <b>1–6</b> Ansichten, <b>7</b> Stativkamera, <b>8</b> Demo-Ansicht, <b>0</b> Greiferkamera.')
    );
  }
  BS.on('keys', () => {
    for (const k in keyEls) keyEls[k].classList.toggle('down', U.keysHeld.has(k));
  });

  U.register('joints', {
    title: 'Manuelle Steuerung',
    build(el) {
      const sim = BS.sim;
      lockNote = U.hint('');
      const jcard = U.card('Gelenkwinkel (Servo-Sollwerte)', lockNote);
      rows = C.names.map((name, i) => {
        const [lo, hi] = C.limits[i];
        const range = h('input', { type: 'range', min: lo, max: hi, step: 1, value: sim.cmd[i] });
        const num = U.num(sim.cmd[i], (v) => {
          const val = BS.clamp(Math.round(v), lo, hi);
          if (!sim.setManual(Object.assign([], { [i]: val }))) BS.toast(sim.lockMsg(), 'warn');
        }, { min: lo, max: hi, cls: 'w52' });
        range.addEventListener('input', () => {
          if (!sim.setManual(Object.assign([], { [i]: +range.value }))) BS.toast(sim.lockMsg(), 'warn');
        });
        const ist = h('span', { class: 'jist' });
        jcard.appendChild(h('div', { class: 'jrow' }, h('span', { class: 'jname', style: { '--c': C.colors[i] } }, name), range, num, ist));
        return { range, num, ist };
      });
      jcard.appendChild(
        U.row(
          U.btn('Aufrecht (90°)', () => sim.moveTo(C.home)),
          U.btn('Begin-Pose', () => sim.moveTo(C.beginPose)),
          U.btn('Greifer auf', () => sim.setManual([null, null, null, null, null, C.gripper.open])),
          U.btn('Greifer zu', () => sim.setManual([null, null, null, null, null, C.gripper.closed])),
          U.btn('■ Stopp', () => sim.stopMotion(), 'danger')
        )
      );
      jcard.appendChild(
        U.row(
          U.btn('+ Pose als Teach-In-Punkt', () => {
            BS.emit('addWaypoint', BS.sim.cmd.slice());
            BS.toast('Pose gespeichert (Reiter Teach-In und Replay)', 'ok');
          }),
          U.btn('Pose kopieren', () => U.copy(sim.cmd.map((v) => Math.round(v)).join(', ')), '', 'Servowinkel M1…M6 als Text kopieren')
        )
      );
      jcard.appendChild(U.hint('Die Sollwerte gehen direkt an die Servos. Die Ist-Werte folgen mit begrenzter Servo-Geschwindigkeit.'));
      el.appendChild(jcard);
      el.appendChild(keyCard());
      el.appendChild(U.gamepadCard());

      tcpBox = h('div');
      el.appendChild(U.card('Vorwärtskinematik – TCP-Pose', tcpBox, U.hint('<b>Real</b>: tatsächliche Pose (mit Fertigungsfehlern, falls aktiv). <b>Modell</b>: <span class="mono">f_dir(Soll)</span> mit Nenngeometrie.')));

      const stepSel = U.sel(
        [
          ['1', '1 mm / 1°'],
          ['5', '5 mm / 5°'],
          ['10', '10 mm / 10°'],
          ['25', '25 mm / 25°'],
        ],
        '5',
        (v) => (jogStep = +v)
      );
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '6px', justifyContent: 'start' } });
      for (const [ax, l] of [
        ['x', 'X'],
        ['y', 'Y'],
        ['z', 'Z'],
        ['psi', 'ψ'],
      ]) {
        grid.append(U.repeatBtn(l + ' −', () => jog(ax, -1)), U.repeatBtn(l + ' +', () => jog(ax, +1)));
      }
      el.appendChild(
        U.card(
          'Kartesisch verfahren (inverse Kinematik)',
          U.row(U.field('Schrittweite', stepSel)),
          grid,
          U.hint('Gedrückt halten zum Wiederholen. Die IK hält den Werkzeugwinkel ψ konstant und wählt die Lösung, die der aktuellen Pose am nächsten liegt.')
        )
      );
    },
    leave() {
      U.keysHeld.clear();
      BS.emit('keys');
    },
    update() {
      const sim = BS.sim;
      lockNote.innerHTML = sim.owner === 'traj' ? '<span class="warn">Bewegung aktiv (' + (sim.play ? sim.play.label : 'Trajektorie') + ') – Slider, Tasten oder „Stopp“ übernehmen.</span>' : '';
      rows.forEach((r, i) => {
        r.range.disabled = sim.locked();
        if (document.activeElement !== r.range) r.range.value = sim.cmd[i];
        if (document.activeElement !== r.num) r.num.value = Math.round(sim.cmd[i] * 10) / 10;
        r.ist.textContent = 'Ist ' + sim.act[i].toFixed(1) + '°';
      });
      U.updateGamepadCard();
      const real = BS.kin.tcp(sim.trueAngles());
      const model = BS.kin.tcp(sim.cmd);
      const d = Math.hypot(real.x - model.x, real.y - model.y, real.z - model.z);
      const r = (lbl, p) =>
        `<tr><td>${lbl}</td><td class="num">${BS.fmt(p.x)}</td><td class="num">${BS.fmt(p.y)}</td><td class="num">${BS.fmt(p.z)}</td><td class="num">${BS.fmt(p.psi)}</td></tr>`;
      tcpBox.innerHTML =
        `<table class="tbl"><tr><th></th><th class="num">x [mm]</th><th class="num">y [mm]</th><th class="num">z [mm]</th><th class="num">ψ [°]</th></tr>` +
        r('Real', real) +
        r('Modell', model) +
        `</table><div class="hint">Abweichung Real ↔ Modell: <b class="${d > 2 ? 'warn' : 'ok'}">${d.toFixed(2)} mm</b></div>`;
    },
  });
})();
