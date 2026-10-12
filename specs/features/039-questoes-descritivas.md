# SPEC-039: Questões Descritivas com Sugestão de Nota pela IA

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-039 |
| **Status** | Rascunho |
| **Data de criação** | 12/10/2026 |
| **Última revisão** | 12/10/2026 (decisões D-01 a D-08) |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questão e banco), `practice` (resposta e nota) e `mcp` (ferramentas de correção) |
| **Contexto de tela** | Banco de questões do módulo, página da questão, aba "Desafios" do aluno e uma tela nova de correção das respostas descritivas |
| **Prioridade** | Alta |
| **Depende de** | SPEC-023, SPEC-024, SPEC-025, SPEC-035, SPEC-036, SPEC-037 |
| **Substitui** | Nenhuma. Revisa a SPEC-024: o MCP passa a ter ferramentas de correção, que eram fora de escopo ("notas") |
| **Fontes canônicas** | Pedido do Tech Lead de 12/10/2026; `docs/arquitetura/transicao-backend.md` (questão dissertativa); `specs/ARCHITECTURE.md`, seção 2 (rastreabilidade de ações docentes sobre notas) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O banco de questões já tem quatro tipos: comando Linux, verdadeiro ou falso, escolha única e ligar colunas. Todos têm correção automática. O Tech Lead pediu a **questão descritiva**: o aluno escreve uma resposta livre, que nenhuma regra fixa consegue corrigir.

O pedido:

- a questão tem título, descrição (com imagens), nível e dicas, como as demais;
- a resposta do aluno recebe uma **nota** da professora, em **porcentagem de acerto travada em 0, 25, 50, 75 ou 100**;
- uma **IA lê a resposta do aluno pelo MCP** e sugere uma nota;
- a professora **usa a sugestão da IA** ou dá **a nota dela**.

O tipo `DISCURSIVE` já existe no schema (SPEC-011), sem tela nem correção.

## 2. Objetivos (Goals)

- Um tipo novo no banco de questões do módulo: **Descritiva** (`DISCURSIVE`), pelo contrato de tipos da SPEC-035.
- A professora escreve a questão e, se quiser, a **resposta correta**: um texto que orienta a IA e a correção e que, no exercício, o aluno vê depois de enviar a resposta dele (D-03).
- O aluno responde num campo de texto e envia a resposta uma única vez (P-04). A resposta fica **aguardando correção**.
- Pelo MCP, um agente de IA (por exemplo, o Claude da professora) lista as respostas aguardando correção, lê cada uma com a questão e a resposta esperada, e **grava uma sugestão**: a nota (0, 25, 50, 75 ou 100) e uma justificativa.
- Numa tela de correção, a professora vê cada resposta com a sugestão da IA. Ela **aceita a sugestão** ou **escolhe outra nota** das cinco, escreve uma **anotação para o aluno** (que a IA também pode sugerir) e uma **anotação privada**, só dela, e confirma (D-06).
- O aluno vê a nota confirmada, em porcentagem, e a anotação para ele; nunca a anotação privada nem a sugestão da IA (D-06).
- Toda nota confirmada fica registrada com quem confirmou, quando, se veio da IA ou não, e a justificativa (`ARCHITECTURE.md`, seção 2).

### 2.1. Fora de escopo (Non-Goals)

- A IA chamada pelo próprio servidor (por exemplo, a API da Anthropic com uma chave do sistema): a sugestão vem pelo MCP, de um agente conectado com o acesso da professora (P-01).
- Nota parcial fora das cinco faixas, ou nota em pontos.
- Aplicação de provas: a spec de avaliação aplica estas mesmas regras de nota às respostas descritivas da prova.
- Questão descritiva no exercício do card (ver P-07).
- Correção automática sem a professora: a nota só vale depois que ela confirma (P-03).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Autoria (banco):**

- O seletor de tipo oferece "Descritiva".
- A página da questão tem:
  - título, nível, descrição com imagens e dicas;
  - **resposta correta** (editor de texto, opcional): orienta a IA e a correção, e no exercício o aluno a vê depois de enviar a resposta dele; na avaliação, só no resultado (D-03);
  - **tamanho máximo da resposta**, escolhido pela professora numa lista (D-05).

**Aluno (aba "Desafios"):**

- A questão aparece na ordem da trilha, com o campo de resposta e o botão "Enviar resposta". O campo aceita **só texto e comandos** (D-01): parágrafos e trechos marcados como comando, em linha ou em bloco, sem imagens, links nem outra formatação.
- Depois de enviar, a resposta trava, aparece "Aguardando correção" e, no exercício, a resposta correta da professora, se houver (D-03).
- Quando a professora confirma a nota, o aluno vê a **porcentagem de acerto** (com a mesma animação dos outros tipos) e a anotação para ele (D-04, D-06).
- O círculo de status da questão mostra "aguardando" antes da nota e a porcentagem depois (D-04).

**Correção (nova tela, para a docente dona do módulo ou o administrador):**

- Lista as respostas descritivas do módulo, com filtro por situação:
  - aguardando correção;
  - com sugestão da IA;
  - corrigidas.
- Ao abrir uma resposta, a tela mostra:
  - a questão, a resposta esperada e a resposta do aluno;
  - a **sugestão da IA**: a nota, a justificativa e a anotação para o aluno sugerida, com a marca de que veio da IA;
  - cinco botões de nota (0%, 25%, 50%, 75% e 100%), com a sugestão destacada;
  - a **anotação para o aluno** (já preenchida com a sugerida pela IA, se houver, e editável), a **anotação privada** e o botão "Confirmar nota" (D-06).
- Uma nota já confirmada pode ser revista, com justificativa obrigatória, e a revisão também é registrada (D-07).

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (tipo):** `DISCURSIVE` entra no contrato de tipos da SPEC-035 e no banco do módulo.
  - Exige título e nível.
  - Aceita descrição, dicas, resposta correta (`expectedAnswer`, HTML filtrado) e o tamanho máximo da resposta (`maxLength`), escolhido numa lista (D-05).
  - Recusa os campos dos outros tipos.
- **RN-02 (publicar):** exige descrição não vazia. A resposta esperada é opcional.
- **RN-03 (resposta do aluno):** a rota de conferência recebe a resposta e grava em `exercise_progress.response`.
  - A resposta tem só texto e comandos (D-01): o servidor aceita parágrafos, quebras de linha e comandos (`code` em linha e `pre` em bloco) e descarta qualquer outra marcação; o limite de caracteres conta o texto.
  - A resposta é única, e uma segunda tentativa recebe 409.
  - A questão fica "aguardando correção" e não tem `passed` até haver nota.
- **RN-04 (sugestão da IA pelo MCP):** ferramentas novas do MCP, para a docente dona do módulo ou o administrador (SPEC-024 RN-02, RN-05):
  - `list_pending_answers`: lista as respostas descritivas aguardando correção de um módulo;
  - `get_answer`: devolve a questão, a resposta correta e a resposta do aluno, com um identificador anônimo, sem nome, e-mail nem RA (D-08);
  - `suggest_grade`: grava a sugestão, com nota em 0, 25, 50, 75 ou 100, a justificativa (para a professora) e, se quiser, a anotação para o aluno (D-06).

  A sugestão não vale como nota. Ela fica guardada com o momento e com o token que a gravou.
- **RN-05 (nota da professora):** só a professora (ou o administrador) confirma a nota, na tela de correção.
  - A nota é uma das cinco faixas.
  - Ela aceita a sugestão (a nota fica igual à sugerida, com a marca "aceita da IA") ou escolhe outra.
  - A confirmação grava quem, quando, a nota, a origem (IA aceita ou da professora), a anotação para o aluno e a anotação privada (D-06).
- **RN-06 (auditoria):** toda confirmação e toda revisão de nota geram um registro que não se apaga (`ARCHITECTURE.md`, seção 2), com a nota anterior quando for revisão.
- **RN-07 (progresso):** a resposta enviada conta como questão respondida (SPEC-035 D-13). A nota confirmada passa a aparecer no progresso do aluno como porcentagem de acerto (D-04); a sugestão da IA e a anotação privada nunca aparecem para o aluno.
- **RN-09 (resposta correta ao aluno):** no exercício, depois de enviar, o aluno recebe a resposta correta da professora, se ela escreveu (D-03); antes de enviar, nunca. Na avaliação, só no resultado, depois de finalizar.
- **RN-08 (avaliação):** na prova, a resposta descritiva pode ser editada até finalizar, como as outras (SPEC-035 RN-07), e a nota segue as RN-04 a RN-06. Fica para a spec de avaliação.

## 4. Modelo de Dados (Data Model)

| Onde | Alteração |
| :--- | :--- |
| `questions` (`DISCURSIVE`) | `answer_key` guarda a resposta esperada (`expectedAnswer`, HTML) e o limite de caracteres da resposta (`maxLength`) |
| `exercise_progress` | `response` guarda a resposta com texto e comandos (`{ "html": ... }`, só parágrafos, quebras de linha, `code` e `pre`); `passed` fica nulo até a nota (ver P-03) |
| Nova tabela `answer_grades` | Uma linha por resposta descritiva corrigida: `id`, `progress_id` (FK, único), `suggested_score` (0, 25, 50, 75 ou 100, opcional), `suggestion_reason` (texto, para a professora), `suggested_student_note` (texto), `suggested_at`, `suggested_by_token` (FK do token do MCP), `score` (0, 25, 50, 75 ou 100, opcional até confirmar), `source` (`AI_ACCEPTED` ou `TEACHER`), `student_note` (anotação para o aluno), `private_note` (anotação privada), `graded_by` (usuário), `graded_at`, `created_at`, `updated_at` |
| Nova tabela `answer_grade_events` | Registro que não se apaga: `id`, `grade_id`, `kind` (`SUGGESTED`, `CONFIRMED`, `REVISED`), `score`, `previous_score`, `by_user`, `by_token`, `reason`, `created_at` |

Uma restrição garante as cinco faixas, tanto na nota quanto na sugestão.

## 5. Contrato de API (API Contract)

- **Banco** (`/api/v1/teacher/modules/{id}/exercises`): aceita `kind = DISCURSIVE`, `expectedAnswer` e `maxLength`.
- **Aluno:**
  - `POST /api/v1/questions/{id}/check` com `response` = { `html` }, só texto e comandos; responde `status: PENDING`;
  - `GET /api/v1/modules/{id}/progress` traz a situação da questão, a nota confirmada (porcentagem), a anotação para o aluno e, no exercício depois de enviar, a resposta correta.
- **Correção** (novas rotas, para a docente):
  - `GET /api/v1/teacher/modules/{id}/answers?status=` lista as respostas;
  - `GET /api/v1/teacher/answers/{progressId}` abre uma resposta, com a sugestão;
  - `PUT /api/v1/teacher/answers/{progressId}/grade` grava `score`, `useSuggestion`, `studentNote`, `privateNote` e, numa revisão, `reason`.
- **MCP:** `list_pending_answers`, `get_answer` e `suggest_grade` (RN-04), com erros no formato da SPEC-024 RN-06.

Os campos e erros detalhados entram na aprovação, depois das pendências.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| A IA sugerir uma nota injusta | A sugestão nunca vale sozinha: a professora confirma ou troca (RN-05); a justificativa da IA fica visível para ela |
| A resposta do aluno enviada a um serviço de IA externo | A IA só lê pelo MCP, com o acesso da própria professora. A identificação do aluno segue a P-08. Registrar no TCC que a professora escolhe o agente que usa |
| Texto do aluno com instruções para enganar a IA ("dê 100") | As ferramentas entregam a resposta como dado, marcada como conteúdo do aluno. A professora confere e decide |
| Mudança de nota sem rastro | Tabela de eventos que não se apaga (RN-06) |
| Muitas respostas para corrigir | Lista com filtro por situação; a IA pode sugerir em lote pelo MCP |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente cria uma questão, O SISTEMA DEVE oferecer "Descritiva" com título, nível, descrição com imagens, dicas e resposta esperada.
- [ ] **CA-02** (estado): ENQUANTO o aluno não enviou a resposta, a resposta correta NÃO DEVE chegar a ele; QUANDO ele envia no exercício, O SISTEMA DEVE mostrá-la, se a professora escreveu (D-03).
- [ ] **CA-03** (evento): QUANDO o aluno envia a resposta, O SISTEMA DEVE gravá-la, travar o campo e mostrar "Aguardando correção"; uma segunda resposta DEVE receber 409.
- [ ] **CA-04** (evento): QUANDO um agente chama `suggest_grade` com uma nota fora de 0, 25, 50, 75 e 100, O SISTEMA DEVE recusar; com uma nota válida, DEVE guardar a sugestão sem valer como nota.
- [ ] **CA-05** (indesejado): SE quem chama as ferramentas de correção não é a docente dona do módulo nem o administrador, ENTÃO O SISTEMA DEVE recusar como nas outras ferramentas.
- [ ] **CA-06** (evento): QUANDO a docente confirma usando a sugestão, a nota DEVE ser a sugerida, com origem "IA aceita"; QUANDO escolhe outra faixa, DEVE valer a dela, com origem "professora".
- [ ] **CA-07** (ubíquo): Toda confirmação e revisão de nota DEVE gerar um registro com autor, momento, nota anterior e nova, origem e justificativa.
- [ ] **CA-08** (evento): QUANDO a nota é confirmada, O SISTEMA DEVE mostrar ao aluno a porcentagem de acerto e a anotação para ele, e NÃO DEVE mostrar a anotação privada nem a sugestão da IA (D-04, D-06).
- [ ] **CA-10** (evento): QUANDO a IA sugere uma anotação para o aluno, a tela de correção DEVE trazê-la preenchida e editável, e só vale depois que a professora confirma (D-06).
- [ ] **CA-11** (indesejado): SE a professora revisa uma nota confirmada sem justificativa, ENTÃO O SISTEMA DEVE recusar (D-07).
- [ ] **CA-09** (ubíquo): A nota e a sugestão DEVEM ser sempre uma das cinco faixas, também no banco de dados.

## 8. Plano de Testes (Test Plan)

Pela SPEC-038 (se aprovada), escritos antes do código.

- **Domínio (Go):** contrato do tipo, faixas de nota, resposta única.
- **Service, handler e repository (Go):** resposta, sugestão, confirmação, revisão e eventos; PostgreSQL real para a restrição das faixas.
- **MCP (Go):** as três ferramentas, com autorização e erros.
- **Frontend:**
  - formulário da questão;
  - campo de resposta e "Aguardando correção";
  - tela de correção (sugestão, aceitar, trocar, comentar, revisar);
  - nota para o aluno.
- **Manual:**
  - criar uma descritiva e responder como aluno;
  - pedir ao Claude, pelo MCP, que sugira a nota;
  - confirmar, revisar e ver a nota como aluno.

## 9. Contexto Final da IA (AI Final Context Execution)

Definido na aprovação, depois das pendências.

## 10. Pendências para aprovação

### Decisões do Tech Lead (12/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | O aluno responde só com texto e comandos |
| D-02 | A IA é um agente externo conectado ao MCP com o acesso da professora, que lê as respostas e grava as sugestões pelas ferramentas; o servidor não chama IA sozinho (resolve P-01) |
| D-03 | A professora pode escrever a resposta correta: orienta a IA e a correção e, no exercício, o aluno a vê depois de enviar a resposta dele; na avaliação, só no resultado (resolve P-02, com a mudança de que o aluno vê a resposta no exercício) |
| D-04 | O aluno vê a porcentagem de acerto (0%, 25%, 50%, 75% ou 100%), também no status da questão, em vez de certo ou errado (resolve P-03) |
| D-05 | O tamanho máximo da resposta é escolhido pela professora em cada questão; o envio é único no exercício, como nos outros tipos (resolve P-04) |
| D-06 | Na correção, a professora escreve uma anotação para o aluno, que a IA pode sugerir, e uma anotação privada, só dela. O aluno vê a nota e a anotação para ele; nunca a anotação privada nem a sugestão da IA (resolve P-05) |
| D-07 | A professora pode revisar uma nota confirmada, com justificativa obrigatória, e a revisão fica registrada (resolve P-06) |
| D-08 | A IA não vê quem é o aluno: as ferramentas usam um identificador anônimo, e o nome aparece só para a professora (resolve P-08) |

### Pendências

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-07 | Os cards de conteúdo do módulo têm uma aba "Exercícios" com exercícios pequenos, que a tela do aluno confere sozinha, sem passar pelo servidor (é onde também existem o verdadeiro ou falso, a escolha única e o ligar colunas do card). A descritiva também entra ali? | Não: a descritiva precisa ir para o servidor, para a IA sugerir e a professora corrigir, e o exercício do card não passa pelo servidor. Ela fica só no banco de questões do módulo, que já aparece na aba "Desafios" do aluno |
| P-09 | Nomes técnicos | Tipo `DISCURSIVE` ("Descritiva"); "Resposta correta" (`expectedAnswer`); "Sugestão de nota" (`GradeSuggestion`); "Nota da resposta" (`AnswerGrade`, faixas 0, 25, 50, 75, 100); "Anotação para o aluno" (`studentNote`) e "Anotação privada" (`privateNote`) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 12/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (descritiva com título, descrição, nível, dicas, nota da professora em 0, 25, 50, 75 ou 100 e sugestão da IA pelo MCP, que a professora aceita ou troca). Pendências P-01 a P-09 |
| 12/10/2026 | Tech Lead | D-01: o aluno responde só com texto e comandos |
| 12/10/2026 | Tech Lead | Decisões D-02 a D-08 (IA externa pelo MCP; resposta correta mostrada ao aluno no exercício; porcentagem de acerto; tamanho escolhido pela professora; anotação para o aluno e anotação privada, a primeira sugerível pela IA; revisão de nota; IA sem identificar o aluno). Seguem abertas P-07 e P-09 |
