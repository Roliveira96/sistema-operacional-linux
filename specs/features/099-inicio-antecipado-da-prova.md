# SPEC-099: Início Antecipado da Prova pela Docente

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-099 |
| **Status** | Rascunho |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: o início antes do horário e o período ajustado; frontend: o botão *Iniciar a prova* e a sala antes do horário) |
| **Contexto de tela** | O detalhe da avaliação e a sala da prova (`/room`) |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (o período e a fase pelo relógio), SPEC-083 e SPEC-089 (o início pela docente), SPEC-090 (o prazo da tentativa), SPEC-091 e 096 (a sala da prova, a admissão e finalizar) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-083 RN-01 (mantida pela SPEC-089), a exigência da fase `RUNNING` para iniciar, e na SPEC-091 D-01 a sala que só abre no horário marcado. |
| **Fontes canônicas** | Pedido do Tech Lead no roteiro manual de 04/11/2026: a docente deve poder iniciar a prova antes do horário marcado, por exemplo quando adiantou a aula ou ficou livre para aplicá-la. |

---

## 1. Contexto e Problema (Context & Problem Statement)

O botão *Iniciar a prova* fica travado até o horário marcado ("A prova pode ser iniciada a partir de DD/MM/AAAA, HH:MM."), e a sala da prova só abre nesse horário (SPEC-083 RN-01, SPEC-091 D-01). A agenda real muda: a aula adianta, a turma termina outra atividade mais cedo, e a docente quer aplicar a prova na hora, sem reagendar e esperar o relógio.

## 2. Objetivos (Goals)

- A docente **inicia a prova antes do horário marcado**, no dia da prova (D-03).
- O **período da prova acompanha o início**: começa agora e mantém a mesma duração, para ninguém perder tempo (D-01, D-02).
- A **sala da prova abre antes do horário** no dia da prova, para a docente iniciar por ela e os alunos já esperarem (D-04).
- O histórico registra que a prova foi iniciada antes do horário marcado.

### 2.1. Fora de escopo (Non-Goals)

- Iniciar em outro dia (isso é reagendar, SPEC-075).
- Iniciar uma atividade (`ASSIGNMENT`): continua abrindo pelo relógio (SPEC-089 RN-01).
- Aviso por e-mail aos alunos sobre a mudança de horário (D-05).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Detalhe da avaliação e sala:** no dia da prova, antes do horário, o botão **Iniciar a prova** fica liberado. A frase de hoje ("pode ser iniciada a partir de …") vira "Marcada para HH:MM. Você pode iniciar agora."
- **Diálogo de início antecipado:** "Iniciar a prova agora, antes do horário marcado (HH:MM)? O período passa a ser de HH:MM (agora) a HH:MM, com a mesma duração." Confirmado, a sala abre como hoje.
- **Sala da prova antes do horário:** a docente abre a sala desde o início do dia da prova; os alunos que abrem a prova ficam na sala de espera (SPEC-091 RN-02), já que a prova ainda não começou.
- **Detalhe depois do início antecipado:** "Prova iniciada às HH:MM por <nome>, antes do horário marcado (HH:MM)." O período mostrado é o novo.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Iniciar** (`Start`, SPEC-083): passa a aceitar a fase `UPCOMING` quando hoje é o dia da prova (D-03, no fuso do servidor). Nesse caso, numa transação: `starts_at` vira agora, `ends_at` vira agora mais a duração original (`ends_at − starts_at`, D-02), grava `started_at`/`started_by` e o evento `STARTED` com o período antigo e o novo (D-06). Iniciar na fase `RUNNING` continua como hoje (o período não muda).
- **A composição congela** no início, como já faz pelo `starts_at` (SPEC-075 RN-10): com o `starts_at` em agora, ela congela no mesmo instante.
- **A sala** (`EnterRoom`): no dia da prova, a docente entra antes do `starts_at`; o aluno também, e fica esperando (SPEC-091 RN-02, SPEC-096).
- **O prazo da tentativa** usa o período novo (SPEC-090 RN-03), sem mudança no cálculo.

## 4. Modelo de Dados (Data Model)

Nenhuma coluna nova. No início antecipado, o evento `STARTED` do histórico preenche `old_starts_at`/`old_ends_at` (o período marcado) e `new_starts_at`/`new_ends_at` (o período novo), as mesmas colunas que o reagendamento já usa (SPEC-075 RN-15); no início no horário, ficam vazias como hoje.

## 5. Contrato de API (API Contract)

| Rota | Mudança |
| :--- | :--- |
| `POST .../assessments/{id}/start` (SPEC-083) | Aceita a fase `UPCOMING` no dia da prova; responde o resumo com o período novo |
| `GET .../room/ws` (SPEC-091) | Aceita a conexão no dia da prova antes do `starts_at` |

**Erros:** `409 assessment-not-open-yet` continua para quem tenta iniciar ou entrar na sala **antes do dia** da prova; o resto como hoje.

## 6. Impacto e Riscos (Impact & Risks)

- **Aluno que conta com o horário marcado** chega depois e encontra a prova correndo. **Mitigação:** ele entra pela admissão (SPEC-096) e tem o tempo até o novo término; a docente decide antecipar sabendo disso.
- **O calendário da turma** passa a mostrar o horário novo, porque mostra o período da avaliação.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente inicia a prova no dia marcado, antes do horário, O servidor DEVE gravar o início, mover o período para começar agora com a mesma duração e registrar no histórico o horário original; antes do dia, `409 assessment-not-open-yet` (D-01 a D-03, D-06).
- [ ] **CA-02** (evento): QUANDO a docente inicia na fase `RUNNING`, O período NÃO DEVE mudar (como hoje).
- [ ] **CA-03** (estado): ENQUANTO é o dia da prova e ela não começou, A sala DEVE aceitar a docente e deixar os alunos na sala de espera; antes do dia, DEVE recusar (D-04).
- [ ] **CA-04** (estado): ENQUANTO é o dia da prova, antes do horário, O detalhe e a sala DEVEM ter *Iniciar a prova* liberado, com a frase e o diálogo da seção 3.1; depois, a frase "antes do horário marcado".
- [ ] **CA-05** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):** `service`: o início antecipado move o período e grava o evento; antes do dia, recusa; na fase `RUNNING`, não mexe no período; a sala no dia da prova antes do horário; `handler`: a rota de início com o período novo.
- **Frontend (Vitest):** `canStart` liberado no dia da prova; o diálogo com o período novo; a frase depois do início.
- **Roteiro manual:** criar uma prova para hoje mais tarde, iniciar agora, conferir o período novo, o histórico e a entrada dos alunos pela admissão.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-075, 083, 089, 090, 091 e 096.
2. **Arquivos:** `backend/internal/modules/assessment/` (`service/start.go`, `service/room.go`, o evento), `frontend/src/lib/assessment.ts` (`canStart`), o diálogo de início (`AssessmentStartDialog`), o detalhe, a sala e `messages/pt-BR.ts`.
3. Testes antes, vermelhos, num commit `test(...)`; depois o código.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **O início do período passa a ser agora?** (a) sim, `starts_at` vira o instante do início; (b) não, fica o horário marcado e só se libera o início. | **(a).** A fase, o calendário e o relógio da sala passam a dizer a verdade; com (b) a prova estaria "em andamento" antes do próprio início. |
| D-02 | **O término:** (a) anda junto, mantendo a mesma duração; (b) fica o marcado, e a prova fica mais longa. | **(a).** A docente planejou uma duração; antecipar não deve dar nem tirar tempo. Se quiser acabar antes, finaliza (SPEC-096). |
| D-03 | **Com quanta antecedência:** (a) qualquer horário do dia da prova; (b) até N minutos antes; (c) a qualquer momento antes. | **(a).** Cobre a aula adiantada e o horário livre do mesmo dia; outro dia é reagendar. |
| D-04 | **A sala abre antes do horário** no dia da prova, para a docente e para a espera dos alunos? | **Sim**, desde o início do dia; sem isso a docente não inicia pela sala. |
| D-05 | **Avisar os alunos** por e-mail da mudança de horário? | **Não nesta spec**; o calendário já mostra o horário novo. |
| D-06 | **Registrar o horário original** no histórico ("iniciada às 08:40, antes do horário marcado 09:30")? | **Sim**, para a correção e a auditoria. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a partir do pedido do Tech Lead de 04/11/2026. Pendências D-01 a D-06. |
