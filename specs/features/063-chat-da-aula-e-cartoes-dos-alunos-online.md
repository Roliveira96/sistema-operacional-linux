# SPEC-063: Chat da Aula e Cartões dos Alunos Online

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-063 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend, com migração); `frontend/src/components/Classroom/`, `hooks/useLiveClassroom.ts`, `services/classroomService.ts` |
| **Contexto de tela** | Painel do professor e sala do aluno |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051 (sala síncrona), SPEC-054 (sala de espera e alunos aceitos), SPEC-055 (painel), SPEC-057 (palco e faixa), SPEC-058 (mão e dúvida), SPEC-062 (modal da dúvida) |
| **Substitui** | Parcialmente a SPEC-057: a tela cheia do botão ou da tecla F do aluno passa a levar a sala inteira (a faixa, o chat e as anotações ficam), e não só o palco |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: uma listagem de cards com os alunos que estão online para o professor poder ajudar; uma espécie de chat da aula em que o professor fala com um aluno ou com todos; exemplo: um aluno levantou a mão, o professor lê a dúvida e responde no privado ou no público para todos os alunos da aula |

---

## 1. Contexto e Problema (Context & Problem Statement)

O professor vê só uma lista de mãos levantadas e a dúvida escrita (SPEC-058). Ele **não tem como responder** dentro da plataforma: responde de viva voz para a turma toda ou perde a dúvida. Também não vê **quem está online** para ajudar, e não consegue falar com um aluno em particular sem interromper a aula. O aluno, por sua vez, só consegue sinalizar com a mão.

## 2. Objetivos (Goals)

- O painel do professor mostra uma **listagem de cards** com os alunos aceitos que estão **online**, com a mão e a dúvida de cada um à vista.
- Um **chat da aula**: o aluno escreve ao professor; o professor responde **em particular** a um aluno ou **para todos** os alunos da aula.
- As mensagens ficam guardadas na aula: quem recarrega ou reconecta recupera a conversa.

### 2.1. Fora de escopo (Non-Goals)

- Conversa de aluno com aluno, e o aluno escrever para todos.
- Editar ou apagar mensagem, anexos, imagens, links clicáveis, formatação, reações, "digitando…", confirmação de leitura.
- Som de aviso para mensagem nova (só o contador nos cards e na faixa).
- Silenciar um aluno ou desligar o chat (o professor ainda pode remover o aluno da aula, SPEC-054).
- Guardar quais mensagens já foram lidas: o "não lido" é da tela aberta; ao recarregar, tudo conta como lido.
- Paginação do histórico e endpoint REST do histórico (o histórico vem no instantâneo).
- Chat na janela de apresentação (é a tela da turma) e para quem ainda está na sala de espera.
- Citar a dúvida do aluno dentro de uma mensagem pública (a dúvida continua sendo só do professor, SPEC-058 CA-06).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Contrato do protocolo (congelado para backend e frontend)

**Cliente → servidor: `live:chat:send`** (tamanho máximo do quadro 4 KiB; conta no limite de taxa do remetente).

- **Aluno aceito:** `{"text": string}`. Qualquer outro campo (`to`, `studentId`) é rejeitado. A mensagem é sempre ao professor, na conversa dele.
- **Professor, só pela janela do painel:** `{"text": string, "to": "all"}` (para todos) **ou** `{"text": string, "studentId": "<uuid>"}` (em particular, a um aluno aceito da aula). Exatamente um dos dois; os dois juntos, nenhum, ou um aluno que não é da aula, são rejeitados.
- A janela de apresentação, quem está na sala de espera ou removido, e qualquer outro papel: descartado.
- `text`: aparado; de 1 a **500 caracteres** (contados por caractere, não por byte); sem caracteres de controle exceto a quebra de linha, e no máximo 3 quebras seguidas; texto puro, guardado como veio. Fora disso, rejeitado com o log `classroom message rejected`, sem enviar nada.

**Servidor → clientes: `live:chat:message`**

```json
{ "id": "uuid", "scope": "all" | "private", "studentId": "uuid", "from": "TEACHER" | "STUDENT", "text": "…", "createdAt": "RFC 3339" }
```

- `scope: "all"`: mensagem do professor para todos; **sem** `studentId`.
- `scope: "private"`: mensagem de uma conversa em particular; `studentId` é o **dono da conversa** (o aluno), seja quem for o remetente (`from`).
- Quem recebe:
  - mensagem do **aluno** S: todas as conexões do painel e as conexões do próprio S (é a confirmação do envio, inclusive em outra aba); **nenhum** outro aluno;
  - mensagem **particular do professor** a S: as conexões do painel e as de S; ninguém mais;
  - mensagem **para todos**: as conexões do painel e todos os alunos aceitos (online na sala); **não** a janela de apresentação, **nem** quem está na sala de espera.
- A mensagem só é enviada **depois de guardada**; `id` e `createdAt` vêm do servidor.

**Instantâneo (`live:snapshot`)**

- Aluno e painel recebem `chat: [mensagem…]` do mais antigo ao mais novo, no mesmo formato acima: o **aluno** recebe as mensagens para todos e as da conversa dele; o **painel** recebe todas. No máximo as **últimas 200** (o painel: as últimas 500). A janela de apresentação não recebe `chat`.
- O painel recebe também `onlineStudents: ["uuid", …]`: os alunos aceitos com ao menos uma conexão na sala (sem repetir quem tem duas abas).
- `GET /classes/:id/live/active` **não** muda.

**Presença (`live:presence`)**: a mensagem enviada ao **painel** ganha `onlineStudents` (a mesma lista); as demais conexões recebem a mensagem de hoje, sem ela.

**Hub:** novo `OnlineUsers(room) []string`, com os `UserID` dos viewers aceitos (não em espera), sem repetição.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Migração `00034_live_chat.sql`:** tabela `live_chat_messages` (`id`, `session_id` → sessão, `sender_id` → usuário, `sender_role` `TEACHER|STUDENT`, `student_id` → usuário, nulo para a mensagem para todos, `body` de 1 a 500 caracteres por `CHECK`, `created_at`; segue as convenções de tabela da `ARCHITECTURE.md`), com `CHECK` de que a mensagem do aluno tem `student_id = sender_id`, e índice `(session_id, created_at)`. Sobe e desce sem erro.
- **Domínio:** normalização do texto (como `NormalizeQuestion`, com o limite de 500) e erro de domínio próprio.
- **Repositório e serviço:** guardar uma mensagem (validando, no serviço, que o remetente é aluno aceito da sessão ou o professor dono da turma, e que o `studentId` do professor é aluno aceito da sessão), e ler o histórico por papel (os limites de 3.1).
- **Handler/ws:** `live:chat:send` (regra do hub com `Limited`), a entrega por 3.1, o instantâneo e a presença do painel. A sessão que acaba não apaga as mensagens.

### 3.3. Frontend (Next.js & SCSS Modules)

- **Contrato no cliente.** `classroomService.ts` ganha `CHAT_MAX = 500` e `LiveChatMessage` (o formato de 3.1). O hook `useLiveClassroom` ganha: `chat: LiveChatMessage[]` (do instantâneo e das mensagens, sem repetir `id`; o instantâneo substitui a lista), `onlineStudents: string[]` (só o painel preenche; vazio nos outros) e `sendChat(text: string, to?: "all" | { studentId: string })` (aluno: `sendChat(text)`; professor, só com `view` do painel: `sendChat(text, "all")` ou `sendChat(text, { studentId })`). Não faz envio otimista: a mensagem aparece quando o servidor a devolve.
- **Painel — cartões dos alunos online** (seção "Alunos online", na coluna principal, depois do resumo). Um card por aluno aceito que está em `onlineStudents`: nome, a **mão levantada** com o texto da **dúvida** e o tempo (como texto, sem HTML), o contador de **mensagens novas** e o botão **"Conversar"** (`aria-label` "Conversar com *nome*"). Ordem: mão levantada primeiro (a mais antiga antes), depois quem tem mensagens novas, depois por nome. Vazio: "Nenhum aluno online." Acima dos cards, o botão **"Mensagem para todos"**. Os cards acompanham a presença e as mãos em tempo real.
- **Painel — conversa** (seção "Conversa", no topo da coluna lateral). Mostra a conversa escolhida: com um aluno (as mensagens em particular dele, **junto** com as para todos, em ordem de hora, cada uma marcada: "Você" / "*Nome*" e a etiqueta "Para todos") ou o canal "Para todos os alunos" (só as públicas). Com a mão do aluno levantada, a dúvida aparece fixa no alto da conversa ("Dúvida da mão: …"). O campo de texto (até 500 caracteres, contador, Enter envia, Shift+Enter quebra a linha) tem dois botões numa conversa com um aluno: **"Enviar só para *nome*"** (principal, é o que o Enter faz) e **"Enviar para todos"**; no canal "Para todos", só "Enviar para todos". Depois de enviar para todos a partir de uma conversa particular, um aviso (`role="status"`) diz "Mensagem enviada para todos os alunos." Abrir uma conversa zera as mensagens novas dela.
- **Aluno — a conversa** na faixa de controles: o botão **"Conversa"** (`aria-expanded`), com o número de mensagens novas do professor quando fechada (o `aria-label` diz "Conversa, *N* novas"). Abre uma **coluna lateral** (como a das anotações; o palco se ajusta), e abrir uma fecha a outra (anotações e conversa nunca juntas). A coluna mostra, em ordem de hora, as mensagens para todos e as da conversa dele: "Professor · para todos", "Professor · só para você", "Você"; o campo de texto (até 500, contador, Enter envia, Shift+Enter quebra a linha) e o botão "Enviar", desativado sem conexão. Vazio: "Escreva para o professor. As mensagens do professor para todos aparecem aqui." Sempre a mais nova à vista.
- **Tela cheia do aluno.** O botão "Tela cheia" e a tecla F levam a **sala inteira** (`main`) para a tela cheia, como o pedido do professor já faz (SPEC-059), em vez de só o palco: a faixa, as anotações, a conversa e o modal da dúvida ficam. O palco continua 1280 × 720 escalado.
- **Texto puro.** As mensagens e as dúvidas são desenhadas como texto (nunca como HTML) e preservam as quebras de linha.

## 4. Modelo de Dados (Data Model)

Tabela `live_chat_messages` (3.2). Nenhuma outra tabela muda.

## 5. Contrato de API (API Contract)

Só o WebSocket da sala (3.1): `live:chat:send` (cliente → servidor), `live:chat:message` (servidor → clientes), `chat` e `onlineStudents` no instantâneo, `onlineStudents` na presença do painel. Nenhum endpoint REST novo.

## 6. Impacto e Riscos (Impact & Risks)

- **Mensagem para a pessoa errada.** O vazamento entre alunos seria grave. Mitigação: a entrega é por papel e pelo dono da conversa, testada com três alunos (o aluno B nunca recebe o que A escreveu nem o que o professor disse só a A), no tempo real e no instantâneo.
- **Spam de um aluno.** Mitigação: o limite de taxa do hub, o limite de 500 caracteres e a remoção do aluno (SPEC-054). Um limite próprio do chat e o silenciar ficam para depois, se a turma pedir.
- **Mensagem nova passar despercebida.** Sem som (fora de escopo): o contador no card e na faixa. O professor que usa só a janela de apresentação não vê o painel; está dito na tela do painel.
- **Histórico grande.** Mitigação: o instantâneo leva só as últimas 200 (500 no painel).
- **Privacidade da dúvida.** A mensagem do aluno ao professor e a dúvida da mão continuam só do professor; a mensagem em particular do professor chega só ao aluno e ao painel.
- **Conflito com a SPEC-057 na tela cheia.** A mudança para levar a sala inteira troca um comportamento aprovado. Mitigação: está na seção 10 para a revisão do Tech Lead, e os testes da SPEC-057/059 sobre o elemento em tela cheia mudam e ficam listados no relatório.
- **Conflito com a SPEC-062** (mesma sala e mesmo hook). Mitigação: esta spec vem depois dela.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): O painel DEVE mostrar a seção "Alunos online" com um card por aluno aceito que está online (nome, mão e dúvida, mensagens novas, "Conversar"), na ordem de 3.3, atualizada em até 300 ms quando um aluno entra, sai, levanta ou baixa a mão; DEVE mostrar "Nenhum aluno online." sem eles e o botão "Mensagem para todos".
- [x] **CA-02** (evento): QUANDO o professor envia uma mensagem a um aluno pelo painel, O SISTEMA DEVE guardá-la e entregá-la só às conexões do painel e às do aluno.
- [x] **CA-03** (evento): QUANDO o professor envia uma mensagem para todos, O SISTEMA DEVE guardá-la e entregá-la ao painel e a todos os alunos aceitos, e NÃO DEVE entregá-la à janela de apresentação nem a quem está na sala de espera.
- [x] **CA-04** (evento): QUANDO um aluno aceito envia uma mensagem, O SISTEMA DEVE guardá-la e entregá-la ao painel e às conexões do próprio aluno, e NÃO DEVE entregá-la a nenhum outro aluno.
- [x] **CA-05** (ubíquo): O servidor DEVE rejeitar, sem enviar nada, o texto vazio ou de mais de 500 caracteres ou com caracteres de controle indevidos, o aluno que informa destinatário, o professor sem destino ou com dois, o `studentId` que não é aluno aceito da aula; e DEVE descartar o envio da janela de apresentação, de quem está em espera ou removido, e de papel sem direito.
- [x] **CA-06** (ubíquo): O histórico DEVE vir no instantâneo (aluno: as para todos e as da conversa dele; painel: todas; no máximo 200 e 500) e DEVE sobreviver ao recarregar e ao reconectar; o cliente NÃO DEVE duplicar a mensagem que já tem (mesmo `id`).
- [x] **CA-07** (evento): QUANDO o professor escolhe um card ou "Mensagem para todos", O SISTEMA DEVE abrir a conversa com as mensagens marcadas, a dúvida fixa no alto (quando a mão estiver levantada) e o campo de texto com os botões de 3.3; o Enter DEVE enviar em particular (ou para todos no canal "Para todos"); depois de enviar para todos a partir de uma conversa particular DEVE avisar; e abrir a conversa DEVE zerar as mensagens novas dela.
- [x] **CA-08** (ubíquo): O aluno DEVE ter na faixa o botão "Conversa" com o contador de mensagens novas, que abre a coluna lateral com as mensagens marcadas e o campo de texto; DEVE abrir uma fechando a das anotações (e o contrário); e o envio DEVE ficar desativado sem conexão.
- [x] **CA-09** (ubíquo): O botão "Tela cheia" e a tecla F do aluno DEVEM levar a sala inteira para a tela cheia, mantendo a faixa, a conversa, as anotações e o modal da dúvida.
- [x] **CA-10** (ubíquo): As mensagens e as dúvidas DEVEM ser desenhadas como texto puro, com as quebras de linha, e o servidor DEVE guardá-las como vieram.
- [x] **CA-11** (ubíquo): Nada fora da sala ao vivo DEVE mudar; os testes existentes passam sem alteração, salvo os da SPEC-057 e da SPEC-059 sobre o elemento em tela cheia, que passam a testar a sala inteira e estão listados no relatório; `engine/core` não é alterado.
- [x] **CA-12** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo; migração `00034` aplicada e revertida sem erro.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `domain`:** o texto aparado; vazio; 500 e 501 caracteres (com acento e emoji); controle; quebras de linha (CA-05).
- **Backend, `repository`:** guardar e ler o histórico por papel, com os limites; a ordem; o `CHECK` de 500 e o do aluno; a migração `00034` sobe e desce (CA-06, CA-12).
- **Backend, `service`:** aluno aceito envia; aluno em espera, removido ou de outra aula não; professor dono envia a um aluno aceito e para todos; `studentId` de quem não é da aula; o histórico do aluno só leva as para todos e as dele; o do painel leva todas (CA-02 a CA-06).
- **Backend, `handler` e `hub`:** as quatro entregas de 3.1 com **três alunos** (o B nunca recebe o de A), a janela de apresentação e a sala de espera sem receber; as rejeições e os descartes de CA-05; o instantâneo com `chat` (aluno, painel, apresentação sem) e `onlineStudents` (só o painel); a presença do painel com `onlineStudents` e a dos outros sem; `OnlineUsers` sem repetição e sem quem espera; o limite de taxa (CA-02 a CA-06).
- **Frontend, hook:** o instantâneo coloca `chat` e `onlineStudents`; `live:chat:message` acrescenta sem repetir `id`; o instantâneo substitui; a presença atualiza `onlineStudents`; `sendChat` manda a mensagem certa para aluno, para todos e em particular, e o aluno não manda destino; só o painel manda como professor; nenhum envio otimista (CA-06).
- **Frontend, painel:** os cards (nome, mão e dúvida como texto, contador, ordem, vazio); "Conversar" e "Mensagem para todos" abrem a conversa; as mensagens marcadas; a dúvida fixa; o Enter e os dois botões; o aviso do envio público; o contador zera ao abrir; só texto (uma mensagem com `<b>` aparece como texto) (CA-01, CA-07, CA-10).
- **Frontend, aluno:** o botão "Conversa" com o contador e o `aria-label`; a coluna com as mensagens marcadas e o campo; exclusão mútua com as anotações; envio desativado sem conexão; Enter e Shift+Enter; a mais nova à vista; só texto (CA-08, CA-10).
- **Frontend, tela cheia:** o botão e a tecla F pedem a tela cheia ao `main` da sala; a faixa, a conversa e o modal da dúvida estão dentro dele (CA-09).
- **Regressão:** os testes existentes da sala, do painel, do hub e das SPEC-051 a 062 passam sem alteração, salvo os de elemento em tela cheia, trocados e listados no relatório (CA-11).
- **Manual:** professor e três alunos; um aluno levanta a mão com dúvida e o card mostra; o professor responde em particular (só o aluno vê) e depois para todos (todos veem, a apresentação não); o aluno B nunca vê o particular de A; recarregar traz a conversa; o aluno em tela cheia (F) abre a conversa e escreve.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-054, SPEC-055, SPEC-058, SPEC-062 e esta; `backend/internal/platform/hub/hub.go`, `backend/internal/modules/classroom/**` (`handler/ws.go`, `service`, `repository`, `domain/question.go`), `backend/migrations/00030..00033`; `frontend/src/hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `components/Classroom/**` (`TeacherPanel`, `LiveClassroom`, `LiveInteractionDrawer`, `StudentNotesPanel`, `AdmissionPanel`), `messages/pt-BR.ts`.
2. **Ordem de execução:** testes vermelhos e commit `test` antes do código, em cada frente. **Backend:** migração, domínio, repositório, serviço, hub (`OnlineUsers`), handler e instantâneo. **Frontend:** contrato (tipos e hook), depois a seção "Alunos online" e a conversa do painel, depois a conversa do aluno e a tela cheia da sala. Mensagens de UI em `pt-BR.ts`; termos novos no glossário.
3. **Arquivos a criar ou alterar:** `backend/migrations/00034_live_chat.sql`; `backend/internal/platform/hub/**`; `backend/internal/modules/classroom/**`; `frontend/src/services/classroomService.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/OnlineStudents/**`, `TeacherChat/**`, `StudentChat/**` (novos), `TeacherPanel/**`, `LiveClassroom/**`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md`. **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu os cards dos alunos online e o chat com resposta em particular ou para todos. São escolhas da Aruna, a revisar: (1) só o professor fala para todos, e o aluno só escreve ao professor; (2) o limite de 500 caracteres e o histórico de 200 (500 no painel); (3) a mensagem só aparece depois de o servidor devolvê-la (sem envio otimista); (4) o "não lido" não é guardado, ao recarregar tudo conta como lido; (5) sem som para mensagem nova; (6) anotações e conversa não abrem juntas na tela do aluno; (7) **a tela cheia do botão e da tecla F do aluno passa a levar a sala inteira**, trocando o comportamento da SPEC-057 (só o palco), para a faixa e a conversa não sumirem; (8) o Enter na conversa com um aluno envia em particular, nunca para todos.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; as escolhas da seção 10 ficam para a revisão dele |
| 14/10/2026 | Aruna Architect | Implementada. Backend: `4b9ece8`, `f7f4268`, `d936e12`, `31eaf50`. Frontend: contrato `00083ad`, `21d8215`, textos `81f9ee9`; aluno `e5faed6`, `00eb145`, `50f0b31`; painel `c9fa12f`, `997a8de`, `2f1ad09`, `a4dd2ec`. Desvios: o texto da mensagem usa a normalização comum com a dúvida (`normalizePlainText`); a presença do painel ganhou `onlineStudents` e por isso três asserções de testes existentes de presença mudaram; o administrador também envia como professor (`sender_role = TEACHER`); a tabela tem `updated_at` e `deleted_at` como as vizinhas; o aluno que manda campo além de `text` é rejeitado, e a janela de apresentação é descartada (`wrong-view`); o campo do cliente reduz 4 ou mais quebras seguidas a 3 (o servidor rejeita mais de 3); o contador de novas toma como lido só o primeiro instantâneo, então mensagens que chegam em um instantâneo de reconexão contam como novas; cada conversa do painel guarda o próprio rascunho; `LiveInteractionDrawer` ganhou a prop `before`; ao desligar o pedido de tela cheia do professor a sala sai da tela cheia mesmo que o aluno a tenha escolhido (botão, F e pedido agora apontam para o mesmo elemento); testes existentes alterados: os de elemento em tela cheia (SPEC-057/062), o da lista de botões da faixa e os helpers `live()` dos mocks do hook; sem verificação no navegador |
