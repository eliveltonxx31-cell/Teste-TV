/*
 * NEXUS TV · função do Cloudflare Pages: GET /api/home
 *
 * Consulta a API do TMDB no servidor, com o token guardado como segredo
 * (variável TMDB_TOKEN no painel do Cloudflare), e devolve à TV um JSON
 * pequeno com destaques, filmes e séries por serviço de streaming.
 *
 * - O token nunca sai desta função: não aparece na resposta, nos erros
 *   nem em logs.
 * - A resposta fica em cache na borda (FRESH_TTL). Uma cópia "última boa"
 *   (STALE_TTL) é usada se o TMDB falhar.
 * - Os códigos dos serviços são consultados na própria API pelo nome
 *   (/watch/providers); nada é fixado no código.
 * - Disponibilidade por serviço vem da JustWatch via TMDB e pode estar
 *   incompleta ou desatualizada.
 *
 * Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB.
 */

const API = "https://api.themoviedb.org/3";
const REGION = "BR";
const LANG = "pt-BR";
const FRESH_TTL = 6 * 3600;      // 6 h
const STALE_TTL = 7 * 24 * 3600; // 7 dias
const TIMEOUT_MS = 8000;
const PER_LIST = 8;               // títulos por serviço e tipo
const LIST_LEN = 8;               // pôsteres por aba (Filmes, Séries)
const SVC_TV = 3, SVC_MOVIE = 2;   // títulos por serviço que podem ir para o destaque
const SCHEMA = 1;

// Serviços consultados. Os nomes são comparados com /watch/providers.
// Para incluir um serviço novo, acrescente aqui; a TV o recebe sem outra mudança.
const SERVICES = [
  { id: "netflix", names: ["Netflix"] },
  { id: "prime", names: ["Amazon Prime Video", "Prime Video"] },
  { id: "max", names: ["HBO Max", "Max"] },
  { id: "disney", names: ["Disney Plus", "Disney+"] },
  { id: "apple", names: ["Apple TV Plus", "Apple TV+", "Apple TV"] },
  { id: "globoplay", names: ["Globoplay"] }
];

export async function onRequestGet(context) {
  const { request, env } = context;
  const waitUntil = context.waitUntil ? context.waitUntil.bind(context) : function () {};
  const token = cleanToken(env && env.TMDB_TOKEN);
  // Segredo ausente no ambiente desta publicação. Sem cache, para que uma
  // correção no painel apareça na hora (após nova publicação).
  if (!token) return json({ error: "not_configured" }, 503, 0);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const origin = new URL(request.url).origin;
  const freshKey = new Request(origin + "/api/home?cache=fresh&v=" + SCHEMA);
  const staleKey = new Request(origin + "/api/home?cache=stale&v=" + SCHEMA);

  if (cache) {
    const hit = await cache.match(freshKey);
    if (hit) return withHeader(hit, "X-Nexus-Cache", "hit");
  }

  let data;
  try {
    data = await build(token);
  } catch (err) {
    if (cache) {
      const stale = await cache.match(staleKey);
      if (stale) return withHeader(stale, "X-Nexus-Cache", "stale");
    }
    // Só um código: nada do erro de origem (nem corpo, nem cabeçalhos) é repassado.
    return json({ error: classify(err) }, 502, 0);
  }

  const body = JSON.stringify(data);
  if (cache) {
    waitUntil(Promise.all([
      cache.put(freshKey, cached(body, FRESH_TTL)),
      cache.put(staleKey, cached(body, STALE_TTL))
    ]));
  }
  return withHeader(json(data, 200, 600), "X-Nexus-Cache", "miss");
}

// ---------- montagem ----------
async function build(token) {
  const get = function (path, params) { return tmdb(token, path, params); };

  const [config, provMovie, provTv, genMovie, genTv] = await Promise.all([
    get("/configuration"),
    get("/watch/providers/movie", { watch_region: REGION, language: LANG }),
    get("/watch/providers/tv", { watch_region: REGION, language: LANG }),
    get("/genre/movie/list", { language: LANG }),
    get("/genre/tv/list", { language: LANG })
  ]);

  const img = imageConfig(config);
  const providers = matchProviders([].concat(provMovie.results || [], provTv.results || []));
  const genres = {};
  [].concat(genMovie.genres || [], genTv.genres || []).forEach(function (g) { genres[g.id] = g.name; });

  const found = SERVICES.filter(function (s) { return providers[s.id]; });
  const lists = await Promise.all(found.reduce(function (acc, s) {
    ["tv", "movie"].forEach(function (type) {
      acc.push(get("/discover/" + type, {
        watch_region: REGION,
        with_watch_providers: String(providers[s.id].id),
        with_watch_monetization_types: "flatrate",
        sort_by: "popularity.desc",
        include_adult: "false",
        language: LANG,
        page: "1"
      }).then(function (r) { return { svc: s.id, type: type, results: r.results || [] }; },
              function () { return { svc: s.id, type: type, results: [] }; }));
    });
    return acc;
  }, []));

  const items = {};
  const services = {};
  const byType = { tv: [], movie: [] };
  found.forEach(function (s) {
    services[s.id] = { name: providers[s.id].name, tv: [], movie: [] };
  });

  lists.forEach(function (l) {
    let n = 0;
    for (let i = 0; i < l.results.length && n < PER_LIST; i++) {
      const r = l.results[i];
      if (!r || !r.id || !r.backdrop_path || !r.poster_path) continue;
      const key = l.type + ":" + r.id;
      if (!items[key]) items[key] = slim(r, l.type, genres);
      if (items[key].svc.indexOf(l.svc) < 0) items[key].svc.push(l.svc);
      services[l.svc][l.type].push(key);
      n++;
    }
  });

  // Listas gerais alternando serviços (um de cada, em rodízio), sem repetir.
  ["tv", "movie"].forEach(function (type) {
    const seen = {};
    for (let round = 0; round < PER_LIST; round++) {
      found.forEach(function (s) {
        const key = services[s.id][type][round];
        if (key && !seen[key]) { seen[key] = 1; byType[type].push(key); }
      });
    }
  });

  // Destaques: séries primeiro (mais "cinematográfico"), depois filmes.
  const featured = byType.tv.slice(0, 6).concat(byType.movie.slice(0, 3));
  const series = byType.tv.slice(0, LIST_LEN);
  const movies = byType.movie.slice(0, LIST_LEN);

  // Resposta enxuta: por serviço, só os títulos que podem ir para o destaque;
  // sinopse só para esses (os pôsteres das abas não a exibem).
  const outServices = {};
  const heroKeys = {};
  featured.forEach(function (k) { heroKeys[k] = 1; });
  found.forEach(function (s) {
    const sv = services[s.id];
    const top = sv.tv.slice(0, SVC_TV).concat(sv.movie.slice(0, SVC_MOVIE));
    top.forEach(function (k) { heroKeys[k] = 1; });
    outServices[s.id] = { name: sv.name, top: top };
  });
  const outItems = {};
  Object.keys(heroKeys).concat(series, movies).forEach(function (k) {
    if (outItems[k] || !items[k]) return;
    const it = items[k];
    outItems[k] = heroKeys[k] ? it : { t: it.t, type: it.type, y: it.y, g: it.g, p: it.p, b: it.b, svc: it.svc };
  });

  return {
    v: SCHEMA,
    generated: new Date().toISOString(),
    region: REGION,
    img: img,
    services: outServices,
    items: outItems,
    featured: featured,
    series: series,
    movies: movies,
    attribution: {
      tmdb: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
      justwatch: "Disponibilidade por serviço: JustWatch"
    }
  };
}

function slim(r, type, genres) {
  const date = type === "tv" ? r.first_air_date : r.release_date;
  const ov = (r.overview || "").trim();
  return {
    t: (type === "tv" ? r.name : r.title) || r.original_name || r.original_title || "",
    type: type,
    y: date ? String(date).slice(0, 4) : "",
    g: (r.genre_ids || []).map(function (id) { return genres[id]; }).filter(Boolean).slice(0, 2),
    ov: ov.length > 220 ? ov.slice(0, 217).replace(/\s+\S*$/, "") + "…" : ov,
    b: r.backdrop_path,
    p: r.poster_path,
    svc: []
  };
}

function matchProviders(list) {
  const out = {};
  SERVICES.forEach(function (s) {
    const wanted = s.names.map(function (n) { return n.toLowerCase(); });
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p && p.provider_name && wanted.indexOf(String(p.provider_name).toLowerCase()) >= 0) {
        out[s.id] = { id: p.provider_id, name: p.provider_name };
        break;
      }
    }
  });
  return out;
}

// Escolhe tamanhos próprios para TV a partir da configuração (nunca "original").
function imageConfig(config) {
  const images = (config && config.images) || {};
  const base = images.secure_base_url || "https://image.tmdb.org/t/p/";
  return {
    base: base,
    backdrop: pick(images.backdrop_sizes, 1280),
    backdropSmall: pick(images.backdrop_sizes, 780),
    poster: pick(images.poster_sizes, 342)
  };
}
function pick(sizes, want) {
  const widths = (sizes || []).filter(function (s) { return /^w\d+$/.test(s); })
    .map(function (s) { return +s.slice(1); }).sort(function (a, b) { return a - b; });
  if (!widths.length) return "w" + want;
  for (let i = 0; i < widths.length; i++) if (widths[i] >= want) return "w" + widths[i];
  return "w" + widths[widths.length - 1];
}

// ---------- utilitários ----------
// Aceita o "API Read Access Token" (v4, enviado como Bearer) ou a "API Key"
// (v3, 32 caracteres hexadecimais, enviada como api_key).
function cleanToken(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}
function isV3Key(token) {
  return /^[0-9a-f]{32}$/i.test(token);
}
async function tmdb(token, path, params, timeoutMs) {
  const url = new URL(API + path);
  Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
  const headers = { Accept: "application/json" };
  if (isV3Key(token)) url.searchParams.set("api_key", token);
  else headers.Authorization = "Bearer " + token;
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url.toString(), { headers: headers, signal: ctrl.signal });
    } catch (err) {
      // O cancelamento pelo nosso timer identifica o timeout, qualquer que seja o erro.
      if (ctrl.signal.aborted) { const t = new Error("tmdb timeout"); t.timeout = true; throw t; }
      throw err;
    }
    if (!res.ok) {
      const e = new Error("tmdb http");
      e.status = res.status;
      throw e;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
// Separa erro de autenticação (chave recusada) de erro de conexão.
function classify(err) {
  if (err && (err.status === 401 || err.status === 403)) return "tmdb_auth_failed";
  if (err && err.status) return "tmdb_http_" + err.status;
  if (err && (err.timeout || err.name === "AbortError")) return "tmdb_timeout";
  return "tmdb_unreachable";
}

function json(obj, status, maxAge) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? "public, max-age=" + maxAge : "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
function cached(body, ttl) {
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + ttl }
  });
}
function withHeader(res, name, value) {
  const r = new Response(res.body, res);
  r.headers.set(name, value);
  r.headers.set("Cache-Control", "public, max-age=600");
  return r;
}
