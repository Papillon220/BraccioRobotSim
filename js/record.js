/* BraccioSim – Aufzeichnung
 *  - Messdaten: Soll/Ist aller Gelenke, TCP-Pose, TCP-Geschwindigkeit, Greifer mit 100 Hz (Simulationszeit) → CSV
 *  - Video: 3D-Ansicht mit HUD und darunter die Messschriebe (Scope) → MP4 (H.264), sonst WebM
 */
(function () {
  'use strict';
  const BS = window.BS;
  const C = BS.config;

  const R = (BS.rec = { data: null, video: null });

  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  const cssVar = (n, def) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || def;

  // ------------------------------------------------------------------
  // Messdaten
  // ------------------------------------------------------------------
  const DT = 0.01;
  function sampler(dt) {
    const d = R.data;
    if (!d) return;
    d.acc += dt;
    if (d.acc + 1e-9 < DT) return;
    d.acc = 0;
    const sim = BS.sim;
    const T = sim.F[5];
    const p = BS.kin.tcp(sim.trueAngles());
    d.rows.push([
      (sim.t - d.t0).toFixed(3),
      ...sim.cmd.map((v) => v.toFixed(2)),
      ...sim.act.map((v) => v.toFixed(2)),
      T[3].toFixed(2),
      T[7].toFixed(2),
      T[11].toFixed(2),
      p.psi.toFixed(2),
      ...sim.euler(T).map((v) => v.toFixed(2)),
      sim.tcpVel.toFixed(1),
      sim.jawWidth().toFixed(1),
      sim.held ? sim.held.obj.name : '',
      sim.play ? sim.play.label : sim.owner === 'manual' ? 'manuell' : sim.owner,
    ]);
    if (d.rows.length > 360000) R.stopData(); // max. 1 h
  }
  R.startData = function () {
    if (R.data) return;
    R.data = { t0: BS.sim.t, rows: [], acc: DT, wall: performance.now() };
    BS.sim.preStep.push(sampler);
    BS.toast('Messdatenaufzeichnung läuft (100 Hz)', 'ok');
    BS.emit('rec');
  };
  R.stopData = function () {
    const d = R.data;
    if (!d) return;
    R.data = null;
    const i = BS.sim.preStep.indexOf(sampler);
    if (i >= 0) BS.sim.preStep.splice(i, 1);
    const head = ['t_s', ...C.short.map((n) => n + '_soll_deg'), ...C.short.map((n) => n + '_ist_deg'), 'x_mm', 'y_mm', 'z_mm', 'psi_deg', 'euler_a_z_deg', 'euler_b_y_deg', 'euler_g_x_deg', 'v_tcp_mm_s', 'greifer_mm', 'objekt', 'modus'];
    const csv = '# BraccioSim ' + BS.VERSION + ' – Messdaten, Szenario: ' + BS.sim.scenarios[BS.sim.scenario].name + '\n' + head.join(';') + '\n' + d.rows.map((r) => r.join(';')).join('\n') + '\n';
    BS.download('braccio_messdaten_' + stamp() + '.csv', csv, 'text/csv');
    BS.toast(`Messdaten gespeichert: ${d.rows.length} Zeilen`, 'ok');
    BS.emit('rec');
  };
  R.dataInfo = () => (R.data ? `${((R.data.rows.length * DT) | 0).toString()} s` : '');

  // ------------------------------------------------------------------
  // Video
  // ------------------------------------------------------------------
  const MIMES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  R.videoSupported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  R.mp4Supported = () => R.videoSupported() && MIMES.slice(0, 4).some((m) => MediaRecorder.isTypeSupported(m));

  R.startVideo = function () {
    if (R.video) return;
    if (!R.videoSupported()) return BS.toast('Videoaufnahme wird von diesem Browser nicht unterstützt', 'err');
    const src = BS.view.canvas();
    if (!src || !src.width) return;
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    // Ausgabegröße: Breite max. 1920 px, alle Maße gerade (H.264)
    const ev = (n) => Math.round(n / 2) * 2;
    const W = ev(Math.min(1920, Math.max(960, src.width)));
    const viewH = ev((src.height / src.width) * W);
    const headH = ev(W * 0.026 + 14);
    const scopeH = ev(Math.max(220, W * 0.17));
    const comp = document.createElement('canvas');
    comp.width = W;
    comp.height = headH + viewH + scopeH;
    const stream = comp.captureStream(30);
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10e6 } : undefined);
    } catch (e) {
      return BS.toast('Videoaufnahme konnte nicht gestartet werden: ' + e.message, 'err');
    }
    const chunks = [];
    rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
    const isMp4 = mime.startsWith('video/mp4');
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'braccio_video_' + stamp() + (isMp4 ? '.mp4' : '.webm');
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2000);
      BS.toast(isMp4 ? 'Video gespeichert (MP4)' : 'Video gespeichert – dieser Browser kann kein MP4 aufnehmen, daher WebM (z. B. mit Chrome/Edge aufnehmen)', isMp4 ? 'ok' : 'warn');
    };
    const plotCv = document.createElement('canvas');
    R.video = { rec, comp, ctx: comp.getContext('2d'), W, viewH, headH, scopeH, plotCv, plot: new BS.Plot(plotCv), last: 0, t0: performance.now(), isMp4 };
    rec.start(1000);
    BS.toast(isMp4 ? 'Videoaufnahme läuft (MP4)' : 'Videoaufnahme läuft (WebM – MP4 wird von diesem Browser nicht unterstützt)', isMp4 ? 'ok' : 'warn');
    BS.emit('rec');
  };
  R.stopVideo = function () {
    const v = R.video;
    if (!v) return;
    R.video = null;
    try {
      v.rec.stop();
    } catch (e) {
      /* bereits beendet */
    }
    BS.emit('rec');
  };
  R.videoInfo = () => {
    if (!R.video) return '';
    const s = ((performance.now() - R.video.t0) / 1000) | 0;
    return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Ein Videobild zusammensetzen – direkt nach BS.view.render() aufrufen (WebGL-Puffer ist dann gültig) */
  R.frame = function (now) {
    const v = R.video;
    if (!v || now - v.last < 1000 / 30 - 2) return;
    v.last = now;
    const { ctx, W, viewH, headH, scopeH } = v;
    const sim = BS.sim;
    const panel = cssVar('--panel', '#191d24'),
      text = cssVar('--text', '#e4e8ef'),
      muted = cssVar('--muted', '#8f9aab'),
      border = cssVar('--border', '#2d3440');
    const light = document.documentElement.dataset.theme === 'light';
    // Kopfzeile
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, W, headH);
    const fs = Math.round(headH * 0.42);
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    const tab = BS.ui && BS.ui.activeTitle ? BS.ui.activeTitle() : '';
    ctx.fillText('BraccioSim', 14, headH / 2);
    const bw = ctx.measureText('BraccioSim').width;
    ctx.font = `500 ${fs}px system-ui, sans-serif`;
    ctx.fillStyle = muted;
    ctx.fillText(`  ·  ${tab}  ·  ${sim.scenarios[sim.scenario].name}  ·  t = ${sim.t.toFixed(2)} s`, 14 + bw, headH / 2);
    ctx.textAlign = 'right';
    ctx.fillText('Prof. Dr.-Ing. Frank Bender · DHBW Stuttgart · ' + BS.VERSION, W - 14, headH / 2);
    ctx.fillStyle = border;
    ctx.fillRect(0, headH - 1, W, 1);
    // 3D-Ansicht (Hintergrund wie im Fenster, das WebGL-Bild ist transparent)
    const g = ctx.createRadialGradient(W / 2, headH + viewH * 0.3, 0, W / 2, headH + viewH * 0.3, Math.max(W, viewH) * 0.75);
    if (light) {
      g.addColorStop(0, '#fbfbf9');
      g.addColorStop(0.7, '#e9e9e4');
      g.addColorStop(1, '#dcdcd5');
    } else {
      g.addColorStop(0, '#c8ced6');
      g.addColorStop(0.7, '#9ea8b4');
      g.addColorStop(1, '#8a94a1');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, headH, W, viewH);
    const src = BS.view.canvas();
    if (src && src.width) ctx.drawImage(src, 0, headH, W, viewH);
    // Rahmen und Titelleiste des Bild-im-Bild-Fensters (im Fenster ein HTML-Element, hier nachgezeichnet)
    const pr = BS.view.pipRect && BS.view.pipRect();
    if (pr) {
      const k = W / pr.W,
        B = BS.view.PIP_BORDER * k;
      const x = pr.x * k - B,
        y = headH + pr.y * k - B,
        w = pr.w * k + 2 * B,
        hh = pr.h * k + 2 * B;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 20 * k;
      ctx.shadowOffsetY = 6 * k;
      ctx.strokeStyle = '#262b33';
      ctx.lineWidth = B;
      roundRect(ctx, x + B / 2, y + B / 2, w - B, hh - B, 6 * k);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = cssVar('--accent', '#19b6ae');
      ctx.lineWidth = 1.5 * k;
      roundRect(ctx, x - 0.75 * k, y - 0.75 * k, w + 1.5 * k, hh + 1.5 * k, 8 * k);
      ctx.stroke();
      ctx.font = `600 ${Math.round(12 * k)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      const tw = ctx.measureText(pr.title).width + 30 * k;
      ctx.fillStyle = '#262b33';
      roundRect(ctx, x, y - 24 * k, tw, 26 * k, 6 * k);
      ctx.fill();
      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.arc(x + 12 * k, y - 11 * k, 3.5 * k, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(pr.title, x + 21 * k, y - 11 * k);
    }
    // HUD: TCP-Pose und Gelenkwinkel
    const T = sim.F[5];
    const p = BS.kin.tcp(sim.trueAngles());
    const hs = Math.round(W / 115);
    ctx.font = `${hs}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'left';
    const lines = [
      `TCP  x ${T[3].toFixed(1)}  y ${T[7].toFixed(1)}  z ${T[11].toFixed(1)} mm`,
      `ψ ${p.psi.toFixed(1)}°   v ${sim.tcpVel.toFixed(0)} mm/s   Greifer ${sim.jawWidth().toFixed(0)} mm`,
      C.short.map((n, i) => `${n} ${sim.act[i].toFixed(0)}°`).join('  '),
    ];
    const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + hs * 1.6;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.88)' : 'rgba(18,21,26,0.8)';
    roundRect(ctx, 10, headH + 10, lw, lines.length * hs * 1.5 + hs * 0.8, 8);
    ctx.fill();
    ctx.fillStyle = light ? '#0b0b0b' : '#e4e8ef';
    lines.forEach((l, i) => ctx.fillText(l, 10 + hs * 0.8, headH + 10 + hs * 1.15 + i * hs * 1.5));
    if (sim.paused || sim.estop || sim.hold) {
      const msg = sim.estop ? 'NOT-HALT' : sim.paused ? 'SIMULATION ANGEHALTEN' : 'BEWEGUNG ANGEHALTEN';
      ctx.font = `700 ${hs * 1.5}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = sim.estop ? '#c92a2a' : '#e8a200';
      ctx.fillText(msg, W - 16, headH + 16 + hs);
    }
    // Messschriebe
    const opts = BS.ui.scopeOptions ? BS.ui.scopeOptions() : { series: [] };
    v.plot.draw(Object.assign({}, opts, { width: W, height: scopeH, background: panel, fontSize: Math.max(11, Math.round(W / 140)) }));
    ctx.drawImage(v.plotCv, 0, headH + viewH, W, scopeH);
    ctx.fillStyle = border;
    ctx.fillRect(0, headH + viewH, W, 1);
  };
})();
