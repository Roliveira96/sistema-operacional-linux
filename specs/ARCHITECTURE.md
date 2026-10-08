# Arquitetura: Regras Mandatórias

Regras técnicas obrigatórias para todo código de `backend/` e `frontend/`. Uma spec pode detalhar estas regras, mas nunca contrariá-las. Para mudar uma regra, primeiro se altera este documento, com aprovação do Tech Lead.

Palavras normativas: **DEVE** / **NÃO DEVE** são obrigatórias; **RECOMENDADO** admite exceção justificada na spec.

---

## 1. Topologia do monorepo

| Diretório | Responsabilidade |
| :--- | :--- |
| `backend/` | Serviço único em Go (monólito modular): API REST, hub WebSocket, correção no servidor, persistência |
| `frontend/` | Aplicação Next.js (interface de docentes e estudantes) |
| `legacy/` | Simulador client-side original, preservado e executável. O motor POSIX/VFS será reaproveitado pelo frontend conforme spec própria |
| `specs/` | Governança Spec-Driven Development |
| `docs/` | Fontes canônicas (arquitetura da transição e monografia) |

- Branch única de desenvolvimento: `projeto-tcc2`.
- `backend/` e `frontend/` têm dependências independentes. Nenhum dos dois importa código do outro nem de `legacy/` por caminho relativo. O compartilhamento de código entre eles exige spec dedicada.

## 2. Princípios gerais

- **A correção de avaliações roda exclusivamente no servidor.** O cliente envia estado (snapshot do VFS e log de comandos) e nunca decide a nota.
- **O servidor é a fonte da verdade de tempo.** Prazos, cronômetros e janelas são calculados com o relógio do servidor.
- **Segurança por padrão:** toda rota exige autenticação, exceto as declaradas públicas na spec. Toda rota declara os papéis autorizados.
- **Rastreabilidade:** ações docentes sobre notas e sessões de prova (bloquear, encerrar, anular, reabrir, homologar) geram registro de auditoria com autor, momento e justificativa.

## 3. Backend (Go)

### 3.1. Stack

| Item | Escolha |
| :--- | :--- |
| Linguagem | Go 1.27 (versão estável mais recente; atualizar junto com o `go.mod`) |
| HTTP | Gin-Gonic |
| ORM | GORM |
| Banco | PostgreSQL, schema `linux_lab` |
| Migrações | goose, versionadas em `backend/migrations/` (`AutoMigrate` proibido) |
| Tempo real | Hub WebSocket próprio |
| Logs | Zap (`go.uber.org/zap`), logger da Uber |
| Identificadores | UUIDv7, gerado em hook de ciclo de vida do GORM (antes da criação) |

### 3.2. Organização: Clean Architecture + Modular Monolith + DDD-lite

- Cada **módulo de domínio** (ex.: `user`, `auth`, `student`, `classgroup`, `assessment`, `attempt`) fica em `backend/internal/modules/<modulo>/`, com suas camadas internas em subpacotes:
  - **domain**: entidades, objetos de valor, enumerações e erros de domínio. Sem dependência de Gin, GORM ou HTTP.
  - **service**: toda a lógica de negócio. Depende apenas de interfaces.
  - **repository**: acesso a dados via GORM, implementando as interfaces que o service declara.
  - **handler**: transporte HTTP/WebSocket.
- Um módulo **NÃO DEVE** acessar o repository de outro módulo. A comunicação entre módulos se dá pela interface pública de service do outro módulo.
- Infraestrutura transversal (configuração, conexão com banco, erros RFC 7807, middlewares globais, logger, armazenamento de objetos, envio de e-mail, hub WebSocket) fica em `backend/internal/platform/`, nunca dentro de um módulo.
- **NÃO DEVE** haver diretórios de camada técnica na raiz de `internal/` (como `internal/domain`, `internal/infrastructure` ou `internal/delivery`). A organização é sempre por módulo.
- O ponto de entrada (composition root) faz toda a injeção de dependência explicitamente.

### 3.3. Responsabilidades por camada

| Camada | DEVE | NÃO DEVE |
| :--- | :--- | :--- |
| Handler | Extrair parâmetros, validar sintaxe, chamar o service, serializar a resposta, traduzir erros de domínio para RFC 7807 | Conter regra de negócio ou acessar repository |
| Service | Aplicar regras de negócio (RN-xx da spec), orquestrar transações, autorização em nível de recurso | Conhecer Gin, HTTP ou detalhes de SQL |
| Repository | Persistir e consultar via GORM | Decidir regra de negócio |

### 3.4. Regras de código

- **Inversão de dependência:** interfaces declaradas no pacote que as **consome** (o service declara a interface do repository de que precisa).
- **NÃO DEVE** haver variáveis globais mutáveis nem estado compartilhado fora da injeção de dependência.
- O `context.Context` é propagado da requisição até o repository em todas as chamadas.
- Erros são encapsulados com contexto e nunca ignorados silenciosamente.
- Logs estruturados, sem dados sensíveis (senhas, hashes, tokens). Regras detalhadas na seção 3.10.

### 3.5. Erros: RFC 7807 (Problem Details)

- Toda resposta de erro segue RFC 7807, emitida por um pacote interno central.
- Campos: `type` (slug estável do problema), `title`, `status`, `detail` e `instance`; erros de validação acrescentam a lista de campos inválidos.
- Cada spec lista, por endpoint, os `type` possíveis e o código HTTP correspondente.
- Um middleware de recuperação converte pânicos em erro 500 RFC 7807, sem expor stack trace.

### 3.6. Transações

- Mutações que envolvem mais de um registro ou tabela **DEVEM** ser atômicas.
- A transação é aberta no service e propagada via contexto para os repositories (padrão de propagação de contexto transacional). O repository usa a transação do contexto quando ela existe.

### 3.7. Persistência

- Chave primária UUIDv7 em todas as entidades.
- Nomes de tabelas e colunas em inglês, `snake_case`, conforme `GLOSSARY.md`.
- Exclusão lógica (soft delete do GORM) para entidades com valor acadêmico ou forense (usuários, matrículas, avaliações, tentativas, submissões, eventos de auditoria). A exclusão física exige justificativa na spec.
- Campos de auditoria `created_at` e `updated_at` em todas as entidades.
- Enumerações persistidas como texto, com valores em inglês e `UPPER_SNAKE_CASE`.

### 3.8. HTTP e autorização

- Prefixo de rotas: `/api/v1`. Recursos no plural e em inglês, em `kebab-case`.
- Middlewares obrigatórios: recuperação de falhas, autenticação e autorização por papel (RBAC: `ADMIN`, `TEACHER`, `STUDENT`).

### 3.9. Tempo real (WebSocket)

- Hub concorrente central, com rotinas de leitura e escrita **separadas por conexão**.
- Eventos nomeados como `domain:action` (ex.: `help:request`, `session:reopened`).
- Toda mensagem recebida do cliente é validada como entrada não confiável.

### 3.10. Logs (Zap)

- Logger único: `*zap.Logger` do Zap, com os níveis `Debug`, `Info`, `Warn` e `Error`.
- O logger **DEVE** ser injetado por dependência (construtor de handler, service, repository e middleware), criado uma vez no composition root e configurado em `backend/internal/platform/`.
- **NÃO DEVE** haver logger global: proibidos `zap.L()`, `zap.S()`, `zap.ReplaceGlobals`, o pacote `log` da biblioteca padrão e `fmt.Print*` para logs.
- Usar o `zap.Logger` tipado, com campos estruturados (`zap.String`, `zap.Error`, etc.). O `SugaredLogger` não é usado.
- Formato por ambiente: JSON em uma linha por evento em produção (próprio para agregadores como AWS CloudWatch); saída legível em console no desenvolvimento.
- O nível mínimo vem de configuração (`debug` em desenvolvimento, `info` em produção), sem precisar recompilar.
- Cada requisição HTTP ganha um logger filho com o ID da requisição (correlation ID), que segue por contexto até o repository. Os eventos de WebSocket também carregam o ID da conexão.
- Uso dos níveis:
  - `Debug`: detalhes de diagnóstico, desligados em produção;
  - `Info`: eventos de negócio e de ciclo de vida (subida do serviço, migração aplicada);
  - `Warn`: situação anômala que se recupera sozinha (limite de taxa atingido, nova tentativa);
  - `Error`: falha que exige atenção, sempre com o campo `zap.Error(err)`.
- Um erro é registrado **uma única vez**, na borda (handler ou middleware), e não a cada camada que o repassa.
- Mensagens de log em inglês, como todo o código.

## 4. Frontend (Next.js)

### 4.1. Stack

| Item | Escolha |
| :--- | :--- |
| Framework | Next.js 16 com App Router |
| Linguagem | TypeScript em modo estrito |
| Estilo | SCSS Modules |

### 4.2. Estilização

- **Co-location:** cada componente fica no mesmo diretório que seu módulo de estilo.
- **NÃO DEVE** haver frameworks ou classes utilitárias externas (ex.: Tailwind, Bootstrap).
- **NÃO DEVE** haver cor com valor fixo em nenhuma folha de estilo de componente. Cores, espaçamentos, raios, sombras e tipografia vêm de **design tokens semânticos**.
- Tokens centralizados em `frontend/src/styles/_tokens.scss`, exclusivamente como CSS Custom Properties.
- Mixins e funções compartilhadas em `frontend/src/styles/_mixins.scss`.
- **Paridade de temas obrigatória:** todo token tem valor para o tema claro e para o escuro. O tema escuro se aplica exclusivamente por redefinição dos valores dos tokens sob o seletor de tema escuro no elemento raiz. Componentes nunca testam o tema.
- Toda tela é verificada nos dois temas antes de ser considerada pronta.

### 4.3. Acesso a rede

- Toda chamada REST e toda conexão WebSocket fica em `frontend/src/services/`.
- Componentes visuais **NÃO DEVEM** chamar APIs nem abrir conexões diretamente.
- Erros RFC 7807 são interpretados na camada de serviços e entregues aos componentes em formato tipado.

### 4.4. Textos e acessibilidade

- Texto de interface em português, centralizado em arquivos de mensagens.
- Contraste mínimo WCAG AA nos dois temas e navegação completa por teclado nas telas de prova.

## 5. Testes

- Cada critério de aceite de uma spec é coberto por pelo menos um teste automatizado ou por um roteiro manual descrito na própria spec.
- Ferramentas: `go test` no backend, com `testcontainers-go` para integração com PostgreSQL real; Vitest e Testing Library no frontend.
- Verificação estática obrigatória no frontend: ESLint e Stylelint. O Stylelint proíbe cores literais em qualquer arquivo de estilo, exceto `_tokens.scss`.
- Backend: testes de unidade de services, com repositories substituídos por implementações de teste das interfaces, e testes de integração de repositories contra PostgreSQL real.
- A suíte do `legacy/` (Vitest) **DEVE** continuar passando enquanto o diretório existir.

## 6. Decisões em aberto

Itens ainda não decididos. Spec que dependa de algum deles precisa decidi-lo primeiro, com aprovação do Tech Lead:

- Mecanismo de autenticação: a SPEC-003 (Rascunho) propõe sessão opaca em cookie `HttpOnly` gravada no banco, em vez do JWT citado no documento canônico.
- Estratégia de reaproveitamento do motor POSIX/VFS de `legacy/` pelo frontend e pelo corretor do servidor.
