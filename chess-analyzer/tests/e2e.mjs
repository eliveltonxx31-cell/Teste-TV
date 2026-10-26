// Teste ponta a ponta no Chromium headless (Playwright), com viewport de iPhone.
// NÃO substitui o teste no Safari/iPhone real: o WebKit tem outro motor JS/WASM.
// Uso: python3 -m http.server 8080  (em outro terminal)  e  node tests/e2e.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const URL_ = process.env.APP_URL || 'http://localhost:8080/';
const out = process.env.SHOTS || '.';
const errors = [];
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_);
await page.waitForFunction(() => /prof\. \d+/.test(document.querySelector('#stats').textContent), null, { timeout: 30000 });
check(true, 'motor carregou e publicou profundidade');
const n = await page.locator('#lines li:not(.placeholder)').count();
check(n === 2, `perfil Intermediário mostra 2 variantes (mostrou ${n})`);

// Toque-toque: e2 -> e4 (casas calculadas a partir do tabuleiro)
async function tapSquare(sq) {
  const box = await page.locator('#board .grid').boundingBox();
  const flipped = await page.evaluate(() => document.querySelector('#board').classList.contains('flipped'));
  let c = 'abcdefgh'.indexOf(sq[0]), r = 8 - +sq[1];
  if (flipped) { c = 7 - c; r = 7 - r; }
  await page.mouse.click(box.x + (c + 0.5) * box.width / 8, box.y + (r + 0.5) * box.height / 8);
}
await tapSquare('e2'); await tapSquare('e4');
check(await page.locator('#movelist button').count() === 1, 'lance e4 aplicado por toque');

// Troca rápida de posição: o resultado exibido precisa ser sempre da posição atual.
for (let i = 0; i < 6; i++) { await page.click('[data-act=back]'); await page.click('[data-act=forward]'); }
await page.waitForTimeout(1500);
const consistent = await page.evaluate(async () => {
  const txt = document.querySelector('#lines li b')?.textContent || '';
  return txt;
});
// Depois de 1.e4 é a vez das pretas: o primeiro lance da variante deve ser de peça preta (SAN válido a partir da posição atual)
check(!!consistent && !/^(e4|d4|Nf3|c4)$/.test(consistent), `variante exibida pertence à posição atual (${consistent})`);

// Importação de PGN
await page.click('[data-act=import]');
await page.fill('#import-text', '[White "Morphy"]\n[Black "Duke"]\n\n1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0');
await page.click('#import-go');
check(await page.locator('#movelist button').count() === 33, 'PGN importado com 33 meios-lances');
await page.click('[data-act=last]');
await page.waitForTimeout(300);
check((await page.textContent('#status')).includes('Xeque-mate'), 'mate detectado no fim do PGN');
check((await page.textContent('#eval')) === '1–0', 'resultado 1–0 exibido sem chamar o motor');

// FEN inválida
await page.click('[data-act=import]');
await page.fill('#import-text', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1');
await page.click('#import-go');
check((await page.textContent('#import-error')).length > 0, 'FEN inválida mostra erro');
await page.keyboard.press('Escape');

// Promoção
await page.click('[data-act=import]');
await page.fill('#import-text', '8/P7/8/8/8/8/k7/4K3 w - - 0 1');
await page.click('#import-go');
await tapSquare('a7'); await tapSquare('a8');
check(await page.locator('.promo button').count() === 4, 'seletor de promoção aberto');
await page.locator('.promo button').nth(3).click();
check((await page.textContent('#movelist')).includes('a8=N'), 'promoção a cavalo aplicada');

// Treino: jogar de pretas, o computador abre
await page.click('[data-act=train]');
await page.check('input[name=train-color][value=b]');
await page.selectOption('#train-level', 'beginner');
await page.click('#train-go');
await page.waitForFunction(() => document.querySelectorAll('#movelist button').length === 1, null, { timeout: 15000 });
check(true, 'adversário fez o primeiro lance');
check(await page.evaluate(() => document.querySelector('#board').classList.contains('flipped')), 'tabuleiro girado para as pretas');

await page.screenshot({ path: `${out}/e2e-training.png` });

// Offline: depois do primeiro carregamento o Service Worker deve servir tudo.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => /Motor pronto|Calculando/.test(document.querySelector('#engine-chip').textContent), null, { timeout: 30000 });
check(true, 'app e motor carregam offline');
check(await page.isVisible('#net-chip'), 'aviso de offline visível');
await ctx.setOffline(false);

// Ajustes / diagnóstico
await page.click('#btn-settings');
await page.selectOption('#palette-select', 'cvd');
const c = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c-blunder').trim());
check(c === '#d55e00', `paleta para daltonismo aplicada (${c})`);
await page.screenshot({ path: `${out}/e2e-settings.png` });
await page.keyboard.press('Escape');

const fatal = errors.filter((e) => !/favicon/.test(e));
check(fatal.length === 0, `sem erros de console (${fatal.join(' | ')})`);
await browser.close();
console.log(failed ? `\n${failed} falha(s)` : '\nTodos os testes E2E passaram (Chromium).');
process.exit(failed ? 1 : 0);
