# SPEC-091: Sala da Prova ao Vivo (Sala de Espera, Tela do Aluno em Tempo Real, Comandos, Pedido de Ajuda e Encerramento)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-091 |
| **Status** | Aprovada |
| **Data de criação** | 03/11/2026 |
| **Última revisão** | 03/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a sala da prova no hub, os comandos do aluno, o pedido de ajuda, o encerramento e o fim da habilitação; frontend: a janela da sala da prova da docente e o que muda na janela da prova do estudante) |
| **Contexto de tela** | A rota nova `/app/classes/[id]/assessments/[assessmentId]/room` (a sala da prova, janela própria da docente), o detalhe da avaliação (o botão *Iniciar a prova* abre a sala) e a janela da prova do estudante (`.../take`, SPEC-090) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-090 (a tentativa), SPEC-083 e SPEC-089 (o início pela docente), SPEC-076 (a habilitação, que esta spec retira), a aula ao vivo como base de reaproveitamento: SPEC-051 (o hub), SPEC-054 (a sala de espera), SPEC-056 (o espelho do terminal), SPEC-058 e SPEC-062 (a mão levantada com a dúvida), SPEC-063 (os cartões dos alunos), SPEC-064 (as notificações do navegador), SPEC-065 e SPEC-071 (acompanhar o terminal do aluno) e SPEC-073 (os comandos) |
| **Substitui** | Nenhuma por inteiro. Torna obsoleta a **habilitação** da SPEC-076 (RN-03 a RN-13, a tela de habilitações e o motivo `NOT_CLEARED`) e a parte de habilitação da SPEC-083 (RN-04 e a página de habilitações); realiza os itens 2, 3 e 4 da SPEC-076, seção 2.2 |
| **Fontes canônicas** | Pedido do Tech Lead de 03/11/2026: "ao iniciar a prova, deve abrir a tela de aplicação de prova, muito parecida com a tela de aplicar aula: o professor vê os alunos que estão na sala de espera; ao entrar, eles já estão autorizados; o professor pode ver a tela do aluno em tempo real; o aluno pode pedir ajuda; o professor vê em tempo real os comandos que o aluno realizou"; as decisões do Tech Lead de 03/11/2026 (quem entra está autorizado; duas specs em sequência; reaproveitar a aula ao vivo); SPEC-076, seção 2.2; `docs/arquitetura/transicao-backend.md`, seções 6.1, 6.2 (fila de suporte) e 6.4.1 (encerramento não é anulação) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Com a SPEC-090 o estudante faz a prova, mas a docente não vê nada enquanto ela acontece: só a lista de tentativas, que ela precisa atualizar à mão. No laboratório, ela quer o que já tem na aula ao vivo: ver quem chegou, começar a prova para todos de uma vez, olhar a tela de qualquer aluno, saber quem pediu ajuda e acompanhar os comandos que cada um digita. Na prova online isso é ainda mais necessário, porque ela não está ao lado do aluno.

Hoje, além disso, a prova presencial exige que a docente **habilite** cada aluno (SPEC-076 e 083). O Tech Lead decidiu que isso sai: o aluno elegível que está na sala de espera **já está autorizado** e começa quando a docente inicia.

## 2. Objetivos (Goals)

- **Sala da prova:** uma janela própria da docente, aberta pelo detalhe da avaliação, que mostra a prova ao vivo, no padrão do painel da aula ao vivo.
- **Sala de espera:** desde o horário marcado, o estudante que abre a prova fica na sala de espera, e a docente vê quem está nela. **Iniciar a prova** (SPEC-083 e 089), pela sala ou pelo detalhe, faz todos os que esperam entrarem na prova ao mesmo tempo; quem chega depois do início entra direto. Não existe mais aprovar nem recusar aluno.
- **Cartões dos alunos:** um cartão por aluno elegível, com a situação, o progresso, o tempo restante, a conexão e a mão levantada.
- **Tela do aluno em tempo real:** ao abrir o cartão de um aluno, a docente vê a questão em que ele está e o terminal dele ao vivo.
- **Comandos em tempo real:** a docente vê a lista dos comandos que o aluno executou, com a saída resumida, chegando ao vivo e guardada para depois.
- **Pedido de ajuda:** o estudante pede ajuda, com uma dúvida opcional; a docente vê a fila, recebe aviso sonoro e do navegador e marca o pedido como atendido, com uma resposta curta opcional que o aluno lê (D-03).
- **Encerrar a prova de um aluno:** em flagrante de desvio, a docente encerra a tentativa daquele aluno com motivo obrigatório; a nota preliminar é calculada normalmente (encerrar não é anular).

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- O **telão** do laboratório (SPEC-076, seção 2.2, item 1, e o evento `cockpit:projection-sync`).
- **Chat livre** entre a docente e o aluno durante a prova (só existe a resposta ao pedido de ajuda, D-03), mensagens para todos e envio de arquivos.
- **Assumir o terminal** do aluno (SPEC-071) ou digitar por ele, e mexer nas respostas dele.
- **Bloqueio cautelar** (pausa reversível com devolução do tempo) e **anulação** (ato da revisão de notas).
- Telemetria forense (mouse, atalhos proibidos, perda de foco), o player de sessão, a correção e a homologação.
- Aviso de troca de máquina (`session:machine-changed`) e token de sala.
- Mudar a tentativa da SPEC-090 além do que está nesta spec (os comandos, a mão levantada e o encerramento).
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. Os componentes da aula ao vivo são **reaproveitados** onde servem como estão (tela de espera, espelho do terminal, diálogo da mão levantada, cartões dos alunos, notificações); onde precisam mudar, a mudança é feita de modo que a aula ao vivo continue igual, e os testes dela continuam verdes.

**Abrir a sala** (detalhe da avaliação, docente dona e administrador, prova `SCHEDULED`):

- Em fase `RUNNING`: o botão **Abrir a sala da prova**, que abre a sala numa janela própria (como o painel da aula ao vivo, SPEC-055).
- **Iniciar a prova** (SPEC-083 e 089), confirmado no diálogo, inicia a prova e **abre a sala**.
- Em fase `UPCOMING`, `ENDED` ou cancelada: sem o botão.

**A sala da prova** (`/room`):

- **Cabeçalho:** o título, o tempo até o término da avaliação pelo relógio do servidor, os contadores (*na sala de espera*, *fazendo*, *entregues*, *mãos levantadas*) e, antes do início, o botão primário **Iniciar a prova**, com o mesmo diálogo. Depois do início, a frase "Prova iniciada às HH:MM por <nome>.".
- **Cartões dos alunos:** um por aluno elegível, em grade, ordenados pelo nome, com o filtro por situação. Cada cartão mostra o nome, o RA, a situação (*Ausente*, *Na sala de espera*, *Fazendo*, *Entregue*, *Tempo esgotado*, *Encerrada pela docente*), a conexão (um ponto *online* ou *sem conexão* para quem está fazendo e caiu), o progresso ("4 de 9 respondidas · 2 práticas resolvidas"), o tempo restante dele e, com a mão levantada, o destaque e a dúvida.
- **Fila de ajuda:** uma lista lateral com os pedidos abertos, do mais antigo para o mais novo, com o nome, a questão, a dúvida e há quanto tempo, um campo opcional **Resposta ao aluno** (até 300 caracteres) e o botão **Atendido**. Um pedido novo toca o som e mostra a notificação do navegador (SPEC-062 e 064, com o mesmo consentimento).
- **O aluno aberto** (ao clicar no cartão, num painel ao lado): a questão em que ele está, com o enunciado; o **terminal dele ao vivo**, só leitura; e a lista dos **comandos** que ele executou na prova, do mais novo para o mais antigo, com a hora, a questão, o comando e a saída resumida, chegando ao vivo. Em questão não prática, o lugar do terminal diz "O aluno está numa questão sem terminal." O painel tem o botão **Encerrar a prova deste aluno**.
- **Encerrar a prova de um aluno:** um diálogo pede o motivo, obrigatório: "Encerrar a prova de <nome>? A prova dele é entregue agora, com o que já fez. O motivo fica registrado." Confirmado, o cartão passa a *Encerrada pela docente*.
- **Sem conexão com a sala:** um aviso "Reconectando…" e a reconexão automática da aula ao vivo; ao voltar, a sala recebe o estado inteiro de novo.

**A janela da prova do estudante** (SPEC-090), com o que muda:

- **Antes do início pela docente:** em vez de recusar, a janela mostra a **sala de espera**, com a tela de espera animada da aula ao vivo (SPEC-061) e a frase "Você está na sala de espera. A prova começa quando a docente iniciar." e, abaixo, "Durante a prova, a docente pode ver a sua tela e os comandos que você executa." (D-04). Quando a docente inicia, a janela entra na prova sozinha.
- **Pedir ajuda:** um botão **Pedir ajuda** no cabeçalho abre um campo opcional de dúvida, de até 300 caracteres, e envia. Com o pedido aberto, o botão vira **Cancelar o pedido**; atendido, volta ao normal e aparece "A docente viu o seu pedido." e, quando ela escreveu, a resposta dela.
- **Encerrada pela docente:** a janela trava e mostra "Sua prova foi encerrada pela docente." com o motivo.
- **Sem conexão com a sala:** a prova continua: as respostas seguem salvas por REST (SPEC-090), e a janela reconecta sozinha.

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (a sala no hub):** cada prova tem uma sala no hub de tempo real (`backend/internal/platform/hub`, o mesmo da aula ao vivo), com a configuração própria da prova. Conectam-se a docente dona e o administrador (como controladora, na janela `room`) e os estudantes elegíveis (como espectadores). Outros, 403. A sala existe da fase `RUNNING` até o término da avaliação mais a tolerância da SPEC-090; fora disso, a conexão é recusada com `assessment-not-open-yet` ou `assessment-ended`.
- **RN-02 (sala de espera e entrada):** o estudante elegível que se conecta antes do início pela docente entra como **esperando** (o `Waiting` do hub, SPEC-054). Quando a docente inicia a prova, o servidor **admite todos os que esperam** e avisa cada um, e a janela de cada um entra na prova (`POST .../attempt`, SPEC-090). Quem se conecta depois do início é admitido na hora.
- **RN-03 (fim da habilitação):** a habilitação deixa de existir. `AccessOf` não tem mais o motivo `NOT_CLEARED`: depois do início pela docente, todo estudante elegível tem `ALLOWED`. A rota de decisão das habilitações (`POST .../clearances`) e a página de habilitações saem, e a lista de habilitações para de ser oferecida. O campo `requires_clearance` e o formulário dele saem da avaliação; as decisões já gravadas ficam no banco, sem uso (D-02).
- **RN-04 (os cartões):** a sala mantém, para cada aluno elegível, a situação, a conexão, o progresso, o tempo restante e a mão levantada. Ela manda o **estado inteiro** a quem se conecta e as **mudanças** a seguir, só para a docente. O progresso vem da tentativa (as respostas salvas e as práticas conferidas como resolvidas).
- **RN-05 (a tela do aluno):** a docente **escolhe acompanhar** um aluno (um de cada vez por janela da sala). Só então a janela daquele aluno passa a mandar a questão atual e a imagem do terminal, que o servidor repassa só à docente, guardando a última de cada aluno. Ao parar de acompanhar, o envio para. O aluno não é avisado a cada vez; a sala de espera diz que a docente pode ver a tela e os comandos (D-04).
- **RN-06 (os comandos):** cada comando que o estudante executa no terminal da prova (ao apertar Enter) é mandado à sala com a questão, o instante, a linha do comando e até 4.000 caracteres da saída, como na aula ao vivo (SPEC-073). O servidor **guarda** cada comando na tentativa e repassa à docente. A janela do estudante guarda os comandos que não conseguiu mandar e os reenvia ao reconectar, com o instante original de cada um, que o servidor aceita se estiver entre o início da tentativa e o recebimento (D-05). Ao abrir um aluno, a docente recebe os comandos guardados dele e, depois, os novos.
- **RN-07 (pedido de ajuda):** o estudante que está fazendo a prova levanta a mão com uma dúvida opcional de até 300 caracteres (filtrada como na SPEC-058); há no máximo um pedido aberto por aluno. O estudante pode baixar a mão. A docente marca o pedido como **atendido**, com uma resposta opcional de até 300 caracteres (filtrada como a dúvida), o que o fecha e avisa o aluno com a resposta (D-03). A fila vai para a docente a cada mudança. Os pedidos são guardados, com quem pediu, a questão, a dúvida, quando pediu e quando foi atendido ou cancelado.
- **RN-08 (encerrar a prova de um aluno):** a docente dona ou o administrador encerra a tentativa em andamento de um aluno com o motivo obrigatório, de 1 a 500 caracteres. A tentativa passa a `ENDED_BY_TEACHER`, com o instante, quem encerrou e o motivo; a nota preliminar é calculada como na entrega (SPEC-090 RN-08). O aluno recebe o aviso com o motivo, e a janela dele trava. A tentativa encerrada não volta (o encerramento não se desfaz nesta spec). Tentativa já entregue, 409 `attempt-already-submitted`.
- **RN-09 (os limites):** as mensagens da sala têm os limites de tamanho e de frequência da aula ao vivo: a imagem do terminal até 256 KiB, a mais recente de cada aluno; o comando até 8 KiB, dentro do orçamento do remetente; a dúvida até 4 KiB. A sala aceita até 100 estudantes conectados e 200 na espera.
- **RN-10 (o que o estudante recebe):** o estudante recebe só o que é dele: a admissão, o próprio pedido de ajuda e o encerramento. Ele nunca recebe os cartões, a fila, os comandos nem a tela de outro aluno.

## 4. Modelo de Dados (Data Model)

**`assessment_attempts`** (alterada, SPEC-090)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `status` | text | Sim | Ganha o valor `ENDED_BY_TEACHER` | O encerramento pela docente (RN-08) |
| `ended_by` | uuid | Não | FK `users`; preenchido só em `ENDED_BY_TEACHER` | Quem encerrou |
| `end_reason` | text | Não | 1 a 500 caracteres; preenchido só em `ENDED_BY_TEACHER` | O motivo |

**`assessment_attempt_commands`** (nova): os comandos do aluno na prova (RN-06).

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | — |
| `attempt_id` | uuid | Sim | FK `assessment_attempts` | — |
| `position` | integer | Sim | A posição de uma questão da tentativa | A questão em que foi executado |
| `command` | text | Sim | Até 1.000 caracteres | A linha |
| `output` | text | Sim | Até 4.000 caracteres | A saída resumida |
| `executed_at` | timestamptz | Sim | — | O instante do comando: o do cliente no reenvio, se estiver entre o início da tentativa e o recebimento, e o do servidor nos outros casos (D-05) |

Índice por (`attempt_id`, `executed_at`). Só inclusão.

**`assessment_help_requests`** (nova): os pedidos de ajuda (RN-07).

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | — |
| `attempt_id` | uuid | Sim | FK `assessment_attempts` | — |
| `position` | integer | Não | — | A questão em que o aluno estava |
| `question` | text | Não | Até 300 caracteres | A dúvida |
| `status` | text | Sim | `OPEN`, `ANSWERED`, `CANCELED` | — |
| `created_at` | timestamptz | Sim | — | — |
| `closed_at` | timestamptz | Não | Preenchido fora de `OPEN` | — |
| `closed_by` | uuid | Não | FK `users`; preenchido em `ANSWERED` | Quem atendeu |
| `answer` | text | Não | Até 300 caracteres; só em `ANSWERED` | A resposta da docente (D-03) |

Unicidade parcial: um único `OPEN` por `attempt_id`.

**`assessments`** (alterada): `requires_clearance` deixa de ser lido e escrito pela aplicação (RN-03, D-02). A tabela das habilitações fica, sem uso.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/:id/assessments/:assessmentId/room/ws`**: abre a conexão da sala (RN-01). A docente informa a janela (`room`); o estudante, nada. Erros antes da troca de protocolo: 403 `forbidden`, 404 `assessment-not-found`, 409 `assessment-not-open-yet`, `assessment-ended` ou `assessment-canceled`.

**Mensagens da sala** (formato do hub: um tipo e os dados):

| Tipo | Direção | Quem | Dados e regra |
| :--- | :--- | :--- | :--- |
| `room:snapshot` | servidor → cliente | Docente | O estado inteiro: a avaliação, o início, os cartões, a fila de ajuda e o aluno acompanhado (RN-04) |
| `room:snapshot` | servidor → cliente | Estudante | Se espera ou foi admitido, o próprio pedido de ajuda e o encerramento, se houver (RN-10) |
| `room:student` | servidor → docente | — | A mudança de um cartão (RN-04) |
| `room:admitted` | servidor → estudante | — | A prova começou para ele (RN-02) |
| `room:started` | servidor → docente | — | A prova foi iniciada, com quem e quando (RN-02) |
| `room:watch` | docente → servidor | Docente (`room`) | Acompanhar um aluno, ou nenhum (RN-05) |
| `room:watch-on`, `room:watch-off` | servidor → estudante | — | Comece ou pare de mandar a tela (RN-05) |
| `room:screen` | estudante → servidor → docente | — | A questão atual e a imagem do terminal, até 256 KiB, a mais recente (RN-05, RN-09) |
| `room:command` | estudante → servidor → docente | — | A questão, a linha, a saída resumida e, no reenvio, o instante original, até 8 KiB (RN-06, RN-09, D-05) |
| `room:commands` | servidor → docente | — | Os comandos guardados do aluno aberto (RN-06) |
| `help:raise`, `help:lower` | estudante → servidor | — | Levantar a mão com a dúvida opcional, até 4 KiB; baixar (RN-07) |
| `help:answer` | docente → servidor | Docente (`room`) | Marcar um pedido como atendido, com a resposta opcional de até 300 caracteres (RN-07, D-03) |
| `help:queue` | servidor → docente | — | A fila de pedidos abertos (RN-07) |
| `help:state` | servidor → estudante | — | O estado do próprio pedido: aberto, atendido (com a resposta, quando há) ou nenhum (RN-07) |
| `room:ended` | servidor → estudante | — | A prova dele foi encerrada, com o motivo (RN-08) |

**`POST /api/v1/classes/:id/assessments/:assessmentId/attempts/:attemptId/end`**: encerra a prova de um aluno (RN-08). Papéis: docente dona e administrador. Corpo: `reason` (1 a 500 caracteres). Sucesso `200`: a linha da tentativa da lista da docente, com `status`, `endedByName`, `endReason` e a nota preliminar. Erros: 400 `invalid-reason`, 403 `forbidden`, 404 `attempt-not-found`, 409 `attempt-already-submitted`.

**Rotas existentes que mudam:**

| Rota | Mudança |
| :--- | :--- |
| `POST .../start` (SPEC-083) | Ao iniciar, a sala admite quem espera (RN-02) |
| `POST .../attempt` (SPEC-090) | Não recusa mais com `not-cleared` (RN-03) |
| `GET .../my-access` | O `reason` perde o valor `NOT_CLEARED`; `requiresClearance` e `clearance` saem da resposta (RN-03) |
| `GET` e `POST .../clearances` | Saem (RN-03) |
| `POST` e `PUT .../assessments` | `requiresClearance` deixa de ser aceito; enviado, é ignorado (RN-03) |
| `GET .../attempts` (SPEC-090) | A linha ganha `endedByName` e `endReason` no encerramento |

## 6. Impacto e Riscos (Impact & Risks)

- **Muito tráfego com a turma inteira.** **Mitigação:** a tela só vai quando a docente acompanha aquele aluno, e só a mais recente (RN-05, RN-09); o comando já tem orçamento por remetente na aula ao vivo.
- **A docente perde a conexão no meio da prova.** **Mitigação:** a prova do aluno não depende da sala: as respostas seguem por REST; a sala reconecta e manda o estado inteiro.
- **O aluno perde a conexão com a sala.** **Mitigação:** a prova continua (SPEC-090); os comandos digitados sem a sala são guardados e reenviados ao reconectar (D-05).
- **O aluno não sabe que é acompanhado.** Questão de transparência com o estudante. **Mitigação:** o aviso da sala de espera (D-04).
- **Fim da habilitação.** Mexe nas SPEC-076 e 083: o formulário, o detalhe, a lista, a página de habilitações, o aviso do estudante, `AccessOf` e as rotas. **Mitigação:** as partes viram obsoletas no histórico das duas specs; os testes delas que mudam são ajustados com o motivo registrado; as decisões já gravadas ficam no banco (D-02).
- **Reaproveitar componentes da aula ao vivo** pode quebrar a aula. **Mitigação:** a regra da seção 3.1: a aula continua igual e os testes dela ficam verdes.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre imediatamente antes de criar.
- **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador conecta à sala de uma prova em fase `RUNNING`, O servidor DEVE aceitar e mandar o estado inteiro; QUANDO um estudante elegível conecta, DEVE aceitar só com o que é dele; outro usuário recebe 403, e fora da fase a conexão é recusada com o motivo (RN-01, RN-10).
- [ ] **CA-02** (estado): ENQUANTO a docente não iniciou a prova, O estudante conectado DEVE ficar na sala de espera e aparecer à docente como *Na sala de espera*; QUANDO a docente inicia, O servidor DEVE admitir todos os que esperam e mandar `room:admitted` a cada um; QUANDO um estudante conecta depois do início, DEVE ser admitido na hora (RN-02).
- [ ] **CA-03** (ubíquo): `AccessOf` NÃO DEVE responder `NOT_CLEARED`; depois do início, todo estudante elegível DEVE ter `ALLOWED`; as rotas de habilitação NÃO DEVEM existir, e `requiresClearance` NÃO DEVE ser aceito nem devolvido (RN-03).
- [ ] **CA-04** (evento): QUANDO a situação, a conexão, o progresso ou a mão de um aluno muda, A docente DEVE receber a mudança do cartão (RN-04).
- [ ] **CA-05** (evento): QUANDO a docente acompanha um aluno, O servidor DEVE pedir a tela àquele aluno e repassar só à docente a mais recente; QUANDO ela para ou troca de aluno, DEVE mandar parar ao anterior (RN-05).
- [ ] **CA-06** (evento): QUANDO o estudante executa um comando, O servidor DEVE guardá-lo na tentativa e repassá-lo à docente; QUANDO a docente abre o aluno, DEVE receber os comandos guardados; QUANDO a janela reconecta, DEVE reenviar os comandos não mandados e o servidor DEVE guardá-los com o instante original válido (RN-06, D-05).
- [ ] **CA-07** (evento): QUANDO o estudante levanta a mão, O servidor DEVE abrir o pedido (um por aluno), guardar e mandar a fila à docente; QUANDO ele baixa, DEVE cancelar; QUANDO a docente marca como atendido, com ou sem resposta, DEVE fechar, guardar a resposta e avisar o aluno com `help:state` trazendo a resposta (RN-07, D-03).
- [ ] **CA-08** (evento): QUANDO a docente encerra a prova de um aluno com motivo, O servidor DEVE passar a tentativa a `ENDED_BY_TEACHER` com quem, quando e o motivo, calcular a nota preliminar e mandar `room:ended` ao aluno; SE o motivo falta ou passa de 500 caracteres, ENTÃO 400 `invalid-reason`; SE a tentativa já foi entregue, ENTÃO 409 (RN-08).
- [ ] **CA-09** (ubíquo): O estudante NÃO DEVE receber os cartões, a fila, os comandos nem a tela de outro aluno (RN-10).
- [ ] **CA-10** (evento): QUANDO a docente confirma *Iniciar a prova* no detalhe, A sala DEVE abrir numa janela própria; ENQUANTO a prova está em fase `RUNNING`, O detalhe DEVE oferecer *Abrir a sala da prova*.
- [ ] **CA-11** (estado): ENQUANTO a sala está aberta, Ela DEVE mostrar o cabeçalho com os contadores, os cartões com a situação, a conexão, o progresso, o tempo e a mão, e a fila de ajuda com o som e a notificação do navegador.
- [ ] **CA-12** (evento): QUANDO a docente abre um aluno, A sala DEVE mostrar a questão atual, o terminal ao vivo só leitura e a lista dos comandos chegando ao vivo, ou o aviso de questão sem terminal.
- [ ] **CA-13** (evento): QUANDO a docente encerra a prova de um aluno, A sala DEVE pedir o motivo no diálogo e, confirmada, mostrar o cartão como *Encerrada pela docente*.
- [ ] **CA-14** (estado): ENQUANTO a docente não iniciou a prova, A janela da prova do estudante DEVE mostrar a sala de espera, com o aviso de que a docente pode ver a tela e os comandos, e, QUANDO ela inicia, DEVE entrar na prova sozinha; o *Pedir ajuda* DEVE abrir, cancelar e mostrar o atendimento com a resposta, quando há; QUANDO a prova dele é encerrada, DEVE travar com o motivo.
- [ ] **CA-15** (ubíquo): A aula ao vivo DEVE continuar como está, com os testes dela verdes, depois do reaproveitamento dos componentes.
- [ ] **CA-16** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, e a sala, os diálogos e a janela do estudante DEVEM ter navegação por teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Service: a admissão no início e depois dele (CA-02); `AccessOf` sem `NOT_CLEARED` (CA-03); os cartões e o progresso (CA-04); guardar e listar os comandos (CA-06); o pedido de ajuda, um por aluno, cancelar e atender (CA-07); o encerramento, o motivo e a nota preliminar (CA-08)
- Handler da sala (o hub de verdade com `httptest` e conexões WebSocket de teste): quem conecta e quem não, a espera e a admissão, o acompanhamento e o repasse só à docente, os comandos, a fila e o que o estudante nunca recebe (CA-01, CA-02, CA-04 a CA-07, CA-09)
- Handler REST: o encerramento, as rotas de habilitação ausentes e `my-access` sem os campos da habilitação (CA-03, CA-08)
- Repository (PostgreSQL real, `testcontainers-go`): os comandos, os pedidos com a unicidade do aberto, o encerramento e a migração para cima e para baixo (CA-06 a CA-08)

**Frontend** (Vitest e Testing Library)

- A sala (`room/page.test.tsx`): o cabeçalho, os cartões a partir do estado e das mudanças, a fila com o som e a resposta ao atender, o aluno aberto com o terminal e os comandos, e o encerramento (CA-11 a CA-13)
- O detalhe: *Iniciar a prova* abre a sala e o *Abrir a sala da prova* (CA-10)
- A janela da prova do estudante: a sala de espera, a entrada sozinha, o *Pedir ajuda* e o encerramento (CA-14)
- Os testes da aula ao vivo, todos verdes (CA-15); o formulário, o detalhe, a lista e o aviso do estudante sem a habilitação (CA-03)
- Stylelint, ESLint e `tsc` limpos (CA-16)

**Manual** (roteiro)

1. Criar uma prova presencial e outra online para daqui a alguns minutos; no horário, abrir a sala como docente.
2. Com dois estudantes em janelas anônimas, abrir a prova: os dois aparecem na sala de espera.
3. Iniciar pela sala: os dois entram na prova sozinhos; um terceiro que chega depois entra direto.
4. Abrir um aluno, ver o terminal ao vivo e os comandos chegando enquanto ele digita.
5. Pedir ajuda com uma dúvida; conferir o som, a notificação, a fila e o *Atendido* aparecendo para o aluno.
6. Encerrar a prova de um aluno com motivo e conferir a janela dele travada e a nota preliminar na lista.
7. Conferir que a aula ao vivo continua funcionando como antes.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec, a SPEC-090, as SPEC-076 e 083 (o que sai), e as specs da aula ao vivo da linha "Depende de". Do código: `backend/internal/platform/hub/`, `backend/internal/modules/classroom/handler/ws.go` (a configuração e o tratamento das mensagens, como modelo), `backend/internal/modules/assessment/` e, no frontend, `frontend/src/components/Classroom/` (`WaitingScreen`, `TerminalMirror`, `HandDialog`, `OnlineStudents`, `ExerciseBoard`, `notices`).
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados; (b) a migração, o fim da habilitação, a sala no hub, os comandos, a ajuda e o encerramento; (c) testes do frontend, vermelhos e commitados; (d) a sala, o detalhe, a janela do estudante e a retirada da habilitação das telas; (e) roteiro manual; (f) status e histórico, inclusive nas SPEC-076 e 083.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** a migração do próximo número livre; em `backend/internal/modules/assessment/`: `handler/room.go` (a configuração e as mensagens da sala), `service/room.go`, `service/help.go`, `service/end.go`, `repository/room.go`, cada um com o teste ao lado.
   - **Backend, alterados:** `domain/` (os status, o pedido de ajuda e os erros), `service/read.go` (`AccessOf`), `service/clearance.go` e `handler/clearance.go` (saem), `service/start.go` (avisar a sala), `handler/handler.go` (as rotas) e `backend/cmd/api/` (a ligação do hub da prova).
   - **Frontend, novos:** `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/room/` (a página, o estilo e o teste) e os componentes da sala em `frontend/src/components/AssessmentRoom/`.
   - **Frontend, alterados:** a janela da prova (`.../take`), o detalhe e o teste, `AssessmentForm`, `AssessmentList`, `ClassAssessments`, `AssessmentAccessNotice`, a página `.../clearances` (sai), `frontend/src/services/assessmentService.ts`, `frontend/src/messages/pt-BR.ts` e, só se for preciso para reaproveitar, componentes de `frontend/src/components/Classroom/`.
   - **Documentação:** esta spec, o histórico das SPEC-076 e 083 e `specs/GLOSSARY.md` (a sala da prova, o pedido de ajuda e o encerramento).
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 03/11/2026, ao aprovar a spec, as cinco pendências com as recomendações como estavam. As decisões estão incorporadas às seções 2 a 7; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **A sala abre ao estudante a partir do horário marcado** (fase `RUNNING`, RN-01). |
| D-02 | **As habilitações gravadas e `requires_clearance` ficam no banco, sem uso** (RN-03). |
| D-03 | **A docente pode responder o pedido de ajuda por escrito**, até 300 caracteres, ao marcar como atendido; o aluno lê a resposta. O chat livre continua fora (RN-07). |
| D-04 | **O aviso de que a tela pode ser vista** fica na sala de espera, uma vez (seção 3.1). |
| D-05 | **Os comandos sem conexão são reenviados ao reconectar**, com o instante original (RN-06). |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 03/11/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 03/11/2026 da tela de aplicação da prova parecida com a aula ao vivo. Decisões do Tech Lead já incorporadas: quem entra na sala de espera está autorizado (a habilitação sai); duas specs em sequência (a SPEC-090 vem antes); o tempo real reaproveita o hub e as peças da aula ao vivo. Ficaram fora, sem resposta explícita: telão, telemetria forense e player, correção e homologação, e chat (P-03 trata só da resposta ao pedido de ajuda). Cinco pendências abertas (P-01 a P-05), todas com recomendação |
| 03/11/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das cinco pendências aceitas como estavam: D-01 a D-05. Status: `Aprovada` |
| 03/11/2026 | Aruna Architect | Seção 10 esvaziada: as pendências viraram as decisões D-01 a D-05, incorporadas ao texto (a resposta ao pedido de ajuda, o aviso da sala de espera e o reenvio dos comandos) |
