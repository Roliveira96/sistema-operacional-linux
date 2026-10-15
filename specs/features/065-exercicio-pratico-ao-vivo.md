# SPEC-065: Exercício Prático ao Vivo (Cronômetro, Acompanhamento e Pontuação)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-065 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead; as três decisões abertas foram respondidas por ele) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend, com migração, com leitura do `content` e correção do `practice`/`content`); `frontend/src/components/Classroom/`, `hooks/useLiveClassroom.ts`, `services/classroomService.ts` |
| **Contexto de tela** | Painel do professor e sala do aluno, no modo Módulo da aula ao vivo |
| **Prioridade** | Alta |
| **Depende de** | SPEC-022 (exercícios do card e condições de finalização), SPEC-014 e SPEC-011 (conferência do estado da máquina no servidor), SPEC-055 (painel), SPEC-056 (espelho do terminal), SPEC-057 (palco), SPEC-063 (chat da aula, para as dicas) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026, no módulo "História do Linux": cada bloco pode ter um exercício prático; o professor clica para os alunos fazerem, cada um o seu; o professor vê quem terminou, define alguns minutos (padrão 5), pode encerrar antes, acompanha na tela de administração o que cada aluno faz, manda mensagens com dicas, e ao fim do tempo o exercício se encerra; mostrar o resultado é decisão do professor; os dados de quem concluiu ficam guardados para uma pontuação de gamificação. Respostas dele às três dúvidas: placar e solução, o servidor confere, pontos por dificuldade com bônus de rapidez |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na aula ao vivo no modo Módulo o aluno **só assiste**: vê o material e o espelho do terminal do professor e não tem terminal próprio. O módulo tem, em cada bloco, um **grupo de exercícios práticos** com condições de finalização (SPEC-022), mas esses exercícios só funcionam na tela de estudo, sozinhos e sem nota. O professor não consegue **aplicar um exercício à turma na hora**, com tempo, ver quem terminou, ajudar quem trava, nem guardar o desempenho para uma pontuação.

## 2. Objetivos (Goals)

- O professor **inicia um exercício** de um bloco com um clique, com tempo (padrão 5 minutos, ajustável) e pode encerrar antes; ao fim do tempo ele se encerra sozinho.
- **Cada aluno** resolve o seu, no seu próprio terminal, a partir do cenário do exercício.
- O professor acompanha, no **painel**, quem está fazendo, quanto cada um já cumpriu e quem concluiu, vê o **terminal ao vivo de um aluno** de cada vez e manda **dicas** (em particular ou para todos).
- O **servidor confere** a conclusão e **guarda** quem concluiu, o tempo e os pontos, para a gamificação.
- Ao fim, o professor decide se **mostra o resultado** (placar e solução) aos alunos.

### 2.1. Fora de escopo (Non-Goals)

- A tela de ranking acumulado e qualquer outra tela de gamificação (aqui só se **guardam** os dados, com a consulta de soma por aluno no repositório).
- Exercícios do banco do módulo (SPEC-023) e as perguntas teóricas; só os exercícios práticos do grupo `EXERCISES` de um bloco.
- Mais de um exercício ao mesmo tempo na aula; prorrogar o tempo; pontos parciais; exercício sem condições de finalização (não pode ser iniciado).
- Mostrar o exercício, o cronômetro ou o resultado na janela de apresentação.
- Reproduzir no servidor os comandos do aluno (o motor de comandos é do navegador; o servidor confere o estado final).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Contrato do protocolo (congelado para backend e frontend)

**Modelo da rodada.** Uma aula tem no máximo **uma rodada em andamento**; as já encerradas ficam guardadas. A rodada que o instantâneo informa é a **em andamento** ou, se não houver, a **última encerrada**.

**Cliente → servidor, só o painel do professor** (janela do painel, como o chat; da janela de apresentação ou de aluno é descartado):

| Mensagem | Dados | Regra |
| :--- | :--- | :--- |
| `live:exercise:start` | `{"blockId": uuid, "index": int, "minutes": int?}` | `minutes` de 1 a 60, padrão 5; o bloco é do módulo da aula e é do tipo `EXERCISES`; `index` existe em `items`; o exercício tem ao menos uma condição de finalização; não há outra rodada em andamento. Senão, rejeitada. |
| `live:exercise:end` | `{}` | Encerra a rodada em andamento (`by: "TEACHER"`). Sem rodada, rejeitada. |
| `live:exercise:reveal` | `{"visible": bool}` | Só com a rodada **encerrada**; mostra ou oculta o resultado aos alunos. Em andamento ou sem rodada, rejeitada. |
| `live:exercise:watch` | `{"studentId": uuid \| null}` | Passa a ver o terminal de um aluno da rodada em andamento, ou `null` para parar. Um aluno por vez. |

**Cliente → servidor, só aluno aceito, com a rodada em andamento:**

| Mensagem | Dados | Regra |
| :--- | :--- | :--- |
| `live:exercise:progress` | `{"runId": uuid, "met": int, "total": int, "last": string?}` | `0 ≤ met ≤ total ≤ 100`; `last` é o último comando digitado, até 200 caracteres, sem caracteres de controle. O cliente manda no máximo a cada 2 s. |
| `live:exercise:screen` | `{"runId": uuid, "screen": ScreenElement}` | A imagem do terminal do aluno (o mesmo formato da SPEC-056, até 256 KiB). **Só é aceita enquanto o painel está vendo esse aluno** (`watch`); fora disso, descartada. O cliente manda no máximo 5 por segundo. |

Qualquer outra coisa (fora da rodada, de quem espera ou foi removido, `runId` que não é o da rodada em andamento, campo inválido) é rejeitada ou descartada com o log `classroom message rejected` ou `classroom message dropped`, sem efeito.

**Servidor → clientes:**

| Mensagem | Para quem | Dados |
| :--- | :--- | :--- |
| `live:exercise:started` | painel e alunos aceitos | `{"runId","blockId","index","title","difficulty":"EASY\|MEDIUM\|HARD","durationSeconds","startedAt","endsAt","now"}` (datas em RFC 3339; `now` é a hora do servidor, para o cliente corrigir o relógio) |
| `live:exercise:ended` | painel e alunos aceitos | `{"runId","by":"TIMER\|TEACHER\|SESSION","endedAt","now"}` |
| `live:exercise:result` | alunos aceitos (e o painel) | `{"runId","visible":bool,"completed":int,"participants":int,"scoreboard":[{"studentId","name","elapsedSeconds","points"}]}`; `scoreboard` só com `visible: true`, por pontos (do maior) e depois por tempo (do menor) |
| `live:exercise:progress` | só o painel | `{"runId","studentId","met","total","last","at"}` |
| `live:exercise:done` | só o painel | `{"runId","studentId","name","completedAt","elapsedSeconds","points","attempts"}` |
| `live:exercise:screen` | só o painel | `{"studentId","screen"}` |
| `live:exercise:watch` | só o aluno visto | `{"on": bool}` (liga quando o painel passa a vê-lo; desliga quando para, troca de aluno ou a rodada acaba) |

Quem participa é todo aluno aceito que está na sala **em algum momento da rodada**; quem entra no meio recebe o tempo que resta. `participants` é quantos alunos aceitos estiveram online durante a rodada.

**Instantâneo (`live:snapshot`).** Aluno e painel recebem `exercise: null | {...}` com os campos de `started` mais `"status":"RUNNING|ENDED"`, `"endedBy"`, `"endedAt"`, `"resultVisible"`, `"now"`; o **aluno** recebe também `"myResult": null | {"completedAt","elapsedSeconds","points"}`; o **painel** recebe também `"progress":[{"studentId","name","met","total","last","at","completedAt","elapsedSeconds","points","attempts"}]` de cada aluno da rodada; com `resultVisible` verdadeiro, todos recebem `"result"` (o mesmo corpo de `live:exercise:result`). A janela de apresentação não recebe `exercise`. `GET /classes/:id/live/active` **não** muda.

**Conferência (REST).** `POST /api/v1/classes/{id}/live/exercise/submit`, com `{"runId": uuid, "snapshot": <estado da máquina, formato da SPEC-014, até 2 MB>}`; só aluno aceito na aula em andamento. O servidor lê as condições do exercício **do módulo** (nunca do cliente), traduz para o catálogo do servidor (o mesmo de `catalogFromEnd`, que passa a ter uma função pública no domínio do `content`), corrige com `Grade`, conta a tentativa e responde `{"passed": bool, "completedAt"?, "elapsedSeconds"?, "points"?}` **sem dizer quais condições faltam**. Aprovado e ainda sem resultado: grava o resultado e avisa o painel (`live:exercise:done`); aprovado de novo: devolve o mesmo resultado, sem mudar nada (idempotente). Erros: 404 sem rodada em andamento, 409 rodada já encerrada (com 2 segundos de tolerância depois do fim, para um envio em trânsito), 400 estado inválido, 413 estado maior que 2 MB, 429 mais de uma conferência a cada 2 segundos do mesmo aluno.

**Pontos.** Base por dificuldade: `EASY` 10, `MEDIUM` 20, `HARD` 30. Bônus de rapidez proporcional ao tempo que sobrou: `pontos = base + floor(base × 0,5 × restante ÷ duração)`, com `restante = max(0, endsAt − completedAt)`; vai de `base` (no último instante) a `1,5 × base` (no primeiro).

**Fim da rodada.** O servidor encerra no instante `endsAt` por um temporizador próprio (`TIMER`), ou quando o professor manda (`TEACHER`), ou quando a aula acaba (`SESSION`); isso fica gravado e é avisado a todos. Uma rodada que o servidor encontra vencida ao reiniciar é encerrada ao ser lida.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Migração `00035_live_exercise.sql`** (convenções de tabela da `ARCHITECTURE.md`, `up` e `down`):
  - `live_exercise_runs`: `id`, `session_id`, `block_id`, `exercise_index`, `title`, `difficulty` (`CHECK`), `duration_seconds` (`CHECK` de 60 a 3600), `started_at`, `ends_at`, `ended_at` (nulo enquanto roda), `ended_by` (`TIMER|TEACHER|SESSION`, nulo enquanto roda), `result_visible` (padrão falso); **índice único parcial: uma rodada sem `ended_at` por sessão**.
  - `live_exercise_results`: `id`, `run_id`, `student_id`, `completed_at`, `elapsed_seconds`, `points` (`CHECK ≥ 0`), `attempts` (`CHECK ≥ 1`); **única por `(run_id, student_id)`**.
- **Domínio:** a regra dos pontos, a validação de minutos, as transições da rodada (em andamento → encerrada, e o resultado só depois), com testes de tabela.
- **Repositório:** gravar a rodada, encerrar, mostrar ou ocultar o resultado, gravar o resultado do aluno sem duplicar, ler a rodada atual ou a última e seus resultados, e a **soma de pontos por aluno de uma turma** (a base da gamificação, só leitura aqui).
- **Serviço:** iniciar (lê o módulo da aula pelo leitor de conteúdo que o serviço já tem; valida bloco, índice e condições), encerrar (por professor, por tempo e pela aula que acaba), mostrar o resultado, conferir (lê as condições do módulo, `Grade`, resultado idempotente), e o estado em memória do progresso e da observação (o progresso nunca é gravado).
- **Handler/ws e REST:** as regras do hub (cada uma com o seu limite de tamanho; `live:exercise:progress` e `live:exercise:screen` sem `ControllerOnly`, porque são do aluno), as entregas de 3.1, o instantâneo por papel, a observação de um aluno por vez e a rota de conferência com limite de uma por 2 s por aluno.

### 3.3. Frontend (Next.js & SCSS Modules)

- **Contrato no cliente.** `classroomService.ts` ganha os tipos do exercício ao vivo e `submitExercise(classId, runId, snapshot)` (a rota REST de 3.1). O hook `useLiveClassroom` ganha: `exercise` (o estado da rodada, do instantâneo e das mensagens, com a correção do relógio pela hora do servidor), `exerciseProgress` (por aluno; só o painel), `watchedScreen` (a última imagem do aluno visto; só o painel), `watchedByTeacher` (o aluno está sendo visto), e as ações `startExercise(blockId, index, minutes?)`, `endExercise()`, `revealExercise(visible)`, `watchStudent(studentId | null)`, `sendExerciseProgress({runId, met, total, last})`, `sendExerciseScreen(runId, screen)`, que só mandam o que o papel pode.
- **O professor — seção "Exercício ao vivo" no painel** (coluna principal, depois dos cartões dos alunos online).
  - **Sem rodada:** a lista dos exercícios dos blocos do módulo da aula (bloco, título, nível), cada um com o campo "Minutos" (padrão 5, de 1 a 60) e o botão **"Iniciar exercício"**; o exercício sem condições fica desativado, com o motivo escrito.
  - **Em andamento:** o título, o nível, o **cronômetro** regressivo, "*N* de *M* concluíram", o botão **"Encerrar agora"**, e um **card por aluno online** com o nome, o estado (**"Fazendo"**, **"Concluiu em mm:ss · +*N* pontos"** ou **"Sem sinal"** quando não manda progresso há mais de 15 s), o andamento em texto ("2 de 4 condições") com uma barra, o último comando digitado, e os botões **"Ver terminal"** (liga e desliga a observação) e **"Enviar dica"** (abre a conversa em particular com o aluno, com as dicas do exercício para usar). Quando o professor vê um aluno, o **terminal ao vivo dele** aparece (o `TerminalMirror` da SPEC-056) com o nome e o botão "Parar de ver". Uma lista **"Dicas do exercício"** com o botão "Enviar para todos" em cada uma (pelo chat da SPEC-063, com o texto da dica e o comando de referência, se houver).
  - **Encerrada:** o resumo (quem concluiu, tempo, pontos; quantos não) e o botão **"Mostrar resultado aos alunos"** / **"Ocultar resultado"**, e "Nova rodada" volta à lista.
- **O aluno — a área do exercício.** Com a rodada **em andamento**, o aluno vê a **área do exercício no lugar do palco** (irmã do `FixedStage`, dentro do elemento da sala, como o modal da dúvida; nunca dentro da caixa 1280 × 720): o **enunciado** (o HTML filtrado do exercício, como a tela de estudo), o **terminal próprio** (o terminal real do motor, com a máquina montada como a tela de estudo monta: o cenário do módulo, os snapshots dos cards até este, o do grupo e as soluções dos exercícios anteriores do grupo), o andamento "*n* de *total* condições" (a conferência local do exercício, SPEC-022), o cronômetro e a mensagem de estado. A faixa de controles mostra o cronômetro e o botão **"Ver a aula" / "Voltar ao exercício"**, que alterna para o espelho do palco do professor sem parar o exercício.
  - **Concluir:** quando a conferência local cumpre todas as condições, o cliente envia o estado à rota de conferência (uma vez; com nova tentativa se falhar a rede) e mostra "Conferindo…". Aprovado: "Você concluiu! +*N* pontos, em mm:ss" (o ganho pessoal aparece sempre, mesmo sem o professor mostrar o resultado) e o terminal fica só para leitura. Reprovado pelo servidor: "Ainda falta algo. Continue tentando." e novo envio quando o estado mudar.
  - **Progresso e observação:** o cliente manda `live:exercise:progress` a cada 2 s no máximo (só quando muda) e, **enquanto `watchedByTeacher`**, manda a imagem do terminal a cada 200 ms no máximo.
  - **Recarregar não perde o trabalho:** o estado da máquina do aluno fica guardado no navegador, por rodada (`localStorage`, com `try/catch`), e volta ao recarregar.
  - **Fim:** ao encerrar, com o resultado **oculto**, aparece "Exercício encerrado" e o aluno volta ao palco; com o resultado **mostrado**, a área mostra o **placar** (nome, tempo, pontos, o do próprio aluno em destaque) e a **solução** do professor (como o professor fez: os comandos da solução gravada), com "Voltar à aula". O professor pode ocultar de novo e o aluno volta ao palco.
- **Texto puro.** Nomes, último comando e dicas são desenhados como texto, nunca como HTML (o enunciado é o HTML filtrado que o sistema já usa).

## 4. Modelo de Dados (Data Model)

`live_exercise_runs` e `live_exercise_results` (3.2). Nenhuma outra tabela muda. O estado de observação e o progresso ficam só em memória.

## 5. Contrato de API (API Contract)

O WebSocket da sala (3.1: as quatro mensagens do professor, as duas do aluno e as sete do servidor, mais `exercise` no instantâneo) e a rota `POST /api/v1/classes/{id}/live/exercise/submit`. Nenhuma outra rota nova ou alterada.

## 6. Impacto e Riscos (Impact & Risks)

- **Conferir no servidor não impede um estado forjado.** O servidor confere o **estado** que o navegador envia e nunca o "terminei" do cliente, mas um aluno que monte à mão um estado de máquina válido ainda consegue forjar a conclusão (a mesma ressalva da SPEC-014: o motor de comandos é do navegador e o servidor não reproduz os comandos). Os pontos ficam mais difíceis de forjar, não à prova de forja. Mitigação: o professor vê o terminal ao vivo e o último comando; reproduzir os comandos no servidor é uma spec à parte, se a pontuação passar a valer nota.
- **Carga de uma turma inteira.** Até 100 alunos mandando progresso a cada 2 s e conferências ao fim. Mitigação: o progresso é pequeno e só vai ao painel, a imagem do terminal só do aluno visto, e a conferência tem limite por aluno e de 2 MB.
- **Troca de módulo ou do exercício no meio da rodada.** A rodada guarda o título e o nível; as condições são lidas do módulo na conferência. Se o professor trocar o módulo da aula no meio, a conferência passa a falhar. Mitigação: trocar de módulo com rodada em andamento é recusado; o professor encerra antes.
- **Relógios diferentes.** O cronômetro vem do `endsAt` e da hora do servidor em cada mensagem; o servidor é quem encerra.
- **Rede que cai no fim.** Uma conferência em trânsito vale por até 2 segundos depois do fim.
- **Alunos sem o motor carregado ou com navegador lento.** O terminal do exercício é o mesmo motor da tela de estudo; o aluno vê "Carregando o terminal…" até estar pronto, e o tempo corre para todos.
- **Alunos que entram no meio ou saem e voltam.** Recebem o tempo restante, e o estado volta do navegador.
- **Aula muda para as lâminas durante o exercício.** O aluno continua na área do exercício até o fim; o professor é avisado na seção.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o professor inicia um exercício pelo painel, O SISTEMA DEVE criar a rodada com o tempo escolhido (padrão 5 minutos), avisar o painel e todos os alunos aceitos em até 300 ms e colocar cada aluno na área do exercício; DEVE recusar o início sem condições, de bloco fora do módulo da aula, com outra rodada em andamento, ou de quem não é o painel.
- [ ] **CA-02** (ubíquo): Cada aluno DEVE resolver no seu próprio terminal, montado como a tela de estudo monta a máquina do exercício, sem ver nem alterar o terminal dos outros nem o do professor.
- [ ] **CA-03** (ubíquo): O cronômetro DEVE ser igual para todos (pelo `endsAt` e pela hora do servidor); o servidor DEVE encerrar a rodada no fim do tempo, quando o professor mandar ou quando a aula acabar, gravar o motivo e avisar todos.
- [ ] **CA-04** (evento): QUANDO o aluno cumpre todas as condições na tela, O SISTEMA DEVE enviar o estado ao servidor, que DEVE conferi-lo com as condições lidas do módulo, gravar uma única vez o resultado (tempo e pontos), responder sem revelar as condições e avisar o painel; um envio repetido DEVE devolver o mesmo resultado.
- [ ] **CA-05** (ubíquo): Os pontos DEVEM ser a base da dificuldade (10, 20 ou 30) mais o bônus de rapidez proporcional ao tempo que sobrou (até 50% da base).
- [ ] **CA-06** (ubíquo): O painel DEVE mostrar, durante a rodada, o cronômetro, "*N* de *M* concluíram", e um card por aluno online com o estado, o andamento, o último comando e os botões "Ver terminal" e "Enviar dica"; o estado "Sem sinal" DEVE aparecer após 15 s sem progresso; os alunos NÃO DEVEM receber o progresso dos outros.
- [ ] **CA-07** (evento): QUANDO o professor escolhe "Ver terminal" de um aluno, O SISTEMA DEVE avisar só esse aluno, que passa a mandar a imagem do terminal, e o painel DEVE mostrá-la ao vivo; o servidor DEVE descartar a imagem de quem o painel não está vendo; só um aluno é visto por vez e a observação DEVE acabar com a rodada.
- [ ] **CA-08** (evento): QUANDO o professor manda uma dica (ao aluno, pela conversa, ou a todos), O SISTEMA DEVE entregá-la pelo chat da SPEC-063, com o texto e o comando de referência da dica.
- [ ] **CA-09** (evento): QUANDO a rodada encerra, O SISTEMA DEVE mostrar ao aluno "Exercício encerrado" e devolvê-lo ao palco, sem mostrar o placar nem a solução, até o professor escolher mostrar; o ganho pessoal do aluno que concluiu DEVE aparecer sempre.
- [ ] **CA-10** (evento): QUANDO o professor mostra o resultado, O SISTEMA DEVE mostrar aos alunos o placar (nome, tempo, pontos, ordenado) e a solução do professor; QUANDO o oculta, DEVE devolver os alunos ao palco; o professor só DEVE poder mostrar com a rodada encerrada.
- [ ] **CA-11** (ubíquo): O servidor DEVE guardar, por rodada e aluno, o momento de conclusão, o tempo, os pontos e as tentativas, uma vez por aluno e rodada, e DEVE expor no repositório a soma de pontos por aluno de uma turma.
- [ ] **CA-12** (evento): QUANDO o aluno entra ou reconecta durante ou depois da rodada, O SISTEMA DEVE dar-lhe o estado atual (tempo restante, resultado dele, resultado mostrado) pelo instantâneo; e QUANDO ele recarrega a página no meio, o estado do terminal DEVE voltar do navegador.
- [ ] **CA-13** (ubíquo): A área do exercício DEVE ficar dentro do elemento da sala, fora da caixa 1280 × 720 do palco, e o botão "Ver a aula" / "Voltar ao exercício" DEVE alternar sem parar o exercício; o palco do professor e dos outros alunos NÃO DEVE mudar.
- [ ] **CA-14** (ubíquo): O servidor DEVE rejeitar ou descartar (sem efeito) as mensagens de 3.1 fora do papel, fora da rodada ou com campo inválido, e DEVE limitar a conferência a uma por 2 s por aluno e a 2 MB.
- [ ] **CA-15** (ubíquo): Nomes, último comando, dicas e demais textos DEVEM ser desenhados como texto puro.
- [ ] **CA-16** (ubíquo): Nada fora da sala ao vivo DEVE mudar; os testes existentes passam sem alteração (salvo os helpers de mock, que ganham campos); `engine/core` não é alterado.
- [ ] **CA-17** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo; migração `00035` aplicada e revertida sem erro.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `domain`:** os pontos por dificuldade e bônus (primeiro instante, meio, último instante, depois do fim); os minutos (0, 1, 60, 61, padrão); as transições da rodada (CA-04, CA-05).
- **Backend, `repository`:** gravar e ler a rodada; uma só em andamento por sessão (a segunda falha); encerrar com o motivo; mostrar e ocultar; resultado único por aluno e rodada; a soma de pontos por aluno de uma turma; a migração `00035` sobe e desce (CA-01, CA-11, CA-17).
- **Backend, `service`:** iniciar (bloco do módulo, tipo `EXERCISES`, índice, sem condições, rodada já em andamento, módulo trocado); encerrar por professor, por tempo (com relógio falso) e pela aula; mostrar só encerrada; conferir (estado válido aprovado, reprovado, tolerância de 2 s, rodada encerrada, outro aluno, idempotência, tentativas); o resultado e o progresso por aluno (CA-01, CA-03, CA-04, CA-10, CA-11).
- **Backend, `handler`, `hub` e REST:** cada mensagem de 3.1 por papel (painel, apresentação, aluno aceito, aluno em espera); as entregas (o aluno nunca recebe o progresso dos outros; a imagem só vai ao painel e só do aluno visto); a observação de um por vez e o descarte da imagem fora dela; o instantâneo por papel (aluno com `myResult`, painel com `progress`, apresentação sem `exercise`); a rota de conferência (404, 409, 400, 413, 429, aprovado, repetido); o fim por tempo com a sala conectada (CA-06, CA-07, CA-12, CA-14).
- **Frontend, hook:** o instantâneo, as mensagens de rodada, progresso e resultado; a correção do relógio; as ações por papel; nada é mandado fora do papel (CA-03, CA-12).
- **Frontend, aluno:** a área do exercício aparece na rodada e some ao fim; o terminal parte do cenário certo; o andamento local; o envio ao servidor ao cumprir as condições (e o novo envio na falha); os estados de resultado; o placar com o aluno em destaque e a solução; "Ver a aula" alterna sem parar o exercício; a área fica fora da caixa do palco; o estado volta do navegador ao recarregar; só texto (CA-02, CA-04, CA-09, CA-10, CA-12, CA-13, CA-15).
- **Frontend, painel:** a lista de exercícios com os minutos e o início; o desativado sem condições; o cronômetro, a contagem e os cards; "Sem sinal"; "Ver terminal" liga e desliga e mostra a imagem; as dicas pelo chat; o encerramento; o resumo; mostrar e ocultar o resultado; só texto (CA-01, CA-06, CA-07, CA-08, CA-10, CA-15).
- **Regressão:** os testes existentes da sala, do painel, do hub, do `practice` e do `content` passam sem alteração, salvo os helpers de mock (CA-16).
- **Manual:** professor e três alunos; iniciar com 2 minutos; cada aluno faz o seu; o professor vê os andamentos, abre o terminal de um aluno, manda uma dica a um e outra a todos; um aluno conclui e o card do professor muda; deixar o tempo acabar; mostrar o resultado e ver o placar e a solução nos alunos; recarregar um aluno no meio e ver o terminal voltar.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-014, SPEC-022, SPEC-055, SPEC-056, SPEC-057, SPEC-063 e esta; **backend:** `internal/platform/hub/hub.go`, `internal/modules/classroom/**` (`handler/ws.go`, `handler/handler.go`, `service`, `repository`, `domain`), `internal/modules/practice/service` (`Check`, `parseMachine`), `internal/modules/content/domain` (`condition.go`, `exercise.go`, `catalogFromEnd`, `Grade`), `cmd/api/main.go` (a ligação dos módulos e o leitor de conteúdo da sala), `migrations/00030..00034`; **frontend:** `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `components/Classroom/**`, `components/ContentRenderer/ExercisesBlock.tsx` e `exerciseContext.ts`, `lib/exerciseConditions.ts`, `lib/setup.ts`, `components/ExerciseForm/ExerciseScreen.tsx` (a montagem das camadas da máquina), `components/TopicStudy/TerminalPane.tsx`, `engine/terminalWindow.ts`, `messages/pt-BR.ts`.
2. **Ordem de execução:** testes vermelhos e commit `test` antes do código, em cada frente. **Backend:** migração, domínio (pontos), repositório, serviço (rodada, temporizador, conferência), hub e handler (mensagens, entregas, instantâneo, REST). **Frontend:** contrato (tipos, serviço, hook), depois a área do aluno e a seção do painel. Textos de UI em `pt-BR.ts`; termos novos no glossário.
3. **Arquivos a criar ou alterar:** `backend/migrations/00035_live_exercise.sql`; `backend/internal/platform/hub/**`; `backend/internal/modules/classroom/**`; `backend/internal/modules/content/domain/exercise.go` (só para tornar pública a tradução das condições); `backend/cmd/api/main.go` (a ligação); `frontend/src/services/classroomService.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/ExerciseArea/**`, `ExerciseBoard/**` (novos), `LiveClassroom/**`, `TeacherPanel/**`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md`. **Não alterar** `engine/core` nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead respondeu às três dúvidas (placar e solução; o servidor confere; pontos por dificuldade com bônus de rapidez). São escolhas da Aruna, a revisar: (1) **um exercício por vez**, escolhido na lista do bloco, e não o grupo inteiro em sequência; (2) 10, 20 e 30 pontos de base e **bônus de até 50%**; (3) o painel vê **um terminal de aluno por vez**, e os outros só em resumo (andamento e último comando); (4) o aluno vê o **ganho pessoal** ao concluir mesmo que o professor não mostre o resultado; (5) trocar de módulo com rodada em andamento é recusado; (6) o estado do terminal do aluno fica no navegador (`localStorage`) para sobreviver a recarregar; (7) **"Sem sinal"** após 15 s; (8) a janela de apresentação não mostra nada do exercício; (9) **o servidor confere o estado que o navegador manda, e isso não impede um estado forjado à mão** (seção 6): o texto da opção que o Tech Lead escolheu dizia que os pontos não dá para forjar, e isso é mais forte do que a verdade; reproduzir os comandos no servidor ficaria para uma spec à parte.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead, que respondeu às três dúvidas; as escolhas da seção 10 ficam para a revisão dele |
