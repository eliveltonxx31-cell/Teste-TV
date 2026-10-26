// Tabuleiro em DOM + SVG. Toque-toque ou arrastar para mover.
// Só altera os elementos que mudaram entre renderizações.

const FILES = 'abcdefgh';
// Mesmo glifo "cheio" para os dois lados (a cor vem do CSS); U+FE0E força
// apresentação como texto, evitando que o iOS desenhe o peão como emoji.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VS15 = '︎';
const NAMES = { k: 'rei', q: 'dama', r: 'torre', b: 'bispo', n: 'cavalo', p: 'peão' };

export class BoardView {
  constructor(root, { onMove, canSelect }) {
    this.root = root;
    this.onMove = onMove;
    this.canSelect = canSelect || (() => true);
    this.flipped = false;
    this.selected = null;
    this.targets = [];
    this.game = null;
    this.prev = new Array(64).fill(null);
    this._build();
  }

  _build() {
    this.root.classList.add('board');
    this.grid = document.createElement('div');
    this.grid.className = 'grid';
    this.squares = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      d.className = 'sq';
      d.setAttribute('role', 'gridcell');
      this.grid.appendChild(d);
      this.squares.push(d);
    }
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.setAttribute('class', 'arrows');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.innerHTML = `<defs>${['best', 'alt', 'dubious', 'blunder'].map((c) =>
      `<marker id="ah-${c}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse">
         <path d="M0,0 L10,5 L0,10 z" class="ah ${c}"/></marker>`).join('')}</defs><g class="arrow-layer"></g>`;
    this.arrowLayer = this.svg.querySelector('.arrow-layer');
    this.root.append(this.grid, this.svg);
    this.root.setAttribute('role', 'grid');
    this.root.setAttribute('aria-label', 'Tabuleiro de xadrez');

    this.root.addEventListener('pointerdown', (e) => this._down(e));
    this.root.addEventListener('pointerup', (e) => this._up(e));
    this.root.addEventListener('pointercancel', () => { this.dragFrom = null; });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Índice visual (0 = canto superior esquerdo) <-> casa algébrica.
  _sqAt(idx) {
    const r = Math.floor(idx / 8), c = idx % 8;
    return this.flipped ? FILES[7 - c] + (r + 1) : FILES[c] + (8 - r);
  }

  _idxOf(sq) {
    const c = FILES.indexOf(sq[0]), r = +sq[1];
    return this.flipped ? (r - 1) * 8 + (7 - c) : (8 - r) * 8 + c;
  }

  _squareFromPoint(x, y) {
    const rect = this.grid.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return this._sqAt(r * 8 + c);
  }

  _down(e) {
    if (e.button > 0) return;
    const sq = this._squareFromPoint(e.clientX, e.clientY);
    if (!sq || !this.game) return;
    if (this.selected && this.targets.some((m) => m.to === sq)) {
      const from = this.selected;
      this._select(null);
      this.onMove({ from, to: sq });
      return;
    }
    const p = this.game.pieceAt(sq);
    if (p && p.color === this.game.turn && this.canSelect(p.color)) {
      this._select(sq);
      this.dragFrom = sq;
    } else {
      this._select(null);
    }
  }

  _up(e) {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (!from) return;
    const sq = this._squareFromPoint(e.clientX, e.clientY);
    if (sq && sq !== from && this.targets.some((m) => m.to === sq)) {
      this._select(null);
      this.onMove({ from, to: sq });
    }
  }

  _select(sq) {
    for (const t of this.targets) this.squares[this._idxOf(t.to)].classList.remove('target', 'capture');
    if (this.selected) this.squares[this._idxOf(this.selected)].classList.remove('selected');
    this.selected = sq;
    this.targets = sq ? this.game.legalTargets(sq) : [];
    if (sq) this.squares[this._idxOf(sq)].classList.add('selected');
    for (const t of this.targets) {
      this.squares[this._idxOf(t.to)].classList.add(t.captured ? 'capture' : 'target');
    }
  }

  setFlipped(f) {
    if (this.flipped === f) return;
    this.flipped = f;
    this.prev.fill(null); // força redesenho completo
    this.root.classList.toggle('flipped', f);
    if (this.game) this.render(this.game, this.lastOpts || {});
  }

  /**
   * opts: { lastMove: {from,to}, lastCls, arrows: [{from,to,cls}] }
   */
  render(game, opts = {}) {
    this.game = game;
    this.lastOpts = opts;
    if (this.selected) this._select(null);
    const status = game.status();
    let checkSq = null;
    if (status.check || status.kind === 'checkmate') {
      const turn = game.turn;
      game.board().flat().forEach((p) => { if (p && p.type === 'k' && p.color === turn) checkSq = p.square; });
    }
    for (let i = 0; i < 64; i++) {
      const sq = this._sqAt(i);
      const p = game.pieceAt(sq);
      const key = p ? p.color + p.type : '';
      const el = this.squares[i];
      if (this.prev[i] !== key) {
        el.textContent = '';
        if (p) {
          const s = document.createElement('span');
          s.className = `pc ${p.color === 'w' ? 'white' : 'black'}`;
          s.textContent = GLYPH[p.type] + VS15;
          el.appendChild(s);
        }
        this.prev[i] = key;
      }
      const light = (FILES.indexOf(sq[0]) + +sq[1]) % 2 === 1;
      el.className = `sq ${light ? 'light' : 'dark'}`;
      el.setAttribute('aria-label', p ? `${sq} ${NAMES[p.type]} ${p.color === 'w' ? 'branco' : 'preto'}` : sq);
      // Coordenadas na borda (a–h na última fileira, 1–8 na primeira coluna)
      el.dataset.file = i >= 56 ? sq[0] : '';
      el.dataset.rank = i % 8 === 0 ? sq[1] : '';
    }
    if (opts.lastMove) {
      for (const s of [opts.lastMove.from, opts.lastMove.to]) {
        this.squares[this._idxOf(s)].classList.add('last', `cls-${opts.lastCls || 'none'}`);
      }
    }
    if (checkSq) this.squares[this._idxOf(checkSq)].classList.add('in-check');
    this._drawArrows(opts.arrows || []);
  }

  _center(sq) {
    const idx = this._idxOf(sq);
    return [(idx % 8) + 0.5, Math.floor(idx / 8) + 0.5];
  }

  _drawArrows(arrows) {
    const key = arrows.map((a) => a.from + a.to + a.cls).join(',') + this.flipped;
    if (key === this.arrowKey) return;
    this.arrowKey = key;
    // Desenha do pior para o melhor para que a seta verde fique por cima.
    this.arrowLayer.innerHTML = arrows.slice().reverse().map((a) => {
      const [x1, y1] = this._center(a.from);
      const [x2, y2] = this._center(a.to);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const k = (len - 0.35) / len; // recua a ponta para não cobrir a peça de destino
      const ex = x1 + (x2 - x1) * k, ey = y1 + (y2 - y1) * k;
      return `<line class="arrow ${a.cls}" x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" marker-end="url(#ah-${a.cls})"/>`;
    }).join('');
  }

  /** Mostra o seletor de promoção e devolve a peça escolhida (ou null). */
  askPromotion(color) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'promo';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Escolha a peça da promoção');
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = `<span class="pc ${color === 'w' ? 'white' : 'black'}">${GLYPH[t]}${VS15}</span>`;
        b.setAttribute('aria-label', NAMES[t]);
        b.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); resolve(t); });
        box.appendChild(b);
      }
      const cancel = (e) => { if (e.target === box) { box.remove(); resolve(null); } };
      box.addEventListener('pointerdown', (e) => e.stopPropagation());
      box.addEventListener('click', cancel);
      this.root.appendChild(box);
    });
  }
}
