# Fase 1 — Pesquisa de fornecedores de dados financeiros

> **Estado da verificação (01/11/2026).** Os sites oficiais dos fornecedores
> (finnhub.io, twelvedata.com, alphavantage.co, massive.com/polygon.io) estavam
> **bloqueados pela política de rede do ambiente onde esta pesquisa foi feita**.
> Os números abaixo vêm de motores de busca e de agregadores de terceiros
> (datados de jan–jul/2026), que **discordam entre si** em vários pontos.
> Os valores marcados com ⚠️ têm de ser confirmados na página oficial antes de
> contratar. Nada aqui foi inventado: onde não havia fonte, está escrito "não confirmado".

## Tabela comparativa

| Critério | Finnhub | Twelve Data | Alpha Vantage | Massive (ex‑Polygon.io) | Interactive Brokers |
|---|---|---|---|---|---|
| Ações/ETFs EUA | Sim | Sim | Sim | Sim (só EUA) | Sim |
| Ações/ETFs Europa | Plano pago ⚠️ (gratuito: não confirmado) | Sim, por nível (Grow/Pro/Ultra) ⚠️ | Parcial (sufixos .DEX/.PAR), geralmente fim do dia ⚠️ | **Não** | Sim (assinaturas de dados por bolsa) |
| Tempo real EUA | Gratuito: reportado como tempo real (provavelmente fonte de uma única bolsa/IEX, não consolidado) ⚠️ | Basic (gratuito) inclui tempo real EUA segundo a página de preços ⚠️ | Só planos Premium ≥ ~US$99,99/mês **+ processo de entitlement** | Plano Advanced (~US$199/mês) ⚠️ | Sim, com conta e assinatura de bolsa |
| Atrasados EUA | — | — | Premium 75 (15 min) ⚠️ | Starter/Developer (15 min) ⚠️ | Gratuito atrasado |
| Tempo real Europa | Pago, não confirmado | Pro/Ultra (fontes discordam) ⚠️ | Não | Não | Sim (pago por bolsa) |
| WebSocket | Sim (trades; gratuito reportado) ⚠️ | Pro+ (gratuito: 8 créditos só em símbolos de teste) | Não | Sim (planos pagos) | TWS/Gateway API |
| Limites (gratuito) | ~60 chamadas/min (fontes concordam; 1 fonte diz /s) ⚠️ | 800 créditos/dia + limite por minuto | 25 pedidos/dia ⚠️ | 5 chamadas/min | n/a |
| Preço mensal | Pagos: não confirmado | Pro ~US$191/mês (anual); Ultra ~US$832/mês ⚠️ | US$49,99 → US$249,99 (pessoal) ⚠️ | Starter US$29, Developer US$79–99, Advanced US$199 ⚠️ | Dados: ~US$1–10/bolsa/mês (não confirmado) |
| Plano gratuito | Sim | Sim (Basic) | Sim | Sim (EOD/atrasado) | Não (exige conta) |
| Uso automatizado | Sim (API) | Sim | Sim | Sim | Sim, mas é um **broker** |
| Exibir num painel próprio | Uso pessoal; redistribuição/uso comercial é restrito ⚠️ | **Planos Business obrigatórios para qualquer empresa/equipa, mesmo uso interno** | Uso comercial exige contacto/licença (US$499–2.499/mês reportado) ⚠️ | Uso comercial/redistribuição com preço separado ⚠️ | Dados para uso próprio; redistribuição proibida |

## Acesso técnico ≠ autorização para redistribuir

* **Acesso técnico**: a sua chave consegue pedir uma cotação.
* **Licença de dados**: as bolsas (NYSE, Nasdaq, Deutsche Börse, Euronext) cobram
  pelo uso de dados em tempo real e distinguem *uso pessoal (non‑professional)* de
  *uso profissional/empresarial* e de *redistribuição a terceiros*.
* Para um **painel privado, de um único utilizador, protegido por senha**, os planos
  pessoais costumam ser suficientes. **Mostrar as cotações a outras pessoas**
  (equipa, clientes, público) normalmente exige plano Business/licença de
  redistribuição. O NEXUS foi construído com autenticação obrigatória por isso.
* A Alpha Vantage afirma explicitamente que tempo real/15 min dos EUA é regulado
  por bolsas/FINRA/SEC e exige um passo de *entitlement* adicional.

## Recomendação

1. **Fase de experimento (48 h / 7 d), custo zero:**
   `QUOTE_PROVIDER=finnhub` (EUA em tempo real, plano gratuito) +
   `HISTORY_PROVIDER=twelvedata` (barras diárias, gratuito) +
   `FX_PROVIDER=twelvedata` com fallback automático para as taxas de referência
   **oficiais do BCE** (diárias, rotuladas como "reference").
   **Limitação honesta:** com planos gratuitos a **Europa não terá cotações em
   tempo real**; o sistema marca esses ativos como "não coberto/atrasado" e
   **não opera neles**. Os agentes operam apenas EUA até haver plano com Europa.
2. **Para incluir a Europa em tempo real:** Twelve Data Pro (ou superior) como
   `QUOTE_PROVIDER` — confirmar antes quais bolsas (Xetra, Euronext) estão em
   tempo real no plano e se o uso é pessoal ou exige Business.
3. **Validação cruzada:** `CROSSCHECK_PROVIDER` com um segundo fornecedor
   (ex. Massive para EUA) — divergência > 1,5 % bloqueia a operação.

A arquitetura isola os fornecedores atrás de `MarketDataProvider`
(`backend/nexus/market/base.py`). Trocar de fornecedor = alterar uma variável de
ambiente; adicionar um novo = implementar uma classe com `quote()`,
`daily_bars()`, `news()`, `fx_eur()`.

## Como verificar os dados com as suas chaves

```bash
docker compose run --rm api python -m nexus.cli probe
```

Mostra, para AAPL, SPY e SAP (Xetra): preço, timestamp, atraso medido e o tipo
de feed declarado. É o primeiro passo obrigatório antes do teste de 48 h.

## Fontes consultadas

- Twelve Data — pricing (snippet de busca): https://twelvedata.com/pricing ; créditos: https://support.twelvedata.com/en/articles/5615854-credits ; trial: https://support.twelvedata.com/en/articles/5335783-trial ; planos: https://support.twelvedata.com/en/articles/5331011-unlimited-extended-plans
- Agregadores: https://www.lambdafin.com/articles/financial-data-api-2026 , https://apicostcalc.com/finnhub.html , https://apicostcalc.com/polygon.html , https://apicostcalc.com/blog/polygon-massive-rebrand-api-pricing.html , https://qveris.ai/guides/stock-api-free-comparison/ , https://api.qveris.ai/guides/polygon-pricing-optimized , https://tradingtoolshub.com/blog/polygonio-pricing-guide-2026-all-plans-costs-hidden-fees/ , https://costbench.com/software/financial-data-terminals/polygon-io/
- Alpha Vantage — política de dados em tempo real: https://www.alphavantage.co/realtime_data_policy/ ; premium: https://www.alphavantage.co/premium ; análise de preços: https://qveris.ai/guides/alpha-vantage-pricing-alternative/
- BCE — taxas de referência: https://data-api.ecb.europa.eu
