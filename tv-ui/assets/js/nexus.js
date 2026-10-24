/*
 * NEXUS TV · comportamento da tela inicial.
 *
 * Navegação no VIDAA (medido na Fase 0): as setas movem um cursor virtual e o
 * OK clica; as teclas numéricas chegam como keydown. Por isso:
 *   - os cartões são links <a href> comuns (o clique do cursor basta);
 *   - as teclas 1–9 abrem o cartão com aquele número;
 *   - se setas chegarem como teclas (outro modo ou outro aparelho), um modo de
 *     foco leve é ativado. Nenhuma tecla é bloqueada.
 */
(function () {
  "use strict";

  var apps = window.NEXUS_APPS || [];
  var byKey = {};
  var debugOn = /(?:^|[?&])debug(?:[=&]|$)/.test(location.search);

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  // Cor com transparência para brilhos (#rrggbb -> rgba).
  function soft(hex, alpha) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "rgba(47, 123, 255, " + alpha + ")";
    return "rgba(" + parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16) + ", " + alpha + ")";
  }
  // Texto escuro sobre cores claras.
  function ink(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "#fff";
    var l = 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
    return l > 170 ? "#0b1020" : "#fff";
  }
  function paint(node, app) {
    // CSSOM é permitido pela política de segurança (style-src 'self').
    node.style.setProperty("--c", app.color);
    node.style.setProperty("--c-soft", soft(app.color, 0.38));
    node.style.setProperty("--c-ink", ink(app.color));
  }

  // ---------- montagem ----------
  function buildCard(app) {
    var a = el("a", "card");
    a.href = app.url;
    a.setAttribute("data-key", app.key);
    paint(a, app);
    var top = el("div", "card-top");
    var mono = el("span", "card-mono", app.mono);
    mono.style.color = ink(app.color);
    top.appendChild(mono);
    top.appendChild(el("span", "key", app.key));
    a.appendChild(top);
    a.appendChild(el("span", "card-name", app.name));
    return a;
  }
  function buildTile(app) {
    var a = el("a", "tile");
    a.href = app.url;
    a.setAttribute("data-key", app.key);
    paint(a, app);
    a.appendChild(el("span", "tile-mono", app.mono));
    a.appendChild(el("span", "tile-name", app.name));
    a.appendChild(el("span", "key", app.key));
    return a;
  }

  function build() {
    var appsBox = $("apps");
    var shortBox = $("shortcuts");
    var firstTool = shortBox.firstChild;
    var featured = null;

    apps.forEach(function (app) {
      if (app.key) byKey[app.key] = app;
      if (app.featured && !featured) featured = app;
      if (app.group === "shortcuts") shortBox.insertBefore(buildTile(app), firstTool);
      else appsBox.appendChild(buildCard(app));
    });

    featured = featured || apps[0];
    if (featured) {
      var hero = $("hero");
      hero.href = featured.url;
      hero.setAttribute("data-key", featured.key);
      paint(hero, featured);
      $("hero-title").textContent = featured.name;
      $("hero-blurb").textContent = featured.blurb || "";
      $("hero-mono").textContent = featured.mono;
      $("hero-mono").style.color = ink(featured.color);
      $("hero-key").textContent = featured.key;
    }

    $("tile-reload").addEventListener("click", function () { location.reload(); });
  }

  // ---------- relógio e saudação ----------
  var DAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  var MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
    "setembro", "outubro", "novembro", "dezembro"];
  var lastMinute = -1;
  function tick() {
    var d = new Date();
    var m = d.getMinutes();
    if (m === lastMinute) return;
    lastMinute = m;
    var h = d.getHours();
    $("clock").textContent = pad(h) + ":" + pad(m);
    $("date").textContent = DAYS[d.getDay()] + ", " + d.getDate() + " de " + MONTHS[d.getMonth()];
    $("greeting").textContent = h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }

  // ---------- abrir app ----------
  var opening = false;
  function open(app, node) {
    if (opening || !app) return;
    opening = true;
    var toast = $("opening");
    toast.textContent = "Abrindo " + app.name + "…";
    toast.className = "opening show";
    if (node) node.classList.add("is-pressed");
    // Pequena pausa só para o retorno visual aparecer antes de sair da página.
    setTimeout(function () { location.href = app.url; }, 160);
  }

  function nodeForKey(k) {
    return document.querySelector('.card[data-key="' + k + '"], .tile[data-key="' + k + '"]');
  }

  function digitOf(e) {
    if (e.key && e.key.length === 1 && e.key >= "0" && e.key <= "9") return e.key;
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96); // teclado numérico
    return null;
  }

  // ---------- setas (opcional) ----------
  var DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Up: "up", Down: "down", Left: "left", Right: "right" };
  var DIR_CODES = { 38: "up", 40: "down", 37: "left", 39: "right" };
  var focusables = [];
  var current = null;

  function setFocus(node) {
    if (current) current.classList.remove("is-focus");
    current = node;
    if (node) {
      node.classList.add("is-focus");
      node.focus({ preventScroll: true });
    }
  }
  function moveFocus(dir) {
    focusables = Array.prototype.slice.call(document.querySelectorAll(".hero, .card, .tile"));
    if (!current || focusables.indexOf(current) < 0) { setFocus(focusables[0]); return; }
    // 1º: a linha/coluna mais próxima naquela direção (distância entre bordas).
    // 2º: dentro dela, o item mais alinhado com o atual.
    var a = current.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var cands = [];
    focusables.forEach(function (n) {
      if (n === current) return;
      var b = n.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var gap, cross, ahead;
      if (dir === "down") { ahead = by > ay + 1; gap = b.top - a.bottom; cross = Math.abs(bx - ax); }
      else if (dir === "up") { ahead = by < ay - 1; gap = a.top - b.bottom; cross = Math.abs(bx - ax); }
      else if (dir === "right") { ahead = bx > ax + 1; gap = b.left - a.right; cross = Math.abs(by - ay); }
      else { ahead = bx < ax - 1; gap = a.left - b.right; cross = Math.abs(by - ay); }
      // Tolerância para cartões ampliados pelo foco, que encostam no vizinho.
      if (ahead && gap > -24) cands.push({ n: n, gap: Math.max(gap, 0), cross: cross });
    });
    if (!cands.length) return;
    var nearest = Math.min.apply(null, cands.map(function (c) { return c.gap; }));
    var best = null;
    cands.forEach(function (c) {
      if (c.gap > nearest + 24) return;
      if (!best || c.cross < best.cross) best = c;
    });
    setFocus(best.n);
  }

  // O cursor por cima de um cartão passa a ser o foco atual, para setas e OK
  // continuarem do mesmo lugar se os dois modos se misturarem.
  function onPointerOver(e) {
    var n = e.target.closest && e.target.closest(".hero, .card, .tile");
    if (n && current && n !== current) current.classList.remove("is-focus");
    if (n) current = n;
  }

  // ---------- teclado ----------
  var lastKey = "";
  function onKey(e) {
    lastKey = (e.key || "?") + " / " + e.keyCode;
    var digit = digitOf(e);
    if (digit && byKey[digit]) {
      open(byKey[digit], nodeForKey(digit));
      return;
    }
    var dir = DIRS[e.key] || DIR_CODES[e.keyCode];
    if (dir) moveFocus(dir);
    // Enter/OK sobre um link focado já é tratado pelo navegador (clique nativo).
  }

  // ---------- debug (?debug) ----------
  var frames = 0, fps = 0, fpsStart = 0;
  function debugLoop(t) {
    if (!fpsStart) fpsStart = t;
    frames++;
    if (t - fpsStart >= 1000) {
      fps = Math.round(frames * 1000 / (t - fpsStart));
      frames = 0;
      fpsStart = t;
      $("debug").textContent =
        "viewport " + window.innerWidth + "×" + window.innerHeight +
        "  dpr " + (window.devicePixelRatio || 1) + "\n" +
        "1rem " + getComputedStyle(document.documentElement).fontSize +
        "  fps " + fps + "\n" +
        "tecla " + (lastKey || "–");
    }
    requestAnimationFrame(debugLoop);
  }

  // ---------- início ----------
  function start() {
    build();
    tick();
    setInterval(tick, 1000);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    // Ao voltar de um app (Voltar do controle), a página pode vir do cache: limpa o estado.
    window.addEventListener("pageshow", function () {
      opening = false;
      $("opening").className = "opening";
      var pressed = document.querySelectorAll(".is-pressed");
      for (var i = 0; i < pressed.length; i++) pressed[i].classList.remove("is-pressed");
      lastMinute = -1;
      tick();
    });
    document.addEventListener("click", function (e) {
      var n = e.target.closest && e.target.closest("a[data-key]");
      if (!n || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var app = byKey[n.getAttribute("data-key")];
      if (!app) return;
      // Mostra o aviso e navega; o link continua funcionando sem JavaScript.
      e.preventDefault();
      open(app, n);
    });
    if (debugOn) {
      $("debug").hidden = false;
      requestAnimationFrame(debugLoop);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
