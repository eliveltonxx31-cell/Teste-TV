# Fase 2 — Arquitetura do NEXUS AI TRADING

```
                ┌──────────────── Servidor cloud (Docker Compose) ────────────────┐
 iPhone/PC ──►  │ Caddy (HTTPS) ─► API FastAPI ─┬─ PWA React (estático)            │
                │                               ├─ REST /api/* (JWT)               │
                │                               └─ SSE /api/events/stream (Live)   │
                │                                         │                        │
                │ Worker 24/7 ───────────────────────────►│ PostgreSQL ◄── backup  │
                │  └ ciclo: dados → análise → decisão → RISK GUARDIAN → simulador │
                └───────────────────────────────┬────────────────────────────────┘
                                                │ HTTPS
                         Finnhub · Twelve Data · Alpha Vantage · Massive · BCE
                         (opcional) Claude API — só sentimento de notícias
```

## Módulos (`backend/nexus/`)

| Módulo | Responsabilidade |
|---|---|
| `market/base.py` | Contratos neutros: `Quote` (nome, ticker, bolsa, preço, moeda, timestamp UTC, fuso, fonte, tipo de feed, atraso), `Bar`, `News`, `FxRate`, `MarketDataProvider` |
| `market/providers.py` | Adaptadores reais: Finnhub, Twelve Data, Alpha Vantage, Massive (Polygon), BCE |
| `market/validator.py` | Integridade: preço inválido, timestamp ausente/futuro, cotação velha, livro cruzado, spread largo, gap > 25 %, salto > 10 % (exige 3 confirmações), divergência entre fontes |
| `market/service.py` | Encaminha cada papel (cotação, histórico, notícias, câmbio, verificação cruzada) a um fornecedor; conta falhas → **modo seguro** |
| `market/calendar.py` | Horários e feriados de NYSE/Nasdaq, Xetra, Euronext Paris/Amsterdã (`exchange_calendars`) |
| `analysis/indicators.py` | RSI, MACD, MMS/MME, Bollinger, ATR, volatilidade, momentum, suportes/resistências, correlação — **só barras diárias concluídas** |
| `analysis/sentiment.py` | Léxico financeiro determinístico; opcionalmente Claude (pontuação limitada a [-1, 1]) |
| `strategy/rules.py` | Regras A/B/C explicáveis: pré‑condições, score ponderado, justificativas |
| `risk/limits.py` | Limites rígidos **imutáveis** (constantes congeladas) + perfis A/B/C (só podem ser mais restritivos — verificado no arranque) |
| `risk/guardian.py` | **RISK GUARDIAN**: recalcula tudo e tem veto final; disjuntores de perda diária e drawdown |
| `broker/paper.py` | Simulador: mercado/limite, latência, spread, slippage, taxas, câmbio, liquidez, validade, rejeições, idempotência |
| `engine/cycle.py` | Orquestra o ciclo; atómico (tudo ou nada) e idempotente após reinício |
| `engine/worker.py` | Processo 24/7 com backoff e recuperação |
| `reports/reporting.py` | Métricas e relatórios diários / final |
| `monitoring.py` | Log de eventos encadeado por SHA‑256, incidentes, modo seguro, alertas webhook |
| `api/` | FastAPI + autenticação scrypt/JWT |

## Princípios de segurança

1. **Sem execução real.** Não existe nenhum código de ligação a corretoras.
2. **A IA não decide sozinha.** O motor de decisão é quantitativo e determinístico.
   O LLM (opcional) só produz um número de sentimento por notícia, com peso ≤ 15 %
   e capacidade de veto apenas em sentimento muito negativo. Toda ordem passa
   pelo Risk Guardian, que não recebe nada do LLM.
3. **Limites imutáveis** em código (`HardLimits` congelado, `PROFILES` read‑only);
   não há endpoint, variável de ambiente nem tabela que os altere.
4. **Dados duvidosos ⇒ não operar.** Cotação atrasada/velha/inconsistente ⇒ bloqueio;
   5 falhas seguidas do fornecedor ⇒ modo seguro (só vendas de redução de risco),
   que apenas o operador pode desligar (registado em auditoria).
5. **Sem look‑ahead.** Indicadores usam apenas barras diárias anteriores à sessão
   corrente; ordens só são executadas com uma cotação **recebida depois** de
   submetidas (latência simulada) — nunca com o preço que as originou.
6. **Sem martingale.** Proibido aumentar posição existente; sem alavancagem; sem venda a descoberto.
7. **Auditoria.** `events`, `decisions`, `closed_trades`, `reports`, `equity_snapshots`
   são *append‑only*; `orders`, `incidents`, `experiments`, `agents` não podem ser apagados.
   Em PostgreSQL, *triggers* reforçam isto ao nível da base de dados. O log de eventos
   é uma cadeia de hashes: qualquer edição direta é detetada (`/api/audit/verify`).

## Ciclo do agente (a cada 120 s com mercado aberto; 15 min fechado)

1. Batimento cardíaco do worker; verifica fim do experimento.
2. Cotações dos ativos com bolsa aberta (+ posições e ordens pendentes) e câmbio EUR/USD.
3. Para cada agente: reavalia posições, rolagem diária, pico, **disjuntores**.
4. Processa ordens pendentes (só com cotação nova e negociável).
5. Saídas: stop‑loss, take‑profit, sinal de saída da estratégia.
6. Entradas: score ≥ mínimo do perfil → dimensionamento
   `min(6 % do patrimônio, risco por operação / distância do stop, caixa acima da reserva)`
   → Risk Guardian → ordem (máx. 2 novas por ciclo).
7. Relatório diário a cada 24 h; relatório final no fim do experimento.

Fora de horário: notícias (gerais + empresas EUA), calendário de resultados,
atualização de histórico e relatórios.

## Gestão de risco: limites efetivos

| | Rígido (teto) | A Conservador | B Moderado | C Agressivo |
|---|---|---|---|---|
| Tamanho máx. nova posição | 6 % | 5 % | 6 % | 6 % |
| Máx. posições | 10 | 8 | 10 | 10 |
| Reserva mínima | 30 % | 40 % | 30 % | 30 % |
| Risco por operação (até ao stop + custos) | 1 % | 0,4 % | 0,6 % | 0,8 % |
| Perda diária ⇒ bloqueio de compras no dia | 5 % | 2 % | 3 % | 4 % |
| Drawdown ⇒ bloqueio até novo experimento | 20 % | 8 % | 12 % | 15 % |
| Exposição por setor | 30 % | 20 % | 25 % | 30 % |
| Correlação máx. com posições | — | 0,70 | 0,80 | 0,85 |
| Volatilidade anual máx. | — | 30 % | 45 % | 70 % |
| Custo ida‑e‑volta máx. | 1,5 % | = | = | = |
| Distância máx. do stop | 10 % | = | = | = |

## Estratégias

* **A — Conservador:** tendência de longo prazo (preço > MMS200, MMS50 > MMS200),
  compra em recuo (RSI 40–60, perto da MMS50), volatilidade ≤ 30 %, filtro de qualidade
  fundamentalista. Stop 2×ATR, alvo 3×ATR.
* **B — Moderado:** tendência + momentum (MACD acima do sinal, RSI 45–70), confirmação
  por volume, diversificação. Stop 2,5×ATR, alvo 4×ATR.
* **C — Agressivo:** rompimento da máxima de 20 dias com volume ≥ 1,3× média.
  Stop 1,5×ATR, alvo 3×ATR.

Todas podem ficar sem operar quando nada passa nos critérios.
