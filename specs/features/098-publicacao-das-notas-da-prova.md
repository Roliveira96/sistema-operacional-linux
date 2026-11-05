# SPEC-098: Publicação das Notas da Prova (o Aluno Vê a Nota, a Anotação e a Correção)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-098 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: publicar as notas e a leitura do resultado pelo aluno; frontend: o botão *Publicar as notas* na correção e o resultado do aluno) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/review` (a correção, SPEC-097), o detalhe da avaliação do aluno e `/app/classes/[id]/assessments/[assessmentId]/result` (tela nova do aluno) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-090 (a tentativa e o que o aluno lê), SPEC-096 (finalizar a prova, *Não compareceu*), SPEC-097 (a correção, a nota final e a anotação ao aluno) |
| **Substitui** | Nenhuma. Responde à SPEC-097 D-02. Toma do rascunho `revisao-avaliacoes-telemetria-mcp` só a consulta do resultado pelo estudante (seção 5.5); a homologação formal continua lá. |
| **Fontes canônicas** | SPEC-097 D-02, aprovada pelo Tech Lead em 05/11/2026: "o aluno vê a nota e a anotação quando a docente publica as notas da prova inteira, numa spec seguinte"; escolha do Tech Lead em 05/11/2026 da próxima demanda: "Publicar as notas". |

---

## 1. Contexto e Problema (Context & Problem Statement)

A correção (SPEC-097) guarda, para cada tentativa revisada, a nota final, os pontos de cada questão com o motivo do ajuste e a anotação ao aluno. O aluno, porém, só lê "Prova entregue." (SPEC-090 RN-10: a tentativa nunca mostra o gabarito nem a nota). Falta o ato da docente de **liberar** as notas e o lugar onde o aluno as **vê**.

## 2. Objetivos (Goals)

- A docente **publica as notas** da prova inteira, de uma vez, pela tela de correção.
- Depois da publicação, o aluno vê no detalhe da avaliação a **nota final** e a **anotação ao aluno**, e abre a **correção** da prova dele.
- Quem não compareceu não vê resultado.
- Depois de publicadas, as notas ficam gravadas: a revisão não reabre mais.

### 2.1. Fora de escopo (Non-Goals)

- Aviso por e-mail ou notificação da publicação.
- Boletim da turma, média, exportação de notas e integração com sistema acadêmico.
- **Contestação do resultado pelo aluno (recurso): fica para uma funcionalidade futura**, por decisão do Tech Lead de 05/11/2026 ("nesse primeiro momento não vai poder contestar o resultado, para agilizar o processo; fica registrado para uma nova feature no futuro").
- A atividade (só a prova, como a SPEC-090 D-05).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Correção (docente, SPEC-097):**

- No cabeçalho da tela, o botão **Publicar as notas**. Fica travado até todos os que entregaram estarem revisados (D-01), com a razão: "Revise todos os alunos antes de publicar (N de M revisados)."
- Um diálogo confirma: "Publicar as notas? Os alunos que entregaram verão a nota final, a anotação ao aluno e a correção. Depois de publicadas, as notas não mudam mais." Confirmado, o cabeçalho passa a "Notas publicadas por <nome> em DD/MM/AAAA às HH:MM."
- Depois de publicada, a tela fica só leitura: sem ajuste de pontos, sem *Concluir* e sem *Reabrir a revisão* (D-04). As anotações também ficam como estavam.

**Detalhe da avaliação (aluno):**

- Antes da publicação, como hoje: "Prova entregue em …".
- Depois: **"Sua nota: 7,50 de 10,00"**, a anotação ao aluno (quando há) e o botão **Ver a correção**.
- Quem não compareceu: nada muda, não há resultado nem botão (D-03).

**Resultado do aluno** (`/result`, só o aluno; a docente volta para a avaliação):

- O cabeçalho com a nota final e a anotação ao aluno.
- Por questão, na ordem da tentativa (D-02): o título, o enunciado, **a resposta do aluno**, **a correta das objetivas** (escolha única, verdadeiro ou falso, os pares), **os pontos** que valeram e, quando a docente ajustou, **o motivo**. A descritiva mostra o texto do aluno e os pontos; a prática mostra se ficou resolvida e os pontos.
- Nunca: a anotação privada, a resposta esperada da descritiva, os comandos, a nota automática.
- Textos em `messages/pt-BR.ts`; teclado, contraste AA e alvos de 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Publicar** (`PublishGrades`): docente dona ou administrador, prova terminada, todos os que entregaram revisados (D-01); grava `grades_published_at` e `grades_published_by`. Publicar de novo não muda nada (D-05).
- **Depois de publicada** (D-04): ajustar pontos, gravar anotações, concluir e reabrir a revisão respondem `409 grades-published`.
- **Resultado do aluno** (`MyResult`): o aluno que entregou, depois da publicação; devolve a nota final, a anotação ao aluno e as questões da RN-03. Antes da publicação, ou sem tentativa (não compareceu, D-03): `404 result-not-published`.
- **Resumo da avaliação:** ganha `gradesPublishedAt` e `gradesPublishedByName`; o público (do aluno) ganha `gradesPublished`.

## 4. Modelo de Dados (Data Model)

Migração **00053**: `assessments.grades_published_at timestamptz` e `assessments.grades_published_by uuid REFERENCES users (id)`, nulos. A nota de cada questão que o aluno vê é a do ajuste, quando há, senão a automática (a mesma conta da SPEC-097).

## 5. Contrato de API (API Contract)

| Rota | Quem | O quê | Sucesso |
| :--- | :--- | :--- | :--- |
| `POST .../assessments/{id}/grades/publish` | Docente dona, administrador | Publicar as notas (RN-01, RN-02) | `200` com o resumo |
| `GET .../assessments/{id}/my-result` | Estudante | O resultado dele (RN-03, RN-04) | `200` |

**Resultado** (`my-result`): `finalScore`, `maxScore`, `studentNote` (quando há) e `items`, cada um com `position`, `kind`, `weight`, `title`, `studentView`, `answer` (quando há, nunca a máquina da prática), `checkedSolved` (só na prática), `answerKey` (só nas objetivas), `points` e `adjustReason` (quando a docente ajustou). Nunca `teacherNote`, `expectedAnswer`, comandos, `preliminaryScore` nem os pontos automáticos de uma questão ajustada.

**Erros:** `409 reviews-pending` (publicar com alguém sem revisão); `409 assessment-not-ended`; `409 grades-published` (mudar a correção depois de publicada); `403` para estudante publicar e para outra docente; `404 result-not-published` (antes da publicação, ou para quem não compareceu); `403 not-eligible` (aluno fora da prova).

**Regras:**

- **RN-01:** publicar exige a prova terminada e todos os que entregaram com a revisão concluída.
- **RN-02:** a publicação vale para a prova inteira e não se desfaz; publicar de novo não muda quem nem quando.
- **RN-03:** o aluno vê só a própria tentativa, com o que a seção 5 lista; a anotação privada e a resposta esperada nunca saem.
- **RN-04:** depois da publicação, a correção não muda mais: ajuste, anotações, concluir e reabrir são recusados.

## 6. Impacto e Riscos (Impact & Risks)

- **O aluno vê o gabarito das objetivas.** É o pedido da correção; outra turma que faça a mesma prova depois veria as respostas circulando. **Mitigação:** o gabarito só sai depois da publicação, que é decisão da docente.
- **Um erro descoberto depois de publicar** não se corrige pelo sistema nesta spec (RN-04). **Mitigação:** a docente revisa todos antes (D-01); a contestação e a correção depois da publicação ficam para a funcionalidade futura do recurso.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente publica com todos revisados, O servidor DEVE gravar quem e quando; com alguém sem revisão, `409 reviews-pending`; antes do fim, `409 assessment-not-ended` (RN-01, RN-02).
- [ ] **CA-02** (evento): QUANDO o aluno lê o resultado depois da publicação, O servidor DEVE devolver a nota final, a anotação ao aluno e as questões com a resposta, a correta das objetivas, os pontos e o motivo do ajuste, e NUNCA a anotação privada, a resposta esperada, os comandos nem a nota automática (RN-03).
- [ ] **CA-03** (indesejado): SE o aluno lê antes da publicação, ou não compareceu, ENTÃO `404 result-not-published`; SE a docente tenta ajustar, anotar, concluir ou reabrir depois da publicação, ENTÃO `409 grades-published` (RN-04, D-03, D-04).
- [ ] **CA-04** (estado): ENQUANTO a docente está na correção, A tela DEVE ter *Publicar as notas*, travado com a razão até todos estarem revisados, com o diálogo; depois, "Notas publicadas por …" e a correção só leitura.
- [ ] **CA-05** (estado): ENQUANTO as notas estão publicadas, O detalhe do aluno que entregou DEVE mostrar "Sua nota: X de Y", a anotação ao aluno e *Ver a correção*; quem não compareceu NÃO DEVE ver resultado; antes da publicação, como hoje.
- [ ] **CA-06** (estado): ENQUANTO o aluno está no resultado, A tela DEVE mostrar cada questão com a resposta dele, a correta das objetivas, os pontos e o motivo do ajuste.
- [ ] **CA-07** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, com teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):** `repository`: `TestMigration00053_UpAndDown`; `service`: `TestPublishGrades_NeedsEveryReviewAndKeepsWhoAndWhen` (CA-01), `TestMyResult_GivesTheGradeAndNeverThePrivate` (CA-02), `TestMyResult_HiddenBeforePublishingAndToTheAbsent` e `TestReview_LockedAfterPublishing` (CA-03); `handler`: as rotas com as chaves exatas e os códigos.
- **Frontend (Vitest):** a correção com o botão travado, o diálogo e a frase depois (CA-04); o detalhe do aluno antes e depois, e o ausente sem resultado (CA-05); a página `/result` (CA-06).
- **Roteiro manual:** corrigir os alunos da prova de 05/11/2026, publicar, entrar como aluno e conferir a nota, a anotação e a correção; conferir que a correção da docente ficou só leitura e que um aluno ausente não vê resultado.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-090, 096 e 097.
2. **Arquivos:** `backend/migrations/00053_*`, `backend/internal/modules/assessment/` (`domain`, `service`, `repository`, `handler`), `frontend/src/services/assessmentService.ts`, `ExamReview`, o detalhe da avaliação (`AttemptAction` ou o cartão do aluno), a página nova `result/`, `messages/pt-BR.ts` e `GLOSSARY.md` (*Publicação das notas*, *Resultado da prova*).
3. Testes antes, vermelhos, num commit `test(...)`; depois o código. Como na SPEC-097, em tarefas pequenas: T1 backend (migração, publicar), T2 backend (resultado do aluno), T3 frontend (publicar na correção), T4 frontend (detalhe do aluno e a tela de resultado).

## 10. Decisões (antes: pendências para aprovação)

Respondidas pelo Tech Lead em 05/11/2026.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Publicar só com todos revisados.** "O aluno só vai ver a sua nota depois que o professor revisar a prova; o aluno poderá visualizar depois que a prova for finalizada para todos." |
| D-02 | **O aluno vê a nota, a anotação ao aluno e, por questão, a resposta dele, a correta das objetivas, os pontos e o motivo do ajuste** (recomendação aceita). |
| D-03 | **Quem não compareceu não vê resultado.** "Quem não compareceu não pode ver os resultados da prova." |
| D-04 | **Depois de publicadas, as notas ficam gravadas e a correção não muda mais.** A docente ajusta antes de publicar: "o professor, depois que corrigir a prova, vai mostrar, antes não, e esse valor vai ficar salvo." |
| D-05 | **Não se despublica** (recomendação aceita). |
| D-06 | **Sem contestação nesta spec**: o recurso do aluno fica registrado como funcionalidade futura. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a pedido do Tech Lead (próxima demanda depois da SPEC-097). Pendências D-01 a D-05. |
| 05/11/2026 | Aruna Architect | Decisões do Tech Lead incorporadas: D-01 publicar só com todos revisados; D-03 o ausente não vê resultado; D-04 depois de publicada a correção fica gravada e não reabre (`409 grades-published`); D-06 a contestação fica para o futuro. Aguarda o "aprovo". |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo"), com as decisões D-01 a D-06. Status: `Aprovada` |
