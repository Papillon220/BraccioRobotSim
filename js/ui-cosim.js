/* Reiter „Co-Simulation“: Visualisierung eines Simulink-Modells mit den Blöcken Web Scene Configuration, Web Robot und Web Actor */
(function () {
  'use strict';
  const BS = window.BS,
    U = BS.ui,
    h = BS.h;
  const R2D = 180 / Math.PI;
  const FILES = ['BraccioWebScene.m', 'BraccioWebRobot.m', 'BraccioWebActor.m', 'BraccioWebHub.m', 'BraccioWebViz_ersetzen.m', 'BraccioWebViz_test.m'];

  let connBtn, urlIn, statusEl, actorsEl, valuesEl;

  /** Liste der Akteure aus Simulink, je Akteur ein-/ausblendbar */
  function renderActors() {
    if (!actorsEl) return;
    const CS = BS.cosim;
    actorsEl.innerHTML = '';
    if (!CS.actors.length) {
      actorsEl.appendChild(U.hint('Noch keine Szene empfangen – die Akteure erscheinen hier, sobald die Simulation läuft und verbunden ist.'));
      return;
    }
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '2px 12px' } });
    for (const a of CS.actors) {
      const label = a.n.replace(/^(actor|Actor)_?/, '') || a.n;
      const c = Array.isArray(a.c0) && a.c0.length ? a.c0 : [0.5, 0.5, 0.5];
      const chk = U.chk(label, !CS.hidden.has(a.n), (v) => CS.setHidden(a.n, !v), `${a.n} · ${a.shape} ${(a.size || []).map((v) => v * 1000).join(' × ')} mm`);
      chk.insertBefore(h('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: a.shape === 'sphere' ? '50%' : '2px', background: `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`, marginRight: '2px' } }), chk.lastChild);
      grid.appendChild(chk);
    }
    actorsEl.append(
      grid,
      U.row(
        U.btn('alle zeigen', () => {
          CS.actors.forEach((a) => CS.setHidden(a.n, false));
          renderActors();
        }, 'small')
      )
    );
  }
  BS.on('cosimScene', renderActors);

  function step(n, html) {
    return h('li', { html: `<b>${n}.</b> ${html}` });
  }

  U.register('cosim', {
    title: 'Co-Simulation',
    build(el) {
      const CS = BS.cosim;
      urlIn = h('input', { type: 'text', value: CS.url, class: 'mono', style: { width: '190px' }, spellcheck: false });
      urlIn.addEventListener('change', () => CS.setUrl(urlIn.value));
      connBtn = U.btn('Verbinden', () => (CS.enabled ? CS.stop() : (CS.setUrl(urlIn.value), CS.start())), 'primary');
      statusEl = h('div', { class: 'status' });
      el.appendChild(
        U.card(
          'Verbindung zu Simulink',
          U.row(U.field('Adresse', urlIn), connBtn),
          statusEl,
          U.hint(
            'BraccioSim verbindet sich mit dem Block <b>Web Scene Configuration</b> im Simulink-Modell und versucht es automatisch erneut, bis die Simulation läuft. Solange Daten eintreffen, führt Simulink den Roboter; die Bedienung im Simulator ist dann gesperrt. ' +
              'Chrome und Edge fragen beim ersten Mal, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf – bitte zulassen. Safari blockiert die Verbindung von der Online-Version aus; dort den Simulator lokal starten (start.command) oder Chrome/Firefox verwenden.'
          )
        )
      );

      actorsEl = h('div');
      el.appendChild(U.card('Akteure aus Simulink', actorsEl, U.hint('Form, Farbe, Lage und Transparenz kommen aus den Web-Actor-Blöcken (wie bisher aus den Unreal-Akteuren). Hier lassen sich einzelne Akteure zusätzlich ausblenden.')));
      renderActors();

      valuesEl = h('div');
      el.appendChild(U.card('Empfangene Werte', valuesEl));

      const links = FILES.map((f) => `<a href="matlab-cosim/${f}" download>${f}</a>`).join(', ');
      el.appendChild(
        U.card(
          'Einrichtung in MATLAB/Simulink',
          h(
            'ol',
            { class: 'steps', style: { paddingLeft: '0', listStyle: 'none', margin: '0 0 8px', display: 'grid', gap: '5px', fontSize: '12.5px' } },
            step(1, `Dateien in den Ordner des Simulink-Modells legen: ${links}.`),
            step(2, 'Verbindung ohne Simulink prüfen: <span class="mono">BraccioWebViz_test</span> in MATLAB starten, hier „Verbinden“ – der Roboter bewegt sich eine Minute lang.'),
            step(3, 'Ini-Skript ausführen, dann <span class="mono">BraccioWebViz_ersetzen(\'Braccio_CtrlSimMdl\')</span>: ersetzt jeden Unreal-Block durch den passenden Web-Block (Scene Configuration, Robot, Actor) mit denselben Parametern und Verbindungen. Modell unter neuem Namen speichern.'),
            step(4, 'Simulation starten (auf Echtzeit gebremst, z. B. mit Simulation Pacing), hier „Verbinden“.')
          ),
          U.hint('Die Web-Blöcke sind MATLAB-System-Blöcke (Interpreted execution) und benötigen MATLAB/Simulink ab R2021a, keine Toolbox. Web Scene Configuration öffnet einen WebSocket-Server auf Port 8766 nur für diesen Rechner und sendet alle 20 ms ein Bild (Parameter <span class="mono">SampleTime</span>).')
        )
      );
    },
    enter() {
      // Labor-Szenario als Ausgangsbild; sobald Simulink sendet, zeigt BraccioSim die Szene aus dem Modell
      if (!BS.cosim.live && BS.sim.scenario !== 'labor2') {
        BS.sim.loadScenario('labor2');
        BS.store.set('scenario', 'labor2');
      }
      BS.cosim.camRule();
    },
    leave() {
      BS.cosim.camRule();
    },
    update() {
      const CS = BS.cosim,
        sim = BS.sim;
      connBtn.textContent = CS.enabled ? 'Trennen' : 'Verbinden';
      connBtn.classList.toggle('primary', !CS.enabled);
      const m = CS.msg;
      if (CS.live) {
        statusEl.className = 'status running';
        statusEl.innerHTML = `<b>● Live</b> – Simulink t = ${m.t != null ? m.t.toFixed(2) : '–'} s · ${CS.rate.toFixed(0)} Bilder/s · ${CS.actors.length} Akteure`;
      } else if (CS.state === 'open') {
        statusEl.className = 'status';
        statusEl.innerHTML = 'Verbunden – warte auf Daten …';
      } else if (CS.state === 'connecting') {
        statusEl.className = 'status';
        statusEl.innerHTML = 'Warte auf Simulink … (Simulation mit Web Scene Configuration starten)';
      } else {
        statusEl.className = 'status';
        statusEl.innerHTML = 'Nicht verbunden.';
      }
      const T = sim.F[5];
      const p = BS.labScene.toLab([T[3], T[7], T[11]]);
      const q = CS.live && m ? m.q : null;
      const cell = (v) => `<td class="num">${v}</td>`;
      valuesEl.innerHTML =
        `<table class="tbl"><tr><th></th>${['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].map((k) => `<th class="num">${k}</th>`).join('')}</tr>` +
        `<tr><td>Simulink [°]</td>${q ? q.slice(0, 5).map((v) => cell((v * R2D).toFixed(1))).join('') + cell(m.q6 != null ? (m.q6 * R2D).toFixed(1) : '–') : '<td colspan="6" class="muted">keine Daten</td>'}</tr>` +
        `<tr><td>Servo M [°]</td>${sim.act.map((v) => cell(v.toFixed(1))).join('')}</tr></table>` +
        `<div class="hint">TCP im Labor-KS0: <span class="mono">x ${p[0].toFixed(3)} · y ${p[1].toFixed(3)} · z ${p[2].toFixed(3)} m</span></div>`;
    },
  });
})();
