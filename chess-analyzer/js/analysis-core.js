// Lógica de análise independente do DOM: cache limitado e classificação de lances.

import { scoreToCp } from './uci.js';

/** Cache LRU de resultados finais, chaveado por FEN + número de variantes. */
export class AnalysisCache {
  constructor(maxEntries = 200) {
    this.max = maxEntries;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  static key(fen, multipv) {
    // Os relógios de meio-lance não mudam a avaliação de forma relevante para a interface,
    // mas o contador de 50 lances pode mudar; mantemos a FEN inteira para não errar.
    return `${multipv}|${fen}`;
  }

  /** Só devolve resultado se for pelo menos tão profundo quanto o pedido. */
  get(fen, multipv, minDepth) {
    const k = AnalysisCache.key(fen, multipv);
    const v = this.map.get(k);
    if (!v || v.depth < minDepth) {
      this.misses++;
      return null;
    }
    this.map.delete(k);
    this.map.set(k, v);
    this.hits++;
    return v;
  }

  set(fen, multipv, result) {
    const k = AnalysisCache.key(fen, multipv);
    const old = this.map.get(k);
    if (old && old.depth > result.depth) return;
    this.map.delete(k);
    this.map.set(k, result);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

// Limiares de perda (centipeões, do ponto de vista de quem joga).
export const DEFAULT_THRESHOLDS = { alt: 40, dubious: 120 };

/**
 * Classes de lance:
 *   best    – verde: o melhor lance encontrado
 *   alt     – azul: alternativa interessante (perda pequena)
 *   dubious – amarelo: inferior, mas jogável
 *   blunder – vermelho: erro tático / perda significativa
 */
export function classifyLoss(lossCp, thresholds = DEFAULT_THRESHOLDS) {
  if (lossCp <= 0) return 'best';
  if (lossCp <= thresholds.alt) return 'alt';
  if (lossCp <= thresholds.dubious) return 'dubious';
  return 'blunder';
}

/** Perda de cada variante MultiPV em relação à primeira. */
export function classifyLines(lines, thresholds = DEFAULT_THRESHOLDS) {
  if (!lines.length) return [];
  const best = scoreToCp(lines[0].score);
  return lines.map((l, i) => {
    const loss = Math.max(0, best - scoreToCp(l.score));
    return { ...l, loss, cls: i === 0 ? 'best' : classifyLoss(loss, thresholds) };
  });
}

// Converte placar em "probabilidade de vitória" para que perder 100 cp com o jogo
// equilibrado pese mais do que perder 100 cp com +9 de vantagem.
function winChance(cp) {
  const c = Math.max(-2000, Math.min(2000, cp));
  return 2 / (1 + Math.exp(-0.00368208 * c)) - 1;
}

/**
 * Classifica o lance jogado comparando a avaliação antes (lado que jogou) com a
 * avaliação depois (do ponto de vista do adversário, então invertida).
 * parentBest: score UCI da posição antes do lance (lado que jogou)
 * childBest: score UCI da posição depois do lance (lado adversário)
 */
export function classifyPlayedMove(parentBest, childBest, playedUci, bestUci, thresholds = DEFAULT_THRESHOLDS) {
  if (!parentBest || !childBest) return null;
  if (playedUci && playedUci === bestUci) return { loss: 0, cls: 'best' };
  const before = scoreToCp(parentBest);
  const after = -scoreToCp(childBest);
  const lossCp = Math.max(0, before - after);
  // Escala a perda pela mudança de chance de vitória (0..2) para um equivalente em cp.
  const dropped = Math.max(0, winChance(before) - winChance(after));
  const effective = Math.min(lossCp, dropped * 1000);
  return { loss: Math.round(effective), cls: classifyLoss(effective, thresholds) };
}
