// Controlador do Stockfish (UCI sobre postMessage).
//
// O arquivo vendor/stockfish/stockfish-19-lite-single.js já é um script de
// Web Worker: ele carrega o .wasm de mesmo nome na mesma pasta. Aqui só
// conversamos com ele por mensagens de texto UCI.
//
// Regras de concorrência:
//  * No máximo um "go" em andamento. Cada "go" gera exatamente um "bestmove".
//  * Um pedido novo substitui o pendente; o que estiver em cálculo recebe
//    "stop" e o resultado dele é descartado (resolvido como cancelled).
//  * Linhas "info" só são atribuídas ao pedido atual enquanto o estado é
//    "searching"; depois do "stop" elas são ignoradas.

import { parseInfo, parseBestMove } from './uci.js';

export const ENGINE_URL = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url).href;

const UPDATE_THROTTLE_MS = 100;
const WATCHDOG_GRACE_MS = 8000;
const MAX_RESTARTS_PER_MINUTE = 3;

export class EngineController {
  constructor({ url = ENGINE_URL, name = 'engine', onStatus = () => {}, initTimeoutMs = 20000 } = {}) {
    this.url = url;
    this.name = name;
    this.onStatus = onStatus;
    this.initTimeoutMs = initTimeoutMs;
    this.worker = null;
    this.state = 'off'; // off | loading | ready | searching | stopping | error
    this.current = null;
    this.pending = null;
    this.desiredOptions = {};
    this.appliedOptions = {};
    this.needNewGame = false;
    this.waiters = [];
    this.restarts = [];
    this.engineName = '';
    this.lastOutputAt = 0;
    this.watchdog = null;
    this.initPromise = null;
  }

  _setState(state, detail) {
    this.state = state;
    this.onStatus({ state, detail, name: this.name });
  }

  init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._boot().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  async _boot() {
    this._setState('loading');
    if (typeof WebAssembly !== 'object') throw new Error('Este navegador não suporta WebAssembly.');
    const t0 = performance.now();
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this._fail(new Error(e.message || 'Falha no Worker do motor'));
    };
    this.worker.onmessageerror = () => this._fail(new Error('Mensagem inválida do motor'));
    this.appliedOptions = {};
    this._send('uci');
    await this._waitFor('uciok', this.initTimeoutMs);
    this._send('isready');
    await this._waitFor('readyok', this.initTimeoutMs);
    this.loadMs = Math.round(performance.now() - t0);
    this.watchdog = setInterval(() => this._checkWatchdog(), 2000);
    this._setState('ready', { loadMs: this.loadMs, engineName: this.engineName });
    this._pump();
  }

  _send(cmd) {
    this.worker?.postMessage(cmd);
  }

  _waitFor(token, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { token, resolve, reject };
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`O motor não respondeu "${token}" em ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  _onMessage(data) {
    if (typeof data !== 'string') return; // progresso de download e afins
    this.lastOutputAt = performance.now();
    for (const line of data.split('\n')) {
      if (line) this._onLine(line.trim());
    }
  }

  _onLine(line) {
    if (line.startsWith('id name ')) this.engineName = line.slice(8);
    if (line === 'uciok' || line === 'readyok') {
      const w = this.waiters.find((x) => x.token === line);
      if (w) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve();
      }
      return;
    }
    if (line.startsWith('info ')) {
      if (this.state !== 'searching' || !this.current) return;
      const info = parseInfo(line);
      if (info) this._acceptInfo(this.current, info);
      return;
    }
    if (line.startsWith('bestmove')) this._onBestMove(parseBestMove(line));
  }

  _acceptInfo(job, info) {
    const prev = job.lines.get(info.multipv);
    // Linhas lowerbound/upperbound são provisórias; não substituem uma exata da mesma profundidade.
    if (info.bound && prev && !prev.bound && prev.depth >= info.depth) return;
    job.lines.set(info.multipv, info);
    if (job.firstInfoMs === null) job.firstInfoMs = Math.round(performance.now() - job.startedAt);
    if (!job.updateTimer) {
      job.updateTimer = setTimeout(() => {
        job.updateTimer = null;
        if (this.current === job && this.state === 'searching') job.onUpdate?.(this._snapshot(job, false));
      }, UPDATE_THROTTLE_MS);
    }
  }

  _snapshot(job, final) {
    const lines = [...job.lines.values()]
      .filter((l) => l.multipv <= job.multipv)
      .sort((a, b) => a.multipv - b.multipv);
    const main = lines[0];
    return {
      id: job.id,
      fen: job.fen,
      final,
      lines,
      depth: main?.depth ?? 0,
      nodes: main?.nodes ?? 0,
      nps: main?.nps ?? 0,
      engineTimeMs: main?.time ?? 0,
      wallMs: Math.round(performance.now() - job.startedAt),
      firstInfoMs: job.firstInfoMs,
      bestmove: job.bestmove ?? null,
    };
  }

  _onBestMove(bm) {
    const job = this.current;
    this.current = null;
    if (job) {
      clearTimeout(job.updateTimer);
      job.updateTimer = null;
      if (job.cancelled || this.state === 'stopping') {
        job.resolve({ id: job.id, fen: job.fen, cancelled: true });
      } else {
        job.bestmove = bm?.best ?? null;
        const snap = this._snapshot(job, true);
        job.onUpdate?.(snap);
        job.resolve(snap);
      }
    }
    if (this.state === 'searching' || this.state === 'stopping') this._setState('ready');
    this._pump();
  }

  /** Define opções UCI. São aplicadas antes do próximo "go" (nunca durante um cálculo). */
  setOptions(opts) {
    Object.assign(this.desiredOptions, opts);
  }

  /** Avisa o motor que a próxima posição é de outra partida (limpa a tabela hash). */
  newGame() {
    this.needNewGame = true;
  }

  /**
   * Agenda uma análise. Substitui qualquer pedido pendente e interrompe o atual.
   * job: { fen, multipv, depth, movetimeMs, onUpdate }
   * Retorna Promise com o resultado final ou { cancelled: true }.
   */
  analyze(job) {
    const full = {
      ...job,
      id: (this._seq = (this._seq || 0) + 1),
      lines: new Map(),
      cancelled: false,
      firstInfoMs: null,
      updateTimer: null,
    };
    const promise = new Promise((resolve, reject) => {
      full.resolve = resolve;
      full.reject = reject;
    });
    if (this.pending) this.pending.resolve({ id: this.pending.id, fen: this.pending.fen, cancelled: true });
    this.pending = full;
    this.init().catch((err) => this._rejectAll(err));
    this._pump();
    return promise;
  }

  /** Cancela tudo (por exemplo: usuário pausou a análise ou a página ficou oculta). */
  stop() {
    if (this.pending) {
      this.pending.resolve({ id: this.pending.id, fen: this.pending.fen, cancelled: true });
      this.pending = null;
    }
    if (this.current && this.state === 'searching') {
      this.current.cancelled = true;
      this._setState('stopping');
      this._send('stop');
    }
  }

  _pump() {
    if (this.state === 'searching' && this.pending && this.current) {
      this.current.cancelled = true;
      this._setState('stopping');
      this._send('stop');
      return;
    }
    if (this.state !== 'ready' || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    this._applyOptions();
    if (this.needNewGame) {
      this._send('ucinewgame');
      this.needNewGame = false;
    }
    this._send(`position fen ${job.fen}`);
    const parts = ['go'];
    if (job.depth) parts.push('depth', String(job.depth));
    if (job.movetimeMs) parts.push('movetime', String(Math.round(job.movetimeMs)));
    if (parts.length === 1) parts.push('depth', '20'); // nunca "go infinite": protege a bateria
    job.startedAt = performance.now();
    this.current = job;
    this.lastOutputAt = performance.now();
    this._setState('searching', { id: job.id });
    this._send(parts.join(' '));
  }

  _applyOptions() {
    for (const [k, v] of Object.entries(this.desiredOptions)) {
      if (this.appliedOptions[k] === v) continue;
      this._send(`setoption name ${k} value ${v}`);
      this.appliedOptions[k] = v;
    }
  }

  _checkWatchdog() {
    if (this.state !== 'searching' && this.state !== 'stopping') return;
    const job = this.current;
    const budget = (job?.movetimeMs || 30000) + WATCHDOG_GRACE_MS;
    const silentFor = performance.now() - this.lastOutputAt;
    const runningFor = performance.now() - (job?.startedAt ?? 0);
    if (silentFor > WATCHDOG_GRACE_MS * 2 || runningFor > budget * 2) {
      this._fail(new Error('O motor parou de responder'));
    }
  }

  _rejectAll(err) {
    for (const j of [this.current, this.pending]) j?.reject(err);
    this.current = null;
    this.pending = null;
  }

  _fail(err) {
    this._teardown();
    this._rejectAll(err);
    this._setState('error', { message: err.message });
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60000);
    if (this.restarts.length < MAX_RESTARTS_PER_MINUTE) {
      this.restarts.push(now);
      setTimeout(() => this.init().catch(() => {}), 500 * this.restarts.length);
    }
  }

  _teardown() {
    clearInterval(this.watchdog);
    this.watchdog = null;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('Motor reiniciado'));
    }
    this.waiters = [];
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.appliedOptions = {};
  }

  /** Reinicialização manual (botão "Reiniciar motor"). */
  async restart() {
    this._teardown();
    this._rejectAll(new Error('Motor reiniciado'));
    this.restarts = [];
    return this.init();
  }

  terminate() {
    this.stop();
    this._teardown();
    this._rejectAll(new Error('Motor encerrado'));
    this._setState('off');
  }
}
