/*
 * NEXUS TV · diagnóstico da função: GET /api/health
 *
 * Responde se a publicação que atendeu a requisição enxerga o segredo
 * TMDB_TOKEN, sem nunca revelar o valor, o tamanho ou qualquer trecho dele.
 *
 *   /api/health          só verifica a configuração (não chama o TMDB)
 *   /api/health?check=1  também testa a chave no TMDB (uma chamada a /configuration)
 *   /api/health?assets=1 lê, pela própria publicação (env.ASSETS), o que ela contém
 *                        em "/", "/index.html", "/assets/js/apps.js" e "/diag/".
 *                        Mostra só status, tipo, tamanho e o <title> ou a 1ª linha.
 *
 * Resultados de "tmdb":
 *   not_checked · ok · auth_failed (TMDB recusou a chave) · http_<código> ·
 *   timeout · unreachable (sem conexão com o TMDB)
 */
const API = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 6000;
// Identifica a versão desta função na publicação (atualizado à mão a cada mudança).
const VERSION = "health-2-assets-probe";
const PROBE_PATHS = ["/", "/index.html", "/assets/js/apps.js", "/diag/"];

export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const raw = env.TMDB_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";

  const out = {
    function: "ok",
    version: VERSION,
    host: url.host,
    secret: {
      TMDB_TOKEN: token ? "present" : (raw === undefined ? "missing" : "empty"),
      // Formato, não o valor: ajuda a perceber se foi colada a chave errada.
      format: !token ? "none" : /^[0-9a-f]{32}$/i.test(token) ? "v3_api_key" :
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? "v4_read_token" : "unrecognized",
      surroundingWhitespace: typeof raw === "string" && raw !== raw.trim(),
      // Só os NOMES de outras variáveis parecidas (ex.: erro de digitação).
      similarNames: Object.keys(env).filter(function (k) { return k !== "TMDB_TOKEN" && /tmdb/i.test(k); })
    },
    tmdb: "not_checked"
  };

  if (token && url.searchParams.get("check") === "1") out.tmdb = await check(token);
  if (url.searchParams.get("assets") === "1") out.assets = await probeAssets(env, url.origin);
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

// Pergunta aos arquivos estáticos desta mesma publicação o que existe em cada caminho.
// Se "/assets/js/apps.js" voltar como text/html com o mesmo <title> da raiz, o
// arquivo não foi enviado no build e o Pages respondeu com a página da raiz.
async function probeAssets(env, origin) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return { error: "assets_binding_unavailable" };
  const out = {};
  for (let i = 0; i < PROBE_PATHS.length; i++) {
    const path = PROBE_PATHS[i];
    try {
      const res = await env.ASSETS.fetch(new Request(origin + path));
      const type = res.headers.get("Content-Type") || "";
      const text = await res.text();
      const title = /<title>([^<]*)<\/title>/i.exec(text);
      out[path] = {
        status: res.status,
        type: type.split(";")[0],
        bytes: text.length,
        title: title ? title[1] : null,
        firstLine: title ? null : text.split("\n")[0].slice(0, 60)
      };
    } catch (err) {
      out[path] = { error: "fetch_failed" };
    }
  }
  return out;
}

async function check(token) {
  const u = new URL(API + "/configuration");
  const headers = { Accept: "application/json" };
  if (/^[0-9a-f]{32}$/i.test(token)) u.searchParams.set("api_key", token);
  else headers.Authorization = "Bearer " + token;
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), { headers: headers, signal: ctrl.signal });
    if (res.ok) return "ok";
    if (res.status === 401 || res.status === 403) return "auth_failed";
    return "http_" + res.status;
  } catch (err) {
    return ctrl.signal.aborted || (err && err.name === "AbortError") ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
