# SPEC-075: Avaliações no Calendário da Turma (agendamento, composição, público, reagendamento, cancelamento e observações privadas)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-075 |
| **Status** | Aprovada |
| **Data de criação** | 20/10/2026 |
| **Última revisão** | 20/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (novo); integra `schedule` (calendário) e `content` (banco de questões) |
| **Contexto de tela** | `/app/classes/[id]/assessments` (novo), calendário da turma em `/app/classes/[id]` e calendário geral em `/app/calendar` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-009 (turmas), SPEC-010 (módulos de ensino e atribuição à turma), SPEC-023 (banco de questões do módulo e vínculo com a avaliação), SPEC-035 a SPEC-039 (tipos de questão), SPEC-041 (estudantes da turma), SPEC-042 (agenda e calendário), SPEC-053 (conteúdo da aula: tema e módulo da aula) |
| **Substitui** | Nenhuma. Sobrepõe a seção 5.1 e o `AssessmentForm` do rascunho `052-avaliacao-telemetria-player-sessao.md` (ver D-01) |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seção 3.1 (`Avaliacao`, `JanelaAplicacao`) e seção 6.4.3 (equivalência pedagógica no sorteio por nível); as duas Tech Specs trazidas pelo Tech Lead em 20/10/2026 (módulo de avaliações e provas no calendário; adendo de reagendamento, cancelamento e notas privadas) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A docente já monta a agenda da turma com aulas, eventos, períodos especiais e feriados (SPEC-042) e já tem, em cada módulo de ensino, um banco de questões em que cada questão pode ser vinculada à avaliação (SPEC-023). O que falta é o elo entre as duas coisas: **não há como agendar uma avaliação da turma**. Hoje a docente não consegue marcar uma prova num dia e horário, nem uma atividade com vários dias de prazo, escolher quais questões entram ou sortear por nível de dificuldade, restringir a avaliação a alguns alunos (segunda chamada, reposição, recuperação), reagendar quando o laboratório não está disponível nem cancelar com uma justificativa que a turma leia. O estudante, por sua vez, não vê nenhuma avaliação no calendário.

Duas exigências pesam sobre a solução: o **sigilo**, porque enunciados, alternativas e gabaritos não podem chegar ao navegador do estudante antes da hora (nem por inspeção de rede), e a **integridade**, porque, depois que a avaliação abre, a composição não pode mudar sem quebrar a isonomia entre os alunos.

A resolução da prova pelo estudante (tentativa, cronômetro, telemetria, correção e notas) é outro assunto e fica fora desta spec.

## 2. Objetivos (Goals)

- A docente dona da turma (e o administrador) agenda uma avaliação do tipo prova (`EXAM`, um dia e uma faixa de horário) ou atividade (`ASSIGNMENT`, período de vários dias), com título, instruções gerais, nota máxima e, opcionalmente, duração individual.
- A docente transforma uma aula já registrada na agenda em avaliação, aproveitando o horário, o tema e o módulo da aula, sem alterar a aula.
- A docente compõe a avaliação por um de dois modos: **manual** (escolhe as questões e os pesos, somando a nota máxima) ou **sorteio por nível** (quantidade por nível, validada contra o estoque do banco).
- A avaliação só aceita questões do módulo escolhido, entre os módulos atribuídos à turma, publicadas e vinculadas à avaliação.
- A avaliação vale para toda a turma ou só para alunos escolhidos, e quem não é elegível nem a enxerga.
- O estudante elegível vê no calendário só os dados públicos (título, datas, duração, nota máxima e instruções). Nenhuma resposta do servidor para o estudante traz questão, alternativa, gabarito, peso, regra de sorteio, quantidade de questões ou observação privada.
- A docente pré-visualiza a avaliação inteira (enunciados, gabaritos e pontuação) a qualquer momento.
- A composição fica congelada quando a avaliação abre.
- A docente reagenda (antes de abrir, as duas datas; em andamento, só prorroga o término) e cancela com justificativa obrigatória; o estudante vê a avaliação cancelada com o motivo.
- A docente guarda observações privadas na avaliação, que nunca saem para o estudante.
- Toda criação, alteração, reagendamento e cancelamento fica registrado (quem, quando, datas antiga e nova, motivo).
- Uma decisão de acesso única (`AccessOf`) diz se um estudante pode entrar numa avaliação agora, para a futura spec das tentativas não reimplementar elegibilidade, janela e cancelamento.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Resolução da prova**: iniciar tentativa, cronômetro individual, entrega das questões ao estudante, telemetria, token de liberação, correção, notas, homologação e revisão (rascunhos 052 e `revisao-avaliacoes-telemetria-mcp`).
- Entregar questões ao estudante em **qualquer** momento, inclusive depois que a avaliação abre. Isso é da spec das tentativas.
- Média final da turma e `peso` da avaliação na média (`criterios_avaliacao` do canônico). Aqui só existe a nota máxima da avaliação.
- Janela de aplicação múltipla (`AssessmentWindow`), repescagem do mesmo exame e treino livre. Segunda chamada e reposição são **outra avaliação** com público selecionado (D-02).
- Criar avaliação a partir de um `AssessmentTemplate` ou salvar como modelo; duplicar avaliação.
- Excluir ou arquivar avaliação. Só se cancela.
- Rascunho (status `DRAFT`): gravar a avaliação é agendá-la (D-05).
- E-mail ou aviso por reagendamento e cancelamento (D-06). Fica só a atualização do calendário e do cartão.
- Notificação em tempo real por WebSocket.
- Ferramentas do servidor MCP para avaliações.
- Alertar sobre feriado ou período sem aula no dia escolhido.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px (`ARCHITECTURE.md`, seção 4). Toda chamada de rede fica em `services/assessmentService.ts`; `CalendarData` ganha `assessments`.

**Docente e administrador**

- **Lista da turma** (`/app/classes/[id]/assessments`): uma linha por avaliação, com tipo, título, período, status e fase (`UPCOMING` "Agendada", `RUNNING` "Em andamento", `ENDED` "Encerrada", e `CANCELED` "Cancelada"), nota máxima, composição e total de alunos elegíveis. Ações: Ver, Editar, Pré-visualizar, Reagendar, Cancelar; cada uma fica desabilitada, com a razão em texto, quando a fase não permite. Estados: carregando, vazio ("Nenhuma avaliação agendada"), erro com nova tentativa. Botão "Nova avaliação" no topo.
- **Formulário em abas** (padrão da SPEC-044): *Dados* (título, instruções gerais, tipo, nota máxima, duração individual opcional), *Período* (início e fim), *Questões*, *Participantes* e *Observações privadas*. O botão de gravar só habilita quando as validações locais passam; o servidor repete todas.
  - **Aba Questões:** escolhe o módulo (só os atribuídos à turma). No **modo manual**, lista as questões elegíveis com filtro por nível, tipo e busca, marca as que entram e mostra o peso de cada uma; o botão "Distribuir igualmente" reparte a nota máxima em centésimos (as sobras vão para as primeiras questões, para a soma fechar); uma barra mostra a soma dos pesos contra a nota máxima e trava o gravar enquanto diferem. No **modo sorteio**, três campos (fáceis, médias, difíceis), o total e os pontos por questão de cada nível, com o estoque disponível ao lado de cada nível e a soma `quantidade × pontos` contra a nota máxima.
  - **Aba Participantes:** "Toda a turma" (padrão) ou "Alunos escolhidos", com busca por nome ou RA entre os alunos de matrícula `ACTIVE`.
  - **Avaliação congelada** (a partir do início): módulo, questões, pesos, sorteio, nota máxima, tipo e duração ficam desabilitados com o aviso "A avaliação já começou; a composição não pode mais mudar". Título, instruções e observações privadas continuam editáveis, e o público só pode crescer.
- **Transformar em avaliação:** o cartão da aula no calendário e na linha do tempo ganha a ação "Transformar em avaliação", que abre o formulário com início, fim, título (o tema da aula) e módulo (o da aula) já preenchidos e editáveis. A aula não muda.
- **Reagendar** (diálogo): antes do início, edita início e fim; em andamento, o início aparece travado e só o término pode ser empurrado para depois, com a justificativa obrigatória (D-07); encerrada ou cancelada, a ação não existe.
- **Cancelar** (diálogo): motivo obrigatório (1 a 500 caracteres, texto puro) e confirmação explícita. Depois de cancelada, a avaliação só pode ser lida.
- **Pré-visualização** (somente docente e administrador): enunciados, gabaritos (resposta correta e justificativa) e a distribuição de pontos; no sorteio, mostra as regras por nível, o estoque e um exemplo sorteado.
- **Histórico** na tela da avaliação: criada, alterada, reagendada e cancelada, por quem e quando, com datas antiga e nova e o motivo.

**Estudante**

- No calendário da turma e no geral, a avaliação elegível aparece com o rótulo "Prova" ou "Atividade", título, início, fim, duração e nota máxima. A avaliação cancelada continua visível, com título riscado, uma tarja de cancelamento (cores só por tokens) e o motivo. Quem não é elegível não vê nada. Quando a avaliação nasceu de uma aula, o calendário mostra **um cartão só**, o da avaliação, no lugar da aula; ao cancelar, o cartão da aula volta (D-09).
- O detalhe da avaliação mostra os dados públicos e, antes do início, uma contagem regressiva calculada com o relógio do servidor (`serverNow`). A tela reconsulta a cada 30 s com a aba visível e na hora em que a aba volta a ficar visível; se o início ou o fim mudou, a contagem se refaz sozinha, sem recarregar a página. O botão de iniciar a prova **não existe** nesta spec.

### 3.2. Backend (Go: módulo `assessment`, com integração em `schedule` e `content`)

Módulo novo `backend/internal/modules/assessment/` com `domain`, `service`, `repository` e `handler`, conforme `ARCHITECTURE.md`, seção 3.2. O `assessment` não acessa o repository de outro módulo: lê turma, matrículas, aulas, módulos, questões e nomes de usuário pelas interfaces públicas dos services de `classgroup`, `schedule`, `student`, `coursemodule`, `content` e `user`, declaradas no `assessment` (inversão de dependência); os nomes de quem criou, alterou e agiu no histórico (RN-15) vêm da interface de usuários. Datas e horários seguem a SPEC-042 RN-13: interpretados em `America/Sao_Paulo`, entrando e saindo da API em ISO 8601 com deslocamento. O relógio é sempre o do servidor.

- **RN-01 (autorização):** só a docente dona da turma e o administrador escrevem. Lê o detalhe completo a docente dona e o administrador. O estudante com matrícula `ACTIVE` lê só os dados públicos das avaliações em que é elegível (RN-08). Sem sessão, 401; papel ou dono errado, 403; avaliação de outra turma ou inexistente, 404.
- **RN-02 (dados):** título de 1 a 150 caracteres; instruções gerais em texto puro de até 5.000 caracteres (quebras de linha preservadas); tipo `EXAM` ou `ASSIGNMENT`; nota máxima maior que 0 e até 100, com no máximo 2 casas decimais; duração individual opcional em minutos inteiros, de 5 até o tamanho do período. Sem duração, o aluno usa o período inteiro. Status guardado: `SCHEDULED` ou `CANCELED`.
- **RN-03 (período):** o início deve ser posterior ao instante da gravação e o término posterior ao início. Uma `EXAM` começa e termina no mesmo dia (horário de Brasília); uma `ASSIGNMENT` pode atravessar vários dias. A **fase** não é guardada, é calculada pelo relógio do servidor: `UPCOMING` (antes do início), `RUNNING` (do início até o término, exclusive) e `ENDED` (do término em diante). Toda resposta traz `serverNow`.
- **RN-04 (conversão de aula):** com `classSessionId`, a aula deve ser da mesma turma, estar `SCHEDULED`, não excluída e não ligada a outra avaliação `SCHEDULED`. Se `startsAt`, `endsAt`, `title` ou `moduleId` não vierem, o servidor usa os da aula (data com o horário de início e de fim, o tema e o módulo). A conversão **não escreve** na aula nem no módulo `schedule`; ela só guarda o vínculo. Mudar o horário da avaliação depois não mexe na aula.
- **RN-05 (módulo e questões elegíveis):** o módulo deve estar atribuído à turma (`module_class_assignments`), senão `module-not-assigned`. Uma questão é elegível quando é do módulo, está `PUBLISHED`, não foi excluída e tem `in_assessment` ligado (SPEC-023). Questão fora disso, ou de outro módulo, é recusada com `question-not-eligible`. Qualquer tipo de questão aceito pelo banco do módulo entra (SPEC-035 a SPEC-039).
- **RN-06 (composição manual):** de 1 a 50 questões, sem repetir a mesma, cada uma com peso de 0,01 a 100 (2 casas); a soma dos pesos deve ser exatamente igual à nota máxima, conferida em centésimos inteiros, senão `weights-mismatch`.
- **RN-07 (composição por sorteio):** total de 1 a 50 questões e, por nível (`EASY`, `MEDIUM`, `HARD`), uma quantidade inteira maior ou igual a 0. A soma das quantidades deve ser igual ao total, senão `draw-mismatch`. Para cada nível, as questões elegíveis do módulo devem ser em número maior ou igual à quantidade pedida, senão `insufficient-stock` (a resposta lista os níveis que faltam e quanto há). Os pontos por questão são **uniformes dentro do nível** (canônico 6.4.3) e a soma de `quantidade × pontos` de todos os níveis deve ser exatamente a nota máxima, senão `weights-mismatch`, de modo que a nota máxima não depende do sorteio. O sorteio em si (qual caderno cada aluno recebe) acontece quando a tentativa começa e é da spec das tentativas; aqui só se guarda e se valida a regra (D-04).
- **RN-08 (público e elegibilidade):** o público é `ALL_CLASS` (padrão) ou `SELECTED`, com uma lista não vazia de estudantes cuja matrícula na turma está `ACTIVE` na hora de gravar; outro estudante recebe `student-not-in-class`. **Elegível** é o estudante com matrícula `ACTIVE` que, em `ALL_CLASS`, é qualquer um da turma (inclusive quem entrar depois) e, em `SELECTED`, está na lista. Quem deixa de ter matrícula `ACTIVE` deixa de ser elegível.
- **RN-09 (sigilo):** as respostas para o estudante usam um tipo próprio, `AssessmentPublic`, que só tem os campos da seção 5.1. Em nenhum momento levam questão, alternativa, gabarito, justificativa, peso, regra de sorteio, quantidade de questões, quantidade de elegíveis, módulo, composição, público ou observação privada. As rotas de leitura de questão do banco do módulo continuam fora do alcance do estudante (SPEC-023).
- **RN-10 (congelamento):** a avaliação está **congelada** a partir do instante `startsAt` (relógio do servidor). Congelada, o servidor recusa com `assessment-frozen` a troca de módulo, de composição, de questões, de pesos, de regra de sorteio, de nota máxima, de tipo e de duração. Continuam permitidos: título, instruções, observações privadas, ampliar o público (adicionar alunos ou passar para `ALL_CLASS`, nunca reduzir), reagendar nos termos da RN-11 e cancelar. O congelamento por "primeira tentativa antes da abertura" só existiria com treino livre, que está fora de escopo (D-13).
- **RN-11 (reagendamento):** em `UPCOMING`, início e término podem mudar, com as validações da RN-03 (inclusive início no futuro). Em `RUNNING`, o início não muda e o novo término deve ser posterior ao término atual (só prorrogar), com justificativa obrigatória (D-07). Em `ENDED` ou `CANCELED`, recusa: `assessment-ended` ou `assessment-canceled`. Cada reagendamento grava o evento `RESCHEDULED` com as datas antigas e novas, o autor e o motivo. Se a avaliação nasceu de uma aula, a aula não se move.
- **RN-12 (cancelamento):** exige motivo de 1 a 500 caracteres (`reason-required`). Passa o status para `CANCELED` e grava quem cancelou, quando e o motivo. `CANCELED` é terminal: nenhuma operação o desfaz e nenhuma alteração (exceto as observações privadas) é aceita depois. Cancelar uma avaliação já cancelada é `assessment-canceled`. Se existir nota homologada na avaliação, a operação é recusada com `grades-homologated`; como ainda não existe módulo de notas, o service declara a interface `HomologationCheck` e o composition root liga uma implementação que responde "nenhuma" até a spec das notas (D-12). Cancelar não altera a aula de origem: ela segue como aula regular da agenda e o vínculo fica só como histórico (D-09).
- **RN-13 (observações privadas):** texto puro de até 5.000 caracteres, opcional, gravado por rota própria a qualquer momento e em qualquer fase, inclusive depois de cancelada. Só a docente dona e o administrador leem e gravam (como a SPEC-073 RN-03; D-10). Gravar **não** conta como alteração da avaliação: não muda `updated_by`, `updated_at`, não gera evento, não pede motivo. Nunca sai nas respostas do estudante nem em lista ou calendário de estudante.
- **RN-14 (decisão de acesso):** o service público oferece `AccessOf(estudante, avaliação)` e responde `ALLOWED` só quando a avaliação está `SCHEDULED`, a fase é `RUNNING` e o estudante é elegível; caso contrário responde o motivo: `CANCELED`, `NOT_ELIGIBLE`, `NOT_OPEN_YET` ou `ENDED`. Não há rota HTTP; é a interface que a spec das tentativas vai consumir. Assim, avaliação cancelada nunca devolve `ALLOWED`. Quando mais de um motivo vale, vale o primeiro desta ordem: `NOT_ELIGIBLE`, `CANCELED`, `NOT_OPEN_YET`, `ENDED`, para quem não é elegível não aprender nada sobre a avaliação.
- **RN-15 (auditoria):** a avaliação guarda `created_by`, `updated_by` e `updated_at` (padrão da SPEC-049) e, em tabela só de inclusão, os eventos `CREATED`, `UPDATED` (com os nomes dos campos alterados, nunca os valores das observações), `RESCHEDULED` e `CANCELED`, cada um com autor, instante, motivo e, no reagendamento, as datas antigas e novas. Eventos não se alteram nem se apagam. Só a docente dona e o administrador leem o histórico.
- **RN-16 (pré-visualização):** só a docente dona e o administrador. Devolve as questões na ordem, com enunciado, tipo, nível, peso, resposta correta e justificativa; no sorteio, as regras por nível, o estoque e um exemplo sorteado (não gravado).
- **RN-17 (calendário, módulo `schedule`):** `GET /classes/:id/calendar` e `GET /me/calendar` passam a trazer `assessments` do intervalo. O `schedule` declara a interface de que precisa e o `assessment` a implementa, ligadas no composition root (D-08). Para a docente e o administrador vêm as avaliações de suas turmas; para o estudante, só as elegíveis, no formato `AssessmentPublic`, incluindo as canceladas.
- **RN-18 (integridade do banco, módulo `content`):** o banco do módulo recusa com `question-in-use` excluir, despublicar ou desligar `in_assessment` de uma questão que está numa avaliação `SCHEDULED` em composição manual, e qualquer mudança que deixe o estoque de um nível abaixo da quantidade de uma avaliação `SCHEDULED` em sorteio (D-11).
- **RN-19 (transações):** criar, editar, reagendar e cancelar gravam a avaliação, os itens, as regras, os alunos e o evento numa transação só.

## 4. Modelo de Dados (Data Model)

Migração nova com o próximo número livre depois de `00040` (conferir em `origin/projeto-tcc2` antes de criar; hoje seria `00041_assessments.sql`). Tabelas e colunas em inglês, schema `linux_lab`, chave UUIDv7.

**`assessments`** (avaliação)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | UUIDv7 |
| `class_id` | uuid | Sim | FK `classes` | Turma (RN-01) |
| `module_id` | uuid | Sim | FK `course_modules` | Módulo de onde saem as questões (RN-05) |
| `class_session_id` | uuid | Não | FK `class_sessions` | Aula de origem, quando houve conversão (RN-04) |
| `title` | text | Sim | 1 a 150 caracteres | RN-02 |
| `description` | text | Não | até 5.000 caracteres | Instruções gerais, texto puro (RN-02) |
| `type` | text | Sim | `EXAM` ou `ASSIGNMENT` | RN-02, RN-03 |
| `status` | text | Sim | `SCHEDULED` ou `CANCELED` | RN-02, RN-12 |
| `max_score` | numeric(5,2) | Sim | maior que 0 e até 100 | Nota máxima (RN-02) |
| `duration_minutes` | integer | Não | de 5 até o período | Duração individual (RN-02) |
| `starts_at` | timestamptz | Sim | | Início (RN-03) |
| `ends_at` | timestamptz | Sim | maior que `starts_at` | Término (RN-03) |
| `composition` | text | Sim | `MANUAL` ou `DRAW` | RN-06, RN-07 |
| `draw_total` | integer | Não | de 1 a 50; só em `DRAW` | Total planejado no sorteio (RN-07) |
| `audience` | text | Sim | `ALL_CLASS` ou `SELECTED` | RN-08 |
| `teacher_private_notes` | text | Não | até 5.000 caracteres | RN-13 |
| `created_by` | uuid | Sim | FK `users` | RN-15 |
| `updated_by` | uuid | Sim | FK `users` | RN-15 |
| `canceled_by` | uuid | Não | FK `users` | RN-12 |
| `canceled_at` | timestamptz | Não | | RN-12 |
| `cancel_reason` | text | Não | 1 a 500 caracteres; obrigatório com `CANCELED` | RN-12 |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | Sim, Sim, Não | | Auditoria e exclusão lógica |

**`assessment_items`** (questões da composição manual)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | |
| `assessment_id` | uuid | Sim | FK `assessments` | |
| `question_id` | uuid | Sim | FK `questions` | RN-05 |
| `position` | integer | Sim | maior que 0 | Ordem na prova |
| `weight` | numeric(5,2) | Sim | maior que 0 | Peso (RN-06) |

**`assessment_draw_rules`** (regra de sorteio por nível, `DrawRule`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | |
| `assessment_id` | uuid | Sim | FK `assessments` | |
| `difficulty` | text | Sim | `EASY`, `MEDIUM` ou `HARD` | Nível |
| `quantity` | integer | Sim | maior ou igual a 0 | Quantidade de questões do nível (RN-07) |
| `points_per_question` | numeric(5,2) | Sim | maior que 0 | Pontos de cada questão do nível, uniformes (RN-07) |

**`assessment_students`** (alunos escolhidos, só em `SELECTED`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | |
| `assessment_id` | uuid | Sim | FK `assessments` | |
| `student_id` | uuid | Sim | FK `users` | RN-08 |
| `created_at` | timestamptz | Sim | | |

**`assessment_events`** (histórico, só inclusão)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | |
| `assessment_id` | uuid | Sim | FK `assessments` | |
| `kind` | text | Sim | `CREATED`, `UPDATED`, `RESCHEDULED`, `CANCELED` | RN-15 |
| `actor_id` | uuid | Sim | FK `users` | Quem fez |
| `reason` | text | Não | até 500 caracteres | Motivo (RN-11, RN-12) |
| `old_starts_at`, `old_ends_at` | timestamptz | Não | só em `RESCHEDULED` | Datas antes |
| `new_starts_at`, `new_ends_at` | timestamptz | Não | só em `RESCHEDULED` | Datas depois |
| `changed_fields` | text[] | Não | só em `UPDATED` | Nomes dos campos alterados |
| `created_at` | timestamptz | Sim | | Instante do evento |

**Relacionamentos:** `assessments` N:1 `classes`, N:1 `course_modules`, N:1 `class_sessions` (opcional); 1:N com `assessment_items`, `assessment_draw_rules`, `assessment_students` e `assessment_events`.

**Índices e unicidades:** `(class_id, starts_at)` com `deleted_at` nulo; `(class_id, status)`; unicidade `(assessment_id, question_id)` em `assessment_items`; unicidade `(assessment_id, difficulty)` em `assessment_draw_rules`; unicidade `(assessment_id, student_id)` em `assessment_students`; unicidade parcial de `class_session_id` onde `status = 'SCHEDULED'` e `deleted_at` é nulo (uma aula, no máximo uma avaliação ativa).

**Enumerações:** `type`: `EXAM` (prova, um dia e uma faixa de horário), `ASSIGNMENT` (atividade, vários dias). `status`: `SCHEDULED` (agendada), `CANCELED` (cancelada, terminal). `composition`: `MANUAL`, `DRAW`. `audience`: `ALL_CLASS`, `SELECTED`. Fase calculada (não guardada): `UPCOMING`, `RUNNING`, `ENDED`. Evento: `CREATED`, `UPDATED`, `RESCHEDULED`, `CANCELED`.

**Exclusão:** lógica em `assessments` (`ARCHITECTURE.md`, seção 3.7), sem rota de exclusão nesta spec. Os eventos nunca se apagam. As tabelas de itens, regras e alunos acompanham a avaliação (sem exclusão lógica própria). **Nenhuma tabela existente muda de schema.**

## 5. Contrato de API (API Contract)

Erros RFC 7807 com os slugs abaixo e os comuns do projeto (`malformed-request`, `invalid-uuid`, `not-authenticated`, `forbidden`, `class-not-found`, `assessment-not-found`). Campos em `camelCase`. Um valor ilegível no corpo ou na query (data que não é data, número que é texto, id que não é UUID, fase ou status que não existe) é 400 `malformed-request`; um id ilegível na rota é 400 `invalid-uuid`. Todas as rotas exigem sessão.

### 5.1. Objetos de resposta

**`AssessmentPublic`** (estudante elegível; é o único formato que o estudante recebe)

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | |
| `classId` | uuid | Sim | |
| `classSessionId` | uuid | Não | Aula de origem, para o calendário juntar os cartões |
| `title` | texto | Sim | |
| `description` | texto | Sim | Instruções gerais (pode ser vazio) |
| `type` | texto | Sim | `EXAM` ou `ASSIGNMENT` |
| `status` | texto | Sim | `SCHEDULED` ou `CANCELED` |
| `phase` | texto | Sim | `UPCOMING`, `RUNNING` ou `ENDED` |
| `startsAt`, `endsAt` | data e hora | Sim | ISO 8601 com deslocamento |
| `durationMinutes` | inteiro | Não | Duração individual |
| `maxScore` | decimal | Sim | Nota máxima |
| `cancelReason` | texto | Não | Só com `CANCELED` |
| `serverNow` | data e hora | Sim | Relógio do servidor, para a contagem regressiva. No detalhe vem no objeto; nas listas vem uma vez só, fora dos itens, e o calendário não o traz |

**`AssessmentSummary`** (docente dona e administrador): tudo de `AssessmentPublic` mais `moduleId`, `moduleTitle`, `composition`, `audience`, `eligibleStudents` (quantidade), `totalQuestions`, `frozen`, `teacherPrivateNotes`, `createdBy`, `createdByName`, `updatedBy`, `updatedByName`, `updatedAt`, `canceledBy`, `canceledAt`.

**`AssessmentDetail`** (docente dona e administrador): `AssessmentSummary` mais `items` (`questionId`, `position`, `weight`, `title`, `kind`, `difficulty`), `drawRules` (`difficulty`, `quantity`, `pointsPerQuestion`), `students` (`studentId`, `name`, `academicId`) e `events` (`kind`, `actorName`, `createdAt`, `reason`, datas antigas e novas, `changedFields`).

### 5.2. Rotas

**`POST /api/v1/classes/:id/assessments`**: cria a avaliação (RN-02 a RN-08, RN-15, RN-19).

- **Papéis autorizados:** docente dona da turma, administrador.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `classSessionId` | uuid | Não | Conversão de aula (RN-04) |
| `moduleId` | uuid | Sim, salvo com `classSessionId` que tenha módulo | Módulo atribuído à turma (RN-05) |
| `title` | texto | Sim, salvo com `classSessionId` que tenha tema | RN-02 |
| `description` | texto | Não | RN-02 |
| `type` | texto | Sim | `EXAM` ou `ASSIGNMENT` |
| `maxScore` | decimal | Sim | RN-02 |
| `durationMinutes` | inteiro | Não | RN-02 |
| `startsAt`, `endsAt` | data e hora | Sim, salvo com `classSessionId` | RN-03 |
| `composition` | texto | Sim | `MANUAL` ou `DRAW` |
| `items` | lista de `questionId` e `weight` | Só em `MANUAL` | RN-06 |
| `draw` | `total` e a lista `rules`, com um item por nível (`difficulty`, `quantity`, `pointsPerQuestion`) | Só em `DRAW` | RN-07 |
| `audience` | texto | Não (padrão `ALL_CLASS`) | RN-08 |
| `studentIds` | lista de uuid | Só em `SELECTED` | RN-08 |
| `teacherPrivateNotes` | texto | Não | RN-13 |

- **Resposta de sucesso:** 201 com `AssessmentSummary`.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-assessment` | Campo fora das regras da RN-02, ou composição incompatível com o corpo |
| 400 | `invalid-period` | Datas fora da RN-03 |
| 400 | `weights-mismatch` | Soma dos pesos ou dos pontos diferente da nota máxima (RN-06, RN-07) |
| 400 | `draw-mismatch` | Quantidades por nível não somam o total (RN-07) |
| 400 | `question-not-eligible` | Questão fora da RN-05 |
| 400 | `student-not-in-class` | Aluno escolhido sem matrícula `ACTIVE` na turma |
| 404 | `session-not-found` | Aula inexistente ou de outra turma |
| 409 | `session-not-convertible` | Aula cancelada ou já ligada a avaliação ativa |
| 409 | `module-not-assigned` | Módulo não atribuído à turma |
| 409 | `insufficient-stock` | Estoque de algum nível menor que o pedido (traz os níveis) |

**`GET /api/v1/classes/:id/assessments`**: lista as avaliações da turma.

- **Papéis autorizados:** docente dona, administrador (`AssessmentSummary`); estudante `ACTIVE` (`AssessmentPublic`, só as elegíveis).
- **Parâmetros de query:** `phase` (`UPCOMING`, `RUNNING`, `ENDED`, opcional), `status` (opcional). Ordem: início decrescente.
- **Resposta de sucesso:** 200 com `items` e `serverNow`.

**`GET /api/v1/classes/:id/assessments/:assessmentId`**: detalhe.

- **Papéis autorizados:** docente dona e administrador (`AssessmentDetail`); estudante elegível (`AssessmentPublic`).
- **Erros:** 404 `assessment-not-found`, inclusive para o estudante que não é elegível (RN-08).

**`GET /api/v1/classes/:id/assessments/:assessmentId/preview`**: pré-visualização (RN-16).

- **Papéis autorizados:** docente dona, administrador. Estudante recebe 403 `forbidden` em qualquer fase.
- **Resposta de sucesso:** 200 com `questions` (ordem, enunciado, tipo, nível, peso, resposta correta, justificativa) e, em `DRAW`, `rules`, `stock` e `sample`.

**`PATCH /api/v1/classes/:id/assessments/:assessmentId`**: altera a configuração (RN-10, RN-15).

- **Papéis autorizados:** docente dona, administrador.
- **Corpo:** os mesmos campos da criação, todos opcionais, menos as datas (que têm rota própria) e `classSessionId`. Em avaliação congelada só `title`, `description` e o público (só ampliar).
- **Resposta de sucesso:** 200 com `AssessmentSummary`.
- **Erros:** os da criação (menos os de período) e 409 `assessment-frozen`, 409 `assessment-canceled`, 409 `assessment-ended`.

**`PUT /api/v1/classes/:id/assessments/:assessmentId/schedule`**: reagenda (RN-11).

- **Papéis autorizados:** docente dona, administrador.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `startsAt` | data e hora | Sim | Em `RUNNING`, igual ao atual |
| `endsAt` | data e hora | Sim | Maior que `startsAt`; em `RUNNING`, maior que o término atual |
| `reason` | texto | Em `RUNNING`; opcional antes | Até 500 caracteres (D-07) |

- **Resposta de sucesso:** 200 com `AssessmentSummary`.
- **Erros:** 400 `invalid-period`; 400 `reason-required`; 409 `assessment-ended`; 409 `assessment-canceled`.

**`POST /api/v1/classes/:id/assessments/:assessmentId/cancel`**: cancela (RN-12).

- **Papéis autorizados:** docente dona, administrador.
- **Corpo:** `reason`, texto de 1 a 500 caracteres, obrigatório.
- **Resposta de sucesso:** 200 com `AssessmentSummary`.
- **Erros:** 400 `reason-required`; 409 `assessment-canceled`; 409 `grades-homologated`.

**`PUT /api/v1/classes/:id/assessments/:assessmentId/private-notes`**: grava as observações privadas (RN-13).

- **Papéis autorizados:** docente dona, administrador.
- **Corpo:** `teacherPrivateNotes`, texto de até 5.000 caracteres (vazio apaga).
- **Resposta de sucesso:** 200 com `teacherPrivateNotes`.
- **Erros:** 400 `invalid-assessment`.

**`GET /api/v1/classes/:id/assessment-questions`**: questões elegíveis e estoque, para montar a avaliação (RN-05, RN-07).

- **Papéis autorizados:** docente dona, administrador.
- **Parâmetros de query:** `moduleId` (obrigatório), `difficulty`, `kind`, `q` (busca no título), `page`, `pageSize`.
- **Resposta de sucesso:** 200 com `items` (`questionId`, `title`, `kind`, `difficulty`) e `stock` (quantidade por nível).
- **Erros:** 409 `module-not-assigned`.

**Rotas existentes que mudam (RN-17):** `GET /api/v1/classes/:id/calendar` e `GET /api/v1/me/calendar` ganham `assessments` na resposta, sempre presente (lista vazia sem avaliações); o limite de 62 dias da SPEC-042 continua. Cada item tem os campos de `AssessmentPublic` sem `serverNow` e, para a docente e o administrador, também `eligibleStudents` e `composition`. Na `content`, as rotas que excluem, despublicam ou mudam o vínculo de uma questão passam a poder responder 409 `question-in-use` (RN-18).

## 6. Impacto e Riscos (Impact & Risks)

- **Vazamento de enunciados ao estudante.** É o risco principal. **Mitigação:** `AssessmentPublic` é um tipo separado, sem os campos sigilosos; um teste de handler compara as chaves da resposta do estudante com a lista exata permitida; as rotas de preview e de questões elegíveis recusam o estudante; o calendário usa o mesmo tipo (RN-09, RN-17).
- **Sobreposição com o rascunho 052.** Duas specs descrevendo a criação da avaliação gerariam duas implementações. **Mitigação:** esta spec é a dona da configuração e do agendamento; o 052 será reescrito depois no template, dependendo desta, só com tentativa, telemetria e player (D-01).
- **Questão do banco mudar ou sumir depois de entrar numa avaliação.** **Mitigação:** a RN-18 faz o banco recusar a exclusão e a despublicação enquanto houver avaliação agendada que a use. Editar o texto de uma questão já incluída não é barrado aqui; fixar o enunciado de cada tentativa é da spec das tentativas.
- **Desvio do canônico** (período e público na avaliação, e não em `JanelaAplicacao`; quantidade por nível, e não percentual). **Mitigação:** decisão explícita do Tech Lead em D-02 e D-04, com o glossário ajustado.
- **Fuso e virada de dia.** Uma `EXAM` perto da meia-noite pode mudar de dia ao converter o fuso. **Mitigação:** a regra de mesmo dia é calculada em `America/Sao_Paulo`, e o teste cobre 23:30 e 00:30.
- **Arredondamento dos pesos.** **Mitigação:** tudo em centésimos inteiros, soma exata (RN-06, RN-07).
- **Colisão de número de migração.** Já aconteceu com a `00038` na SPEC-071. **Mitigação:** conferir o próximo número livre em `origin/projeto-tcc2` imediatamente antes de criar a migração.
- **Impacto em módulos existentes:** `schedule` (calendário ganha uma interface e um campo na resposta) e `content` (guarda de integridade da RN-18). Nenhuma tabela existente muda de schema.
- **Desempenho:** o calendário soma uma consulta por turma e intervalo, limitada a 62 dias; índice `(class_id, starts_at)`.
- **`legacy/`:** a pasta foi removida; não há impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente dona (ou o administrador) cria uma avaliação com dados válidos, O SISTEMA DEVE gravá-la `SCHEDULED`, com `created_by` e `updated_by` dela, calcular a fase pelo relógio do servidor e registrar o evento `CREATED` (RN-02, RN-15).
- [x] **CA-02** (indesejado): SE o término não é posterior ao início, ou o início não é posterior ao instante da gravação, ou uma `EXAM` não começa e termina no mesmo dia (em `America/Sao_Paulo`), ENTÃO O SISTEMA DEVE responder 400 `invalid-period` e não gravar nada (RN-03).
- [x] **CA-03** (evento): QUANDO a docente cria a avaliação a partir de uma aula, O SISTEMA DEVE usar horário, tema e módulo da aula quando os campos não vierem, guardar o vínculo e **não** alterar a aula; SE a aula é de outra turma, está cancelada ou já tem avaliação ativa, ENTÃO DEVE recusar com `session-not-found` ou `session-not-convertible` (RN-04).
- [x] **CA-04** (indesejado): SE o módulo não está atribuído à turma, ENTÃO O SISTEMA DEVE responder 409 `module-not-assigned`; SE uma questão não é do módulo, não está `PUBLISHED`, não tem `in_assessment` ligado ou foi excluída, ENTÃO DEVE responder 400 `question-not-eligible` (RN-05).
- [x] **CA-05** (indesejado): SE, na composição manual, a lista está vazia, repete uma questão, tem peso fora de 0,01 a 100 ou a soma dos pesos (em centésimos) difere da nota máxima, ENTÃO O SISTEMA DEVE responder 400 `weights-mismatch` ou `invalid-assessment` (RN-06).
- [x] **CA-06** (indesejado): SE, no sorteio, a soma das quantidades por nível difere do total, ENTÃO O SISTEMA DEVE responder 400 `draw-mismatch`; SE o estoque elegível de algum nível é menor que a quantidade pedida, ENTÃO DEVE responder 409 `insufficient-stock` com os níveis e as quantidades disponíveis; SE `quantidade × pontos` somados difere da nota máxima, ENTÃO DEVE responder 400 `weights-mismatch` (RN-07).
- [x] **CA-07** (estado): ENQUANTO o público é `SELECTED`, O SISTEMA DEVE exigir uma lista não vazia de estudantes com matrícula `ACTIVE` na turma, recusando os demais com `student-not-in-class`; ENQUANTO é `ALL_CLASS`, DEVE valer para todo estudante `ACTIVE`, inclusive quem entrar depois (RN-08).
- [x] **CA-08** (estado): ENQUANTO o estudante não é elegível, O SISTEMA DEVE omiti-lo das listas e do calendário e responder 404 `assessment-not-found` ao detalhe; ENQUANTO é elegível, DEVE devolver só o `AssessmentPublic` (RN-08, RN-09).
- [x] **CA-09** (ubíquo): O SISTEMA NÃO DEVE incluir, em nenhuma resposta ao estudante, em qualquer fase da avaliação, questão, alternativa, gabarito, justificativa, peso, regra de sorteio, quantidade de questões, quantidade de elegíveis, módulo, composição, público nem observação privada; as chaves da resposta DEVEM ser exatamente as do `AssessmentPublic` (RN-09).
- [x] **CA-10** (ubíquo): As observações privadas DEVEM ser lidas e gravadas só pela docente dona e pelo administrador, a qualquer momento e em qualquer fase, inclusive depois de cancelada; gravá-las NÃO DEVE mudar `updated_by` e `updated_at`, gerar evento nem pedir motivo; NÃO DEVEM aparecer em nenhuma resposta ao estudante (RN-13).
- [x] **CA-11** (estado): ENQUANTO `agora >= startsAt`, O SISTEMA DEVE recusar com 409 `assessment-frozen` a troca de módulo, composição, questões, pesos, regra de sorteio, nota máxima, tipo e duração, e DEVE aceitar título, instruções, observações privadas e a ampliação do público (nunca a redução) (RN-10).
- [x] **CA-12** (evento): QUANDO a docente reagenda uma avaliação em `UPCOMING`, O SISTEMA DEVE gravar o novo início e o novo término (com as validações da CA-02) e registrar o evento `RESCHEDULED` com datas antigas e novas, autor e motivo (RN-11, RN-15).
- [x] **CA-13** (estado): ENQUANTO a avaliação está `RUNNING`, O SISTEMA DEVE aceitar só um novo término posterior ao atual, mantendo o início, e exigir a justificativa; SE o início mudar, ou o término for igual ou anterior ao atual, ENTÃO DEVE responder 400 `invalid-period`; SE faltar a justificativa, ENTÃO 400 `reason-required` (RN-11).
- [x] **CA-14** (indesejado): SE a avaliação está `ENDED` ou `CANCELED`, ENTÃO O SISTEMA DEVE recusar o reagendamento com 409 `assessment-ended` ou `assessment-canceled` (RN-11).
- [x] **CA-15** (evento): QUANDO a docente cancela com motivo, O SISTEMA DEVE passar o status a `CANCELED`, gravar quem, quando e o motivo, registrar o evento `CANCELED` e não alterar a aula de origem; SE o motivo faltar, ENTÃO DEVE responder 400 `reason-required` (RN-12).
- [x] **CA-16** (indesejado): SE a avaliação já está `CANCELED`, ENTÃO O SISTEMA DEVE recusar nova alteração (menos as observações privadas) e novo cancelamento com 409 `assessment-canceled`; SE existe nota homologada, ENTÃO DEVE recusar o cancelamento com 409 `grades-homologated` (RN-12).
- [x] **CA-17** (evento): QUANDO a spec das tentativas pergunta `AccessOf(estudante, avaliação)`, O SISTEMA DEVE responder `ALLOWED` só se a avaliação está `SCHEDULED`, a fase é `RUNNING` e o estudante é elegível, e DEVE responder `CANCELED`, `NOT_ELIGIBLE`, `NOT_OPEN_YET` ou `ENDED` nos outros casos (RN-14).
- [x] **CA-18** (ubíquo): Toda criação, alteração de configuração, reagendamento e cancelamento DEVE gerar um evento de auditoria com autor, instante e motivo (e datas antigas e novas no reagendamento); os eventos NÃO DEVEM poder ser alterados nem apagados; só a docente dona e o administrador DEVEM lê-los (RN-15).
- [x] **CA-19** (estado): ENQUANTO há avaliações no intervalo, `GET /classes/:id/calendar` e `GET /me/calendar` DEVEM trazê-las em `assessments`: a docente e o administrador as de suas turmas, o estudante só as elegíveis, como `AssessmentPublic`, incluindo as canceladas com o motivo (RN-17).
- [x] **CA-20** (indesejado): SE a docente tenta excluir, despublicar ou desligar `in_assessment` de uma questão que está numa avaliação `SCHEDULED` manual, ou reduzir o estoque de um nível abaixo da quantidade de uma avaliação `SCHEDULED` em sorteio, ENTÃO O SISTEMA DEVE recusar com 409 `question-in-use` (RN-18).
- [x] **CA-21** (indesejado): SE quem escreve é estudante, ou docente que não é dona da turma, ENTÃO O SISTEMA DEVE responder 403 `forbidden`; SE não há sessão, ENTÃO 401 `not-authenticated`; SE o estudante pede preview ou questões elegíveis, ENTÃO 403 em qualquer fase (RN-01, RN-16).
- [x] **CA-22** (evento): QUANDO a docente pede a pré-visualização, O SISTEMA DEVE devolver as questões na ordem com enunciado, tipo, nível, peso, resposta correta e justificativa, em qualquer fase; no sorteio, DEVE devolver as regras, o estoque e um exemplo sorteado que não é gravado (RN-16).
- [ ] **CA-23** (ubíquo): A lista da docente DEVE mostrar tipo, título, período, status, fase, nota máxima, composição e total de elegíveis, com cada ação desabilitada e explicada quando a fase não a permite, e com os estados carregando, vazio e erro.
- [ ] **CA-24** (evento): QUANDO a docente monta a composição no formulário, O SISTEMA DEVE mostrar a soma dos pesos contra a nota máxima e travar o gravar enquanto diferem (manual), e o estoque por nível e a soma `quantidade × pontos` (sorteio); "Distribuir igualmente" DEVE repartir em centésimos com soma exata.
- [ ] **CA-25** (evento): QUANDO a docente usa "Transformar em avaliação" num cartão de aula (calendário ou linha do tempo), O SISTEMA DEVE abrir o formulário com início, fim, título e módulo da aula preenchidos e editáveis.
- [ ] **CA-26** (estado): ENQUANTO a avaliação está congelada, o formulário DEVE desabilitar os campos de composição com o aviso do congelamento; ENQUANTO está `RUNNING`, o diálogo de reagendar DEVE travar o início e exigir a justificativa; o diálogo de cancelar DEVE exigir o motivo e a confirmação.
- [ ] **CA-27** (estado): ENQUANTO o estudante elegível vê o calendário, O SISTEMA DEVE mostrar a avaliação com rótulo, título, datas, duração e nota máxima; a cancelada DEVE aparecer com título riscado, tarja e motivo; a avaliação vinda de uma aula DEVE aparecer como um cartão só, e o cartão da aula DEVE voltar se ela for cancelada.
- [ ] **CA-28** (evento): QUANDO a avaliação é reagendada ou cancelada, a tela do estudante DEVE refazer a contagem regressiva e o estado em até 30 s com a aba visível, e na hora em que a aba volta a ficar visível, sem recarregar a página (seção 3.1, lado do estudante).
- [ ] **CA-29** (ubíquo): Os textos DEVEM estar em `messages/pt-BR.ts`; as telas DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [ ] **CA-30** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo; a migração nova sobe e desce sem erro.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038); o commit `test(...)` vem antes do `feat(...)`. Nomes em inglês, como no código.

**Backend, `assessment/domain`** (unidade)

- `TestPeriod_RejectsEndNotAfterStart` (CA-02)
- `TestPeriod_ExamMustBeOnTheSameDay`, com os casos 23:30 e 00:30 no fuso de Brasília (CA-02)
- `TestPhase_FollowsTheServerClock`, nos limites exatos de início e término (CA-01, CA-11, CA-17)
- `TestWeights_ManualSumMustEqualMaxScoreInCents` (CA-05)
- `TestWeights_EqualDistributionKeepsTheExactSum`, com 10 dividido por 3 (CA-05, CA-24)
- `TestDraw_QuantitiesMustSumToTheTotal` (CA-06)
- `TestDraw_PointsAreUniformPerLevelAndSumToMaxScore` (CA-06)
- `TestFrozen_StartsAtTheStartInstant` (CA-11)
- `TestReschedule_RulesByPhase`: antes, em andamento, encerrada e cancelada (CA-12, CA-13, CA-14)

**Backend, `assessment/service`** (unidade, com repositórios e relógio de teste escritos à mão)

- `TestCreate_StoresScheduledAndWritesTheCreatedEvent` (CA-01, CA-18)
- `TestCreate_FromSessionUsesTimeTopicAndModuleAndLeavesTheSessionAlone` (CA-03)
- `TestCreate_RejectsSessionOfOtherClassCanceledOrAlreadyConverted` (CA-03)
- `TestCreate_RejectsModuleNotAssignedToTheClass` (CA-04)
- `TestCreate_RejectsQuestionsThatAreNotEligible`, uma por motivo (CA-04)
- `TestCreate_ManualRejectsDuplicatesEmptyAndWrongSum` (CA-05)
- `TestCreate_DrawReportsEachLevelWithoutStock` (CA-06)
- `TestCreate_SelectedNeedsActiveStudentsOfTheClass` (CA-07)
- `TestEligibility_AllClassIncludesWhoEnrollsLaterAndExcludesWhoLeft` (CA-07, CA-08)
- `TestUpdate_FrozenRefusesCompositionAndAcceptsTitleNotesAndWiderAudience` (CA-11)
- `TestUpdate_FrozenRefusesToNarrowTheAudience` (CA-11)
- `TestReschedule_BeforeStartWritesOldAndNewDates` (CA-12, CA-18)
- `TestReschedule_RunningOnlyExtendsTheEndAndNeedsReason` (CA-13)
- `TestReschedule_EndedOrCanceledIsRefused` (CA-14)
- `TestCancel_WritesWhoWhenAndWhyAndKeepsTheSession` (CA-15, CA-18)
- `TestCancel_RequiresReasonAndRefusesRepeatAndHomologatedGrades`, com `HomologationCheck` de teste (CA-15, CA-16)
- `TestPrivateNotes_AnyPhaseAnyStatusAndNoAuditNoUpdatedBy` (CA-10)
- `TestAccessOf_DecisionTable`: os cinco resultados (CA-17)
- `TestAuthorization_OnlyOwnerTeacherAndAdminWrite` (CA-21)
- `TestPreview_ReturnsQuestionsAnswerKeysAndASampleDraw` (CA-22)
- `TestCalendar_StudentGetsOnlyEligiblePublicAssessments`; `TestCalendar_TeacherGetsAllOfHerClasses` (CA-19)

**Backend, `content/service`** (unidade)

- `TestQuestion_RefusesDeleteUnpublishAndUnlinkWhenInAScheduledAssessment` (CA-20)
- `TestQuestion_RefusesAChangeThatDropsTheStockBelowTheDraw` (CA-20)

**Backend, `schedule/service`** (unidade)

- `TestCalendar_IncludesTheAssessmentsOfTheSourceForTheInterval` (CA-19)

**Backend, `assessment/handler`** (`httptest` contra o roteador Gin real)

- `TestHandler_StudentResponseHasExactlyThePublicKeys`, em lista, detalhe e calendário, antes, durante e depois do início, e com `CANCELED` (CA-08, CA-09)
- `TestHandler_NeverReturnsPrivateNotesToAStudent` (CA-10)
- `TestHandler_StatusCodesAndProblemTypes`: um caso por `type` da seção 5.2 (CA-02 a CA-07, CA-11, CA-13, CA-14, CA-16)
- `TestHandler_RolesAndOwnership`: 401, 403 e 404 (CA-21)
- `TestHandler_PreviewIsForbiddenToStudents` (CA-21, CA-22)

**Backend, `assessment/repository`** (integração com PostgreSQL via `testcontainers-go`)

- `TestRepository_CheckConstraintsOnPeriodScoreAndWeights` (CA-02, CA-05)
- `TestRepository_OneActiveAssessmentPerSession` (CA-03)
- `TestRepository_UniqueQuestionPerAssessmentAndDifficultyPerRule` (CA-05, CA-06)
- `TestRepository_EventsAreAppendOnly` (CA-18)
- `TestRepository_ListsByClassAndIntervalWithTheIndex` (CA-19)
- `TestMigration00041_UpAndDown` (o número real conferido na hora) (CA-30)

**Frontend** (Vitest e Testing Library)

- `assessmentService.test.ts`: rotas, corpo, erros RFC 7807 tipados e `serverNow` (CA-01, CA-28)
- `AssessmentList.test.tsx`: colunas, ações desabilitadas por fase e os três estados (CA-23)
- `AssessmentForm.test.tsx`: abas, barra de soma, estoque por nível, "Distribuir igualmente", gravar travado, aviso de congelamento (CA-24, CA-26)
- `AssessmentQuestionPicker.test.tsx`: filtros e busca (CA-24)
- `AssessmentRescheduleDialog.test.tsx` e `AssessmentCancelDialog.test.tsx`: início travado em andamento, motivo obrigatório, confirmação (CA-26)
- `AssessmentPreview.test.tsx` (CA-22)
- `ClassCalendar.assessments.test.tsx`: cartão de avaliação, cancelada riscada com motivo, cartão único com a aula e volta da aula ao cancelar, estudante não elegível sem cartão (CA-27)
- `ClassTimeline.convert.test.tsx` e `ClassCalendar.convert.test.tsx`: a ação "Transformar em avaliação" abre o formulário preenchido (CA-25)
- `AssessmentCard.test.tsx`: contagem regressiva por `serverNow`, nova consulta a cada 30 s com aba visível e ao voltar à aba, e refazer a contagem após reagendamento ou cancelamento (CA-28)
- `AssessmentForm.a11y.test.tsx`: foco, rótulos e teclado (CA-29)
- Stylelint, ESLint e `tsc` limpos (CA-29, CA-30)

**Manual** (roteiro, para o que não é automatizável)

1. Com dois navegadores (docente e estudante elegível), criar uma prova para daqui a 10 minutos e conferir no estudante o calendário, o cartão e a contagem regressiva.
2. Reagendar para 20 minutos e conferir que a contagem do estudante muda em até 30 s sem recarregar.
3. Abrir a aba de rede do estudante (DevTools) e conferir que nenhuma resposta traz questão, gabarito, peso ou observação privada (CA-09).
4. Cancelar com motivo e conferir o título riscado, a tarja e o motivo no estudante (CA-27).
5. Conferir a aparência e o contraste (WCAG AA) do cartão cancelado e dos diálogos no tema escuro (CA-29).

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com `go test -cover` em `domain`, `service` e `handler` do `assessment` e dos trechos novos de `schedule` e `content`, e com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` (seção 4 e a 4.1 desta spec) e esta spec inteira, mais as specs de que ela depende (SPEC-042, SPEC-023, SPEC-010, SPEC-053). Do código: `backend/internal/modules/schedule` (calendário e `ClassSession`), `backend/internal/modules/content` (`Question`, `in_assessment`, `AssessmentTemplate`), `backend/internal/modules/classgroup` e `student` (matrícula `ACTIVE`), `backend/migrations/` (último número), `frontend/src/components/ClassCalendar`, `ClassTimeline` e `frontend/src/services/scheduleService.ts`. O rascunho `052-avaliacao-telemetria-player-sessao.md` é só referência: não implementar o que ele descreve além do que esta spec manda.
2. **Ordem de execução:** (a) termos novos no `GLOSSARY.md`; (b) testes vermelhos do backend, rodados e commitados (`test(backend): ...`); (c) migração, `domain`, `repository`; (d) `service` e as interfaces consumidas; (e) `handler` e registro das rotas; (f) integração do calendário em `schedule` e a guarda da RN-18 em `content`; (g) testes vermelhos do frontend, rodados e commitados; (h) `assessmentService`, componentes, mensagens e estilos; (i) roteiro manual; (j) status e histórico da spec. Os dois blocos (backend e frontend) podem ser PRs separados, o do backend primeiro.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** `backend/migrations/<próximo número livre>_assessments.sql`; `backend/internal/modules/assessment/{domain,service,repository,handler}/**` e os testes.
   - **Backend, alterados:** `backend/internal/modules/schedule/{service,handler}/**` (interface e `assessments` no calendário) e os testes; `backend/internal/modules/content/{service,handler}/**` (RN-18) e os testes; `backend/cmd/api/main.go` (composition root: módulo novo, interfaces ligadas, `HomologationCheck`) e `backend/cmd/api/assessment_refs.go` (os adaptadores, que leem os outros módulos só por seus services); `classgroup/service` (`Lookup` e `ActiveMembers`), `schedule/service` (`Lesson`), `content/service` (`Question` do reader) e `mcp/{domain,service}` (o mapeamento de `question-in-use`), todos sem checagem de papel, para o `assessment` decidir quem pode o quê; a lista de papéis das rotas, se existir.
   - **Frontend, novos:** `frontend/src/services/assessmentService.ts`; `frontend/src/app/app/classes/[id]/assessments/**` (lista, nova, editar); `frontend/src/components/Assessment*/**` (lista, formulário, seletor de questões, diálogos, pré-visualização, cartão do estudante) e os testes.
   - **Frontend, alterados:** `frontend/src/services/scheduleService.ts` (`CalendarData.assessments`); `frontend/src/components/ClassCalendar/**` e `ClassTimeline/**` (cartão de avaliação e ação "Transformar em avaliação"); `frontend/src/app/app/classes/[id]/page.tsx` (link para a lista); `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** `specs/GLOSSARY.md`; esta spec.
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 20/10/2026, ao aprovar a spec, todas as pendências que ela tinha. As decisões estão incorporadas às seções 2, 3, 4, 5 e 7; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Dona do agendamento.** Esta spec é a dona da configuração, do agendamento e da elegibilidade da avaliação. O rascunho 052 e o `revisao-avaliacoes-telemetria-mcp` ficam só com o ciclo da tentativa (motor do terminal, WebSocket, telemetria, player e revisão) e serão reescritos depois, no template e com numeração, sem as referências a schema, tabelas e pacotes de outro projeto. Nada do 052 é implementado agora. |
| D-02 | **Período e público na própria avaliação**, e não em `AssessmentWindow`. Segunda chamada, reposição e recuperação são outra avaliação, com público `SELECTED`. `AssessmentWindow` fica reservada para uma spec futura de repescagem. Desvio do canônico, aprovado pelo Tech Lead. |
| D-03 | **Um módulo por avaliação**, escolhido entre os atribuídos à turma; na conversão de aula, o da aula. Sem módulo atribuído, não se cria avaliação. |
| D-04 | **Sorteio por quantidade exata de questões por nível**, com pontos por questão uniformes dentro do nível e soma igual à nota máxima (canônico 6.4.3). O percentual é só exibição derivada. |
| D-05 | **Sem rascunho por ora:** gravar é agendar; status `SCHEDULED` e `CANCELED` apenas. Se o atrito aparecer, uma spec futura acrescenta `DRAFT` e "Publicar". |
| D-06 | **Sem e-mail** por criação, reagendamento ou cancelamento. A atualização aparece no calendário e no cartão. |
| D-07 | **Justificativa no reagendamento** obrigatória só com a avaliação em andamento; opcional antes do início. |
| D-08 | **Calendário por interface:** o `schedule` declara a interface e o `assessment` a implementa, ligadas no composition root; `calendar` e `me/calendar` já trazem `assessments`. |
| D-09 | **Aula convertida e cancelamento.** A conversão nunca altera a aula. Cancelar a avaliação a deixa registrada, visível e com o motivo, e a aula continua como aula regular, sem avaliação ativa ligada a ela; o vínculo fica só como histórico. Não há duas opções no diálogo, porque os dois caminhos teriam o mesmo efeito prático (esclarecido pelo Tech Lead). No calendário, a aula convertida aparece como um cartão só, o da avaliação, e o cartão da aula volta quando a avaliação é cancelada. |
| D-10 | **Observações privadas:** só a docente dona e o administrador leem e gravam (como a SPEC-073 RN-03), em texto puro de até 5.000 caracteres, sem renderizar Markdown. |
| D-11 | **Guarda de integridade do banco de questões** incluída nesta spec (RN-18, CA-20), alterando o módulo `content`. |
| D-12 | **Nota homologada ao cancelar:** o service declara a interface `HomologationCheck` agora, e o composition root liga uma implementação que responde "nenhuma" até a spec das notas (RN-12). |
| D-13 | **Tipo, duração e congelamento:** `EXAM` num dia só; `ASSIGNMENT` com qualquer intervalo; duração individual opcional, de 5 minutos até o tamanho do período; congela no instante do início, sem tratar treino livre. |
| D-14 | **Pesos iguais que não dividem exato:** repartir em centésimos, com as sobras de 0,01 nas primeiras questões, para a soma fechar exata. |
| D-15 | **Modelos `assessment_templates`:** fora de escopo; nenhum "criar a partir de modelo" agora. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 20/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir das duas Tech Specs que ele trouxe em 20/10/2026 (módulo de avaliações e provas no calendário; adendo de reagendamento, cancelamento e observações privadas), conferidas contra o canônico, o glossário e o código. Quinze pendências abertas (D-01 a D-15), todas com recomendação |
| 20/10/2026 | Tech Lead | Aprovada. Decisões D-01 a D-15 fechadas: aceitou as recomendações dos pontos D-01 a D-04 e das pendências D-05 a D-15 como estavam na spec, e esclareceu a D-09 (aula convertida e cancelamento: sem duas opções no diálogo; a aula segue regular e a avaliação cancelada fica registrada com o motivo) |
| 20/10/2026 | Aruna Architect | Seção 10 esvaziada: as quinze pendências viraram decisões D-01 a D-15, incorporadas ao texto; `P-xx` renomeado para `D-xx` nas referências. O glossário ganhou as notas de `AssessmentWindow` (D-02) e `DrawRule` (D-04) |
| 20/10/2026 | Aruna Architect | Correção de nome, sem mudança de requisito: a tabela da turma é `classes` (e não `class_groups`, que é só o nome do tipo em Go), na seção 4. Achado ao escrever os testes do repository |
| 20/10/2026 | Aruna Architect | Esclarecimentos de contrato, sem mudança de requisito, achados ao escrever os testes e registrados antes do código (o Tech Lead pode vetar qualquer um): (1) o `assessment` lê nomes de usuário por uma interface `Users` (RN-15, seção 5.1); (2) `AccessOf` tem ordem de motivos, `NOT_ELIGIBLE` primeiro (RN-14); (3) `serverNow` vem no objeto do detalhe e uma vez só nas listas, e o calendário não o traz (5.1); (4) o corpo do sorteio é `total` mais a lista `rules` (5.2); (5) valor ilegível no corpo ou na query é `malformed-request` (5); (6) `assessments` do calendário é sempre presente e, para a docente, traz `eligibleStudents` e `composition` (5.2) |
| 20/10/2026 | Implementador | Backend implementado: CA-01 a CA-22 marcados; o frontend (CA-23 a CA-29) e a verificação estática dele (CA-30) seguem pendentes, por isso o status continua `Aprovada`. Medido: `go vet` limpo e a suíte completa do backend verde (`content/repository` e `student/repository` falharam uma vez com "rootless Docker is not supported", falha intermitente do Testcontainers com muitos pacotes juntos, e passaram sozinhos); cobertura: `assessment/domain` 97,6%, `handler` 82,2%, `repository` 87,6% e `service` 82,1%; nos módulos tocados, `content/service` 86,6%, `content/handler` 84,1%, `schedule/service` 85,9%, `schedule/handler` 92,0% e `classgroup/service` 91,9%; um teste de ligação com os services reais e PostgreSQL real prova a fiação do `main.go`. Teste alterado depois do vermelho: `TestEligibility_AllClassIncludesWhoEnrollsLaterAndExcludesWhoLeft`, cujo helper só tratava `ErrAssessmentNotFound` como "não vê", mas quem saiu da turma é, pelas portas, igual a quem nunca esteve, e o próprio teste exige `ErrClassNotFound` para esta (a turma não se revela); as duas são 404. Acréscimos fora da lista original da seção 9, já incluídos nela: `Lookup`, `ActiveMembers`, `Lesson`, `Question` e o mapeamento no MCP, porque o `assessment` só lê os outros módulos por seus services (seção 3.2). A porta `Students` não tem `StudentClassIDs`, que nenhum caso de uso usava. Nenhum desvio de requisito |
