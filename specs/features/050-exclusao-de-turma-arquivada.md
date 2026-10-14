# SPEC-050: Exclusão de Turma Arquivada há Mais de 30 Dias

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-050 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classgroup` |
| **Contexto de tela** | Lista de turmas (`/app/classes`), aba "Arquivadas" |
| **Prioridade** | Média |
| **Depende de** | SPEC-009, SPEC-041, SPEC-049 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "uma turma pode ser apagada depois que ela está arquivada, a mais de 30 dias" |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje uma turma arquivada fica para sempre na aba "Arquivadas". Não há como retirá-la da lista depois que o período de guarda passou. Ao mesmo tempo, a turma tem valor acadêmico, e por isso só pode sair depois de um prazo e de forma que preserve o histórico.

## 2. Objetivos (Goals)

- A docente dona pode **excluir** uma turma que está **arquivada há mais de 30 dias**.
- Antes dos 30 dias, a turma arquivada mostra a partir de quando poderá ser excluída.
- A exclusão é lógica: a turma some das listas e telas, e o histórico fica guardado, com quem excluiu e quando.

### 2.1. Fora de escopo (Non-Goals)

- Excluir turma ativa ou em rascunho (a regra é arquivar primeiro).
- Restaurar uma turma excluída pela interface.
- Exclusão física dos dados (matrículas, aulas, links, notas), que seguem preservados.
- Mudar o prazo de 30 dias por configuração.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

No card de uma turma **arquivada**:

- se faz **30 dias ou mais** que foi arquivada, o card tem a ação **Excluir** (botão de ícone, com nome acessível e dica, na ação discreta do cabeçalho, em tom de perigo);
- se faz menos de 30 dias, o card mostra a linha "Pode ser excluída a partir de dd/mm/aaaa", sem o botão.

Ao acionar **Excluir**, abre um diálogo de confirmação: o título com o nome da turma, o aviso "A turma sai da lista e das telas. O histórico acadêmico é preservado.", o botão **Cancelar** e o botão de perigo **Excluir turma**. Ao confirmar, a turma sai da lista com a mensagem "Turma excluída."; se o servidor recusar, o diálogo mostra o erro.

A tela só decide o que mostrar; quem decide se pode excluir é o servidor (RN-01).

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (quando pode):** só pode excluir a turma **arquivada**, cujo `archived_at` (SPEC-049) seja de **30 dias ou mais** antes de agora. Turma ativa, em rascunho, ou arquivada há menos de 30 dias é recusada. Uma turma arquivada sem `archived_at` (dado antigo sem a data) não pode ser excluída.
- **RN-02 (quem pode):** a docente dona da turma (como as demais ações da turma). Outra docente recebe 403.
- **RN-03 (exclusão lógica):** a turma recebe `deleted_at` e `deleted_by`. Matrículas, encontros, aulas, links e demais dados ligados não são apagados; deixam de aparecer porque a turma não existe mais para as telas. A turma excluída libera a combinação de docente, disciplina e semestre.
- **RN-04 (resposta de recusa):** quando a turma ainda não pode ser excluída, o erro traz, se houver, a data a partir da qual poderá (`deletableAfter`).

## 4. Modelo de Dados (Data Model)

Coluna nova em `classes` (migração 00029):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `deleted_by` | uuid | Não | FK `users` | Quem excluiu (RN-03); `deleted_at` já existe |

## 5. Contrato de API (API Contract)

**`DELETE /api/v1/classes/{id}`**: exclui a turma arquivada há 30 dias ou mais.

- **Papéis autorizados:** docente dona.
- **Resposta de sucesso:** 204, sem corpo.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-uuid` | id inválido |
| 403 | `forbidden` | docente de outra turma |
| 404 | `class-not-found` | turma inexistente ou já excluída |
| 409 | `class-not-deletable` | turma não arquivada ou arquivada há menos de 30 dias (RN-01); a extensão `deletableAfter` (data e hora) vem quando a turma está arquivada |

A lista e o detalhe de turmas já trazem `archivedAt` (SPEC-049), que a tela usa para decidir o que mostrar.

## 6. Impacto e Riscos (Impact & Risks)

- **Perda de dado acadêmico.** Mitigação: exclusão lógica; nada é apagado fisicamente; fica guardado quem excluiu e quando.
- **Excluir a turma errada.** Mitigação: só arquivada há 30 dias ou mais, e confirmação com o nome da turma.
- **Dados ligados órfãos.** Mitigação: as leituras já filtram turmas excluídas; testes cobrem links e a lista.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona exclui uma turma arquivada há 30 dias ou mais, O SISTEMA DEVE excluí-la logicamente, guardando `deleted_at` e `deleted_by`, e responder 204.
- [ ] **CA-02** (indesejado): SE a turma está ativa, em rascunho ou arquivada há menos de 30 dias, ENTÃO O SISTEMA DEVE recusar com 409 `class-not-deletable` e, para a arquivada, informar `deletableAfter`.
- [ ] **CA-03** (indesejado): SE outra docente tenta excluir, ENTÃO O SISTEMA DEVE responder 403; SE a turma não existe ou já foi excluída, ENTÃO 404.
- [ ] **CA-04** (estado): ENQUANTO a turma está excluída, ela NÃO DEVE aparecer na lista, no detalhe, nos links, na agenda nem no menu, e a combinação de disciplina e semestre DEVE ficar livre.
- [ ] **CA-05** (ubíquo): Os dados ligados à turma (matrículas, links) DEVEM continuar guardados.
- [ ] **CA-06** (ubíquo): No card de uma turma arquivada há 30 dias ou mais DEVE haver a ação Excluir; no de uma arquivada há menos DEVE haver a linha com a data a partir da qual poderá; nos de turmas ativas e em rascunho NÃO DEVE haver nenhum dos dois.
- [ ] **CA-07** (evento): QUANDO a docente confirma a exclusão no diálogo, O SISTEMA DEVE excluir, tirar a turma da lista e mostrar "Turma excluída."; SE o servidor recusar, ENTÃO DEVE mostrar o erro no diálogo.
- [ ] **CA-08** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `classgroup/domain`:** a data a partir da qual pode excluir e a regra dos 30 dias, nos limites (29 dias, 30 dias exatos, 31). Cobre CA-02.
- **Backend, `classgroup/service`:** excluir arquivada há mais de 30 dias; recusar ativa, rascunho, arquivada há 29 dias e arquivada sem data; posse; inexistente. Cobre CA-01 a CA-03.
- **Backend, `classgroup/repository`:** a exclusão guarda `deleted_by`; a turma some de `FindClassByID` e da lista; a combinação fica livre; matrículas e links continuam no banco. Cobre CA-01, CA-04 e CA-05.
- **Backend, `classgroup/handler`:** a rota, o 204 e os erros da seção 5, com `deletableAfter`. Cobre CA-01 a CA-03.
- **Frontend, `ClassCard`:** a ação e a linha por situação e prazo. Cobre CA-06.
- **Frontend, diálogo `DeleteClassModal` e página da lista:** confirmar, cancelar, erro e a turma saindo da lista. Cobre CA-07.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, SPEC-009, SPEC-049, `classgroup/service/service.go` (arquivar), `ArchiveClassModal` e `ClassCard`.
2. **Ordem:** testes vermelhos e commit `test`; migração; domain, repository, service, handler; frontend (serviço, diálogo, card, página).
3. **Arquivos:** `backend/migrations/00029_class_deleted_by.sql`; `classgroup/domain/class.go`, `repository/repository.go`, `service/service.go`, `handler/handler.go` e seus testes; `frontend/src/services/classService.ts`; `frontend/src/components/DeleteClassModal/**` (novo); `frontend/src/components/ClassCard/**`; `frontend/src/app/app/classes/page.tsx`; `frontend/src/messages/pt-BR.ts`.
4. **Pronto:** CA marcados, testes verdes, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisão do Tech Lead em 14/10/2026: uma turma só pode ser excluída depois de arquivada há mais de 30 dias. Assumido por recomendação: exclusão lógica, só a docente dona, sem restauração pela interface.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao pedir a exclusão de turmas arquivadas há mais de 30 dias |
| 14/10/2026 | Implementador | Implementada: migração 00029, `DeleteClass` no service e no repositório, `DELETE /classes/{id}`, diálogo `DeleteClassModal`, ação Excluir e a data no card, e a variante `danger` do `Button` (SPEC-047). O teste vermelho da variante `danger` do `Button` passou antes do código, porque o teste não confere tipos; o `tsc` o cobre |
