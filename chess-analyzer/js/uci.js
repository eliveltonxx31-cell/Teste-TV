// Funções puras para interpretar a saída UCI do Stockfish.
// Não dependem do DOM: são testadas em Node (tests/uci.test.mjs).

// Valor usado para comparar placares de mate com placares em centipeões.
export const MATE_CP = 100000;

/**
 * Converte uma linha "info ..." em objeto. Retorna null para linhas sem PV
 * (por exemplo "info string", "info currmove") porque não servem como variante.
 */
export function parseInfo(line) {
  if (!line.startsWith('info ') || line.includes(' string ')) return null;
  const t = line.split(' ');
  const info = { multipv: 1, bound: null, pv: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth': info.depth = +t[++i]; break;
      case 'seldepth': info.seldepth = +t[++i]; break;
      case 'multipv': info.multipv = +t[++i]; break;
      case 'nodes': info.nodes = +t[++i]; break;
      case 'nps': info.nps = +t[++i]; break;
      case 'time': info.time = +t[++i]; break;
      case 'hashfull': info.hashfull = +t[++i]; break;
      case 'score':
        info.score = { type: t[i + 1], value: +t[i + 2] };
        i += 2;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.bound = t[++i];
        break;
      case 'pv':
        info.pv = t.slice(i + 1);
        i = t.length;
        break;
      default: break;
    }
  }
  if (!info.pv.length || !info.score || info.depth === undefined) return null;
  return info;
}

/** "bestmove e2e4 ponder e7e5" -> { best: 'e2e4', ponder: 'e7e5' }; "(none)" -> best null. */
export function parseBestMove(line) {
  const m = /^bestmove (\S+)(?: ponder (\S+))?/.exec(line);
  if (!m) return null;
  return { best: m[1] === '(none)' ? null : m[1], ponder: m[2] || null };
}

/** Placar do ponto de vista do lado que joga -> número comparável (mate vira ±MATE_CP). */
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') {
    if (score.value === 0) return -MATE_CP; // lado a jogar já está mateado
    return Math.sign(score.value) * (MATE_CP - Math.abs(score.value) * 100);
  }
  return score.value;
}

/** Inverte o placar para o ponto de vista das brancas quando as pretas jogam. */
export function toWhitePov(score, turn) {
  if (!score) return score;
  return turn === 'w' ? score : { type: score.type, value: -score.value };
}

/** Texto curto: "+0.35", "−1.20", "#3", "#-2". */
export function formatScore(scoreWhite) {
  if (!scoreWhite) return '…';
  if (scoreWhite.type === 'mate') {
    return scoreWhite.value === 0 ? '#' : `#${scoreWhite.value > 0 ? '' : '-'}${Math.abs(scoreWhite.value)}`;
  }
  const v = scoreWhite.value / 100;
  if (Math.abs(v) < 0.005) return '0.00';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}

/** Converte um lance UCI ("e7e8q") em { from, to, promotion }. */
export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}
