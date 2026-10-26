// Paletas das classes de lance. "cvd" usa a paleta Okabe–Ito, distinguível com
// os tipos mais comuns de daltonismo; os símbolos (✓ ! ?! ??) complementam a cor.

export const PALETTES = {
  default: { best: '#3fb950', alt: '#4c9aff', dubious: '#e3b341', blunder: '#f0524f' },
  cvd: { best: '#009e73', alt: '#56b4e9', dubious: '#f0e442', blunder: '#d55e00' },
  contrast: { best: '#00e676', alt: '#40c4ff', dubious: '#ffea00', blunder: '#ff1744' },
};

export function applyPalette(colors) {
  const root = document.documentElement.style;
  for (const k of ['best', 'alt', 'dubious', 'blunder']) {
    if (/^#[0-9a-f]{6}$/i.test(colors?.[k] || '')) root.setProperty(`--c-${k}`, colors[k]);
  }
}
