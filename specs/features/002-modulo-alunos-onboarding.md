# SPEC-002: Módulo de Alunos e Mecanismos de Onboarding

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-002 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `student` |
| **Contexto de tela** | `/app/students`, `/app/classes/[id]/students`, `/invite/[token]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (Fundação), SPEC-003 (Autenticação e Usuários), SPEC-009 (CRUD de Turmas e Gestão Acadêmica) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seção 3.1 (`InscricaoTurma`) e seção 4.2 (gestão de turmas e onboarding discente) |

> **Ordem de implementação aprovada:** SPEC-004 → SPEC-003 → SPEC-009 → **SPEC-002**.
> Pendências da seção 10 resolvidas e spec formalmente aprovada pelo Tech Lead.

---

## 1. Contexto e Problema (Context & Problem Statement)

A plataforma não tem estrutura unificada para cadastrar, gerenciar e receber estudantes. Sem perfis persistidos, não há acompanhamento individual nem as regras de avaliação prática previstas.

O ingresso precisa acompanhar a dinâmica real da sala de aula e das listas institucionais. Sem importação de CSV, sem link de convite por turma e sem cadastro individual, o trabalho da docente antes das aulas fica pesado. Além disso, o RA da UTFPR é digitado ora com o prefixo "a", ora só com dígitos, o que gera duplicidade e falha de login se não houver normalização determinística. Sem esta estrutura, não há matrícula em turma, consulta de notas nem auditoria de integridade.

## 2. Objetivos (Goals)

- Criar estudantes por três vias: importação de CSV, autocadastro por link de convite da turma e cadastro manual pela docente.
- Permitir criar um estudante sem turma, com aviso explícito na interface.
- Aplicar a normalização de RA da SPEC-003 (RN-01) em toda entrada: cadastro manual, CSV, convite e busca.
- No CSV, exigir só e-mail e RA; o nome é opcional.
- Manter o estudante que entrou por convite fora das atividades restritas da turma até a moderação da docente, com acesso geral à plataforma liberado na hora.
- Registrar dados complementares do perfil (WhatsApp e Discord) e permitir que o próprio estudante, e só ele, troque o avatar, convertido para AVIF e guardado no MinIO.
- Enviar de forma assíncrona os e-mails de boas-vindas e de ativação da conta.

### 2.1. Fora de escopo (Non-Goals)

- Entidade `users`, login, senha e seed do administrador: SPEC-003.
- Cadastro e configuração de turmas e geração do link de convite: SPEC-007.
- Remanejamento entre turmas e trancamento.
- Edição dos dados do estudante pela docente depois do cadastro.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Gestão geral de estudantes (`/app/students`):** lista paginada, filtro por texto (nome, e-mail ou RA), botão de cadastro manual e botão de importação. Cadastro feito nesta tela mostra um banner de alerta: o estudante fica sem turma até ser associado.
- **Modal de cadastro manual:** nome, e-mail, RA, WhatsApp e Discord. O RA aceita digitação com ou sem "a"; a máscara é removida antes do envio.
- **Modal de importação de CSV:** área de arrastar e soltar, validação de formato antes do envio, indicação de progresso e relatório final com as linhas processadas e as ignoradas, cada uma com o motivo.
- **Estudantes da turma (`/app/classes/[id]/students`):** lista da turma, seção de moderação dos ingressos pendentes (aprovar e rejeitar) e componente de compartilhamento do link de convite.
- **Autocadastro por convite (`/invite/[token]`):** página pública que lê o token da URL. O estudante informa nome, e-mail, RA, senha e, se quiser, WhatsApp e Discord. Ao concluir, vê que a conta foi criada e que o acesso à turma aguarda a aprovação da docente.
- **Serviços e hooks:** chamadas em `frontend/src/services/`; estado de listas e mutações em hook dedicado.
- **Estilo:** SCSS Modules em co-location e somente tokens de `_tokens.scss`, com paridade entre temas claro e escuro.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo `backend/internal/modules/student/` (`domain`, `service`, `repository`, `handler`). O usuário é criado pela interface pública do service do módulo `user` (SPEC-003); a turma é consultada pela interface pública do módulo de turmas (SPEC-007). Nenhum repository de outro módulo é acessado diretamente.

Regras de negócio:

- **RN-01 (RA):** toda entrada de RA passa pela normalização da SPEC-003 (RN-01): exatamente 7 dígitos depois de descartar o prefixo "a" ou "A" opcional.
- **RN-02 (unicidade):** e-mail e RA são únicos entre todos os usuários. Duplicidade no cadastro manual ou no convite gera 409.
- **RN-03 (cadastro manual):** cria o usuário com papel `STUDENT` e sem senha, além do perfil. Se houver turma, a matrícula nasce `ACTIVE`; sem turma, não há matrícula e é gravado um evento de auditoria. O e-mail de ativação é enfileirado (P-02).
- **RN-04 (CSV):** leitura em streaming, delimitador vírgula ou ponto e vírgula, cabeçalhos obrigatórios `email` e `academic_id` e opcional `name`. Por linha:
  - linha inválida (e-mail ou RA ausente ou malformado): descartada e reportada, sem interromper o lote;
  - estudante inédito: cria o usuário e o perfil, matricula se houver turma e enfileira o e-mail de ativação;
  - estudante existente com e-mail e RA coerentes: não é recriado; é matriculado se houver turma e ainda não estiver matriculado, e é enfileirado o aviso de inclusão na turma;
  - e-mail e RA que apontam para usuários diferentes: descartada como conflito (P-05).
- **RN-05 (convite):** valida o token do convite pelo módulo de turmas, cria o usuário com papel `STUDENT`, status `ACTIVE` e a senha informada (política da SPEC-003), cria o perfil e cria a matrícula `PENDING_MODERATION`, tudo em uma transação.
- **RN-06 (acesso restrito):** só a matrícula `ACTIVE` dá acesso a materiais, atividades e provas da turma. A verificação fica no service de cada recurso, nunca só na interface.
- **RN-07 (moderação):** a docente responsável pela turma aprova (`PENDING_MODERATION` → `ACTIVE`) ou rejeita (`PENDING_MODERATION` → `REJECTED`, com motivo obrigatório), registrando quem decidiu e quando.
- **RN-08 (avatar):** só o próprio estudante autenticado. Aceita JPEG, PNG e WEBP; valida tamanho e dimensões, converte para AVIF com biblioteca Go sem cgo, grava no MinIO e salva só a chave do objeto no perfil.
- **RN-09 (transações):** criação de usuário + perfil + matrícula é atômica. No CSV, cada linha é uma unidade atômica; uma falha de infraestrutura interrompe o lote e devolve o relatório parcial (P-05).
- **RN-10 (erros):** duplicidade, CSV malformado, limite de upload e validação são convertidos para RFC 7807 pelo pacote central.

## 4. Modelo de Dados (Data Model)

A tabela `users`, com `academic_id`, é definida na SPEC-003.

### 4.1. `student_profiles`

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `user_id` | UUID | Sim | FK → `users.id`, único | Um perfil por usuário |
| `whatsapp` | texto | Não | | |
| `discord` | texto | Não | | |
| `avatar_object_key` | texto | Não | | Chave do objeto AVIF no MinIO; a URL é montada na leitura |
| `created_at`, `updated_at` | timestamp | Sim | | |
| `deleted_at` | timestamp | Não | soft delete | |

### 4.2. `class_enrollments`

A tabela de matrículas (`class_enrollments`) foi consolidada e provisionada na SPEC-009 (`backend/migrations/00003_create_class_tables.sql`) no módulo `classgroup`, e é consumida pelo módulo `student` para vinculação direta e consulta de turmas.

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `class_id` | UUID | Sim | FK → `classes.id` | Turma de vínculo |
| `user_id` | UUID | Sim | FK → `users.id` | Estudante associado |
| `status` | enum | Sim | `PENDING_MODERATION`, `ACTIVE`, `REJECTED`, `TRANSFERRED`, `UNENROLLED` | Situação da matrícula |
| `origin` | enum | Sim | `INVITE_LINK`, `CSV_IMPORT`, `DIRECT_BY_TEACHER` | Rastreabilidade do ingresso |
| `rejection_reason` | texto | Não | | Motivo obrigatório em `REJECTED` |
| `requested_at` | timestamp | Sim | | Data da solicitação |
| `decided_at` | timestamp | Não | | Data da aprovação ou rejeição |
| `created_at`, `updated_at` | timestamp | Sim | | |
| `deleted_at` | timestamp | Não | soft delete | |

Unicidade composta (`class_id`, `user_id`) entre os registros não excluídos.

## 5. Contrato de API (API Contract)

### 5.1. `POST /api/v1/students`

Cadastro manual. **Papéis:** `TEACHER`, `ADMIN`.

| Campo (corpo) | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `academicId` | texto | Sim | RN-01 |
| `email` | texto | Sim | E-mail válido |
| `name` | texto | Não | |
| `whatsapp` | texto | Não | |
| `discord` | texto | Não | |
| `classGroupId` | UUID | Não | Ausente = estudante sem turma |

**201 Created:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | ID do usuário |
| `academicId` | texto | Sim | Normalizado |
| `email` | texto | Sim | |
| `enrollmentStatus` | enum | Sim | `ACTIVE` ou `NOT_ENROLLED` |
| `createdAt` | timestamp | Sim | |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Campo ausente, e-mail inválido ou RA fora da RN-01 |
| 404 | `class-group-not-found` | `classGroupId` inexistente |
| 409 | `email-already-registered` | E-mail já usado |
| 409 | `academic-id-already-registered` | RA já usado |

### 5.2. `POST /api/v1/students/import-csv`

Importação em lote. **Papéis:** `TEACHER`, `ADMIN`. Corpo `multipart/form-data`.

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `file` | arquivo | Sim | CSV conforme RN-04; tamanho máximo em P-06 |
| `classGroupId` | UUID | Não | Turma de destino |

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `totalRows` | inteiro | Sim | Linhas de dados lidas |
| `created` | inteiro | Sim | Estudantes novos |
| `enrolled` | inteiro | Sim | Matrículas criadas |
| `alreadyEnrolled` | inteiro | Sim | Já matriculados na turma |
| `errors` | lista de { `line`: inteiro, `reason`: texto } | Sim | Vazia se não houver descarte |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `csv-invalid` | Arquivo vazio, formato não CSV ou sem os cabeçalhos obrigatórios |
| 404 | `class-group-not-found` | Turma inexistente |
| 413 | `file-too-large` | Acima do limite |

### 5.3. `POST /api/v1/invites/{token}/join`

Autocadastro por convite. **Público**, com limite de taxa (P-07).

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `token` (rota) | texto | Sim | Token do link de convite da turma |
| `academicId` | texto | Sim | RN-01 |
| `email` | texto | Sim | |
| `name` | texto | Sim | |
| `password` | texto | Sim | Política de senha da SPEC-003 |
| `whatsapp` | texto | Não | |
| `discord` | texto | Não | |

**201 Created:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `userId` | UUID | Sim | |
| `accountStatus` | enum | Sim | Sempre `ACTIVE` |
| `enrollmentStatus` | enum | Sim | Sempre `PENDING_MODERATION` |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` / `weak-password` | Campos inválidos ou senha fora da política |
| 404 | `invite-not-found` | Token inexistente, expirado ou de turma inativa |
| 409 | `email-already-registered` / `academic-id-already-registered` | Duplicidade |
| 429 | `rate-limited` | Limite excedido |

### 5.4. `PATCH /api/v1/students/me/avatar`

Troca do avatar do próprio estudante. **Papel:** `STUDENT`. Corpo `multipart/form-data`.

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `avatar` | arquivo | Sim | JPEG, PNG ou WEBP; limites em P-06 |

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `avatarUrl` | texto | Sim | URL do AVIF gravado |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `unsupported-image` | Formato não aceito ou imagem corrompida |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Papel diferente de `STUDENT` |
| 413 | `file-too-large` | Acima do limite |

### 5.5. `GET /api/v1/students`

Listagem e busca geral de estudantes. **Papéis:** `TEACHER`, `ADMIN`.

| Parâmetro (query) | Tipo | Obrigatório | Descrição |
| :--- | :--- | :--- | :--- |
| `page` | inteiro | Não | Página atual (padrão 1) |
| `perPage` | inteiro | Não | Itens por página (padrão 20, máx 100) |
| `search` | texto | Não | Termo de busca parcial em `name`, `email` ou `academicId` |

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `items` | lista de objetos | Sim | Coleção de estudantes |
| `items[].id` | UUID | Sim | Identificador do usuário |
| `items[].academicId` | texto | Sim | RA normalizado |
| `items[].email` | texto | Sim | E-mail do estudante |
| `items[].name` | texto | Sim | Nome completo |
| `items[].whatsapp` | texto | Não | Telefone/WhatsApp |
| `items[].discord` | texto | Não | Tag Discord |
| `items[].avatarUrl` | texto | Não | URL do avatar |
| `items[].totalClassesEnrolled` | inteiro | Sim | Quantidade de turmas vinculadas |
| `items[].createdAt` | timestamp | Sim | Data de cadastro |
| `totalCount` | inteiro | Sim | Contagem total de estudantes |
| `page` | inteiro | Sim | Página retornada |
| `perPage` | inteiro | Sim | Tamanho de página |

### 5.6. `GET /api/v1/students/me`

Consulta do perfil pessoal do estudante autenticado. **Papel:** `STUDENT`.

**200 OK:**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | Identificador do usuário |
| `academicId` | texto | Sim | RA do estudante |
| `email` | texto | Sim | E-mail |
| `name` | texto | Sim | Nome |
| `whatsapp` | texto | Não | WhatsApp |
| `discord` | texto | Não | Discord |
| `avatarUrl` | texto | Não | URL do avatar |
| `createdAt` | timestamp | Sim | Data de cadastro |

---

## 6. Impacto e Riscos (Impact & Risks)

- **Duplicidade por variação de RA.**
  *Mitigação:* normalização obrigatória antes de qualquer verificação ou gravação (RN-01).
- **Importação grande estourando o tempo da requisição.**
  *Mitigação:* leitura em streaming e uma transação por linha (RN-04, RN-09).
- **Acesso indevido a conteúdo da turma antes da moderação.**
  *Mitigação:* a matrícula `ACTIVE` é verificada no service de cada recurso restrito (RN-06).
- **Abuso do endpoint público de convite.**
  *Mitigação:* limite de taxa e token de convite vinculado à turma ativa.
- **Imagens maliciosas ou enormes.**
  *Mitigação:* limite de tamanho antes da leitura, validação estrita de mime type e recodificação em biblioteca Go puro sem cgo.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: QUANDO a docente cadastrar um estudante sem turma, O SISTEMA DEVE criá-lo e a interface DEVE exibir o aviso de estudante sem turma.
- [x] **CA-02**: QUANDO qualquer cadastro ou busca receber RA com "a", "A" ou sem prefixo, O SISTEMA DEVE tratar todas as formas como o mesmo RA de 7 dígitos.
- [x] **CA-03**: SE o e-mail ou o RA já existir no cadastro manual ou no convite, ENTÃO O SISTEMA DEVE responder 409 com o `type` correspondente.
- [x] **CA-04**: QUANDO a docente importar um CSV só com as colunas `email` e `academic_id` válidas, O SISTEMA DEVE processar todas as linhas, sem exigir nome.
- [x] **CA-05**: QUANDO o CSV trouxer estudante já cadastrado, O SISTEMA NÃO DEVE recriá-lo, DEVE matriculá-lo na turma informada se ainda não estiver matriculado e DEVE contabilizá-lo no relatório.
- [x] **CA-06**: SE uma linha do CSV for inválida, ENTÃO O SISTEMA DEVE descartá-la, reportar número e motivo e continuar o lote.
- [x] **CA-07**: QUANDO um estudante se cadastrar por convite, O SISTEMA DEVE criar a conta `ACTIVE` e a matrícula `PENDING_MODERATION`.
- [x] **CA-08**: ENQUANTO a matrícula não estiver `ACTIVE`, O SISTEMA NÃO DEVE dar acesso a materiais, atividades ou provas da turma.
- [x] **CA-09**: QUANDO a docente abrir os estudantes da turma, O SISTEMA DEVE listar as matrículas pendentes e permitir aprovar ou rejeitar (com motivo obrigatório na rejeição).
- [x] **CA-10**: QUANDO o estudante enviar imagem JPEG, PNG ou WEBP dentro dos limites, O SISTEMA DEVE processá-la, gravá-la no MinIO e associá-la ao perfil.
- [x] **CA-11**: SE quem envia o avatar não for `STUDENT`, ENTÃO O SISTEMA DEVE responder 403.
- [x] **CA-12**: QUANDO as telas desta spec forem exibidas em tema claro ou escuro, O SISTEMA DEVE usar apenas tokens de `_tokens.scss`, sem cores fixas.

## 8. Plano de Testes (Test Plan)

**Backend**

- Cadastro manual com e sem turma; duplicidade de e-mail e de RA, incluindo `a1234567` contra `1234567` (CA-01 a CA-03).
- CSV: só colunas obrigatórias; delimitadores vírgula e ponto e vírgula; linhas inválidas misturadas com válidas; estudante existente já matriculado e não matriculado; e-mail e RA de usuários diferentes (CA-04 a CA-06).
- CSV com falha de infraestrutura simulada no meio do lote: as linhas anteriores permanecem e o relatório parcial é devolvido (RN-09).
- Convite com token válido, inválido e de turma inativa; transação revertida se a criação da matrícula falhar (CA-07).
- Recurso restrito da turma acessado com matrícula pendente e com matrícula ativa (CA-08).
- Avatar: formatos aceitos, formato com extensão falsa, arquivo acima do limite e papel `TEACHER` (CA-10, CA-11).

**Frontend**

- Cadastro sem turma exibindo o aviso (CA-01).
- Importação de CSV sem coluna de nome, com relatório exibido (CA-04, CA-06).
- Fluxo completo do convite até a mensagem de moderação pendente (CA-07).
- Moderação de estudantes da turma com aprovação e rejeição (CA-09).
- Tabelas, modais e formulários nos dois temas (CA-12).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, SPEC-003 e SPEC-009 implementadas.
2. **Ordem:** domain → repository → service → handler no backend; serviços → hooks → componentes → páginas no frontend.
3. **Diretórios a criar ou alterar:**
   - `backend/internal/modules/student/` (`domain`, `service`, `repository`, `handler`)
   - `backend/internal/platform/storage/` (upload e recuperação de URLs públicas/assinadas)
   - migrações das tabelas da seção 4 (`student_profiles`)
   - `frontend/src/services/` (`studentService.ts`) e `frontend/src/hooks/` (`useStudents.ts`)
   - componentes `StudentList`, `StudentFormModal`, `StudentImportCsvModal`, `StudentAvatarUpload`, cada um com seu `.module.scss`
   - páginas `frontend/src/app/app/students/`, `frontend/src/app/app/classes/[id]/students/` e `frontend/src/app/invite/[token]/`
4. **Definição de pronto:** CA-01 a CA-12 verificados e testes da seção 8 passando com cobertura > 80%.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| - | Nenhuma pendência em aberto. | Spec pronta e aprovada para implementação. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação |
| 08/10/2026 | Implementador (Claude) | Conversão para o template e alinhamento de pendências P-01 a P-10 |
| 08/10/2026 | Tech Lead (Ricardo Martins de Oliveira) | Resolução de pendências, inclusão de contratos formais de listagem e perfil e aprovação canônica |
| 08/10/2026 | Implementador (Antigravity) | Implementação completa do backend e frontend com testes automatizados (>80% cobertura) e validação de todos os critérios de aceite (CA-01 a CA-12) |
