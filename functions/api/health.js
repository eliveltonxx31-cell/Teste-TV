/*
 * NEXUS TV · diagnóstico da função: GET /api/health
 *
 * Responde se a publicação que atendeu a requisição enxerga o segredo
 * TMDB_TOKEN, sem nunca revelar o valor, o tamanho ou qualquer trecho dele.
 *
 *   /api/health          só verifica a configuração (não chama o TMDB)
 *   /api/health?check=1  também testa a chave no TMDB (uma chamada a /configuration)
 *
 * Resultados de "tmdb":
 *   not_checked · ok · auth_failed (TMDB recusou a chave) · http_<código> ·
 *   timeout · unreachable (sem conexão com o TMDB)
 */
const API = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 6000;

export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const raw = env.TMDB_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";

  const out = {
    function: "ok",
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
  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
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
