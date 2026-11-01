# NEXUS AI TRADING v2.0 — plataforma autónoma de *paper trading*

Três agentes (Conservador, Moderado, Agressivo) analisam ações e ETFs reais dos
EUA e da Europa, decidem com regras quantitativas explicáveis, passam por um
**Risk Guardian** independente e operam **apenas com capital virtual**
(€400 cada por omissão). **Não existe qualquer código de execução de ordens reais.**

> Nenhum resultado é prometido. O objetivo é medir, com dados reais e métricas
> verificáveis, se as estratégias conseguem resultados positivos após custos e risco.

## Estrutura

```
nexus-trading/
├── backend/                 Python 3.13 · FastAPI · SQLAlchemy · pandas
│   ├── nexus/
│   │   ├── market/          fornecedores reais, validação, calendários, universo
│   │   ├── analysis/        indicadores técnicos, sentimento de notícias
│   │   ├── strategy/        regras dos agentes A/B/C
│   │   ├── risk/            limites imutáveis + RISK GUARDIAN
│   │   ├── broker/          simulador de paper trading
│   │   ├── engine/          ciclo, experimentos, worker 24/7
│   │   ├── reports/         métricas e relatórios
│   │   ├── api/             API REST/SSE + autenticação
│   │   ├── monitoring.py    log de eventos com cadeia de hashes, modo seguro, alertas
│   │   └── cli.py           probe de dados, hash de senha, experimentos
│   └── tests/               57 testes automatizados
├── frontend/                React 18 + Vite · PWA instalável (Safari iPhone)
├── deploy/                  Caddy (HTTPS), script de backups
├── docs/                    pesquisa de APIs, arquitetura, custos e cronograma
├── Dockerfile               imagem única (API + worker + PWA)
├── docker-compose.yml       postgres · api · worker · backup · caddy
└── .env.example
```

## Telas

Dashboard · **Live Monitoring** · Mercado (fonte, hora, fuso, tipo de feed e atraso
de cada cotação) · Agentes · Inteligência (decisões, justificativas, regras do Guardian,
operações rejeitadas) · Carteira · Relatórios · Configurações (limites protegidos).

## Instalação em servidor (produção)

Requisitos: VPS Linux com Docker + Compose, um domínio a apontar para o IP.

```bash
git clone <repo> && cd <repo>/nexus-trading
cp .env.example .env
openssl rand -hex 32                      # -> JWT_SECRET
docker compose build api
docker compose run --rm api python -m nexus.cli hash-password   # -> ADMIN_PASSWORD_HASH
# preencha DOMAIN, POSTGRES_PASSWORD, chaves FINNHUB/TWELVEDATA e entitlements no .env
docker compose run --rm api python -m nexus.cli probe          # verifica dados REAIS
docker compose up -d
```

Abra `https://SEU_DOMINIO` no Safari do iPhone → Partilhar → **Adicionar ao ecrã principal**.
O worker corre no servidor 24/7; o iPhone pode estar desligado.

Com `AUTO_START_EXPERIMENT=48h` o primeiro teste começa sozinho; os seguintes
(7 d, 30 d) iniciam‑se em **Configurações**.

Operação:

```bash
docker compose logs -f worker              # acompanhar o motor
docker compose exec api python -m nexus.cli verify-chain
docker compose restart worker              # reinício seguro (estado está no PostgreSQL)
```

Backups: `./backups/nexus-*.sql.gz` diários (retenção 14 dias). Copie‑os para fora do servidor.
Alertas: defina `ALERT_WEBHOOK_URL` (ex. `https://ntfy.sh/<tópico>`) para receber
modo seguro, disjuntores e falhas no telemóvel.

## Desenvolvimento local

```bash
cd backend && pip install -r requirements.txt
python -m pytest                          # 57 testes
export JWT_SECRET=$(openssl rand -hex 32) ADMIN_PASSWORD_HASH=$(python -m nexus.cli hash-password)
python -m nexus.cli start 48h 400
uvicorn nexus.api.main:app --reload      # API em :8000
python -m nexus.engine.worker             # noutro terminal
cd ../frontend && npm install && npm run dev   # UI em :5173 (proxy para :8000)
```

Sem chaves de API o sistema arranca, avisa no Live Monitoring e **não opera** —
nunca gera preços simulados.

## O que foi testado e o que não foi

**Testado (automatizado, 57 testes a passar):** indicadores e ausência de look‑ahead;
validação de dados (velhos, atrasados, sem horário, futuros, livro cruzado, saltos,
divergência entre fontes, confirmação de movimentos reais); todas as regras do Risk
Guardian; imutabilidade dos limites; simulador (latência, spread, slippage, taxas,
limite, liquidez, validade, caixa, sem venda a descoberto, P&L); ordens duplicadas;
reinício do processo; falha de fornecedor → modo seguro; falha a meio do ciclo →
rollback total; auditoria (sem apagar/editar, deteção de adulteração); API e autenticação;
relatórios diários e finais. Os testes do motor usam um fornecedor *fake* que existe
**só** na pasta `tests/`.

**Testado manualmente:** API + worker reais a correr localmente (SQLite), PWA em
viewport de iPhone 14 e desktop sem erros de consola nem overflow.

**Ainda NÃO testado (limitações reais):**
* chamadas às APIs reais — a rede do ambiente de desenvolvimento bloqueou os domínios
  dos fornecedores e não havia chaves; os adaptadores seguem a documentação pública
  mas **têm de ser validados com `nexus.cli probe`** antes do teste de 48 h;
* `docker compose` e PostgreSQL (sem daemon Docker no ambiente) — os *triggers* de
  auditoria do PostgreSQL só correm em produção;
* os testes de 48 h, 7 e 30 dias — dependem do servidor e das chaves;
* cotações por WebSocket (v1 usa REST a cada 2 min).

Documentação: [`docs/PESQUISA_APIS.md`](docs/PESQUISA_APIS.md) ·
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) ·
[`docs/CRONOGRAMA_E_CUSTOS.md`](docs/CRONOGRAMA_E_CUSTOS.md)
