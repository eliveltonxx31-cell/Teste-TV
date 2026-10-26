// Ponto de entrada: liga tabuleiro, partida, motores, armazenamento e interface.

import { Game } from './game.js';
import { BoardView } from './board.js';
import { EngineController } from './engine.js';
import { AnalysisCache, classifyLines, classifyPlayedMove, DEFAULT_THRESHOLDS } from './analysis-core.js';
import { formatScore, toWhitePov, scoreToCp, uciToMove } from './uci.js';
import { ANALYSIS_PROFILES, OPPONENT_LEVELS, opponentFromElo, clampProfile, ELO_DISCLAIMER } from './profiles.js';
import { openStorage, requestPersistence } from './storage.js';
import { Metrics } from './metrics.js';
import { PALETTES, applyPalette } from './palette.js';

const $ = (s) => document.querySelector(s);
const SYM = { best: '✓', alt: '!', dubious: '?!', blunder: '??' };

const DEFAULT_SETTINGS = {
  profileId: 'intermediate',
  custom: null, // perfil personalizado (quando o usuário edita os campos)
  palette: 'default',
  customColors: { ...PALETTES.default },
  arrows: true,
  flipped: false,
  thresholds: { ...DEFAULT_THRESHOLDS },
};

const app = {
  game: new Game(),
  settings: structuredClone(DEFAULT_SETTINGS),
  storage: null,
  metrics: new Metrics(),
  cache: new AnalysisCache(300), // resultados completos (MultiPV) por posição
  evals: new AnalysisCache(1000), // melhor placar por posição, para classificar lances jogados
  analysisPaused: false,
  view: null, // último resultado exibido { fen, lines, ... }
  training: null, // { userColor, level, showAnalysis }
  opponentThinking: false,
};

// ---------- Motores ----------

const engine = new EngineController({
  name: 'analysis',
  onStatus: ({ state, detail }) => {
    const chip = $('#engine-chip');
    chip.classList.toggle('err', state === 'error');
    chip.classList.toggle('warn', state === 'loading');
    if (state === 'loading') chip.textContent = 'Motor: carregando…';
    if (state === 'ready' && detail?.loadMs != null) {
      app.metrics.engineLoadMs = detail.loadMs;
      chip.textContent = 'Motor pronto';
      requestAnalysis(); // primeira carga ou recuperação após erro
    }
    if (state === 'searching') chip.textContent = 'Calculando';
    if (state === 'ready' && detail?.loadMs == null) chip.textContent = app.analysisPaused ? 'Pausado' : 'Motor pronto';
    if (state === 'error') {
      app.metrics.restarts++;
      chip.textContent = 'Motor: erro — reiniciando';
    }
  },
});

let opponent = null;
function getOpponent() {
  opponent ??= new EngineController({ name: 'opponent' });
  return opponent;
}

function currentProfile() {
  const s = app.settings;
  return s.profileId === 'custom' && s.custom ? clampProfile(s.custom) : ANALYSIS_PROFILES[s.profileId] || ANALYSIS_PROFILES.intermediate;
}

// ---------- Análise ----------

function analysisVisible() {
  return !app.training || app.training.showAnalysis;
}

function requestAnalysis() {
  const fen = app.game.fen;
  const status = app.game.status();
  if (status.over) {
    engine.stop();
    showGameOver(status);
    return;
  }
  if (app.analysisPaused || document.hidden || !analysisVisible() || app.opponentThinking) {
    engine.stop();
    showLines(fen, null);
    return;
  }
  const p = currentProfile();
  const cached = app.cache.get(fen, p.multipv, p.depth);
  if (cached) {
    app.metrics.cacheHits++;
    engine.stop();
    showResult(cached);
    return;
  }
  showLines(fen, null, 'Calculando…');
  engine.setOptions({ MultiPV: p.multipv, Hash: p.hashMb });
  engine.analyze({
    fen,
    multipv: p.multipv,
    depth: p.depth,
    movetimeMs: p.movetimeMs,
    onUpdate: (snap) => {
      if (snap.lines[0]?.depth >= 8) rememberEval(snap);
      scheduleRender(snap);
    },
  }).then((res) => {
    if (res.cancelled) {
      app.metrics.cancelled++;
      return;
    }
    app.metrics.record(res);
    if (res.lines.length) {
      app.cache.set(res.fen, p.multipv, res);
      rememberEval(res);
    }
  }).catch(() => { /* o onStatus já mostra o erro; nova tentativa ocorre ao reiniciar */ });
}

function rememberEval(snap) {
  const l = snap.lines[0];
  if (!l) return;
  app.evals.set(snap.fen, 0, { depth: l.depth, score: l.score, best: l.pv[0] });
  updateMoveClassification(snap.fen);
}

// Classifica o lance que levou a `fen` (ou o lance que sai de `fen`) quando as duas avaliações existem.
function updateMoveClassification(fen) {
  const g = app.game;
  let changed = false;
  for (let i = 0; i < g.moves.length; i++) {
    const before = g.fenAt(i), after = g.moves[i].fenAfter;
    if (before !== fen && after !== fen) continue;
    const pe = app.evals.get(before, 0, 0), ce = app.evals.get(after, 0, 0);
    let res = null;
    if (pe && ce) res = classifyPlayedMove(pe.score, ce.score, g.moves[i].uci, pe.best, app.settings.thresholds);
    else if (pe && pe.best === g.moves[i].uci) res = { loss: 0, cls: 'best' };
    if (res && g.moves[i].cls !== res.cls) {
      g.moves[i].cls = res.cls;
      changed = true;
    }
  }
  if (changed) {
    renderMoveList();
    renderBoard();
  }
}

let renderPending = null;
function scheduleRender(snap) {
  const first = !renderPending;
  renderPending = snap;
  if (first) {
    requestAnimationFrame(() => {
      const s = renderPending;
      renderPending = null;
      if (s) showResult(s);
    });
  }
}

function showResult(res) {
  // Nunca mostrar resultado de uma posição que não é a atual.
  if (res.fen !== app.game.fen) return;
  showLines(res.fen, res);
}

function showLines(fen, res, placeholder = '') {
  const turn = fen.split(' ')[1];
  const list = $('#lines');
  app.view = res;
  if (!res || !res.lines.length) {
    const msg = placeholder || (app.analysisPaused ? 'Análise pausada' :
      app.opponentThinking ? 'Adversário pensando…' :
      !analysisVisible() ? 'Análise oculta durante o treino' : '');
    list.innerHTML = msg ? `<li class="placeholder">${msg}</li>` : '';
    $('#eval').textContent = '…';
    $('#stats').textContent = '';
    setEvalBar(null);
    renderBoard();
    return;
  }
  const lines = classifyLines(res.lines, app.settings.thresholds);
  const main = toWhitePov(lines[0].score, turn);
  $('#eval').textContent = formatScore(main);
  setEvalBar(main);
  const p = currentProfile();
  const secs = (res.wallMs / 1000).toFixed(1);
  const knps = res.nps ? ` · ${Math.round(res.nps / 1000)} kn/s` : '';
  $('#stats').textContent = `prof. ${res.depth}/${p.depth} · ${secs} s${knps}${res.final ? '' : ' …'}`;

  const startNo = +fen.split(' ')[5];
  list.innerHTML = lines.map((l, i) => {
    const san = Game.pvToSan(fen, l.pv, 8);
    let no = startNo, white = turn === 'w';
    const parts = san.map((m, k) => {
      const prefix = white ? `${no}.` : k === 0 ? `${no}…` : '';
      if (!white) no++;
      white = !white;
      return `${prefix}${k === 0 ? `<b>${m}</b>` : m}`;
    });
    const score = formatScore(toWhitePov(l.score, turn));
    const label = `${i === 0 ? 'Melhor lance' : 'Alternativa'} ${san[0] || ''}, ${score}`;
    return `<li class="${l.cls}"><button type="button" data-uci="${l.pv[0]}" aria-label="${label}">
      <span class="sym" aria-hidden="true">${SYM[l.cls]}</span>
      <span class="sc">${score}</span>
      <span class="pv">${parts.join(' ')}</span></button></li>`;
  }).join('');
  renderBoard();
}

function setEvalBar(scoreWhite) {
  let pct = 50;
  if (scoreWhite) {
    const cp = Math.max(-1500, Math.min(1500, scoreToCp(scoreWhite)));
    pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
  }
  $('#evalfill').style.width = `${pct.toFixed(1)}%`;
}

function showGameOver(status) {
  const res = status.kind === 'checkmate' ? (app.game.turn === 'w' ? '0–1' : '1–0') : '½–½';
  $('#eval').textContent = res;
  $('#stats').textContent = '';
  $('#lines').innerHTML = `<li class="placeholder">${status.text}</li>`;
  setEvalBar(status.kind === 'checkmate' ? { type: 'mate', value: app.game.turn === 'w' ? -1 : 1 } : null);
  app.view = null;
  renderBoard();
}

// ---------- Tabuleiro e interface ----------

const board = new BoardView($('#board'), {
  onMove: (m) => onUserMove(m),
  canSelect: (color) => !app.training || (color === app.training.userColor && !app.opponentThinking),
});

function renderBoard() {
  const g = app.game;
  const last = g.lastMove;
  let arrows = [];
  if (app.settings.arrows && app.view && app.view.fen === g.fen && analysisVisible()) {
    arrows = classifyLines(app.view.lines, app.settings.thresholds)
      .map((l) => ({ ...uciToMove(l.pv[0]), cls: l.cls }));
  }
  board.render(g, { lastMove: last, lastCls: last?.cls, arrows });
  const st = g.status();
  $('#status').textContent = st.text;
}

function renderMoveList() {
  const el = $('#movelist');
  const g = app.game;
  el.innerHTML = g.moveList().map((m) => {
    const no = m.white ? `<span class="no">${m.no}.</span>` : (m.ply === 1 ? `<span class="no">${m.no}…</span>` : '');
    const cls = m.cls && m.cls !== 'best' ? ` data-cls="${m.cls}" data-sym="${SYM[m.cls]}"` : '';
    return `${no}<button type="button" data-ply="${m.ply}"${cls}${m.ply === g.ply ? ' class="cur" aria-current="true"' : ''}>${m.san}</button>`;
  }).join('');
  el.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function refresh() {
  renderMoveList();
  renderBoard();
  requestAnalysis();
  saveSessionSoon();
  $('#mode-chip').textContent = app.training ? `Treino · ${app.training.level.label}` : app.game.source === 'pgn' ? 'PGN' : app.game.source === 'fen' ? 'FEN' : 'Tabuleiro';
}

async function onUserMove({ from, to }) {
  const g = app.game;
  let promotion;
  if (g.isPromotion(from, to)) {
    promotion = await board.askPromotion(g.turn);
    if (!promotion) return renderBoard();
  }
  if (!g.play({ from, to, promotion })) return renderBoard();
  refresh();
  maybeOpponentMove();
}

function navigate(fn) {
  if (fn()) {
    if (app.opponentThinking) cancelOpponent();
    refresh();
  }
}

// ---------- Treino ----------

function maybeOpponentMove() {
  const t = app.training;
  const g = app.game;
  if (!t || g.turn === t.userColor || g.ply !== g.length || g.status().over || app.opponentThinking) return;
  app.opponentThinking = true;
  const fen = g.fen;
  const opp = getOpponent();
  opp.setOptions({ MultiPV: 1, Hash: 16, ...t.level.options });
  requestAnalysis(); // pausa a análise enquanto o adversário pensa (economia de bateria)
  opp.analyze({ fen, depth: t.level.depth || undefined, movetimeMs: t.level.movetimeMs })
    .then((res) => {
      app.opponentThinking = false;
      if (res.cancelled || app.game.fen !== fen || !app.training) return refresh();
      if (res.bestmove) app.game.play(uciToMove(res.bestmove));
      refresh();
    })
    .catch(() => {
      app.opponentThinking = false;
      $('#status').textContent = 'O adversário falhou; toque em Treino para retomar.';
      refresh();
    });
}

function cancelOpponent() {
  opponent?.stop();
  app.opponentThinking = false;
}

function startTraining() {
  const colorSel = document.querySelector('input[name="train-color"]:checked').value;
  const userColor = colorSel === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorSel;
  const levelId = $('#train-level').value;
  const level = levelId === 'elo' ? opponentFromElo(+$('#train-elo').value) : OPPONENT_LEVELS[levelId];
  if (!$('#train-from-current').checked) app.game.reset();
  else app.game.reset(app.game.fen); // a posição atual vira o ponto de partida
  app.game.source = 'training';
  app.training = { userColor, level, levelId, showAnalysis: $('#train-show').checked };
  engine.newGame();
  getOpponent().newGame();
  board.setFlipped(userColor === 'b');
  $('#dlg-train').close();
  refresh();
  maybeOpponentMove();
}

function stopTraining() {
  cancelOpponent();
  app.training = null;
  opponent?.terminate(); // libera memória e CPU do segundo motor
  opponent = null;
  $('#dlg-train').close();
  refresh();
}

// ---------- Importação ----------

function importText(text) {
  const t = text.trim();
  if (!t) throw new Error('Cole um PGN ou uma FEN.');
  const looksFen = /^[pnbrqkPNBRQK1-8/]+ [wb] /.test(t) && !t.includes('\n');
  if (looksFen) app.game.loadFen(t);
  else app.game.loadPgn(t);
  app.training = null;
  engine.newGame();
}

// ---------- Persistência ----------

let saveTimer = null;
function saveSessionSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    app.storage?.setSetting('session', { pgn: app.game.toPgn(), ply: app.game.ply, source: app.game.source }).catch(() => {});
  }, 800);
}

function saveSettings() {
  app.storage?.setSetting('settings', app.settings).catch(() => {});
}

function gameTitle(g) {
  const h = g.headers || {};
  if (h.White && h.White !== '?') return `${h.White} × ${h.Black || '?'}${h.Date && !h.Date.includes('?') ? ` · ${h.Date}` : ''}`;
  return `Partida de ${new Date().toLocaleDateString('pt-BR')} · ${Math.ceil(g.length / 2)} lances`;
}

async function renderGames() {
  const list = $('#games-list');
  const games = await app.storage.listGames();
  $('#games-note').textContent = app.storage.persistent ? '' :
    'Armazenamento local indisponível neste modo de navegação: as partidas ficam só até fechar a página.';
  list.innerHTML = games.length ? '' : '<li><span>Nenhuma partida salva.</span></li>';
  for (const rec of games) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = rec.title;
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Abrir';
    open.onclick = () => {
      try {
        app.game.loadPgn(rec.pgn);
        app.training = null;
        engine.newGame();
        $('#dlg-games').close();
        refresh();
      } catch (e) {
        $('#games-note').textContent = e.message;
      }
    };
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Excluir';
    del.onclick = async () => { await app.storage.deleteGame(rec.id); renderGames(); };
    li.append(span, open, del);
    list.appendChild(li);
  }
}

// ---------- Ajustes ----------

function fillProfileSelects() {
  const opts = Object.entries(ANALYSIS_PROFILES).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('') +
    '<option value="custom">Personalizado</option>';
  $('#profile-select').innerHTML = opts;
  $('#profile-quick').innerHTML = Object.entries(ANALYSIS_PROFILES)
    .map(([id, p]) => `<option value="${id}">${p.short}</option>`).join('') + '<option value="custom">Pers.</option>';
  $('#train-level').innerHTML = Object.entries(OPPONENT_LEVELS).map(([id, l]) => `<option value="${id}">${l.label}</option>`).join('') +
    '<option value="elo">Por rating (estimado)</option>';
  $('#elo-disclaimer').textContent = ELO_DISCLAIMER;
}

function syncSettingsUi() {
  const s = app.settings;
  const p = currentProfile();
  $('#profile-select').value = s.profileId;
  $('#profile-quick').value = s.profileId;
  $('#p-multipv').value = p.multipv;
  $('#p-depth').value = p.depth;
  $('#p-movetime').value = p.movetimeMs;
  $('#p-hash').value = p.hashMb;
  $('#palette-select').value = s.palette;
  const colors = s.palette === 'custom' ? s.customColors : PALETTES[s.palette];
  for (const k of ['best', 'alt', 'dubious', 'blunder']) $(`#c-${k}`).value = colors[k];
  $('#opt-arrows').checked = s.arrows;
  applyPalette(colors);
}

function setProfile(id) {
  app.settings.profileId = id;
  if (id === 'custom' && !app.settings.custom) app.settings.custom = { ...ANALYSIS_PROFILES.intermediate };
  saveSettings();
  syncSettingsUi();
  requestAnalysis();
}

function renderDiag() {
  const m = app.metrics.summary();
  const fmt = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);
  const rows = [
    ['Motor', engine.engineName || '—'],
    ['Carregamento', fmt(m.engineLoadMs, ' ms')],
    ['1ª linha (mediana)', fmt(m.firstInfoMedianMs, ' ms')],
    ['Tempo por análise', fmt(m.wallMedianMs, ' ms')],
    ['Profundidade (mediana)', fmt(m.depthMedian)],
    ['Velocidade', m.npsMedian ? `${Math.round(m.npsMedian / 1000)} kn/s` : '—'],
    ['Análises / canceladas', `${m.analyses} / ${m.cancelled}`],
    ['Cache', `${app.cache.size} posições · ${m.cacheHits} acertos`],
    ['Reinícios do motor', String(m.restarts)],
    ['Memória JS', m.jsHeapMb == null ? 'não exposta por este navegador' : `${m.jsHeapMb} MB`],
    ['Núcleos', fmt(m.cores)],
    ['Armazenamento', app.storage?.persistent ? 'IndexedDB' : `memória (${app.storage?.reason || '—'})`],
    ['Offline', navigator.serviceWorker?.controller ? 'recursos em cache' : 'ainda não disponível'],
  ];
  $('#diag').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- Eventos ----------

function bindUi() {
  document.querySelector('.dock').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const g = app.game;
    switch (act) {
      case 'first': return navigate(() => g.first());
      case 'back': return navigate(() => g.back());
      case 'forward': return navigate(() => g.forward());
      case 'last': return navigate(() => g.last());
      case 'flip':
        app.settings.flipped = !board.flipped;
        board.setFlipped(app.settings.flipped);
        return saveSettings();
      case 'pause':
        app.analysisPaused = !app.analysisPaused;
        $('#btn-pause').setAttribute('aria-pressed', String(app.analysisPaused));
        $('#btn-pause').textContent = app.analysisPaused ? '▶︎' : '⏸︎';
        $('#btn-pause').setAttribute('aria-label', app.analysisPaused ? 'Retomar análise' : 'Pausar análise');
        return requestAnalysis();
      case 'reset':
        cancelOpponent();
        app.training = null;
        g.reset();
        engine.newGame();
        return refresh();
      case 'import':
        $('#import-error').textContent = '';
        return $('#dlg-import').showModal();
      case 'train':
        $('#train-stop').hidden = !app.training;
        return $('#dlg-train').showModal();
      case 'games':
        renderGames();
        return $('#dlg-games').showModal();
      default:
    }
  });

  $('#profile-quick').addEventListener('change', (e) => setProfile(e.target.value));
  $('#profile-select').addEventListener('change', (e) => setProfile(e.target.value));
  for (const [id, key] of [['#p-multipv', 'multipv'], ['#p-depth', 'depth'], ['#p-movetime', 'movetimeMs'], ['#p-hash', 'hashMb']]) {
    $(id).addEventListener('change', (e) => {
      app.settings.custom = clampProfile({ ...currentProfile(), [key]: e.target.value });
      app.settings.profileId = 'custom';
      saveSettings();
      syncSettingsUi();
      requestAnalysis();
    });
  }
  $('#palette-select').addEventListener('change', (e) => {
    app.settings.palette = e.target.value;
    saveSettings();
    syncSettingsUi();
  });
  for (const k of ['best', 'alt', 'dubious', 'blunder']) {
    $(`#c-${k}`).addEventListener('input', (e) => {
      if (app.settings.palette !== 'custom') {
        app.settings.customColors = { ...PALETTES[app.settings.palette] };
        app.settings.palette = 'custom';
      }
      app.settings.customColors[k] = e.target.value;
      saveSettings();
      syncSettingsUi();
    });
  }
  $('#opt-arrows').addEventListener('change', (e) => {
    app.settings.arrows = e.target.checked;
    saveSettings();
    renderBoard();
  });
  $('#btn-settings').addEventListener('click', () => {
    syncSettingsUi();
    renderDiag();
    $('#dlg-settings').showModal();
  });
  $('#engine-restart').addEventListener('click', async () => {
    $('#engine-restart').disabled = true;
    try { await engine.restart(); } catch { /* o chip mostra o erro */ }
    $('#engine-restart').disabled = false;
    renderDiag();
  });
  $('#cache-clear').addEventListener('click', () => {
    app.cache.clear();
    app.evals.clear();
    renderDiag();
  });

  $('#lines').addEventListener('click', (e) => {
    const uci = e.target.closest('button[data-uci]')?.dataset.uci;
    if (uci && app.view?.fen === app.game.fen) onUserMove(uciToMove(uci));
  });
  $('#movelist').addEventListener('click', (e) => {
    const ply = e.target.closest('button[data-ply]')?.dataset.ply;
    if (ply) navigate(() => app.game.goto(+ply));
  });

  $('#import-go').addEventListener('click', () => {
    try {
      importText($('#import-text').value);
      $('#dlg-import').close();
      $('#import-text').value = '';
      refresh();
    } catch (err) {
      $('#import-error').textContent = err.message;
    }
  });
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      $('#import-error').textContent = 'Arquivo muito grande (máx. 2 MB). Para PGN com várias partidas, cole só uma.';
      return;
    }
    $('#import-text').value = await f.text();
  });

  $('#train-level').addEventListener('change', (e) => { $('#elo-box').hidden = e.target.value !== 'elo'; });
  $('#train-elo').addEventListener('input', (e) => { $('#elo-out').textContent = e.target.value; });
  $('#train-go').addEventListener('click', startTraining);
  $('#train-stop').addEventListener('click', stopTraining);

  $('#game-save').addEventListener('click', async () => {
    await app.storage.saveGame({ title: gameTitle(app.game), pgn: app.game.toPgn(), createdAt: Date.now() });
    renderGames();
  });
  $('#game-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(app.game.toPgn());
      $('#games-note').textContent = 'PGN copiado.';
    } catch {
      $('#games-note').textContent = 'Não foi possível copiar (permissão negada pelo navegador).';
    }
  });
  $('#game-download').addEventListener('click', () => {
    const blob = new Blob([app.game.toPgn()], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'partida.pgn';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // Fecha diálogos tocando fora deles.
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  // Teclado (útil no iPad/Mac): setas navegam.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]') || e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') navigate(() => app.game.back());
    if (e.key === 'ArrowRight') navigate(() => app.game.forward());
  });

  // iOS suspende páginas em segundo plano; paramos o cálculo antes para não desperdiçar bateria.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      engine.stop();
      if (app.opponentThinking) cancelOpponent();
    } else {
      requestAnalysis();
      maybeOpponentMove();
    }
  });

  const net = () => {
    $('#net-chip').hidden = navigator.onLine;
    $('#net-chip').title = 'Sem internet: a análise continua funcionando no aparelho.';
  };
  addEventListener('online', net);
  addEventListener('offline', net);
  net();
}

// ---------- Inicialização ----------

async function main() {
  fillProfileSelects();
  bindUi();
  app.storage = await openStorage();
  const saved = await app.storage.getSetting('settings').catch(() => null);
  if (saved) app.settings = { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  board.setFlipped(!!app.settings.flipped);
  syncSettingsUi();

  const session = await app.storage.getSetting('session').catch(() => null);
  if (session?.pgn) {
    try {
      app.game.loadPgn(session.pgn);
      app.game.goto(session.ply ?? app.game.length);
      if (session.source && session.source !== 'training') app.game.source = session.source;
    } catch {
      app.game.reset();
    }
  }
  refresh();
  engine.init().catch((e) => {
    $('#engine-chip').textContent = 'Motor indisponível';
    $('#engine-chip').classList.add('err');
    $('#lines').innerHTML = `<li class="placeholder">Não foi possível iniciar o Stockfish: ${e.message}</li>`;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  requestPersistence();
}

main();
