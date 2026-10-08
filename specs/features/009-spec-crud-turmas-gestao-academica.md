# SPEC-009: Gestão Acadêmica, Ciclo de Vida e Ingresso em Turmas

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-009 |
| **Status** | Aprovada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classgroup` |
| **Contexto de tela** | `/app/classes`, `/app/classes/new`, `/app/classes/:id/settings`, `/app/classes/:id/members` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-003, SPEC-004 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md` (seções 3.1 e 4.2) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o sistema carece de um módulo de agrupamento estruturado para gerenciar turmas acadêmicas. A ausência desse núcleo impede a contextualização pedagógica de discentes com ou sem vínculo formal (com ou sem RA da UTFPR), inviabilizando a segregação de avaliações, materiais didáticos e registros de frequência.

Além disso, a dinâmica letiva real exige flexibilidade no período de vigência semestral: ocorrências como greves, paralisações ou incidentes técnicos frequentemente demandam a prorrogação ou o encerramento antecipado do semestre. A falta de mecanismos para avisos de expiração próxima, o bloqueio contra exclusão física de turmas com histórico ativo e a ausência de controles temporais rígidos para links de convite (com moderação docente obrigatória) fragilizam a integridade institucional e geram inconsistências acadêmicas.

---

## 2. Objetivos (Goals)

* Permitir o gerenciamento completo (criação, leitura, atualização e arquivamento) de turmas por docentes e administradores.


* Suportar turmas contendo estudantes com RA, estudantes sem RA ou composição mista desde o ato da criação.


* Incorporar metadados acadêmicos canônicos: nome da turma, código da disciplina, semestre letivo, ementa/diretrizes institucionais, vigência temporal e horários de encontros em texto livre com flag de configuração para aulas síncronas.


* Implementar o ciclo de vida do link de ingresso controlado por alternância booleana e intervalo com data/hora de início e término.
* Assegurar que qualquer ingresso via link resulte em status pendente de moderação docente (`PENDING_MODERATION`), exigindo deferimento explícito.


* Proibir a exclusão física de turmas que não estejam em rascunho, aplicando arquivamento lógico com exigência de justificativa textual obrigatória.


* Emitir avisos automáticos na interface docente quando a data de encerramento da turma estiver próxima da expiração.

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A interface deve estruturar a visualização e gestão das turmas sob a rota `/app/classes`:

* **Listagem e Painel de Turmas (`/app/classes`):**
* Exibição de cards responsivos agrupados por turmas ativas, rascunhos e arquivadas.
* Alerta visual de destaque nos cards de turmas cuja data de encerramento esteja a menos de 15 dias do término, informando a proximidade da expiração e oferecendo atalho para prorrogação de vigência.
* Indicador visual do status do link de convite (ativo com contagem temporal regressiva ou desativado).


* **Formulário de Criação e Edição (`/app/classes/new` e `/app/classes/:id/settings`):**
* Campos estruturados para metadados acadêmicos: nome da turma, código curricular da disciplina, semestre letivo, ementa e diretrizes institucionais.


* Definição do intervalo de vigência da turma com datas de início e término.


* Campo textual livre para especificação dos horários e dias de encontro, acompanhado de seletor booleano para habilitar configuração de encontros virtuais síncronos na plataforma.
* Seletor booleano para ativação do link de convite. Quando ativado, a interface expande obrigatoriamente os seletores de data/hora de abertura e data/hora de expiração do link, gerando o token de compartilhamento.
* Componente de seleção múltipla permitindo associar imediatamente discentes existentes (com ou sem RA) no momento do cadastro da turma.


* **Modal de Arquivamento e Encerramento:**
* Componente de confirmação que impede deleção física caso a turma possua dados vinculados, exigindo campo de texto com justificativa obrigatória de arquivamento para turmas fora do estado de rascunho.


* **Painel de Membros e Moderação (`/app/classes/:id/members`):**
* Tabela com abas segregadas: membros ativos e solicitações de ingresso pendentes de moderação recebidas via link de convite.


* Ações para aprovar ou reprovar o ingresso de cada solicitante.




* **Estilização e Temas:**
* Estilização estrita via SCSS Modules co-localizados (`.module.scss`).
* Uso exclusivo dos tokens semânticos de `_tokens.scss` para superfícies, bordas e contraste nos modos claro e escuro, proibindo valores cromáticos fixos.



### 3.2. Backend (Go — Camada de Módulo/Service)

A arquitetura no backend Go organiza-se sob o módulo funcional `class`:

* **Handlers e Roteamento:**
* Handlers dedicados no framework Gin para criação, listagem, busca detalhada, atualização, arquivamento e geração/validação de links de convite.


* Validação sintática preliminar no Handler antes do repasse à camada de serviço: obrigatoriedade de intervalo temporal válido (início anterior ao fim), consistência das datas do link de ingresso e presença de justificativa em arquivamentos.


* **Camada de Service (Regras de Domínio):**
* Criação da turma atrelando o docente autenticado como responsável único. Se houver lista de alunos fornecida, persiste as matrículas imediatas com status ativo dentro de transação atômica.


* Validação do link de ingresso: o Service só permite solicitação de ingresso se o link estiver marcado como ativo, se a data/hora atual estiver estritamente contida no intervalo delimitado e se a turma estiver com vigência ativa.


* Ingressos originados via link são forçados para o status `PENDING_MODERATION`, persistindo a solicitação para julgamento posterior do docente.


* Atualização de vigência: permite que o docente estenda as datas de início e término para contornar greves ou interrupções letivas sem afetar os dados históricos.


* Regra de arquivamento: caso a turma possua status diferente de rascunho ou contenha submissões/membros, proíbe a exclusão física, exigindo justificativa de texto não vazia para efetuar a inativação lógica.


* Rotina de verificação de expiração: cálculo diferencial entre a data final de vigência e o carimbo do servidor para rotular turmas prestes a expirar.


* **Persistência Transacional (.WithTx):**
* Mutações que associam turmas e múltiplos estudantes no ato da criação ou que deliberam sobre lotes de moderação devem operar sob escopo transacional.




* **Tratamento de Erros:**
* Mapeamento de falhas através do formato RFC 7807 (Problem Details): link expirado (410), intervalo de datas incoerente (400), ausência de justificativa de arquivamento (422) e duplicidade de código/semestre (409).





---

## 4. Modelo de Dados (Data Model)

A modelagem de dados situa-se no schema do banco de dados (resolvido dinamicamente via connection search_path, padrão `linux_lab`):

* **Tabela `classes`:**
* Armazena a entidade principal da turma.


* Chave primária UUIDv7 gerada automaticamente.
* Chave estrangeira referenciando a tabela de usuários (identificador do docente responsável).


* Colunas descritivas: nome da turma (texto, não nulo), código da disciplina (texto, não nulo), semestre letivo (texto, não nulo), ementa (texto, opcional) e diretrizes institucionais (texto, opcional).


* Colunas de vigência: data de início da vigência (timestamp com fuso, não nulo) e data de término da vigência (timestamp com fuso, não nulo).


* Colunas de horários e configuração: descrição textual dos horários de encontro (texto, opcional) e indicador booleano para realização de encontros pela plataforma.
* Colunas do link de convite: indicador booleano de habilitação do link (falso por padrão), token alfanumérico único do link (texto, opcional, indexado), carimbo de início de validade do link (timestamp com fuso, opcional) e carimbo de término de validade do link (timestamp com fuso, opcional).


* Colunas de status e ciclo de vida: status da turma (enum: `DRAFT`, `ACTIVE`, `ARCHIVED`), justificativa de arquivamento (texto, opcional), carimbos de criação, atualização e exclusão lógica.


* Índices: índice composto sobre código da disciplina, semestre e docente responsável; índice no token de convite.




* **Tabela `class_enrollments`:**
* Armazena as matrículas e vínculos dos discentes com a turma.


* Chave primária UUIDv7 gerada automaticamente.
* Chave estrangeira referenciando a tabela `classes` e chave estrangeira referenciando a tabela de usuários.


* Colunas de estado: status da matrícula (enum: `PENDING_MODERATION`, `ACTIVE`, `REJECTED`, `TRANSFERRED`, `UNENROLLED`), origem do ingresso (enum: `INVITE_LINK`, `DIRECT_BY_TEACHER`, `CSV_IMPORT`), justificativa de rejeição/transferência (texto, opcional), carimbo de solicitação e carimbo de deliberação.


* Constraints: unicidade composta entre a turma e o usuário discente para registros não excluídos.





---

## 5. Contrato de API (API Contract)

### 5.1. POST /api/v1/classes

* **Objetivo:** Criação de nova turma com possibilidade de vínculo discente inicial.


* **Entrada (Campos descritivos):**
* `name`: texto, obrigatório, nome identificador da turma.
* `courseCode`: texto, obrigatório, código da disciplina.


* `semester`: texto, obrigatório, período letivo no formato semestral.


* `syllabus`: texto, opcional, ementa acadêmica.


* `institutionalGuidelines`: texto, opcional, diretrizes de conduta e frequência.


* `startDate`: timestamp ISO 8601, obrigatório, início da vigência letiva.


* `endDate`: timestamp ISO 8601, obrigatório, término da vigência letiva.


* `scheduleDescription`: texto, opcional, horários dos encontros.
* `enableVirtualClassroom`: booleano, opcional, habilitação de encontros na plataforma.
* `enableInviteLink`: booleano, obrigatório, habilitação do link de ingresso.


* `inviteLinkStart`: timestamp ISO 8601, obrigatório se `enableInviteLink` for verdadeiro.
* `inviteLinkEnd`: timestamp ISO 8601, obrigatório se `enableInviteLink` for verdadeiro.
* `initialStudentIds`: lista de UUIDs, opcional, discentes associados na criação.


* **Saída Sucesso:** HTTP 201 Created. Campos: identificador da turma, token de convite gerado (se habilitado), status da turma (`ACTIVE` ou `DRAFT`), contagem de discentes matriculados e carimbo de criação.


* **Saída Erro:**
* HTTP 400 Bad Request (RFC 7807): datas incoerentes ou campos obrigatórios ausentes.


* HTTP 409 Conflict (RFC 7807): duplicidade de turma ativa para o mesmo código e semestre pelo mesmo docente.





### 5.2. GET /api/v1/classes

* **Objetivo:** Listagem paginada de turmas sob governança do docente autenticado.


* **Entrada:** Query parameters opcionais: página, limite por página, status (`ACTIVE`, `DRAFT`, `ARCHIVED`) e busca textual por nome/código.
* **Saída Sucesso:** HTTP 200 OK. Campos: lista de turmas contendo metadados básicos, status de expiração próxima (booleano), total de alunos ativos, total de solicitações pendentes e metadados de paginação.
* **Saída Erro:**
* HTTP 401 Unauthorized (RFC 7807): sessão ausente ou inválida.





### 5.3. PATCH /api/v1/classes/:id

* **Objetivo:** Atualização de metadados, vigência letiva ou regras do link de convite.


* **Entrada (Campos descritivos):**
* Campos parciais: `name`, `syllabus`, `institutionalGuidelines`, `startDate`, `endDate`, `scheduleDescription`, `enableVirtualClassroom`, `enableInviteLink`, `inviteLinkStart`, `inviteLinkEnd`.


* **Saída Sucesso:** HTTP 200 OK. Campos: dados atualizados da turma e token de convite refletindo o novo estado.
* **Saída Erro:**
* HTTP 400 Bad Request (RFC 7807): data de início posterior à data final de vigência.
* HTTP 404 Not Found (RFC 7807): turma inexistente ou pertencente a outro docente.



### 5.4. POST /api/v1/classes/:id/archive

* **Objetivo:** Arquivamento e encerramento administrativo da turma.


* **Entrada (Campos descritivos):**
* `reason`: texto, obrigatório se a turma não for rascunho, contendo o motivo formal do encerramento.




* **Saída Sucesso:** HTTP 200 OK. Campos: identificador da turma, status alterado para `ARCHIVED`, motivo persistido e carimbo de arquivamento.
* **Saída Erro:**
* HTTP 400 Bad Request (RFC 7807): ausência de justificativa em turma ativa.
* HTTP 404 Not Found (RFC 7807): turma não localizada.



### 5.5. POST /api/v1/classes/join/:token

* **Objetivo:** Solicitação discente de ingresso via link de convite.


* **Entrada:** Token informado via path parameter. Discente autenticado via cookie de sessão.


* **Saída Sucesso:** HTTP 201 Created. Campos: identificador da matrícula, nome da turma e status fixado em `PENDING_MODERATION`.


* **Saída Erro:**
* HTTP 404 Not Found (RFC 7807): token de turma inexistente.
* HTTP 410 Gone (RFC 7807): link de ingresso desativado ou fora da janela temporal de validade.
* HTTP 409 Conflict (RFC 7807): discente já matriculado ou com solicitação prévia em análise.





---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Perda de Histórico de Avaliações por Exclusão Inadvertida:** docentes tentarem remover turmas com provas já aplicadas, corrompendo notas.


*Mitigação:* Impedir terminantemente a exclusão física no banco de dados para qualquer turma com movimentação acadêmica, forçando o fluxo de arquivamento lógico com justificativa.


* **Risco de Ingresso Não Autorizado Fora do Período Letivo:** discentes acessarem links antigos vazados na internet.


*Mitigação:* A validação de ingresso no backend checa de forma combinada a flag booleana de ativação e a estrita vigência temporal do link no carimbo do servidor, rejeitando chamadas fora da janela.


* **Risco de Discentes Alheios Visualizarem Conteúdos Restritos Imediatamente:** ingressantes por link acessarem avaliações antes da conferência de documentação.


*Mitigação:* Todo ingresso via link nasce compulsoriamente como `PENDING_MODERATION`, mantendo o isolamento até o deferimento explícito pelo docente.



---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] QUANDO um docente autenticado submeter dados válidos de uma turma, O SISTEMA DEVE persistir a entidade com status inicial configurado e associar o docente como responsável exclusivo.


* [ ] QUANDO a turma for criada informando discentes com RA, sem RA ou composição mista, O SISTEMA DEVE vincular todos os estudantes fornecidos com status ativo na mesma transação.


* [ ] QUANDO a opção de link de convite for habilitada na criação ou edição, O SISTEMA DEVE exigir datas e horas válidas de abertura e expiração, gerando token único.


* [ ] QUANDO um estudante acionar um link de convite ativo dentro da janela temporal válida, O SISTEMA DEVE criar a matrícula com status `PENDING_MODERATION`.


* [ ] SE um estudante acionar um link de convite desativado ou com data expirada, ENTÃO O SISTEMA DEVE rejeitar a solicitação retornando código HTTP 410 (RFC 7807).
* [ ] ENQUANTO a matrícula do discente estiver em `PENDING_MODERATION`, O SISTEMA NÃO DEVE liberar o acesso a tarefas, simulados ou notas da turma.


* [ ] QUANDO uma turma atingir intervalo inferior a 15 dias para a data de término de sua vigência, A INTERFACE DEVE exibir alerta visual de expiração próxima para o docente.
* [ ] QUANDO o docente atualizar as datas de vigência da turma para contornar interrupções letivas, O SISTEMA DEVE persistir os novos prazos sem quebrar ou alterar matrículas e notas existentes.


* [ ] QUANDO um docente solicitar o encerramento de uma turma ativa, O SISTEMA DEVE exigir justificativa textual obrigatória e aplicar arquivamento lógico sem deletar registros físicos.


* [ ] QUANDO qualquer tela do módulo de turmas for renderizada em tema claro ou escuro, O SISTEMA DEVE utilizar exclusivamente tokens semânticos de `_tokens.scss`, garantindo paridade de contraste e ausência de cores fixas.

---

## 8. Plano de Testes (Test Plan)

### Backend

* Testar a criação de turma validando integridade referencial do docente e inserção atômica de estudantes iniciais.


* Testar validações temporais rejeitando turmas com data de início posterior ao término e links com data de abertura posterior à expiração.
* Testar solicitação de ingresso via link simulando chamadas antes do início, dentro da janela e após o término da validade, verificando emissão de status `PENDING_MODERATION` e retorno HTTP 410 fora do prazo.


* Testar arquivamento de turma ativa rejeitando requisições sem justificativa e assegurando persistência do estado `ARCHIVED` sem exclusão física do registro.


* Testar isolamento entre docentes, garantindo que um professor não consiga editar ou arquivar turmas pertencentes a outro docente.



### Frontend

* Testar preenchimento do formulário de criação nos temas claro e escuro, validando expansão dinâmica dos campos de data ao alternar o seletor de link de convite.
* Testar componente de alerta de expiração visual simulando turmas próximas da data limite.
* Testar modal de encerramento assegurando bloqueio do botão de confirmação enquanto o campo de justificativa estiver vazio.
* Testar tabela de moderação verificando ações de aprovação e reprovação de ingressos pendentes.



---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação, atue no backend e frontend estruturando as regras de negócio antes dos componentes de interface:

1. No backend, implemente a migração relacional criando as tabelas `classes` e `class_enrollments` no schema `project-manager`.


2. Desenvolva as entidades de domínio, interfaces de repositório, serviços e handlers sob o pacote `backend/internal/modules/class/...`, incluindo as validações temporais, geração de tokens e arquivamento lógico com justificativa.


3. Exponha os endpoints no roteador Gin aplicando os middlewares de autenticação e tratamento de erros RFC 7807.


4. No frontend, crie os serviços de integração sob `frontend/src/services/classService.ts`.
5. Implemente as telas em `frontend/src/app/app/classes/...` acompanhadas de seus respectivos componentes co-localizados (`ClassCard`, `ClassForm`, `ClassMembersTable`, `ArchiveClassModal`), garantindo o consumo de variáveis de `_tokens.scss` e suporte a ambos os temas.
6. Construa a suíte de testes automatizados com cobertura superior a 80%.

Arquivos a criar ou alterar:

* `backend/migrations/[timestamp]_create_class_tables.sql`
* `backend/internal/modules/class/domain/class.go`
* `backend/internal/modules/class/domain/enrollment.go`
* `backend/internal/modules/class/repository/class_repository.go`
* `backend/internal/modules/class/repository/enrollment_repository.go`
* `backend/internal/modules/class/service/class_service.go`
* `backend/internal/modules/class/handler/class_handler.go`
* `backend/internal/modules/class/router/class_routes.go`
* `frontend/src/services/classService.ts`
* `frontend/src/hooks/useClasses.ts`
* `frontend/src/components/ClassCard/ClassCard.tsx`
* `frontend/src/components/ClassCard/ClassCard.module.scss`
* `frontend/src/components/ClassCard/ClassCard.test.tsx`
* `frontend/src/components/ClassForm/ClassForm.tsx`
* `frontend/src/components/ClassForm/ClassForm.module.scss`
* `frontend/src/components/ClassForm/ClassForm.test.tsx`
* `frontend/src/components/ArchiveClassModal/ArchiveClassModal.tsx`
* `frontend/src/components/ArchiveClassModal/ArchiveClassModal.module.scss`
* `frontend/src/components/ArchiveClassModal/ArchiveClassModal.test.tsx`
* `frontend/src/components/ClassMembersTable/ClassMembersTable.tsx`
* `frontend/src/components/ClassMembersTable/ClassMembersTable.module.scss`
* `frontend/src/components/ClassMembersTable/ClassMembersTable.test.tsx`
* `frontend/src/app/app/classes/page.tsx`
* `frontend/src/app/app/classes/new/page.tsx`
* `frontend/src/app/app/classes/[id]/settings/page.tsx`
* `frontend/src/app/app/classes/[id]/members/page.tsx`

Dependências de execução: Esta especificação consome a infraestrutura compartilhada (SPEC-004), estende a entidade de usuários (SPEC-003) e serve como base mandatória para a vinculação discente da SPEC-002 e a aplicação de avaliações práticas.

---

## 10. Pendências (Open Issues / Questions)

Nenhuma pendência em aberto. Spec aprovada para implementação.

---

## 11. Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação da spec inicial |
| 08/10/2026 | Tech Lead (Ricardo Martins de Oliveira) | Aprovação para implementação |