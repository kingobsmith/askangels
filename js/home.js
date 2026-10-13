// AskAngels home page — live hero animation.
// Drifting gold light, twinkling stars and the occasional shooting sparkle,
// drawn on a canvas behind the hero. Calms to a still image for visitors who
// prefer reduced motion, and pauses when the tab is hidden.
(function () {
  'use strict';
  var canvas = document.getElementById('sky');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, dpr = 1;
  var motes = [], stars = [], trails = [];
  var palette = ['242,223,155', '212,175,55', '255,244,214', '232,197,90', '255,214,170'];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[(Math.random() * list.length) | 0]; }

  function resize() {
    var box = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = box.width; H = box.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    var area = W * H;
    motes = []; stars = [];
    var nMotes = Math.min(140, Math.round(area / 9000));
    var nStars = Math.min(160, Math.round(area / 7000));
    for (var i = 0; i < nMotes; i++) motes.push(newMote(true));
    for (var j = 0; j < nStars; j++) {
      stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.4, 1.4), phase: rand(0, Math.PI * 2), speed: rand(0.6, 2.2) });
    }
  }

  function newMote(anywhere) {
    return {
      x: rand(0, W),
      y: anywhere ? rand(0, H) : H + 10,
      r: rand(0.8, 3.2),
      vy: rand(0.15, 0.6),
      sway: rand(0.2, 0.9),
      phase: rand(0, Math.PI * 2),
      color: pick(palette),
      alpha: rand(0.25, 0.85),
    };
  }

  function launchTrail() {
    var fromLeft = Math.random() < 0.5;
    trails.push({
      x: fromLeft ? rand(-40, W * 0.4) : rand(W * 0.6, W + 40),
      y: rand(-20, H * 0.35),
      vx: (fromLeft ? 1 : -1) * rand(5, 8),
      vy: rand(2, 3.5),
      life: 1,
      color: pick(palette),
    });
  }

  function glow(x, y, r, color, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, 'rgba(' + color + ',' + alpha + ')');
    g.addColorStop(1, 'rgba(' + color + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
  }

  var last = 0, nextTrail = 1500, t = 0;
  function frame(now) {
    var dt = Math.min(48, now - (last || now)); last = now; t += dt / 1000;
    ctx.clearRect(0, 0, W, H);

    // twinkling stars
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.fillStyle = 'rgba(255,246,220,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }

    // rising gold light
    for (var k = 0; k < motes.length; k++) {
      var m = motes[k];
      m.y -= m.vy * dt / 16;
      m.x += Math.sin(t * m.sway + m.phase) * 0.35;
      var flicker = m.alpha * (0.75 + 0.25 * Math.sin(t * 3 + m.phase));
      glow(m.x, m.y, m.r, m.color, flicker * 0.55);
      ctx.fillStyle = 'rgba(' + m.color + ',' + flicker.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 0.6, 0, Math.PI * 2); ctx.fill();
      if (m.y < -20) motes[k] = newMote(false);
    }

    // shooting sparkles
    nextTrail -= dt;
    if (nextTrail <= 0) { launchTrail(); nextTrail = rand(1800, 4200); }
    for (var n = trails.length - 1; n >= 0; n--) {
      var tr = trails[n];
      tr.x += tr.vx * dt / 16; tr.y += tr.vy * dt / 16; tr.life -= dt / 1400;
      if (tr.life <= 0) { trails.splice(n, 1); continue; }
      var grad = ctx.createLinearGradient(tr.x, tr.y, tr.x - tr.vx * 14, tr.y - tr.vy * 14);
      grad.addColorStop(0, 'rgba(' + tr.color + ',' + (0.9 * tr.life).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + tr.color + ',0)');
      ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.lineTo(tr.x - tr.vx * 14, tr.y - tr.vy * 14); ctx.stroke();
      glow(tr.x, tr.y, 2.2, tr.color, 0.9 * tr.life);
    }

    if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
  }

  var raf = 0;
  function start() { cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(frame); }

  resize();
  if (reduce) { frame(16); } else { start(); }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resize(); if (reduce) frame(16); }, 150);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !reduce) start(); });
})();
