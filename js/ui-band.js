/* Reiter „Förderband-Szenario“: Bandantrieb, Lichtschranke, Würfel, Roboter-Automatik (Sortieren nach Farbe) */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h;

  let root, ledEl, autoEl, logEl, modeBtns;

  function renderLog() {
    if (!logEl) return;
    const A = BS.auto;
    logEl.innerHTML = A.log.length ? A.log.slice(0, 30).map((e) => `<div><span class="mono muted">${e.t.toFixed(1)} s</span> ${e.msg}</div>`).join('') : '<span class="muted">Noch keine Ereignisse.</span>';
  }
  BS.on('autolog', renderLog);
  BS.on('auto', () => U.active === 'band' && render());
  BS.on('scenario', () => root && render());

  function render() {
    const sim = BS.sim;
    const cv = sim.conveyor;
    root.innerHTML = '';
    ledEl = autoEl = logEl = null;
    if (!cv) {
      root.appendChild(
        U.card(
          'Förderband-Szenario',
          U.hint('Das Förderband-Szenario ist nicht geladen.'),
          U.row(
            U.btn('Förderband-Szenario laden', () => {
              sim.loadScenario('band');
              BS.store.set('scenario', 'band');
            }, 'primary')
          )
        )
      );
      return;
    }
    // Bandantrieb
    modeBtns = h(
      'div',
      { class: 'subnav', style: { marginBottom: '6px' } },
      [
        ['off', 'Aus'],
        ['on', 'Ein (Dauerlauf)'],
        ['auto', 'Automatik'],
      ].map(([k, l]) =>
        h(
          'button',
          {
            type: 'button',
            'data-mode': k,
            class: cv.mode === k ? 'active' : '',
            onclick: () => {
              cv.mode = k;
              for (const b of modeBtns.children) b.classList.toggle('active', b.dataset.mode === k);
            },
          },
          l
        )
      )
    );
    ledEl = h('div', { style: { margin: '6px 0' } });
    root.appendChild(
      U.card(
        'Bandantrieb & Lichtschranke',
        modeBtns,
        ledEl,
        U.row(U.field('Geschwindigkeit', U.num(cv.speed, (v) => (cv.speed = BS.clamp(v, 0, 300)), { cls: 'w52', step: 10 })), h('span', { class: 'muted' }, 'mm/s')),
        U.hint('<b>Automatik</b>: Das Band hält, solange die Lichtschranke (12 mm über dem Band, kurz vor dem Anschlag) belegt ist, und läuft weiter, sobald der Würfel entnommen wurde.')
      )
    );
    // Würfel
    root.appendChild(
      U.card(
        'Würfel (Kante 25 mm)',
        U.row(
          U.chk('automatisch nachlegen', cv.autoSpawn, (v) => (cv.autoSpawn = v)),
          U.field('alle', U.num(cv.interval, (v) => (cv.interval = Math.max(1, v)), { cls: 'w44' })),
          h('span', { class: 'muted' }, 's (zufällige Farbe)')
        ),
        U.row(
          ...sim.SORT_COLORS.map((c) => U.btn(h('span', null, h('span', { class: 'swatch', style: { background: c.hex } }), '+ ' + c.name), () => sim.spawnBox(c.key), 'small'))
        ),
        U.row(
          U.btn('Behälter leeren', () => sim.emptyBins(), 'small'),
          U.btn('Band leeren', () => {
            for (const o of sim.objects.filter((o) => !o.held && Math.abs(o.M[3] - cv.x) < cv.width / 2 + 5 && o.M[7] > cv.yEnd - 5)) sim.removeObject(o);
          }, 'small')
        ),
        U.hint('Das Band läuft radial auf den Roboter zu; der Anschlag liegt 150 mm vor der Roboterachse. In jedem Behälter liegen höchstens drei Würfel – kommt ein weiterer hinzu, wird zuvor der unterste entnommen.')
      )
    );
    // Roboter-Automatik
    const A = BS.auto;
    const sides = [
      ['links', 'Behälter links'],
      ['rechts', 'Behälter rechts'],
    ];
    const grid = h('div', { class: 'colormap' });
    for (const c of sim.SORT_COLORS)
      grid.append(
        h('span', { class: 'cname' }, h('span', { class: 'swatch', style: { background: c.hex } }), c.name),
        U.sel(sides, sim.bandMap[c.key] || 'links', (v) => {
          sim.bandMap[c.key] = v;
          BS.store.set('bandColorMap', sim.bandMap);
        }),
        h('span')
      );
    autoEl = h('div', { class: 'status' });
    logEl = h('div', { style: { maxHeight: '170px', overflow: 'auto', fontSize: '12px' } });
    const running = A.running && A.job === 'Förderband';
    root.appendChild(
      U.card(
        'Roboter-Automatik: nach Farbe sortieren',
        grid,
        U.row(U.sourceSel()),
        U.row(running ? U.btn('■ Automatik stoppen', () => A.stop(), 'danger') : U.btn('▶ Automatik starten', () => A.runBand(), 'primary')),
        autoEl,
        logEl,
        U.hint('Ablauf je Würfel: warten, bis die Lichtschranke belegt ist → anfahren → Farbsensor am Greifer bestimmt die Farbe → greifen → im zugeordneten Behälter ablegen → zurück in die Warteposition über dem Bandende.')
      )
    );
    renderLog();
  }

  U.register('band', {
    title: 'Förderband-Szenario',
    build(el) {
      root = el;
      render();
    },
    enter() {
      if (BS.sim.scenario !== 'band') {
        BS.sim.loadScenario('band');
        BS.store.set('scenario', 'band');
        BS.toast('Förderband-Szenario geladen');
      } else render();
    },
    update() {
      const sim = BS.sim;
      const cv = sim.conveyor;
      if (!cv || !ledEl) return;
      const led = (on, txt, g) => `<span class="led ${g ? 'green' : ''} ${on ? 'on' : ''}">${txt}</span>`;
      ledEl.innerHTML = led(cv.running, 'Band läuft', true) + led(cv.lsState, 'Lichtschranke belegt');
      const A = BS.auto;
      const mine = A.job === 'Förderband';
      autoEl.className = 'status' + (A.running && mine ? ' running' : '');
      autoEl.innerHTML = `Status: <b>${mine ? A.status : 'bereit'}</b> · links ${mine ? A.count.links : 0} · rechts ${mine ? A.count.rechts : 0}`;
    },
  });
})();
