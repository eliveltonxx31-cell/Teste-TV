import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api.js";
import { Dashboard, Market, Agents, Intelligence, Portfolio, Reports, Settings, Live } from "./pages.jsx";

const I = (d) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const PAGES = [
  ["dashboard", "Dashboard", I(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>), Dashboard],
  ["live", "Live", I(<><path d="M3 12h4l3-8 4 16 3-8h4" /></>), Live],
  ["market", "Mercado", I(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>), Market],
  ["agents", "Agentes", I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>), Agents],
  ["intel", "Inteligência", I(<><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" /></>), Intelligence],
  ["portfolio", "Carteira", I(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" /></>), Portfolio],
  ["reports", "Relatórios", I(<><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>), Reports],
  ["settings", "Config.", I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></>), Settings],
];

function Login({ onDone }) {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api("/auth/login", { method: "POST", body: { username: u, password: p } });
      setToken(r.token); onDone();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 6 }}>NEXUS <span>AI</span> TRADING</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Paper trading · capital virtual · sem ordens reais</div>
        <label>Utilizador</label><input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
        <label>Palavra-passe</label><input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="down" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={busy}>Entrar</button>
      </form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState(() => {
    try { return sessionStorage.getItem("nexus_page") || "dashboard"; } catch { return "dashboard"; }
  });
  const [ctx, setCtx] = useState({});
  useEffect(() => { try { sessionStorage.setItem("nexus_page", page); } catch { /* ignore */ } }, [page]);
  useEffect(() => {
    const h = () => setAuthed(false);
    window.addEventListener("nexus-logout", h);
    return () => window.removeEventListener("nexus-logout", h);
  }, []);
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const go = (p, extra = {}) => { setCtx(extra); setPage(p); window.scrollTo(0, 0); };
  const Page = (PAGES.find((x) => x[0] === page) || PAGES[0])[3];
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">NEXUS <span>AI</span> TRADING</div>
        {PAGES.map(([id, label, icon]) => (
          <button key={id} className={`nav-btn ${page === id ? "active" : ""}`} onClick={() => go(id)}>{icon}{label}</button>
        ))}
        <div className="foot">
          PAPER TRADING · capital virtual.<br />Nenhuma ordem real é enviada.
          <br /><button className="nav-btn" style={{ padding: "8px 0" }} onClick={() => { setToken(null); setAuthed(false); }}>Sair</button>
        </div>
      </aside>
      <main className="main"><Page go={go} ctx={ctx} /></main>
      <nav className="tabbar">
        {PAGES.map(([id, label, icon]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}>{icon}{label}</button>
        ))}
      </nav>
    </div>
  );
}
