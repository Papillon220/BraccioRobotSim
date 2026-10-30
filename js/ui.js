/* BraccioSim – UI-Grundgerüst: Reiter, Werkzeugleiste, HUD, Scope, Tastatur, Farbschema, Hilfsfunktionen */
(function () {
  'use strict';
  const BS = window.BS;
  const h = BS.h;
  const C = BS.config;

  const U = (BS.ui = { tabs: [], active: null, activeTop: null, lastSub: {} });

  /** Reiter in der Kopfzeile; Reiter mit mehreren Bereichen zeigen oben eine Unterauswahl */
  U.TOP = [
    { id: 'joints', title: 'Manuelle Steuerung' },
    { id: 'workspace', title: 'Arbeitsraumbeschränkung' },
    { id: 'traj', title: 'Teach-In und Replay' },
    { id: 'ik', title: 'Inverse Kinematik' },
    { id: 'band', title: 'Förderband-Szenario' },
    { id: 'cosim', title: 'Co-Simulation' },
  ];

  // ------------------------------------------------------------------
  // Bausteine
  // ------------------------------------------------------------------
  U.btn = (label, onclick, cls, title) => h('button', { class: 'btn ' + (cls || ''), onclick, title, type: 'button' }, label);
  U.num = (val, onchange, o) => {
    o = o || {};
    const el = h('input', { type: 'number', value: val, step: o.step != null ? o.step : 1, class: o.cls || '', title: o.title });
    if (o.min != null) el.min = o.min;
    if (o.max != null) el.max = o.max;
    el.addEventListener('change', () => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) onchange(v, el);
    });
    return el;
  };
  U.sel = (opts, val, onchange) => {
    const el = h('select', { onchange: () => onchange(el.value) }, opts.map(([v, l]) => h('option', { value: v }, l)));
    el.value = val;
    return el;
  };
  U.chk = (label, checked, onchange, title) => {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = !!checked;
    inp.addEventListener('change', () => onchange(inp.checked));
    const el = h('label', { class: 'chk', title }, inp, h('span', null, label));
    el.input = inp;
    return el;
  };
  U.card = (title, ...children) => h('div', { class: 'card' }, title ? h('h3', null, title) : null, ...children);
  U.row = (...c) => h('div', { class: 'row' }, ...c);
  U.field = (label, input) => h('label', { class: 'field' }, h('span', null, label), input);
  U.hint = (text) => h('p', { class: 'hint', html: text });
  U.matrix = (rows, digits, rowLabels, colLabels) => {
    const t = h('table', { class: 'matrix' });
    if (colLabels) t.appendChild(h('tr', null, rowLabels ? h('td') : null, colLabels.map((c) => h('td', { class: 'lbl', style: { textAlign: 'right' } }, c))));
    rows.forEach((r, i) =>
      t.appendChild(
        h(
          'tr',
          null,
          rowLabels ? h('td', { class: 'lbl' }, rowLabels[i]) : null,
          r.map((v) => h('td', { class: 'v' }, typeof v === 'number' ? v.toFixed(digits == null ? 2 : digits) : v))
        )
      )
    );
    return t;
  };
  U.copy = (text) => {
    try {
      navigator.clipboard.writeText(text);
      BS.toast('In die Zwischenablage kopiert', 'ok');
    } catch (e) {
      BS.toast('Kopieren nicht möglich', 'err');
    }
  };
  /** Gedrückt halten = wiederholen */
  U.repeatBtn = (label, fn, cls) => {
    const b = U.btn(label, null, cls);
    let t1 = null,
      t2 = null;
    const stop = () => {
      clearTimeout(t1);
      clearInterval(t2);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      t1 = setTimeout(() => (t2 = setInterval(fn, 90)), 350);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
    return b;
  };

  /** Bereich registrieren; def.group = Reiter, unter dem er erscheint (Standard: eigener Reiter) */
  U.register = function (id, def) {
    def.id = id;
    def.group = def.group || id;
    U.tabs.push(def);
  };
  const tabOf = (id) => U.tabs.find((t) => t.id === id);
  U.show = function (id) {
    let leaf = tabOf(id);
    if (!leaf) leaf = U.tabs.find((t) => t.group === id);
    if (!leaf) return;
    const top = leaf.group;
    for (const t of U.TOP) {
      t.btn.classList.toggle('active', t.id === top);
      t.pane.classList.toggle('active', t.id === top);
    }
    for (const t of U.tabs) {
      t.pane.classList.toggle('active', t === leaf);
      if (t.subBtn) t.subBtn.classList.toggle('active', t === leaf);
    }
    U.lastSub[top] = leaf.id;
    const prev = U.active;
    U.active = leaf.id;
    U.activeTop = top;
    if (prev !== leaf.id) {
      const p = tabOf(prev);
      if (p && p.leave) p.leave();
      BS.view.ghostPose = null;
      if (leaf.enter) leaf.enter();
    }
    BS.store.set('tab', leaf.id);
  };
  U.activeTitle = () => {
    const top = U.TOP.find((t) => t.id === U.activeTop);
    const leaf = tabOf(U.active);
    if (!top) return '';
    return top.title + (leaf && leaf.title !== top.title ? ' · ' + leaf.title : '');
  };

  // ------------------------------------------------------------------
  // Farbschema
  // ------------------------------------------------------------------
  let themeBtn;
  U.setTheme = function (t) {
    document.documentElement.dataset.theme = t;
    BS.store.set('theme', t);
    if (themeBtn) {
      themeBtn.textContent = t === 'light' ? '☾' : '☀';
      themeBtn.title = t === 'light' ? 'Dunkle Darstellung (Dark Mode)' : 'Helle Darstellung';
    }
    BS.emit('theme', t);
  };

  // ------------------------------------------------------------------
  // Werkzeugleiste über der 3D-Ansicht
  // ------------------------------------------------------------------
  let elStatus, elTime, elPause, elHold, camSel, recDataBtn, recVideoBtn, recBadge, demoBtn;
  function buildToolbar() {
    const tb = document.getElementById('toolbar');
    // feste Breite: wechselnde Statustexte dürfen die Knöpfe rechts daneben nicht verschieben
    elStatus = h('span', { class: 'pill ok status-pill' }, h('span', { class: 'pill-txt' }, 'Bereit'));
    elTime = h('span', { class: 'simtime' }, 't = 0.00 s');
    elPause = U.btn('❚❚', () => U.togglePause(), 'icon', 'Simulation anhalten / fortsetzen (P)');
    elHold = U.btn('✋', () => U.toggleHold(), 'icon', 'Roboterbewegung anhalten / fortsetzen – Zeit und Förderband laufen weiter (Leertaste)');
    const speed = U.sel(
      [
        ['0.25', '0.25×'],
        ['0.5', '0.5×'],
        ['1', '1×'],
        ['2', '2×'],
        ['5', '5×'],
        ['10', '10×'],
      ],
      '1',
      (v) => (BS.sim.speed = +v)
    );
    speed.title = 'Simulationsgeschwindigkeit';
    const toggles = [
      ['tcp', 'TCP', 'TCP-Punkt (orange) anzeigen'],
      ['labels', 'Text', 'Beschriftungen im 3D-Bild anzeigen (Behälter, Maßstab, Förderband …)'],
      ['frames', 'KS', 'DH-Koordinatensysteme anzeigen'],
      ['trace', 'Spur', 'TCP-Spur anzeigen'],
      ['path', 'Pfad', 'Geplante Trajektorie anzeigen'],
      ['zones', 'Zonen', 'Sperrzonen/Arbeitsbereiche anzeigen'],
    ].map(([k, l, t]) => {
      const b = U.btn(l, () => {
        BS.view.show[k] = !BS.view.show[k];
        b.classList.toggle('on', BS.view.show[k]);
        BS.view.applyShow();
      }, 'chip' + (BS.view.show[k] ? ' on' : ''), t);
      b.dataset.show = k;
      return b;
    });
    U.syncToggles = () => toggles.forEach((b) => b.classList.toggle('on', !!BS.view.show[b.dataset.show]));
    camSel = U.sel(
      BS.view.VIEWS.map(([k, l, key]) => [k, `${key}  ${l}`]),
      'iso',
      (v) => BS.view.setView(v)
    );
    camSel.title = 'Ansicht (Tasten 1–8, 0 = Greiferkamera)';
    BS.on('view', (v) => camSel && (camSel.value = v));
    recDataBtn = U.btn('⏺ Daten', () => (BS.rec.data ? BS.rec.stopData() : BS.rec.startData()), 'chip rec', 'Messdaten aufzeichnen (Soll/Ist, TCP, Greifer mit 100 Hz) – erneut klicken: Stopp und CSV speichern');
    recVideoBtn = U.btn('⏺ Video', () => (BS.rec.video ? BS.rec.stopVideo() : BS.rec.startVideo()), 'chip rec', 'Video der 3D-Ansicht mit Messschrieben aufnehmen – erneut klicken: Stopp und MP4 speichern');
    BS.on('rec', updateRecButtons);
    tb.append(
      elStatus,
      elTime,
      elPause,
      elHold,
      speed,
      U.btn('↺', () => {
        BS.sim.reset();
        BS.toast('Simulation zurückgesetzt');
      }, 'chip', 'Simulation, Roboter und Szenario zurücksetzen'),
      h('span', { class: 'sep' }),
      ...toggles,
      U.btn('⌫', () => BS.view.clearTrace(), 'chip', 'TCP-Spur löschen'),
      h('span', { class: 'grow' }),
      camSel,
      h('span', { class: 'sep' }),
      recDataBtn,
      recVideoBtn
    );
    demoBtn = document.getElementById('demoBtn');
    if (demoBtn) demoBtn.addEventListener('click', () => U.startDemo());
    recBadge = document.getElementById('recBadge');
  }
  function updateRecButtons() {
    const R = BS.rec;
    recDataBtn.classList.toggle('on', !!R.data);
    recVideoBtn.classList.toggle('on', !!R.video);
    recDataBtn.textContent = R.data ? '■ Daten ' + R.dataInfo() : '⏺ Daten';
    recVideoBtn.textContent = R.video ? '■ Video ' + R.videoInfo() : '⏺ Video';
    const parts = [];
    if (R.video) parts.push('REC Video ' + R.videoInfo());
    if (R.data) parts.push('Messdaten ' + R.dataInfo());
    recBadge.textContent = parts.join(' · ');
    recBadge.classList.toggle('show', parts.length > 0);
  }

  U.togglePause = function () {
    BS.sim.paused = !BS.sim.paused;
    BS.toast(BS.sim.paused ? 'Simulation angehalten – P setzt fort' : 'Simulation läuft');
  };
  U.toggleHold = function () {
    BS.sim.hold = !BS.sim.hold;
    BS.toast(BS.sim.hold ? 'Roboterbewegung angehalten – Leertaste setzt fort (Zeit läuft weiter)' : 'Roboterbewegung fortgesetzt');
  };

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  let hudTcp, hudJoints, hudMon, hudGrip, hudEstop, hudPause;
  function buildHud() {
    const hud = document.getElementById('hud');
    hudTcp = h('div', { class: 'box' });
    hudJoints = h('div', { class: 'box' });
    hud.append(hudTcp, hudJoints);
    const hr = document.getElementById('hudRight');
    hudEstop = h('div', { class: 'estop' }, h('span', null, '⛔ NOT-HALT'), h('span', { class: 'reason', style: { fontWeight: 500 } }), U.btn('Quittieren', () => BS.sim.ackEstop(), 'small'));
    hudPause = h('div', { class: 'box pausebox' });
    hudMon = h('div', { class: 'box monbox' });
    hudGrip = h('div', { class: 'box' });
    hr.append(hudEstop, hudPause, hudMon, hudGrip);
    BS.on('estop', () => {
      hudEstop.classList.toggle('show', BS.sim.estop);
      hudEstop.querySelector('.reason').textContent = BS.sim.estopReason;
    });
  }
  function updateHud() {
    const sim = BS.sim;
    const T = sim.F[5];
    const p = BS.kin.tcp(sim.trueAngles());
    hudTcp.innerHTML = `<b>TCP</b>&nbsp; x ${BS.fmt(T[3])} &nbsp;y ${BS.fmt(T[7])} &nbsp;z ${BS.fmt(T[11])} mm<br><b>ψ</b> ${BS.fmt(p.psi)}° &nbsp;<b>r</b> ${BS.fmt(Math.hypot(T[3], T[7]))} mm &nbsp;<b>v</b> ${BS.fmt(sim.tcpVel, 0)} mm/s`;
    let rows = '<tr><td></td><td><b>Soll</b></td><td><b>Ist</b></td></tr>';
    for (let i = 0; i < 6; i++) rows += `<tr><td style="color:${C.colors[i]}">${C.short[i]}</td><td>${BS.fmt(sim.cmd[i])}</td><td>${BS.fmt(sim.act[i])}</td></tr>`;
    hudJoints.innerHTML = `<table>${rows}</table>`;
    hudPause.style.display = sim.paused || sim.hold ? '' : 'none';
    hudPause.innerHTML = sim.paused ? '❚❚ SIMULATION ANGEHALTEN · P setzt fort' : '✋ BEWEGUNG ANGEHALTEN · Leertaste setzt fort';
    const mon = BS.monitor;
    if (!mon.enabled) {
      hudMon.className = 'box monbox';
      hudMon.innerHTML = '<span class="muted">Überwachung aus</span>';
    } else {
      hudMon.className = 'box monbox ' + (mon.state === 'ok' ? '' : mon.state);
      hudMon.innerHTML =
        mon.state === 'ok'
          ? '<span class="ok">● Arbeitsraum OK</span>'
          : mon.issues
              .slice(0, 4)
              .map((i) => `<div class="${i.level === 'viol' ? 'err' : 'warn'}">● ${i.msg}</div>`)
              .join('');
    }
    const w = sim.jawWidth();
    hudGrip.innerHTML = `<b>Greifer</b> ${BS.fmt(w, 0)} mm${sim.held ? ` · <span class="ok">hält ${sim.held.obj.name}</span>` : ''}`;
  }

  function updateToolbar() {
    const sim = BS.sim;
    elTime.textContent = 't = ' + sim.t.toFixed(2) + ' s';
    elPause.textContent = sim.paused ? '▶' : '❚❚';
    elPause.classList.toggle('on', sim.paused);
    elHold.classList.toggle('on', sim.hold);
    if (demoBtn) demoBtn.disabled = !!(BS.cosim && BS.cosim.enabled); // keine Demo während der Co-Simulation
    let cls = 'pill ok',
      txt = 'Manuell';
    if (sim.estop) (cls = 'pill err'), (txt = 'NOT-HALT');
    else if (BS.auto && BS.auto.running) (cls = 'pill run'), (txt = 'Automatik · ' + BS.auto.status);
    else if (sim.owner === 'traj') (cls = 'pill run'), (txt = sim.play ? sim.play.label : 'Trajektorie');
    else if (BS.cosim && BS.cosim.live) (cls = 'pill run'), (txt = 'Co-Simulation · Simulink');
    if (sim.hold) txt += ' · Bewegung angehalten';
    if (sim.paused) txt += ' · Simulation angehalten';
    elStatus.className = cls + ' status-pill';
    if (elStatus.firstChild.textContent !== txt) {
      elStatus.firstChild.textContent = txt;
      elStatus.title = txt; // vollständiger Text, falls abgeschnitten
    }
    if (BS.rec.data || BS.rec.video) updateRecButtons();
  }

  // ------------------------------------------------------------------
  // Scope (Zeitverläufe Soll/Ist): Gelenkwinkel, TCP-Position, TCP-Euler-Winkel, TCP-Geschwindigkeit
  // ------------------------------------------------------------------
  /** Darstellbare Größen: Kanäle mit Name, Farbe und Zugriff auf Ist/Soll eines Scope-Eintrags */
  const SIGNALS = {
    joints: {
      label: 'Gelenkwinkel [°]',
      ch: C.short.map((n, i) => ({ name: n, color: C.colors[i], ist: (s) => s.act[i], soll: (s) => s.cmd[i] })),
      yRange: [-5, 185],
    },
    pos: {
      label: 'TCP-Position [mm]',
      ch: ['x', 'y', 'z'].map((n, i) => ({ name: n, color: ['#f03e3e', '#37b24d', '#1c7ed6'][i], ist: (s) => s.p && s.p[i], soll: (s) => s.ps && s.ps[i] })),
    },
    euler: {
      label: 'TCP-Euler-Winkel Z-Y-X [°]',
      ch: [
        ['α (z)', '#f76707'],
        ['β (y)', '#0ca678'],
        ['γ (x)', '#7048e8'],
      ].map(([n, c], i) => ({ name: n, color: c, ist: (s) => s.e && s.e[i], soll: (s) => s.es && s.es[i], wrap: true })),
      yRange: [-185, 185],
    },
    v: { label: 'TCP-Geschwindigkeit [mm/s]', ch: [{ name: 'v_TCP', color: '#19b6ae', ist: (s) => s.v, noSoll: true }] },
  };
  const SCOPE_DEF = { sig: 'joints', on: { joints: [true, true, true, true, false, false], pos: [true, true, true], euler: [true, true, true], v: [true] }, soll: true, ist: true, win: 10, open: true };
  /** gespeicherten Zustand mit den Standardwerten zusammenführen (ältere Versionen hatten andere Felder) */
  function loadScopeState() {
    const st = Object.assign({}, SCOPE_DEF, BS.store.get('scope', {}));
    if (!SIGNALS[st.sig]) st.sig = 'joints';
    st.on = Object.assign({}, SCOPE_DEF.on, st.on || {});
    for (const k in SIGNALS) if (!Array.isArray(st.on[k]) || st.on[k].length !== SIGNALS[k].ch.length) st.on[k] = SCOPE_DEF.on[k].slice();
    if (![5, 10, 30, 60].includes(+st.win)) st.win = 10;
    delete st.j;
    delete st.v;
    return st;
  }
  let scopePlot,
    scopeEl,
    chanEl,
    setScopeOpen = () => {},
    scopeState = loadScopeState();
  function buildScope() {
    scopeEl = document.getElementById('scope');
    const cv = h('canvas');
    scopePlot = new BS.Plot(cv);
    const save = () => BS.store.set('scope', scopeState);
    const toggle = U.btn(scopeState.open ? '▾ Scope' : '▸ Scope', () => setScopeOpen(!scopeState.open), 'small');
    setScopeOpen = (open) => {
      scopeState.open = open;
      toggle.textContent = open ? '▾ Scope' : '▸ Scope';
      scopeEl.classList.toggle('collapsed', !open);
      save();
      BS.view.resize();
    };
    const sigSel = U.sel(
      Object.entries(SIGNALS).map(([k, s]) => [k, s.label]),
      scopeState.sig,
      (v) => {
        scopeState.sig = v;
        save();
        renderChannels();
      }
    );
    sigSel.title = 'Dargestellte Größe';
    chanEl = h('span', { style: { display: 'inline-flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } });
    const sollChk = U.chk('Soll (gestrichelt)', scopeState.soll, (v) => {
      scopeState.soll = v;
      save();
    });
    const istChk = U.chk('Ist', scopeState.ist, (v) => {
      scopeState.ist = v;
      save();
    });
    function renderChannels() {
      const sig = SIGNALS[scopeState.sig];
      chanEl.innerHTML = '';
      sig.ch.forEach((c, i) =>
        chanEl.appendChild(
          U.chk(h('span', { style: { color: c.color, fontWeight: 600 } }, c.name), scopeState.on[scopeState.sig][i], (v) => {
            scopeState.on[scopeState.sig][i] = v;
            save();
          })
        )
      );
      const noSoll = sig.ch.every((c) => c.noSoll);
      sollChk.style.display = istChk.style.display = noSoll ? 'none' : '';
    }
    const head = h(
      'div',
      { class: 'head' },
      toggle,
      sigSel,
      chanEl,
      h('span', { class: 'sep' }),
      sollChk,
      istChk,
      h('span', { class: 'grow' }),
      U.sel(
        [
          ['5', '5 s'],
          ['10', '10 s'],
          ['30', '30 s'],
          ['60', '60 s'],
        ],
        String(scopeState.win),
        (v) => {
          scopeState.win = +v;
          save();
        }
      )
    );
    renderChannels();
    scopeEl.append(head, cv);
    scopeEl.classList.toggle('collapsed', !scopeState.open);
  }
  /** Kanal als Punktfolge; bei Winkeln Sprünge über ±180° auftrennen */
  function series(data, get, wrap) {
    const out = [];
    let prev = null;
    for (const s of data) {
      const v = get(s);
      if (v == null || !Number.isFinite(v)) continue;
      if (wrap && prev != null && Math.abs(v - prev) > 180) out.push([s.t, NaN]);
      out.push([s.t, v]);
      prev = v;
    }
    return out;
  }
  /** Zeichenoptionen des Scopes (auch für das Videobild) */
  U.scopeOptions = function () {
    const sim = BS.sim;
    const t1 = sim.t,
      t0 = t1 - scopeState.win;
    let a = sim.scope.length;
    while (a > 0 && sim.scope[a - 1].t >= t0) a--;
    const data = sim.scope.slice(a);
    const sig = SIGNALS[scopeState.sig];
    const on = scopeState.on[scopeState.sig];
    const out = [];
    sig.ch.forEach((c, i) => {
      if (!on[i]) return;
      const ist = scopeState.ist || c.noSoll;
      if (ist) out.push({ name: c.name, color: c.color, data: series(data, c.ist, c.wrap) });
      if (scopeState.soll && !c.noSoll) out.push({ name: ist ? null : c.name, color: c.color, dash: [4, 3], width: 1, data: series(data, c.soll, c.wrap) });
    });
    return { series: out, xRange: [Math.max(0, t0), Math.max(t1, scopeState.win)], xLabel: 't [s]', yRange: sig.yRange || null, title: sig.label };
  };
  function updateScope() {
    if (!scopeState.open) return;
    scopePlot.draw(U.scopeOptions());
  }

  // ------------------------------------------------------------------
  // Tastatur
  //   global: Leertaste Pause, 1–6 / 0 Ansichten
  //   Manuelle Steuerung: A/D Basis, ↑/↓ Schulter, W/S Ellbogen, ←/→ Handgelenk, T/G Handrotation, Strg Greifer auf/zu
  // ------------------------------------------------------------------
  // [Gelenk, Richtung]; „Senken“ = Servowinkel größer (Glied neigt sich nach vorne unten)
  U.JOG_KEYS = {
    a: [0, +1],
    d: [0, -1],
    arrowup: [1, -1],
    arrowdown: [1, +1],
    w: [2, +1],
    s: [2, -1],
    arrowleft: [3, -1],
    arrowright: [3, +1],
    t: [4, +1],
    g: [4, -1],
  };
  const JOG_RATE = [60, 45, 50, 60, 90]; // °/s je Gelenk bei Tempo 1
  U.jogSpeed = BS.store.get('jogSpeed', 1);
  U.setJogSpeed = function (v) {
    U.jogSpeed = v;
    BS.store.set('jogSpeed', v);
    BS.emit('jogSpeed', v);
  };
  U.keysHeld = new Set();
  let ctrlArmed = false;
  const typing = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)));
  const keyName = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());

  function onKeyDown(e) {
    if (typing(e.target)) return;
    const k = keyName(e);
    if (k === 'control') {
      if (!e.repeat) ctrlArmed = true;
      U.keysHeld.add('control');
      BS.emit('keys');
      return;
    }
    ctrlArmed = false;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Browser-Kürzel nicht abfangen
    if (k === 'escape' && U.demoState) {
      e.preventDefault();
      U.stopDemo();
      return;
    }
    if (k === 'f1' || (k === 'escape' && U.fullState)) {
      e.preventDefault(); // F1 öffnet sonst die Browser-Hilfe
      if (!e.repeat && (k === 'f1' || U.fullState)) U.toggleFull();
      return;
    }
    if (k === ' ') {
      e.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (!e.repeat) U.toggleHold();
      return;
    }
    if (k === 'p' && !e.repeat) {
      e.preventDefault();
      U.togglePause();
      return;
    }
    const views = { 1: 'iso', 2: 'vorne', 3: 'hinten', 4: 'links', 5: 'rechts', 6: 'oben', 7: 'stativ', 8: 'demo', 0: 'greifer' };
    const code = e.code && e.code.startsWith('Numpad') ? e.code.slice(6) : k;
    if (views[code] && !e.repeat) {
      e.preventDefault();
      BS.view.setView(views[code]);
      return;
    }
    if (U.JOG_KEYS[k] && U.active === 'joints') {
      e.preventDefault();
      if (!U.keysHeld.has(k)) {
        U.keysHeld.add(k);
        BS.emit('keys');
      }
    }
  }
  function onKeyUp(e) {
    const k = keyName(e);
    if (k === 'control') {
      U.keysHeld.delete('control');
      BS.emit('keys');
      if (ctrlArmed && U.active === 'joints' && !typing(e.target)) U.toggleGripper();
      ctrlArmed = false;
      return;
    }
    if (U.keysHeld.delete(k)) BS.emit('keys');
  }
  U.toggleGripper = function () {
    const sim = BS.sim;
    const open = sim.cmd[5] > (C.gripper.open + C.gripper.closed) / 2;
    if (!sim.setManual([null, null, null, null, null, open ? C.gripper.open : C.gripper.closed])) BS.toast(sim.lockMsg(), 'warn');
  };
  /** Gehaltene Tasten → Gelenk-Sollwerte (in Echtzeit, ruht während der Pause) */
  U.tick = function (dt) {
    if (U.active !== 'joints' || !U.keysHeld.size || BS.sim.paused) return;
    const sim = BS.sim;
    const d = [0, 0, 0, 0, 0, 0];
    let any = false;
    for (const k of U.keysHeld) {
      const j = U.JOG_KEYS[k];
      if (!j) continue;
      d[j[0]] += j[1] * JOG_RATE[j[0]] * U.jogSpeed * dt;
      any = true;
    }
    if (!any) return;
    const m = sim.cmd.map((v, i) => (d[i] ? BS.clamp(v + d[i], C.limits[i][0], C.limits[i][1]) : null));
    if (!sim.setManual(m)) BS.toast(sim.lockMsg(), 'warn');
  };

  // ------------------------------------------------------------------
  // Demo-Modus: Vollbild, Förderband im Endlosbetrieb, Greiferkamera eingeblendet, Scope bleibt sichtbar
  // ------------------------------------------------------------------
  U.demoState = null;
  function demoRun() {
    const d = U.demoState;
    if (!d) return;
    const sim = BS.sim;
    if (sim.scenario !== 'band') sim.loadScenario('band');
    const cv = sim.conveyor;
    cv.mode = 'auto';
    cv.autoSpawn = true;
    if (sim.estop) sim.ackEstop();
    BS.auto.runBand();
  }
  U.startDemo = function () {
    if (U.demoState) return;
    if (BS.cosim && BS.cosim.enabled) {
      BS.toast('Demo nicht möglich, solange die Verbindung zu Simulink aktiv ist (Reiter Co-Simulation → Trennen)', 'warn');
      return;
    }
    if (U.fullState) U.toggleFull();
    const sim = BS.sim,
      V = BS.view;
    U.demoState = { pip: V.pip, pipScale: V.pipScale, view: V.viewName, speed: sim.speed, scope: scopeState.open, trace: V.show.trace, scenario: sim.scenario, gripCam: V.gripCam, fs: false };
    V.gripCam = true; // Demo zeigt die Greiferkamera
    // Spur wie über den Schalter „Spur“ eingestellt; in der Demo leer beginnend und kürzer (rollend über etwa zwei Sortierzyklen)
    U.demoState.traceMax = sim.traceMax;
    sim.traceMax = 1500;
    V.clearTrace();
    U.syncToggles();
    document.body.classList.add('demo');
    const de = document.documentElement;
    if (de.requestFullscreen)
      de.requestFullscreen()
        .then(() => U.demoState && (U.demoState.fs = true))
        .catch(() => {});
    sim.paused = false;
    sim.hold = false;
    sim.speed = 1;
    if (!scopeState.open) setScopeOpen(true);
    sim.loadScenario('band');
    V.pip = 'greifer'; // nicht speichern: nach der Demo gilt wieder die eigene Einstellung
    V.pipScale = 0.3;
    BS.emit('pip', V.pip);
    setTimeout(() => {
      V.resize();
      V.setView('demo', { fly: true }); // erst Rundflug um den Roboter, dann Demo-Ansicht
    }, 80);
    demoRun();
  };
  U.stopDemo = function () {
    const d = U.demoState;
    if (!d) return;
    U.demoState = null;
    BS.auto.stop('Demo beendet');
    const sim = BS.sim,
      V = BS.view;
    sim.speed = d.speed;
    sim.loadScenario(d.scenario); // vorheriges Szenario wiederherstellen
    document.body.classList.remove('demo');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (!d.scope) setScopeOpen(false);
    V.pip = d.pip;
    V.pipScale = d.pipScale;
    V.show.trace = d.trace;
    sim.traceMax = d.traceMax;
    V.gripCam = d.gripCam;
    V.clearTrace();
    U.syncToggles();
    BS.emit('pip', V.pip);
    setTimeout(() => {
      V.resize();
      V.setView(d.view === 'demo' ? 'iso' : d.view);
    }, 80);
  };
  // ------------------------------------------------------------------
  // Vollbild (F1 / Controller R1): nur Hauptansicht (ggf. mit Greiferkamera) und Scope-Verläufe, in jeder Szene
  // ------------------------------------------------------------------
  U.fullState = null;
  U.toggleFull = function () {
    if (U.demoState) return;
    const V = BS.view;
    const d = U.fullState;
    if (!d) {
      U.fullState = { pip: V.pip, scope: scopeState.open, fs: false };
      document.body.classList.add('fullview');
      if (V.pip !== 'greifer') V.pip = null; // eingeblendete Greiferkamera bleibt; nicht speichern: danach gilt wieder die eigene Einstellung
      BS.emit('pip', V.pip);
      if (!scopeState.open) setScopeOpen(true);
      const de = document.documentElement;
      if (de.requestFullscreen && !document.fullscreenElement)
        de.requestFullscreen()
          .then(() => U.fullState && (U.fullState.fs = true))
          .catch(() => {});
    } else {
      U.fullState = null;
      document.body.classList.remove('fullview');
      V.pip = d.pip;
      BS.emit('pip', V.pip);
      if (!d.scope) setScopeOpen(false);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
    setTimeout(() => BS.view.resize(), 80);
  };

  // Automatik in der Demo nach Fehlern/Abbruch neu starten
  BS.on('auto', () => {
    if (U.demoState && !BS.auto.running) setTimeout(() => U.demoState && !BS.auto.running && demoRun(), 1500);
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && U.demoState && U.demoState.fs) U.stopDemo();
    if (!document.fullscreenElement && U.fullState && U.fullState.fs) U.toggleFull(); // Esc beendet auch das Vollbild
  });

  // ------------------------------------------------------------------
  // Init & Update
  // ------------------------------------------------------------------
  U.init = function () {
    document.querySelectorAll('.version').forEach((el) => (el.textContent = BS.VERSION));
    BS.showLastModified();
    themeBtn = document.getElementById('themeBtn');
    themeBtn.addEventListener('click', () => U.setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
    U.setTheme(BS.store.get('theme', 'dark'));
    buildToolbar();
    buildHud();
    buildScope();
    const tabsEl = document.getElementById('tabs'),
      panes = document.getElementById('panes');
    for (const top of U.TOP) {
      top.btn = h('button', { class: 'tab-btn', type: 'button', role: 'tab', onclick: () => U.show(U.lastSub[top.id] || top.id) }, top.title);
      top.pane = h('div', { class: 'pane' });
      tabsEl.appendChild(top.btn);
      panes.appendChild(top.pane);
      const kids = U.tabs.filter((t) => t.group === top.id);
      if (kids.length > 1) {
        const nav = h('div', { class: 'subnav' });
        for (const t of kids) {
          t.subBtn = h('button', { type: 'button', onclick: () => U.show(t.id) }, t.title);
          nav.appendChild(t.subBtn);
        }
        top.pane.appendChild(nav);
      }
      for (const t of kids) {
        t.pane = h('div', { class: 'pane' });
        top.pane.appendChild(t.pane);
        t.build(t.pane);
      }
    }
    if (U.buildEnv) U.buildEnv(document.getElementById('envPanel'));
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      U.keysHeld.clear();
      ctrlArmed = false;
      BS.emit('keys');
    });
    const st = BS.store.get('tab', 'joints');
    U.show(tabOf(st) ? st : 'joints');
  };

  let lastUi = 0,
    lastScope = 0;
  U.update = function (now) {
    if (now - lastUi > 80) {
      lastUi = now;
      updateToolbar();
      updateHud();
      const t = tabOf(U.active);
      if (t && t.update) t.update();
      if (U.updateEnv) U.updateEnv();
    }
    if (now - lastScope > 50) {
      lastScope = now;
      updateScope();
    }
  };
})();
