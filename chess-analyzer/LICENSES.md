# Licenças

Este aplicativo distribui componentes de terceiros sem modificação:

| Componente | Versão | Arquivos | Licença | Origem |
| --- | --- | --- | --- | --- |
| Stockfish.js (Stockfish 19, build "lite single-threaded") | 19.0.1 | `vendor/stockfish/stockfish-19-lite-single.js`, `.wasm` | GPL-3.0 (texto em `vendor/stockfish/COPYING.txt`) | pacote npm `stockfish@19.0.1` — https://github.com/nmrugg/stockfish.js |
| chess.js | 1.4.0 | `vendor/chess.js/chess.js` (build ESM, sem o comentário de source map) | BSD-2-Clause (texto em `vendor/chess.js/LICENSE`) | pacote npm `chess.js@1.4.0` — https://github.com/jhlywa/chess.js |

Como o app distribui o Stockfish (GPL-3.0), o conjunto publicado deve ser
distribuído sob GPL-3.0 ou posterior, e o código-fonte completo (este
repositório) precisa continuar acessível a quem receber o app. O código-fonte
do Stockfish.js está em https://github.com/nmrugg/stockfish.js (tag `v19.0.1`).

Somas SHA-256 dos arquivos de terceiros, conferidas na importação:

```
ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a  vendor/stockfish/stockfish-19-lite-single.js
ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de  vendor/stockfish/stockfish-19-lite-single.wasm
```

As peças são caracteres Unicode do sistema (sem arquivos de imagem de terceiros).
