# Custos de infraestrutura e cronograma

## Custos mensais estimados (⚠️ confirmar preços atuais antes de contratar)

| Item | Opção mínima | Observação |
|---|---|---|
| Servidor cloud (2 vCPU, 4 GB RAM, Ubuntu + Docker) | ~€5–15/mês (Hetzner, DigitalOcean, OVH, Lightsail) | Suficiente para API + worker + PostgreSQL |
| Domínio | ~€10–15/ano | Necessário para HTTPS automático (Caddy/Let's Encrypt) |
| Dados — fase de teste (só EUA em tempo real) | €0 (Finnhub + Twelve Data gratuitos) | Europa sem tempo real |
| Dados — EUA + Europa em tempo real | ~US$190+/mês (Twelve Data Pro, valor reportado) | Confirmar cobertura Xetra/Euronext e licença |
| Claude (opcional, sentimento) | ≈ US$0,002 por manchete com `claude-opus-5-5` (≈300 tokens entrada/50 saída a US$4/US$20 por MTok) → ~US$20/mês a 300 manchetes/dia | Com `claude-haiku-5-5` seria ~40× mais barato; a escolha é sua |
| Backups externos (opcional) | ~€1–5/mês (S3/B2) | O compose guarda dumps diários locais; copie‑os para fora do servidor |
| **Total fase de teste** | **≈ €6–16/mês** | |

## Achado importante: custos vs. capital de €400

Com €400 por agente, o limite de 6 % dá posições de **≈ €24**. Uma corretora com
**€1 fixo por ordem** custaria €2 por ida‑e‑volta ≈ **8 % da posição** — nenhuma
estratégia sobrevive a isso. Por isso:

* o modelo de custos padrão é de corretora **sem comissão fixa** (0,05 % + 0,25 % de câmbio
  em ativos USD + spread + slippage);
* o Risk Guardian **rejeita** operações cujo custo estimado de ida‑e‑volta exceda 1,5 %;
* se quiser simular uma corretora com tarifa fixa, defina `FEE_FIXED_EUR=1` — verá os
  agentes rejeitar quase tudo, o que é o resultado correto;
* ações fracionadas (`FRACTIONAL_SHARES=1`) são necessárias para posições de €24.

## Cronograma

| Fase | Conteúdo | Estado |
|---|---|---|
| 1 | Pesquisa de APIs | ✅ feita (com limitações de verificação descritas em PESQUISA_APIS.md) |
| 2 | Arquitetura | ✅ |
| 3 | Site e dashboard (PWA) | ✅ v1 — 7 telas + Live Monitoring |
| 4 | Conexão a dados reais | ✅ código dos adaptadores · ⏳ **validar com as suas chaves** (`nexus.cli probe`) |
| 5 | Simulador financeiro | ✅ |
| 6 | Risk Guardian | ✅ |
| 7 | Primeiro agente | ✅ |
| 8 | Outros dois agentes | ✅ |
| 9 | Servidor contínuo | ✅ código + Docker Compose · ⏳ implantar no seu servidor |
| 10 | Teste de 48 h | ⏳ depende de chaves + servidor (dia 1–3 após implantação) |
| 11 | 7 dias e 30 dias | ⏳ semanas 1–6 após o teste de 48 h |

Sugestão de calendário a partir da implantação:

* **Dia 0:** servidor, domínio, `.env`, `probe` dos dados, `docker compose up`.
* **Dias 1–2:** experimento de 48 h (começar num dia útil antes da abertura de NY).
  Rever: incidentes, rejeições, latência real das cotações, custos.
* **Dia 3:** ajustes de configuração (não de limites de segurança), corrigir problemas.
* **Dias 4–11:** experimento de 7 dias.
* **Dias 12–42:** experimento de 30 dias e relatório consolidado.

Mesmo 30 dias são uma amostra curta: conclusões sobre rentabilidade exigem meses
e comparação com um *benchmark* (ex. manter SPY/EUNL) ajustada ao risco.
