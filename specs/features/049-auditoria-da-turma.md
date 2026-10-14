# SPEC-049: Auditoria da Turma (quem e quando criou, atualizou e arquivou)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-049 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classgroup` |
| **Contexto de tela** | Página da turma, aba Visão geral (`/app/classes/{id}`), para a docente e o administrador |
| **Prioridade** | Média |
| **Depende de** | SPEC-009, SPEC-041 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "devemos salvar quem criou a turma e quem atualizou, e quando foi criado, quando foi atualizado e quando foi arquivado" |

---

## 1. Contexto e Problema (Context & Problem Statement)

A turma guarda quando foi criada e atualizada (`created_at`, `updated_at`) e o motivo do arquivamento, mas não **quem** a criou, **quem** a atualizou por último, nem **quando** e **por quem** foi arquivada. Sem isso não há rastreabilidade (uma turma tem valor acadêmico) e a regra de exclusão depois do arquivamento (próxima spec) não tem uma data confiável de arquivamento.

## 2. Objetivos (Goals)

- Guardar quem criou a turma e quando; quem a atualizou por último e quando; quando foi arquivada e por quem.
- Mostrar esse histórico à docente dona e ao administrador, na visão geral da turma.
- Preencher as turmas que já existem com o que for possível deduzir.

### 2.1. Fora de escopo (Non-Goals)

- Histórico completo de cada alteração (uma linha do tempo de mudanças): guarda-se só a última atualização.
- Auditoria de matrículas, encontros, aulas e links (cada um tem seus próprios registros).
- Mostrar o histórico ao estudante.
- Excluir turmas (SPEC-050).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Na aba **Visão geral**, para a docente dona e o administrador, uma seção **Histórico** no painel de detalhes, com até três linhas:

- **Criada por** *Nome* em *data e hora*;
- **Atualizada por** *Nome* em *data e hora* (só se foi atualizada depois de criada);
- **Arquivada por** *Nome* em *data e hora* (só se a turma está arquivada), com o motivo, se houver.

Datas e horas no fuso da usuária. Se o nome não puder ser lido (conta removida), mostra "Usuário removido". O estudante não vê a seção. Textos no arquivo de mensagens; cores só dos tokens.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (criação):** ao criar a turma, `created_by` e `updated_by` recebem o usuário que criou (o mesmo que o service recebe como responsável pela ação); `created_at` e `updated_at` já existem.
- **RN-02 (atualização):** a cada atualização, `updated_by` recebe o usuário que atualizou e `updated_at` é renovado; `created_by` e `created_at` nunca mudam.
- **RN-03 (arquivamento):** ao arquivar, `archived_at` recebe o instante do arquivamento, `archived_by` o usuário que arquivou, e `updated_by` e `updated_at` também são renovados. Uma turma não arquivada tem `archived_at` e `archived_by` vazios.
- **RN-04 (nomes):** o detalhe da turma (`GET /classes/{id}`) devolve também o nome de quem criou, atualizou e arquivou; as listas e as demais respostas trazem só os identificadores. O nome vem do cadastro do usuário; se não existir, o campo vem vazio.
- **RN-05 (dados existentes):** a migração preenche as turmas já salvas: `created_by` e `updated_by` com o `teacher_id`; e, para as arquivadas, `archived_at` com o `updated_at` e `archived_by` com o `teacher_id`.

## 4. Modelo de Dados (Data Model)

Colunas novas na tabela `classes` (migração 00028):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `created_by` | uuid | Sim | FK `users` | Quem criou (RN-01); preenchida nas existentes pela RN-05 |
| `updated_by` | uuid | Sim | FK `users` | Quem atualizou por último (RN-02) |
| `archived_at` | timestamptz | Não | | Quando foi arquivada (RN-03) |
| `archived_by` | uuid | Não | FK `users` | Quem arquivou (RN-03) |

Sem novos índices. Exclusão lógica continua a mesma.

## 5. Contrato de API (API Contract)

Todas as respostas que descrevem a turma (criar, listar, detalhar, atualizar, arquivar) passam a ter:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `createdBy` | uuid | Sim | Quem criou |
| `updatedBy` | uuid | Sim | Quem atualizou por último |
| `archivedAt` | data e hora | Não | Quando foi arquivada (só arquivada) |
| `archivedBy` | uuid | Não | Quem arquivou (só arquivada) |

O detalhe (`GET /api/v1/classes/{id}`) acrescenta `createdByName`, `updatedByName` e `archivedByName` (texto; ausente se vazio). Sem novos endpoints nem erros. A resposta ao estudante (`GET /me/classes/{id}`) não muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Linhas existentes sem autoria exata.** Mitigação: preenchimento por `teacher_id` (RN-05), que é o dono; o administrador que tenha criado ou atualizado antes não é recuperável.
- **Dado pessoal nas respostas.** Mitigação: nomes só no detalhe, que a docente dona e o administrador já podem ler; o estudante não recebe nada novo.
- **Migração em tabela existente.** Mitigação: colunas novas anuláveis, preenchimento e só então `NOT NULL` nas duas obrigatórias, tudo na mesma migração.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO uma turma é criada, O SISTEMA DEVE guardar quem criou (`created_by`, `updated_by`) e quando (`created_at`, `updated_at`).
- [ ] **CA-02** (evento): QUANDO uma turma é atualizada, O SISTEMA DEVE guardar quem atualizou (`updated_by`) e renovar `updated_at`, sem mudar `created_by` nem `created_at`.
- [ ] **CA-03** (evento): QUANDO uma turma é arquivada, O SISTEMA DEVE guardar `archived_at` e `archived_by` e renovar `updated_by` e `updated_at`.
- [ ] **CA-04** (estado): ENQUANTO a turma não está arquivada, `archivedAt` e `archivedBy` DEVEM estar ausentes das respostas.
- [ ] **CA-05** (ubíquo): As respostas da turma DEVEM trazer `createdBy`, `updatedBy`, `archivedAt` e `archivedBy`, e o detalhe DEVE trazer também os nomes (`createdByName`, `updatedByName`, `archivedByName`).
- [ ] **CA-06** (ubíquo): A migração DEVE preencher as turmas existentes pela RN-05.
- [ ] **CA-07** (ubíquo): Na visão geral, a docente e o administrador DEVEM ver a seção Histórico (criada, atualizada e arquivada por quem e quando); o estudante NÃO DEVE ver.
- [ ] **CA-08** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `classgroup/service`:** criar, atualizar e arquivar guardam a autoria e as datas (CA-01 a CA-04); `UserNames` devolve os nomes (RN-04).
- **Backend, `classgroup/repository`:** as colunas novas vão ao banco e voltam; `archived_at` e `archived_by` ficam vazios sem arquivar (CA-01 a CA-04); a migração preenche as existentes (CA-06).
- **Backend, `classgroup/handler`:** o detalhe traz os nomes, as demais respostas só os identificadores; o estudante não recebe os campos (CA-04, CA-05).
- **Frontend, página da turma:** a seção Histórico aparece para a docente, com nomes e datas, e não para o estudante (CA-07).
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, SPEC-009, SPEC-041, `classgroup/service/service.go` (criar, atualizar e arquivar), `classgroup/handler/handler.go`.
2. **Ordem:** testes vermelhos e commit `test`; migração; domain, service, repository; handler e composição; frontend.
3. **Arquivos:** `backend/migrations/00028_class_audit.sql`; `classgroup/domain/class.go`, `service/service.go`, `handler/handler.go` e seus testes; `cmd/api/main.go` (nomes); `frontend/src/services/classService.ts`; `frontend/src/app/app/classes/[id]/page.tsx` e teste; `frontend/src/messages/pt-BR.ts`.
4. **Pronto:** CA marcados, testes verdes, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: guardar quem e quando criou, atualizou e arquivou.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao pedir a auditoria da turma |
| 14/10/2026 | Implementador | Implementada: migração 00028, autoria no service, nomes no detalhe e seção Histórico na visão geral. O teste de migração 00025 passou a informar `created_by` e `updated_by` no INSERT direto, porque agora são obrigatórios; o repositório preenche o autor pelo `teacher_id` quando a turma é salva sem autor (não muda o service) |
