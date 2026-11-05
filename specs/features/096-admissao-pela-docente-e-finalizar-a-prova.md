# SPEC-096: Admissão de Cada Aluno pela Docente e Finalizar a Prova

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-096 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a admissão guardada, a entrada na tentativa só para o admitido e a finalização da prova; frontend: os pedidos de entrada e *Finalizar a prova* na sala, a espera do aluno e o resumo no detalhe) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/room` (a sala da prova), `/app/classes/[id]/assessments/[assessmentId]/take` (a janela da prova) e o detalhe da avaliação (a seção *Tentativas*) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-054 (a sala de espera do hub), SPEC-083 e 089 (o início pela docente), SPEC-090 (a tentativa), SPEC-091 (a sala da prova), SPEC-092 (o painel da sala) |
| **Substitui** | Nenhuma. Revoga, da SPEC-091, "Não existe mais aprovar nem recusar aluno" e a admissão de todos no início (RN-02, CA-02). |
| **Fontes canônicas** | Roteiro manual de 05/11/2026, respostas do Tech Lead: "o professor inicia a prova, libera para os alunos entrarem e realizarem o pedido de entrar na sala de prova, o professor aprova e o aluno inicia a prova" (aprova "um ou múltiplos"); e "o professor aplicou a prova, todos os alunos presentes finalizaram, mas o professor não tem mais ação nenhuma, fica preso na tela, não há botão de finalizar prova", com a escolha "encerra e libera a docente". |

---

## 1. Contexto e Problema (Context & Problem Statement)

**Admissão.** A SPEC-091 tirou a aprovação de cada aluno: quando a docente inicia, todos que esperam entram juntos, e quem chega depois entra direto. No roteiro de 05/11/2026, o aluno entrou e começou a prova sem que a docente o aprovasse em momento algum. A docente quer conferir quem está na sala, presencial ou online, antes de cada um começar.

**Finalizar.** Quando todos os presentes entregam, a docente não tem o que fazer na sala: só existe *Encerrar a prova deste aluno* (SPEC-091 RN-08), um por vez, e a prova continua aberta até o fim do horário marcado. Quem não apareceu não fica registrado em lugar nenhum.

## 2. Objetivos (Goals)

- Depois do início, **cada aluno pede para entrar** e só começa a prova quando a docente o **admite**, um a um ou vários de uma vez.
- O servidor **recusa a entrada na tentativa** de quem não foi admitido, mesmo que a janela peça.
- A docente **finaliza a prova inteira**: as tentativas em andamento são entregues com o que têm, ninguém entra mais, quem não veio fica como *Não compareceu*, e a docente volta ao detalhe com o resumo.

### 2.1. Fora de escopo (Non-Goals)

- Recusar o pedido de um aluno com motivo (D-04).
- Reabrir uma prova finalizada.
- A habilitação da SPEC-076 (antes do início, por lista): continua removida.
- Correção e nota.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Janela da prova do aluno** (`/take`):

- **Antes do início:** a sala de espera de hoje, com "Você está na sala de espera. A prova começa quando a docente iniciar."
- **Depois do início, sem admissão:** a mesma tela, com "Pedido de entrada enviado. Aguarde a docente admitir você." O pedido é feito sozinho ao conectar: não há botão.
- **Admitido:** a janela entra na prova sozinha, como hoje com `room:admitted`.
- **Prova finalizada:** a janela trava com "A docente finalizou a prova. Sua prova foi entregue com o que você fez." Quem abre a prova depois lê "A prova foi finalizada pela docente."

**Sala da prova da docente** (`/room`):

- **Pedidos de entrada:** acima dos cartões, depois do início, uma faixa **Pedindo para entrar (N)** com o nome e o RA de cada aluno, uma caixa de seleção por aluno, **Admitir** em cada linha, **Admitir os selecionados** e **Admitir todos (N)**. Um pedido novo toca o som da sala (SPEC-091), com o mesmo consentimento. Sem pedidos, a faixa some.
- **Cartões:** a situação *Pedindo para entrar* aparece no cartão, além de *Na sala de espera*, *Fazendo*, *Entregou* e as de hoje.
- **Finalizar a prova:** botão de perigo no cabeçalho da sala, sempre disponível depois do início. Abre um diálogo: "Finalizar a prova? N alunos ainda estão fazendo e terão a prova entregue agora com o que fizeram. M alunos não compareceram. Ninguém mais poderá entrar." Com N e M do momento. Confirmado, a sala fecha e a docente vai ao detalhe da avaliação.

**Detalhe da avaliação:**

- A seção *Tentativas* passa a listar também **quem não compareceu**, na situação *Não compareceu*, sem início nem entrega. Isso só aparece depois de a prova ser finalizada ou de o período terminar.
- No lugar de *Abrir a sala da prova*, a frase "Finalizada por <nome> às HH:MM."

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Admissão (RN-01, RN-02):** a sala guarda a admissão no banco (D-01). `Admit(ctx, actor, assessment, studentIDs)` admite de 1 a 200 alunos elegíveis por chamada; quem já foi admitido é ignorado. O servidor manda `room:admitted` a cada um que está conectado.
- **Entrada na tentativa (RN-03):** `POST .../attempt` passa a exigir a admissão. Sem ela, `409 attempt-not-admitted`. A tentativa já existente continua: quem já tem tentativa em andamento volta para ela sem nova admissão (a janela recarregada não pede de novo).
- **Finalizar (RN-04, RN-05):** `Finish(ctx, actor, assessment)` grava o instante e quem finalizou e, numa transação, encerra as tentativas em andamento como `ENDED_BY_TEACHER` com o motivo fixo "A docente finalizou a prova." (D-02) e a nota preliminar calculada como na entrega. Avisa cada aluno conectado com `room:ended` e fecha a sala.
- **Acesso depois de finalizada:** `AccessOf` devolve `ENDED`, e a fase da avaliação passa a `ENDED` com o fim antecipado.

## 4. Modelo de Dados (Data Model)

- **Tabela nova `assessment_admissions`:** `assessment_id`, `student_id`, `admitted_at`, `admitted_by`; chave primária (`assessment_id`, `student_id`). Só cresce: a admissão não se desfaz.
- **`assessments`:** colunas novas `finished_at` e `finished_by`, nulas.
- **Migração 00051**, com a descida.
- **Glossário:** *Admissão na prova* (`AssessmentAdmission`) e *Finalizar a prova* (`finished_at`, `finished_by`, rota `.../finish`); *Não compareceu* como situação derivada, sem guardar.

## 5. Contrato de API (API Contract)

| Rota | Quem | O quê | Sucesso |
| :--- | :--- | :--- | :--- |
| `POST .../assessments/{id}/admissions` | Docente dona, administrador | Admitir: `{ "studentIds": [...] }`, de 1 a 200 (RN-01) | `200` com `{ "admitted": [...] }` |
| `POST .../assessments/{id}/finish` | Docente dona, administrador | Finalizar a prova (RN-04) | `200` com `finishedAt`, `finishedBy`, `ended` (quantas tentativas encerrou) e `absent` |
| `POST .../attempt` (SPEC-090) | Estudante | Passa a exigir a admissão (RN-03) | — |
| `GET .../attempts` (SPEC-090) | Docente dona, administrador | Ganha as linhas de *Não compareceu* depois do fim (RN-06) | — |

**Sala (WebSocket):**

| Mensagem | Direção | O quê |
| :--- | :--- | :--- |
| `room:student` (já existe) | servidor → docente | O cartão ganha `requesting: true` quando o aluno conectado espera admissão depois do início |
| `room:admitted` (já existe) | servidor → estudante | Agora só depois da admissão |
| `room:ended` (já existe) | servidor → estudante | Também ao finalizar, com o motivo da RN-04 |

**Erros novos:** `409 attempt-not-admitted` (entrar sem admissão), `409 assessment-not-started` (admitir antes do início), `409 assessment-finished` (admitir, entrar ou finalizar de novo depois de finalizada); `403` para estudante e outra docente; `400 invalid-admission` (lista vazia, acima de 200 ou aluno não elegível).

## 6. Impacto e Riscos (Impact & Risks)

- **Turma grande na porta.** 40 pedidos ao mesmo tempo. **Mitigação:** *Admitir todos (N)* numa chamada só.
- **Aluno que já está fazendo a prova** quando esta spec entra no ar: ele tem tentativa e segue sem admissão (RN-03).
- **Finalizar por engano** encerra a prova de quem ainda faz. **Mitigação:** o diálogo diz quantos estão fazendo; não há como desfazer, e o diálogo diz isso.
- **Muda o fluxo aprovado na SPEC-091.** Os testes da SPEC-091 que esperam a admissão de todos no início mudam num commit `test(...)` antes do código.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente inicia a prova, O servidor NÃO DEVE admitir ninguém; os alunos conectados DEVEM aparecer à docente como *Pedindo para entrar* (RN-02).
- [ ] **CA-02** (evento): QUANDO a docente admite um ou vários alunos, O servidor DEVE guardar a admissão e mandar `room:admitted` a cada um conectado, e a janela dele DEVE entrar na prova (RN-01).
- [ ] **CA-03** (indesejado): SE o aluno sem admissão pede a tentativa, ENTÃO O servidor DEVE responder `409 attempt-not-admitted`; o aluno com tentativa em andamento DEVE voltar a ela sem admissão (RN-03).
- [ ] **CA-04** (indesejado): SE quem admite ou finaliza é estudante ou outra docente, ENTÃO 403; SE admite antes do início, `409 assessment-not-started`; SE a lista é vazia, passa de 200 ou tem aluno não elegível, `400 invalid-admission`.
- [ ] **CA-05** (evento): QUANDO a docente finaliza a prova, O servidor DEVE gravar quem e quando, encerrar as tentativas em andamento como `ENDED_BY_TEACHER` com "A docente finalizou a prova." e a nota preliminar, avisar os alunos conectados e recusar novas entradas e admissões com `409 assessment-finished` (RN-04, RN-05).
- [ ] **CA-06** (estado): ENQUANTO a prova está finalizada ou o período terminou, A lista das tentativas DEVE trazer os elegíveis sem tentativa como *Não compareceu* (RN-06).
- [ ] **CA-07** (estado): ENQUANTO a docente está na sala depois do início, A sala DEVE mostrar a faixa *Pedindo para entrar (N)* com *Admitir*, *Admitir os selecionados* e *Admitir todos (N)*, e o botão *Finalizar a prova* com o diálogo que diz quantos estão fazendo e quantos faltaram; confirmado, DEVE levar ao detalhe.
- [ ] **CA-08** (estado): ENQUANTO o aluno espera a admissão depois do início, A janela DEVE dizer "Pedido de entrada enviado. Aguarde a docente admitir você."; QUANDO a prova é finalizada, DEVE travar com o aviso da seção 3.1.
- [ ] **CA-09** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, com teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):**
  - `repository`: `TestMigration00051_UpAndDown`, `TestAdmissions_InsertIgnoresTheAdmitted`.
  - `service`: `TestStart_AdmitsNobody` (CA-01), `TestAdmit_SavesAndRefusesBeforeStartAndNotEligible` (CA-02, CA-04), `TestEnterAttempt_NeedsTheAdmissionButNotToGoBack` (CA-03), `TestFinish_EndsTheAttemptsInProgressAndRefusesAfter` (CA-05), `TestAttempts_ListTheAbsentAfterTheEnd` (CA-06).
  - `handler`: as rotas `admissions` e `finish` com os códigos (CA-02, CA-04, CA-05); a sala com `requesting` e `room:admitted` só depois da admissão (CA-01, CA-02).
- **Frontend (Vitest + Testing Library):**
  - `room/page.test.tsx` ou `ExamRoom`: a faixa, admitir um, os selecionados e todos, e finalizar com o diálogo e a ida ao detalhe (CA-07).
  - `take/page.test.tsx`: a espera da admissão e o travamento ao finalizar (CA-08).
  - `AssessmentAttempts.test.tsx`: *Não compareceu* (CA-06).
- **Roteiro manual:** a docente inicia; dois alunos pedem; ela admite um, depois o outro pelo *Admitir todos*; um entrega, o outro fica fazendo; ela finaliza e confere o detalhe com a entrega forçada e os ausentes.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-054, 083, 089, 090, 091 e 092.
2. **Arquivos:** `backend/migrations/00051_*`, `backend/internal/modules/assessment/` (`domain`, `service`, `repository`, `handler`, inclusive `handler/room.go`), `frontend/src/services/assessmentService.ts`, a sala (`room/`, `ExamRoom`), `take/page.tsx`, `AssessmentAttempts`, o detalhe da avaliação, `messages/pt-BR.ts` e `GLOSSARY.md`.
3. Os testes da SPEC-091 que esperam a admissão de todos no início mudam primeiro, num commit `test(...)`, junto com os testes novos vermelhos.

## 10. Decisões (antes: pendências para aprovação)

O Tech Lead aprovou em 05/11/2026 ("Aprovo") com as recomendações como estavam.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **Guardar a admissão no banco** (tabela nova) ou só na memória da sala, como a espera de hoje. | **No banco.** É a única forma de o servidor recusar a entrada de quem não foi admitido (CA-03), e um reinício não faz a docente admitir todos de novo. |
| D-02 | **Situação da tentativa encerrada ao finalizar:** reaproveitar `ENDED_BY_TEACHER` com o motivo fixo, ou criar uma situação nova. | **Reaproveitar** `ENDED_BY_TEACHER` com "A docente finalizou a prova.": a correção já sabe tratar essa situação, e o motivo diferencia do flagrante. |
| D-03 | **Admissão antes do início:** a docente pode admitir quem está na sala de espera antes de iniciar? | **Não.** Segue o fluxo pedido: iniciar, depois os pedidos, depois admitir. Os que esperavam viram *Pedindo para entrar* no início. |
| D-04 | **Recusar um pedido** (aluno não está na sala, por exemplo). | **Sem recusar nesta spec.** O pedido fica esperando até ser admitido ou até a prova ser finalizada, quando o aluno vira *Não compareceu*. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a pedido do Tech Lead no roteiro manual de 05/11/2026. Pendências D-01 a D-04. |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo"), com as recomendações das pendências como estavam. Status: `Aprovada` |
