/*
 * NEXUS TV · comportamento da tela inicial.
 *
 * Navegação no VIDAA (medido na Fase 0): as setas movem um ponteiro virtual e
 * o OK clica; as teclas numéricas chegam como keydown. Por isso:
 *   - os cartões são links/botões comuns (o clique do ponteiro basta);
 *   - o destaque acompanha o app sob o ponteiro na fileira inferior;
 *   - as teclas 1–9 e 0 abrem o app com aquele número;
 *   - se setas chegarem como teclas, um modo de foco leve é ativado.
 * Nenhum ouvinte de teclado chama preventDefault: o navegador continua
 * tratando todas as teclas normalmente.
 */
(function () {
  "use strict";

  var apps = window.NEXUS_APPS || [];
  var recs = window.NEXUS_RECS || [];
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
  function host(url) {
    var m = /^https?:\/\/(?:www\.)?([^\/]+)/.exec(url || "");
    return m ? m[1] : "";
  }
  function metaOf(app) {
    var key = app.key ? "Tecla " + app.key + " · " : "";
    if (app.type === "site") return key + host(app.url);
    if (app.type === "info") return key + "mostra como abrir pelo VIDAA";
    return key + "página da NEXUS";
  }

  // ---------- montagem ----------
  function tag(app) {
    var isLink = app.type === "site" || app.type === "link";
    var n = el(isLink ? "a" : "button");
    if (isLink) n.href = app.url;
    else n.type = "button";
    return n;
  }
  function buildApp(app, index) {
    var n = tag(app);
    n.className = "app";
    n.setAttribute("data-i", index);
    var card = el("div", "app-card");
    var mono = el("span", "app-mono" + (app.mono.length > 2 ? " is-long" : ""), app.mono);
    mono.style.color = app.color; // CSSOM é permitido pela política de segurança.
    card.appendChild(mono);
    if (app.key) card.appendChild(el("span", "app-key", app.key));
    if (app.type === "info") card.appendChild(el("span", "app-info", "i"));
    n.appendChild(card);
    n.appendChild(el("div", "app-name", app.name));
    return n;
  }
  function buildRec(rec) {
    var app = byKey[rec.app];
    if (!app) return null;
    var n = tag(app);
    n.className = "rec";
    n.setAttribute("data-i", apps.indexOf(app));
    var img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.src = app.img;
    n.appendChild(img);
    n.appendChild(el("div", "rec-shade"));
    var t = el("div", "rec-text");
    t.appendChild(el("div", "rec-eyebrow", rec.eyebrow || ""));
    t.appendChild(el("div", "rec-name", app.name));
    t.appendChild(el("div", "rec-desc", rec.text || ""));
    n.appendChild(t);
    return n;
  }
  function build() {
    apps.forEach(function (app) { if (app.key) byKey[app.key] = app; });
    var dock = document.createDocumentFragment();
    apps.forEach(function (app, i) { dock.appendChild(buildApp(app, i)); });
    $("dock").appendChild(dock);
    var box = $("recs");
    recs.forEach(function (r) { var n = buildRec(r); if (n) box.appendChild(n); });
  }

  // ---------- destaque ----------
  // Duas camadas de imagem: a nova é decodificada fora da tela e só então
  // aparece por cima (troca por opacidade, sem mexer no layout).
  var selected = null;
  var swapToken = 0;
  var hoverTimer = 0;
  function appOf(node) {
    var i = node && node.getAttribute("data-i");
    return i === null || i === undefined ? null : apps[+i] || null;
  }
  function select(app) {
    if (!app || app === selected) return;
    selected = app;
    var marks = document.querySelectorAll(".app.is-selected");
    for (var i = 0; i < marks.length; i++) marks[i].classList.remove("is-selected");
    var mine = document.querySelector('.app[data-i="' + apps.indexOf(app) + '"]');
    if (mine) mine.classList.add("is-selected");

    var hero = $("hero");
    if (app.type === "site" || app.type === "link") hero.setAttribute("href", app.url);
    else hero.removeAttribute("href");
    hero.setAttribute("data-i", apps.indexOf(app));

    var text = $("hero-text");
    text.classList.add("is-fading");
    var token = ++swapToken;
    setTimeout(function () {
      if (token !== swapToken) return;
      $("hero-title").textContent = app.name;
      $("hero-blurb").textContent = app.blurb || "";
      $("hero-btn").textContent = app.type === "info" ? "Ver instruções" : "Abrir";
      $("hero-meta").textContent = metaOf(app);
      text.classList.remove("is-fading");
    }, 140);

    var a = $("hero-a"), b = $("hero-b");
    var front = a.classList.contains("is-on") ? a : b;
    var back = front === a ? b : a;
    if (front.getAttribute("src") === app.img) return;
    back.src = app.img;
    var show = function () {
      if (token !== swapToken) return;
      back.classList.add("is-on");
      front.classList.remove("is-on");
    };
    if (back.decode) back.decode().then(show, show);
    else back.onload = show;
  }
  // O ponteiro atravessando a fileira não deve trocar a imagem a cada cartão.
  function selectSoon(app) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { select(app); }, 90);
  }

  // Busca as outras artes depois da primeira exibição, para a troca ser imediata.
  function preload() {
    apps.forEach(function (app, i) {
      setTimeout(function () { var im = new Image(); im.decoding = "async"; im.src = app.img; }, 120 * i);
    });
  }

  // ---------- relógio ----------
  var lastMinute = -1;
  function tick() {
    var d = new Date();
    if (d.getMinutes() === lastMinute) return;
    lastMinute = d.getMinutes();
    $("clock").textContent = pad(d.getHours()) + ":" + pad(lastMinute);
  }

  // ---------- foco (setas, se chegarem como teclas) ----------
  var current = null;
  function setFocus(node) {
    if (current) current.classList.remove("is-focus");
    current = node;
    if (!node) return;
    node.classList.add("is-focus");
    node.focus({ preventScroll: true });
    if (node.classList.contains("app")) select(appOf(node));
  }
  function focusables() {
    var sel = panelOpen() ? ".panel-close" : ".app, .rec, .hero, .icon-btn";
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  // 1º: a linha/coluna mais próxima na direção da seta; 2º: o item mais alinhado.
  function moveFocus(dir) {
    var items = focusables();
    if (!current || items.indexOf(current) < 0) {
      // Primeira seta: começa no app em destaque (ou no botão do painel aberto).
      var start = panelOpen() ? $("panel-close") :
        document.querySelector(".app.is-selected") || document.querySelector(".app");
      setFocus(start || items[0]);
      return;
    }
    var a = current.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var cands = [];
    items.forEach(function (n) {
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

  // ---------- abrir ----------
  var leaving = false;
  function pressed(node) {
    if (!node) return;
    node.classList.add("is-pressed");
    setTimeout(function () { node.classList.remove("is-pressed"); }, 180);
  }
  function activate(app, node) {
    if (!app || leaving) return;
    pressed(node);
    if (app.type === "info") { openPanel(app, node); return; }
    leaving = true;
    // Pausa curta só para o retorno visual aparecer antes de sair da página.
    setTimeout(function () { location.href = app.url; }, 140);
  }
  function nodeForKey(k) {
    var app = byKey[k];
    return app ? document.querySelector('.app[data-i="' + apps.indexOf(app) + '"]') : null;
  }

  // ---------- painel de instruções ----------
  var panelReturn = null;
  function panelOpen() { return !$("panel").hidden; }
  function openPanel(app, from) {
    var p = app.panel || {};
    $("panel-status").textContent = p.status || "";
    $("panel-title").textContent = p.title || app.name;
    var body = $("panel-body");
    body.textContent = "";
    (p.text || []).forEach(function (t) { body.appendChild(el("p", "", t)); });
    panelReturn = from || null;
    $("panel").hidden = false;
    setFocus($("panel-close"));
  }
  function closePanel() {
    if (!panelOpen()) return;
    $("panel").hidden = true;
    $("panel-close").classList.remove("is-focus");
    current = null;
    if (panelReturn) setFocus(panelReturn);
    panelReturn = null;
  }

  // ---------- teclado ----------
  var DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Up: "up", Down: "down", Left: "left", Right: "right" };
  var DIR_CODES = { 38: "up", 40: "down", 37: "left", 39: "right" };
  var lastKey = "";
  function digitOf(e) {
    if (e.key && e.key.length === 1 && e.key >= "0" && e.key <= "9") return e.key;
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96); // teclado numérico
    return null;
  }
  function onKey(e) {
    lastKey = (e.key || "?") + " / " + e.keyCode;
    if (debugOn) renderDebug();
    var digit = digitOf(e);
    if (digit && byKey[digit]) {
      closePanel();
      var app = byKey[digit];
      select(app);
      activate(app, nodeForKey(digit));
      return;
    }
    if (e.key === "Escape" || e.keyCode === 27) { closePanel(); return; }
    var dir = DIRS[e.key] || DIR_CODES[e.keyCode];
    if (dir) moveFocus(dir);
    // Enter/OK sobre um elemento focado já vira clique nativo do navegador.
  }

  // ---------- debug (?debug): verificação estritamente passiva ----------
  // Apenas lista nomes de propriedades e lê descritores. Não chama nenhuma
  // função, não lê getters e não interage com o sistema da TV.
  function hisenseCheck() {
    var found = [];
    var obj = window, level = 0;
    try {
      while (obj && level < 6) {
        var where = level === 0 ? "window" : "protótipo " + level;
        Object.getOwnPropertyNames(obj).forEach(function (name) {
          if (!/hisense/i.test(name)) return;
          var d = Object.getOwnPropertyDescriptor(obj, name);
          var kind = !d ? "desconhecido" : ("value" in d ? typeof d.value : "acessor (não lido)");
          found.push(name + " · " + kind + " · " + where);
        });
        obj = Object.getPrototypeOf(obj);
        level++;
      }
    } catch (err) {
      return "Hisense_*: não foi possível listar (" + err.name + ")";
    }
    if (!found.length) return "Hisense_*: nenhuma propriedade visível nesta página (nada foi executado)";
    return "Hisense_* visíveis (nada foi executado):\n  " + found.join("\n  ");
  }
  var hisenseReport = "";
  var fps = 0, frames = 0, fpsStart = 0;
  function renderDebug() {
    $("debug").textContent =
      "viewport " + window.innerWidth + "×" + window.innerHeight +
      " · dpr " + (window.devicePixelRatio || 1) +
      " · 1rem " + getComputedStyle(document.documentElement).fontSize +
      " · fps " + (fps || "–") + " · tecla " + (lastKey || "–") + "\n" + hisenseReport;
  }
  function debugLoop(t) {
    if (!fpsStart) fpsStart = t;
    frames++;
    if (t - fpsStart >= 1000) {
      fps = Math.round(frames * 1000 / (t - fpsStart));
      frames = 0;
      fpsStart = t;
      renderDebug();
    }
    requestAnimationFrame(debugLoop);
  }

  // ---------- início ----------
  function start() {
    build();
    select(apps[0]);
    tick();
    setInterval(tick, 1000);

    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", function (e) {
      if (panelOpen() || !e.target.closest) return;
      var n = e.target.closest(".app, .rec, .hero, .icon-btn");
      if (current && current !== n) { current.classList.remove("is-focus"); current = null; }
      if (n && n.classList.contains("app")) selectSoon(appOf(n));
    }, { passive: true });

    document.addEventListener("click", function (e) {
      if (!e.target.closest) return;
      var n = e.target.closest(".app, .rec, .hero");
      if (!n) return;
      var app = appOf(n);
      if (!app) return;
      if (app.type !== "info" && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey)) return;
      // Os links funcionam sem JavaScript; aqui só adicionamos o retorno visual.
      e.preventDefault();
      if (n.classList.contains("app")) select(app);
      activate(app, n);
    });
    $("btn-reload").addEventListener("click", function () { location.reload(); });
    $("panel-close").addEventListener("click", closePanel);
    $("panel").addEventListener("click", function (e) { if (e.target === this) closePanel(); });

    // Ao voltar de um app pelo Voltar, a página pode vir do cache: limpa o estado.
    window.addEventListener("pageshow", function () {
      leaving = false;
      lastMinute = -1;
      tick();
    });

    if (document.readyState === "complete") setTimeout(preload, 300);
    else window.addEventListener("load", function () { setTimeout(preload, 300); });

    if (debugOn) {
      hisenseReport = hisenseCheck();
      $("debug").hidden = false;
      renderDebug();
      requestAnimationFrame(debugLoop);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
