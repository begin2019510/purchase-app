// 登录屏粒子背景：零依赖 canvas，浮动粒子 + 近距连线 + 指针联动
// 登录屏隐藏或页面不可见时自动停帧（省电）；尊重 prefers-reduced-motion
(function () {
  var canvas = document.getElementById('authParticles');
  if (!canvas || !canvas.getContext) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var ctx = canvas.getContext('2d');
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var P = [], W = 0, H = 0, LINK = 110, rafId = null, running = false;
  var mx = -1e4, my = -1e4;

  function visible() {
    var s = document.getElementById('authScreen');
    return !!(s && getComputedStyle(s).display !== 'none');
  }
  function resize() {
    var host = canvas.parentElement;
    if (!host) return;
    W = host.clientWidth; H = host.clientHeight;
    if (W < 10 || H < 10) return;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    LINK = Math.min(140, Math.max(90, W / 7));
    seed();
  }
  function seed() {
    var n = Math.round(Math.min(80, Math.max(26, (W * H) / 17000)));
    P = [];
    for (var i = 0; i < n; i++) {
      P.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: Math.random() * 1.5 + .8, a: Math.random() * .28 + .18 });
    }
  }
  function step() {
    if (!visible() || document.hidden) { stop(); return; }
    ctx.clearRect(0, 0, W, H);
    var L2 = LINK * LINK;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      for (var j = i + 1; j < P.length; j++) {
        var q = P[j], dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
        if (d2 < L2) {
          ctx.strokeStyle = 'rgba(255,255,255,' + ((1 - Math.sqrt(d2) / LINK) * .16).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
      var mdx = p.x - mx, mdy = p.y - my, md2 = mdx * mdx + mdy * mdy, ML = LINK * 1.3, ML2 = ML * ML;
      if (md2 < ML2) {
        ctx.strokeStyle = 'rgba(255,255,255,' + ((1 - Math.sqrt(md2) / ML) * .32).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, my); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,' + p.a + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    rafId = requestAnimationFrame(step);
  }
  function start() { if (running) return; if (W < 10 || P.length === 0) resize(); running = true; rafId = requestAnimationFrame(step); }
  function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
  function tick() { if (visible() && !document.hidden) start(); else stop(); }

  window.addEventListener('resize', function () { clearTimeout(window._ptRz); window._ptRz = setTimeout(function () { resize(); tick(); }, 150); });
  document.addEventListener('visibilitychange', tick);
  document.addEventListener('pointermove', function (e) {
    if (!visible()) { mx = my = -1e4; return; }
    var r = canvas.getBoundingClientRect();
    mx = e.clientX - r.left; my = e.clientY - r.top;
  }, { passive: true });
  document.addEventListener('pointerleave', function () { mx = my = -1e4; });
  setInterval(tick, 800); // 登录/登出切换 authScreen 显隐时自动启停
  resize(); tick();
})();
