# SPEC-003: Autenticação, Usuários, Sessões e Trilha de Auditoria

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-003 |
| **Status** | Rascunho |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `user`, `auth` |
| **Contexto de tela** | `/login`, `/forgot-password`, `/reset-password`, `/change-password`, `/app/profile/security` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (Fundação) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seção 3.1 (`Usuario`), seção 6.3 item 2 (mutex de sessão) e seção 8.2 (inativação e derrubada de sessão) |

> **Ordem de implementação aprovada:** SPEC-004 (Fundação) → **SPEC-003** → SPEC-005 (Turmas) → SPEC-002 (Alunos).
> Esta spec só pode ser aprovada depois que as pendências da seção 10 forem resolvidas.

---

## 1. Contexto e Problema (Context & Problem Statement)

O laboratório é compartilhado entre turnos, o que favorece credenciais esquecidas abertas e o uso da conta de um estudante pelo seguinte. Sem defesa, a recuperação de acesso fica exposta a varreduras automatizadas, força bruta e negação de serviço.

Avaliações práticas formais também exigem proteção contra resolução paralela (*proxy exam*), em que uma pessoa de fora usa a mesma conta ao mesmo tempo. Sem controle de inatividade, teto de duração, derrubada de sessões concorrentes e trilha de auditoria indelével, a plataforma fica vulnerável a fraude e não consegue embasar deliberações disciplinares perante a coordenação.

Esta spec também define a entidade canônica de **usuário** (`users`), base de todos os módulos seguintes.

## 2. Objetivos (Goals)

- Definir a entidade canônica `users`, com identidade, papel, status e hash de senha na própria tabela.
- Criar na inicialização a conta de administrador padrão, com troca de senha obrigatória no primeiro acesso.
- Autenticar por e-mail ou por RA (normalizado para 7 dígitos), com uma única senha.
- Armazenar senhas com função de derivação de chave nativa em Go, sem dependência de Keycloak.
- Gerenciar sessões opacas em cookie `HttpOnly`, `Secure` e `SameSite=Strict`, nunca legíveis por script.
- Expirar a sessão por inatividade de 1 hora (janela deslizante) e encerrá-la de forma compulsória 5 horas após a emissão.
- Limitar a taxa de requisições nas rotas públicas de login e recuperação.
- Recuperar o acesso por link enviado por e-mail, com token de uso único válido por 1 hora.
- Oferecer a operação interna "revogar as demais sessões do usuário", que a futura spec de tentativa de prova vai acionar.
- Registrar em trilha de auditoria append-only todos os eventos de autenticação e credenciais.

### 2.1. Fora de escopo (Non-Goals)

- **Acionar a revogação no início da prova** e notificar os terminais derrubados via WebSocket. Depende da entidade `Attempt` e do hub WebSocket, que terão specs próprias. Esta spec entrega só a operação de revogação.
- Perfil do estudante (RA complementar, WhatsApp, Discord, avatar): SPEC-002.
- Cadastro de usuários por docentes (manual, CSV, convite): SPEC-002.
- Autenticação federada (Keycloak, OAuth, SSO).
- Autenticação multifator.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Login (`/login`):** campo único de identificador (e-mail, ou RA com ou sem o prefixo "a"), senha com alternância de visibilidade e link para recuperação. Bloqueado por limite de taxa, exibe contagem regressiva até a liberação.
- **Solicitação de recuperação (`/forgot-password`):** pede e-mail ou RA. Depois do envio, mostra sempre a mesma mensagem neutra, exista a conta ou não, para não permitir enumeração.
- **Redefinição (`/reset-password`):** lê o token do parâmetro de busca, valida a política de senha durante a digitação e impede reenvio depois do sucesso.
- **Troca obrigatória de senha (`/change-password`):** enquanto o usuário tiver troca de senha pendente, toda navegação autenticada redireciona para esta tela.
- **Segurança do perfil (`/app/profile/security`):** troca voluntária de senha. *(Conteúdo restante: ver pendência P-08.)*
- **Sessão expirada:** quando um serviço recebe o erro de sessão expirada, o estado global de autenticação é limpo e o usuário vai para `/login`, com aviso do motivo (inatividade ou teto de 5 horas).
- **Camada de serviços:** toda chamada fica em `frontend/src/services/`. Nenhum componente lê ou manipula o cookie de sessão.
- **Estilo:** SCSS Modules em co-location e somente tokens de `_tokens.scss`, com paridade entre tema claro e escuro (`ARCHITECTURE.md`, seção 4).

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulos `backend/internal/modules/user/` e `backend/internal/modules/auth/`, cada um com `domain`, `service`, `repository` e `handler`. O limitador de taxa e o middleware de autenticação ficam em `backend/internal/platform/`.

Regras de negócio:

- **RN-01 (normalização do RA):** remover espaços nas pontas e um único prefixo "a" ou "A" opcional. O restante DEVE ter exatamente 7 dígitos; qualquer outro formato é inválido. Um identificador com "@" é tratado como e-mail; os demais, como RA.
- **RN-02 (e-mail):** normalizado para minúsculas antes de gravar e antes de consultar.
- **RN-03 (seed do administrador):** na inicialização, se não existir usuário com o e-mail `admin@rmo.dev.br` (padrão confirmado pelo Tech Lead, configurável por `ADMIN_EMAIL`), cria um usuário com papel `ADMIN`, status `ACTIVE` e `must_change_password` verdadeiro. A senha provisória vem de variável de ambiente (P-01). Se o usuário já existir, nada muda, nem a senha.
- **RN-04 (verificação de senha):** a comparação do hash é feita em tempo constante. Quando o usuário não existe, o service ainda executa uma verificação de hash fictícia, para que o tempo de resposta não revele quais contas existem.
- **RN-05 (status da conta):** só contas `ACTIVE` autenticam. As contas `INACTIVE` e `SUSPENDED` recebem o mesmo erro genérico de credenciais inválidas; o motivo real vai só para a auditoria.
- **RN-06 (emissão de sessão):** o servidor gera um token opaco aleatório com 256 bits de entropia, grava apenas o seu hash SHA-256 em `auth_sessions` e envia o token puro no cookie. A expiração absoluta é a emissão mais 5 horas.
- **RN-07 (validação de sessão):** a cada requisição autenticada, o middleware localiza a sessão pelo hash do token. Se a última atividade tiver mais de 1 hora, a sessão é encerrada como `EXPIRED_IDLE`; se passou da expiração absoluta, como `EXPIRED_ABSOLUTE`. Nos dois casos a resposta é 401. Se a sessão estiver válida, a última atividade é atualizada.
- **RN-08 (troca obrigatória):** enquanto `must_change_password` for verdadeiro, toda rota autenticada responde 403 `password-change-required`, exceto `GET /auth/me`, `POST /auth/change-password` e `POST /auth/logout`.
- **RN-09 (limite de taxa):** aplicado antes de qualquer consulta ao banco ou operação criptográfica, por IP e por identificador normalizado, em janela deslizante. Os limites estão na pendência P-04.
- **RN-10 (recuperação):** gera um token de uso único com 256 bits de entropia, grava apenas o hash, com validade de 1 hora, e entrega o envio do e-mail ao despachante assíncrono (P-05). Identificador inexistente produz a mesma resposta 202 e nenhum e-mail.
- **RN-11 (redefinição):** em uma única transação, troca o hash da senha, marca o token como usado, zera `must_change_password` e revoga todas as sessões ativas do usuário como `REVOKED_PASSWORD_RESET`.
- **RN-12 (revogação concorrente):** operação interna do service, sem endpoint, que revoga todas as sessões ativas do usuário, exceto uma sessão informada, como `REVOKED_CONCURRENCY`, e registra auditoria. Quem aciona é uma spec futura.
- **RN-13 (auditoria):** todo evento listado no enum de `security_audit_logs` é gravado com IP, User-Agent, identificador informado e horário do servidor. A gravação não bloqueia a resposta, mas uma falha ao gravar gera log de erro e nunca é ignorada em silêncio.
- **RN-14 (política de senha):** ver pendência P-03.

## 4. Modelo de Dados (Data Model)

Schema PostgreSQL definido na SPEC-004. Chaves UUIDv7 geradas em hook do GORM.

### 4.1. `users` (módulo `user`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `name` | texto | Não | | Nome completo; pode faltar em contas importadas (P-06) |
| `email` | texto | Sim | único entre os registros não excluídos; minúsculas | RN-02 |
| `academic_id` | texto (7) | Não | único entre os registros não excluídos; apenas dígitos | RA normalizado (RN-01). Nulo para quem não é estudante (P-02) |
| `password_hash` | texto | Não | | Hash em formato autodescritivo (algoritmo, parâmetros e salt na própria string). Nulo = conta ainda sem senha definida (P-07) |
| `role` | enum | Sim | `ADMIN`, `TEACHER`, `STUDENT` | |
| `status` | enum | Sim | `ACTIVE`, `INACTIVE`, `SUSPENDED`; padrão `ACTIVE` | Semântica de cada valor: P-09 |
| `must_change_password` | booleano | Sim | padrão falso | RN-08 |
| `created_at`, `updated_at` | timestamp | Sim | | |
| `deleted_at` | timestamp | Não | soft delete | |

### 4.2. `auth_sessions` (módulo `auth`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `user_id` | UUID | Sim | FK → `users.id` | |
| `token_hash` | texto | Sim | único, indexado | SHA-256 do token opaco (RN-06). O token puro nunca é gravado |
| `ip_address` | texto | Sim | | IPv4 ou IPv6 |
| `user_agent` | texto | Sim | | |
| `status` | enum | Sim | `ACTIVE`, `EXPIRED_IDLE`, `EXPIRED_ABSOLUTE`, `REVOKED_LOGOUT`, `REVOKED_CONCURRENCY`, `REVOKED_PASSWORD_RESET` | |
| `last_activity_at` | timestamp | Sim | | RN-07 |
| `expires_at` | timestamp | Sim | | Emissão + 5 h |
| `created_at` | timestamp | Sim | | |
| `revoked_at` | timestamp | Não | | Preenchido em qualquer status diferente de `ACTIVE` |

Índice composto (`user_id`, `status`).

### 4.3. `password_reset_tokens` (módulo `auth`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `user_id` | UUID | Sim | FK → `users.id` | |
| `token_hash` | texto | Sim | único, indexado | SHA-256 do token |
| `expires_at` | timestamp | Sim | | Criação + 1 h |
| `used_at` | timestamp | Não | | Nulo = não usado |
| `created_at` | timestamp | Sim | | |

### 4.4. `security_audit_logs` (módulo `auth`)

Append-only: sem atualização e sem exclusão, nem lógica. É a exceção, justificada, à regra de `updated_at` e soft delete do `ARCHITECTURE.md`.

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `user_id` | UUID | Não | FK → `users.id` | Nulo quando o identificador não corresponde a nenhum usuário |
| `event_type` | enum | Sim | ver lista abaixo | |
| `attempted_identifier` | texto | Não | | Identificador como foi informado |
| `ip_address` | texto | Sim | | |
| `user_agent` | texto | Sim | | |
| `metadata` | JSONB | Não | | Detalhes do evento; nunca contém senha nem token |
| `occurred_at` | timestamp | Sim | | Horário do servidor |

Índices: (`user_id`, `occurred_at`) e (`event_type`, `occurred_at`).

Valores de `event_type`: `LOGIN_SUCCEEDED`, `LOGIN_FAILED_WRONG_PASSWORD`, `LOGIN_FAILED_UNKNOWN_USER`, `LOGIN_FAILED_ACCOUNT_NOT_ACTIVE`, `LOGIN_BLOCKED_RATE_LIMIT`, `LOGOUT`, `SESSION_EXPIRED_IDLE`, `SESSION_EXPIRED_ABSOLUTE`, `SESSION_REVOKED_CONCURRENCY`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`, `ADMIN_SEEDED`.

## 5. Contrato de API (API Contract)

Todo erro segue a RFC 7807 (`ARCHITECTURE.md`, seção 3.5). O cookie de sessão tem nome definido na SPEC-004 e os atributos `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`.

### 5.1. `POST /api/v1/auth/login`

Autentica e emite o cookie de sessão. **Público.**

| Campo (corpo) | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `identifier` | texto | Sim | E-mail, ou RA no formato de RN-01 |
| `password` | texto | Sim | Não vazio |

**200 OK**, com `Set-Cookie` da sessão:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `userId` | UUID | Sim | |
| `name` | texto | Não | |
| `role` | enum | Sim | `ADMIN`, `TEACHER` ou `STUDENT` |
| `mustChangePassword` | booleano | Sim | RN-08 |
| `sessionExpiresAt` | timestamp ISO 8601 | Sim | Teto absoluto |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Campo ausente ou identificador em formato inválido |
| 401 | `invalid-credentials` | Usuário inexistente, senha errada ou conta não `ACTIVE` (mensagem idêntica nos três casos) |
| 429 | `rate-limited` | Limite excedido; corpo com `retryAfterSeconds` e cabeçalho `Retry-After` |

### 5.2. `POST /api/v1/auth/logout`

Encerra a sessão atual. **Autenticado.** Sem corpo.

**204 No Content**, com `Set-Cookie` que expira o cookie.

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Sessão ausente, expirada ou revogada |

### 5.3. `POST /api/v1/auth/forgot-password`

Pede o link de redefinição. **Público.**

| Campo (corpo) | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `identifier` | texto | Sim | E-mail ou RA |

**202 Accepted**, com resposta idêntica exista a conta ou não:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `message` | texto | Sim | Mensagem neutra |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Identificador ausente ou em formato inválido |
| 429 | `rate-limited` | Limite excedido |

### 5.4. `POST /api/v1/auth/reset-password`

Consome o token e define a nova senha. **Público.**

| Campo (corpo) | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `token` | texto | Sim | Token recebido por e-mail |
| `newPassword` | texto | Sim | Política de senha (RN-14) |

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `sessionsRevoked` | inteiro | Sim | Quantidade de sessões revogadas (RN-11) |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Campo ausente |
| 400 | `weak-password` | Senha fora da política; corpo lista as regras violadas |
| 410 | `reset-token-invalid` | Token inexistente, expirado ou já usado (sem distinguir o caso) |

### 5.5. `POST /api/v1/auth/change-password`

Troca a senha do usuário autenticado; obrigatória quando `mustChangePassword` é verdadeiro. **Autenticado.**

| Campo (corpo) | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `currentPassword` | texto | Sim | Senha atual |
| `newPassword` | texto | Sim | Política de senha; diferente da atual |

**204 No Content.** Zera `must_change_password`, revoga as demais sessões do usuário e grava `PASSWORD_CHANGED`.

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `weak-password` | Fora da política ou igual à atual |
| 401 | `invalid-credentials` | Senha atual incorreta |
| 401 | `not-authenticated` | Sessão inválida |

### 5.6. `GET /api/v1/auth/me`

Estado da sessão e do usuário. Renova a janela de inatividade. **Autenticado.**

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `userId` | UUID | Sim | |
| `email` | texto | Sim | |
| `name` | texto | Não | |
| `role` | enum | Sim | |
| `status` | enum | Sim | |
| `mustChangePassword` | booleano | Sim | |
| `sessionCreatedAt` | timestamp | Sim | |
| `sessionExpiresAt` | timestamp | Sim | Teto absoluto |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 401 | `session-expired` | Expirada por inatividade ou pelo teto; corpo indica `reason` (`IDLE` ou `ABSOLUTE`) |
| 401 | `not-authenticated` | Sem sessão ou sessão revogada |

## 6. Impacto e Riscos (Impact & Risks)

- **Sessão esquecida aberta em máquina compartilhada.**
  *Mitigação:* inatividade de 1 hora e teto absoluto de 5 horas, verificados no servidor (RN-07).
- **Força bruta e esgotamento de recursos.**
  *Mitigação:* limite de taxa por IP e por identificador antes de qualquer acesso ao banco ou operação criptográfica (RN-09).
- **Enumeração de contas.**
  *Mitigação:* resposta e tempo idênticos para usuário inexistente, senha errada e conta inativa (RN-04, RN-05); recuperação sempre com 202.
- **Vazamento do banco expondo sessões e tokens.**
  *Mitigação:* apenas hashes SHA-256 de tokens são gravados (RN-06, RN-10).
- **Senha padrão do administrador conhecida.**
  *Mitigação:* troca obrigatória no primeiro acesso (RN-08) e senha vinda de variável de ambiente (P-01).
- **Crescimento da tabela de auditoria.**
  *Mitigação:* tabela append-only com índices por usuário, tipo e horário; gravação fora do caminho crítico da resposta.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01**: QUANDO a aplicação iniciar sem usuário com o e-mail de administrador configurado, O SISTEMA DEVE criar esse usuário com papel `ADMIN`, status `ACTIVE` e `must_change_password` verdadeiro.
- [ ] **CA-02**: QUANDO a aplicação iniciar e o administrador já existir, O SISTEMA NÃO DEVE alterar nenhum dado dele.
- [ ] **CA-03**: QUANDO o usuário informar e-mail, ou RA com prefixo "a", "A" ou sem prefixo, junto com a senha correta, O SISTEMA DEVE autenticar e emitir cookie com `HttpOnly`, `Secure` e `SameSite=Strict`.
- [ ] **CA-04**: SE o RA informado, depois de normalizado, não tiver exatamente 7 dígitos, ENTÃO O SISTEMA DEVE responder 400 `validation-error`.
- [ ] **CA-05**: SE o usuário não existir, a senha estiver errada ou a conta não estiver `ACTIVE`, ENTÃO O SISTEMA DEVE responder 401 `invalid-credentials` com corpo idêntico nos três casos e registrar o evento específico na auditoria.
- [ ] **CA-06**: ENQUANTO `must_change_password` for verdadeiro, O SISTEMA DEVE responder 403 `password-change-required` a toda rota autenticada, exceto `me`, `change-password` e `logout`.
- [ ] **CA-07**: SE a última atividade da sessão tiver mais de 1 hora, ENTÃO O SISTEMA DEVE encerrar a sessão como `EXPIRED_IDLE` e responder 401 `session-expired`.
- [ ] **CA-08**: SE a sessão tiver mais de 5 horas desde a emissão, ENTÃO O SISTEMA DEVE encerrá-la como `EXPIRED_ABSOLUTE` e responder 401, mesmo com atividade recente.
- [ ] **CA-09**: SE as requisições a login ou recuperação excederem o limite na janela, ENTÃO O SISTEMA DEVE responder 429 `rate-limited` com `Retry-After`, sem consultar o banco.
- [ ] **CA-10**: QUANDO a recuperação for pedida com identificador existente, O SISTEMA DEVE gerar token válido por 1 hora e enfileirar o e-mail; QUANDO o identificador não existir, O SISTEMA DEVE responder com o mesmo 202 sem enviar e-mail.
- [ ] **CA-11**: QUANDO a redefinição usar token válido, O SISTEMA DEVE, em uma única transação, trocar a senha, marcar o token como usado, zerar `must_change_password` e revogar todas as sessões ativas do usuário.
- [ ] **CA-12**: SE o token de redefinição estiver expirado, já usado ou não existir, ENTÃO O SISTEMA DEVE responder 410 `reset-token-invalid`.
- [ ] **CA-13**: QUANDO a operação de revogação concorrente for acionada, O SISTEMA DEVE revogar todas as sessões ativas do usuário, exceto a informada, como `REVOKED_CONCURRENCY`.
- [ ] **CA-14**: QUANDO ocorrer qualquer evento listado em `security_audit_logs`, O SISTEMA DEVE gravar um registro com IP, User-Agent, identificador informado e horário do servidor.
- [ ] **CA-15**: O SISTEMA NÃO DEVE gravar token de sessão nem de redefinição em texto puro.
- [ ] **CA-16**: QUANDO as telas desta spec forem exibidas em tema claro ou escuro, O SISTEMA DEVE usar apenas tokens de `_tokens.scss`, sem cores fixas.

## 8. Plano de Testes (Test Plan)

**Backend**

- Normalização de RA: `a1234567`, `A1234567`, `1234567` resultam no mesmo valor; `123456`, `a12345678`, `12-34567` e `aa1234567` são inválidos (CA-03, CA-04).
- Seed executado duas vezes: uma única criação, sem alteração na segunda (CA-01, CA-02).
- Login com usuário inexistente, senha errada e conta `SUSPENDED`: corpos de resposta iguais e eventos distintos na auditoria (CA-05, CA-14).
- Middleware de sessão com relógio controlado: 61 minutos sem atividade e 5 h 01 min desde a emissão com atividade recente (CA-07, CA-08).
- Rajada contra o login até receber 429, verificando que o repository não foi chamado (CA-09).
- Redefinição com falha simulada no meio da transação: nada muda (CA-11). Token expirado e token reutilizado (CA-12).
- Revogação concorrente com três sessões ativas (CA-13).
- Inspeção do banco depois de login e recuperação: nenhum token em texto puro (CA-15).
- Troca obrigatória: rota protegida com 403 antes da troca e liberada depois (CA-06).

**Frontend**

- Login, recuperação, redefinição e troca obrigatória nos dois temas (CA-16).
- Resposta 429: contagem regressiva visível e botão desabilitado (CA-09).
- Sessão expirada: estado limpo e redirecionamento para `/login` com o motivo (CA-07, CA-08).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e a SPEC-004 implementada.
2. **Ordem:** domain → repository → service → handler e middlewares do backend; depois serviços → hooks → componentes → páginas do frontend.
3. **Diretórios a criar ou alterar:**
   - `backend/internal/modules/user/` (`domain`, `service`, `repository`, `handler`)
   - `backend/internal/modules/auth/` (`domain`, `service`, `repository`, `handler`)
   - `backend/internal/platform/` (middleware de autenticação, limitador de taxa, seed do administrador)
   - migrações das tabelas da seção 4, no mecanismo definido pela SPEC-004
   - `frontend/src/services/` (serviço de autenticação)
   - `frontend/src/app/login/`, `forgot-password/`, `reset-password/`, `change-password/`
   - componentes `LoginForm`, `ForgotPasswordForm`, `ResetPasswordForm` e `ChangePasswordForm`, cada um com seu `.module.scss`
4. **Definição de pronto:** CA-01 a CA-16 verificados e testes da seção 8 passando.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | O e-mail padrão do administrador, `admin@rmo.dev.br`, foi **confirmado** pelo Tech Lead em 08/10/2026. Falta decidir a senha provisória: gravá-la literal num repositório público permite que alguém entre antes do dono em um ambiente recém-implantado. | Senha provisória lida de `ADMIN_INITIAL_PASSWORD`; valor de exemplo só no `.env.example` de desenvolvimento; em produção, sem a variável, a aplicação não sobe. |
| P-02 | RA em `users.academic_id` ou em `student_profiles` (versão original da SPEC-002). O login por RA é desta spec, que vem antes da SPEC-002; no perfil do estudante, o módulo `auth` dependeria de um módulo que ainda não existe. | Manter em `users.academic_id` (nulo para quem não é estudante). |
| P-03 | A política de senha não está definida. | Mínimo de 10 e máximo de 128 caracteres, diferente do e-mail e do RA, sem regras de composição obrigatórias (alinhado ao NIST SP 800-63B). |
| P-04 | Os limites de taxa não estão definidos. | Login: 5 falhas por identificador a cada 15 min e 20 requisições por IP por minuto. Recuperação: 3 por identificador por hora. |
| P-05 | O envio de e-mail exige um despachante assíncrono e um servidor SMTP, que nenhuma spec define. | Incluir na SPEC-004 a interface de envio e um SMTP de desenvolvimento (ex.: Mailpit) no Docker Compose. **Já endereçado na SPEC-004 (RN-11, P-05).** |
| P-06 | A decisão unificou o nome em `name`, mas a SPEC-002 usa nome e sobrenome separados (formulário e colunas do CSV). | Manter `name`; a SPEC-002 passa a receber `name` (no CSV, coluna `name`). |
| P-07 | Contas criadas por docente ou por CSV (SPEC-002) não têm senha. O fluxo de ativação não está definido. | `password_hash` nulo até a ativação; a ativação reutiliza o mecanismo de token desta spec, com validade maior, definida na SPEC-002. |
| P-08 | O que a tela `/app/profile/security` exibe além da troca de senha (ex.: lista de sessões ativas e encerramento remoto). | Só troca de senha nesta spec; lista de sessões numa spec futura. |
| P-09 | Diferença entre `INACTIVE` e `SUSPENDED`: o documento canônico só tem `ATIVO` e `INATIVO`. | `INACTIVE`: desligamento administrativo permanente. `SUSPENDED`: bloqueio temporário e reversível. Ou eliminar `SUSPENDED`. |
| P-10 | Algoritmo de hash: PBKDF2-HMAC-SHA256 ou Argon2id. | Argon2id (`golang.org/x/crypto/argon2`, Go puro), com parâmetros da OWASP. |
| P-11 | Topologia BFF: como o Next.js e a API Go compartilham a origem para o cookie `SameSite=Strict`. | Definir na SPEC-004: o Next.js encaminha `/api/*` para o Go na mesma origem. **Já endereçado na SPEC-004 (`rewrites`, CA-17).** |
| P-12 | O ambiente de desenvolvimento é acessado pelo IP da máquina por HTTP (decisão do Tech Lead em 08/10/2026). Navegadores só tratam `localhost` como contexto seguro; em `http://192.168.3.111`, cookies com o atributo `Secure` são descartados, e o login não funcionaria. | Atributo `Secure` controlado por configuração: ligado em produção (HTTPS obrigatório) e desligado só com `APP_ENV=development`. Alternativa: HTTPS local com certificado autoassinado. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação |
| 08/10/2026 | Implementador (Claude) | Conversão para o template. Aplicadas as decisões do Tech Lead: estrutura `internal/modules` + `internal/platform`; enums em inglês `UPPER_SNAKE_CASE`; `password_hash` em `users`; RA de 7 dígitos; hash nativo em Go sem Keycloak. Mudanças de redação para revisão: tabela `users` e seed do administrador trazidos da SPEC-002; `user_credentials` removida; acionamento da revogação no início da prova e WebSocket movidos para fora de escopo; tokens gravados só como hash; endpoint `change-password`, status `REVOKED_PASSWORD_RESET` e eventos `LOGIN_FAILED_ACCOUNT_NOT_ACTIVE`, `PASSWORD_CHANGED` e `ADMIN_SEEDED` acrescentados; booleano de uso do token substituído por `used_at`; pendências registradas na seção 10 |
