import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api, AuthError, dt, eur, getToken, num, pct, time, tone } from "./api.js";

const COLORS = { A: "#34c98b", B: "#5b8cff", C: "#f2b544" };
const AXIS = { stroke: "#5d636c", fontSize: 11, tickLine: false, axisLine: false };
const TT = { contentStyle: { background: "#1c1f24", border: "1px solid #2d3238", borderRadius: 10, fontSize: 12 }, labelStyle: { color: "#959ca6" } };

function usePoll(path, ms = 15000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api(path)); setError(null); } catch (e) {
      if (e instanceof AuthError) window.dispatchEvent(new Event("nexus-logout"));
      setError(e.message);
    }
  }, [path]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return { data, error, reload: load };
}

function Header({ title, children }) {
  return <div className="topbar"><h1>{title}</h1><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div></div>;
}
const Loading = ({ error }) => <div className="empty">{error ? <span className="down">{error}</span> : "A carregar…"}</div>;
const Kpi = ({ label, value, sub, cls }) => (
  <div className="card kpi"><div className="label">{label}</div><div className={`value ${cls || ""}`}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>
);

function SafeBanner({ d }) {
  if (!d?.safe_mode) return null;
  return <div className="banner bad"><b>MODO SEGURO ATIVO</b> — {d.safe_mode_reason}. Novas compras estão bloqueadas; apenas vendas de redução de risco são permitidas.</div>;
}

function MarketBadges({ markets }) {
  if (!markets) return null;
  return Object.values(markets).map((m) => (
    <span key={m.calendar} className={`badge ${m.open ? "ok" : ""}`} title={`${m.local_time} · próxima abertura ${dt(m.next_open)}`}>
      <span className="dot" />{m.calendar} {m.open ? "aberta" : "fechada"}
    </span>
  ));
}

// ------------------------------------------------------------------ Dashboard
export function Dashboard({ go }) {
  const { data: d, error } = usePoll("/dashboard", 20000);
  if (!d) return <><Header title="Dashboard" /><Loading error={error} /></>;
  if (!d.experiment) return (
    <><Header title="Dashboard"><MarketBadges markets={d.markets} /></Header>
      <div className="banner info">Nenhum experimento iniciado. Inicie um teste de 48 h em <a href="#" onClick={() => go("settings")}>Configurações</a>.</div></>
  );
  const t = d.totals;
  const hbAge = d.worker_heartbeat ? (Date.now() - new Date(d.worker_heartbeat)) / 1000 : null;
  return (
    <>
      <Header title="Dashboard">
        <span className={`badge ${hbAge != null && hbAge < 1800 ? "ok" : "bad"}`}><span className="dot" />Worker {hbAge != null ? `${Math.round(hbAge)}s` : "sem sinal"}</span>
        <MarketBadges markets={d.markets} />
      </Header>
      <SafeBanner d={d} />
      <div className="muted" style={{ marginBottom: 12 }}>{d.experiment.name} · {d.experiment.status} · início {dt(d.experiment.started_at)}{d.experiment.ends_at && ` · fim ${dt(d.experiment.ends_at)}`}</div>
      <div className="grid g4">
        <Kpi label="Patrimônio virtual" value={eur(t.equity)} sub={`Inicial ${eur(t.initial)}`} />
        <Kpi label="Lucro / Prejuízo" value={eur(t.pnl)} sub={pct(t.pnl_pct)} cls={tone(t.pnl)} />
        <Kpi label="Capital disponível" value={eur(t.cash)} sub={`Investido ${eur(t.invested)}`} />
        <Kpi label="Reserva" value={pct(t.reserve_pct, 1).replace("+", "")} sub="Mínimo obrigatório 30%" />
      </div>
      <div className="card section">
        <h3>Evolução patrimonial</h3>
        {d.equity_curve.length < 2 ? <div className="empty">Ainda sem histórico suficiente.</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={d.equity_curve}>
              <CartesianGrid stroke="#2d3238" vertical={false} />
              <XAxis dataKey="t" {...AXIS} tickFormatter={(v) => v.slice(5, 16).replace("T", " ")} minTickGap={40} />
              <YAxis {...AXIS} domain={["auto", "auto"]} width={60} />
              <Tooltip {...TT} formatter={(v) => eur(v)} />
              <Legend />
              {["A", "B", "C"].map((k) => <Line key={k} dataKey={k} name={`Agente ${k}`} stroke={COLORS[k]} dot={false} strokeWidth={2} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="grid g3 section">{d.agents.map((a) => <AgentCard key={a.agent} a={a} onClick={() => go("agents", { agent: a.agent })} />)}</div>
    </>
  );
}

function AgentCard({ a, onClick }) {
  return (
    <div className="card agent-card" onClick={onClick} style={{ cursor: "pointer" }}>
      <div className="head">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="agent-letter" style={{ color: COLORS[a.agent] }}>{a.agent}</div>
          <div><b>{a.profile}</b><div className="muted" style={{ fontSize: 12 }}>{a.strategy}</div></div>
        </div>
        <span className={`badge ${a.halted ? "bad" : "ok"}`}><span className="dot" />{a.halted ? "Bloqueado" : "Ativo"}</span>
      </div>
      <div className="kv section">
        <div>Patrimônio</div><div>{eur(a.equity)}</div>
        <div>Resultado</div><div className={tone(a.return_pct)}>{pct(a.return_pct)}</div>
        <div>Hoje</div><div className={tone(a.daily_change_pct)}>{pct(a.daily_change_pct)}</div>
        <div>Drawdown</div><div>{pct(a.drawdown_from_peak)} / limite -{(a.limits.max_drawdown_pct * 100).toFixed(0)}%</div>
        <div>Posições</div><div>{a.open_positions} / {a.limits.max_positions}</div>
        <div>Taxa de acerto</div><div>{a.win_rate == null ? "—" : pct(a.win_rate, 0).replace("+", "")}</div>
      </div>
      <div className="bar" title="Exposição investida"><div style={{ width: `${Math.min(100, (a.invested / a.equity) * 100)}%`, background: COLORS[a.agent] }} /></div>
      {a.halted && <div className="down" style={{ fontSize: 12, marginTop: 8 }}>{a.halt_reason}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Live monitoring
export function Live() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("a ligar…");
  const [filter, setFilter] = useState("all");
  const lastId = useRef(0);
  useEffect(() => {
    let es; let poll; let closed = false;
    const push = (list) => {
      if (!list.length) return;
      lastId.current = Math.max(lastId.current, ...list.map((e) => e.id));
      setEvents((prev) => [...list.reverse(), ...prev].slice(0, 600));
    };
    (async () => {
      try { const r = await api("/events?limit=150"); push(r.events); } catch (e) { if (e instanceof AuthError) window.dispatchEvent(new Event("nexus-logout")); }
      if (closed) return;
      es = new EventSource(`/api/events/stream?after_id=${lastId.current}&token=${encodeURIComponent(getToken() || "")}`);
      es.onopen = () => setStatus("ao vivo");
      es.onmessage = (m) => { try { push([JSON.parse(m.data)]); } catch { /* ignore */ } };
      es.onerror = () => {
        setStatus("reconectando (polling)");
        es.close();
        if (!poll) poll = setInterval(async () => { try { push((await api(`/events?after_id=${lastId.current}`)).events); } catch { /* retry */ } }, 5000);
      };
    })();
    return () => { closed = true; es && es.close(); poll && clearInterval(poll); };
  }, []);
  const shown = events.filter((e) => filter === "all" || e.agent === filter || e.category === filter);
  return (
    <>
      <Header title="Live Monitoring"><span className={`badge ${status === "ao vivo" ? "ok" : "warn"}`}><span className="dot" />{status}</span></Header>
      <div className="tabs">
        {["all", "A", "B", "C", "data", "analysis", "decision", "risk", "order", "system"].map((f) => (
          <button key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? "Tudo" : f.length === 1 ? `Agente ${f}` : f}</button>
        ))}
      </div>
      <div className="card feed">
        {shown.length === 0 && <div className="empty">Sem eventos.</div>}
        {shown.map((e) => (
          <div key={e.id} className={`row ${e.level}`}>
            <span className="muted">{time(e.ts)}</span>
            <span style={{ color: COLORS[e.agent] || "#959ca6" }}>{e.agent || "·"}</span>
            <span className="cat">{e.category}</span>
            <span className="msg">{e.message}</span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Eventos são factos operacionais registados (dados recebidos, regras avaliadas, decisões e ordens) numa cadeia de hashes verificável — não pensamentos internos de modelos de linguagem.</div>
    </>
  );
}

// ------------------------------------------------------------------ Market
const FEED_LABEL = { realtime: "Tempo real", delayed: "Atrasado", eod: "Fim do dia", stale: "Desatualizado", unknown: "Sem horário" };

export function Market() {
  const { data, error } = usePoll("/market", 30000);
  const [sel, setSel] = useState(null);
  if (sel) return <MarketDetail symbol={sel} back={() => setSel(null)} />;
  if (!data) return <><Header title="Mercado" /><Loading error={error} /></>;
  return (
    <>
      <Header title="Mercado"><MarketBadges markets={data.sessions} /></Header>
      <div className="banner info">
        Fontes: cotações <b>{data.config.quote}</b> · histórico <b>{data.config.history}</b> · câmbio <b>{data.config.fx}</b>.
        Cotações com mais de {data.config.max_quote_age_s}s com o mercado aberto são marcadas como desatualizadas e bloqueiam operações.
        {data.config.allow_delayed_trading ? " Negociação com dados atrasados: PERMITIDA (configuração)." : " Dados atrasados nunca são usados para operar."}
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Ativo</th><th>Bolsa</th><th>Preço</th><th>Var.</th><th>Hora (bolsa)</th><th className="hide-sm">Fuso</th><th>Fonte</th><th>Estado</th><th>Atraso</th></tr></thead>
          <tbody>
            {data.instruments.map((i) => {
              const q = i.quote;
              return (
                <tr key={i.symbol} className="click" onClick={() => setSel(i.symbol)}>
                  <td><b>{i.ticker}</b> <span className="muted hide-sm">{i.name}</span></td>
                  <td>{i.exchange} {i.market_open ? <span className="up">●</span> : <span className="muted">●</span>}</td>
                  <td>{q ? `${num(q.price, 2)} ${q.currency}` : "—"}</td>
                  <td className={tone(q?.change_pct)}>{q?.change_pct == null ? "—" : `${q.change_pct >= 0 ? "+" : ""}${num(q.change_pct)}%`}</td>
                  <td>{q?.timestamp ? new Date(q.timestamp).toLocaleString("pt-PT", { timeZone: i.timezone, dateStyle: "short", timeStyle: "medium" }) : "—"}</td>
                  <td className="muted hide-sm">{i.timezone}</td>
                  <td>{q?.source || "—"}</td>
                  <td>{q ? <span className={`pill ${q.feed}`}>{FEED_LABEL[q.feed]}{q.tradable ? "" : " · bloqueado"}</span> : <span className="pill unknown">sem dados</span>}</td>
                  <td>{q?.delay_seconds == null ? "—" : `${Math.round(q.delay_seconds)}s`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MarketDetail({ symbol, back }) {
  const { data, error } = usePoll(`/market/${encodeURIComponent(symbol)}`, 60000);
  if (!data) return <><Header title={symbol}><button className="btn ghost" onClick={back}>← Voltar</button></Header><Loading error={error} /></>;
  const s = data.indicators; const q = data.quote; const inst = data.instrument;
  return (
    <>
      <Header title={`${inst.ticker} · ${inst.name}`}><button className="btn ghost" onClick={back}>← Voltar</button></Header>
      <div className="grid g4">
        <Kpi label="Preço" value={q ? `${num(q.price)} ${q.currency}` : "—"} sub={q ? `${q.source} · ${FEED_LABEL[q.feed]} · ${dt(q.timestamp)}` : "sem cotação"} />
        <Kpi label="RSI 14" value={num(s?.rsi14, 1)} sub="sobrecompra > 70 · sobrevenda < 30" />
        <Kpi label="Volatilidade 20d (anual.)" value={s?.vol20 == null ? "—" : `${(s.vol20 * 100).toFixed(1)}%`} />
        <Kpi label="Momentum 3m" value={pct(s?.momentum_63)} cls={tone(s?.momentum_63)} />
      </div>
      {q && !q.tradable && <div className="banner bad section">Não negociável agora: {q.issues.join(", ")}</div>}
      <div className="card section">
        <h3>Preço diário · SMA50 · SMA200 · Bollinger</h3>
        {data.series.length === 0 ? <div className="empty">Sem histórico (fornecedor de histórico não configurado ou sem cobertura).</div> : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data.series}>
              <CartesianGrid stroke="#2d3238" vertical={false} />
              <XAxis dataKey="d" {...AXIS} minTickGap={40} />
              <YAxis {...AXIS} domain={["auto", "auto"]} width={60} />
              <Tooltip {...TT} />
              <Area dataKey="bb_high" stroke="none" fill="#5b8cff" fillOpacity={0.06} name="BB sup." />
              <Line dataKey="bb_low" stroke="#5b8cff" strokeOpacity={0.3} dot={false} name="BB inf." />
              <Line dataKey="c" stroke="#e9ebee" dot={false} strokeWidth={1.8} name="Fecho" />
              <Line dataKey="sma50" stroke="#34c98b" dot={false} name="SMA50" />
              <Line dataKey="sma200" stroke="#f2b544" dot={false} name="SMA200" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <div className="muted" style={{ fontSize: 11 }}>{data.bars_source}</div>
      </div>
      <div className="grid g2 section">
        <div className="card">
          <h3>RSI 14</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data.series}><XAxis dataKey="d" hide /><YAxis {...AXIS} domain={[0, 100]} width={30} /><Tooltip {...TT} />
              <ReferenceLine y={70} stroke="#ff5f5f" strokeDasharray="3 3" /><ReferenceLine y={30} stroke="#34c98b" strokeDasharray="3 3" />
              <Line dataKey="rsi" stroke="#5b8cff" dot={false} /></LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h3>Indicadores</h3>
          {s ? <div className="kv">
            <div>MACD / sinal</div><div>{num(s.macd, 3)} / {num(s.macd_signal, 3)}</div>
            <div>SMA20 / 50 / 200</div><div>{num(s.sma20)} / {num(s.sma50)} / {num(s.sma200)}</div>
            <div>Bollinger</div><div>{num(s.bb_low)} – {num(s.bb_high)}</div>
            <div>ATR 14</div><div>{num(s.atr14)}</div>
            <div>Suporte / Resistência (60d)</div><div>{num(s.support)} / {num(s.resistance)}</div>
            <div>Volume vs média 20d</div><div>{num(s.volume_ratio)}x</div>
            <div>Máx. 20 dias</div><div>{num(s.high_20)}</div>
          </div> : <div className="empty">Histórico insuficiente.</div>}
        </div>
      </div>
      <div className="card section"><h3>Notícias</h3><NewsList news={data.news} /></div>
    </>
  );
}

function NewsList({ news }) {
  if (!news?.length) return <div className="empty">Sem notícias registadas.</div>;
  return news.map((n, i) => (
    <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #2d3238" }}>
      <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>
      <div className="muted" style={{ fontSize: 12 }}>{n.symbol ? `${n.symbol} · ` : ""}{n.source} · {dt(n.published_at)} · sentimento <span className={tone(n.sentiment)}>{n.sentiment >= 0 ? "+" : ""}{num(n.sentiment)}</span> ({n.method})</div>
    </div>
  ));
}

// ------------------------------------------------------------------ Agents
export function Agents({ ctx }) {
  const [code, setCode] = useState(ctx?.agent || "A");
  const { data, error } = usePoll(`/agents/${code}`, 20000);
  return (
    <>
      <Header title="Agentes" />
      <div className="tabs">{["A", "B", "C"].map((c) => <button key={c} className={`tab ${c === code ? "active" : ""}`} onClick={() => setCode(c)}>Agente {c}</button>)}</div>
      {!data ? <Loading error={error} /> : <AgentDetail d={data} />}
    </>
  );
}

function AgentDetail({ d }) {
  const s = d.summary; const L = s.limits;
  return (
    <>
      {s.halted && <div className="banner bad">Compras bloqueadas pelo Risk Guardian: {s.halt_reason}</div>}
      <div className="grid g4">
        <Kpi label={`${s.profile} · capital`} value={eur(s.equity)} sub={`Inicial ${eur(s.initial_capital)}`} />
        <Kpi label="Resultado" value={pct(s.return_pct)} cls={tone(s.return_pct)} sub={`Realizado ${eur(s.realized_pnl)} · não realizado ${eur(s.unrealized_pnl)}`} />
        <Kpi label="Drawdown máximo" value={pct(s.max_drawdown)} sub={`Limite -${(L.max_drawdown_pct * 100).toFixed(0)}%`} />
        <Kpi label="Custos" value={eur(s.costs)} sub={`${s.orders_filled} ordens executadas`} />
      </div>
      <div className="grid g2 section">
        <div className="card"><h3>Estratégia</h3><p style={{ marginTop: 0 }}>{s.strategy}</p>
          <div className="kv">
            <div>Tamanho máx. por posição</div><div>{(L.max_position_pct * 100).toFixed(0)}%</div>
            <div>Máx. posições</div><div>{L.max_positions}</div>
            <div>Reserva mínima</div><div>{(L.min_cash_reserve_pct * 100).toFixed(0)}%</div>
            <div>Risco por operação</div><div>{(L.risk_per_trade_pct * 100).toFixed(2)}%</div>
            <div>Perda diária máx.</div><div>{(L.max_daily_loss_pct * 100).toFixed(0)}%</div>
            <div>Volatilidade máx.</div><div>{(L.max_annual_vol * 100).toFixed(0)}%</div>
            <div>Correlação máx.</div><div>{L.max_correlation}</div>
            <div>Stop / alvo</div><div>{L.stop_atr_mult}×ATR / {L.take_profit_atr_mult}×ATR</div>
          </div></div>
        <div className="card"><h3>Patrimônio</h3>
          {d.equity_curve.length < 2 ? <div className="empty">Sem histórico.</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d.equity_curve}><XAxis dataKey="t" hide /><YAxis {...AXIS} domain={["auto", "auto"]} width={55} /><Tooltip {...TT} labelFormatter={dt} formatter={(v) => eur(v)} />
                <Line dataKey="equity" stroke={COLORS[s.agent]} dot={false} strokeWidth={2} /></LineChart>
            </ResponsiveContainer>)}
        </div>
      </div>
      <div className="card section table-wrap"><h3>Posições</h3><Positions rows={d.positions} /></div>
      <div className="card section table-wrap"><h3>Ordens</h3>
        {d.orders.length === 0 ? <div className="empty">Sem ordens.</div> : (
          <table><thead><tr><th>Data</th><th>Ativo</th><th>Lado</th><th>Qtd</th><th>Motivo</th><th>Estado</th><th>Preço</th><th>Taxas</th><th>Slip.</th></tr></thead>
            <tbody>{d.orders.map((o) => (
              <tr key={o.id}><td>{dt(o.submitted_at)}</td><td>{o.symbol}</td><td><span className={`pill ${o.side}`}>{o.side}</span></td><td>{num(o.qty, 4)}</td>
                <td>{o.purpose}</td><td title={o.reason || ""}>{o.status}{o.reason ? ` (${o.reason})` : ""}</td><td>{num(o.fill_price, 4)}</td><td>{eur(o.fees_eur)}</td><td>{o.slippage_bps == null ? "—" : `${num(o.slippage_bps, 1)} bp`}</td></tr>))}</tbody></table>)}
      </div>
      <div className="card section table-wrap"><h3>Operações fechadas</h3>
        {d.trades.length === 0 ? <div className="empty">Nenhuma operação fechada.</div> : (
          <table><thead><tr><th>Fecho</th><th>Ativo</th><th>Qtd</th><th>Entrada</th><th>Saída</th><th>Resultado</th><th>Custos</th><th>Motivo</th></tr></thead>
            <tbody>{d.trades.map((t, i) => (
              <tr key={i}><td>{dt(t.closed_at)}</td><td>{t.symbol}</td><td>{num(t.qty, 4)}</td><td>{num(t.entry, 4)}</td><td>{num(t.exit, 4)}</td>
                <td className={tone(t.pnl_eur)}>{eur(t.pnl_eur)}</td><td>{eur(t.fees_eur)}</td><td>{t.reason}</td></tr>))}</tbody></table>)}
      </div>
      {d.incidents.length > 0 && <div className="card section"><h3>Incidentes de risco</h3>{d.incidents.map((i, k) => <div key={k} className="mono">{dt(i.ts)} · {i.kind} · {JSON.stringify(i.details)}</div>)}</div>}
    </>
  );
}

function Positions({ rows }) {
  if (!rows?.length) return <div className="empty">Sem posições abertas.</div>;
  return (
    <table><thead><tr><th>Ativo</th><th>Setor</th><th>Qtd</th><th>Preço médio</th><th>Último</th><th>Valor</th><th>Resultado</th><th>Stop</th><th>Alvo</th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.symbol}><td><b>{p.symbol}</b></td><td>{p.sector}</td><td>{num(p.qty, 4)}</td><td>{num(p.avg_price, 4)} {p.currency}</td><td>{num(p.last_price, 4)}</td>
          <td>{eur(p.value_eur)}</td><td className={tone(p.pnl_eur)}>{eur(p.pnl_eur)} ({pct(p.pnl_pct)})</td><td>{num(p.stop, 2)}</td><td>{num(p.take_profit, 2)}</td></tr>))}</tbody></table>
  );
}

// ------------------------------------------------------------------ Intelligence
export function Intelligence() {
  const [action, setAction] = useState("");
  const { data, error } = usePoll(`/intelligence${action ? `?action=${action}` : ""}`, 20000);
  return (
    <>
      <Header title="Inteligência" />
      {data && <div className="banner info">{data.ai_policy}</div>}
      <div className="tabs">{[["", "Todas"], ["buy", "Compras"], ["sell", "Vendas"], ["rejected", "Rejeitadas"]].map(([k, l]) => (
        <button key={k} className={`tab ${action === k ? "active" : ""}`} onClick={() => setAction(k)}>{l}</button>))}</div>
      {!data ? <Loading error={error} /> : (
        <div className="grid g2">
          <div className="card"><h3>Decisões e justificativas</h3>
            {data.decisions.length === 0 && <div className="empty">Nenhuma decisão registada. O agente pode permanecer sem operar quando não há oportunidades adequadas.</div>}
            {data.decisions.map((d) => <DecisionItem key={d.id} d={d} />)}
          </div>
          <div>
            <div className="card"><h3>Notícias e sentimento</h3><NewsList news={data.news} /></div>
            <div className="card section"><h3>Resultados empresariais (próx. 3 dias)</h3>
              {Object.keys(data.earnings_soon).length === 0 ? <div className="empty">Sem eventos no universo ou calendário indisponível.</div> :
                <div className="kv">{Object.entries(data.earnings_soon).slice(0, 40).map(([s, d]) => <Fragment key={s}><div>{s}</div><div>{d}</div></Fragment>)}</div>}
            </div>
          </div>
        </div>)}
    </>
  );
}

function DecisionItem({ d }) {
  const r = d.rationale || {}; const g = d.guardian || {};
  return (
    <details style={{ borderBottom: "1px solid #2d3238", padding: "8px 0" }}>
      <summary>
        <span className="muted">{dt(d.created_at)}</span> · <b style={{ color: COLORS[d.agent] }}>{d.agent}</b> · <b>{d.symbol}</b> · <span className={`pill ${d.action}`}>{d.action}</span>
        {r.type === "entry" && <> · score {num(d.score, 2)} / mín. {num(r.min_score, 2)}</>}
        {g.rejected_by?.length > 0 && <span className="down"> · {g.rejected_by.join(", ")}</span>}
        {r.type === "exit" && <> · {r.reason}</>}
      </summary>
      <div style={{ padding: "8px 0" }}>
        {r.reasons && <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }}>{r.reasons.map((x, i) => <li key={i} className={x.startsWith("FAIL") ? "down" : ""}>{x}</li>)}</ul>}
        {r.components && <div className="mono">Componentes: {Object.entries(r.components).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>}
        {r.sizing && <div className="mono">Dimensão: {num(r.sizing.qty, 4)} un · {eur(r.sizing.notional_eur)} · stop {r.sizing.stop} · alvo {r.sizing.take_profit} · custo est. {eur(r.sizing.est_roundtrip_cost_eur)}</div>}
        {g.checks && (
          <table style={{ marginTop: 8 }}><thead><tr><th>Regra do Risk Guardian</th><th>Valor</th><th>Limite</th><th></th></tr></thead>
            <tbody>{g.checks.map((c, i) => <tr key={i}><td>{c.rule}</td><td className="mono">{String(c.value ?? "")}</td><td className="mono">{String(c.limit ?? "")}</td><td className={c.passed ? "up" : "down"}>{c.passed ? "✓" : "✗"}</td></tr>)}</tbody></table>)}
        <details><summary>Dados brutos</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ Portfolio
export function Portfolio() {
  const { data, error } = usePoll("/portfolio", 20000);
  if (!data) return <><Header title="Carteira" /><Loading error={error} /></>;
  return (
    <>
      <Header title="Carteira" />
      {data.agents.map((a) => (
        <div key={a.agent} className="card section">
          <h3 style={{ color: COLORS[a.agent] }}>Agente {a.agent} · {a.profile} · {eur(a.equity)} · exposição {(a.exposure_pct * 100).toFixed(1)}% · caixa {eur(a.cash)}</h3>
          <div className="table-wrap"><Positions rows={a.positions} /></div>
          {Object.keys(a.sectors).length > 0 && (
            <div className="grid g2 section">
              <div><div className="muted" style={{ fontSize: 12 }}>Diversificação por setor (% do patrimônio)</div>
                {Object.entries(a.sectors).map(([s, v]) => <div key={s} style={{ marginTop: 6 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{s}</span><span>{(v * 100).toFixed(1)}%</span></div><div className="bar"><div style={{ width: `${Math.min(100, v * 100 / 0.3)}%`, background: COLORS[a.agent] }} /></div></div>)}
              </div>
              <div><div className="muted" style={{ fontSize: 12 }}>Mercados</div>
                <div className="kv" style={{ marginTop: 6 }}><div>Estados Unidos</div><div>{(a.markets.US * 100).toFixed(1)}%</div><div>Europa</div><div>{(a.markets.EU * 100).toFixed(1)}%</div><div>Caixa</div><div>{((a.cash / a.equity) * 100).toFixed(1)}%</div></div>
              </div>
            </div>)}
        </div>))}
    </>
  );
}

// ------------------------------------------------------------------ Reports
export function Reports() {
  const live = usePoll("/reports/live", 30000);
  const list = usePoll("/reports", 60000);
  const [rid, setRid] = useState(null);
  const rep = usePoll(rid ? `/reports/${rid}` : null, 3600000);
  return (
    <>
      <Header title="Relatórios" />
      <div className="banner info">Testes de 48 h e 7 dias não são suficientes para comprovar rentabilidade consistente. Compare sempre retorno, drawdown e custos.</div>
      <div className="card table-wrap"><h3>Comparação dos agentes (agora)</h3>{live.data ? <MetricsTable rows={live.data.agents} /> : <Loading error={live.error} />}</div>
      {rid && rep.data && (
        <div className="card section table-wrap">
          <h3>Relatório #{rep.data.id} ({rep.data.kind}) · {dt(rep.data.data.period.start)} → {dt(rep.data.data.period.end)} <button className="btn ghost" style={{ float: "right" }} onClick={() => setRid(null)}>Fechar</button></h3>
          <div className="muted" style={{ fontSize: 12 }}>Acumulado</div>
          <MetricsTable rows={Object.values(rep.data.data.agents).map((x) => x.cumulative)} />
          <div className="muted section" style={{ fontSize: 12 }}>No período</div>
          <MetricsTable rows={Object.values(rep.data.data.agents).map((x) => x.period)} />
          <div className="muted section" style={{ fontSize: 12 }}>{rep.data.data.disclaimer}</div>
        </div>)}
      <div className="grid g2 section">
        <div className="card"><h3>Relatórios gerados</h3>
          {list.data?.reports.length === 0 && <div className="empty">O primeiro relatório diário é gerado 24 h após o início.</div>}
          {list.data?.reports.map((r) => <div key={r.id} className="click" style={{ padding: "7px 0", borderBottom: "1px solid #2d3238", cursor: "pointer" }} onClick={() => setRid(r.id)}>#{r.id} · <b>{r.kind === "final" ? "Consolidado final" : "Diário"}</b> · {r.experiment} · <span className="muted">{dt(r.period_end)}</span></div>)}
        </div>
        <div className="card"><h3>Experimentos</h3>
          {list.data?.experiments.map((e) => <div key={e.id} style={{ padding: "7px 0", borderBottom: "1px solid #2d3238" }}><b>{e.name}</b> · {e.status} <div className="muted" style={{ fontSize: 12 }}>{dt(e.started_at)} → {dt(e.ended_at || e.ends_at)}</div></div>)}
        </div>
      </div>
    </>
  );
}

function MetricsTable({ rows }) {
  return (
    <table><thead><tr><th>Agente</th><th>Inicial</th><th>Atual</th><th>Rentab.</th><th>Realizado</th><th>Não real.</th><th>Prejuízo bruto</th><th>Custos</th><th>Operações</th><th>Acerto</th><th>Maior ganho</th><th>Maior perda</th><th>Drawdown</th><th>Volat.</th></tr></thead>
      <tbody>{rows.map((m) => (
        <tr key={m.agent}><td><b style={{ color: COLORS[m.agent] }}>{m.agent}</b> {m.profile}</td><td>{eur(m.initial_capital)}</td><td>{eur(m.equity)}</td>
          <td className={tone(m.return_pct)}>{pct(m.return_pct)}</td><td className={tone(m.realized_pnl)}>{eur(m.realized_pnl)}</td><td className={tone(m.unrealized_pnl)}>{eur(m.unrealized_pnl)}</td>
          <td>{eur(m.gross_loss)}</td><td>{eur(m.costs)}</td><td>{m.closed_trades}</td><td>{m.win_rate == null ? "—" : `${(m.win_rate * 100).toFixed(0)}%`}</td>
          <td>{eur(m.best_trade)}</td><td>{eur(m.worst_trade)}</td><td>{pct(m.max_drawdown)}</td><td>{m.volatility_ann == null ? "—" : `${(m.volatility_ann * 100).toFixed(1)}%`}</td></tr>))}</tbody></table>
  );
}

// ------------------------------------------------------------------ Settings
export function Settings() {
  const { data, error } = usePoll("/settings", 120000);
  const [kind, setKind] = useState("48h");
  const [capital, setCapital] = useState(400);
  const [msg, setMsg] = useState(null);
  const [audit, setAudit] = useState(null);
  const run = async (fn) => { setMsg(null); try { setMsg(await fn()); } catch (e) { setMsg({ error: e.message }); } };
  if (!data) return <><Header title="Configurações" /><Loading error={error} /></>;
  return (
    <>
      <Header title="Configurações" />
      <div className="grid g2">
        <div className="card">
          <h3>Novo experimento</h3>
          <div className="muted" style={{ fontSize: 12 }}>Os três agentes começam com o mesmo capital e as mesmas condições. O experimento em curso é finalizado (relatório consolidado) e todo o histórico é preservado.</div>
          <label>Duração</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="48h">48 horas (1.º teste)</option><option value="7d">7 dias (2.º teste)</option><option value="30d">30 dias (3.º teste)</option><option value="open">Sem fim definido</option></select>
          <label>Capital virtual por agente (EUR)</label>
          <input type="number" min="50" step="50" value={capital} onChange={(e) => setCapital(Number(e.target.value))} />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Total: {eur(capital * 3)}</div>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => window.confirm(`Iniciar experimento ${kind} com ${eur(capital)} por agente?`) &&
            run(() => api("/experiments", { method: "POST", body: { kind, capital_per_agent: capital, confirm: true } }))}>Iniciar</button>
          {msg && <div className={msg.error ? "down" : "up"} style={{ marginTop: 10 }}>{msg.error || JSON.stringify(msg)}</div>}
          <div className="section" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn danger" onClick={() => window.confirm("Sair do modo seguro? Confirme que a causa foi resolvida.") && run(() => api("/safe-mode/clear", { method: "POST" }))}>Sair do modo seguro</button>
            <button className="btn ghost" onClick={async () => setAudit(await api("/audit/verify"))}>Verificar auditoria</button>
          </div>
          {audit && <div className={audit.ok ? "up" : "down"} style={{ marginTop: 8 }}>{audit.ok ? `Cadeia íntegra (${audit.checked} eventos)` : `Cadeia quebrada no evento ${audit.broken_at}`}</div>}
        </div>
        <div className="card">
          <h3>🔒 Regras de segurança (protegidas)</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{data.protected_note}</div>
          <div className="kv">{Object.entries(data.hard_limits).map(([k, v]) => <Fragment key={k}><div>{k}</div><div className="mono">{typeof v === "number" && v < 1 ? `${(v * 100).toFixed(1)}%` : String(v)}</div></Fragment>)}</div>
        </div>
      </div>
      <div className="card section table-wrap"><h3>Perfis dos agentes (somente leitura)</h3>
        <table><thead><tr><th>Parâmetro</th><th>A</th><th>B</th><th>C</th></tr></thead>
          <tbody>{Object.keys(data.profiles.A).filter((k) => k !== "code").map((k) => <tr key={k}><td>{k}</td>{["A", "B", "C"].map((c) => <td key={c} className="mono">{String(data.profiles[c][k])}</td>)}</tr>)}</tbody></table>
      </div>
      <div className="grid g2 section">
        <div className="card"><h3>Fornecedores de dados</h3>
          {Object.entries(data.providers).map(([role, p]) => <div key={role} className="kv" style={{ marginBottom: 8 }}><div>{role}</div><div>{p.name || "—"} {p.name && (p.key_configured ? <span className="up">chave ✓</span> : <span className="down">sem chave</span>)} <span className="mono muted">{JSON.stringify(p.entitlement)}</span></div></div>)}
          <div className="kv"><div>LLM (sentimento)</div><div>{data.llm.enabled ? `${data.llm.model}` : "desativado"}</div></div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{data.llm.scope}</div>
        </div>
        <div className="card"><h3>Modelo de custos e execução</h3>
          <div className="kv">{Object.entries({ ...data.costs, ...data.runtime }).map(([k, v]) => <Fragment key={k}><div>{k}</div><div className="mono">{String(v)}</div></Fragment>)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Alterados apenas por variáveis de ambiente no servidor (com reinício), nunca pela IA.</div>
        </div>
      </div>
    </>
  );
}
