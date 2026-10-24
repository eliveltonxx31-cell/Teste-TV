/*
 * NEXUS TV · comportamento da tela inicial.
 *
 * Navegação no VIDAA (medido na Fase 0): as setas movem um ponteiro virtual e
 * o OK clica; as teclas numéricas chegam como keydown. Por isso:
 *   - cartões de site são links <a href> comuns (o clique do ponteiro basta);
 *   - as teclas 1–9 e 0 abrem o cartão com aquele número;
 *   - se setas chegarem como teclas, um modo de foco leve é ativado.
 * Nenhum ouvinte de teclado chama preventDefault: o navegador continua
 * tratando todas as teclas normalmente.
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
  function rgba(hex, alpha) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "rgba(255, 255, 255, " + alpha + ")";
    return "rgba(" + parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16) + ", " + alpha + ")";
  }
  function host(url) {
    var m = /^https?:\/\/(?:www\.)?([^\/]+)/.exec(url || "");
    return m ? m[1] : "";
  }

  // ---------- montagem da grade ----------
  function buildTile(app) {
    var isSite = app.type === "site";
    var tile = el(isSite ? "a" : "button", "tile");
    if (isSite) tile.href = app.url;
    else tile.type = "button";
    tile.setAttribute("data-key", app.key);

    var card = el("div", "card");
    // CSSOM é permitido pela política de segurança (style-src 'self').
    card.style.setProperty("--tint", rgba(app.color, 0.42));
    card.appendChild(el("span", "card-key", app.key));
    card.appendChild(el("span", "card-name", app.name));
    if (!isSite) card.appendChild(el("span", "card-tag", "INSTRUÇÕES"));
    tile.appendChild(card);
    tile.appendChild(el("div", "label", isSite ? host(app.url) : "Abre instruções"));
    return tile;
  }

  function build() {
    var grid = $("grid");
    var frag = document.createDocumentFragment();
    apps.forEach(function (app) {
      if (app.key) byKey[app.key] = app;
      frag.appendChild(buildTile(app));
    });
    grid.appendChild(frag);
  }

  // ---------- vitrine ----------
  var DEFAULT_BLURB = "Escolha um app com o ponteiro ou aperte o número no controle.";
  var shown = null;
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }
  function showShelf(node) {
    if (node === shown) return;
    shown = node;
    var title, blurb, meta;
    var key = node && node.getAttribute("data-key");
    var app = key ? byKey[key] : null;
    if (app) {
      title = app.name;
      blurb = app.blurb || "";
      meta = "Tecla " + app.key + " · " + (app.type === "site" ?
        "abre " + host(app.url) + " na mesma aba" : "mostra como abrir pelo VIDAA");
    } else if (node && node.getAttribute("data-title")) {
      title = node.getAttribute("data-title");
      blurb = node.getAttribute("data-blurb") || "";
      meta = "";
    } else {
      title = greeting();
      blurb = DEFAULT_BLURB;
      meta = "";
    }
    $("shelf-title").textContent = title;
    $("shelf-blurb").textContent = blurb;
    $("shelf-meta").textContent = meta;
  }
  function targetOf(e) {
    return e.target && e.target.closest ? e.target.closest(".tile, .icon-btn") : null;
  }

  // ---------- relógio ----------
  var lastMinute = -1;
  function tick() {
    var d = new Date();
    if (d.getMinutes() === lastMinute) return;
    lastMinute = d.getMinutes();
    $("clock").textContent = pad(d.getHours()) + ":" + pad(lastMinute);
    if (!shown) $("shelf-title").textContent = greeting();
  }

  // ---------- foco (setas, se chegarem como teclas) ----------
  var current = null;
  function setFocus(node) {
    if (current) current.classList.remove("is-focus");
    current = node;
    if (!node) return;
    node.classList.add("is-focus");
    node.focus({ preventScroll: true });
    showShelf(node);
  }
  function focusables() {
    var sel = panelOpen() ? ".panel-close" : ".tile, .icon-btn";
    return Array.prototype.slice.call(document.querySelectorAll(sel));
  }
  // 1º: a linha/coluna mais próxima na direção da seta; 2º: o item mais alinhado.
  function moveFocus(dir) {
    var items = focusables();
    if (!current || items.indexOf(current) < 0) {
      // Primeira seta: começa no primeiro cartão (ou no botão do painel aberto).
      setFocus(document.querySelector(panelOpen() ? ".panel-close" : ".tile") || items[0]);
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
    if (app.type === "site") {
      leaving = true;
      pressed(node);
      // Pausa curta só para o retorno visual aparecer antes de sair da página.
      setTimeout(function () { location.href = app.url; }, 140);
    } else {
      pressed(node);
      openPanel(app, node);
    }
  }
  function nodeForKey(k) { return document.querySelector('.tile[data-key="' + k + '"]'); }

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
      activate(byKey[digit], nodeForKey(digit));
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
    showShelf(null);
    tick();
    setInterval(tick, 1000);

    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerover", function (e) {
      var n = targetOf(e);
      if (!n || panelOpen()) return;
      if (current && current !== n) { current.classList.remove("is-focus"); current = null; }
      showShelf(n);
    }, { passive: true });
    document.addEventListener("focusin", function (e) {
      var n = targetOf(e);
      if (n) showShelf(n);
    });

    $("grid").addEventListener("click", function (e) {
      var n = targetOf(e);
      if (!n) return;
      var app = byKey[n.getAttribute("data-key")];
      if (!app) return;
      if (app.type === "site" && (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey)) return;
      // O link continua funcionando sem JavaScript; aqui só adicionamos o retorno visual.
      e.preventDefault();
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
