# SPEC-095: Respostas do Aluno na Sala da Prova

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-095 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a leitura da tentativa de um aluno pela docente; frontend: a aba *Respostas* no painel do aluno da sala) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/room` (a sala da prova) e a janela da prova do estudante (o aviso da sala de espera) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-090 (a tentativa e as respostas salvas), SPEC-091 (a sala da prova), SPEC-092 revisão 3 (as abas do painel do aluno), SPEC-093 (a conversa, onde a dúvida aparece) |
| **Substitui** | Nenhuma. Revoga, só para a docente dona e o administrador durante a prova, a frase "As respostas de cada aluno não saem nesta spec" da SPEC-090 RN-09. |
| **Fontes canônicas** | Pedido do Tech Lead em 05/11/2026, no roteiro manual do chat da prova: "o professor pode ver as questões que o aluno já marcou; às vezes o professor ajuda na avaliação, o aluno está com dúvidas, e o professor pode visualizar qual questão ele marcou". |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na sala da prova (SPEC-091 e 092), a docente abre um aluno e vê o terminal, os comandos e a questão em que ele está. Quando o aluno pede ajuda ou escreve na conversa (SPEC-093) com uma dúvida sobre uma questão objetiva, a docente não sabe o que ele marcou: a SPEC-090 RN-09 deixou as respostas fora da leitura da docente, e não existe rota para isso. Ela precisa perguntar ao aluno, o que gasta o tempo dele.

## 2. Objetivos (Goals)

- A docente dona e o administrador veem, na sala, **o que o aluno aberto marcou ou escreveu em cada questão**, enquanto a prova corre.
- A leitura se atualiza sozinha enquanto a aba está aberta.
- O aluno sabe, desde a sala de espera, que a docente pode ver as respostas.

### 2.1. Fora de escopo (Non-Goals)

- Mudar as respostas do aluno, ou marcar por ele (SPEC-091 continua proibindo).
- Correção, nota e homologação (rascunho `revisao-avaliacoes-telemetria-mcp`).
- Ver as respostas na seção *Tentativas* do detalhe depois da prova (fica para a correção).
- Aviso ao vivo a cada resposta salva pela sala (WebSocket): a leitura é por REST (D-01).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Aba *Respostas*** no painel lateral da sala, entre *Aluno* e *Pedidos de ajuda (N)* (D-03), no mesmo padrão acessível de abas (SPEC-092 revisão 3). Sem aluno aberto, a aba mostra a dica "Abra um aluno para ver as respostas dele."
- **Conteúdo, uma linha por questão**, na ordem da tentativa: "Questão N", o título, o tipo e:
  - **Escolha única:** as alternativas com a letra, a marcada pelo aluno em destaque ("Marcou C") e, com a D-02, a correta com um sinal discreto ("Correta: D").
  - **Verdadeiro ou falso:** "Marcou Verdadeiro" ou "Marcou Falso"; com a D-02, a correta.
  - **Ligar colunas:** os pares que o aluno ligou; com a D-02, cada par certo ou errado.
  - **Descritiva:** o texto do aluno, só leitura (HTML filtrado, como é guardado).
  - **Prática:** "Conferida: resolvida" ou "Ainda não resolvida", e o lembrete de que o terminal está na aba *Aluno*.
  - Sem resposta: "Sem resposta".
- **A questão em que o aluno está** (SPEC-092 revisão 2) fica marcada na lista ("Está nesta"), e a lista rola até ela ao abrir.
- **Atualização:** ao abrir a aba, ao abrir outro aluno e a cada 10 segundos enquanto a aba está visível; um botão *Atualizar* força a leitura (D-01).
- **Aviso ao aluno (D-04):** a frase da sala de espera passa a "Durante a prova, a docente pode ver a sua tela, os comandos que você executa e as suas respostas."
- Textos novos em `messages/pt-BR.ts`; teclado, contraste AA e alvos de 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Rota nova** `GET /api/v1/classes/{id}/assessments/{assessmentId}/attempts/{attemptId}` (RN-01).
- **Service:** `AttemptForTeacher(ctx, actor, classID, assessmentID, attemptID)`: confere a docente dona ou o administrador, carrega a tentativa e as questões dela e devolve a visão abaixo. Lê; não grava nada e não muda o vencimento (SPEC-090 RN-07 continua valendo só na leitura e na escrita do aluno e na varredura).

## 4. Modelo de Dados (Data Model)

Nenhuma mudança. Usa as tabelas da tentativa (SPEC-090) como estão: a visão do aluno, o gabarito do momento da entrada e as respostas salvas.

## 5. Contrato de API (API Contract)

| Rota | Quem | O quê | Sucesso |
| :--- | :--- | :--- | :--- |
| `GET .../attempts/{attemptId}` | Docente dona, administrador | A tentativa de um aluno com as respostas (RN-01, RN-02) | `200` |

**Resposta:** `attemptId`, `studentId`, `studentName`, `status`, `startedAt`, `submittedAt` (quando há), `serverNow` e `items`, cada um com `position`, `kind`, `weight`, `title`, `studentView`, `answer` (quando há), `checkedSolved` (só na prática) e, com a D-02, `answerKey` (só nas objetivas: escolha única, verdadeiro ou falso, ligar colunas). Nunca `points` nem `preliminaryScore`.

**Erros:** `403 forbidden` para o estudante e para outra docente; `404 attempt-not-found` quando a tentativa não é dessa avaliação.

## 6. Impacto e Riscos (Impact & Risks)

- **Carga da atualização a cada 10 s.** Uma leitura por docente com a aba aberta, de um aluno só. **Mitigação:** a leitura para quando a aba fica escondida ou a página perde a visibilidade.
- **A docente vê o gabarito ao lado da resposta** (D-02). Ela é a autora da prova e já o conhece; o gabarito nunca sai para o estudante (SPEC-090 RN-10 continua).

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador lê a tentativa de um aluno, O servidor DEVE devolver as questões na ordem da tentativa, com a visão do aluno, a resposta salva e, na prática, se foi conferida como resolvida; com a D-02, o gabarito das objetivas; NUNCA os pontos nem a nota (RN-01, RN-02).
- [ ] **CA-02** (indesejado): SE quem lê é o estudante ou outra docente, ENTÃO O servidor DEVE responder 403; SE a tentativa não é da avaliação, 404.
- [ ] **CA-03** (estado): ENQUANTO a docente está na sala com um aluno aberto, A aba *Respostas* DEVE mostrar cada questão com o que o aluno marcou ou escreveu, "Sem resposta" quando não há, e a questão em que ele está marcada; sem aluno aberto, a dica.
- [ ] **CA-04** (evento): QUANDO a aba está visível, A sala DEVE reler a tentativa a cada 10 segundos e ao clicar em *Atualizar*; QUANDO a aba está escondida, NÃO DEVE reler.
- [ ] **CA-05** (estado): ENQUANTO o estudante está na sala de espera, O aviso DEVE dizer que a docente pode ver a tela, os comandos e as respostas (D-04).
- [ ] **CA-06** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, com o padrão de abas acessível, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):**
  - `service`: `TestAttemptForTeacher_GivesTheAnswersAndTheKeyNeverThePoints` (CA-01), `TestAttemptForTeacher_ForbiddenToStudentsAndOtherTeachers` e `TestAttemptForTeacher_NotOfThisAssessment` (CA-02).
  - `handler`: `TestAttemptForTeacherRoute` com as chaves exatas da resposta (CA-01, CA-02).
- **Frontend (Vitest + Testing Library):**
  - `room/page.test.tsx`: a aba *Respostas* com cada tipo de questão, "Sem resposta", a questão atual e a dica sem aluno (CA-03); a releitura a cada 10 s só com a aba visível e o *Atualizar* (CA-04).
  - `take/page.test.tsx`: o aviso novo da sala de espera (CA-05).
- **Roteiro manual:** com a prova completa de 05/11/2026, o aluno marca a escolha única e o verdadeiro ou falso e liga as colunas; a docente abre o aluno, a aba *Respostas*, e vê as marcações aparecerem em até 10 segundos.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-090 a 093.
2. **Arquivos:** `backend/internal/modules/assessment/` (`service`, `handler` e a rota), `frontend/src/services/assessmentService.ts`, a página e os componentes da sala (`room/`), `take/page.tsx` (o aviso) e `frontend/src/messages/pt-BR.ts`.
3. Testes antes, vermelhos, num commit `test(...)`; depois o código.

## 10. Decisões (antes: pendências para aprovação)

O Tech Lead aprovou em 05/11/2026 ("Aprovo") com as recomendações como estavam.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **Como a aba se atualiza:** (a) leitura por REST ao abrir, a cada 10 s com a aba visível e no *Atualizar*; (b) a sala avisa ao vivo cada resposta salva (WebSocket). | **(a).** Não mexe na sala nem na gravação das respostas; 10 s bastam para tirar uma dúvida. (b) fica para depois, se fizer falta. |
| D-02 | **Mostrar a resposta correta ao lado da do aluno**, só para a docente? | **Sim, discreta.** Ela é a autora e já sabe o gabarito; ver "Marcou C · Correta: D" lado a lado poupa abrir a questão. |
| D-03 | **Onde fica:** (a) aba nova *Respostas* no painel do aluno; (b) dentro da aba *Aluno*, abaixo do terminal. | **(a) aba nova.** A aba *Aluno* já divide a altura entre terminal e comandos; uma aba própria dá espaço às descritivas. |
| D-04 | **Avisar o aluno** de que a docente vê as respostas, na frase da sala de espera? | **Sim.** A sala já avisa da tela e dos comandos (SPEC-091 D-04); as respostas seguem a mesma transparência. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a pedido do Tech Lead no roteiro manual do chat da prova. Pendências D-01 a D-04. |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo"), com as recomendações das pendências como estavam. Status: `Aprovada` |
