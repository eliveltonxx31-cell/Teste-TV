/*
 * NEXUS TV · comportamento da tela inicial.
 *
 * Ordem de carregamento (leve primeiro):
 *   1. cabeçalho e dock aparecem na hora (arquivos locais);
 *   2. se houver destaques salvos neste navegador, eles aparecem na hora;
 *   3. GET /api/home (função do Cloudflare; a chave do TMDB fica lá);
 *   4. a imagem do destaque, com prioridade;
 *   5. as demais imagens, uma de cada vez, depois do destaque.
 * Se a API falhar, ficam os destaques salvos ou a arte local, e a dock segue
 * funcionando normalmente.
 *
 * Controle remoto (medido na Fase 0): as setas movem um ponteiro virtual e o
 * OK clica; as teclas numéricas chegam como keydown. Nenhum ouvinte de teclado
 * chama preventDefault.
 */
(function () {
  "use strict";

  var APPS = window.NEXUS_APPS || [];
  var SERVICES = window.NEXUS_SERVICES || {};
  var FALLBACK_RECS = window.NEXUS_FALLBACK_RECS || [];
  var CACHE_KEY = "nexus-home-v1";
  var CACHE_MAX_AGE = 7 * 24 * 3600 * 1000;
  var API_TIMEOUT = 8000;
  var HOVER_REST = 250;   // ms parado sobre um app antes de trocar o destaque
  var LIST_SIZE = 7;
  var debugOn = /(?:^|[?&])debug(?:[=&]|$)/.test(location.search);

  var byKey = {};
  var data = null;        // resposta de /api/home
  var view = "home";

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function closest(node, sel) { return node && node.closest ? node.closest(sel) : null; }

  // ---------- imagens ----------
  // Fila de baixa prioridade: uma imagem por vez, só depois do destaque.
  var queue = [], busy = false;
  function load(img, url, done) {
    var settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      img.onload = img.onerror = null;
      if (ok && img.decode) img.decode().then(function () { done(true); }, function () { done(true); });
      else done(ok);
    }
    img.onload = function () { finish(true); };
    img.onerror = function () { finish(false); };
    img.src = url;
    if (img.complete && img.naturalWidth) finish(true);
  }
  function enqueue(img, url, done) { queue.push([img, url, done]); pump(); }
  // A fila só anda depois que o destaque apareceu (ou falhou), ou após 3 s.
  var queueOpen = false;
  setTimeout(function () { queueOpen = true; pump(); }, 3000);
  function pump() {
    if (busy || !queue.length || !queueOpen) return;
    busy = true;
    var job = queue.shift();
    load(job[0], job[1], function (ok) { job[2](ok); busy = false; pump(); });
  }

  function tmdbUrl(path, size) { return data && path ? data.img.base + size + path : ""; }
  function serviceOf(item, prefer) {
    if (prefer && SERVICES[prefer]) return prefer;
    var list = (item && item.svc) || [];
    for (var i = 0; i < list.length; i++) if (SERVICES[list[i]]) return list[i];
    return null;
  }
  function metaOf(item, svc) {
    var parts = [item.type === "tv" ? "Série" : "Filme"];
    if (item.g && item.g.length) parts.push(item.g.join(" · "));
    if (item.y) parts.push(item.y);
    if (svc) parts.push(SERVICES[svc].name);
    return parts.join(" · ");
  }
  function metaShort(item, svc) {
    var parts = [item.type === "tv" ? "Série" : "Filme"];
    if (item.y) parts.push(item.y);
    if (svc) parts.push(SERVICES[svc].name);
    return parts.join(" · ");
  }
  function artFor(svc) {
    for (var i = 0; i < APPS.length; i++) if (APPS[i].service === svc) return APPS[i].img;
    return APPS.length ? APPS[0].img : "";
  }

  // ---------- molduras (destaque, recomendações, pôsteres) ----------
  function setInfo(box, title, meta) {
    box.querySelector(".info-title").textContent = title || " ";
    box.querySelector(".info-meta").textContent = meta || " ";
  }
  function setLink(frame, url) {
    if (url) { frame.setAttribute("href", url); frame.setAttribute("data-url", url); frame.classList.remove("is-empty"); }
    else { frame.removeAttribute("href"); frame.removeAttribute("data-url"); frame.classList.add("is-empty"); }
  }

  // Entrada exibida numa moldura: título do TMDB ou app (arte local).
  function titleEntry(key, prefer) {
    var item = data && data.items[key];
    if (!item) return null;
    var svc = serviceOf(item, prefer);
    return {
      key: key,
      title: item.t,
      meta: metaOf(item, svc),
      metaShort: metaShort(item, svc),
      url: svc ? SERVICES[svc].url : "",
      backdrop: tmdbUrl(item.b, data.img.backdrop),
      poster: tmdbUrl(item.p, data.img.poster),
      fallback: artFor(svc)
    };
  }
  function appEntry(app, eyebrow) {
    return {
      key: "app:" + app.key,
      app: app,
      title: app.name,
      meta: eyebrow || ((app.blurb || "") + (app.key ? " · Tecla " + app.key : "")),
      url: app.type === "site" || app.type === "link" ? app.url : "",
      backdrop: app.img,
      poster: app.img,
      fallback: ""
    };
  }

  // Destaque: duas camadas; a nova aparece por cima só depois de decodificada.
  var heroEntry = null, heroToken = 0;
  function showHero(entry) {
    if (!entry || (heroEntry && heroEntry.key === entry.key)) return;
    heroEntry = entry;
    var frame = $("hero");
    var info = frame.parentNode.querySelector(".info");
    var token = ++heroToken;
    info.classList.add("is-fading");
    setTimeout(function () {
      if (token !== heroToken) return;
      setInfo(info, entry.title, entry.meta);
      info.classList.remove("is-fading");
    }, 120);
    setLink(frame, entry.url);
    if (entry.app && entry.app.type === "info") frame.classList.remove("is-empty");
    frame.setAttribute("data-entry", entry.key);

    var a = $("hero-a"), b = $("hero-b");
    var front = a.classList.contains("is-on") ? a : b;
    var back = front === a ? b : a;
    if (front.classList.contains("is-on") && front.getAttribute("src") === entry.backdrop) return;
    if (!heroShownOnce) back.setAttribute("fetchpriority", "high");
    load(back, entry.backdrop, function (ok) {
      if (token !== heroToken) return;
      if (!ok && entry.fallback && back.getAttribute("src") !== entry.fallback) {
        load(back, entry.fallback, function (ok2) {
          if (token !== heroToken) return;
          if (ok2) reveal();
          else if (!heroShownOnce) { heroShownOnce = true; frame.classList.remove("is-loading"); queueOpen = true; pump(); }
        });
        return;
      }
      if (ok) reveal();
      else if (!heroShownOnce) { heroShownOnce = true; frame.classList.remove("is-loading"); queueOpen = true; pump(); }
    });
    function reveal() {
      back.classList.add("is-on");
      front.classList.remove("is-on");
      frame.classList.remove("is-loading");
      if (!heroShownOnce) { heroShownOnce = true; mark("hero"); queueOpen = true; pump(); }
      if (data && entry.backdrop.indexOf(data.img.base) === 0) mark("heroTmdb");
    }
  }
  var heroShownOnce = false;

  function showRec(i, entry) {
    var frame = $("rec-" + i);
    var info = frame.parentNode.querySelector(".info");
    var img = frame.querySelector("img");
    if (!entry) { setInfo(info, "", ""); setLink(frame, ""); frame.removeAttribute("data-entry"); img.classList.remove("is-on"); return; }
    if (frame.getAttribute("data-entry") === entry.key) return;
    frame.setAttribute("data-entry", entry.key);
    setInfo(info, entry.title, entry.metaShort || entry.meta);
    setLink(frame, entry.url);
    if (entry.app && entry.app.type === "info") frame.classList.remove("is-empty");
    img.classList.remove("is-on");
    frame.classList.add("is-loading");
    var url = entry.poster;
    var run = function (target, fb) {
      enqueue(img, target, function (ok) {
        if (frame.getAttribute("data-entry") !== entry.key) return;
        if (ok) { img.classList.add("is-on"); frame.classList.remove("is-loading"); }
        else if (fb) run(fb, "");
        else frame.classList.remove("is-loading");
      });
    };
    run(url, entry.fallback);
  }

  function renderHome() {
    var featured = (data && data.featured) || [];
    var heroE = null;
    if (selectedApp) heroE = entryForApp(selectedApp);
    if (!heroE && featured.length) heroE = titleEntry(featured[0]);
    if (!heroE && APPS.length) heroE = appEntry(APPS[0]);
    showHero(heroE);

    var recs = [];
    for (var i = 0; i < featured.length && recs.length < 2; i++) {
      if (heroE && featured[i] === heroE.key) continue;
      var e = titleEntry(featured[i]);
      if (e) recs.push(e);
    }
    if (!recs.length) {
      FALLBACK_RECS.forEach(function (r) { if (byKey[r.key]) recs.push(appEntry(byKey[r.key], r.eyebrow)); });
    }
    showRec(0, recs[0] || null);
    showRec(1, recs[1] || null);
  }

  // ---------- Filmes / Séries ----------
  function renderList(kind) {
    var box = $("posters");
    box.textContent = "";
    var keys = (data && data[kind === "movies" ? "movies" : "series"]) || [];
    keys = keys.slice(0, LIST_SIZE);
    setInfo($("view-list").querySelector(".info"), "", "");
    if (!keys.length) {
      box.appendChild(el("div", "list-empty", data ? "Nenhum título disponível agora." :
        "Filmes e séries aparecem aqui quando os destaques do TMDB estiverem disponíveis."));
      return;
    }
    keys.forEach(function (k) {
      var e = titleEntry(k);
      if (!e) return;
      var frame = el("a", "frame poster is-loading");
      frame.setAttribute("tabindex", "-1");
      frame.setAttribute("data-entry", k);
      setLink(frame, e.url);
      frame.setAttribute("data-title", e.title);
      frame.setAttribute("data-meta", e.meta);
      var img = el("img", "layer");
      img.alt = "";
      img.decoding = "async";
      frame.appendChild(img);
      box.appendChild(frame);
      enqueue(img, e.poster, function (ok) {
        frame.classList.remove("is-loading");
        if (ok) img.classList.add("is-on");
      });
    });
  }
  function setView(next) {
    if (next === view) return;
    view = next;
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-view") === next);
    $("view-home").hidden = next !== "home";
    $("view-list").hidden = next === "home";
    if (next !== "home") renderList(next);
  }

  // ---------- dock ----------
  var selectedApp = null, hoverTimer = 0;
  function buildDock() {
    var main = document.createDocumentFragment(), more = document.createDocumentFragment();
    APPS.forEach(function (app, i) {
      if (app.key) byKey[app.key] = app;
      var isLink = app.type === "site" || app.type === "link";
      var n = el(isLink ? "a" : "button", "app");
      if (isLink) n.href = app.url; else n.type = "button";
      n.setAttribute("data-app", i);
      n.setAttribute("aria-label", app.name);
      if (app.tier === "main") {
        var t = el("div", "tile");
        t.style.setProperty("--c", app.color); // CSSOM é permitido pela política de segurança.
        if (app.ink) t.style.setProperty("--ink", app.ink);
        t.appendChild(el("span", "tile-name", app.short || app.name));
        if (app.key) t.appendChild(el("span", "key", app.key));
        if (app.type === "info") t.appendChild(el("span", "badge-i", "i"));
        n.appendChild(t);
        main.appendChild(n);
      } else {
        var r = el("div", "round");
        r.style.setProperty("--c", app.color);
        r.appendChild(el("span", "round-mono", app.mono || app.name.charAt(0)));
        if (app.key) r.appendChild(el("span", "key", app.key));
        if (app.type === "info") r.appendChild(el("span", "badge-i", "i"));
        n.appendChild(r);
        n.appendChild(el("div", "round-name", app.short || app.name));
        more.appendChild(n);
      }
    });
    $("dock-main").appendChild(main);
    $("dock-more").appendChild(more);
  }
  function appOfNode(n) { var i = n && n.getAttribute("data-app"); return i === null || i === undefined ? null : APPS[+i]; }
  function nodeOfApp(app) { return document.querySelector('.app[data-app="' + APPS.indexOf(app) + '"]'); }

  // Serviço com títulos do TMDB → um título dele; senão a arte local do app.
  function entryForApp(app) {
    var sv = app.service && data && data.services && data.services[app.service];
    if (sv && sv.top && sv.top.length) {
      var e = titleEntry(sv.top[0], app.service);
      if (e) return e;
    }
    return appEntry(app);
  }
  function selectApp(app) {
    if (!app) return;
    selectedApp = app;
    var marks = document.querySelectorAll(".app.is-selected");
    for (var i = 0; i < marks.length; i++) marks[i].classList.remove("is-selected");
    var n = nodeOfApp(app);
    if (n) n.classList.add("is-selected");
    if (view === "home") renderHome();
  }

  // ---------- abrir ----------
  var leaving = false;
  function pressed(node) {
    if (!node) return;
    node.classList.add("is-pressed");
    setTimeout(function () { node.classList.remove("is-pressed"); }, 180);
  }
  function go(url, node) {
    if (!url || leaving) return;
    leaving = true;
    pressed(node);
    setTimeout(function () { location.href = url; }, 140);
  }
  function activateApp(app, node) {
    if (!app || leaving) return;
    if (app.type === "info") { pressed(node); openPanel(app.panel || {}, node); return; }
    go(app.url, node);
  }

  // ---------- painel (instruções e créditos) ----------
  var panelReturn = null;
  function panelOpen() { return !$("panel").hidden; }
  function openPanel(p, from) {
    $("panel-status").textContent = p.status || "";
    $("panel-title").textContent = p.title || "";
    var body = $("panel-body");
    body.textContent = "";
    if (p.logo) {
      var logo = el("img", "logo");
      logo.alt = "TMDB";
      logo.onerror = function () { logo.remove(); };
      logo.src = p.logo;
      body.appendChild(logo);
    }
    (p.text || []).forEach(function (t) {
      var para = el("p", t.en ? "en" : "", t.en || t);
      body.appendChild(para);
    });
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
  function openCredits(from) {
    openPanel({
      title: "Créditos e fontes",
      // Arquivo oficial do TMDB (sem modificações); se ainda não existir, o painel mostra só o texto.
      logo: "assets/img/tmdb-logo.svg",
      text: [
        { en: "This product uses the TMDB API but is not endorsed or certified by TMDB." },
        "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Títulos, imagens e informações vêm do TMDB.",
        "A disponibilidade de cada título por serviço vem da JustWatch, por meio do TMDB, e pode estar incompleta ou desatualizada.",
        "A NEXUS TV é só uma interface de navegação: mostrar um título não significa que ele pode ser reproduzido aqui. Os cartões abrem os sites oficiais de cada serviço."
      ]
    }, from);
  }

  // ---------- dados ----------
  function setStatus(text, retry) {
    $("status").textContent = text;
    $("btn-retry").hidden = !retry;
  }
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.data || Date.now() - c.at > CACHE_MAX_AGE) return null;
      return c.data;
    } catch (e) { return null; }
  }
  function writeCache(d) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: d })); } catch (e) {}
  }
  function valid(d) { return d && d.v === 1 && d.img && d.items && d.featured; }

  function fetchHome() {
    setStatus(data ? "Destaques salvos · atualizando…" : "Carregando destaques…", false);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, API_TIMEOUT);
    fetch("/api/home", { credentials: "omit", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; },
                              function () { return { status: res.status, body: null }; });
      })
      .then(function (r) {
        clearTimeout(timer);
        if (r.status === 200 && valid(r.body)) {
          data = r.body;
          writeCache(data);
          mark("data");
          setStatus(data.featured.length ? "Destaques do TMDB" : "Nenhum destaque disponível agora", false);
          refresh();
        } else if (r.status === 503 && r.body && r.body.error === "not_configured") {
          setStatus(data ? "Destaques salvos · TMDB não configurado" : "Destaques do TMDB não configurados", false);
          refresh();
        } else if (r.body && r.body.error === "tmdb_auth_failed") {
          // Configuração: o segredo existe, mas o TMDB recusou a chave.
          setStatus(data ? "Destaques salvos · TMDB recusou a chave" : "TMDB recusou a chave configurada", false);
          refresh();
        } else {
          failed();
        }
      })
      .catch(function () { clearTimeout(timer); failed(); });
  }
  // Conexão: rede da TV, função ou TMDB fora do alcance.
  function failed() {
    setStatus(data ? "Sem conexão · destaques salvos" : "Destaques indisponíveis no momento", true);
    refresh();
  }
  function refresh() {
    if (view === "home") renderHome();
    else renderList(view);
    keepFocus();
  }

  // ---------- relógio e saudação ----------
  var lastMinute = -1;
  function tick() {
    var d = new Date();
    if (d.getMinutes() === lastMinute) return;
    lastMinute = d.getMinutes();
    var h = d.getHours();
    $("clock").textContent = pad(h) + ":" + pad(lastMinute);
    $("greet").textContent = h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }

  // ---------- navegação por controle remoto ----------
  // Funciona quando o navegador entrega as setas à página (computador, modo de
  // navegação sem ponteiro, app). No modo ponteiro do navegador VIDAA as setas
  // movem o cursor e não chegam aqui; o OK continua clicando sob o ponteiro.
  var current = null;          // elemento com foco do controle
  var inputMode = "pointer";   // "key" depois de uma seta; "pointer" quando o ponteiro se move
  var lastHovered = null;
  var lastInRegion = {};       // memória: último item focado em cada região

  function regionOf(n) {
    if (!n || !n.closest) return "";
    if (n.closest(".panel")) return "panel";
    if (n.closest(".head")) return "head";
    if (n.closest(".dock-main")) return "dock-main";
    if (n.closest(".dock-more")) return "dock-more";
    if (n.closest(".stage")) return "stage-" + view;
    return "";
  }
  function visible(n) { return !!n && n.offsetParent !== null && document.documentElement.contains(n); }

  function setFocus(node) {
    if (current && current !== node) current.classList.remove("is-focus");
    current = node;
    if (!node) return;
    node.classList.add("is-focus");
    if (node.focus) node.focus({ preventScroll: true });
    var r = regionOf(node);
    if (r) lastInRegion[r] = node;
    if (node.classList.contains("app")) {
      // Igual ao ponteiro: o destaque só troca quando o foco para no app.
      clearTimeout(hoverTimer);
      var app = appOfNode(node);
      hoverTimer = setTimeout(function () { selectApp(app); }, HOVER_REST);
    }
    if (node.classList.contains("poster")) showPosterInfo(node);
  }
  function focusables() {
    if (panelOpen()) return [$("panel-close")];
    return Array.prototype.slice.call(document.querySelectorAll(".tab, .circle, .retry, .hero, .rec, .poster, .app"))
      .filter(visible);
  }
  // Primeiro item da seção atual (destaque ou primeiro pôster).
  function sectionStart() {
    if (view === "home") return $("hero");
    return document.querySelector(".poster") || document.querySelector('.tab[data-view="' + view + '"]');
  }
  function initialFocus() {
    if (panelOpen()) return $("panel-close");
    if (visible(lastHovered)) return lastHovered;
    var remembered = lastInRegion["stage-" + view];
    return visible(remembered) ? remembered : sectionStart();
  }

  // 1º: a linha/coluna mais próxima na direção da seta; 2º: o item mais alinhado.
  // Ao entrar numa região, volta ao último item usado nela.
  function moveFocus(dir) {
    var items = focusables();
    if (!current || items.indexOf(current) < 0) { setFocus(initialFocus()); return; }
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
      var overlap = dir === "left" || dir === "right" ? (b.top < a.bottom && b.bottom > a.top) : (b.left < a.right && b.right > a.left);
      if (ahead && gap > -24) cands.push({ n: n, gap: Math.max(gap, 0), cross: cross, overlap: overlap });
    });
    if (!cands.length) return; // borda: o foco fica onde está
    var here = regionOf(current);
    if (dir === "left" || dir === "right") {
      // Para os lados: primeiro dentro da mesma região (ex.: do ⓘ para as abas);
      // só passa para outra região na mesma linha (ex.: dock principal → secundária).
      var same = cands.filter(function (c) { return regionOf(c.n) === here; });
      cands = same.length ? same : cands.filter(function (c) { return c.overlap; });
      if (!cands.length) return;
    }
    var reachable = cands.slice(); // para a memória de região, antes do filtro de linha/coluna
    // Quem está na mesma linha (ou coluna) tem preferência.
    if (cands.some(function (c) { return c.overlap; })) cands = cands.filter(function (c) { return c.overlap; });
    var nearest = Math.min.apply(null, cands.map(function (c) { return c.gap; }));
    var best = null;
    cands.forEach(function (c) {
      if (c.gap > nearest + 24) return;
      if (!best || c.cross < best.cross) best = c;
    });
    var target = best.n, from = here, to = regionOf(target);
    if (to !== from) {
      // Entrando no cabeçalho sem memória: a aba da seção atual (como na Apple TV).
      var remembered = lastInRegion[to] || (to === "head" ? document.querySelector(".tab.is-on") : null);
      for (var i = 0; i < reachable.length; i++) if (reachable[i].n === remembered) { target = remembered; break; }
    }
    setFocus(target);
  }
  function showPosterInfo(node) {
    setInfo($("view-list").querySelector(".info"), node.getAttribute("data-title"), node.getAttribute("data-meta"));
  }
  // Depois de redesenhar (troca de aba, dados novos), recoloca o foco se ele se perdeu.
  function keepFocus() {
    if (inputMode !== "key" || visible(current)) return;
    // O mesmo título, se ainda estiver na lista redesenhada; senão, o início da seção.
    var key = current && current.getAttribute("data-entry");
    var same = key ? document.querySelector('.poster[data-entry="' + key + '"]') : null;
    if (current) current.classList.remove("is-focus");
    current = null;
    setFocus(visible(same) ? same : initialFocus());
  }
  function activateFocused() {
    if (!current) return;
    if (current.classList.contains("tab")) { openTab(current.getAttribute("data-view")); return; }
    current.click(); // passa pelos mesmos ouvintes do clique do ponteiro
  }
  function openTab(next) {
    setView(next);
    lastInRegion.head = document.querySelector(".tab.is-on");
    if (inputMode === "key") setFocus(sectionStart());
  }

  // ---------- teclado ----------
  var DIRS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Up: "up", Down: "down", Left: "left", Right: "right" };
  var DIR_CODES = { 38: "up", 40: "down", 37: "left", 39: "right" };
  // Voltar: Escape (27), Backspace (8, comum em TVs), 461 (webOS), 10009 (Tizen), BrowserBack (166).
  var BACK_KEYS = { Escape: 1, Esc: 1, Backspace: 1, BrowserBack: 1, GoBack: 1 };
  var BACK_CODES = { 27: 1, 8: 1, 461: 1, 10009: 1, 166: 1 };
  var ENTER_KEYS = { Enter: 1, Select: 1, Accept: 1 };
  var lastKey = "";
  function digitOf(e) {
    if (e.key && e.key.length === 1 && e.key >= "0" && e.key <= "9") return e.key;
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96);
    return null;
  }
  // Só cancela o comportamento padrão de teclas que a NEXUS realmente tratou.
  function onKey(e) {
    lastKey = (e.key || "?") + " / " + e.keyCode;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var digit = digitOf(e);
    if (digit && byKey[digit]) {
      closePanel();
      var app = byKey[digit];
      selectApp(app);
      activateApp(app, nodeOfApp(app));
      return;
    }
    var dir = DIRS[e.key] || DIR_CODES[e.keyCode];
    if (dir) {
      inputMode = "key";
      e.preventDefault();
      moveFocus(dir);
      return;
    }
    if (ENTER_KEYS[e.key] || e.keyCode === 13) {
      // Só no modo teclado: com o ponteiro, o OK continua sendo o clique do navegador.
      if (inputMode === "key" && visible(current)) { e.preventDefault(); activateFocused(); }
      return;
    }
    if (BACK_KEYS[e.key] || BACK_CODES[e.keyCode]) {
      if (panelOpen()) { e.preventDefault(); closePanel(); return; }
      if (view !== "home") {
        e.preventDefault();
        setView("home");
        if (inputMode === "key") setFocus(document.querySelector('.tab[data-view="home"]'));
        return;
      }
      // Na tela inicial, o Voltar fica com o navegador (pode sair da página).
    }
  }

  // ---------- medições e debug (?debug) ----------
  var marks = {};
  function mark(name) {
    if (marks[name]) return;
    marks[name] = Math.round(window.performance ? performance.now() : 0);
    window.NEXUS_MARKS = marks;
  }
  // Verificação estritamente passiva: lista nomes e lê descritores; não chama
  // nenhuma função, não lê getters e não interage com o sistema da TV.
  function hisenseCheck() {
    var found = [], obj = window, level = 0;
    try {
      while (obj && level < 6) {
        var where = level === 0 ? "window" : "protótipo " + level;
        Object.getOwnPropertyNames(obj).forEach(function (name) {
          if (!/hisense/i.test(name)) return;
          var d = Object.getOwnPropertyDescriptor(obj, name);
          found.push(name + " · " + (!d ? "desconhecido" : ("value" in d ? typeof d.value : "acessor (não lido)")) + " · " + where);
        });
        obj = Object.getPrototypeOf(obj);
        level++;
      }
    } catch (err) { return "Hisense_*: não foi possível listar (" + err.name + ")"; }
    if (!found.length) return "Hisense_*: nenhuma propriedade visível nesta página (nada foi executado)";
    return "Hisense_* visíveis (nada foi executado):\n  " + found.join("\n  ");
  }
  var hisenseReport = "", fps = 0, frames = 0, fpsStart = 0;
  function renderDebug() {
    $("debug").textContent =
      "viewport " + window.innerWidth + "×" + window.innerHeight + " · dpr " + (window.devicePixelRatio || 1) +
      " · 1rem " + getComputedStyle(document.documentElement).fontSize + " · fps " + (fps || "–") +
      " · tecla " + (lastKey || "–") + "\ndados " + (marks.data ? marks.data + " ms" : "–") +
      " · destaque " + (marks.hero ? marks.hero + " ms" : "–") + " · fonte " + (data ? data.generated : "local") +
      "\n" + hisenseReport;
  }
  function debugLoop(t) {
    if (!fpsStart) fpsStart = t;
    frames++;
    if (t - fpsStart >= 1000) { fps = Math.round(frames * 1000 / (t - fpsStart)); frames = 0; fpsStart = t; renderDebug(); }
    requestAnimationFrame(debugLoop);
  }

  // ---------- início ----------
  function start() {
    buildDock();
    // Destaque e recomendações podem ficar sem link (instruções); tabindex garante o foco.
    var frames = document.querySelectorAll(".frame");
    for (var fi = 0; fi < frames.length; fi++) frames[fi].setAttribute("tabindex", "-1");
    tick();
    setInterval(tick, 1000);

    data = readCache();
    if (data && !valid(data)) data = null;
    // Com destaques salvos, eles aparecem na hora. Sem eles, o destaque fica em
    // "carregando" até os dados chegarem (sem mostrar uma arte para trocá-la em
    // seguida); só depois de 2,5 s sem resposta entra a arte local.
    if (data) refresh();
    else setTimeout(function () { if (!heroEntry) refresh(); }, 2500);
    fetchHome();

    window.addEventListener("keydown", onKey);
    // O foco do controle só cede ao ponteiro quando o ponteiro se move de verdade
    // (um elemento que aparece sob um cursor parado não rouba o foco).
    var lastXY = "";
    document.addEventListener("pointermove", function (e) {
      var xy = Math.round(e.clientX) + "," + Math.round(e.clientY);
      if (xy === lastXY) return;
      lastXY = xy;
      if (inputMode === "key") {
        inputMode = "pointer";
        if (current) { current.classList.remove("is-focus"); current = null; }
        // Solta também o foco do navegador: o OK deve agir sob o ponteiro,
        // não no último item escolhido pelas setas.
        if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
      }
    }, { passive: true });
    document.addEventListener("pointerover", function (e) {
      if (panelOpen()) return;
      var n = closest(e.target, ".tab, .circle, .retry, .hero, .rec, .poster, .app");
      lastHovered = n;
      if (inputMode === "key") return;
      if (current && current !== n) { current.classList.remove("is-focus"); current = null; }
      clearTimeout(hoverTimer);
      if (!n) return;
      if (n.classList.contains("app")) {
        var app = appOfNode(n);
        // Só troca o destaque quando o ponteiro para: atravessar a dock não baixa imagens.
        hoverTimer = setTimeout(function () { selectApp(app); }, HOVER_REST);
      } else if (n.classList.contains("poster")) {
        showPosterInfo(n);
      }
    }, { passive: true });

    document.addEventListener("click", function (e) {
      var n = closest(e.target, ".app, .hero, .rec, .poster, .tab");
      if (!n) return;
      if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (n.classList.contains("tab")) { openTab(n.getAttribute("data-view")); return; }
      // Os links funcionam sem JavaScript; aqui só adicionamos o retorno visual.
      e.preventDefault();
      if (n.classList.contains("app")) { var app = appOfNode(n); selectApp(app); activateApp(app, n); return; }
      if (n === $("hero") && heroEntry && heroEntry.app) { activateApp(heroEntry.app, n); return; }
      if ((n.classList.contains("rec")) && !n.getAttribute("data-url")) {
        var k = n.getAttribute("data-entry");
        if (k && k.indexOf("app:") === 0) { activateApp(byKey[k.slice(4)], n); return; }
      }
      go(n.getAttribute("data-url"), n);
    });
    $("btn-reload").addEventListener("click", function () { location.reload(); });
    $("btn-retry").addEventListener("click", fetchHome);
    $("btn-credits").addEventListener("click", function () { openCredits(this); });
    $("panel-close").addEventListener("click", closePanel);
    $("panel").addEventListener("click", function (e) { if (e.target === this) closePanel(); });

    // Ao voltar de um site pelo Voltar, a página pode vir do cache: limpa o estado.
    window.addEventListener("pageshow", function () { leaving = false; lastMinute = -1; tick(); });

    if (debugOn) {
      hisenseReport = hisenseCheck();
      $("debug").hidden = false;
      renderDebug();
      requestAnimationFrame(debugLoop);
    }

    // Diagnóstico de escala/viewport/renderização: só carrega com ?escala na URL.
    if (/(?:^|[?&])escala(?:[=&]|$)/.test(location.search)) {
      var sd = document.createElement("script");
      sd.src = "assets/js/scale-diag.js";
      document.body.appendChild(sd);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
