// Dois conceitos separados de propósito:
//
//  * PERFIL DE ANÁLISE: quanto o motor calcula para AJUDAR você (tempo, profundidade,
//    variantes, memória). Sempre é o Stockfish na força máxima, só com orçamento diferente.
//  * NÍVEL DO ADVERSÁRIO: quão forte o computador JOGA contra você no modo treino.
//    Usa "Skill Level" e "UCI_LimitStrength/UCI_Elo" do Stockfish, que pioram o jogo dele.

export const ANALYSIS_PROFILES = {
  beginner:     { label: 'Iniciante', short: 'Inic.', multipv: 1, depth: 10, movetimeMs: 400,   hashMb: 16 },
  intermediate: { label: 'Intermediário', short: 'Interm.', multipv: 2, depth: 14, movetimeMs: 1000,  hashMb: 16 },
  advanced:     { label: 'Avançado', short: 'Avanç.', multipv: 3, depth: 18, movetimeMs: 2500,  hashMb: 32 },
  expert:       { label: 'Especialista', short: 'Espec.', multipv: 3, depth: 22, movetimeMs: 5000,  hashMb: 64 },
  full:         { label: 'Análise completa', short: 'Completa', multipv: 3, depth: 30, movetimeMs: 20000, hashMb: 128 },
};

// Limites aceitos na personalização (validação da interface e do armazenamento).
export const LIMITS = {
  multipv: [1, 3],
  depth: [4, 40],
  movetimeMs: [100, 60000],
  hashMb: [8, 256],
};

export function clampProfile(p) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Math.round(Number(p[k]));
    out[k] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : ANALYSIS_PROFILES.intermediate[k];
  }
  return out;
}

// "Skill Level" 0–20 vai abaixo de 1320; UCI_Elo cobre 1320–3190 neste build
// (valores informados pelo próprio motor no handshake UCI).
export const OPPONENT_LEVELS = {
  beginner:     { label: 'Iniciante',     options: { 'UCI_LimitStrength': 'false', 'Skill Level': 0 },  movetimeMs: 150, depth: 6 },
  intermediate: { label: 'Intermediário', options: { 'UCI_LimitStrength': 'false', 'Skill Level': 6 },  movetimeMs: 300, depth: 10 },
  advanced:     { label: 'Avançado',      options: { 'UCI_LimitStrength': 'true', 'UCI_Elo': 1800, 'Skill Level': 20 },    movetimeMs: 500, depth: 0 },
  expert:       { label: 'Especialista',  options: { 'UCI_LimitStrength': 'true', 'UCI_Elo': 2400, 'Skill Level': 20 },    movetimeMs: 800, depth: 0 },
  max:          { label: 'Força máxima',  options: { 'UCI_LimitStrength': 'false', 'Skill Level': 20 }, movetimeMs: 1500, depth: 0 },
};

export const ELO_RANGE = [1320, 3190];

/** Nível personalizado por "rating" estimado. */
export function opponentFromElo(elo) {
  const e = Math.max(ELO_RANGE[0], Math.min(ELO_RANGE[1], Math.round(elo)));
  return {
    label: `≈${e} (estimado)`,
    options: { 'UCI_LimitStrength': 'true', 'UCI_Elo': e, 'Skill Level': 20 },
    movetimeMs: 600,
    depth: 0,
  };
}

export const ELO_DISCLAIMER =
  'O rating é uma estimativa calibrada pelos desenvolvedores do Stockfish em partidas entre motores ' +
  'com controle de tempo específico. Não garante força equivalente à de um jogador humano com o mesmo rating: ' +
  'o estilo e os tipos de erro do motor são diferentes, e a velocidade do aparelho também influencia.';
