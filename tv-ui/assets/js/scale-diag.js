/*
 * NEXUS TV · diagnóstico de escala, viewport e renderização (só com ?escala).
 *
 * Só mede e mostra; não altera a interface. Não presume que a resolução do
 * painel (3840×2160) seja igual à resolução CSS informada pelo navegador.
 */
(function () {
  "use strict";

  var PANEL_W = 3840, PANEL_H = 2160; // painel informado pelo usuário (Hisense 65A6S)
  var TEXT_TARGETS = [
    ["Saudação (título grande)", ".greet"],
    ["Aba ativa", ".tab.is-on"],
    ["Título do destaque", "#hero-title"],
    ["Metadados do destaque", "#hero-meta"],
    ["Título de recomendação", ".slot-rec .info-title"],
    ["Metadados de recomendação", ".slot-rec .info-meta"],
    ["Nome no cartão da dock", ".tile-name"],
    ["Nome no ícone redondo", ".round-name"],
    ["Linha de status", "#status"],
    ["Linha de créditos", ".credit-line"]
  ];
  var FONT_CANDIDATES = ["-apple-system", "SF Pro Display", "Helvetica Neue", "Helvetica", "Arial", "Roboto",
    "Noto Sans", "Droid Sans", "DejaVu Sans", "Liberation Sans", "Open Sans", "Ubuntu", "Segoe UI",
    "Tiresias", "Source Sans Pro", "Noto Sans CJK SC", "Arial Unicode MS"];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function dpr() { return window.devicePixelRatio || 1; }

  // ---------- medições ----------
  function dppx() {
    // Confere o devicePixelRatio pela media query de resolução (independente).
    if (!window.matchMedia) return null;
    var found = null;
    for (var v = 0.5; v <= 4.001; v += 0.25) if (matchMedia("(min-resolution: " + v + "dppx)").matches) found = v;
    return found;
  }
  function viewport() {
    var vv = window.visualViewport, s = window.screen || {};
    var w = window.innerWidth, h = window.innerHeight, d = dpr();
    var rows = [
      ["innerWidth × innerHeight (CSS px)", w + " × " + h],
      ["outerWidth × outerHeight", (window.outerWidth || "?") + " × " + (window.outerHeight || "?")],
      ["documentElement.client", document.documentElement.clientWidth + " × " + document.documentElement.clientHeight],
      ["visualViewport", vv ? r1(vv.width) + " × " + r1(vv.height) + " · escala " + vv.scale + " · deslocamento " + r1(vv.offsetLeft) + "," + r1(vv.offsetTop) : "indisponível"],
      ["devicePixelRatio", String(d)],
      ["resolução por media query", dppx() !== null ? "≥ " + dppx() + " dppx" : "indisponível"],
      ["screen.width × height", s.width + " × " + s.height],
      ["screen.availWidth × availHeight", s.availWidth + " × " + s.availHeight],
      ["Profundidade de cor", (s.colorDepth || "?") + " bits"],
      ["Viewport em pixels do navegador (inner × dpr)", Math.round(w * d) + " × " + Math.round(h * d)]
    ];
    var outerRatio = window.outerWidth && w ? window.outerWidth / w : null;
    return { rows: rows, w: w, h: h, d: d, vv: vv, s: s, outerRatio: outerRatio };
  }
  function layout() {
    var fs = getComputedStyle(document.documentElement).fontSize;
    var scr = document.querySelector(".screen");
    var r = scr ? scr.getBoundingClientRect() : null;
    var rows = [["1rem calculado (base da NEXUS)", fs + " (projetado para 20px em 1920×1080)"]];
    if (r) {
      rows.push([".screen (área desenhada)", r1(r.width) + " × " + r1(r.height) + " CSS px, em " + r1(r.left) + "," + r1(r.top)]);
      rows.push(["Ocupação do viewport", Math.round(r.width / window.innerWidth * 100) + "% da largura · " + Math.round(r.height / window.innerHeight * 100) + "% da altura"]);
    }
    return { rows: rows, rem: parseFloat(fs) };
  }

  // Qual fonte cada nome usa de fato? No Linux (inclusive no VIDAA) o fontconfig
  // troca nomes ausentes por equivalentes ou pela fonte padrão, então "existir" não
  // diz nada. Agrupamos os nomes pela fonte que realmente desenham: mesmo texto,
  // mesma largura (testado com dois textos para evitar coincidências).
  var ctx = document.createElement("canvas").getContext("2d");
  var SAMPLES = ["mmmmmmmmmmlli1WQ@ãçÉ", "Boa tarde · Série 2026 ¿%&"];
  var BOGUS = "'NexusFonteInexistente9z'";
  function sig(font) {
    ctx.font = font;
    return SAMPLES.map(function (t) { return ctx.measureText(t).width.toFixed(2); }).join("/");
  }
  function q(name) { return "'" + name + "'"; }
  function fonts() {
    var stack = getComputedStyle(document.body).fontFamily;
    var groups = {}, order = [];
    function add(label, font) {
      var k = sig("72px " + font);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(label);
      return k;
    }
    var kDefault = add("(fonte padrão: nome inexistente)", BOGUS);
    var kSans = add("sans-serif", "sans-serif");
    var kSys = add("system-ui", "system-ui");
    FONT_CANDIDATES.forEach(function (f) { add(f, q(f) + ", " + BOGUS); });
    var kStack = add("← PILHA DA NEXUS", stack);
    var rows = [["Pilha de fontes da NEXUS", stack]];
    order.forEach(function (k, i) {
      rows.push(["Fonte real " + String.fromCharCode(65 + i) + (k === kStack ? " (usada pela NEXUS)" : ""), groups[k].join(", ")]);
    });
    var usesDefault = kStack === kDefault;
    var real = groups[kStack].filter(function (n) { return n.charAt(0) !== "←" && n.charAt(0) !== "("; });
    var w400 = sig("400 72px " + stack), w600 = sig("600 72px " + stack), w700 = sig("700 72px " + stack), w800 = sig("800 72px " + stack);
    rows.push(["Pesos 400 / 600 / 700 / 800", (w400 === w600 ? "600=400 " : "") + (w400 === w700 ? "700=400 " : "") + (w700 === w800 ? "800=700 " : "") +
      (w400 === w700 ? "⚠ sem negrito com métrica própria (provável negrito sintético)" : "pesos com métricas diferentes")]);
    return {
      rows: rows,
      resolved: usesDefault ? "fonte padrão do sistema (nenhum nome da pilha existe)" : (real.length ? real.join(" = ") : "fonte não identificada entre as candidatas"),
      noBold: w400 === w700,
      sameAsSans: kStack === kSans,
      sysIsSans: kSys === kSans
    };
  }

  function typography(d) {
    var rows = [], issues = [];
    TEXT_TARGETS.forEach(function (t) {
      var n = document.querySelector(t[1]);
      if (!n || !n.textContent.trim()) { rows.push([t[0], "não encontrado na tela"]); return; }
      var cs = getComputedStyle(n);
      var fsPx = parseFloat(cs.fontSize);
      var ls = cs.letterSpacing;
      // Largura real × largura sem letter-spacing (clone fora da tela).
      var probe = n.cloneNode(true);
      probe.style.cssText = "position:absolute;left:-9999px;top:0;white-space:nowrap;width:auto;max-width:none;overflow:visible";
      document.body.appendChild(probe);
      var wReal = probe.getBoundingClientRect().width;
      probe.style.letterSpacing = "0px";
      var wZero = probe.getBoundingClientRect().width;
      document.body.removeChild(probe);
      var txt = n.textContent.trim().slice(0, 28);
      rows.push([t[0], r1(fsPx) + "px CSS (" + r1(fsPx * d) + " px do navegador) · peso " + cs.fontWeight +
        " · letter-spacing " + ls + " · line-height " + cs.lineHeight +
        " · largura " + r1(wReal) + " vs " + r1(wZero) + " sem espaçamento · “" + txt + "”"]);
      if (fsPx * d < 18) issues.push(t[0] + " com " + r1(fsPx * d) + " px do navegador");
    });
    return { rows: rows, issues: issues };
  }

  function images(d) {
    var rows = [], worst = Infinity;
    var list = [];
    var heroOn = document.querySelector("#hero .layer.is-on");
    if (heroOn) list.push(["Destaque", heroOn]);
    var recs = document.querySelectorAll(".slot-rec img");
    for (var i = 0; i < recs.length; i++) list.push(["Recomendação " + (i + 1), recs[i]]);
    var posters = document.querySelectorAll(".poster img");
    for (var j = 0; j < posters.length && j < 2; j++) list.push(["Pôster " + (j + 1), posters[j]]);
    list.forEach(function (it) {
      var img = it[1], r = img.getBoundingClientRect();
      if (!img.currentSrc && !img.src) { rows.push([it[0], "sem imagem"]); return; }
      var nw = img.naturalWidth, nh = img.naturalHeight;
      var dw = r.width * d, dh = r.height * d;
      // object-fit: cover — a imagem é ampliada pelo maior fator entre os dois eixos.
      var need = nw && nh ? Math.max(dw / nw, dh / nh) : 0;
      var src = (img.currentSrc || img.src).replace(/^https?:\/\/[^/]+/, "");
      if (need) worst = Math.min(worst, 1 / need);
      rows.push([it[0], "CSS " + r1(r.width) + " × " + r1(r.height) + " · navegador " + Math.round(dw) + " × " + Math.round(dh) +
        " · natural " + nw + " × " + nh + " · ampliação " + (need ? r1(need) + "×" : "?") +
        (need > 1.05 ? "  ⚠ imagem menor que a área" : "") + " · " + src.slice(-40)]);
    });
    return { rows: rows, worst: worst };
  }

  function layers() {
    var all = document.querySelectorAll(".screen *"), n = 0, scaled = 0;
    for (var i = 0; i < all.length; i++) {
      var cs = getComputedStyle(all[i]);
      if (cs.transform !== "none" || cs.willChange !== "auto") n++;
      if (cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)") scaled++;
    }
    return [["Elementos com transform/will-change (camadas)", String(n)],
            ["… com escala/transformação ativa agora", String(scaled)]];
  }

  // ---------- hipóteses ----------
  function hypotheses(v, lay, f, typo, img) {
    var out = [];
    var browserW = v.w * v.d;
    var up = PANEL_W / browserW;
    out.push([up > 1.05 ? "sd-bad" : "sd-ok",
      "H1 Renderização abaixo do painel: o navegador desenha " + Math.round(browserW) + " px de largura; o painel tem " + PANEL_W +
      " → ampliação estimada " + r1(up) + "× pelo sistema" + (up > 1.05 ? " (causa provável de falta de nitidez)" : "")]);
    var zoom = (v.vv && v.vv.scale !== 1) || (v.outerRatio && Math.abs(v.outerRatio - 1) > 0.05);
    out.push([zoom ? "sd-warn" : "sd-ok", "H2 Zoom do navegador: escala visual " + (v.vv ? v.vv.scale : "?") +
      ", outer/inner " + (v.outerRatio ? r1(v.outerRatio) : "?") + (zoom ? " (há zoom ativo)" : " (sem indício de zoom)")]);
    var aspect = v.w / v.h;
    out.push([Math.abs(aspect - 16 / 9) > 0.05 ? "sd-warn" : "sd-ok", "H3 Área útil: viewport " + v.w + "×" + v.h + " (proporção " + r1(aspect) +
      ", 16:9 = 1.8); a NEXUS ocupa " + (lay.rows[2] ? lay.rows[2][1] : "?")]);
    out.push([f.noBold || /padrão|não identificada/.test(f.resolved) ? "sd-warn" : "sd-ok",
      "H4 Fonte real: " + f.resolved + (f.noBold ? "; sem negrito próprio" : "") + " — títulos usam letter-spacing negativo (−0,01 a −0,02em)"]);
    out.push([typo.issues.length ? "sd-warn" : "sd-ok", "H5 Texto pequeno em pixels do navegador: " + (typo.issues.length ? typo.issues.join("; ") : "nenhum abaixo de 18 px")]);
    out.push([img.worst < 0.95 ? "sd-warn" : "sd-ok", "H6 Imagens: " + (img.worst === Infinity ? "nenhuma carregada" :
      (img.worst < 0.95 ? "alguma imagem é ampliada além da resolução natural" : "resolução natural suficiente para a área"))]);
    return out;
  }

  // ---------- interface do diagnóstico ----------
  var panel, showBtn, pattern;
  function table(rows) {
    var t = el("table");
    rows.forEach(function (r) { var tr = el("tr"); tr.appendChild(el("td", "", r[0])); tr.appendChild(el("td", "", r[1])); t.appendChild(tr); });
    return t;
  }
  function render() {
    var v = viewport(), lay = layout(), f = fonts(), typo = typography(v.d), img = images(v.d);
    var hyp = hypotheses(v, lay, f, typo, img);
    var body = panel.querySelector(".sd-body");
    body.textContent = "";
    body.appendChild(el("h3", "", "Hipóteses (medidas agora)"));
    hyp.forEach(function (h) { body.appendChild(el("div", h[0], h[1])); });
    body.appendChild(el("h3", "", "Viewport e tela"));
    body.appendChild(table(v.rows));
    body.appendChild(el("h3", "", "Escala da NEXUS"));
    body.appendChild(table(lay.rows));
    body.appendChild(el("h3", "", "Fontes"));
    body.appendChild(table(f.rows));
    body.appendChild(el("h3", "", "Tipografia na tela"));
    body.appendChild(table(typo.rows));
    body.appendChild(el("h3", "", "Imagens"));
    body.appendChild(table(img.rows.length ? img.rows : [["—", "nenhuma imagem medida"]]));
    body.appendChild(el("h3", "", "Camadas de composição"));
    body.appendChild(table(layers()));
    body.appendChild(el("h3", "", "Resumo para foto"));
    var sum = ["NEXUS escala · " + new Date().toLocaleString("pt-BR"),
      "inner " + v.w + "×" + v.h + " · outer " + window.outerWidth + "×" + window.outerHeight + " · dpr " + v.d +
      " · screen " + v.s.width + "×" + v.s.height + " · vv " + (v.vv ? r1(v.vv.width) + "×" + r1(v.vv.height) + "@" + v.vv.scale : "-"),
      "1rem " + lay.rem + "px · fonte: " + f.resolved].concat(hyp.map(function (h) { return h[1]; })).join("\n");
    body.appendChild(el("pre", "sd-summary", sum));
  }

  function drawLines(canvas, devicePixels) {
    var d = dpr(), r = canvas.getBoundingClientRect();
    var w = Math.round(r.width * d), h = Math.round(r.height * d);
    canvas.width = w; canvas.height = h;
    var c = canvas.getContext("2d"), step = devicePixels ? 1 : Math.max(1, Math.round(d));
    c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#000";
    for (var x = 0; x < w / 2; x += step * 2) c.fillRect(x, 0, step, h);           // colunas
    for (var y = 0; y < h; y += step * 2) c.fillRect(Math.ceil(w / 2), y, w, step);  // linhas
  }
  function buildPattern() {
    pattern = el("div", "sd-pattern");
    pattern.hidden = true;
    var left = el("div"), right = el("div");
    left.appendChild(el("div", "sd-label", "Linhas de 1 pixel do NAVEGADOR (1/dpr px CSS). Nítidas = sem ampliação; cinza/moiré = a TV amplia a imagem."));
    var c1 = el("canvas", "sd-lines"); c1.style.width = "100%"; left.appendChild(c1);
    left.appendChild(el("div", "sd-label", "Linhas de 1 px CSS."));
    var c2 = el("canvas", "sd-lines"); c2.style.width = "100%"; left.appendChild(c2);
    right.appendChild(el("div", "sd-label", "Amostras de texto (mesmo texto, fontes e pesos diferentes):"));
    [["pilha da NEXUS", getComputedStyle(document.body).fontFamily], ["sans-serif", "sans-serif"], ["Arial", "Arial, sans-serif"], ["Roboto", "Roboto, sans-serif"]].forEach(function (f) {
      [16, 24, 36].forEach(function (size) {
        [400, 700].forEach(function (wt) {
          var s = el("div", "sd-sample", size + "px " + wt + " · " + f[0] + " · Boa tarde · Série · 2026 · Netflix");
          s.style.fontFamily = f[1]; s.style.fontSize = size + "px"; s.style.fontWeight = wt;
          right.appendChild(s);
        });
      });
    });
    var close = el("button", "sd-btn", "Fechar padrão de teste");
    close.type = "button";
    close.addEventListener("click", function () { pattern.hidden = true; panel.hidden = false; });
    right.appendChild(close);
    pattern.appendChild(left); pattern.appendChild(right);
    document.body.appendChild(pattern);
    pattern._draw = function () { drawLines(c1, true); drawLines(c2, false); };
  }

  function build() {
    var link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "assets/css/scale-diag.css";
    document.head.appendChild(link);

    panel = el("div", "sd-panel");
    panel.appendChild(el("div", "", "NEXUS TV · diagnóstico de escala (?escala) — só mede, não altera a interface"));
    var btns = el("div", "sd-btns");
    [["Medir de novo", render], ["Padrão de teste", function () { panel.hidden = true; pattern.hidden = false; pattern._draw(); }],
     ["Ocultar painel", function () { panel.hidden = true; showBtn.hidden = false; }]].forEach(function (b) {
      var x = el("button", "sd-btn", b[0]); x.type = "button"; x.addEventListener("click", b[1]); btns.appendChild(x);
    });
    panel.appendChild(btns);
    panel.appendChild(el("div", "sd-body"));
    document.body.appendChild(panel);

    showBtn = el("button", "sd-btn sd-show", "Mostrar diagnóstico");
    showBtn.type = "button"; showBtn.hidden = true;
    showBtn.addEventListener("click", function () { panel.hidden = false; showBtn.hidden = true; render(); });
    document.body.appendChild(showBtn);

    buildPattern();
    render();
    // Mede de novo quando os dados e as imagens tiverem chegado.
    setTimeout(render, 1500);
    setTimeout(render, 5000);
    window.addEventListener("resize", function () { setTimeout(render, 200); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
