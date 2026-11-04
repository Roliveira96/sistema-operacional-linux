# SPEC-093: Chat da Sala da Prova (Conversa entre o Estudante e a Docente, Guardada na Tentativa)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-093 |
| **Status** | Aprovada |
| **Data de criação** | 04/11/2026 |
| **Última revisão** | 04/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: as mensagens na sala da prova e a conversa guardada na tentativa; frontend: a aba *Chat* no painel da sala, a conversa na janela da prova e a conversa na seção *Tentativas*) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/room` (a sala da prova), `/app/classes/[id]/assessments/[assessmentId]/take` (a janela da prova) e o detalhe da avaliação (a seção *Tentativas*) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-063 (o chat da aula, o modelo reaproveitado), SPEC-090 (a tentativa), SPEC-091 (a sala da prova e o pedido de ajuda), SPEC-092 revisão 3 (as abas do painel do aluno) |
| **Substitui** | Nenhuma. Revoga a parte da SPEC-091 D-03 que deixava o chat livre fora. |
| **Fontes canônicas** | Pedido do Tech Lead em 04/11/2026, no roteiro manual da aplicação da prova: "entre o aluno e o professor pode ter um chat, para que o professor ajude, estilo aula" e "tem que persistir o chat do aluno na prova dele, pois pode ser usado como método de avaliação". |

---

## 1. Contexto e Problema (Context & Problem Statement)

Durante a prova, o estudante só fala com a docente pelo **pedido de ajuda** (SPEC-091 RN-07): ele levanta a mão com uma dúvida de até 300 caracteres e a docente fecha o pedido com uma resposta, também de até 300. Não dá para conversar: perguntar de novo, pedir um detalhe, a docente puxar o assunto. A SPEC-091 (D-03) deixou o chat livre de fora de propósito.

Na aula ao vivo isso já existe (SPEC-063): o aluno escreve só à docente, e ela responde em particular ou para todos. A docente quer o mesmo na prova, para ajudar como numa aula.

Há uma diferença: na prova, a conversa **conta para a avaliação**. A docente pode querer ver, na correção, que o aluno pediu uma dica, ou que ela mesma deu uma. A conversa precisa ficar **guardada na tentativa** de cada aluno, sem poder ser apagada nem editada, e aparecer depois da prova.

## 2. Objetivos (Goals)

- Na sala da prova, a docente conversa com cada aluno que está fazendo a prova, numa aba **Chat** do painel do aluno, e pode mandar uma **mensagem para todos** (por exemplo, "a questão 3 tem um erro de digitação").
- Na janela da prova, o estudante abre a conversa, escreve à docente e lê as respostas dela e as mensagens para todos. Ele nunca escreve a outro aluno nem para todos.
- Toda mensagem fica **guardada** com a tentativa do aluno, com a hora e a questão em que ele estava. Nada é editado nem apagado.
- Depois da prova, a docente lê a conversa de cada aluno na seção *Tentativas*, ao lado da nota preliminar.

### 2.1. Fora de escopo (Non-Goals)

- Conversa de aluno com aluno, e o aluno escrever para todos.
- Anexos, imagens, links clicáveis, formatação, emojis especiais e mensagens de voz. Só texto puro.
- Editar ou apagar mensagem, de qualquer lado.
- Nota ou desconto automáticos pela conversa. A docente só **lê**; corrigir e homologar continuam no rascunho `revisao-avaliacoes-telemetria-mcp`.
- O estudante ler a própria conversa depois de entregar.
- Juntar o pedido de ajuda e o chat: os dois continuam separados (D-02).
- Mudar o chat da aula ao vivo (SPEC-063) ou o `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação por teclado, contraste AA e alvos de 44 px. Onde servem como estão, os componentes da conversa da aula ao vivo (SPEC-063) são reaproveitados, sem mudar a aula.

**A sala da prova, visão da docente** (`/room`):

- O painel do aluno aberto (SPEC-092 revisão 3) ganha a terceira aba: **Aluno · Pedidos de ajuda · Chat (N)**, onde N conta as mensagens novas de todos os alunos.
- A aba **Chat** mostra a conversa do aluno aberto: as mensagens dele e da docente, e as para todos, em ordem de hora. Cada uma traz quem falou ("Você" ou o nome), a hora e a questão em que o aluno estava ("Questão 4"). A mensagem para todos leva a etiqueta "Para todos".
- O campo de texto (até 500 caracteres, contador, Enter envia, Shift+Enter quebra a linha) tem dois botões: **Enviar só para <nome>** (o principal, que o Enter aciona) e **Enviar para todos**. Sem aluno aberto, a aba mostra o canal **Para todos os alunos**, só com o botão *Enviar para todos*.
- Os cartões dos alunos (SPEC-091) mostram o número de mensagens novas de cada um. Abrir a conversa de um aluno zera o número dele.
- Uma mensagem nova de aluno toca o som e mostra a notificação do navegador, como o pedido de ajuda (SPEC-062 e 064, com o mesmo consentimento).

**A janela da prova, visão do estudante** (`/take`):

- O cabeçalho ganha o botão **Conversa** (`aria-expanded`), com o número de mensagens novas da docente quando fechada ("Conversa, 2 novas").
- Ele abre uma coluna lateral, por cima do terminal, com as mensagens em ordem de hora: "Docente · para todos", "Docente · só para você" e "Você". Abaixo, o campo de texto (até 500 caracteres, contador, Enter envia, Shift+Enter quebra a linha) e o botão **Enviar**, desativado sem conexão. Vazia: "Escreva para a docente. As mensagens dela para a turma também aparecem aqui."
- Abaixo do campo, uma linha fixa: "A conversa fica guardada com a sua prova, e a docente pode usá-la na avaliação." (D-04).
- Na sala de espera, na prova entregue, encerrada ou com o tempo esgotado, a conversa fica só leitura até a janela travar.

**O detalhe da avaliação, visão da docente e do administrador** (seção *Tentativas*, SPEC-090):

- Cada linha ganha o botão **Conversa (N)**, onde N é o número de mensagens daquela tentativa. Sem mensagens, o botão não aparece.
- O botão abre um diálogo só leitura, com a conversa inteira do aluno em ordem de hora, com a data e a hora, a questão e quem falou, inclusive as mensagens para todos que ele recebeu.

**Texto puro.** As mensagens são desenhadas como texto, nunca como HTML, e preservam as quebras de linha.

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (quem fala):** na sala da prova (SPEC-091 RN-01), o estudante **admitido com a tentativa em andamento** escreve só à docente, na conversa dele. A docente dona e o administrador, pela janela `room`, escrevem a um aluno elegível que tem tentativa, ou **para todos**. Na sala de espera, depois da entrega ou do encerramento, e qualquer outro papel: a mensagem é recusada sem enviar nada.
- **RN-02 (o texto):** aparado, de 1 a 500 caracteres (contados por caractere), sem caracteres de controle além da quebra de linha, com no máximo 3 quebras seguidas. Texto puro, guardado como veio, filtrado como no chat da aula (SPEC-063). Fora disso, recusado.
- **RN-03 (guardado antes de enviar):** toda mensagem é **guardada antes** de sair, com o instante e o id dados pelo servidor. A do estudante e a particular da docente ficam ligadas à **tentativa** do aluno. A mensagem para todos fica ligada à **avaliação** e ao conjunto dos alunos que a receberam (D-01). Cada mensagem guarda também a **questão** em que o aluno estava (a última que a janela dele contou à sala, SPEC-092 revisão 2), nula na mensagem para todos.
- **RN-04 (nada se apaga):** nenhuma rota nem mensagem edita ou apaga uma mensagem. Elas ficam enquanto a tentativa existir, como as respostas e os comandos (SPEC-090 e 091).
- **RN-05 (quem recebe):** a mensagem do estudante vai às conexões da docente e às do próprio estudante (a confirmação, inclusive em outra aba). A particular da docente vai às conexões da docente e às do aluno. A mensagem para todos vai às conexões da docente e a todos os alunos admitidos com a tentativa em andamento. Nunca a outro aluno.
- **RN-06 (o instantâneo):** quem se conecta recebe a conversa no estado inteiro da sala (SPEC-091 RN-04 e RN-10): o estudante, a conversa dele e as mensagens para todos que recebeu; a docente, as últimas 500 mensagens da prova. As mais antigas, a docente lê na seção *Tentativas*.
- **RN-07 (a leitura depois):** a docente dona e o administrador leem a conversa inteira de uma tentativa, em qualquer status, por uma rota REST: as mensagens dela e as para todos que o aluno recebeu, em ordem de hora. A lista das tentativas (SPEC-090 RN-09) ganha o número de mensagens de cada uma. O estudante não lê por essa rota (D-03).
- **RN-08 (os limites):** a mensagem tem até 4 KiB no quadro e conta no limite de frequência do remetente, como as outras da sala (SPEC-091 RN-09).

## 4. Modelo de Dados (Data Model)

**`assessment_chat_messages`** (nova): as mensagens da sala da prova (RN-03).

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | — |
| `assessment_id` | uuid | Sim | FK `assessments` | A prova |
| `attempt_id` | uuid | Não | FK `assessment_attempts`; nulo só na mensagem para todos | A tentativa da conversa |
| `sender_id` | uuid | Sim | FK `users` | Quem escreveu |
| `sender_role` | text | Sim | `TEACHER` ou `STUDENT` | — |
| `position` | integer | Não | A posição de uma questão da tentativa; nula na mensagem para todos | A questão em que o aluno estava |
| `body` | text | Sim | 1 a 500 caracteres, por `CHECK` | O texto |
| `created_at` | timestamptz | Sim | — | O instante do servidor |

`CHECK`: a mensagem de `STUDENT` tem `attempt_id`. Índices por (`attempt_id`, `created_at`) e por (`assessment_id`, `created_at`). Só inclusão, sem `updated_at` nem `deleted_at`.

**`assessment_chat_recipients`** (nova): quem recebeu cada mensagem para todos (D-01).

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `message_id` | uuid | Sim | FK `assessment_chat_messages` | Uma mensagem para todos |
| `attempt_id` | uuid | Sim | FK `assessment_attempts` | Uma tentativa em andamento no instante do envio |

PK (`message_id`, `attempt_id`). Índice por `attempt_id`. Só inclusão.

As duas tabelas entram numa migração nova, depois da `00049`, que sobe e desce sem erro.

## 5. Contrato de API (API Contract)

**Mensagens da sala** (o WebSocket da SPEC-091, formato do hub):

| Tipo | Direção | Quem | Dados e regra |
| :--- | :--- | :--- | :--- |
| `chat:send` | estudante → servidor | Estudante admitido, tentativa em andamento | `text`. Qualquer outro campo é recusado (RN-01, RN-02) |
| `chat:send` | docente → servidor | Docente (`room`) | `text` e, exatamente um dos dois, `studentId` (em particular) ou `to` igual a `all` (para todos) (RN-01, RN-02) |
| `chat:message` | servidor → clientes | Pela RN-05 | `id`, `scope` (`private` ou `all`), `studentId` (o dono da conversa, só em `private`), `from` (`TEACHER` ou `STUDENT`), `position` (quando há), `text` e `createdAt` (RN-03, RN-05) |
| `room:snapshot` | servidor → cliente | Docente e estudante | Ganha `chat`: a lista da RN-06, do mais antigo ao mais novo |

**`GET /api/v1/classes/:id/assessments/:assessmentId/attempts/:attemptId/chat`**: a conversa inteira de uma tentativa (RN-07).

- **Papéis autorizados:** docente dona da turma e administrador.
- **Resposta `200`:** `messages`, a lista em ordem de hora, cada uma com `id`, `scope`, `from`, `senderName`, `position` (quando há), `text` e `createdAt`.
- **Erros:** 403 `forbidden` (estudante ou outra docente), 404 `assessment-not-found` ou `attempt-not-found`.

**Rota existente que muda:** a lista das tentativas da docente (SPEC-090, `GET .../attempts`) ganha `chatCount` em cada linha.

## 6. Impacto e Riscos (Impact & Risks)

- **Cola pelo chat da prova.** Um aluno poderia usar o chat para falar com outro. **Mitigação:** o estudante só escreve à docente (RN-01) e só recebe o que é dele e o que a docente mandou para todos (RN-05); o servidor confere o papel em cada mensagem.
- **A conversa como prova de avaliação.** Se uma mensagem pudesse sumir ou mudar, a docente perderia o registro. **Mitigação:** a mensagem é guardada antes de sair (RN-03), as tabelas são só de inclusão e não há rota de edição (RN-04).
- **Distração na prova.** Notificações a cada mensagem atrapalham. **Mitigação:** do lado do estudante, só o número no botão *Conversa*, sem som; do lado da docente, o som e a notificação seguem o consentimento da SPEC-064.
- **Volume.** 40 alunos com 50 mensagens cada dão 2.000 linhas por prova, pequenas. **Mitigação:** o limite de 500 caracteres, o de frequência do hub e o instantâneo limitado a 500 (RN-06, RN-08).
- **Os componentes da aula ao vivo.** Reaproveitá-los pode mudar a aula. **Mitigação:** só o que serve como está é reaproveitado; os testes do chat da aula (SPEC-063) continuam verdes.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o estudante admitido com a tentativa em andamento manda uma mensagem válida, O servidor DEVE guardá-la ligada à tentativa, com a questão em que ele estava, e entregá-la só à docente e ao próprio estudante (RN-01, RN-03, RN-05).
- [ ] **CA-02** (evento): QUANDO a docente manda uma mensagem a um aluno, O servidor DEVE guardá-la ligada à tentativa dele e entregá-la só a ele e à docente; QUANDO manda para todos, DEVE guardá-la com os destinatários e entregá-la a todos os alunos com a tentativa em andamento (RN-01, RN-03, RN-05, D-01).
- [ ] **CA-03** (indesejado): SE quem manda está na sala de espera, já entregou, foi encerrado, não tem o papel, manda um campo a mais ou um texto fora da RN-02, ENTÃO O servidor DEVE recusar a mensagem sem guardar nem enviar nada (RN-01, RN-02).
- [ ] **CA-04** (ubíquo): O sistema NÃO DEVE ter rota nem mensagem que edite ou apague uma mensagem da conversa (RN-04).
- [ ] **CA-05** (evento): QUANDO alguém se conecta à sala, O instantâneo DEVE trazer a conversa da RN-06: o estudante, só a dele e as para todos que recebeu; a docente, as últimas 500 (RN-06).
- [ ] **CA-06** (evento): QUANDO a docente dona ou o administrador lê a conversa de uma tentativa, O servidor DEVE devolver as mensagens dela e as para todos que o aluno recebeu, em ordem de hora, e a lista das tentativas DEVE trazer `chatCount`; estudante ou outra docente recebe 403 (RN-07).
- [ ] **CA-07** (estado): ENQUANTO a docente está na sala da prova, O painel DEVE ter a aba *Chat* com a conversa do aluno aberto, os botões *Enviar só para <nome>* e *Enviar para todos*, o canal *Para todos os alunos* sem aluno aberto, e os números de mensagens novas na aba e nos cartões.
- [ ] **CA-08** (estado): ENQUANTO o estudante faz a prova, A janela DEVE ter o botão *Conversa* com o número de mensagens novas, a coluna com as mensagens e o campo de envio, e a frase de que a conversa fica guardada; fora da prova em andamento, a conversa DEVE ficar só leitura.
- [ ] **CA-09** (evento): QUANDO a docente clica em *Conversa (N)* na seção *Tentativas*, A tela DEVE mostrar a conversa inteira daquela tentativa, só leitura, com a data, a hora, a questão e quem falou.
- [ ] **CA-10** (ubíquo): As mensagens DEVEM ser desenhadas como texto puro, com as quebras de linha; os textos novos DEVEM estar em `messages/pt-BR.ts`, com navegação por teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

Os testes são escritos antes do código e rodados vermelhos primeiro.

- **Backend:**
  - `domain`: `TestNormalizeChatText_TrimsLimitsAndRefusesControlCharacters` (CA-03).
  - `service`: `TestSendChat_StudentGoesToTheAttemptWithThePosition` (CA-01), `TestSendChat_TeacherPrivateAndToAllWithRecipients` (CA-02), `TestSendChat_RefusesWaitingDeliveredEndedAndOtherRoles` (CA-03), `TestAttemptChat_GivesTheConversationAndTheMessagesToAllReceived` (CA-06), `TestAttemptChat_ForbiddenToStudentsAndOtherTeachers` (CA-06).
  - `repository`: `TestMigration00050_UpAndDown` e `TestChatMessages_InsertOnlyAndOrderedByTime` (CA-04).
  - `handler`: `TestRoomChat_DeliversOnlyToTheTeacherAndTheStudent` (CA-01, CA-02), `TestRoomChat_SnapshotByRole` (CA-05), `TestAttemptChatRoute` (CA-06), `TestAttemptList_HasChatCount` (CA-06), e a busca de que não há rota de edição ou exclusão do chat (CA-04).
- **Frontend:**
  - `ExamRoom.test.tsx`: a aba *Chat*, enviar só para o aluno e para todos, o canal *Para todos os alunos* e os números de novas (CA-07).
  - `ExamRunner` ou o componente da conversa do estudante: o botão *Conversa* com as novas, enviar, a frase da conversa guardada e o só leitura fora da prova (CA-08).
  - `AssessmentAttempts.test.tsx`: o botão *Conversa (N)* e o diálogo só leitura (CA-09).
  - O texto puro com quebras de linha e as mensagens em `pt-BR.ts` (CA-10).
  - Os testes do chat da aula ao vivo (SPEC-063) continuam verdes.
- **Manual:**
  1. Docente e dois alunos em navegadores diferentes, prova em andamento.
  2. O aluno 1 escreve. Só a docente lê, e o aluno 2 não recebe nada.
  3. A docente responde só ao aluno 1 e depois manda uma para todos. O aluno 2 recebe só a para todos.
  4. O aluno 1 recarrega a página: a conversa volta.
  5. O aluno 1 entrega. Na seção *Tentativas*, *Conversa (3)* mostra as três mensagens com a questão e a hora.
- **Cobertura:** acima de 80% no escopo, com `go test -cover` e o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Leitura obrigatória:** esta spec, as SPEC-063, 090, 091 e 092, `specs/ARCHITECTURE.md` e `specs/GLOSSARY.md`.
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados; (b) a migração, o domínio, o repository, o service e o handler; (c) testes do frontend, vermelhos e commitados; (d) a aba *Chat* da sala, a conversa da janela da prova, o diálogo das *Tentativas* e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Restrições:**
   - **Branch:** `fix/aplicacao-da-prova`, a branch geral da aplicação da prova pedida pelo Tech Lead.
   - **Documentação:** esta spec e `specs/GLOSSARY.md` (o termo *Conversa da prova*).
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito e o status atualizado para `Implementada`.

## 10. Decisões (antes: pendências para aprovação)

| ID | Pendência e recomendação |
| :--- | :--- |
| D-01 | **A mensagem para todos na conversa de cada aluno.** Recomendado: ela é guardada uma vez, com a lista de quem a recebeu, e aparece na conversa de cada um desses alunos, inclusive na seção *Tentativas*. Assim a docente sabe exatamente o que cada aluno leu. |
| D-02 | **O pedido de ajuda continua.** Recomendado: o pedido de ajuda da SPEC-091 fica como está (a mão levantada e a fila), e o chat é um canal à parte. Juntar os dois fica para depois, se o uso mostrar que é preciso. |
| D-03 | **O estudante não lê a conversa depois da entrega.** Recomendado: só a docente e o administrador leem depois. O estudante veria a conversa no resultado da prova, que ainda não existe (correção e homologação). |
| D-04 | **O aviso ao estudante.** Recomendado: a frase fixa "A conversa fica guardada com a sua prova, e a docente pode usá-la na avaliação." abaixo do campo, para o aluno saber desde o começo que a conversa conta. |
| D-05 | **Glossário.** Recomendado: o termo novo **Conversa da prova** (`assessment_chat_messages`): a troca de mensagens entre o estudante e a docente durante a prova, guardada na tentativa; e a nota de que a SPEC-091 D-03 deixa de valer na parte do chat. |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 04/11/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead no roteiro manual da aplicação da prova: o chat entre o estudante e a docente, estilo aula (SPEC-063), com a conversa guardada na tentativa para servir à avaliação. Cinco pendências, D-01 a D-05, com as recomendações. |
| 04/11/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das cinco pendências aceitas como estavam: D-01 a D-05. Status: `Aprovada` |
