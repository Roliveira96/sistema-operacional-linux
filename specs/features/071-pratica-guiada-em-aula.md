# SPEC-071: Prática Guiada em Aula (Pausa, Mais Tempo, Abas de Atendimento e Assumir o Terminal)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-071 |
| **Status** | Implementada |
| **Data de criação** | 16/10/2026 |
| **Última revisão** | 16/10/2026 (aprovada pelo Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend, com migração); `frontend/src/components/Classroom/` (`ExerciseArea`, `ExerciseBoard`, `TeacherPanel`, `LiveClassroom`), `hooks/useLiveClassroom.ts`, `services/classroomService.ts` |
| **Contexto de tela** | Painel do professor e sala do aluno, no modo Módulo da aula ao vivo, durante uma rodada de exercício |
| **Prioridade** | Alta |
| **Depende de** | SPEC-065 (exercício prático ao vivo, que esta spec amplia), SPEC-056 (espelho do terminal), SPEC-058 e SPEC-062 (mão levantada e dúvida), SPEC-063 (chat da aula) |
| **Substitui** | Nenhuma (amplia a SPEC-065; o que esta spec não muda continua como a SPEC-065 define) |
| **Fontes canônicas** | Tech Spec "Modo Prática Guiada em Aula e Controle Síncrono", trazida pelo Tech Lead em 16/10/2026, e as decisões dele na mesma data: ampliar a SPEC-065 com os nomes do projeto; só o takeover tira os pontos, e as mensagens individuais ou em grupo não; pausa com o terminal travado; até 4 abas; reaproveitar o chat e a mão levantada; ocioso em 60 s; "perto do fim" no último 20%; gravar todos os participantes; latência como meta; ao fim do tempo a tela do aluno trava sem apagar os comandos; "Voltar para a aula" com o cronômetro correndo encerra a rodada (P-01); no takeover o professor usa o terminal do aluno como se fosse o dele, tecla a tecla, inclusive `vim`, `nano`, `top` e `Ctrl+C` (P-02); o professor pode dar mais tempo a uma rodada que já terminou; o professor volta para a aula pelo botão "Voltar para a aula", com aviso quando o cronômetro não terminou ou quando há alunos que não finalizaram |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-065 deu ao professor a rodada de exercício: ele inicia um exercício de um bloco com tempo, cada aluno resolve no próprio terminal, o painel mostra um card por aluno, o professor vê o terminal de **um** aluno por vez e manda dicas pelo chat, e o servidor confere e guarda os pontos de quem concluiu.

Na prática guiada em sala faltam alguns controles:

- o cronômetro não pausa nem ganha minutos, e uma rodada encerrada não pode continuar;
- ao fim do tempo o aluno volta direto ao palco: a tela dele some antes de o professor comentar o que cada um fez;
- o professor atende um aluno por vez, sem abas, e perde o contexto ao trocar;
- quando um aluno trava, o professor só consegue mandar texto; não consegue **mostrar na máquina do aluno**;
- o painel não diferencia quem está parado de quem está trabalhando, nem destaca quem vai acabar o tempo sem concluir;
- só quem concluiu fica gravado, e sem a quantidade de comandos, o pedido de ajuda ou a ajuda recebida.

## 2. Objetivos (Goals)

- O professor **pausa** e **retoma** a rodada; durante a pausa o cronômetro para e o terminal dos alunos fica travado.
- O professor **adiciona minutos** a uma rodada em andamento, pausada ou **já encerrada** (enquanto não voltou para a aula); a rodada encerrada volta a correr para quem não concluiu.
- Ao fim do tempo (ou ao encerrar), o terminal do aluno **trava sem apagar** o que ele digitou, e ele continua vendo a própria tela até o professor **voltar para a aula**.
- O professor volta para a aula pelo botão **"Voltar para a aula"**, com aviso se o cronômetro não terminou ou se há alunos que não finalizaram.
- O painel ganha **abas de atendimento** (até 4), uma por aluno, com o terminal ao vivo, o histórico de comandos e a conversa particular.
- O professor pode **assumir o terminal** de um aluno, digitar comandos na máquina dele e **devolver o controle**; quem teve o terminal assumido **não ganha pontos** na rodada.
- A mensagem particular do professor aparece **por cima do terminal** do aluno.
- O card do aluno mostra **"Ocioso"** e a **mão levantada**, e o painel destaca os **alunos retidos** perto do fim.
- O servidor grava **um resultado por participante**, com o estado, a quantidade de comandos, se pediu ajuda e se teve o terminal assumido.

### 2.1. Fora de escopo (Non-Goals)

- A tela de ranking e qualquer tela de gamificação (como na SPEC-065).
- Mudar o motor em `engine/core` para o takeover: as teclas do professor entram pelos mesmos eventos de teclado que o motor já ouve, disparados pelo adaptador (3.5).
- Mouse, seleção com o mouse e redimensionar a tela do aluno no takeover (só teclado e colagem).
- Assumir mais de um terminal ao mesmo tempo.
- Mais de 4 abas de atendimento, ou mais de uma imagem ao vivo por vez (só a aba ativa recebe a imagem).
- Guardar o histórico de comandos do aluno no servidor (ele fica na memória do painel durante a rodada).
- Medir a latência em teste automatizado (RNF-01 da fonte vira meta medida à mão, seção 6).
- Mudar a regra de pontos de quem conclui sem takeover (continua a da SPEC-065), a janela de apresentação, o chat fora da rodada e qualquer tela fora da aula ao vivo.
- Alterar `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Estados da rodada

A rodada da SPEC-065 tinha dois estados (em andamento e encerrada). Passa a ter quatro:

| Estado | Significado | Terminal do aluno | Onde o aluno está |
| :--- | :--- | :--- | :--- |
| `RUNNING` | O cronômetro corre | Livre (salvo concluído ou com o terminal assumido) | Área do exercício |
| `PAUSED` | O cronômetro está parado pelo professor | Travado, com o aviso "Pausado pelo professor" | Área do exercício |
| `ENDED` | O tempo acabou ou o professor encerrou, e ele ainda não voltou para a aula | Travado, com tudo o que foi digitado visível | Área do exercício |
| `CLOSED` | O professor voltou para a aula | — | Palco (ou o resultado, se o professor o mostrar, como na SPEC-065) |

Transições:

| De | Para | Como |
| :--- | :--- | :--- |
| `RUNNING` | `PAUSED` | O professor pausa |
| `PAUSED` | `RUNNING` | O professor retoma; o fim passa a ser agora mais o tempo que restava |
| `RUNNING` ou `PAUSED` | `ENDED` | Fim do tempo (`TIMER`, só em `RUNNING`), o professor encerra (`TEACHER`), a aula acaba (`SESSION`) |
| `ENDED` | `RUNNING` | O professor adiciona minutos (reabertura) |
| `RUNNING`, `PAUSED` ou `ENDED` | `CLOSED` | O professor clica "Voltar para a aula" (em `RUNNING` ou `PAUSED`, encerra antes com `TEACHER`); a aula que acaba também fecha |

`CLOSED` é final: não volta a correr. "Mostrar resultado" e "Ocultar resultado" (SPEC-065) valem em `ENDED` e em `CLOSED`.

### 3.2. Regras de negócio

- **RN-01 (pausa):** só em `RUNNING`. O servidor para o temporizador e guarda o início da pausa. Ao retomar, soma o tempo pausado e o novo fim é a hora da retomada mais o tempo que restava. Durante a pausa a conferência do aluno é recusada (409 `exercise-paused`) e o progresso é descartado.
- **RN-02 (mais tempo):** de 1 a 30 minutos por vez, em `RUNNING`, `PAUSED` ou `ENDED`; a soma da duração da rodada (a inicial mais os acréscimos) não passa de 60 minutos. Em `RUNNING` e `PAUSED`, o fim avança os minutos dados. Em `ENDED`, a rodada **reabre**: volta a `RUNNING`, o fim é agora mais os minutos dados, o motivo do encerramento é apagado e o resultado volta a ficar oculto. A reabertura é recusada se outra rodada já foi iniciada na aula, se a rodada está `CLOSED`, se a aula acabou ou se o bloco não está mais no módulo da aula.
- **RN-03 (fim sem apagar):** em `ENDED`, o aluno continua na área do exercício, com o terminal **travado e sem limpar** a tela, os comandos e a saída; o estado da máquina continua guardado no navegador (SPEC-065) para a reabertura continuar de onde parou.
- **RN-04 (voltar para a aula):** só o painel. Se a rodada está `RUNNING` ou `PAUSED`, ou se há participantes que não concluíram, o painel mostra antes um aviso (seção 3.5) e só segue com a confirmação. Ao confirmar, o servidor encerra a rodada se ainda corria (`TEACHER`), fecha (`CLOSED`) e todos os alunos voltam ao palco.
- **RN-05 (assumir o terminal):** só o painel, só em `RUNNING`, só um aluno por vez e só o aluno que o painel está vendo (`watch` da SPEC-065), que precisa estar online e não ter concluído. O servidor marca o participante como **terminal assumido** (gravado na hora, RN-08) e avisa o aluno, cujo teclado e colagem ficam travados com o aviso "O professor assumiu o controle do seu terminal". Enquanto dura, o professor usa o terminal do aluno **como se fosse o dele**: cada tecla (com Ctrl, Alt e Shift) e cada colagem que ele faz no espelho da aba vai ao servidor, que a repassa só a esse aluno, e o navegador do aluno a entrega ao terminal como se o aluno tivesse teclado; vale no shell, no `top`, no `nano`, no `vim` e no `Ctrl+C`. O professor vê o resultado pelo espelho do terminal (SPEC-056), que fica ligado durante o takeover.
- **RN-06 (devolver o controle):** o professor devolve; o takeover também acaba se o professor deixa de ver o aluno, se o aluno sai da sala, se a rodada pausa, encerra ou fecha. Ao acabar, o aluno é avisado e volta a digitar (se a rodada estiver `RUNNING`).
- **RN-07 (pontos com takeover):** o participante que teve o terminal assumido **em qualquer momento da rodada** conclui com **0 pontos**, seja a conclusão durante o takeover ou depois. A conclusão, o tempo e as tentativas são gravados como de qualquer aluno. Mensagens do professor (particulares ou para todos) e dicas **não** tiram pontos. Sem takeover, os pontos são os da SPEC-065. O tempo pausado não conta no tempo do aluno; o bônus de rapidez usa o fim em vigor no momento da conclusão.
- **RN-08 (um resultado por participante):** o servidor grava uma linha por aluno participante da rodada, criada quando ele recebe a rodada (ou quando entra no meio), com o estado `IN_PROGRESS`; muda para `COMPLETED` ao concluir; e, ao encerrar, quem não concluiu passa a `NOT_COMPLETED` (e volta a `IN_PROGRESS` numa reabertura). A linha guarda ainda a quantidade de comandos (a última que o aluno informou), se ele levantou a mão durante a rodada e se teve o terminal assumido.
- **RN-09 (comandos):** o aluno informa, junto do progresso da SPEC-065, quantos comandos já executou na rodada; o número só cresce (um valor menor é ignorado).
- **RN-10 (ocioso):** o card do aluno mostra "Ocioso" quando ele não executa um comando há 60 s, com a rodada `RUNNING` e o progresso chegando; "Sem sinal" (15 s sem progresso, SPEC-065) tem prioridade sobre "Ocioso". O tempo pausado não conta.
- **RN-11 (aluno retido):** com a rodada `RUNNING`, quando o tempo que resta é menor ou igual ao maior entre 20% da duração e 60 s, o card de quem não concluiu fica destacado como "Perto do fim" e esses cards sobem para o começo da lista.
- **RN-12 (abas):** o painel abre até 4 abas de atendimento, uma por aluno, sem sair da seção nem recarregar a aula. Só a aba ativa é a observação do terminal (`watch`); trocar de aba troca o aluno visto, e as outras mostram o último quadro recebido. Fechar uma aba é só da tela: não muda nada do aluno no servidor (se era a aba vista, o painel deixa de ver o aluno). A aba de quem está com a mão levantada ou com mensagem nova tem destaque visual.
- **RN-13 (mensagem por cima do terminal):** a mensagem particular do professor (chat da SPEC-063, `scope: "private"`) que chega ao aluno com a rodada `RUNNING` ou `PAUSED` aparece também como um aviso por cima do terminal, com o nome do professor e o botão "Fechar"; a conversa continua no chat como hoje. A mensagem para todos não aparece por cima do terminal.

### 3.3. Contrato do protocolo (amplia a seção 3.1 da SPEC-065)

**Cliente → servidor, só o painel do professor:**

| Mensagem | Dados | Regra |
| :--- | :--- | :--- |
| `live:exercise:pause` | `{"paused": bool}` | `true` só em `RUNNING`; `false` só em `PAUSED` (RN-01) |
| `live:exercise:extend` | `{"minutes": int}` | De 1 a 30; estados e limite de RN-02 |
| `live:exercise:close` | `{}` | Em `RUNNING`, `PAUSED` ou `ENDED` (RN-04); o aviso é do painel, o servidor não pergunta |
| `live:exercise:takeover` | `{"studentId": uuid, "on": bool}` | `on: true` nas condições de RN-05; `on: false` só para o aluno assumido |
| `live:exercise:key` | `{"studentId": uuid, "key": string, "ctrl": bool, "alt": bool, "shift": bool}` ou `{"studentId": uuid, "paste": string}` | Só com o takeover desse aluno ligado; `key` é o nome da tecla do navegador (um caractere ou um nome como `Enter`, `Backspace`, `ArrowUp`, `Escape`, `Tab`), até 20 caracteres; `paste` de 1 a 2 000 caracteres; no máximo 40 por segundo (o excedente é descartado) |

**Cliente → servidor, aluno:** `live:exercise:progress` ganha o campo `"commands": int` (de 0 a 10 000; RN-09). As demais regras da SPEC-065 continuam.

**Servidor → clientes:**

| Mensagem | Para quem | Dados |
| :--- | :--- | :--- |
| `live:exercise:paused` | painel e alunos aceitos | `{"runId","paused":bool,"endsAt","pausedSeconds","now"}` (em pausa, `endsAt` é o fim que valia na hora da pausa) |
| `live:exercise:extended` | painel e alunos aceitos | `{"runId","endsAt","durationSeconds","reopened":bool,"now"}` |
| `live:exercise:closed` | painel e alunos aceitos | `{"runId","closedAt","now"}` |
| `live:exercise:takeover` | o aluno assumido e o painel | Ao aluno: `{"on":bool,"teacherName"}`; ao painel: `{"studentId","on":bool}` (confirma ou avisa que acabou, RN-06) |
| `live:exercise:key` | só o aluno assumido | `{"key","ctrl","alt","shift"}` ou `{"paste"}`, na ordem em que o professor teclou |
| `live:exercise:progress` | só o painel | ganha `"commands"`, `"lastCommandAt"` (para o "Ocioso"), `"handRaised"` |

`live:exercise:ended` continua e ganha o estado final `ENDED`; o aluno **não** volta ao palco com ele (RN-03), só com `live:exercise:closed`.

**Instantâneo (`live:snapshot`).** O objeto `exercise` da SPEC-065 ganha `"status":"RUNNING|PAUSED|ENDED|CLOSED"`, `"pausedSeconds"`, `"closedAt"`; o **aluno** recebe `"takenOver": bool` (o takeover está ligado nele agora); o **painel** recebe em `progress` os campos `commands`, `lastCommandAt`, `handRaised`, `takenOver` (já teve o terminal assumido) e `takeoverOn` (ligado agora), e o `status` do resultado de cada um. A janela de apresentação continua sem `exercise`.

**Conferência (REST).** `POST /api/v1/classes/{id}/live/exercise/submit` (SPEC-065) passa a: responder 409 `exercise-paused` em `PAUSED`; aceitar a conclusão em `RUNNING`, inclusive durante o takeover; devolver `points: 0` a quem teve o terminal assumido (RN-07). Nenhuma outra rota nova ou alterada.

### 3.4. Backend (Go — Camada de Módulo/Service)

- **Migração `00040_live_exercise_guided.sql`** (`up` e `down`):
  - `live_exercise_runs` ganha `paused_at` (nulo fora da pausa), `paused_seconds` (soma das pausas, padrão 0) e `closed_at` (nulo até voltar para a aula); `duration_seconds` passa a ser a duração total (inicial mais os acréscimos), ainda de 60 a 3600.
  - `live_exercise_results` ganha `status`, `commands`, `help_requested` e `taken_over`; `completed_at`, `elapsed_seconds` e `points` passam a aceitar nulo (só `COMPLETED` os tem) e `attempts` passa a aceitar 0. As linhas da SPEC-065 viram `COMPLETED`.
- **Domínio:** os quatro estados e as transições de 3.1; a pausa e a retomada; o acréscimo e o limite de 60 minutos; o tempo do aluno sem as pausas; os pontos com takeover (RN-07); a validação da tecla e da colagem do takeover; tudo com testes de tabela.
- **Repositório:** pausar, retomar, acrescentar, reabrir e fechar a rodada; criar a linha do participante sem duplicar; marcar ajuda e takeover; gravar comandos; passar quem não concluiu a `NOT_COMPLETED` e de volta na reabertura; a soma de pontos por aluno (SPEC-065) continua igual (quem não concluiu soma 0).
- **Serviço:** as regras RN-01 a RN-09; o temporizador que para na pausa e volta no acréscimo e na retomada; o takeover em memória (um por aula), ligado à observação; a mão levantada durante a rodada marca `help_requested`; a aula que acaba fecha a rodada.
- **Handler/ws e hub:** as mensagens de 3.3 por papel, cada uma com o seu limite de tamanho; `live:exercise:key` só chega ao aluno assumido, na ordem; o instantâneo por papel; o log `classroom message rejected` ou `classroom message dropped` para o que for recusado, como na SPEC-065.

### 3.5. Frontend (Next.js & SCSS Modules)

- **Contrato no cliente.** O hook `useLiveClassroom` ganha o estado da rodada com os quatro valores, `pausedSeconds`, o takeover (aluno: `takenOver`; painel: quem está assumido), os campos novos do progresso e as ações `pauseExercise(paused)`, `extendExercise(minutes)`, `closeExercise()`, `takeover(studentId, on)`, `sendTakeoverKey(studentId, key)`, `sendTakeoverPaste(studentId, text)`; o progresso que o aluno manda ganha `commands`. Só manda o que o papel pode.
- **Professor — seção "Exercício ao vivo" (SPEC-065), em andamento ou pausada:**
  - os botões **"Pausar"** / **"Retomar"**, **"+ minutos"** (campo de 1 a 30, padrão 2) e **"Encerrar agora"**; o cronômetro mostra "Pausado" na pausa;
  - os cards dos alunos ganham o estado **"Ocioso"** (RN-10), o ícone da **mão levantada**, a quantidade de comandos e o destaque **"Perto do fim"** (RN-11); clicar no card (ou em "Atender") abre a aba do aluno;
  - as **abas de atendimento** (RN-12), acima dos cards: o nome, o destaque de mão ou mensagem nova e o "×" para fechar; a quinta aba é recusada com o aviso "Feche uma aba para abrir outra". A aba ativa mostra o terminal ao vivo do aluno (o `TerminalMirror`), o **histórico de comandos** da rodada (os últimos comandos que chegaram no progresso, em ordem, no máximo 200) e a **conversa particular** com o aluno (o chat da SPEC-063);
  - na aba ativa, o botão **"Assumir terminal"**; com o takeover ligado, a aba ganha o aviso "Você está controlando o terminal de *nome*", o espelho do terminal passa a receber o foco e o teclado do professor (as teclas e a colagem vão ao aluno; o atalho do navegador que o professor usar não é capturado) e o botão **"Devolver controle"** (também pela tecla de atalho `Ctrl+Shift+D`, que não vai ao aluno); o card desse aluno mostra "Terminal assumido" e, depois, "Teve ajuda no terminal (sem pontos)".
- **Professor — rodada encerrada (`ENDED`):** o resumo da SPEC-065, **"+ minutos"** (reabre, RN-02), "Mostrar resultado aos alunos" / "Ocultar resultado" e **"Voltar para a aula"**. Em `RUNNING` e `PAUSED`, **"Voltar para a aula"** também aparece.
- **Aviso de "Voltar para a aula" (RN-04):** um diálogo que diz, conforme o caso, "O cronômetro ainda não terminou (faltam mm:ss)" e/ou "*N* alunos não finalizaram", com os botões "Cancelar" e "Voltar para a aula"; com a rodada encerrada e todos concluídos, volta sem diálogo. Em `CLOSED` a seção mostra o resumo, o resultado e "Nova rodada".
- **Aluno — área do exercício:**
  - **pausa:** o cronômetro mostra "Pausado", o terminal fica travado (teclado e colagem, como o terminal concluído da SPEC-065) com o aviso "Pausado pelo professor"; ao retomar, destrava;
  - **mais tempo:** o cronômetro passa ao novo fim; numa reabertura, quem não concluiu volta a digitar no mesmo terminal, com a mesma máquina;
  - **fim (`ENDED`):** o terminal trava **sem limpar nada** e a área mostra "Tempo esgotado" (ou "Exercício encerrado pelo professor"), com o ganho pessoal de quem concluiu; o aluno fica na área até `CLOSED`; "Ver a aula" continua alternando para o palco;
  - **voltar para a aula (`CLOSED`):** o aluno volta ao palco, como o fim da SPEC-065 fazia;
  - **takeover:** o teclado e a colagem do aluno travam com o aviso "O professor assumiu o controle do seu terminal", e as teclas que chegam são entregues ao terminal na ordem, pelo adaptador do motor (`engine/`, fora de `core`): no shell e no `top`, o adaptador dispara o mesmo evento de teclado que o motor ouve; nos editores (`nano`, `vim`), que dependem do campo de texto do navegador, o adaptador também faz no campo o que a tecla faria (inserir o caractere, apagar, quebrar a linha, mover o cursor) e avisa o editor da mudança; ao devolver, aparece "O professor devolveu o controle" e destrava; quem concluiu com takeover vê "Você concluiu com a ajuda do professor no terminal (sem pontos)";
  - **mensagem particular por cima do terminal** (RN-13), com "Fechar".
- **Texto puro.** Nomes, comandos, histórico e mensagens são desenhados como texto, nunca como HTML. Os textos novos ficam em `messages/pt-BR.ts`.

## 4. Modelo de Dados (Data Model)

**`live_exercise_runs` (alterada):**

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `paused_at` | timestamptz | Não | Nulo fora da pausa; só com `ended_at` nulo | Início da pausa em andamento |
| `paused_seconds` | integer | Sim | `≥ 0`, padrão 0 | Soma das pausas já terminadas |
| `closed_at` | timestamptz | Não | Só com `ended_at` preenchido | Quando o professor voltou para a aula (ou a aula acabou) |
| `duration_seconds` | integer | Sim | 60 a 3600 (já existia) | Passa a ser a duração total, com os acréscimos |

O índice único parcial "uma rodada sem `ended_at` por sessão" continua; a pausa não muda `ended_at`, e a reabertura volta `ended_at` a nulo.

**`live_exercise_results` (alterada):**

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `status` | text | Sim | `IN_PROGRESS`, `COMPLETED`, `NOT_COMPLETED` | Estado do participante (RN-08) |
| `completed_at`, `elapsed_seconds`, `points` | (já existiam) | Só em `COMPLETED` | Preenchidos se e só se `COMPLETED`; `points` 0 com `taken_over` | Conclusão, tempo sem as pausas e pontos |
| `attempts` | integer | Sim | `≥ 0` (era `≥ 1`) | Conferências feitas |
| `commands` | integer | Sim | `≥ 0`, padrão 0 | Comandos executados na rodada (RN-09) |
| `help_requested` | boolean | Sim | Padrão falso | Levantou a mão durante a rodada |
| `taken_over` | boolean | Sim | Padrão falso | Teve o terminal assumido em algum momento (RN-07) |

Valores de `status`: `IN_PROGRESS` (participando, sem concluir), `COMPLETED` (o servidor aprovou), `NOT_COMPLETED` (a rodada encerrou sem a conclusão). A unicidade `(run_id, student_id)` continua. A exclusão continua lógica, como na SPEC-065. A migração `down` volta as colunas e apaga as linhas que não são `COMPLETED`.

## 5. Contrato de API (API Contract)

O WebSocket da sala (seção 3.3: cinco mensagens novas do painel, o campo novo do progresso do aluno, cinco mensagens novas do servidor e os campos novos do instantâneo) e a mudança da conferência `POST /api/v1/classes/{id}/live/exercise/submit`:

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 409 | `exercise-paused` | A rodada está pausada (novo) |
| 200 | — | Aprovado; `points` é 0 para quem teve o terminal assumido (novo) |

Os demais erros e respostas da SPEC-065 continuam. Nenhuma outra rota nova ou alterada.

## 6. Impacto e Riscos (Impact & Risks)

- **O professor resolve pelo aluno e o aluno pontua.** É o motivo da RN-07. Mitigação: a marca de takeover é gravada no servidor **quando o takeover começa**, antes de qualquer comando, e a conferência lê essa marca; o cliente não informa nada sobre isso.
- **Tecla entregue no navegador errado.** Mitigação: `live:exercise:key` só vai ao aluno assumido, e o takeover exige que ele seja o aluno visto; o aluno descarta `key` sem o takeover ligado nele.
- **Teclas que o motor recebe diferente da tecla de verdade.** O motor ouve eventos de teclado, mas os editores contam com o campo de texto do navegador para escrever, e um evento disparado por código não escreve sozinho. Mitigação: o adaptador faz a edição no campo para as teclas de edição (caracteres, `Backspace`, `Delete`, `Enter`, `Tab`, setas, `Home`, `End`) e avisa o editor; os testes do adaptador cobrem shell, `top`, `nano` e `vim` com cada uma dessas teclas e o `Ctrl+C`; uma tecla fora dessa lista é entregue só como evento.
- **Muitas teclas.** Limite de 40 por segundo e colagem de até 2 000 caracteres; o que passar é descartado; tudo roda no simulador do navegador do aluno.
- **Ordem e latência das teclas.** Uma tecla fora de ordem estraga o comando. Mitigação: o servidor repassa na ordem de chegada pela mesma conexão; a meta é abaixo de 100 ms (manual).
- **Reabrir uma rodada muda o placar já mostrado.** Mitigação: a reabertura oculta o resultado; os pontos de quem já concluiu não mudam.
- **Pausa e reabertura confundem o temporizador.** Mitigação: o servidor é o único que encerra; o cliente só desenha o `endsAt` e a hora do servidor de cada mensagem; os testes do serviço usam relógio falso.
- **Carga com abas.** Até 4 abas, mas uma só imagem ao vivo (a aba ativa), como a SPEC-065 já limitava.
- **Latência (meta).** Takeover e espelho devem responder em menos de 100 ms na rede local da UTFPR. É meta medida à mão (seção 8), não critério de aceite.
- **Rodadas antigas.** As linhas da SPEC-065 viram `COMPLETED`; as rodadas encerradas antes desta spec ficam `ENDED` com `closed_at` nulo e são tratadas como fechadas ao ser lidas (não reabrem, porque o professor já voltou para a aula no fluxo antigo).

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO o professor pausa a rodada em andamento, O SISTEMA DEVE parar o cronômetro de todos, travar o terminal dos alunos com o aviso de pausa, recusar a conferência (409 `exercise-paused`) e descartar o progresso; QUANDO retoma, DEVE recalcular o fim pelo tempo que restava e destravar os terminais.
- [x] **CA-02** (evento): QUANDO o professor adiciona minutos (1 a 30) a uma rodada em andamento ou pausada, O SISTEMA DEVE avançar o fim para todos; DEVE recusar o que passar de 60 minutos no total.
- [x] **CA-03** (evento): QUANDO o professor adiciona minutos a uma rodada encerrada que ainda não voltou para a aula, O SISTEMA DEVE reabri-la, ocultar o resultado, destravar o terminal de quem não concluiu com a mesma máquina e manter o resultado de quem concluiu; DEVE recusar a reabertura de rodada fechada, de outra rodada iniciada depois, de aula encerrada ou de bloco fora do módulo.
- [x] **CA-04** (evento): QUANDO a rodada encerra, O SISTEMA DEVE travar o terminal do aluno sem apagar a tela, os comandos nem a saída, e manter o aluno na área do exercício até o professor voltar para a aula.
- [x] **CA-05** (evento): QUANDO o professor clica "Voltar para a aula" com o cronômetro correndo ou pausado, ou com alunos que não concluíram, O SISTEMA DEVE mostrar o aviso correspondente e só seguir com a confirmação; ao seguir, DEVE encerrar a rodada se ela corria, fechá-la e devolver todos os alunos ao palco.
- [x] **CA-06** (ubíquo): O painel DEVE abrir até 4 abas de atendimento, cada uma com o terminal ao vivo (só na aba ativa), o histórico de comandos e a conversa particular do aluno; abrir, trocar e fechar abas NÃO DEVE mudar nada do aluno no servidor além de quem é visto; a aba com mão levantada ou mensagem nova DEVE ter destaque.
- [x] **CA-07** (evento): QUANDO o professor assume o terminal do aluno visto, O SISTEMA DEVE gravar a marca de takeover, travar o teclado do aluno com o aviso e entregar ao terminal dele, na ordem, as teclas e a colagem do professor, de modo que o shell, o `top`, o `nano`, o `vim` e o `Ctrl+C` respondam como se o professor teclasse no próprio terminal; QUANDO o professor devolve, deixa de ver o aluno, ou a rodada pausa, encerra ou fecha, O SISTEMA DEVE encerrar o takeover e avisar o aluno.
- [x] **CA-08** (ubíquo): O participante que teve o terminal assumido em algum momento da rodada DEVE concluir com 0 pontos, durante ou depois do takeover; mensagens particulares, mensagens para todos e dicas NÃO DEVEM mudar os pontos.
- [x] **CA-09** (indesejado): SE o takeover ou as teclas vierem de quem não é o painel, para aluno que não é o visto, offline ou que já concluiu, com outro takeover ligado, fora de `RUNNING`, ou com a tecla ou a colagem inválida, ENTÃO O SISTEMA DEVE recusar sem efeito, e a tecla NÃO DEVE chegar a nenhum outro aluno.
- [x] **CA-10** (evento): QUANDO o professor manda uma mensagem particular a um aluno com a rodada em andamento ou pausada, O SISTEMA DEVE mostrá-la também por cima do terminal desse aluno, com "Fechar"; a mensagem para todos NÃO DEVE aparecer por cima do terminal.
- [x] **CA-11** (estado): ENQUANTO a rodada corre, o card do aluno DEVE mostrar "Ocioso" após 60 s sem comando ("Sem sinal" tem prioridade), a mão levantada e a quantidade de comandos; e, quando o tempo que resta for menor ou igual ao maior entre 20% da duração e 60 s, DEVE destacar como "Perto do fim" e pôr primeiro os que não concluíram.
- [x] **CA-12** (ubíquo): O servidor DEVE guardar uma linha por participante com o estado (`IN_PROGRESS`, `COMPLETED`, `NOT_COMPLETED`), os comandos, se pediu ajuda e se teve o terminal assumido, e o tempo do aluno NÃO DEVE contar as pausas.
- [x] **CA-13** (evento): QUANDO o aluno ou o painel entram ou reconectam no meio, O SISTEMA DEVE dar o estado de 3.3 pelo instantâneo (estado da rodada, pausa, takeover ligado, campos novos do progresso).
- [x] **CA-14** (ubíquo): Nomes, comandos, histórico e mensagens DEVEM ser desenhados como texto puro.
- [x] **CA-15** (ubíquo): O que esta spec não muda da SPEC-065 DEVE continuar igual (os testes dela passam, salvo os ajustados pelo novo fim que trava sem voltar ao palco e os helpers de mock); nada fora da sala ao vivo muda; `engine/core` não é alterado.
- [x] **CA-16** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo; migração `00040` aplicada e revertida sem erro.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `domain`:** as transições de 3.1 (cada par permitido e os recusados); a pausa e a retomada (fim recalculado, `paused_seconds`); o acréscimo (1, 30, 31, soma 60 e 61); o tempo do aluno sem as pausas; os pontos com e sem takeover; a tecla e a colagem (nome vazio, 20 e 21 caracteres, colagem de 2 000 e 2 001, com e sem modificadores) (CA-01, CA-02, CA-03, CA-08, CA-09, CA-12).
- **Backend, `repository`:** pausar, retomar, acrescentar, reabrir e fechar; a linha do participante única; ajuda, takeover e comandos; `NOT_COMPLETED` ao encerrar e de volta na reabertura; a soma de pontos com linhas não concluídas; a migração `00040` sobe e desce, com as linhas antigas viradas `COMPLETED` (CA-03, CA-12, CA-16).
- **Backend, `service`:** pausa com conferência recusada; temporizador parado e retomado (relógio falso); acréscimo em cada estado e os limites; reabertura e as recusas; voltar para a aula em cada estado; takeover (condições de RN-05, fim por cada motivo de RN-06, marca gravada antes da primeira tecla, limite de 40 por segundo); conferência durante e depois do takeover com 0 pontos; mão levantada marca ajuda; mensagens não mudam pontos (CA-01 a CA-05, CA-07, CA-08, CA-12).
- **Backend, `handler` e `hub`:** cada mensagem de 3.3 por papel (painel, apresentação, aluno aceito, aluno em espera); `key` só ao aluno assumido e na ordem; o `ended` não devolve ao palco e o `closed` sim; o instantâneo por papel; a conferência com 409 `exercise-paused` (CA-09, CA-13).
- **Frontend, hook:** os quatro estados, a pausa e o acréscimo pelo instantâneo e pelas mensagens; o takeover; as ações por papel; `commands` no progresso (CA-01, CA-02, CA-07, CA-13).
- **Frontend, aluno (`ExerciseArea`):** pausa trava e destrava; fim trava sem limpar e fica na área; `closed` volta ao palco; reabertura destrava com a mesma máquina; takeover trava o teclado do aluno, entrega as teclas em ordem e devolve; conclusão com takeover mostra "sem pontos"; mensagem particular por cima do terminal e a para todos não; só texto (CA-01, CA-03, CA-04, CA-07, CA-08, CA-10, CA-14).
- **Frontend, adaptador das teclas remotas (`engine/`, fora de `core`), com o motor real:** no shell, digitar, `Backspace`, setas, `Tab`, histórico, `Enter` e `Ctrl+C` num comando ocupado; no `top`, `q` e `Ctrl+C`; no `nano`, escrever, apagar, quebrar a linha, `Ctrl+O` e `Ctrl+X`; no `vim`, `i`, escrever, `Escape`, `:wq` e `Enter`; a colagem no shell e nos editores (CA-07).
- **Frontend, painel (`ExerciseBoard`):** pausar, retomar, "+ minutos" e os limites; abas (abrir, trocar muda o aluno visto, fechar, a quinta recusada, destaque); histórico de comandos; assumir, as teclas e a colagem do professor indo ao aluno (e o `Ctrl+Shift+D` não), devolver; "Ocioso", mão, comandos e "Perto do fim" com a ordem; "Voltar para a aula" com cada aviso e sem aviso; só texto (CA-02, CA-05, CA-06, CA-07, CA-11, CA-14).
- **Regressão:** os testes da SPEC-065 e da sala passam, salvo os do fim da rodada (o aluno não volta mais ao palco no `ended`), ajustados e listados na entrega (CA-15).
- **Manual:** professor e três alunos; iniciar com 2 minutos; pausar e retomar; um aluno levanta a mão; abrir as abas de dois alunos, conversar com um (a mensagem aparece por cima do terminal dele); assumir o terminal do outro, rodar dois comandos, abrir e salvar um arquivo no `nano` e no `vim`, abrir o `top` e sair com `Ctrl+C`, devolver; deixar o tempo acabar e conferir que os terminais travam sem apagar; adicionar 2 minutos e ver a rodada voltar; o aluno assumido conclui e fica com 0 pontos; clicar "Voltar para a aula" e ver o aviso de quem não concluiu; **medir** a latência do takeover e do espelho na rede local (meta abaixo de 100 ms).
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-065 (inteira, com o histórico de desvios), SPEC-056, SPEC-058, SPEC-062, SPEC-063 e esta; **backend:** `internal/modules/classroom/**` (`domain/exercise.go`, `service`, `repository`, `handler/ws.go`), `internal/platform/hub/**`, `migrations/00035_live_exercise.sql`; **frontend:** `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `components/Classroom/ExerciseArea/**`, `ExerciseBoard/**`, `TeacherPanel/**`, `TeacherChat/**`, `StudentChat/**`, `TerminalMirror/**`, `LiveClassroom/**`, `engine/terminalWindow.ts`, `engine/core/terminal/TerminalUbuntu.ts`, `EditorNano.ts` e `EditorVim.ts` (só leitura: como cada um ouve o teclado), `messages/pt-BR.ts`.
2. **Ordem de execução:** testes vermelhos e commit `test` antes do código, em cada frente. **Backend:** migração, domínio, repositório, serviço, hub e handler. **Frontend:** contrato (tipos, serviço, hook), depois a área do aluno e o painel (abas, takeover, avisos). Textos em `pt-BR.ts`; termos novos no glossário (Pausa da rodada, Mais tempo, Voltar para a aula, Aba de atendimento, Assumir o terminal / takeover, Aluno ocioso, Aluno retido, Participante da rodada).
3. **Arquivos a criar ou alterar:** `backend/migrations/00040_live_exercise_guided.sql`; `backend/internal/modules/classroom/**`; `backend/internal/platform/hub/**` (se as regras novas exigirem); `frontend/src/services/classroomService.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/engine/remoteKeys.ts` (novo, o adaptador das teclas remotas, fora de `core`) e o seu teste; `frontend/src/components/Classroom/ExerciseArea/**`, `ExerciseBoard/**`, `TerminalMirror/**` (o foco e a captura do teclado no takeover), `TeacherPanel/**`, `LiveClassroom/**`, e o componente novo das abas de atendimento dentro de `ExerciseBoard/`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md`; esta spec. **Não alterar** `engine/core`.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma pendência. P-01 ("Voltar para a aula" com o cronômetro correndo encerra a rodada) e P-02 (takeover tecla a tecla, como se o professor usasse o próprio terminal, pelo adaptador fora de `engine/core`) foram respondidas pelo Tech Lead em 16/10/2026 e incorporadas às seções 2, 3, 6, 7, 8 e 9.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 16/10/2026 | Aruna Architect | Criação, a partir da Tech Spec trazida pelo Tech Lead e das decisões dele na mesma data (seção "Fontes canônicas"); duas pendências abertas |
| 16/10/2026 | Aruna Architect | P-01: voltar para a aula encerra a rodada. P-02: takeover tecla a tecla (shell, `top`, `nano`, `vim`, `Ctrl+C` e colagem), entregue pelo adaptador `engine/remoteKeys.ts` sem alterar `engine/core`; `live:exercise:input` vira `live:exercise:key`. Seção 10 vazia, pronta para aprovação |
| 16/10/2026 | Tech Lead | Aprovada |
| 20/10/2026 | Implementador | Migração renumerada de `00038_live_exercise_guided.sql` para `00040_live_exercise_guided.sql`: a `00038` já é a `session_diary` (SPEC-073) e a `00039` a `session_materials` (SPEC-074), ambas mescladas antes. Sem mudança de requisito; os dois testes de migração passam a ler o prefixo `00040_` (único teste alterado depois do vermelho, e só por esse motivo) |
| 20/10/2026 | Implementador | Implementada, com CA-01 a CA-16 conferidos contra o código e os testes. Backend: `exercise_guided_test.go`, `service_guided_test.go`, `handler_guided_test.go` e `repository_guided_test.go`. Frontend: `ExerciseBoard.guided.test.tsx`, `ExerciseArea.guided.test.tsx`, `useLiveClassroom.guided.test.ts` e `remoteKeys.test.ts`; a CA-14 (texto puro) em `ExerciseBoard.guided.test.tsx` e `ExerciseArea.guided.test.tsx`. Medido: `go vet` limpo; `gofmt` limpo (2 arquivos só de alinhamento, `domain/classroom.go` e `handler/ws.go`, corrigidos); cobertura Go da `classroom`: domain 94,9%, handler 89,7%, repository 91,9%, service 89,7%; Vitest em hooks, components, services e lib: 210 arquivos, 2.808 testes passando e 1 pulado, linhas 97,4% e ramos 91,1%; `tsc`, ESLint e Stylelint sem erro (1 aviso antigo em `useLiveClassroom.test.ts`). Fora da medição: `engine/conformance/manifest.engine.test.ts` (leva horas por desenho) e `engine/heredoc.test.ts`, que falha desde antes desta spec. Testes alterados depois do vermelho, cada um com o motivo: `handler_guided_test.go` (`gofmt` e, em `TestGuided_Snapshot`, a conexão nova do painel substitui a antiga); `repository_exercise_test.go` (a SPEC-065 exigia ao menos 1 tentativa e esta spec aceita 0 para quem não concluiu, então só as negativas são recusadas); `repository_guided_test.go` (matrículas sequenciais no lugar de `uuid[:7]`, que colidia); `service_exercise_test.go` (3 asserções da SPEC-065 ajustadas à RN-08 e ao fechamento, o "salvo os ajustados" da CA-15); `service_guided_test.go` (`gofmt`); `ExerciseTerminal.test.tsx` (`onChange` ganhou o 3º argumento, os comandos do aluno); `remoteKeys.test.ts` (o teclado remoto espera o fim do comando, o teste de colar várias linhas foi reescrito e entraram 2 testes); `useLiveClassroom.guided.test.ts` (`takeover` virou `takeoverStudent`, que colidia com o estado `takeover`). Desvio: a migração `00040` (registrado acima) |
