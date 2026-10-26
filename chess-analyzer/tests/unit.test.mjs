// Testes de lógica pura: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInfo, parseBestMove, scoreToCp, toWhitePov, formatScore, MATE_CP } from '../js/uci.js';
import { AnalysisCache, classifyLines, classifyPlayedMove, classifyLoss } from '../js/analysis-core.js';
import { Game } from '../js/game.js';
import { clampProfile, opponentFromElo } from '../js/profiles.js';

test('parseInfo lê MultiPV, placar e PV', () => {
  const i = parseInfo('info depth 12 seldepth 15 multipv 2 score cp -34 nodes 108576 nps 334080 hashfull 31 time 325 pv c7c5 g1f3 e7e6');
  assert.equal(i.depth, 12);
  assert.equal(i.multipv, 2);
  assert.deepEqual(i.score, { type: 'cp', value: -34 });
  assert.deepEqual(i.pv, ['c7c5', 'g1f3', 'e7e6']);
  assert.equal(i.bound, null);
});

test('parseInfo marca lowerbound e ignora linhas sem PV', () => {
  assert.equal(parseInfo('info depth 10 multipv 1 score cp 20 lowerbound nodes 1 pv e2e4').bound, 'lowerbound');
  assert.equal(parseInfo('info depth 10 currmove e2e4 currmovenumber 1'), null);
  assert.equal(parseInfo('info string NNUE evaluation using nn.nnue'), null);
});

test('parseBestMove trata (none)', () => {
  assert.deepEqual(parseBestMove('bestmove e2e4 ponder e7e5'), { best: 'e2e4', ponder: 'e7e5' });
  assert.equal(parseBestMove('bestmove (none)').best, null);
});

test('placares de mate superam qualquer vantagem material', () => {
  assert.ok(scoreToCp({ type: 'mate', value: 3 }) > 5000);
  assert.ok(scoreToCp({ type: 'mate', value: 1 }) > scoreToCp({ type: 'mate', value: 5 }));
  assert.equal(scoreToCp({ type: 'mate', value: 0 }), -MATE_CP);
  assert.equal(formatScore(toWhitePov({ type: 'mate', value: 2 }, 'b')), '#-2');
  assert.equal(formatScore({ type: 'cp', value: 135 }), '+1.35');
  assert.equal(formatScore({ type: 'cp', value: -40 }), '−0.40');
});

test('cache LRU respeita limite e profundidade mínima', () => {
  const c = new AnalysisCache(2);
  c.set('a', 3, { depth: 10 });
  c.set('b', 3, { depth: 12 });
  assert.equal(c.get('a', 3, 12), null); // raso demais
  assert.ok(c.get('a', 3, 10)); // 'a' passa a ser o mais recente
  c.set('c', 3, { depth: 5 });
  assert.equal(c.size, 2);
  assert.equal(c.get('b', 3, 0), null); // 'b' foi removido
  c.set('a', 3, { depth: 4 });
  assert.equal(c.get('a', 3, 0).depth, 10); // não troca resultado profundo por raso
});

test('classificação das variantes por perda', () => {
  const lines = [
    { score: { type: 'cp', value: 50 } },
    { score: { type: 'cp', value: 20 } },
    { score: { type: 'cp', value: -30 } },
  ];
  assert.deepEqual(classifyLines(lines).map((l) => l.cls), ['best', 'alt', 'dubious']);
  assert.equal(classifyLoss(500), 'blunder');
});

test('lance jogado: entregar mate vira erro; perder pouco ganhando muito não', () => {
  const blunder = classifyPlayedMove({ type: 'cp', value: 30 }, { type: 'mate', value: 2 }, 'a2a3', 'e2e4');
  assert.equal(blunder.cls, 'blunder');
  const fine = classifyPlayedMove({ type: 'cp', value: 900 }, { type: 'cp', value: -820 }, 'a2a3', 'e2e4');
  assert.notEqual(fine.cls, 'blunder');
  assert.equal(classifyPlayedMove({ type: 'cp', value: 0 }, { type: 'cp', value: 100 }, 'e2e4', 'e2e4').cls, 'best');
});

test('roque, en passant, promoção e mate', () => {
  const g = new Game();
  g.loadFen('r3k2r/8/8/3pP3/8/8/1p6/R3K2R w KQkq d6 0 1');
  assert.equal(g.play({ from: 'e5', to: 'd6' }).san, 'exd6');
  assert.equal(g.play({ from: 'e8', to: 'c8' }).san, 'O-O-O');
  assert.equal(g.play({ from: 'e1', to: 'g1' }).san, 'O-O');
  assert.ok(g.isPromotion('b2', 'b1'));
  assert.equal(g.play({ from: 'b2', to: 'b1', promotion: 'q' }).san, 'b1=Q');
  assert.equal(g.play({ from: 'a1', to: 'a5' }) !== null, true);
  const m = new Game();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) m.play({ from: f, to: t });
  assert.equal(m.status().kind, 'checkmate');
  const s = new Game();
  s.loadFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(s.status().kind, 'stalemate');
});

test('lance ilegal é recusado e a navegação mantém a posição', () => {
  const g = new Game();
  assert.equal(g.play({ from: 'e2', to: 'e5' }), null);
  g.play({ from: 'e2', to: 'e4' });
  g.play({ from: 'e7', to: 'e5' });
  const fen = g.fen;
  g.first();
  g.last();
  assert.equal(g.fen, fen);
  g.goto(1);
  g.play({ from: 'c7', to: 'c5' }); // nova linha descarta o resto
  assert.equal(g.length, 2);
  assert.equal(g.moves[1].san, 'c5');
});

test('PGN do chess.com com relógios e variantes', () => {
  const g = new Game();
  g.loadPgn('[White "a"]\n[Black "b"]\n\n1. e4 {[%clk 0:09:58]} 1... e5 (1... c5) 2. Nf3 $1 Nc6 *');
  assert.equal(g.length, 4);
  assert.equal(g.ply, 0);
  assert.equal(g.headers.White, 'a');
  assert.throws(() => g.loadPgn('1. e4 e5 2. Ke3 Ke6 3. Qxh7'), /PGN inválido/);
  assert.throws(() => g.loadFen('8/8/8 w'), /FEN inválida/);
});

test('PGN com FEN inicial e ida/volta', () => {
  const g = new Game();
  g.loadFen('4k3/8/8/8/8/8/4P3/4K3 b - - 0 40');
  g.play({ from: 'e8', to: 'd7' });
  const h = new Game();
  h.loadPgn(g.toPgn());
  assert.equal(h.startFen, g.startFen);
  assert.equal(h.moveList()[0].no, 40);
});

test('perfis personalizados são limitados', () => {
  assert.deepEqual(clampProfile({ multipv: 9, depth: 1, movetimeMs: 'x', hashMb: 9999 }),
    { multipv: 3, depth: 4, movetimeMs: 1000, hashMb: 256 });
  assert.equal(opponentFromElo(500).options.UCI_Elo, 1320);
});
