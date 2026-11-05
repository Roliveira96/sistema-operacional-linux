# SPEC-097: Correção da Prova pela Docente (Revisão de Cada Tentativa Entregue)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-097 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a leitura da tentativa para a correção, o ajuste da nota de cada questão, as anotações e a conclusão da revisão; frontend: a tela de correção) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/review` (tela nova) e o detalhe da avaliação (o botão *Corrigir a prova*) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-090 (a tentativa, a nota preliminar e as pendentes), SPEC-091 (os comandos e os pedidos de ajuda guardados), SPEC-093 (a conversa da tentativa), SPEC-095 (a leitura da tentativa pela docente), SPEC-096 (finalizar a prova) |
| **Substitui** | Nenhuma. Toma do rascunho `revisao-avaliacoes-telemetria-mcp` só a revisão individual com o ajuste de nota; a telemetria, a reprodução da sessão, a correção em lote pelo MCP e a homologação continuam lá. |
| **Fontes canônicas** | Pedido do Tech Lead em 05/11/2026, no roteiro manual: "o professor finalizou a prova, ele pode corrigir a prova; uma tela dedicada, ao qual o professor poderá selecionar um dos alunos que entregou a prova e revisar se tá tudo certo; poderá ver todos os comandos usados em cada questão, as alternativas selecionadas; poderá realizar o ajuste no valor da questão; poderá dar uma anotação privada e uma anotação ao aluno sobre a prova; poderá visualizar todos os pedidos de ajuda e o chat da prova; a ideia é que o professor finalize a revisão da prova." |

---

## 1. Contexto e Problema (Context & Problem Statement)

Quando a prova termina, a docente tem só a seção *Tentativas* do detalhe: o aluno, a situação, a nota preliminar calculada na entrega (SPEC-090 RN-08), as descritivas pendentes e a conversa (SPEC-093). Ela não vê o que cada aluno respondeu depois da prova, não vê os comandos de cada prática nem os pedidos de ajuda, não consegue dar nota à descritiva nem corrigir uma nota automática errada (um gabarito mal escrito, uma prática resolvida por um caminho que a condição não previu), e não tem onde deixar uma observação. O banco já guarda tudo o que a correção precisa ler: as questões congeladas com a resposta, os pontos e a conferência (`assessment_attempt_items`), os comandos (`assessment_attempt_commands`), os pedidos de ajuda (`assessment_help_requests`) e a conversa (`assessment_chat_messages`).

## 2. Objetivos (Goals)

- Uma **tela de correção** por prova, em que a docente escolhe um aluno que entregou e revisa a tentativa dele, questão por questão.
- Em cada questão: o enunciado, a resposta do aluno (a alternativa, o verdadeiro ou falso, os pares, o texto, a prática conferida), o gabarito das objetivas, **todos os comandos** daquela questão, os pontos automáticos e o **ajuste dos pontos**.
- Na tentativa: os **pedidos de ajuda** com as respostas, a **conversa** inteira, uma **anotação privada** e uma **anotação ao aluno**.
- **Concluir a revisão** do aluno, com a nota final; a tela mostra quantos faltam.

### 2.1. Fora de escopo (Non-Goals)

- O aluno ver a nota e a anotação (pendência D-02: a publicação das notas).
- Telemetria, reprodução da sessão, gráficos de tempo, correção em lote pelo MCP e homologação formal (rascunho `revisao-avaliacoes-telemetria-mcp`).
- Corrigir a atividade (só a prova, como a SPEC-090 D-05).
- Mudar a resposta do aluno ou a máquina dele.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Entrada:** no detalhe da avaliação, depois do fim da prova (finalizada pela docente ou fora do período), o botão primário **Corrigir a prova (N de M revisadas)** leva à tela nova. Antes do fim, o botão não aparece (D-06).

**Tela de correção** (`/review`, docente dona e administrador; o estudante volta para a avaliação), em duas colunas no computador e uma embaixo da outra no celular:

- **Coluna dos alunos:** a lista de quem entregou (*Entregue*, *Tempo esgotado*, *Encerrada pela docente*), com o nome, o RA, a nota (preliminar ou final) e a etiqueta *A revisar* ou *Revisada*. Filtro *Todos*, *A revisar*, *Revisados*. Quem não compareceu não aparece.
- **Coluna da tentativa** do aluno escolhido:
  - **Cabeçalho:** nome, RA, situação, início, entrega, duração e, quando a docente encerrou, o motivo; a **nota** "7,50 de 10,00" (automática) e, com ajustes, "8,00 de 10,00 (automática: 7,50)".
  - **Questões**, uma por cartão, na ordem da tentativa: número, título, tipo, peso, a etiqueta do veredito (como a aba *Respostas* da SPEC-095), o enunciado recolhível, a resposta do aluno com o gabarito das objetivas, e:
    - **Prática:** a lista de **todos os comandos** daquela questão, do mais antigo ao mais novo, com a hora, o comando e a saída (recolhível), e se a última conferência deu resolvida.
    - **Descritiva:** o texto do aluno e, para guiar, a resposta esperada que a docente escreveu.
    - **Pontos:** os automáticos e o campo **Pontos nesta questão** (de 0 ao peso, com duas casas), com o **motivo** do ajuste (D-01). Um ajuste mostra "Ajustada de 1,00 para 0,50: <motivo>". *Desfazer o ajuste* volta à automática.
  - **Pedidos de ajuda:** todos os da tentativa, com a questão, a dúvida, a hora, a situação e a resposta.
  - **Conversa:** a conversa inteira da tentativa (o mesmo componente do diálogo *Conversa (N)* da SPEC-093), só leitura.
  - **Anotações:** **Anotação privada** (só a docente vê; até 2.000 caracteres) e **Anotação ao aluno** (até 2.000 caracteres; o aluno só a verá quando houver a publicação, D-02). Gravam ao sair do campo, com "Salvo".
  - **Concluir a revisão:** grava a nota final e marca *Revisada*; travado enquanto houver descritiva sem nota (D-03), com a razão em texto. Depois de concluída, **Reabrir a revisão** (D-04). Ao concluir, a tela vai sozinha ao próximo *A revisar*.
- Textos em `messages/pt-BR.ts`; teclado, contraste AA e alvos de 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Leitura para a correção** (`ReviewOf`): docente dona ou administrador, prova terminada (RN-01), tentativa entregue; devolve o mesmo da SPEC-095 (visão, resposta, gabarito das objetivas) mais, por questão, os pontos automáticos, o ajuste e os comandos; a resposta esperada da descritiva; os pedidos de ajuda; as anotações; a situação da revisão e as notas.
- **Ajustar os pontos de uma questão** (`AdjustItem`): de 0 ao peso, com o motivo (D-01); `null` desfaz. Recalcula a nota da tentativa. Recusado depois de concluída (D-04: reabrir antes).
- **Anotações** (`SaveReviewNotes`): a privada e a do aluno.
- **Concluir** (`FinishReview`) e **reabrir** (`ReopenReview`): concluir exige toda descritiva com pontos (manual ou ajuste) e grava `final_score`, `reviewed_at` e `reviewed_by`; reabrir limpa `reviewed_at`.
- **A lista da docente** (SPEC-090 RN-09) ganha `reviewed` e `finalScore`.

## 4. Modelo de Dados (Data Model)

Migração **00052**:

- `assessment_attempt_items`: `adjusted_points numeric(5,2)` (nulo = vale a automática), `adjust_reason text` (até 300), `adjusted_at`, `adjusted_by`.
- `assessment_attempts`: `teacher_note text` (privada), `student_note text`, `final_score numeric(5,2)`, `reviewed_at`, `reviewed_by`.

A nota final é a soma, por questão, do ajuste quando há, senão dos pontos automáticos.

## 5. Contrato de API (API Contract)

| Rota | Quem | O quê | Sucesso |
| :--- | :--- | :--- | :--- |
| `GET .../attempts/{attemptId}/review` | Docente dona, administrador | A tentativa para a correção (RN-02) | `200` |
| `PUT .../attempts/{attemptId}/items/{position}/points` | Idem | `{ "points": 0.5, "reason": "..." }` ou `{ "points": null }` (RN-03) | `200` com a tentativa |
| `PUT .../attempts/{attemptId}/notes` | Idem | `{ "teacherNote": "...", "studentNote": "..." }` (RN-04) | `204` |
| `POST .../attempts/{attemptId}/review` | Idem | Concluir a revisão (RN-05) | `200` |
| `DELETE .../attempts/{attemptId}/review` | Idem | Reabrir a revisão (RN-05) | `200` |
| `GET .../attempts` (SPEC-090) | Idem | Ganha `reviewed` e `finalScore` | — |

**Erros:** `403` para estudante e outra docente; `404 attempt-not-found`; `409 assessment-not-ended` (antes do fim); `409 attempt-in-progress`; `400 invalid-points` (fora de 0 ao peso, mais de duas casas ou sem motivo); `409 review-done` (ajustar depois de concluída); `409 written-pending` (concluir com descritiva sem nota); `400 invalid-note` (mais de 2.000 caracteres).

**Regras:**

- **RN-01:** a correção existe depois do fim da prova (finalizada pela docente ou passado o término) e só para tentativas entregues.
- **RN-02:** a leitura nunca muda a tentativa.
- **RN-03:** o ajuste vai de 0 ao peso da questão, com até duas casas e o motivo de 1 a 300 caracteres; desfazer limpa ajuste e motivo; a nota é recalculada.
- **RN-04:** as anotações têm até 2.000 caracteres cada, texto puro.
- **RN-05:** concluir exige as descritivas com pontos; reabrir permite ajustar de novo.

## 6. Impacto e Riscos (Impact & Risks)

- **Muitos comandos numa prática.** **Mitigação:** a saída de cada comando vem recolhida, e a lista por questão já vem separada.
- **A nota preliminar e a final.** A preliminar (SPEC-090) continua intacta para histórico; a final é a da revisão.
- **Duas docentes corrigindo o mesmo aluno.** **Mitigação:** a última gravação vale, como no resto da avaliação.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (estado): ENQUANTO a prova terminou, O detalhe DEVE ter *Corrigir a prova (N de M revisadas)*; antes do fim, NÃO DEVE (RN-01, D-06).
- [ ] **CA-02** (evento): QUANDO a docente dona ou o administrador lê a correção de uma tentativa entregue, O servidor DEVE devolver as questões com a resposta, o gabarito das objetivas, a resposta esperada da descritiva, os pontos automáticos e o ajuste, os comandos de cada prática, os pedidos de ajuda, as anotações e a situação da revisão; antes do fim, `409 assessment-not-ended`; estudante ou outra docente, `403` (RN-01, RN-02).
- [ ] **CA-03** (evento): QUANDO a docente ajusta os pontos de uma questão com o motivo, O servidor DEVE guardar o ajuste e recalcular a nota; fora de 0 ao peso ou sem motivo, `400 invalid-points`; QUANDO desfaz, DEVE voltar à automática (RN-03, D-01).
- [ ] **CA-04** (evento): QUANDO a docente grava as anotações, O servidor DEVE guardá-las; a privada NUNCA DEVE sair para o estudante (RN-04).
- [ ] **CA-05** (evento): QUANDO a docente conclui a revisão, O servidor DEVE gravar a nota final, quem e quando; com descritiva sem pontos, `409 written-pending`; QUANDO reabre, DEVE permitir ajustar de novo; ajustar com a revisão concluída é `409 review-done` (RN-05, D-03, D-04).
- [ ] **CA-06** (estado): ENQUANTO a docente está na tela de correção, A tela DEVE listar quem entregou com *A revisar* ou *Revisada* e o filtro, e mostrar a tentativa escolhida com as questões, os comandos por prática, os pontos e o ajuste, os pedidos de ajuda, a conversa e as anotações.
- [ ] **CA-07** (evento): QUANDO a docente conclui a revisão de um aluno, A tela DEVE marcá-lo *Revisada* e abrir o próximo *A revisar*.
- [ ] **CA-08** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, com teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):**
  - `repository`: `TestMigration00052_UpAndDown`; gravar e ler o ajuste, as anotações e a revisão.
  - `service`: `TestReviewOf_GivesEverythingAfterTheEnd` (CA-02), `TestReviewOf_RefusesBeforeTheEndAndOthers` (CA-02), `TestAdjustItem_LimitsReasonAndScore` (CA-03), `TestReviewNotes_KeepsBoth` (CA-04), `TestFinishReview_NeedsTheWrittenAndLocks` (CA-05).
  - `handler`: as rotas com as chaves exatas e os códigos (CA-02 a CA-05); a tentativa do estudante (SPEC-090) sem `teacherNote` (CA-04).
- **Frontend (Vitest + Testing Library):**
  - o detalhe com o botão (CA-01); a página `/review`: a lista, o filtro, a tentativa com cada tipo, os comandos, o ajuste com motivo e o desfazer, as anotações, os pedidos de ajuda, a conversa, concluir e ir ao próximo, reabrir (CA-06, CA-07).
- **Roteiro manual:** com a prova de 05/11/2026 finalizada, corrigir dois alunos: ajustar uma prática, dar nota à descritiva, escrever as anotações, concluir e reabrir.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-090, 091, 093, 095 e 096; o rascunho `revisao-avaliacoes-telemetria-mcp` só como contexto.
2. **Arquivos:** `backend/migrations/00052_*`, `backend/internal/modules/assessment/` (`domain`, `service`, `repository`, `handler`), `frontend/src/services/assessmentService.ts`, a página nova `review/`, o detalhe da avaliação, o `StudentAnswers` (reaproveitado), o diálogo da conversa (reaproveitado), `messages/pt-BR.ts` e `GLOSSARY.md` (*Correção da prova*, *Ajuste de pontos*, *Revisão concluída*, *Anotação privada*, *Anotação ao aluno*).
3. Testes antes, vermelhos, num commit `test(...)`; depois o código.

## 9.1. Tarefas (a pedido do Tech Lead: "quebra em pequenas tasks")

Cada tarefa tem os próprios testes vermelhos, o próprio código e os próprios commits, e pode ser testada sozinha.

| Tarefa | O quê | CAs |
| :--- | :--- | :--- |
| T1 | Backend: migração 00052 e a leitura da correção (`GET .../attempts/{attemptId}/review`) | CA-02 |
| T2 | Backend: o ajuste de pontos de uma questão, com o motivo e o desfazer | CA-03 |
| T3 | Backend: as anotações, concluir e reabrir a revisão, e `reviewed`/`finalScore` na lista | CA-04, CA-05 |
| T4 | Frontend: o botão *Corrigir a prova* no detalhe e a tela `/review` com a lista dos alunos e o filtro | CA-01, CA-06 (lista) |
| T5 | Frontend: a tentativa do aluno escolhido: questões, respostas, comandos por prática, pedidos de ajuda e conversa | CA-06 (tentativa) |
| T6 | Frontend: o ajuste de pontos e as anotações | CA-06 (edição) |
| T7 | Frontend: concluir, reabrir e ir ao próximo; glossário | CA-07, CA-08 |

## 10. Decisões (antes: pendências para aprovação)

O Tech Lead aprovou em 05/11/2026 ("Aprovo, porém quebra em pequenas tasks") com as recomendações como estavam.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **O ajuste de pontos exige motivo?** | **Sim, curto (até 300).** A nota muda depois da prova; o motivo explica ao aluno e a quem revisar depois. |
| D-02 | **Quando o aluno vê a nota e a anotação ao aluno:** (a) ao concluir a revisão dele; (b) quando a docente publica as notas da prova inteira, numa spec seguinte; (c) nesta spec, um botão *Publicar as notas* na tela de correção, liberado quando todos estão revisados. | **(b).** Todos recebem ao mesmo tempo, e a publicação (com o que o aluno vê da correção) merece regras próprias; esta spec já guarda tudo. |
| D-03 | **Concluir com descritiva sem nota:** permitir ou travar? | **Travar**, com a razão em texto: a nota final não pode ficar faltando pontos. |
| D-04 | **Reabrir uma revisão concluída?** | **Sim**, com *Reabrir a revisão*; o ajuste só vale com a revisão aberta. |
| D-05 | **Nota da descritiva:** o mesmo campo *Pontos nesta questão* serve para dar a nota (a automática é "pendente"), sem motivo obrigatório na primeira nota. | **Sim.** A descritiva não tem nota automática; o motivo só é pedido quando muda uma nota já dada. |
| D-06 | **Corrigir antes do fim** (quem já entregou, com a prova ainda correndo)? | **Não.** Só depois do fim: a docente corrige com todos os dados e sem nota mudando enquanto outros ainda fazem. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a pedido do Tech Lead no roteiro manual de 05/11/2026. Pendências D-01 a D-06. |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo, porém quebra em pequenas tasks"), com as recomendações de D-01 a D-06; a seção 9.1 divide o trabalho em T1 a T7. Status: `Aprovada` |
