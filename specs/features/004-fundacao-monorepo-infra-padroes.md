# SPEC-004: Fundação do Monorepo, Infraestrutura Local e Padrões Compartilhados

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-004 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `platform` (infraestrutura compartilhada) |
| **Contexto de tela** | `/` (página inicial provisória) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-001 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seção 2.2 (stack) e seção 7 (fila assíncrona e worker pool de e-mails) |

> **Ordem de implementação aprovada:** **SPEC-004** → SPEC-003 (Autenticação) → SPEC-005 (Turmas, a redigir) → SPEC-002 (Alunos).

---

## 1. Contexto e Problema (Context & Problem Statement)

O simulador era puramente client-side. A transição para uma arquitetura cliente-servidor na branch `projeto-tcc2` exige provisionar, de forma coordenada, os serviços de apoio e as regras estruturais compartilhadas. Os módulos de negócio dependem de serviços de infraestrutura (PostgreSQL, MinIO e um servidor SMTP local de testes) e de padrões comuns de logs estruturados, erros e transações.

Sem uma fundação canônica, as configurações se espalham, o ciclo de vida das conexões diverge, as respostas de erro saem em formatos diferentes e a política de cookies seguros quebra entre o Next.js e o Go. Sem uma topologia local única via Docker Compose e sem um pacote de plataforma para logs (Zap) e erros (RFC 7807), as specs seguintes duplicariam código e criariam dependências circulares.

## 2. Objetivos (Goals)

- Subir o ambiente local de infraestrutura via Docker Compose: PostgreSQL, MinIO e Mailpit (SMTP de testes).
- Manter a mesma origem entre o navegador e a API por `rewrites` do Next.js em `/api`, viabilizando cookies `SameSite=Strict`.
- Criar o esqueleto do backend Go em Modular Monolith, com a infraestrutura compartilhada em `backend/internal/platform/`.
- Carregar e validar a configuração por variáveis de ambiente; a aplicação não sobe sem as obrigatórias.
- Aplicar migrações versionadas do banco no schema do projeto.
- Prover logger Zap injetado, erros RFC 7807, conexão GORM com pool, modelo base com UUIDv7, transações por contexto, cliente MinIO, envio assíncrono de e-mail e health check.
- Encerrar o servidor de forma graciosa, sem perder requisições em andamento nem logs.
- Criar o esqueleto do frontend Next.js com App Router, SCSS Modules, tokens com paridade de temas, cliente HTTP com tratamento RFC 7807 e verificação automática da proibição de cores fixas.
- Definir as ferramentas de teste e de verificação estática de backend e frontend.

### 2.1. Fora de escopo (Non-Goals)

- Qualquer módulo de negócio (`user`, `auth`, `student`, turmas): SPEC-003, SPEC-005 e SPEC-002.
- Hub WebSocket: spec própria.
- Execução do backend e do frontend em contêiner, implantação em produção e pipeline de CI/CD.
- Persistência da fila de e-mails: nesta fase a fila é em memória.
- Componentes de interface além da casca da aplicação e do alternador de tema.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Mesma origem:** os `rewrites` do Next.js encaminham todo caminho iniciado em `/api` para o endereço interno do backend, lido de variável de ambiente. O navegador só conversa com a origem do frontend, e por isso não há CORS.
- **Tokens:** `frontend/src/styles/_tokens.scss` define, só como CSS Custom Properties, tokens semânticos de fundo, superfícies, texto primário e secundário, bordas, cores de feedback (sucesso, aviso, erro, informação), estados de interação, foco, espaçamento, raio, sombra e tipografia. O tema escuro redefine os valores sob `[data-theme="dark"]` no elemento raiz.
- **Mixins:** `frontend/src/styles/_mixins.scss` com pontos de quebra responsivos, foco acessível e truncamento de texto.
- **Tema inicial:** um script mínimo e bloqueante no `<head>` define `data-theme` antes da primeira pintura: usa o tema salvo pelo usuário; se não houver, usa a preferência do sistema operacional. O alternador do cabeçalho troca o atributo sem recarregar a página e salva a escolha. Falha ao ler ou gravar a preferência não quebra a página; ela cai na preferência do sistema.
- **Cliente HTTP:** em `frontend/src/services/`, sobre o `fetch` nativo, com envio de credenciais em todas as chamadas e caminho base relativo `/api/v1`. Respostas com `Content-Type: application/problem+json` viram um erro tipado com `type`, `title`, `status`, `detail`, `instance` e, quando houver, campos inválidos e `retryAfterSeconds`. Falha de rede vira um erro tipado distinto. Nenhuma exceção não tratada chega à renderização.
- **Textos:** os textos de interface ficam em arquivo de mensagens em português, em `frontend/src/messages/`.
- **Casca:** o layout raiz carrega os estilos globais e o cabeçalho com o alternador de tema. A página inicial provisória exibe o estado do health check, consumido pelo cliente HTTP.
- **Verificação estática:** ESLint (configuração do Next.js) e Stylelint com regra que proíbe cores literais (hexadecimais, nomeadas e funções de cor) em qualquer arquivo de estilo, exceto `_tokens.scss`.

### 3.2. Backend (Go — Camada de Módulo/Service)

Pacotes em `backend/internal/platform/`:

- **RN-01 (configuração):** `config` lê as variáveis da seção 4.2, aplica os valores padrão e valida tudo na inicialização. Faltando variável obrigatória ou com valor inválido, a aplicação encerra com log `Error` listando todas as falhas de uma vez.
- **RN-02 (logs):** `logger` cria um `*zap.Logger` uma vez, no `main`, e o injeta em todos os componentes. Em produção (`APP_ENV=production`): JSON, uma linha por evento, com buffer de escrita. Em desenvolvimento: console legível. O nível mínimo vem de `LOG_LEVEL`. Logger global é proibido (`ARCHITECTURE.md`, seção 3.10).
- **RN-03 (correlation ID):** um middleware aceita o cabeçalho `X-Request-ID` recebido se ele for um UUID válido; caso contrário, gera um UUIDv7. O ID vai para o contexto, para um logger filho da requisição e para o cabeçalho `X-Request-ID` da resposta.
- **RN-04 (erros):** o pacote `problem` define a estrutura RFC 7807 e construtores para 400 (`validation-error`, com a lista de campos inválidos), 401, 403, 404, 409, 410, 413, 429 (com `retryAfterSeconds` e cabeçalho `Retry-After`), 500 e 503. Um middleware do Gin converte os erros registrados no contexto em `application/problem+json`. Erro sem mapeamento vira 500 genérico; o detalhe interno vai só para o log `Error`, uma única vez.
- **RN-05 (recuperação):** um middleware de recuperação converte pânicos em 500 RFC 7807 e registra a pilha só no log.
- **RN-06 (banco):** `database` abre a conexão GORM com o PostgreSQL, com `search_path` fixo no schema do projeto e pool configurável (conexões abertas, ociosas e tempo de vida).
- **RN-07 (migrações):** migrações versionadas e sequenciais em `backend/migrations/`, executadas com goose na inicialização, antes de o servidor HTTP aceitar conexões. A primeira migração cria o schema. `AutoMigrate` do GORM é proibido. Migração com falha impede a subida.
- **RN-08 (modelo base):** estrutura com `id` (UUIDv7), `created_at`, `updated_at` e `deleted_at`, mais um hook que gera o UUIDv7 antes da criação quando o `id` vem vazio.
- **RN-09 (transações):** um gerenciador de transação executa uma função dentro de uma transação aberta e propagada pelo contexto. Os repositories usam a transação do contexto quando ela existe e a conexão comum caso contrário. Se a função retornar erro ou entrar em pânico, há rollback.
- **RN-10 (armazenamento):** `storage` encapsula o cliente MinIO, garante a existência do bucket configurado na inicialização e oferece verificação de saúde.
- **RN-11 (e-mail):** `mailer` define a interface de envio e um despachante assíncrono com fila em memória e pool de workers (documento canônico, seção 7). Cada mensagem tem até 3 tentativas com espera crescente; a falha final gera log `Error`. A implementação SMTP aponta para o Mailpit em desenvolvimento.
- **RN-12 (health check):** verifica PostgreSQL, MinIO e SMTP em paralelo, com tempo limite de 2 segundos cada, sem gravar nada no banco. Regra de resposta: PostgreSQL indisponível → 503; PostgreSQL ok e MinIO ou SMTP indisponível → 200 `DEGRADED`; tudo ok → 200 `HEALTHY`.
- **RN-13 (encerramento gracioso):** ao receber SIGINT ou SIGTERM, o servidor para de aceitar conexões, aguarda as requisições em andamento até `SHUTDOWN_TIMEOUT`, drena a fila de e-mails dentro do mesmo prazo, fecha o banco e executa `Sync()` do logger.
- **RN-14 (servidor):** o `main` (`backend/cmd/api/`) é o composition root: carrega a configuração, cria o logger, aplica as migrações, cria as dependências, registra as rotas e inicia o servidor. Nenhum outro pacote instancia dependências por conta própria.

## 4. Modelo de Dados (Data Model)

### 4.1. Banco

- **Schema** do projeto: `linux_lab`, criado pela primeira migração.
- **Tabela de controle de versão das migrações**, gerida pelo goose dentro do schema.
- Nenhuma tabela de negócio.

### 4.2. Variáveis de ambiente

Todas documentadas em `.env.example` (sem segredos reais). O `.env` local não é versionado.

| Variável | Obrigatória | Padrão | Descrição |
| :--- | :--- | :--- | :--- |
| `APP_ENV` | Não | `development` | `development` ou `production` |
| `HTTP_ADDR` | Não | `:8080` | Endereço do servidor Go |
| `LOG_LEVEL` | Não | `debug` em desenvolvimento, `info` em produção | `debug`, `info`, `warn` ou `error` |
| `SHUTDOWN_TIMEOUT` | Não | `15s` | Prazo do encerramento gracioso |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Sim (porta com padrão `5432`) | | Conexão PostgreSQL |
| `DB_SCHEMA` | Não | `linux_lab` | Schema do projeto |
| `DB_MAX_OPEN_CONNS`, `DB_MAX_IDLE_CONNS`, `DB_CONN_MAX_LIFETIME` | Não | `25`, `5`, `30m` | Pool de conexões |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | Sim | | Armazenamento de objetos |
| `MINIO_USE_SSL` | Não | `false` | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | Sim | | Envio de e-mail (Mailpit em desenvolvimento) |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | Não | | Autenticação SMTP, quando houver |
| `MAILER_WORKERS` | Não | `2` | Workers do despachante |
| `BACKEND_INTERNAL_URL` | Sim (frontend) | | Destino dos `rewrites` do Next.js |

A versão do build é injetada na compilação; sem injeção, vale `dev`.

### 4.3. Dependências externas

Toda dependência nova exige spec (`AI_INSTRUCTIONS.md`, seção 7). Esta spec autoriza:

| Lado | Dependência | Uso |
| :--- | :--- | :--- |
| Backend | Gin-Gonic | HTTP |
| Backend | GORM e driver PostgreSQL do GORM | Persistência |
| Backend | Zap | Logs |
| Backend | `github.com/google/uuid` | UUIDv7 |
| Backend | goose | Migrações |
| Backend | `minio-go` | Armazenamento |
| Backend | `go-mail` (`github.com/wneessen/go-mail`) | SMTP; o `net/smtp` da biblioteca padrão está congelado |
| Backend (teste) | `testcontainers-go` | PostgreSQL real nos testes de integração |
| Frontend | Next.js, React, TypeScript, `sass` | Aplicação e estilos |
| Frontend (dev) | ESLint, Stylelint e a configuração SCSS do Stylelint | Verificação estática |
| Frontend (dev) | Vitest e Testing Library | Testes |
| Infra | Imagens oficiais de PostgreSQL, MinIO e Mailpit | Docker Compose |

## 5. Contrato de API (API Contract)

### 5.1. `GET /api/v1/health`

Estado da aplicação e das dependências. **Público.**

**200 OK** (`HEALTHY` ou `DEGRADED`):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `status` | enum | Sim | `HEALTHY` ou `DEGRADED` |
| `version` | texto | Sim | Versão do build |
| `checkedAt` | timestamp ISO 8601 | Sim | Horário do servidor |
| `components` | lista de { `name`, `status`, `latencyMs` } | Sim | `name`: `postgres`, `minio` ou `smtp`; `status`: `HEALTHY` ou `UNHEALTHY` |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 503 | `service-unavailable` | PostgreSQL indisponível; `detail` identifica o componente; a lista `components` também vai no corpo |

### 5.2. Cabeçalhos comuns a todas as respostas

| Cabeçalho | Regra |
| :--- | :--- |
| `X-Request-ID` | Sempre presente (RN-03) |
| `Content-Type` | `application/problem+json` em toda resposta de erro |

## 6. Impacto e Riscos (Impact & Risks)

- **Cookies `SameSite=Strict` bloqueados por origem diferente.**
  *Mitigação:* `rewrites` em `/api` mantêm uma única origem para o navegador.
- **Segredos de infraestrutura no repositório.**
  *Mitigação:* só `.env.example` é versionado; a configuração falha na subida se faltar variável obrigatória (RN-01).
- **Custo de desempenho dos logs.**
  *Mitigação:* Zap com buffer em produção e `Debug` desligado fora do desenvolvimento.
- **Perda de logs ou e-mails ao encerrar.**
  *Mitigação:* encerramento gracioso com drenagem da fila e `Sync()` do logger (RN-13). E-mails enfileirados no momento de uma queda abrupta se perdem; isso é aceito nesta fase.
- **Schema público usado por engano.**
  *Mitigação:* `search_path` fixo na conexão e schema criado pela primeira migração (RN-06, RN-07).
- **Vazamento de detalhes internos em erros.**
  *Mitigação:* erro sem mapeamento vira 500 genérico; o detalhe fica só no log (RN-04).
- **Tema errado piscando na abertura.**
  *Mitigação:* script bloqueante no `<head>` antes da primeira pintura.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: QUANDO o Docker Compose for iniciado, O SISTEMA DEVE subir PostgreSQL, MinIO e Mailpit com volumes persistentes locais.
- [x] **CA-02**: SE faltar variável obrigatória ou houver valor inválido, ENTÃO O SISTEMA DEVE encerrar na inicialização com log `Error` listando todas as falhas.
- [x] **CA-03**: QUANDO o backend iniciar, O SISTEMA DEVE aplicar as migrações pendentes, criando o schema se necessário, antes de aceitar requisições HTTP.
- [x] **CA-04**: SE uma migração falhar, ENTÃO O SISTEMA NÃO DEVE iniciar o servidor HTTP.
- [x] **CA-05**: QUANDO uma requisição for atendida, O SISTEMA DEVE devolver `X-Request-ID` e incluir o mesmo ID em todo log emitido durante ela.
- [x] **CA-06**: ONDE `APP_ENV=production`, O SISTEMA DEVE emitir logs em JSON, um evento por linha; caso contrário, em formato legível de console.
- [x] **CA-07**: QUANDO um handler registrar um erro mapeado, O SISTEMA DEVE responder no formato RFC 7807 com o status e o `type` correspondentes.
- [x] **CA-08**: SE ocorrer erro não mapeado ou pânico, ENTÃO O SISTEMA DEVE responder 500 RFC 7807 sem detalhes internos e registrar o detalhe uma única vez no log.
- [x] **CA-09**: QUANDO uma entidade com o modelo base for criada sem `id`, O SISTEMA DEVE atribuir um UUIDv7.
- [x] **CA-10**: SE uma função executada no gerenciador de transação retornar erro, ENTÃO O SISTEMA DEVE desfazer todas as gravações feitas por todos os repositories dentro dela.
- [x] **CA-11**: QUANDO todas as dependências estiverem disponíveis, O SISTEMA DEVE responder `GET /api/v1/health` com 200 e `HEALTHY`.
- [x] **CA-12**: SE o MinIO ou o SMTP estiver indisponível com o PostgreSQL disponível, ENTÃO O SISTEMA DEVE responder 200 com `DEGRADED` e o componente marcado `UNHEALTHY`.
- [x] **CA-13**: SE o PostgreSQL estiver indisponível, ENTÃO O SISTEMA DEVE responder 503 RFC 7807 `service-unavailable`.
- [x] **CA-14**: QUANDO um e-mail for enfileirado no despachante, O SISTEMA DEVE entregá-lo ao SMTP configurado (visível no Mailpit em desenvolvimento).
- [x] **CA-15**: QUANDO o processo receber SIGTERM, O SISTEMA DEVE concluir as requisições em andamento dentro de `SHUTDOWN_TIMEOUT`, drenar a fila de e-mails, fechar o banco e descarregar os logs antes de sair.
- [x] **CA-16**: QUANDO o backend iniciar, O SISTEMA DEVE garantir a existência do bucket MinIO configurado.
- [x] **CA-17**: QUANDO o navegador chamar qualquer caminho `/api/*` no endereço do frontend, O SISTEMA DEVE encaminhar a chamada ao backend sem requisição de origem cruzada.
- [x] **CA-18**: SE algum arquivo de estilo além de `_tokens.scss` contiver cor literal, ENTÃO a verificação do Stylelint DEVE falhar.
- [x] **CA-19**: QUANDO a página for aberta, O SISTEMA DEVE aplicar o tema salvo ou, sem preferência salva, o do sistema operacional, antes da primeira pintura.
- [x] **CA-20**: QUANDO o usuário alternar o tema, O SISTEMA DEVE trocar todos os tokens sem recarregar a página e lembrar a escolha.
- [x] **CA-21**: QUANDO o cliente HTTP receber resposta `application/problem+json` ou sofrer falha de rede, O SISTEMA DEVE entregar um erro tipado ao chamador, sem quebrar a renderização.

## 8. Plano de Testes (Test Plan)

**Backend** (`go test`; integração com `testcontainers-go`)

- Configuração: variáveis ausentes e inválidas, todas listadas de uma vez (CA-02).
- Migrações contra PostgreSQL real: banco vazio cria o schema; segunda execução não faz nada; migração quebrada impede a subida (CA-03, CA-04).
- Middleware de correlation ID: com `X-Request-ID` válido, com valor inválido e sem cabeçalho; logs capturados com observador do Zap (CA-05).
- Formato do logger por `APP_ENV` (CA-06).
- Middleware de erros: erro mapeado de cada construtor, erro não mapeado e pânico (CA-07, CA-08).
- Modelo base: `id` gerado é UUIDv7 e IDs consecutivos são ordenáveis (CA-09).
- Gerenciador de transação: dois repositories gravando e falha no fim, sem nada persistido (CA-10).
- Health check com dependências substituídas por implementações de teste: todas ok; MinIO fora; SMTP fora; PostgreSQL fora (CA-11 a CA-13).
- Despachante de e-mail com SMTP de teste: entrega, nova tentativa e falha final (CA-14).
- Encerramento: requisição lenta em andamento termina antes da saída (CA-15).

**Frontend** (Vitest e Testing Library)

- Cliente HTTP: sucesso, erro RFC 7807, erro sem `problem+json` e falha de rede (CA-21).
- Script de tema: preferência salva, ausência de preferência e armazenamento indisponível (CA-19).
- Alternador de tema atualizando `data-theme` e salvando a escolha (CA-20).
- Stylelint executado sobre um arquivo de teste com cor literal, que deve falhar (CA-18).

**Manual**

- Docker Compose subindo os três serviços e interface do Mailpit acessível (CA-01, CA-14).
- Página inicial no navegador mostrando o health check pela origem do frontend, sem aviso de CORS no console (CA-17).
- Inspeção visual dos dois temas na página inicial (CA-20).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md` (inclusive a seção 3.10 de logs) e `specs/GLOSSARY.md`.
2. **Ordem:** Docker Compose e `.env.example` → `config` → `logger` → `problem` → `database` e migrações → `storage` → `mailer` → `server`, middlewares e health check → `main` com encerramento gracioso → projeto Next.js → tokens e mixins → script de tema e layout → cliente HTTP → página inicial → Stylelint e ESLint.
3. **Arquivos e diretórios a criar:**
   - `docker-compose.yml`, `.env.example`
   - `backend/go.mod`, `backend/cmd/api/main.go`
   - `backend/migrations/` (primeira migração: criação do schema)
   - `backend/internal/platform/config/`
   - `backend/internal/platform/logger/`
   - `backend/internal/platform/problem/`
   - `backend/internal/platform/database/` (conexão, modelo base, gerenciador de transação, execução das migrações)
   - `backend/internal/platform/storage/`
   - `backend/internal/platform/mailer/`
   - `backend/internal/platform/server/` (roteador, encerramento gracioso)
   - `backend/internal/platform/server/middleware/` (correlation ID, log de requisição, erros, recuperação)
   - `backend/internal/platform/health/` (verificações e handler)
   - `frontend/package.json`, `frontend/next.config.ts`, `frontend/tsconfig.json`, configurações do ESLint e do Stylelint
   - `frontend/src/styles/_tokens.scss`, `_mixins.scss`, `globals.scss`
   - `frontend/src/services/` (cliente HTTP e serviço de health)
   - `frontend/src/messages/` (textos em português)
   - `frontend/src/components/ThemeToggle/` (componente e `.module.scss`)
   - `frontend/src/app/layout.tsx`, `frontend/src/app/page.tsx`
   - atualização do `README.md` da raiz com o passo a passo para subir o ambiente
4. **Definição de pronto:** CA-01 a CA-21 verificados, testes da seção 8 passando, ESLint e Stylelint sem erros, suíte do `legacy/` ainda passando.

## 10. Pendências para aprovação

Nenhuma. As pendências P-01 a P-11 foram aprovadas pelo Tech Lead em 08/10/2026 e incorporadas ao corpo (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação (duas versões) |
| 08/10/2026 | Implementador (Claude) | Conversão para o template, com pedido do Tech Lead de preencher a seção 10 com recomendações. Arquivo renomeado (sem `spec-`); referências às outras specs por ID; critérios numerados e ampliados de 10 para 21; seção 10 original ("nenhuma pendência") substituída pelas pendências P-01 a P-11; acrescentados `config`, `storage`, `mailer`, `health`, migrações, encerramento gracioso, variáveis de ambiente, dependências autorizadas, script de tema, arquivo de mensagens e Stylelint |
| 08/10/2026 | Tech Lead | Aprovação integral das recomendações: P-01 goose; P-02 construtores 400, 401, 403, 404, 409, 410, 413, 429, 500 e 503; P-03 regra 503 × `DEGRADED`; P-04 sem `system_health_checks`; P-05 fila de e-mail em memória; P-06 `platform/config`; P-07 encerramento gracioso e pacote `problem`; P-08 `testcontainers-go`, Vitest, Testing Library, ESLint e Stylelint; P-09 tema salvo ou do sistema antes da primeira pintura; P-10 versões estáveis mais recentes (Go 1.27, Next.js 16); P-11 schema `linux_lab`. Status: `Aprovada` |
| 08/10/2026 | Implementador (Claude) | Implementação concluída; status `Implementada`. Verificado: `go test ./...` (unitários e integração com PostgreSQL via testcontainers), Vitest (19 testes), ESLint, Stylelint, `tsc`, `next build`, teste ponta a ponta pelo IP da máquina e inspeção visual dos dois temas no navegador. **Desvios:** (1) o schema é criado pelo executor de migrações antes do goose, porque a tabela de versões do goose fica dentro dele; a migração 00001 é só a linha de base; (2) MinIO indisponível na subida não impede o início: o erro é registrado e o serviço sobe `DEGRADED`, coerente com a RN-12; (3) a pedido do Tech Lead, o ambiente usa o IP da máquina em vez de `localhost`: Next.js escuta em `0.0.0.0` e foram acrescentadas as variáveis `FRONTEND_ALLOWED_DEV_ORIGINS`, `MINIO_API_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT` e `MAILPIT_UI_HOST_PORT`; (4) portas de host padrão alteradas no `.env.example` (5440, 9100/9101, 1125, 8125; frontend em 3010) porque as portas usuais estavam ocupadas por outro projeto na máquina; (5) o `next.config.ts` carrega o `.env` da raiz com `@next/env`, dependência interna do próprio Next.js; (6) TypeScript 6 e ESLint 9 em vez das versões mais recentes, por compatibilidade de dependências; (7) arquivos além da lista da seção 9: componente `HealthStatus`, `src/theme/theme.ts`, módulos SCSS do layout e da página e configurações do Vitest; (8) o teste real de SMTP (CA-14) só roda quando `SMTP_TEST_HOST` e `SMTP_TEST_PORT` estão definidas; (9) o detector de condições de corrida (`go test -race`) não foi executado: a máquina não tem `gcc`. |
