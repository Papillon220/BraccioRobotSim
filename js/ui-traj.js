/* Reiter „Teach-In und Replay“: Posen speichern, Profile, Plots q / q̇ / q̈, Abspielen, CSV-Export */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h,
    C = BS.config;

  const DEFAULT_WPS = [
    { m: [90, 90, 90, 90, 90, 73], dur: 1, dwell: 0.3 },
    { m: [40, 120, 140, 165, 90, 10], dur: 2, dwell: 0.3 },
    { m: [40, 120, 140, 165, 90, 73], dur: 0.8, dwell: 0.2 },
    { m: [140, 110, 130, 160, 90, 73], dur: 2.5, dwell: 0.3 },
    { m: [140, 110, 130, 160, 90, 10], dur: 0.8, dwell: 0 },
  ];
  let wps = BS.store.get('waypoints', DEFAULT_WPS);
  let opts = BS.store.get('trajOpts', { interp: 'ptp', profile: 'quintic', accFrac: 0.25, stop: true, loop: false });
  let plan = null,
    tableEl,
    infoEl,
    plots = [],
    showJ = [true, true, true, true, false, false],
    accRow,
    stopRow;
  const save = () => {
    BS.store.set('waypoints', wps);
    BS.store.set('trajOpts', opts);
  };

  BS.on('addWaypoint', (m) => {
    wps.push({ m: m.map((v) => Math.round(v)), dur: 1.5, dwell: 0 });
    save();
    renderTable();
    replan();
  });

  function replan() {
    plan = wps.length >= 2 ? BS.traj.plan(wps, Object.assign({}, opts, { dt: 0.01 })) : null;
    BS.view.setPath(plan && plan.ok && (U.active === 'traj' || BS.sim.play) ? plan.xyz : null);
    renderInfo();
    drawPlots();
  }

  function renderTable() {
    tableEl.innerHTML = '';
    const head = h('tr', null, h('th', null, '#'), C.short.map((n, i) => h('th', { class: 'num', style: { color: C.colors[i] } }, n)), h('th', { class: 'num', title: 'Fahrzeit vom vorherigen Wegpunkt' }, 't [s]'), h('th', { class: 'num', title: 'Verweilzeit am Wegpunkt' }, 'Halt'), h('th'));
    tableEl.appendChild(head);
    wps.forEach((w, k) => {
      const cells = w.m.map((v, i) =>
        h(
          'td',
          null,
          U.num(v, (nv) => {
            w.m[i] = BS.clamp(nv, C.limits[i][0], C.limits[i][1]);
            save();
            replan();
          }, { cls: 'w44', min: C.limits[i][0], max: C.limits[i][1] })
        )
      );
      const dur = k === 0 ? h('td', { class: 'muted num' }, '–') : h('td', null, U.num(w.dur, (v) => ((w.dur = Math.max(0.05, v)), save(), replan()), { cls: 'w44', step: 0.1, min: 0.05 }));
      const dwell = h('td', null, U.num(w.dwell || 0, (v) => ((w.dwell = Math.max(0, v)), save(), replan()), { cls: 'w44', step: 0.1, min: 0 }));
      const acts = h(
        'td',
        { style: { whiteSpace: 'nowrap' } },
        U.btn('⤳', () => BS.sim.moveTo(w.m), 'small icon', 'Wegpunkt anfahren'),
        U.btn('⟲', () => {
          w.m = BS.sim.cmd.map((v) => Math.round(v));
          save();
          renderTable();
          replan();
        }, 'small icon', 'Mit aktueller Pose überschreiben'),
        U.btn('✕', () => {
          wps.splice(k, 1);
          save();
          renderTable();
          replan();
        }, 'small icon', 'Löschen')
      );
      tableEl.appendChild(h('tr', null, h('td', { class: 'muted' }, k + 1), cells, dur, dwell, acts));
    });
  }

  function renderInfo() {
    if (!plan) {
      infoEl.innerHTML = '<span class="muted">Mindestens 2 Wegpunkte anlegen.</span>';
      return;
    }
    let s = `<div class="kv"><b>Gesamtdauer</b><span class="mono">${plan.duration.toFixed(2)} s</span></div>`;
    s += '<table class="tbl" style="margin-top:6px"><tr><th></th>' + C.short.map((n, i) => `<th class="num" style="color:${C.colors[i]}">${n}</th>`).join('') + '</tr>';
    s += '<tr><td class="muted">|q̇|max °/s</td>' + plan.peaks.map((p, i) => `<td class="num ${p.v > C.servo.vmax[i] ? 'err' : ''}">${p.v.toFixed(0)}</td>`).join('') + '</tr>';
    s += '<tr><td class="muted">|q̈|max °/s²</td>' + plan.peaks.map((p) => `<td class="num">${p.a.toFixed(0)}</td>`).join('') + '</tr></table>';
    if (plan.errors.length) s += plan.errors.map((e) => `<div class="warn" style="margin-top:4px">⚠ ${e}</div>`).join('');
    infoEl.innerHTML = s;
  }

  function drawPlots(cursor) {
    const titles = ['Position q(t) [°]', 'Geschwindigkeit q̇(t) [°/s]', 'Beschleunigung q̈(t) [°/s²]'];
    plots.forEach((p, k) => {
      if (!plan) return p.draw({ series: [] });
      const arr = [plan.Q, plan.QD, plan.QDD][k];
      const step = Math.max(1, Math.floor(plan.T.length / 600));
      const series = [];
      for (let j = 0; j < 6; j++) {
        if (!showJ[j]) continue;
        const d = [];
        for (let i = 0; i < plan.T.length; i += step) d.push([plan.T[i], arr[j][i]]);
        series.push({ name: C.short[j], color: C.colors[j], data: d });
      }
      p.draw({ series, title: titles[k], xLabel: k === 2 ? 't [s]' : null, cursor, legend: k === 0 });
    });
  }

  function play() {
    const sim = BS.sim;
    if (!plan || !plan.ok) return BS.toast('Keine gültige Trajektorie', 'warn');
    if (sim.locked()) return BS.toast(sim.lockMsg(), 'warn');
    // Anfahrt zum ersten Wegpunkt
    const d = Math.max(...wps[0].m.map((v, i) => Math.abs(v - sim.cmd[i])));
    if (d > 0.5) {
      const ap = BS.traj.ptp(sim.cmd.slice(), wps[0].m, 60);
      sim.playPlan(ap, { label: 'Anfahrt Startpunkt', onEnd: () => sim.playPlan(plan, { loop: opts.loop, label: 'Trajektorie' }) });
    } else sim.playPlan(plan, { loop: opts.loop, label: 'Trajektorie' });
  }

  // ---------------- Export ----------------
  function exportCsv() {
    if (!plan) return;
    let s = 't;' + C.short.map((n) => n + '_deg').join(';') + ';' + C.short.map((n) => n + 'd_degps').join(';') + ';x_mm;y_mm;z_mm\n';
    for (let i = 0; i < plan.T.length; i++) {
      s += [plan.T[i].toFixed(3), ...plan.Q.map((q) => q[i].toFixed(3)), ...plan.QD.map((q) => q[i].toFixed(3)), ...plan.xyz[i].map((v) => v.toFixed(2))].join(';') + '\n';
    }
    BS.download('braccio_trajektorie.csv', s, 'text/csv');
  }
  U.register('traj', {
    title: 'Teach-In und Replay',
    build(el) {
      tableEl = h('table', { class: 'tbl compact' });
      el.appendChild(
        U.card(
          'Teach-In-Punkte (Servowinkel in °)',
          h('div', { class: 'tblwrap' }, tableEl),
          U.row(
            U.btn('⊕ Teach-In: aktuelle Pose speichern', () => BS.emit('addWaypoint', BS.sim.cmd.slice()), 'primary'),
            U.btn('Beispiel', () => {
              wps = JSON.parse(JSON.stringify(DEFAULT_WPS));
              save();
              renderTable();
              replan();
            }),
            U.btn('Leeren', () => {
              wps = [];
              save();
              renderTable();
              replan();
            })
          )
        )
      );
      const profileSel = U.sel(
        [
          ['trapez', 'Trapezprofil (C0)'],
          ['cubic', 'Polynom 3. Ordnung (C1)'],
          ['quintic', 'Polynom 5. Ordnung (C2, ruckbegrenzt)'],
          ['linear', 'Linear (ohne Profil)'],
        ],
        opts.profile,
        (v) => {
          opts.profile = v;
          accRow.style.display = v === 'trapez' ? '' : 'none';
          save();
          replan();
        }
      );
      const interpSel = U.sel(
        [
          ['ptp', 'PTP – Interpolation im Gelenkraum'],
          ['lin', 'LIN – Gerade im kartesischen Raum (IK)'],
        ],
        opts.interp,
        (v) => {
          opts.interp = v;
          stopRow.style.display = v === 'ptp' ? '' : 'none';
          save();
          replan();
        }
      );
      accRow = U.row(U.field('Beschleunigungsanteil t_a / T', U.num(opts.accFrac, (v) => ((opts.accFrac = BS.clamp(v, 0.02, 0.5)), save(), replan()), { step: 0.05, min: 0.02, max: 0.5 })));
      accRow.style.display = opts.profile === 'trapez' ? '' : 'none';
      stopRow = U.row(
        U.chk('An jedem Wegpunkt anhalten', opts.stop, (v) => {
          opts.stop = v;
          save();
          replan();
        }, 'Ohne Halt: Polynome 5. Ordnung mit Zwischengeschwindigkeiten (C2-stetiges Verschleifen)')
      );
      stopRow.style.display = opts.interp === 'ptp' ? '' : 'none';
      el.appendChild(
        U.card(
          'Replay',
          U.row(U.field('Interpolation', interpSel)),
          U.row(U.field('Profil', profileSel)),
          accRow,
          stopRow,
          U.row(
            U.btn('▶ Replay', play, 'primary'),
            U.btn('■ Stopp', () => BS.sim.stopMotion(), 'danger'),
            U.chk('Wiederholen', opts.loop, (v) => {
              opts.loop = v;
              save();
            })
          ),
          U.hint('Posen im Reiter „Manuelle Steuerung“ (Slider oder Tastatur) anfahren und hier speichern; ⤳ fährt einen Punkt an, ⟲ überschreibt ihn mit der aktuellen Pose. PTP mit Halt: jedes Segment rast-zu-rast mit dem gewählten Profil. Ohne Halt: Zwischengeschwindigkeiten nach der Mittelwert-Heuristik (0 bei Richtungswechsel). LIN: TCP fährt auf einer Geraden, die Gelenkwinkel folgen aus der IK in jedem Abtastschritt.')
        )
      );
      infoEl = h('div');
      el.appendChild(U.card('Auswertung', infoEl));
      const cvs = [0, 1, 2].map(() => h('canvas', { class: 'plot' }));
      plots = cvs.map((c) => new BS.Plot(c));
      const chips = C.short.map((n, i) =>
        U.chk(h('span', { style: { color: C.colors[i], fontWeight: 600 } }, n), showJ[i], (v) => {
          showJ[i] = v;
          drawPlots();
        })
      );
      el.appendChild(U.card('Verläufe', U.row(...chips), ...cvs));
      el.appendChild(
        U.card(
          'Export',
          U.row(U.btn('Trajektorie als CSV', exportCsv)),
          U.hint('Zeit, Gelenkwinkel, Gelenkgeschwindigkeiten und TCP-Position der geplanten Bahn (Trennzeichen „;“). Gemessene Verläufe zeichnet „⏺ Messdaten“ oben in der Werkzeugleiste auf.')
        )
      );
      renderTable();
      replan();
    },
    enter() {
      replan();
    },
    leave() {
      if (!BS.sim.play) BS.view.setPath(null);
    },
    update() {
      const sim = BS.sim;
      if (sim.play && plan && sim.play.plan === plan) drawPlots(sim.playT);
    },
  });
})();
