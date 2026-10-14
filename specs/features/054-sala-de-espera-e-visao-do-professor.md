# SPEC-054: Sala de Espera, Visão do Professor e Módulo Sincronizado na Aula ao Vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-054 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (implementada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend); `frontend/src/components/Classroom/` |
| **Contexto de tela** | Sala ao vivo (`/app/classes/:classId/live`) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051 (sala ao vivo), SPEC-053 (conteúdo da aula), SPEC-016 (tela de estudo e terminal), SPEC-010 (módulos de ensino) |
| **Substitui** | Nenhuma (altera partes da SPEC-051: o espelho do módulo, o instantâneo de estado e as mensagens do WebSocket) |
| **Fontes canônicas** | Relato do Tech Lead em 14/10/2026: "a tela do professor e a tela do aluno não estão sincronizadas; o professor deve aceitar os alunos para ver a tela dele; o professor deve ter duas visualizações: a que o aluno vai ver e a dele, para interagir sem os alunos verem". Escolhas do Tech Lead: sala de espera com aceitar, e tela dividida |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na aula ao vivo (SPEC-051), hoje:

- **Qualquer estudante matriculado que entra já vê tudo.** O professor não decide quem acompanha a aula.
- **O professor tem uma só tela**, a mesma que vai para os estudantes: tudo que ele clica, digita ou desenha é transmitido na hora. Ele não tem onde preparar a próxima lâmina, testar um comando ou consultar o módulo sem expor isso à turma.
- **As telas do professor e do estudante não ficam iguais no modo Módulo.** O modo Módulo não tem seletor de módulo, o terminal da sala é montado na máquina padrão (não na máquina do módulo) e o estudante não vê o conteúdo do módulo, só um terminal. O professor e o estudante acabam vendo coisas diferentes.

## 2. Objetivos (Goals)

- O professor **aceita** cada estudante antes de ele ver a aula (sala de espera).
- O professor tem **duas visões ao mesmo tempo (tela dividida)**: **Minha tela**, privada e interativa, e **Tela da turma**, que mostra exatamente o que os estudantes estão vendo.
- Nada que o professor faz em "Minha tela" vai para os estudantes, até ele **mostrar para a turma**.
- No modo Módulo, professor e estudantes veem **o mesmo módulo**: o conteúdo e o terminal na máquina do módulo.

### 2.1. Fora de escopo (Non-Goals)

- Voz, vídeo, bate-papo, e apresentar a tela do computador do professor.
- Sala de espera automática por regra (por exemplo, "aceitar todos de uma turma"): só o professor aceita, um a um ou todos de uma vez.
- Que o estudante tenha "a sua tela" separada: continua só assistindo e participando.
- Alterar a tela de estudo individual do módulo (`TopicStudy`).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Sala de espera (estudante).** Ao entrar na sala, o estudante vê a tela **"Aguardando o professor aceitar a sua entrada"**, sem lâmina, terminal, traços nem fila. Quando o professor aceita, a aula aparece sem recarregar. Se for removido, vê "O professor retirou você da aula" e o botão **Pedir para entrar de novo**.

**Sala de espera (professor).** No painel lateral, a seção **Sala de espera** lista quem pediu para entrar (nome e há quanto tempo), com **Aceitar**, **Aceitar todos** e **Recusar**, e o contador de quantos estão aceitos. Quem já foi aceito aparece na lista **Na aula** com **Remover da aula**. Entra um aviso discreto quando chega alguém novo.

**Tela dividida (professor).** A sala do professor passa a ter duas áreas, lado a lado em telas largas (cerca de 60% e 40%) e uma sobre a outra em telas estreitas, com a segunda recolhível:

- **Minha tela** (privada, interativa): as lâminas, o conteúdo do módulo e o terminal que só o professor vê e usa.
  - **Lâminas:** o professor navega pelas lâminas sem a turma ver. O botão **Mostrar para a turma** publica a lâmina de Minha tela; o botão **Seguir a turma** leva Minha tela de volta à lâmina que a turma vê.
  - **Laser e caneta:** quando a lâmina de Minha tela é a mesma da turma, vão para a turma; quando é outra, ficam só para o professor.
  - **Terminal:** o terminal de Minha tela é privado. A chave **Transmitir o terminal** (desligada por padrão) liga o envio da digitação, dos comandos e das saídas à turma; ligada, a turma vê o terminal do professor; desligada, nada sai.
  - **Módulo:** o professor escolhe o módulo da aula no seletor; **Mostrar o módulo para a turma** publica a escolha e o bloco em foco.
- **Tela da turma** (somente leitura): a mesma visão que o estudante recebe (lâmina publicada, laser e traços publicados, módulo publicado e terminal transmitido), alimentada pelo estado já publicado, sem passar pela rede de novo. Mostra o rótulo **A turma está vendo isto** e o número de estudantes aceitos.

**Modo Módulo sincronizado (todos).** No modo Módulo, o palco do estudante mostra o **conteúdo do módulo** (os blocos da lição, só de leitura, com o bloco em foco do professor destacado e levado à vista) e, ao lado, o **terminal na máquina do módulo**, que reproduz o professor quando a transmissão do terminal está ligada. Professor e estudante carregam o mesmo módulo e a mesma máquina inicial, pelos mesmos serviços de conteúdo e de cenário da tela de estudo.

Botões do padrão `Button`, tema único escuro, só tokens, alvos de 44 px, textos no arquivo de mensagens, navegação por teclado.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (admissão):** o estudante com matrícula ativa que conecta à sala entra como **em espera**. Só o estudante **aceito** recebe `live:snapshot` e as mensagens da sala; o em espera recebe só o seu estado de admissão e nada do palco. O docente dono e o administrador entram direto.
- **RN-02 (decisão do docente):** só o docente dono (ou o administrador) aceita, aceita todos, recusa ou remove. A decisão vale para aquela aula: quem foi aceito continua aceito se a conexão cair e voltar. O removido volta à espera se pedir de novo.
- **RN-03 (o que o aceito pode):** levantar a mão, ler e gravar as suas anotações e receber a aula só valem para o estudante aceito. O limite de 100 estudantes da SPEC-051 conta os aceitos; quem está em espera conta à parte, com teto de 200.
- **RN-04 (o que sai de Minha tela):** o servidor só retransmite à turma o que o docente publica: lâmina (`live:slide:change`), laser e traços da lâmina publicada, módulo e bloco em foco e, com a transmissão do terminal ligada, a digitação e os comandos. O docente não envia o que é privado; o servidor não distingue, mas o instantâneo (RN-05) só guarda o publicado.
- **RN-05 (instantâneo):** `live:snapshot` do estudante aceito leva o publicado: lâmina, traços, módulo e bloco em foco, estado do terminal transmitido (se ligado), fila e total online. O do docente leva também a sala de espera e a lista de aceitos.
- **RN-06 (módulo da aula):** o modo Módulo exige um módulo escolhido (`live:mode:switch` com módulo); o servidor valida que o módulo existe e está disponível ao docente, como no início da aula (SPEC-051). O módulo escolhido fica na aula (`active_module_id`).
- **RN-07 (módulo do estudante):** o estudante aceito lê o módulo e o cenário do módulo escolhido pela sala, ainda que o módulo seja privado a outra turma, **enquanto a aula está ativa** e só o módulo da sala; para isso, a leitura passa pelo módulo `classroom`, que checa a admissão, e não abre o módulo ao estudante em geral.

## 4. Modelo de Dados (Data Model)

Tabela nova `live_classroom_admissions` (migração 00032):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | Identificador |
| `session_id` | uuid | Sim | FK `live_classroom_sessions` | Aula |
| `student_id` | uuid | Sim | FK `users` | Estudante |
| `status` | text | Sim | `WAITING`, `ADMITTED` ou `REMOVED` | Situação na aula |
| `requested_at` | timestamptz | Sim | | Quando pediu para entrar (ordem da espera) |
| `decided_at` | timestamptz | Não | | Quando o docente decidiu |
| `decided_by` | uuid | Não | FK `users` | Quem decidiu |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | Sim, Sim, Não | | Auditoria e exclusão lógica |

Índice único em `(session_id, student_id)` entre os não excluídos. Não há outra mudança de esquema: `active_module_id` e `display_mode` já existem.

## 5. Contrato de API (API Contract)

WebSocket `GET /api/v1/classes/{id}/live/ws` (SPEC-051, seção 5.8), com as mudanças:

- **Do servidor ao estudante:** `live:admission:state` (`WAITING`, `ADMITTED` ou `REMOVED`), enviado ao conectar e a cada decisão. O estudante em espera não recebe `live:snapshot` até ser aceito.
- **Do servidor ao docente:** `live:admission:queue`, com a lista de quem espera (identificador, nome, `requestedAt`) e a de quem está aceito, enviada ao conectar e a cada mudança.
- **Do docente ao servidor:** `live:admission:accept` (um estudante), `live:admission:accept-all`, `live:admission:remove` (aceito ou em espera, que recusa).
- **Do docente à turma (novas):** `live:module:focus` (o bloco em foco do módulo); `live:terminal:broadcast` (liga ou desliga a transmissão do terminal); `live:mode:switch` passa a exigir `moduleId` no modo `MODULE`.
- **Do servidor à sala:** `live:snapshot` passa a incluir `moduleId`, `moduleFocusBlockId` e `terminalBroadcast`, e, para o docente, `admissions`.
- **Erros do envio de mensagens:** mensagem de estudante que não é aceito, ou de controle que não vem do docente, é descartada com registro de auditoria (como na SPEC-051).

**`GET /api/v1/classes/{id}/live/module`**: lê, para a sala ativa, o módulo da aula (título, blocos e cenário inicial do terminal).

- **Papéis autorizados:** docente dono, administrador e estudante **aceito** na aula ativa (RN-07).
- **Resposta (200):** `moduleId`, `title`, `blocks` (os blocos ativos da versão publicada) e `scenario` (a máquina inicial).
- **Erros (RFC 7807):** 403 `forbidden` (estudante não aceito ou sem matrícula); 404 `class-not-found`; 404 `no-active-session`; 404 `module-not-selected` (a aula ainda não escolheu um módulo).

## 6. Impacto e Riscos (Impact & Risks)

- **Estudante preso na espera por esquecimento do professor.** Mitigação: o aviso de novo estudante e o contador na sala de espera do professor; a sala mostra ao estudante há quanto tempo ele espera.
- **Vazamento do que é privado.** Mitigação: o servidor só repassa publicações explícitas; o instantâneo e as respostas guardam só o publicado; testes confirmam que um estudante em espera não recebe nada do palco.
- **Acesso ao módulo privado de outra turma.** Mitigação: leitura só pela rota da sala, só para o aceito, só do módulo da aula, só com a aula ativa (RN-07).
- **Peso da tela dividida em máquinas pequenas.** Mitigação: a Tela da turma é recolhível e usa o estado já em memória, sem segunda conexão nem segundo terminal.
- **Terminal duplicado (privado e transmitido).** Mitigação: um único terminal real no professor; a transmissão só liga ou desliga o envio das suas mensagens.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO um estudante matriculado conecta à sala, O SISTEMA DEVE colocá-lo em espera, mostrar-lhe a tela de espera e NÃO enviar lâmina, traços, terminal, módulo nem fila.
- [ ] **CA-02** (evento): QUANDO o docente aceita um estudante, ou aceita todos, O SISTEMA DEVE liberar a aula a ele sem recarregar a tela, enviando-lhe o instantâneo do publicado.
- [ ] **CA-03** (evento): QUANDO o docente recusa ou remove um estudante, O SISTEMA DEVE retirar-lhe o acesso e avisá-lo, e ele só volta à espera se pedir de novo.
- [ ] **CA-04** (estado): ENQUANTO o estudante foi aceito, O SISTEMA DEVE mantê-lo aceito se a conexão cair e voltar, durante a mesma aula.
- [ ] **CA-05** (indesejado): SE a mensagem vem de estudante em espera ou removido, ENTÃO O SISTEMA DEVE descartá-la com registro de auditoria; e só o aceito pode levantar a mão e gravar anotações.
- [ ] **CA-06** (ubíquo): O painel do professor DEVE mostrar a sala de espera (nome, há quanto tempo, Aceitar, Aceitar todos e Recusar), a lista dos aceitos com Remover, e um aviso quando chega alguém novo.
- [ ] **CA-07** (ubíquo): A tela do professor DEVE ter, ao mesmo tempo, Minha tela (privada) e Tela da turma (somente leitura, "A turma está vendo isto"), lado a lado em telas largas e empilhadas em telas estreitas, com a Tela da turma recolhível.
- [ ] **CA-08** (evento): QUANDO o professor navega pelas lâminas em Minha tela, O SISTEMA NÃO DEVE mostrar isso aos estudantes; QUANDO aciona "Mostrar para a turma", DEVE publicar a lâmina; QUANDO aciona "Seguir a turma", DEVE levar Minha tela à lâmina publicada.
- [ ] **CA-09** (estado): ENQUANTO a lâmina de Minha tela é a mesma da turma, O SISTEMA DEVE transmitir o laser e a caneta; ENQUANTO é outra, NÃO DEVE.
- [ ] **CA-10** (estado): ENQUANTO a transmissão do terminal está desligada, O SISTEMA NÃO DEVE enviar à turma a digitação, os comandos nem as saídas do professor; ligada, DEVE enviá-los.
- [ ] **CA-11** (evento): QUANDO o professor escolhe o módulo e o mostra para a turma, O SISTEMA DEVE carregar nos estudantes aceitos o conteúdo do módulo (só leitura, com o bloco em foco destacado) e o terminal na máquina do módulo; SE nenhum módulo foi escolhido, ENTÃO DEVE recusar a troca para o modo Módulo.
- [ ] **CA-12** (indesejado): SE um estudante não aceito, ou de fora da aula ativa, pede o módulo da sala, ENTÃO O SISTEMA DEVE responder 403; o módulo privado a outra turma só é lido pela rota da sala.
- [ ] **CA-13** (ubíquo): A Tela da turma do professor DEVE mostrar exatamente o que o estudante aceito recebe (lâmina publicada, traços, módulo e terminal transmitido).
- [ ] **CA-14** (ubíquo): A interface DEVE usar o tema único escuro, só tokens, alvos de 44 px e navegação por teclado.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `classroom/service`:** `TestAdmission_WaitingByDefault`, `TestAdmission_AcceptAndAcceptAll`, `TestAdmission_RemoveAndAskAgain`, `TestAdmission_SurvivesReconnect`, `TestAdmission_OnlyTheTeacherDecides` (CA-01 a CA-04); `TestAdmitted_OnlyCanRaiseHandAndWriteNotes` (CA-05); `TestSwitchToModuleNeedsAModule` (CA-11); `TestModuleOfTheRoom_ForTheAdmittedOnly` (CA-12).
- **Backend, `classroom/repository`:** `TestAdmissions_UniquePerStudentAndSession` e `TestAdmissions_SoftDelete`.
- **Backend, `platform/hub`:** o estudante em espera não recebe o palco; o aceito recebe o instantâneo ao ser aceito; mensagens de quem não é aceito são descartadas com auditoria; o teto de espera; `live:admission:queue` ao docente (CA-01, CA-02, CA-05, CA-06).
- **Backend, `classroom/handler`:** a rota `GET .../live/module` e seus erros; as mensagens `live:admission:*`, `live:module:focus` e `live:terminal:broadcast` (CA-02, CA-03, CA-10, CA-11, CA-12).
- **Frontend:** `WaitingRoom` (estudante em espera, aceito e removido, CA-01 a CA-03); `AdmissionPanel` (lista, Aceitar, Aceitar todos, Recusar, Remover e o aviso, CA-06); `TeacherSplitView` (as duas áreas, o rótulo e o recolhimento, CA-07); lâminas privadas, "Mostrar para a turma" e "Seguir a turma" (CA-08); laser e caneta só na mesma lâmina (CA-09); a chave de transmissão do terminal (CA-10); `ModuleStage` (conteúdo só de leitura, bloco em foco e o terminal na máquina do módulo, CA-11); a Tela da turma igual ao que o estudante recebe (CA-13); tema e alvos (CA-14).
- **Manual:** com o professor e dois alunos, conferir que o aluno fica na espera até ser aceito; navegar pelas lâminas em Minha tela sem a turma ver e depois publicar; testar um comando com a transmissão desligada e ligada; escolher um módulo e ver o mesmo conteúdo e terminal nos dois lados.
- **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051 e SPEC-053, SPEC-016; `platform/hub`, `classroom/*`, `components/Classroom/*`, `engine/terminalWindow.ts`, `TopicStudy` (como carrega conteúdo e cenário) e `ContentRenderer`.
2. **Ordem de execução:** testes vermelhos e commit `test`; migração `00032`; admissão no hub e no serviço; `GET .../live/module`; `live:module:focus` e `live:terminal:broadcast`; frontend (sala de espera, painel de admissão, tela dividida, palco do módulo); mensagens.
3. **Arquivos a criar ou alterar:** `backend/migrations/00032_live_admissions.sql`; `backend/internal/platform/hub/**`; `backend/internal/modules/classroom/**`; `backend/cmd/api/main.go` (só se a composição pedir); `frontend/src/services/classroomService.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/**` (novos `WaitingRoom`, `AdmissionPanel`, `TeacherSplitView`, `ModuleStage`); `frontend/src/app/app/classes/[id]/live/page.tsx`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md` (termo "Sala de espera").
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: sala de espera com aceitar e tela dividida. Assumidas por recomendação: aceitar um a um ou todos; o removido pede de novo; o terminal privado, com a transmissão ligada por uma chave (desligada por padrão); o conteúdo do módulo é só de leitura para o estudante, com o bloco em foco do professor destacado.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao decidir a sala de espera e a tela dividida |
| 14/10/2026 | Implementador | Implementada. Formato das mensagens que a spec não fixava e que ficou definido no backend: `live:admission:state {status}`; `live:admission:queue {waiting[], admitted[]}` com itens `{studentId, name, requestedAt}`; `live:admission:accept {studentId}`, `accept-all {}` e `remove {studentId}`; `live:admission:request {}` (o estudante removido pede para voltar); `live:terminal:broadcast {enabled}`; `live:module:focus {blockId}`; o snapshot ganha `moduleId`, `moduleFocusBlockId`, `terminalBroadcast` e, ao docente, `admissions`; `GET /live/module` devolve `moduleId`, `title`, `blocks`, `scenario` e `setup`. Desvios: a Tela da turma usa uma segunda instância espelho do terminal; não há pré-visualização privada de módulo ainda não publicado; ao ligar a transmissão do terminal o estado chega aos alunos no comando seguinte; anotações de aulas já encerradas e anteriores a esta spec não exigem admissão. Limitação conhecida: o terminal do módulo parte do `scenario`, sem as camadas de `setup` que a tela de estudo aplica (exigiria mudar o `MirroredModuleView`) |
| 14/10/2026 | Aruna Architect | A SPEC-055 substitui a tela dividida ("Minha tela" e "Tela da turma"), a lâmina privada versus publicada e a chave "Transmitir o terminal" (CA-07 a CA-10 e CA-13) pela janela de apresentação e o painel do professor. A sala de espera e o módulo sincronizado continuam valendo |
