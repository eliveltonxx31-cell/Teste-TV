// Modelo da partida: posição inicial + lista linear de lances + cursor.
// Usa chess.js para regras (roque, en passant, promoção, mate, empates).

import { Chess, validateFen } from '../vendor/chess.js/chess.js';

export class Game {
  constructor() {
    this.reset();
  }

  reset(startFen) {
    this.startFen = startFen || new Chess().fen();
    this.headers = {};
    this.moves = []; // { san, uci, from, to, promotion, fenAfter, flags }
    this.ply = 0; // quantos lances estão aplicados na posição atual
    this.source = 'board';
    this._rebuild();
  }

  /** Recria a instância chess.js até o cursor (mantém histórico para repetição tripla). */
  _rebuild() {
    this.chess = new Chess(this.startFen);
    for (let i = 0; i < this.ply; i++) {
      const m = this.moves[i];
      this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
  }

  get fen() {
    return this.chess.fen();
  }

  get turn() {
    return this.chess.turn();
  }

  get length() {
    return this.moves.length;
  }

  get lastMove() {
    return this.ply > 0 ? this.moves[this.ply - 1] : null;
  }

  fenAt(ply) {
    return ply === 0 ? this.startFen : this.moves[ply - 1].fenAfter;
  }

  pieceAt(square) {
    return this.chess.get(square) || null;
  }

  board() {
    return this.chess.board();
  }

  legalTargets(square) {
    return this.chess.moves({ square, verbose: true });
  }

  isPromotion(from, to) {
    return this.legalTargets(from).some((m) => m.to === to && m.promotion);
  }

  /**
   * Joga um lance na posição atual. Se o cursor não estiver no fim e o lance
   * for diferente do próximo da partida, o restante é descartado (nova linha).
   * Retorna o lance aplicado ou null se for ilegal.
   */
  play({ from, to, promotion }) {
    let mv;
    try {
      mv = this.chess.move({ from, to, promotion });
    } catch {
      return null;
    }
    const uci = from + to + (mv.promotion || '');
    const next = this.moves[this.ply];
    if (!next || next.uci !== uci) this.moves.length = this.ply;
    this.moves[this.ply] = {
      san: mv.san,
      uci,
      from: mv.from,
      to: mv.to,
      promotion: mv.promotion,
      fenAfter: this.chess.fen(),
      captured: !!mv.captured,
      check: mv.san.includes('+') || mv.san.includes('#'),
    };
    this.ply++;
    return this.moves[this.ply - 1];
  }

  goto(ply) {
    const p = Math.max(0, Math.min(this.moves.length, ply));
    if (p === this.ply) return false;
    if (p === this.ply + 1) {
      const m = this.moves[this.ply];
      this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
      this.ply = p;
    } else if (p === this.ply - 1) {
      this.chess.undo();
      this.ply = p;
    } else {
      this.ply = p;
      this._rebuild();
    }
    return true;
  }

  back() { return this.goto(this.ply - 1); }
  forward() { return this.goto(this.ply + 1); }
  first() { return this.goto(0); }
  last() { return this.goto(this.moves.length); }

  /** Estado da posição atual (mate, afogamento, empates). */
  status() {
    const c = this.chess;
    if (c.isCheckmate()) return { over: true, kind: 'checkmate', text: `Xeque-mate — ${c.turn() === 'w' ? 'pretas' : 'brancas'} vencem` };
    if (c.isStalemate()) return { over: true, kind: 'stalemate', text: 'Empate por afogamento' };
    if (c.isInsufficientMaterial()) return { over: true, kind: 'insufficient', text: 'Empate por material insuficiente' };
    if (c.isThreefoldRepetition()) return { over: true, kind: 'threefold', text: 'Empate por repetição tripla' };
    if (c.isDrawByFiftyMoves()) return { over: true, kind: 'fifty', text: 'Empate pela regra dos 50 lances' };
    return { over: false, check: c.isCheck(), kind: c.isCheck() ? 'check' : 'normal', text: c.isCheck() ? 'Xeque' : '' };
  }

  /** Converte uma PV em UCI para SAN a partir de uma FEN (para exibir variantes). */
  static pvToSan(fen, pv, max = 10) {
    const c = new Chess(fen);
    const out = [];
    for (const uci of pv.slice(0, max)) {
      try {
        out.push(c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
      } catch {
        break; // PV antiga ou truncada: para na primeira jogada inválida
      }
    }
    return out;
  }

  static validateFen(fen) {
    const r = validateFen(fen.trim());
    return r.ok ? null : r.error;
  }

  loadFen(fen) {
    const err = Game.validateFen(fen);
    if (err) throw new Error(`FEN inválida: ${err}`);
    const c = new Chess(fen.trim());
    this.reset(c.fen());
    this.source = 'fen';
  }

  /** Carrega PGN (aceita comentários, NAGs e [%clk]). Só a linha principal é importada; variantes entre parênteses são descartadas. */
  loadPgn(pgn) {
    const c = new Chess();
    try {
      c.loadPgn(pgn.trim());
    } catch (e) {
      throw new Error(`PGN inválido: ${e.message}`);
    }
    const headers = c.getHeaders();
    const verbose = c.history({ verbose: true });
    const start = headers.FEN && headers.SetUp !== '0' ? headers.FEN : new Chess().fen();
    this.reset(start);
    this.headers = headers;
    this.source = 'pgn';
    for (const m of verbose) this.play({ from: m.from, to: m.to, promotion: m.promotion });
    this.goto(0);
  }

  toPgn() {
    const c = new Chess(this.startFen);
    if (this.startFen !== new Chess().fen()) {
      c.setHeader('SetUp', '1');
      c.setHeader('FEN', this.startFen);
    }
    for (const [k, v] of Object.entries(this.headers)) if (v && k !== 'FEN' && k !== 'SetUp') c.setHeader(k, v);
    for (const m of this.moves) c.move({ from: m.from, to: m.to, promotion: m.promotion });
    return c.pgn();
  }

  /** Lista de lances numerada para a interface. */
  moveList() {
    const startMoveNo = +this.startFen.split(' ')[5] || 1;
    const blackFirst = this.startFen.split(' ')[1] === 'b';
    return this.moves.map((m, i) => {
      const idx = i + (blackFirst ? 1 : 0);
      return { ...m, ply: i + 1, no: startMoveNo + Math.floor(idx / 2), white: idx % 2 === 0 };
    });
  }
}
