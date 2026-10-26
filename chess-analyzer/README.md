# Chess Analyzer (PWA para iPhone)

Análise de xadrez com **Stockfish 19 em WebAssembly**, rodando inteiramente no
aparelho, otimizada para o Safari do iOS e instalável na Tela de Início.
Sem servidor de análise, sem jailbreak, sem enviar posições para fora.

> **Escopo de uso.** O app analisa posições do **próprio tabuleiro**, de
> **PGN/FEN importados** e de **treinos contra o computador**. Ele não lê a
> tela, não se integra a sites de partidas ao vivo e não fica sobreposto a
> outros apps. Ver “Por que não roda dentro do chess.com durante a partida”.

---

## Etapa 1 — Dependências pesquisadas (validadas em 26/10/2026)

| Item | Escolha | Por quê |
| --- | --- | --- |
| Motor | `stockfish@19.0.1` (npm, projeto stockfish.js de Nathan Rugg, mantido para o motor do navegador do chess.com) — arquivos `stockfish-19-lite-single.js` + `.wasm` (≈1,8 MB) | O próprio README do pacote recomenda o *lite single-threaded* para a web: não exige isolamento de origem cruzada (COOP/COEP), roda em qualquer host estático e suporta iOS 16+. |
| Alternativas descartadas | `stockfish-19.wasm` / `-single.wasm` (≈94 MB) | Grandes demais para baixar e manter em cache no iPhone; a versão multithread ainda exige `Cross-Origin-Opener-Policy`/`Embedder-Policy` e `SharedArrayBuffer`. |
| Regras | `chess.js@1.4.0` (BSD-2), build ESM | Movimentos legais, roque, en passant, promoção, mate, empates, PGN/FEN. |
| Licença | GPL-3.0 (por causa do Stockfish) | O app inteiro é distribuído sob GPL-3.0; ver `LICENSES.md`. |

Opções UCI informadas pelo próprio motor no handshake (teste em Node):
`Threads` 1–1, `Hash` padrão 16, `MultiPV` 1–256, `Skill Level` 0–20,
`UCI_LimitStrength`, `UCI_Elo` 1320–3190.

### Limitações técnicas do Safari no iOS (e como o app lida)

| Limitação | Efeito | Tratamento no app |
| --- | --- | --- |
| Todo navegador no iOS usa WebKit | Chrome/Firefox no iPhone se comportam como Safari | Testar sempre no Safari. |
| Sem execução em segundo plano | Ao trocar de app ou bloquear a tela, o iOS congela a página | O cálculo é parado no `visibilitychange` e retomado ao voltar. |
| Sem sobreposição a outros apps | Uma página web não flutua sobre outro app | Não é suportado; não há contorno legítimo. |
| `SharedArrayBuffer` só com COOP/COEP | Multithread do WASM depende de cabeçalhos especiais | Build single-thread: 1 núcleo por motor. |
| Memória por aba limitada (não documentada) | Hash grande pode fazer a aba recarregar | Hash limitado a 256 MB; perfis vão de 16 a 128 MB. |
| Armazenamento pode ser apagado | Safari pode remover dados de sites não usados por semanas | `navigator.storage.persist()` é solicitado; exportar PGN é recomendado. |
| `performance.memory` e Battery API inexistentes | Não dá para medir RAM/bateria pela página | Diagnóstico mostra latência, profundidade, nós/s e reinícios; bateria deve ser medida em Ajustes → Bateria do iPhone. |
| Zoom ao focar campos < 16 px | Tela “pula” ao digitar | Campos usam 16 px. |
| Emoji para ♟ | O iOS pode desenhar o peão como emoji | Seletor de variação U+FE0E força glifo de texto (validar no aparelho). |

### Arquitetura

```
index.html           interface (um único documento, diálogos <dialog>)
css/app.css          tema escuro, layout para uma mão, variáveis de cor
js/app.js            orquestra: eventos, renderização, treino, persistência
js/board.js          tabuleiro DOM + setas SVG; toque-toque ou arrastar; promoção
js/game.js           modelo da partida (chess.js): lances, cursor, PGN/FEN, status
js/engine.js         EngineController: UCI, fila, cancelamento, watchdog, reinício
js/uci.js            parser UCI puro (testado em Node)
js/analysis-core.js  cache LRU e classificação dos lances (cores)
js/profiles.js       perfis de análise × níveis do adversário (separados)
js/palette.js        paletas de cor (padrão, daltonismo, alto contraste)
js/storage.js        IndexedDB (preferências, sessão, partidas) com reserva em memória
js/metrics.js        latência, profundidade, nós/s, cancelamentos
sw.js                Service Worker (cache do app + WASM para uso offline)
vendor/              Stockfish e chess.js sem modificação
tests/               unitários (node --test) e ponta a ponta (Playwright/Chromium)
```

Fluxo da análise:

```
mudança de posição ──► requestAnalysis()
                         ├─ fim de jogo? → mostra resultado, motor parado
                         ├─ pausado / oculto / adversário pensando → motor parado
                         ├─ cache tem profundidade suficiente → mostra na hora
                         └─ engine.analyze({fen, multipv, depth, movetime})
                               ├─ havia cálculo? → "stop"; o bestmove dele é descartado
                               ├─ "position fen …" + "go depth D movetime T"
                               ├─ "info …" → atualização a cada 100 ms + requestAnimationFrame
                               └─ "bestmove" → resultado final → cache
toda exibição confere res.fen === posição atual (nunca mostra posição antiga)
```

Concorrência: um único `go` por Worker; um pedido novo substitui o pendente.
O adversário do treino usa um **segundo Worker** (criado só no treino e
encerrado ao sair) e, enquanto ele pensa, a análise fica pausada para não
usar dois núcleos ao mesmo tempo. Nunca é usado `go infinite`: todo cálculo
tem limite de profundidade **e** de tempo.

Recuperação: erro no Worker, falta de resposta no handshake ou silêncio
prolongado durante o cálculo → o Worker é destruído e recriado (até 3 vezes
por minuto, com espera crescente). Há também o botão “Reiniciar motor”.

### Cores

| Classe | Padrão | Símbolo | Critério (perda vs. melhor lance) |
| --- | --- | --- | --- |
| Recomendado | verde | ✓ | melhor variante |
| Alternativa interessante | azul | ! | até 40 cp |
| Inferior, mas jogável | amarelo | ?! | até 120 cp |
| Erro / perda significativa | vermelho | ?? | mais de 120 cp |

Para o **lance jogado**, a perda é ponderada pela chance de vitória (perder
1 peão com +9 não é “erro”). Paletas: padrão, daltonismo (Okabe–Ito), alto
contraste ou personalizada. O símbolo acompanha sempre a cor.

### Perfis

*Perfil de análise* (quanto o motor calcula para ajudar você — sempre na força máxima):

| Perfil | Variantes | Profundidade | Tempo máx. | Hash |
| --- | --- | --- | --- | --- |
| Iniciante | 1 | 10 | 0,4 s | 16 MB |
| Intermediário | 2 | 14 | 1 s | 16 MB |
| Avançado | 3 | 18 | 2,5 s | 32 MB |
| Especialista | 3 | 22 | 5 s | 64 MB |
| Análise completa | 3 | 30 | 20 s | 128 MB |
| Personalizado | 1–3 | 4–40 | 0,1–60 s | 8–256 MB |

*Nível do adversário* (quão forte o computador joga no treino): Iniciante
(`Skill Level` 0), Intermediário (6), Avançado (`UCI_Elo` 1800), Especialista
(2400), Força máxima, ou rating livre entre 1320 e 3190. **O rating é uma
estimativa** calibrada em partidas entre motores; não garante força
equivalente à de um humano com o mesmo número.

A velocidade e a profundidade alcançadas dependem da posição e do aparelho:
o app não promete análise instantânea.

---

## Por que não roda dentro do chess.com durante a partida

Isso não foi implementado, e não vou implementar:

* **É trapaça pelas regras do site.** A política de Fair Play do chess.com
  proíbe usar motor ou qualquer assistência externa em partidas valendo
  (ao vivo ou diárias). Contas que fazem isso são banidas, e os ratings dos
  adversários são corrigidos. O pedido do projeto também excluía
  explicitamente mecanismos para contornar regras de plataformas competitivas.
* **Tecnicamente, no iPhone, exigiria exatamente o que foi vetado**: ler a tela
  ou o DOM de outro site/app às escondidas, ou injetar código na página dele.

Usos legítimos com partidas do chess.com que o app já atende:

1. **Depois que a partida terminar**: no chess.com, “Compartilhar → PGN” →
   copiar → aqui, *Importar* → colar. Você navega lance a lance com as cores
   indicando onde errou.
2. **Treino com o adversário do app**, nos níveis acima.
3. **Tabuleiro livre** para testar ideias de abertura ou finais.

---

## Como rodar e testar

```bash
cd chess-analyzer
python3 -m http.server 8080          # qualquer servidor estático com HTTPS em produção
npm test                              # testes unitários (Node 18+)
npm run test:e2e                      # ponta a ponta no Chromium headless (Playwright)
```

Servir o `.wasm` como `application/wasm` (Python, GitHub Pages, Cloudflare
Pages e Netlify já fazem isso). Service Worker exige HTTPS (ou `localhost`).

## Etapa 8 — Publicação e instalação

**Publicar (qualquer host estático com HTTPS):**

* *GitHub Pages*: publique a pasta `chess-analyzer/` (Settings → Pages, ou
  copie a pasta para a raiz de um repositório de Pages). Endereço final:
  `https://<usuário>.github.io/<repo>/`.
* *Cloudflare Pages / Netlify*: diretório de publicação `chess-analyzer`,
  sem comando de build. O arquivo `_headers` define cache e MIME.

Ao publicar uma versão nova, troque `CACHE_VERSION` em `sw.js`; senão os
aparelhos continuam com a versão em cache.

**Instalar no iPhone:**

1. Abrir o endereço no **Safari**.
2. Esperar o chip “Motor pronto” (o primeiro acesso baixa ≈2 MB).
3. Botão Compartilhar → **Adicionar à Tela de Início** → Adicionar.
4. Abrir pelo ícone. Para testar offline: ativar Modo Avião e abrir de novo.

Internet só é necessária no primeiro acesso e para atualizar o app. A
análise, o treino e a importação funcionam offline; o chip “Offline” aparece
quando não há conexão.

---

## O que foi testado aqui e o que falta validar no iPhone

Testado neste ambiente (Linux, sem acesso a iPhone ou WebKit):

* Handshake UCI, MultiPV e opções do Stockfish 19 lite (Node).
* 12 testes unitários: parser UCI, placares de mate, cache LRU, classificação,
  roque, en passant, promoção, mate, afogamento, PGN do chess.com com `[%clk]`,
  variantes descartadas, FEN inválida, PGN com FEN inicial.
* Ponta a ponta no **Chromium** com viewport de iPhone: carga do motor,
  variantes, lance por toque, troca rápida de posição sem resultado antigo,
  importação de PGN até o mate, erro de FEN, promoção, treino (adversário
  joga primeiro), funcionamento offline pelo Service Worker, paleta para daltonismo.

**Não validado — precisa de um iPhone real com Safari:**

- [ ] O Worker + WASM carrega no WebKit do iOS (iOS 16+) e o tempo de carga.
- [ ] Profundidade e nós/s reais por perfil (ver Ajustes → Diagnóstico).
- [ ] Hash de 128–256 MB não derruba a aba em aparelhos com menos RAM.
- [ ] Peças Unicode aparecem como texto, não emoji, e com boa aparência.
- [ ] Toque/arraste, seletor de promoção e áreas seguras (notch, barra inicial).
- [ ] Instalação na Tela de Início, ícone, abertura em tela cheia.
- [ ] Offline em Modo Avião após a instalação.
- [ ] Pausa ao bloquear a tela e retomada ao voltar.
- [ ] Consumo de bateria e aquecimento em 15–30 min de análise contínua.
- [ ] `<dialog>`, `color-mix()` e `dvh` (exigem iOS 15.4/16.2+).
