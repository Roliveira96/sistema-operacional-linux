# SPEC-064: Notificações do Navegador na Aula ao Vivo (Mão Levantada e Mensagens)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-064 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `frontend/src/components/Classroom/` |
| **Contexto de tela** | Painel do professor e sala do aluno |
| **Prioridade** | Média |
| **Depende de** | SPEC-058 (mão e dúvida), SPEC-062 (som da mão no painel), SPEC-063 (chat da aula) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: tanto o professor como os alunos devem receber uma notificação push quando alguém levantou a mão ou quando recebeu mensagem |

---

## 1. Contexto e Problema (Context & Problem Statement)

Durante a aula o professor fica na janela de apresentação e o aluno, muitas vezes, em outra aba. O painel só mostra a mão levantada e a mensagem nova **na própria tela**, e o único aviso fora dela é o som do painel. Quem está em outra janela ou aba não percebe que **um aluno levantou a mão**, que **o aluno escreveu** ou que **o professor respondeu**.

## 2. Objetivos (Goals)

- O **professor** recebe uma notificação quando um aluno levanta a mão e quando um aluno lhe escreve.
- O **aluno** recebe uma notificação quando o professor lhe escreve, em particular ou para todos.
- Cada pessoa liga e desliga, e o navegador pede a permissão por um botão.

### 2.1. Fora de escopo (Non-Goals)

- **Web Push com a aba fechada** (service worker, chaves VAPID, tabela de inscrições, envio pelo servidor, HTTPS obrigatório). Esta spec usa a **notificação do navegador** com a aula aberta, mesmo em segundo plano. O push completo é uma spec à parte, se for necessário.
- Notificação para as mãos e mensagens que já existiam ao entrar ou recarregar, para as mensagens do próprio remetente e para o aluno que levanta a própria mão.
- Notificação ao aluno quando o professor baixa a mão dele.
- Mudar o servidor, o protocolo ou o som do painel.
- Aviso em tela (toast) dentro da página.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Quando notifica.** A tela que recebe um evento **novo** pelo hook da sala (`useLiveClassroom`) mostra uma notificação do navegador, **só** quando a página **não está sendo vista**: `document.hidden` verdadeiro **ou** a janela sem foco (`document.hasFocus()` falso). Com a página à vista e em foco, não notifica (a tela, o contador e o som já avisam). Uma mensagem ou mão é "nova" quando o seu `id` (mensagem) ou `studentId` (mão) **não estava** na lista anterior; a primeira lista com a sala pronta (o instantâneo ao entrar ou recarregar) é só a linha de base e **não notifica**.
- **O que notifica.**
  - **Painel do professor:** (a) um aluno entra na fila de mãos: título "Mão levantada", corpo "*Nome* levantou a mão" e, se houver, ": *dúvida*"; (b) chega uma mensagem de aluno (`from: "STUDENT"`): título "Mensagem de *Nome*", corpo o texto.
  - **Sala do aluno:** chega uma mensagem do professor (`from: "TEACHER"`): título "Professor" (em particular) ou "Professor · para todos", corpo o texto.
  - Nada do que a pessoa mesma fez: o aluno não é notificado das próprias mensagens (o servidor as devolve), nem da própria mão.
- **Conteúdo.** Texto puro, o corpo cortado em 140 caracteres com reticências; `tag` por mão (`hand-<studentId>`) e por mensagem (`chat-<id>`), para a mesma coisa não empilhar; a notificação se fecha sozinha em 8 segundos. Os textos da interface ficam em `pt-BR.ts`.
- **Permissão e preferência — o botão "Notificações".** Um componente `NoticeToggle`, no painel (ao lado do "Som do aviso") e na faixa de controles do aluno (ao lado de "Conversa"), com quatro estados:
  - **indisponível** (o navegador não tem a API, ou a página não está em contexto seguro: `https`, ou `localhost`): botão desativado com a dica "Este navegador ou este endereço não permite notificações. Use https ou localhost.";
  - **permissão ainda não pedida**: botão "Ativar notificações"; o clique (um gesto do usuário) pede a permissão, e, se concedida, liga;
  - **concedida**: botão com `aria-pressed` ("Notificações" ligado/desligado), que liga e desliga; a escolha fica guardada no navegador (`localStorage`, com `try/catch`), ligada por padrão depois da permissão;
  - **bloqueada** no navegador: botão desativado com a dica "As notificações estão bloqueadas nas configurações do navegador."
- **O clique na notificação.** Traz a janela para frente (`window.focus()`) e fecha a notificação; no painel, **abre a conversa daquele aluno**; na sala do aluno, **abre a coluna "Conversa"**. A mão levantada sem mensagem abre a conversa do aluno também.
- **Peças.** `components/Classroom/notices/`: o acesso ao navegador (`supported`, `permission`, `show`), a preferência guardada, o `NoticeToggle` e um hook `useRoomNotices` que compara a lista anterior com a nova e chama `show` (o resto da sala só entrega `chat`, `hands`, o papel e o id da pessoa). O painel e a sala do aluno só ligam o hook e o botão.

### 3.2. Backend (Go — Camada de Módulo/Service)

Nenhuma mudança.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança. A preferência fica no `localStorage` do navegador de cada pessoa.

## 5. Contrato de API (API Contract)

Nenhuma mudança.

## 6. Impacto e Riscos (Impact & Risks)

- **Não funciona em `http` fora de `localhost`.** Os navegadores só liberam notificações em contexto seguro; com `APP_PUBLIC_URL=http://192.168.x.x` os alunos da rede local **não** terão notificação (o botão diz isso). Em produção com `https` funciona.
- **Notificação com a aba fechada não existe** (Web Push, fora de escopo); a aula precisa estar aberta em alguma janela ou aba.
- **Mensagem vista na hora.** Com a página em foco não notifica; a regra de foco pode falhar em navegadores que mentem sobre o foco: o pior caso é uma notificação a mais.
- **Texto da dúvida na notificação do professor.** Aparece no sistema operacional dele, por vezes numa tela compartilhada; está dito na seção 10 para a revisão do Tech Lead.
- **Excesso de notificações** com muitas mãos de uma vez. Mitigação: `tag` por item e fechamento em 8 s; o professor desliga pelo botão.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO um aluno entra na fila de mãos, E a página do painel não está à vista ou em foco, E as notificações estão ligadas, O SISTEMA DEVE mostrar a notificação "Mão levantada" com o nome do aluno e a dúvida (quando houver).
- [x] **CA-02** (evento): QUANDO chega ao painel uma mensagem de aluno, nas mesmas condições, O SISTEMA DEVE mostrar a notificação "Mensagem de *Nome*" com o texto.
- [x] **CA-03** (evento): QUANDO chega à sala do aluno uma mensagem do professor (em particular ou para todos), nas mesmas condições, O SISTEMA DEVE mostrar a notificação "Professor" ou "Professor · para todos" com o texto.
- [x] **CA-04** (ubíquo): O sistema NÃO DEVE notificar: o histórico do primeiro instantâneo (entrar ou recarregar); a mensagem ou mão cujo id já estava na lista; a mensagem do próprio remetente; a mudança só da dúvida de uma mão que já estava levantada; a mão baixada; com a página à vista e em foco; com as notificações desligadas, bloqueadas ou indisponíveis.
- [x] **CA-05** (ubíquo): O botão "Notificações" DEVE existir no painel e na faixa do aluno, com os quatro estados de 3.1; o clique de "Ativar notificações" DEVE pedir a permissão; a escolha ligada ou desligada DEVE ficar guardada no navegador.
- [x] **CA-06** (evento): QUANDO a pessoa clica na notificação, O SISTEMA DEVE trazer a janela para frente e fechar a notificação, abrir a conversa do aluno no painel e a coluna "Conversa" na sala do aluno.
- [x] **CA-07** (ubíquo): A notificação DEVE ter texto puro, o corpo cortado em 140 caracteres, `tag` por mão e por mensagem e fechar-se sozinha em 8 segundos.
- [x] **CA-08** (ubíquo): Nada fora da sala ao vivo DEVE mudar; os testes existentes passam sem alteração (salvo os helpers de mock que ganham campos); o servidor e `engine/core` não são alterados.
- [x] **CA-09** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038). Nenhum teste usa a notificação de verdade: o acesso ao navegador entra por uma função substituível, e o `Notification` de teste é um duplo.

- **Acesso ao navegador:** `supported` falso sem a API e sem contexto seguro; `permission`; `show` cria a notificação com título, corpo cortado em 140, `tag`, texto puro e a fecha em 8 s (relógio falso); o clique chama `window.focus`, fecha e chama o callback (CA-05, CA-06, CA-07).
- **Preferência:** guardada e lida do `localStorage`; falha do `localStorage` não quebra (CA-05).
- **`NoticeToggle`:** os quatro estados e as dicas; "Ativar" pede a permissão e liga se concedida; recusada, fica bloqueado; liga e desliga com `aria-pressed` (CA-05).
- **`useRoomNotices`:** o primeiro estado pronto não notifica; mensagem nova de aluno e mão nova notificam o professor, mensagem do professor notifica o aluno; a mesma mensagem duas vezes e o mesmo aluno com outra dúvida não repetem; o remetente não é notificado das próprias mensagens; só com a página escondida ou sem foco; desligado ou sem permissão, nada; reconexão que traz mensagens novas notifica só as novas (CA-01 a CA-04).
- **`TeacherPanel` e `LiveClassroom`:** o botão aparece; o clique na notificação abre a conversa do aluno (painel) e a coluna "Conversa" (aluno) (CA-05, CA-06).
- **Regressão:** testes existentes da sala e do painel passam sem alteração, salvo os helpers de mock (CA-08).
- **Manual (em `localhost`):** ativar o botão nas duas telas; com a janela do aluno em outra aba, o professor levanta... (o aluno levanta a mão) e a notificação do professor aparece; o aluno escreve e o professor é notificado; o professor responde e o aluno é notificado; clicar leva à conversa.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-062, SPEC-063 e esta; `components/Classroom/TeacherPanel` (e `useUnreadMessages.ts`), `LiveClassroom`, `StudentChat`, `TeacherChat`, `OnlineStudents`; `hooks/useLiveClassroom.ts`; `messages/pt-BR.ts`.
2. **Ordem de execução:** testes vermelhos e commit `test`; o acesso ao navegador e a preferência; o `NoticeToggle`; o `useRoomNotices`; a ligação no painel e na sala do aluno; mensagens em `pt-BR.ts`.
3. **Arquivos a criar ou alterar:** `frontend/src/components/Classroom/notices/**` (novo), `TeacherPanel/**`, `LiveClassroom/**`, `frontend/src/messages/pt-BR.ts`, `specs/GLOSSARY.md`. **Não alterar** `engine/core`, o backend, o hook `useLiveClassroom.ts`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu "notificação push" para quem levanta a mão e para quem recebe mensagem. São leituras e escolhas da Aruna, a revisar: (1) "push" foi entendido como **notificação do navegador com a aula aberta**, e não Web Push com a aba fechada (o push completo pede service worker, chaves VAPID, tabela de inscrições e HTTPS); (2) o professor é notificado da mão levantada e das mensagens dos alunos, e o aluno das mensagens do professor (o aluno **não** é notificado de mãos de outros alunos nem de a mão dele ter sido baixada); (3) só notifica com a página escondida ou sem foco; (4) a **dúvida** do aluno aparece no texto da notificação do professor; (5) o botão "Notificações" aparece no painel e na faixa do aluno, e a permissão é pedida só por esse botão; (6) corpo de 140 caracteres e fechamento em 8 s.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; as leituras e escolhas da seção 10 ficam para a revisão dele |
| 14/10/2026 | Aruna Architect | Implementada (`544324c`, `2a56abe`, `87520e5`). Desvios: mais de 3 novidades na mesma atualização viram 3 notificações e um aviso "e mais *N*" (título "Aula ao vivo", `tag: "more"`); a mensagem sem nome conhecido diz "Mensagem de um aluno"; a dica do botão desativado fica visível ao lado dele; o botão "Notificações" entrou depois de "Conversa" na faixa, o que mudou os testes que comparavam a lista exata de botões; o acesso ao navegador ganhou `inView()`; sem verificação no navegador (nenhuma notificação foi vista de verdade) |
