// Medições leves de latência e recursos. Nada é enviado para fora do aparelho.

export class Metrics {
  constructor() {
    this.samples = []; // últimas análises concluídas
    this.restarts = 0;
    this.engineLoadMs = null;
    this.cancelled = 0;
    this.cacheHits = 0;
  }

  record(result) {
    this.samples.push({
      firstInfoMs: result.firstInfoMs,
      wallMs: result.wallMs,
      depth: result.depth,
      nps: result.nps,
    });
    if (this.samples.length > 50) this.samples.shift();
  }

  summary() {
    const s = this.samples;
    const med = (arr) => {
      if (!arr.length) return null;
      const a = [...arr].sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };
    const mem = performance.memory; // só existe em navegadores Chromium; Safari não expõe
    return {
      analyses: s.length,
      firstInfoMedianMs: med(s.map((x) => x.firstInfoMs).filter((x) => x != null)),
      wallMedianMs: med(s.map((x) => x.wallMs)),
      depthMedian: med(s.map((x) => x.depth)),
      npsMedian: med(s.map((x) => x.nps).filter(Boolean)),
      engineLoadMs: this.engineLoadMs,
      restarts: this.restarts,
      cancelled: this.cancelled,
      cacheHits: this.cacheHits,
      jsHeapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      cores: navigator.hardwareConcurrency || null,
      crossOriginIsolated: self.crossOriginIsolated === true,
    };
  }
}
