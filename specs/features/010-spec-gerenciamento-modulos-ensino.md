# SPEC-010: Gerenciamento de Módulos de Ensino, Visibilidade e Trilha Pedagógica

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-010 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `coursemodule` |
| **Contexto de tela** | `/app/modules`, `/app/modules/new`, `/app/modules/:id/edit`, `/app/modules/:id`, `/materials` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-003, SPEC-004, SPEC-009 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` |

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o conteúdo instrucional da plataforma encontra-se estático e disperso, carecendo de uma entidade agregadora de primeiro nível que organize as trilhas de aprendizagem em unidades pedagógicas coesas. O corpo docente não dispõe de autonomia administrativa para agrupar materiais de estudo, configurar exercícios práticos ordenados e disponibilizar conteúdos segmentados para públicos distintos.

Essa limitação impede a aplicação direcionada de módulos tanto em eventos institucionais temporários (como semanas acadêmicas, feiras de inovação e oficinas tecnológicas) quanto na dinâmica semestral de turmas regulares. A ausência de regras granulares de visibilidade (público irrestrito, institucional autenticado ou privado por turma), combinada com a falta de ativação temporal automatizada (janelas de vigência com data/hora de início e término) e contadores consolidados de itens didáticos nas listagens, sobrecarrega a supervisão docente e prejudica a experiência de navegação dos acadêmicos.

---

## 2. Objetivos (Goals)

* Permitir o ciclo de vida completo (criação, leitura, atualização, desativação e arquivamento) de módulos de ensino sob responsabilidade exclusiva de docentes e administradores.
* Implementar regras de visibilidade suportando três modalidades: público geral (acessível a qualquer visitante, mesmo não autenticado, suprindo a rota pública de materiais), público autenticado e estritamente privado vinculado a uma ou mais turmas específicas.
* Prover controle de vigência temporal delimitado por data/hora de início e data/hora de término, assegurando que o módulo torne-se automaticamente inacessível a discentes e visitantes assim que o período expirar ou quando o status manual for marcado como inativo.
* Permitir a ordenação sequencial obrigatória dos exercícios e atividades vinculados ao módulo, garantindo que o discente avance respeitando a esteira pedagógica definida pelo docente.
* Exibir, nas listagens administrativas e visões de catálogo, os contadores agregados e consolidados da quantidade de materiais instrucionais e de exercícios/atividades associados ao módulo.
* Garantir a segregação de permissões via RBAC: discentes possuem apenas permissão de visualização e execução de módulos aos quais tenham acesso autorizado; docentes e administradores detêm autoridade sobre o gerenciamento e vinculação às suas turmas.

### 2.1. Fora de escopo (Non-Goals)

* Execução de código em sandbox e correção automatizada em tempo real (escopo de módulo avaliativo futuro).
* Upload direto de grandes arquivos binários ou vídeos pesados (materiais didáticos suportam links externos e referências textuais nesta fase).
* Criação, alteração ou moderação de turmas acadêmicas (atribuído exclusivamente à SPEC-009).

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A interface do usuário disponibiliza a visão administrativa docente e o catálogo discente/público:

* **Painel Administrativo de Módulos (`/app/modules`):**
  * Grid responsivo de cards exibindo os módulos sob governança do docente. Cada card expõe título, descrição sumária, badge de visibilidade (`Público`, `Autenticado` ou `Privado`), contadores agregados (total de materiais e total de exercícios), indicador de vigência temporal (em andamento, futuro ou expirado) e comutador rápido de status ativo/inativo.
  * Alerta visual quando o módulo estiver expirado ou desativado.

* **Formulário de Criação e Edição (`/app/modules/new` e `/app/modules/:id/edit`):**
  * Seção básica: título do módulo, descrição detalhada e seleção da modalidade de visibilidade (`PUBLIC`, `AUTHENTICATED`, `PRIVATE`).
  * Seção de vinculação contextual: quando a visibilidade for definida como privada, habilita seleção múltipla das turmas gerenciadas pelo docente.
  * Seção de vigência temporal: seletores com validação para data/hora de início e data/hora de término da ativação.
  * Seção de organização de trilha: lista interativa com suporte a reordenação (mover para cima/baixo) para fixar a sequência ordinal de execução dos exercícios práticos.

* **Visualização Pública de Materiais (`/materials` e `/materials/:id`):**
  * Rota acessível sem sessão obrigatória, renderizando exclusivamente os módulos com visibilidade pública geral cujo período de vigência temporal esteja em curso e cujo status manual esteja estritamente ativo.

* **Camada de Serviços e Hooks:**
  * Serviço tipado em `frontend/src/services/moduleService.ts`.
  * Componentes modulares sob SCSS Modules (`ModuleCard`, `ModuleForm`, `ExerciseOrderList`), garantindo uso estrito de tokens semânticos de `_tokens.scss` e compatibilidade total com modo claro e escuro.

### 3.2. Backend (Go — Camada de Módulo/Service)

A retaguarda implementa o domínio sob arquitetura modular no pacote `coursemodule`:

* **Regras de Negócio:**
  * **RN-01 (Autoria e Autorização):** Apenas usuários com papel `TEACHER` ou `ADMIN` podem criar, editar, desativar ou reordenar módulos. Docentes só podem gerenciar módulos criados por eles mesmos.
  * **RN-02 (Modalidades de Visibilidade):** Três modos são suportados: `PUBLIC` (acesso irrestrito), `AUTHENTICATED` (qualquer usuário autenticado) e `PRIVATE` (restrito a turmas associadas). Módulos privados exigem ao menos uma turma associada pertencente ao docente.
  * **RN-03 (Vigência Temporal):** O intervalo deve respeitar `activationStart <= activationEnd`. Quando o horário atual do servidor for anterior ao início ou posterior ao término, o módulo é considerado expirado/inativo para estudantes e visitantes, retornando HTTP 403 em acessos discentes.
  * **RN-04 (Status Manual Prevalente):** O status manual (`ACTIVE`, `INACTIVE`, `ARCHIVED`) sobrepõe-se à vigência. Módulos inativos ou arquivados tornam-se inacessíveis para estudantes e público imediatamente.
  * **RN-05 (Isolamento Discente em Módulos Privados):** Estudantes só podem acessar módulos privados se possuírem matrícula ativa (`ACTIVE`) em ao menos uma das turmas vinculadas ao módulo.
  * **RN-06 (Atomicidade na Reordenação):** A reordenação sequencial dos exercícios do módulo é processada em bloco transacional atômico (`.WithinTransaction`), prevenindo duplicidade de índices ordinais.
  * **RN-07 (Contadores Agregados Otimizados):** As consultas de listagem e detalhamento agregam os contadores de materiais didáticos e itens de exercícios através de queries SQL otimizadas.

---

## 4. Modelo de Dados (Data Model)

### 4.1. Tabela `course_modules`

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | Chave primária | Identificador único UUIDv7 |
| `teacher_id` | `uuid` | Sim | FK `users(id)` | Docente autor e proprietário do módulo |
| `title` | `text` | Sim | Não vazio | Título do módulo de ensino |
| `description` | `text` | Sim | Não vazio | Descrição e ementa pedagógica |
| `visibility` | `text` | Sim | `CHECK (visibility IN ('PUBLIC', 'AUTHENTICATED', 'PRIVATE'))` | Modalidade de visibilidade |
| `status` | `text` | Sim | `CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))` | Status operacional manual (padrão: `ACTIVE`) |
| `activation_start` | `timestamptz` | Não | Opcional | Início da janela de vigência temporal |
| `activation_end` | `timestamptz` | Não | Opcional | Término da janela de vigência temporal |
| `created_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de criação |
| `updated_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de última alteração |
| `deleted_at` | `timestamptz` | Não | Suporte a soft delete | Carimbo de exclusão lógica |

Constraints de tabela:
* `course_modules_date_range`: `CHECK (activation_start IS NULL OR activation_end IS NULL OR activation_start <= activation_end)`

Índices:
* `course_modules_teacher_idx`: `(teacher_id, status) WHERE deleted_at IS NULL`
* `course_modules_public_visibility_idx`: `(visibility, status, activation_start, activation_end) WHERE deleted_at IS NULL`
* `course_modules_deleted_at_idx`: `(deleted_at)`

---

### 4.2. Tabela `module_class_assignments`

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | Chave primária | Identificador único UUIDv7 |
| `module_id` | `uuid` | Sim | FK `course_modules(id) ON DELETE CASCADE` | Módulo privado associado |
| `class_id` | `uuid` | Sim | FK `classes(id) ON DELETE CASCADE` | Turma acadêmica autorizada |
| `assigned_by` | `uuid` | Sim | FK `users(id)` | Docente que formalizou a associação |
| `created_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de vinculação |

Índices e unicidade:
* `module_class_unique`: Único `(module_id, class_id)`
* `module_class_class_idx`: `(class_id)`

---

### 4.3. Tabela `module_exercise_items`

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | Chave primária | Identificador único UUIDv7 |
| `module_id` | `uuid` | Sim | FK `course_modules(id) ON DELETE CASCADE` | Módulo proprietário do item |
| `exercise_id` | `uuid` | Sim | Não nulo | Identificador da questão/exercício prático |
| `sequence_order` | `integer` | Sim | `>= 1` | Posição ordinal na trilha de aprendizagem |
| `is_mandatory` | `boolean` | Sim | Padrão `true` | Exigência de progressão sequencial linear |
| `created_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de inclusão |
| `updated_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de alteração |

Índices e unicidade:
* `module_exercise_unique`: Único `(module_id, exercise_id)`
* `module_exercise_order_unique`: Único `(module_id, sequence_order)`

---

### 4.4. Tabela `module_materials`

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | Chave primária | Identificador único UUIDv7 |
| `module_id` | `uuid` | Sim | FK `course_modules(id) ON DELETE CASCADE` | Módulo ao qual o material pertence |
| `title` | `text` | Sim | Não vazio | Título do recurso didático |
| `description` | `text` | Não | Opcional | Descrição do material |
| `url` | `text` | Sim | Não vazio | Link de acesso ou referência ao material |
| `created_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de criação |
| `updated_at` | `timestamptz` | Sim | Preenchido automaticamente | Carimbo de alteração |
| `deleted_at` | `timestamptz` | Não | Suporte a soft delete | Carimbo de exclusão lógica |

Índices:
* `module_materials_module_idx`: `(module_id) WHERE deleted_at IS NULL`

---

## 5. Contrato de API (API Contract)

### 5.1. `GET /api/v1/modules/public`
Catálogo público de módulos para visitantes não autenticados e rota institucional de materiais.

* **Papéis autorizados:** Qualquer usuário (inclusive anônimo/não autenticado).
* **Parâmetros de query:**

| Nome | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `page` | `integer` | Não | Padrão 1 |
| `limit` | `integer` | Não | Padrão 10, máximo 50 |
| `search` | `string` | Não | Termo de busca textual no título/descrição |

* **Resposta de sucesso (HTTP 200 OK):**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `items` | `array` | Sim | Lista de módulos com contadores consolidados e vigência |
| `total` | `integer` | Sim | Total de registros correspondentes |
| `page` | `integer` | Sim | Página atual |
| `limit` | `integer` | Sim | Limite por página |

* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 500 | `internal_server_error` | Falha inesperada ao consultar base de dados |

---

### 5.2. `GET /api/v1/modules`
Listagem de módulos acessíveis ao usuário autenticado (visão docente administrativa ou visão discente autorizada).

* **Papéis autorizados:** `TEACHER`, `ADMIN`, `STUDENT`.
* **Parâmetros de query:**

| Nome | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `page` | `integer` | Não | Padrão 1 |
| `limit` | `integer` | Não | Padrão 10, máximo 50 |
| `status` | `string` | Não | Filtro por status (`ACTIVE`, `INACTIVE`, `ARCHIVED`) |
| `visibility` | `string` | Não | Filtro por visibilidade (`PUBLIC`, `AUTHENTICATED`, `PRIVATE`) |
| `classId` | `uuid` | Não | Filtro de módulos atribuídos a uma turma específica |

* **Resposta de sucesso (HTTP 200 OK):** Coleção paginada de módulos contendo metadados, contadores de materiais/exercícios, status de vigência calculado e turmas associadas (se solicitante for o proprietário docente).
* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 401 | `unauthorized` | Token de sessão ausente ou inválido |

---

### 5.3. `GET /api/v1/modules/:id`
Consulta detalhada de um módulo específico.

* **Papéis autorizados:** `TEACHER`, `ADMIN`, `STUDENT` (sujeito a validação de acesso discente) e público anônimo (caso o módulo seja `PUBLIC` ativo em vigência).
* **Parâmetros de rota:** `id` (UUIDv7).
* **Resposta de sucesso (HTTP 200 OK):** Objeto com metadados completos do módulo, lista de turmas associadas, esteira ordenada de exercícios e lista de materiais.
* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 403 | `forbidden` | Módulo expirado ou fora do escopo do discente |
| 404 | `not_found` | Módulo não localizado |

---

### 5.4. `POST /api/v1/modules`
Criação de novo módulo de ensino.

* **Papéis autorizados:** `TEACHER`, `ADMIN`.
* **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `title` | `string` | Sim | Não vazio (máximo 150 caracteres) |
| `description` | `string` | Sim | Não vazio |
| `visibility` | `string` | Sim | `PUBLIC`, `AUTHENTICATED` ou `PRIVATE` |
| `activationStart` | `string` | Não | Timestamp ISO 8601 |
| `activationEnd` | `string` | Não | Timestamp ISO 8601; se informado com `activationStart`, deve ser posterior |
| `classIds` | `array[uuid]` | Não | Obrigatório se `visibility == 'PRIVATE'` (mínimo 1) |

* **Resposta de sucesso (HTTP 201 Created):** Objeto do módulo criado com status `ACTIVE` e turmas associadas.
* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `bad_request` | Dados obrigatórios ausentes, intervalo cronológico invertido ou ausência de turmas em módulo privado |
| 403 | `forbidden` | Discente tentando criar módulo ou docente tentando vincular turma que não lhe pertence |

---

### 5.5. `PATCH /api/v1/modules/:id`
Atualização de metadados, vigência, status ou turmas do módulo.

* **Papéis autorizados:** `TEACHER` (proprietário), `ADMIN`.
* **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `title` | `string` | Não | Novo título |
| `description` | `string` | Não | Nova descrição |
| `visibility` | `string` | Não | Nova visibilidade |
| `status` | `string` | Não | `ACTIVE`, `INACTIVE` ou `ARCHIVED` |
| `activationStart` | `string` | Não | Novo início de vigência |
| `activationEnd` | `string` | Não | Novo término de vigência |
| `classIds` | `array[uuid]` | Não | Lista atualizada de turmas associadas |

* **Resposta de sucesso (HTTP 200 OK):** Entidade atualizada.
* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `bad_request` | Intervalo temporal inválido |
| 403 | `forbidden` | Usuário não é o proprietário do módulo nem administrador |
| 404 | `not_found` | Módulo não encontrado |

---

### 5.6. `PUT /api/v1/modules/:id/exercises/order`
Atualização em lote da ordem sequencial obrigatória dos exercícios da trilha.

* **Papéis autorizados:** `TEACHER` (proprietário), `ADMIN`.
* **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `orderedExerciseIds` | `array[uuid]` | Sim | Lista ordenada de IDs de exercícios pertencentes ao módulo |

* **Resposta de sucesso (HTTP 200 OK):** Confirmação de itens reordenados e lista na nova ordem ordinal.
* **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `bad_request` | Lista vazia, IDs duplicados ou itens não pertencentes ao módulo |
| 403 | `forbidden` | Não é o docente proprietário |
| 404 | `not_found` | Módulo não encontrado |

---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Acesso a Conteúdo Expirado via Fuso Horário Local:** Discentes em terminais com relógios desajustados tentarem burlar a expiração do módulo.
  * **Mitigação:** Toda a lógica de cálculo de vigência temporal é avaliada estritamente pelo carimbo do servidor de aplicação no backend Go, tratando datas no padrão UTC com fuso horário unificado.
* **Risco de Exposição de Módulos Privados em Ambientes Públicos:** Falha na filtragem relacional expor materiais restritos de uma turma a visitantes anônimos.
  * **Mitigação:** O endpoint público possui cláusula estrita no repositório forçando `visibility = 'PUBLIC'`, `status = 'ACTIVE'` e conferência de intervalo temporal em banco de dados antes do retorno.
* **Risco de Condição de Corrida na Reordenação da Trilha:** Múltiplas atualizações simultâneas gerarem ordens duplicadas ou quebras de integridade na esteira sequencial.
  * **Mitigação:** A atualização da ordem sequencial de itens é executada sob bloco transacional exclusivo (`.WithinTransaction`) limpando ou atualizando posições ordinais atomicamente.

---

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: O SISTEMA DEVE permitir a criação, consulta e edição de módulos com título, descrição, visibilidade e intervalo de vigência temporal por docentes e administradores autenticados.
- [x] **CA-02**: QUANDO um visitante não autenticado acessar a rota pública de materiais (`GET /api/v1/modules/public` ou `/materials`), O SISTEMA DEVE retornar exclusivamente módulos com visibilidade `PUBLIC`, status manual `ACTIVE` e cujo horário do servidor esteja dentro do intervalo de vigência.
- [x] **CA-03**: QUANDO um módulo for configurado como `PRIVATE`, O SISTEMA DEVE exigir a indicação de pelo menos uma turma gerenciada pelo docente e bloquear o acesso de estudantes não matriculados ativamente nas turmas vinculadas.
- [x] **CA-04**: ENQUANTO o horário do servidor estiver fora do período de vigência (`activationStart` / `activationEnd`), O SISTEMA DEVE bloquear o acesso de discentes e visitantes públicos, retornando HTTP 403.
- [x] **CA-05**: ENQUANTO o status manual do módulo for `INACTIVE` ou `ARCHIVED`, O SISTEMA DEVE bloquear o acesso de estudantes e visitantes, sobrepondo-se ao intervalo de datas de vigência.
- [x] **CA-06**: O SISTEMA DEVE computar e expor contadores consolidados do total de materiais e exercícios vinculados nas listagens e detalhes do módulo.
- [x] **CA-07**: QUANDO um docente atualizar a ordem da trilha de exercícios via `PUT /api/v1/modules/:id/exercises/order`, O SISTEMA DEVE persistir a nova sequência ordinal de forma atômica sob transação.
- [x] **CA-08**: SE um discente com papel `STUDENT` tentar criar, alterar ou reordenar módulos, ENTÃO O SISTEMA DEVE rejeitar a solicitação com código HTTP 403 (RFC 7807).
- [x] **CA-09**: SE a data de início da vigência for posterior à data de término, ENTÃO O SISTEMA DEVE rejeitar a requisição com código HTTP 400 (RFC 7807).
- [x] **CA-10**: QUANDO qualquer tela do módulo de ensino for renderizada em tema claro ou escuro, A INTERFACE DEVE utilizar exclusivamente tokens semânticos de `_tokens.scss`.

---

## 8. Plano de Testes (Test Plan)

* **Backend:**
  * Teste unitário de domínio e service: criação com vigência coerente e rejeição com data invertida (cobre CA-01, CA-09).
  * Teste de vigência e expiração: cálculo de acessibilidade retornando falso para módulo fora da janela temporal ou inativo (cobre CA-04, CA-05).
  * Teste de permissão e isolamento de turmas privadas: discente sem matrícula recebendo 403 e docente vinculando turma de outro professor recebendo 403 (cobre CA-03, CA-08).
  * Teste de listagem pública: consulta anônima trazendo apenas módulos públicos e ativos em vigência (cobre CA-02).
  * Teste de transação de reordenação: persistência atômica da ordem ordinal e garantia contra duplicações (cobre CA-07).
  * Teste de repositório: junção com contadores consolidados de exercícios e materiais (cobre CA-06).
* **Frontend:**
  * Testes de componente `ModuleCard`, `ModuleForm` e `ExerciseOrderList` com mocks sob React Testing Library e vitest (cobre CA-01, CA-06, CA-07, CA-10).
  * Teste da página de catálogo público `/materials` sem credenciais (cobre CA-02).
  * Testes de serviço em `moduleService.test.ts`.

Meta de cobertura: Superior a 80% tanto no backend quanto no frontend.

---

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/features/009-spec-crud-turmas-gestao-academica.md`.
2. **Ordem de execução:**
   - Milestone 1: Aprovação canônica da SPEC-010.
   - Milestone 2: Migração SQL `00004_create_course_modules_tables.sql`, entidades de domínio, interfaces de repositório e serviços com cobertura > 80%.
   - Milestone 3: Handlers HTTP Gin, middlewares de RBAC e rotas da API com testes de integração > 80%.
   - Milestone 4: Frontend (serviço tipado, componentes `ModuleCard`, `ModuleForm`, `ExerciseOrderList`, páginas `/app/modules`, `/app/modules/new`, `/app/modules/[id]/edit` e `/materials`), garantindo tokens semânticos e testes com cobertura > 80%.
   - Milestone 5: Fechamento da SPEC-010 com critérios de aceite marcados.
3. **Arquivos a criar ou alterar:**
   - `backend/migrations/00004_create_course_modules_tables.sql`
   - `backend/internal/modules/coursemodule/domain/...`
   - `backend/internal/modules/coursemodule/repository/...`
   - `backend/internal/modules/coursemodule/service/...`
   - `backend/internal/modules/coursemodule/handler/...`
   - `backend/cmd/api/main.go`
   - `frontend/src/services/moduleService.ts`
   - `frontend/src/messages/pt-BR.ts`
   - `frontend/src/components/ModuleCard/...`
   - `frontend/src/components/ModuleForm/...`
   - `frontend/src/components/ExerciseOrderList/...`
   - `frontend/src/app/app/modules/...`
   - `frontend/src/app/materials/...`
4. **Definição de pronto:** Todos os critérios de aceite verificados, cobertura de testes > 80%, linter sem erros e status marcado como `Implementada`.

---

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| - | Nenhuma pendência em aberto. | Spec implementada com sucesso. |

---

## 11. Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação da spec inicial |
| 08/10/2026 | Tech Lead (Ricardo Martins de Oliveira) | Padronização e aprovação canônica para implementação |
| 08/10/2026 | Ricardo Martins de Oliveira | Implementação concluída com cobertura de testes e critérios de aceite verificados |
| 09/10/2026 | Implementador (Claude) | Correção encontrada ao investigar a reclamação sobre a edição de módulos: a listagem administrativa (`GET /api/v1/modules`) mostrava ao `ADMIN` só os módulos que ele mesmo criou, e não os de todas as docentes; um administrador diferente de quem rodou a carga inicial via a lista vazia e não achava os módulos para editar. O `ADMIN` passa a listar todos (novo `ListAllModules` no repositório), e o `TEACHER` continua vendo só os seus (RN-01). Testes: `TestService_ListModules` (administrador vê todos, com e sem id de usuário) e `TestCourseModuleRepository` (administrador lista os de outra docente, docente só os seus, filtros valem). |
