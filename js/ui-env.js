/* Panel „Umgebung“ (rechts, in allen Reitern): Szenario, Farb-Sortierung, Farbsensor, Greifer, Objekte */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h,
    C = BS.config;

  let scenSel, descEl, scoreEl, specEl, sensorEl, gripEl, selEl, objEl, autoEl, logEl, camEl, detList;
  const newObj = { size: 30, color: '#e03131', x: 150, y: 200 };
  const COLORS = [
    ['#e03131', 'rot'],
    ['#fab005', 'gelb'],
    ['#1e7a35', 'grün'],
    ['#1747a6', 'blau'],
    ['#7048e8', 'violett'],
    ['#f76707', 'orange'],
  ];
  const SIDES = [
    ['links', 'Behälter links'],
    ['rechts', 'Behälter rechts'],
    ['liegen', 'liegen lassen'],
  ];

  BS.on('pickObject', (o) => {
    BS.view.selected = o;
    if (selEl) renderSel();
    if (objEl) renderObjects();
  });
  BS.on('objects', () => objEl && renderObjects());
  BS.on('scenario', () => {
    if (!scenSel) return;
    scenSel.value = BS.sim.scenario;
    descEl.textContent = BS.sim.scenarios[BS.sim.scenario].desc;
    renderSpecific();
  });
  BS.on('auto', () => specEl && renderSpecific());
  BS.on('autolog', () => logEl && renderLog());

  function status(o) {
    const sim = BS.sim;
    if (o.held) return '<span class="badge ok">gegriffen</span>';
    const t = sim.targetOf(o);
    if (t) return sim.accepts(t, o) ? `<span class="badge ok">✓ ${t.name}</span>` : `<span class="badge err">✗ ${t.name}</span>`;
    return o.resting ? '<span class="badge">liegt</span>' : '<span class="badge warn">fällt</span>';
  }

  // ------------------------------------------------------------------
  // Szenariospezifische Karte
  // ------------------------------------------------------------------
  function renderSpecific() {
    const sim = BS.sim;
    const A = BS.auto;
    specEl.innerHTML = '';
    autoEl = logEl = null;
    if (sim.scenario === 'farbsort') {
      const grid = h('div', { class: 'colormap' });
      for (const c of sim.SORT_COLORS) {
        grid.append(
          h('span', { class: 'cname' }, h('span', { class: 'swatch', style: { background: c.hex } }), c.name),
          U.sel(SIDES, sim.sortMap[c.key] || 'liegen', (v) => {
            sim.sortMap[c.key] = v;
            BS.store.set('sortMap', sim.sortMap);
          }),
          h('span')
        );
      }
      let n = 6;
      autoEl = h('div', { class: 'status' });
      logEl = h('div', { style: { maxHeight: '120px', overflow: 'auto', fontSize: '12px' } });
      specEl.appendChild(
        U.card(
          'Farb-Sortierung',
          U.hint('Was mit den Würfeln je erkannter Farbe passiert:'),
          grid,
          U.row(
            A.running ? U.btn('■ Automatik stoppen', () => A.stop(), 'danger') : U.btn('▶ Automatisch sortieren', () => A.runColorSort(), 'primary'),
            U.btn('Würfel neu mischen', () => sim.shuffleCubes(n, true), '', 'Zufällige Farben und Lagen')
          ),
          U.row(U.btn('Behälter leeren', () => sim.emptyBins(), 'small')),
          U.row(U.sourceSel()),
          U.row(U.field('Anzahl Würfel', U.num(n, (v) => (n = BS.clamp(Math.round(v), 1, 8)), { cls: 'w44', min: 1, max: 8 }))),
          autoEl,
          logEl,
          U.hint('Ablauf: Würfel anfahren → Farbsensor am Greifer misst den Farbton (HSV) → greifen → in den zugeordneten Behälter legen oder liegen lassen. Manuell geht es genauso: Würfel unter den Greifer fahren, der Sensor unten zeigt die Farbe.')
        )
      );
      renderLog();
    } else if (sim.scenario === 'labor2') {
      const L = BS.labScene;
      specEl.appendChild(
        U.card(
          'Labor-Szenario',
          U.row(
            U.chk('Würfel 1', L.show.cube1, (v) => L.setShow('cube1', v)),
            U.chk('Würfel 2', L.show.cube2, (v) => L.setShow('cube2', v)),
            U.chk('Regal', L.show.regal, (v) => L.setShow('regal', v)),
            U.chk('virtuelle Wand', L.show.efence, (v) => L.setShow('efence', v))
          ),
          wallRow(L),
          (autoEl = h('div', { class: 'status' })),
          U.hint('Koordinaten im Labor-KS0 (m, x nach vorne): x<sub>lab</sub> = y<sub>sim</sub>, y<sub>lab</sub> = −x<sub>sim</sub>. Die virtuelle Wand steht quer zur y-Achse und leuchtet rot, sobald der TCP auf ihrer Rückseite (kleineres y) ist.')
        )
      );
    } else if (sim.scenario === 'band') {
      autoEl = h('div', { class: 'status' });
      specEl.appendChild(U.card('Förderband', autoEl, U.row(U.btn('→ Reiter Förderband-Szenario', () => U.show('band')))));
    }
  }

  /** Lage der virtuellen Wand: Schieberegler und Eingabefeld (y im Simulator-KS in mm = x_lab · 1000) */
  function wallRow(L) {
    const y0 = Math.round(L.efenceX * 1000);
    const range = h('input', { type: 'range', min: L.WALL_MIN, max: L.WALL_MAX, step: 5, value: y0 });
    const num = U.num(y0, (v) => set(v), { cls: 'w52', step: 5, min: L.WALL_MIN, max: L.WALL_MAX });
    const lab = h('span', { class: 'mono muted', style: { fontSize: '11.5px' } });
    function set(v) {
      v = BS.clamp(Math.round(v), L.WALL_MIN, L.WALL_MAX);
      L.setWallY(v);
      range.value = v;
      num.value = v;
      lab.textContent = `x_lab = ${(v / 1000).toFixed(3)} m`;
    }
    range.addEventListener('input', () => set(+range.value));
    set(y0);
    return h('div', { class: 'jrow', style: { gridTemplateColumns: '78px 1fr 58px', marginTop: '8px' } }, h('span', { class: 'jname', style: { '--c': '#868e96' } }, 'Wand y'), range, num, h('span'), lab);
  }

  function renderLog() {
    if (!logEl) return;
    const A = BS.auto;
    logEl.innerHTML = A.log.length ? A.log.slice(0, 20).map((e) => `<div><span class="mono muted">${e.t.toFixed(1)} s</span> ${e.msg}</div>`).join('') : '';
  }

  function updateSpecific() {
    const sim = BS.sim;
    const A = BS.auto;
    if (!autoEl) return;
    if (sim.scenario === 'farbsort') {
      autoEl.className = 'status' + (A.running ? ' running' : '');
      autoEl.innerHTML = `Automatik: <b>${A.running ? A.status : A.status || 'bereit'}</b> · links ${A.count.links} · rechts ${A.count.rechts} · liegen gelassen ${A.count.liegen}`;
    } else if (sim.scenario === 'labor2') {
      const L = BS.labScene;
      autoEl.className = 'status' + (L.alarm ? ' error' : '');
      const T = sim.F[5];
      const p = L.toLab([T[3], T[7], T[11]]);
      autoEl.innerHTML = `TCP im Labor-KS: <span class="mono">x ${p[0].toFixed(3)} · y ${p[1].toFixed(3)} · z ${p[2].toFixed(3)} m</span>${L.alarm ? '<br><b>Lim X – virtuelle Wand erreicht</b>' : ''}`;
    } else if (sim.scenario === 'band' && sim.conveyor) {
      const cv = sim.conveyor;
      const led = (on, txt, g) => `<span class="led ${g ? 'green' : ''} ${on ? 'on' : ''}">${txt}</span>`;
      autoEl.className = 'status';
      autoEl.innerHTML = led(cv.running, 'Band läuft', true) + led(cv.lsState, 'Lichtschranke') + (A.running ? `<div>Automatik: ${A.status}</div>` : '');
    }
  }

  // ------------------------------------------------------------------
  // Kameras (eine Karte): Bild im Bild, Reiter Greiferkamera / Stativkamera
  // ------------------------------------------------------------------
  let camTab = BS.store.get('camTab', 'greifer');
  const openDet = { fine: false, area: false }; // aufgeklappte Feineinstellungen merken
  function seg(opts, val, onPick) {
    const el = h('div', { class: 'subnav seg-sm' });
    for (const [k, l] of opts) el.appendChild(h('button', { type: 'button', class: k === val ? 'active' : '', onclick: () => onPick(k) }, l));
    return el;
  }
  const subhead = (t) => h('div', { class: 'subhead' }, t);
  function fold(key, title, ...children) {
    const d = h('details', { class: 'fold' }, h('summary', null, title), ...children);
    d.open = openDet[key];
    d.addEventListener('toggle', () => (openDet[key] = d.open));
    return d;
  }
  function renderCams() {
    const V = BS.view;
    const T = V.tripod;
    camEl.innerHTML = '';
    sensorEl = detList = null;
    camEl.append(
      U.row(
        h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Bild im Bild'),
        seg(
          [
            ['', 'aus'],
            ['greifer', 'Greifer'],
            ['stativ', 'Stativ'],
          ],
          V.pip || '',
          (k) => V.setPip(k)
        )
      ),
      seg(
        [
          ['greifer', 'Greiferkamera'],
          ['stativ', 'Stativkamera'],
        ],
        camTab,
        (k) => {
          camTab = k;
          BS.store.set('camTab', k);
          renderCams();
        }
      )
    );
    if (camTab === 'greifer') {
      sensorEl = h('div', { class: 'sensor' });
      camEl.append(
        U.row(
          U.chk('montiert', V.gripCam, (v) => V.setGripCam(v), 'Aus: Kamera wird vom Greifer abgenommen – keine Kameraansicht, kein Farbsensor'),
          h('span', { class: 'grow' }),
          U.btn('Kamerabild (0)', () => V.setView('greifer'), 'small', 'Greiferkamera als Hauptansicht (Taste 0)')
        ),
        subhead('Farbsensor'),
        sensorEl,
        U.hint('Seitlich am Greifer, blickt entlang der Werkzeugachse. Der Farbsensor misst den Farbton des Würfels in Blickrichtung.')
      );
      return;
    }
    // Stativkamera
    const num = (obj, k, lbl, step, min, max, save) =>
      U.field(
        lbl,
        U.num(obj[k], (v) => {
          obj[k] = min != null ? BS.clamp(v, min, max) : v;
          save();
        }, { cls: 'w52', step })
      );
    const saveT = () => V.saveTripod();
    const preset = U.sel([['', 'Standardposition …'], ...V.TRIPOD_PRESETS.map((p) => [p[0], p[1]])], '', (v) => {
      V.setTripodPreset(v);
      renderCams();
    });
    const area = U.sel([['', 'Bereich wählen …'], ...V.AREA_PRESETS.map((p) => [p[0], p[1]])], '', (v) => {
      V.setAreaPreset(v);
      renderCams();
    });
    detList = h('div', { class: 'tblwrap' });
    const a = T.area;
    camEl.append(
      subhead('Standort'),
      U.row(preset, h('span', { class: 'grow' }), U.btn('Kamerabild (7)', () => V.setView('stativ'), 'small', 'Stativkamera als Hauptansicht (Taste 7)')),
      U.row(
        U.btn('Aus aktueller Ansicht', () => {
          V.tripodFromView();
          renderCams();
        }, 'small', 'Stativ an die Stelle der aktuellen Mausansicht stellen und ausrichten'),
        U.btn('Auf Roboter ausrichten', () => {
          const F = BS.sim.F[5];
          V.aimTripod([F[3] * 0.5, F[7] * 0.5 + 60, Math.max(40, F[11] * 0.6)]);
          renderCams();
        }, 'small')
      ),
      fold(
        'fine',
        'Feineinstellung',
        U.row(num(T, 'x', 'x', 10, null, null, saveT), num(T, 'y', 'y', 10, null, null, saveT), num(T, 'z', 'z', 10, 20, 2000, saveT), h('span', { class: 'muted' }, 'mm')),
        U.row(num(T, 'pan', 'Schwenk', 5, -360, 360, saveT), num(T, 'tilt', 'Neigung', 5, -89, 89, saveT), num(T, 'fov', 'Winkel', 5, 15, 100, saveT), h('span', { class: 'muted' }, '°')),
        U.row(U.chk('Stativ immer anzeigen', T.show, (v) => ((T.show = v), saveT()))),
        U.hint('Schwenk um die Hochachse (0° = Blick in +x), Neigung negativ = nach unten.')
      ),
      subhead('Würfelerkennung'),
      U.row(
        U.chk('aktiv', T.detect, (v) => {
          T.detect = v;
          saveT();
        }),
        area
      ),
      fold(
        'area',
        'Bereich anpassen',
        U.row(num(a, 'x', 'Mitte x', 10, null, null, saveT), num(a, 'y', 'y', 10, null, null, saveT), h('span', { class: 'muted' }, 'mm')),
        U.row(num(a, 'w', 'Breite', 10, 20, 2000, saveT), num(a, 'h', 'Tiefe', 10, 20, 2000, saveT), h('span', { class: 'muted' }, 'mm'))
      ),
      detList,
      U.hint('Erkannt werden Würfel im überwachten Bereich (violett gestrichelt), die im Bildfeld liegen und nicht verdeckt sind.')
    );
  }
  BS.on('pip', () => camEl && renderCams());

  /** Auswahl der Farberkennung für die Automatik (auch im Reiter Förderband verwendet) */
  U.sourceSel = function () {
    const el = U.sel(
      [
        ['greifer', 'Greiferkamera (am Würfel messen)'],
        ['stativ', 'Stativkamera (überwachter Bereich)'],
      ],
      BS.auto.source,
      (v) => BS.auto.setSource(v)
    );
    return U.field('Farberkennung', el);
  };

  function updateDetect() {
    const A = BS.auto;
    A.detected = A.tripodDetect();
    BS.view.syncDetect(A.detected);
    if (!detList) return;
    if (!BS.view.tripod.detect) {
      detList.innerHTML = '<span class="muted">Erkennung aus.</span>';
      return;
    }
    detList.innerHTML = A.detected.length
      ? '<table class="tbl"><tr><th>erkannt</th><th class="num">x</th><th class="num">y</th><th class="num">H</th></tr>' +
        A.detected.map((d) => `<tr><td><span class="swatch" style="background:${d.hex}"></span>${d.name}</td><td class="num">${d.x.toFixed(0)}</td><td class="num">${d.y.toFixed(0)}</td><td class="num">${d.h.toFixed(0)}°</td></tr>`).join('') +
        '</table>'
      : '<span class="muted">Kein Würfel im überwachten Bereich sichtbar.</span>';
  }

  // ------------------------------------------------------------------
  // Farbsensor, Greifer, Auswahl, Objekte
  // ------------------------------------------------------------------
  function updateSensor() {
    if (!sensorEl) return;
    if (!BS.view.gripCam) {
      sensorEl.innerHTML = '<span class="dot"></span><span class="muted">Greiferkamera nicht montiert</span>';
      return;
    }
    const r = BS.auto.sense();
    if (!r) {
      sensorEl.innerHTML = '<span class="dot"></span><span class="muted">kein Objekt im Sichtfeld der Greiferkamera</span>';
      return;
    }
    sensorEl.innerHTML =
      `<span class="dot" style="background:${r.hex}"></span><span><b class="${r.key ? '' : 'warn'}">${r.name}</b> &nbsp;<span class="mono muted">H ${r.h.toFixed(0)}° · S ${(r.s * 100).toFixed(0)} % · V ${(r.v * 100).toFixed(0)} %</span><br>` +
      `<span class="muted">${r.obj.name}, Abstand ${r.dist.toFixed(0)} mm</span></span>`;
  }

  function renderObjects() {
    const sim = BS.sim;
    objEl.innerHTML = '';
    const t = h('table', { class: 'tbl' });
    t.appendChild(h('tr', null, h('th', null, 'Objekt'), h('th', { class: 'num' }, 'x'), h('th', { class: 'num' }, 'y'), h('th', { class: 'num' }, 'z'), h('th', null, 'Status'), h('th')));
    for (const o of sim.objects) {
      const tr = h(
        'tr',
        { class: 'hov' + (BS.view.selected === o ? ' sel' : '') },
        h('td', null, h('span', { class: 'swatch', style: { background: o.color } }), o.name),
        h('td', { class: 'num', 'data-k': 'x' }),
        h('td', { class: 'num', 'data-k': 'y' }),
        h('td', { class: 'num', 'data-k': 'z' }),
        h('td', { 'data-k': 's' }),
        h(
          'td',
          { style: { whiteSpace: 'nowrap' } },
          U.btn('IK', (e) => {
            e.stopPropagation();
            BS.emit('setIkTarget', { x: o.M[3], y: o.M[7], z: o.M[11] });
          }, 'small', 'Objektmitte als IK-Ziel übernehmen'),
          U.btn('✕', (e) => {
            e.stopPropagation();
            sim.removeObject(o);
          }, 'small icon', 'Entfernen')
        )
      );
      tr.addEventListener('click', () => {
        BS.view.selected = o;
        renderObjects();
        renderSel();
      });
      tr._obj = o;
      t.appendChild(tr);
    }
    objEl.appendChild(t);
    if (!sim.objects.length) objEl.appendChild(U.hint('Keine Objekte.'));
    updateObjects();
  }
  function updateObjects() {
    for (const tr of objEl.querySelectorAll('tr')) {
      const o = tr._obj;
      if (!o) continue;
      tr.querySelector('[data-k=x]').textContent = o.M[3].toFixed(0);
      tr.querySelector('[data-k=y]').textContent = o.M[7].toFixed(0);
      tr.querySelector('[data-k=z]').textContent = o.M[11].toFixed(0);
      tr.querySelector('[data-k=s]').innerHTML = status(o);
    }
  }

  function renderSel() {
    const o = BS.view.selected;
    if (!o || !BS.sim.objects.includes(o)) {
      selEl.innerHTML = '<span class="muted">Würfel im 3D-Fenster oder in der Liste anklicken.</span>';
      return;
    }
    const yaw = (Math.atan2(o.M[4], o.M[0]) * BS.R2D).toFixed(1);
    const b = BS.auto.bestM5(BS.sim.cmd.slice(0, 4), o);
    const ik = BS.kin.ikAuto({ x: o.M[3], y: o.M[7], z: o.M[11] }, C.geom, { psiPref: -90, cur: BS.sim.cmd });
    selEl.innerHTML =
      `<div class="kv"><b>Objekt</b><span><span class="swatch" style="background:${o.color}"></span>${o.name} (${o.size[0]} mm, ${o.mass} g${o.tag && o.tag !== 'sortcube' ? ', ' + o.tag : ''})</span>` +
      `<b>Mitte</b><span class="mono">(${o.M[3].toFixed(1)}, ${o.M[7].toFixed(1)}, ${o.M[11].toFixed(1)}) mm</span>` +
      `<b>Gierwinkel</b><span class="mono">${yaw}°</span>` +
      `<b>IK zur Mitte</b><span class="mono">${ik ? `ψ = ${ik.psi}°, M1..M4 = ${ik.m.map((v) => v.toFixed(0)).join(', ')}` : '<span class="err">nicht erreichbar</span>'}</span>` +
      `<b>M5 (akt. Pose)</b><span class="mono">${b.a}° → Greifbreite ${b.w.toFixed(1)} mm</span></div>`;
  }

  function updateScore() {
    const sim = BS.sim;
    if (sim.scenario === 'farbsort') {
      let ok = 0,
        bad = 0,
        need = 0;
      for (const o of sim.objects) {
        if (o.tag !== 'sortcube') continue;
        const k = BS.auto.classify(o.color).key;
        const side = sim.sortMap[k] || 'liegen';
        const t = sim.targetOf(o);
        if (side !== 'liegen') need++;
        if (t && t.bin) sim.accepts(t, o) ? ok++ : bad++;
      }
      scoreEl.innerHTML = `Richtig einsortiert: <b class="${ok === need && !bad ? 'ok' : ''}">${ok} / ${need}</b>${bad ? ` · <span class="err">falsch: ${bad}</span>` : ''}${ok === need && !bad && need ? ' 🎉' : ''}`;
    } else if (sim.targets.length) {
      let ok = 0;
      for (const o of sim.objects) {
        const t = sim.targetOf(o);
        if (t && sim.accepts(t, o)) ok++;
      }
      const need = sim.scenario === 'band' ? null : sim.objects.length;
      scoreEl.innerHTML = `Richtig abgelegt: <b class="${need && ok === need ? 'ok' : ''}">${ok}${need ? ' / ' + need : ''}</b>${need && ok === need ? ' 🎉' : ''}`;
    } else scoreEl.innerHTML = '';
  }

  U.buildEnv = function (el) {
    const sim = BS.sim;
    scenSel = U.sel(
      Object.entries(sim.scenarios).map(([k, s]) => [k, s.name]),
      sim.scenario,
      (v) => {
        sim.loadScenario(v);
        BS.store.set('scenario', v);
      }
    );
    scenSel.style.flex = '1';
    descEl = h('p', { class: 'hint' }, sim.scenarios[sim.scenario].desc);
    scoreEl = h('div', { style: { marginTop: '6px' } });
    el.appendChild(
      U.card(
        'Umgebung / Szenario',
        U.row(scenSel, U.btn('↺', () => sim.loadScenario(scenSel.value), 'icon', 'Szenario neu laden')),
        descEl,
        scoreEl
      )
    );
    specEl = h('div');
    el.appendChild(specEl);
    camEl = h('div');
    el.appendChild(U.card('Kameras', camEl));
    renderCams();
    gripEl = h('div');
    el.appendChild(
      U.card(
        'Greifer',
        gripEl,
        U.row(
          U.btn('Öffnen', () => sim.setManual([null, null, null, null, null, C.gripper.open])),
          U.btn('Schließen', () => sim.setManual([null, null, null, null, null, C.gripper.closed]))
        )
      )
    );
    selEl = h('div');
    el.appendChild(U.card('Auswahl', selEl));
    objEl = h('div', { class: 'tblwrap' });
    const colSel = U.sel(COLORS, newObj.color, (v) => (newObj.color = v));
    el.appendChild(
      U.card(
        'Objekte',
        objEl,
        U.row(
          U.field('Kante', U.num(newObj.size, (v) => (newObj.size = BS.clamp(v, 10, 65)), { cls: 'w44' })),
          U.field('x', U.num(newObj.x, (v) => (newObj.x = v), { cls: 'w52', step: 10 })),
          U.field('y', U.num(newObj.y, (v) => (newObj.y = v), { cls: 'w52', step: 10 }))
        ),
        U.row(
          colSel,
          U.btn('+ Würfel', () => {
            const nm = (COLORS.find((c) => c[0] === newObj.color) || [0, ''])[1];
            const s = newObj.size;
            sim.addObject({ size: [s, s, s], color: newObj.color, name: 'Würfel ' + nm, tag: sim.scenario === 'farbsort' ? 'sortcube' : '', pos: [newObj.x, newObj.y, s / 2 + 1], yaw: Math.atan2(newObj.y, newObj.x) * BS.R2D });
          })
        ),
        U.hint('Würfel werden gegriffen, wenn sie zwischen den Fingern liegen und der Greifer schließt. Beim Öffnen fallen sie auf die Unterlage.')
      )
    );
    renderSpecific();
    renderObjects();
    renderSel();
  };

  U.updateEnv = function () {
    const sim = BS.sim;
    updateScore();
    updateSpecific();
    updateSensor();
    updateDetect();
    updateObjects();
    gripEl.innerHTML = `<div class="kv"><b>Öffnung</b><span class="mono">${sim.jawWidth().toFixed(1)} mm (M6 Ist ${sim.act[5].toFixed(1)}°)</span><b>Objekt</b><span>${sim.held ? `<span class="ok">${sim.held.obj.name}</span> – ${sim.held.gripW.toFixed(1)} mm, ${sim.held.obj.mass} g` : '<span class="muted">keins</span>'}</span></div>`;
    if (BS.view.selected) renderSel();
  };
})();
