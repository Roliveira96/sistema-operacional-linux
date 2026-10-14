# SPEC-059: Tela Cheia dos Alunos Acionada pelo Professor

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-059 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (solução em dois passos confirmada pelo Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend, sem migração); `frontend/src/components/Classroom/` |
| **Contexto de tela** | Painel do professor, janela de apresentação e sala do aluno |
| **Prioridade** | Média |
| **Depende de** | SPEC-055 (painel e apresentação), SPEC-057 (palco, faixa de controles e instantâneo `stageView`) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026, a pedido do professor: um botão "deixar a tela dos alunos em modo tela cheia", e os alunos que estão online na tela da aula entram **automaticamente** em tela cheia |

---

## 1. Contexto e Problema (Context & Problem Statement)

Cada aluno hoje precisa achar e acionar a tela cheia por conta própria; muitos não o fazem e veem o palco menor, com a barra do navegador e o menu da plataforma ao redor. O professor quer **um botão** que ponha todos os alunos em tela cheia de uma vez.

**Restrição dos navegadores:** o `requestFullscreen()` só funciona **depois de um gesto do usuário** (clique ou tecla). Um comando remoto do professor não é um gesto do aluno, então o site **não consegue** forçar a tela cheia de verdade sozinho. O que dá para fazer de forma automática, sem gesto, é o **modo foco** (o palco ocupa a janela inteira, sem o menu da plataforma). A tela cheia de verdade entra no **primeiro clique ou tecla** do aluno depois do pedido.

## 2. Objetivos (Goals)

- Um botão do professor liga e desliga "Tela cheia para os alunos".
- Ao ligar, todos os alunos que estão na sala entram **na hora** no modo foco e tentam a tela cheia; o que o navegador recusar entra no **primeiro toque** do aluno.
- Ao desligar, todos voltam ao normal.
- Quem entra ou reconecta com o modo ligado já o encontra aplicado.

### 2.1. Fora de escopo (Non-Goals)

- Impedir o aluno de sair da tela cheia (a tecla Esc é do navegador, e a sala não insiste).
- Saber, no painel, quais alunos estão de fato em tela cheia (o painel só mostra se o pedido está ligado).
- Tela cheia para o professor (já existe, SPEC-055).
- Bloquear outras abas ou janelas do aluno.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Professor.** No **painel** (bloco de controle da aula) e na **barra de ferramentas da janela de apresentação**, o botão **"Tela cheia para os alunos"**, que liga e desliga, com o estado visível ("Ligada" ou "Desligada", `aria-pressed`). Aciona `live:stage:fullscreen {"enabled": true|false}`. As duas janelas do professor mostram o mesmo estado.
- **Aluno, ao receber `enabled: true` (ou ao entrar com o estado ligado).**
  1. Entra **na hora** no **modo foco**: o palco ocupa toda a janela, sem o menu e o cabeçalho da plataforma, mantida a faixa de controles (SPEC-057).
  2. **Tenta** a tela cheia do navegador (`requestFullscreen`); se o navegador recusar, a recusa é silenciosa.
  3. Se a recusa aconteceu, o **próximo clique ou tecla do aluno em qualquer lugar da sala** entra em tela cheia (um ouvinte de uso único, para o aluno não precisar procurar o botão), e a faixa de controles destaca o botão **"Entrar em tela cheia (pedido do professor)"** de um clique.
  4. Se o aluno **sai** da tela cheia (Esc) durante o pedido, a sala **não insiste** sozinha: o destaque do botão volta e o aluno entra de novo quando quiser; o modo foco continua.
- **Aluno, ao receber `enabled: false`.** Sai da tela cheia (se estiver nela por causa do pedido) e do modo foco, voltando ao layout normal.
- O modo foco e a tela cheia **não mudam o palco**: ele continua 1280 × 720 escalado (SPEC-057), só com mais área.

### 3.2. Backend (Go — Camada de Módulo/Service)

- Nova mensagem `live:stage:fullscreen` com `{"enabled": boolean}` (campo obrigatório e booleano; qualquer outra coisa é rejeitada com log `classroom message rejected`), enviada **pelo painel ou pela janela de apresentação** (as duas janelas do professor, como a troca de modo); de aluno é descartada (`not-controller`).
- O servidor guarda o estado em memória (desligado por padrão), repassa a **todas as outras conexões aceitas** (a outra janela do professor e os alunos, sem eco), e o inclui no instantâneo de todos em `stageView.fullscreen` (booleano, `false` por padrão). **Não** é reiniciado por troca de lâmina ou de módulo; some quando a aula acaba. `MaxBytes` pequeno (256 bytes), Coalesce, sem `Limited`.

## 4. Modelo de Dados (Data Model)

Nenhuma tabela e nenhuma migração: o estado fica em memória, com o estado do palco.

## 5. Contrato de API (API Contract)

- **Cliente (painel ou apresentação) → servidor:** `live:stage:fullscreen {"enabled": boolean}`.
- **Servidor → clientes:** a mesma mensagem, às outras conexões aceitas; `live:snapshot` e `GET /classes/:id/live/active` levam `stageView.fullscreen`.

## 6. Impacto e Riscos (Impact & Risks)

- **O navegador não deixa forçar a tela cheia.** Mitigação: o modo foco entra sozinho; a tela cheia real entra no primeiro clique do aluno, e a faixa mostra o botão de um clique. O professor deve saber que "automático" quer dizer isso; está dito na tela do botão ("os alunos entram em tela cheia ao primeiro toque, se o navegador pedir").
- **Aluno incomodado com o pedido.** Mitigação: a sala não insiste depois que o aluno sai com Esc; o botão continua à mão.
- **Conflito com a SPEC-057 e a SPEC-058** (mesma faixa, mesmo hook, mesmo `ws.go`). Mitigação: esta spec só é implementada depois delas.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O painel e a janela de apresentação DEVEM ter o botão "Tela cheia para os alunos", que liga e desliga, com o estado visível, e as duas janelas DEVEM mostrar o mesmo estado.
- [ ] **CA-02** (evento): QUANDO o professor liga o pedido, O SISTEMA DEVE levar todos os alunos na sala ao modo foco em até 300 ms e DEVE tentar a tela cheia do navegador.
- [ ] **CA-03** (evento): QUANDO o navegador recusa a tela cheia, O SISTEMA DEVE entrar nela no primeiro clique ou tecla do aluno e DEVE destacar o botão de um clique na faixa de controles.
- [ ] **CA-04** (evento): QUANDO o aluno sai da tela cheia durante o pedido, O SISTEMA NÃO DEVE reentrar sozinho; o modo foco DEVE continuar e o botão DEVE voltar a ser destacado.
- [ ] **CA-05** (evento): QUANDO o professor desliga o pedido, O SISTEMA DEVE tirar os alunos da tela cheia e do modo foco.
- [ ] **CA-06** (evento): QUANDO um aluno entra ou reconecta com o pedido ligado, O SISTEMA DEVE aplicar o modo foco e a tentativa de tela cheia a partir do instantâneo.
- [ ] **CA-07** (ubíquo): O servidor DEVE aceitar `live:stage:fullscreen` do painel e da apresentação, exigir `enabled` booleano, descartar a de aluno, repassar sem eco, guardar o estado e incluí-lo em `stageView.fullscreen`.
- [ ] **CA-08** (ubíquo): Nada fora da sala ao vivo DEVE mudar; os testes existentes passam sem alteração; `engine/core` não é alterado.
- [ ] **CA-09** (ubíquo): Stylelint, ESLint, `tsc` e `go vet` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `handler` e `service`:** a mensagem do painel e da apresentação é aceita; `enabled` ausente ou não booleano é rejeitado; a de aluno é descartada; repassada à outra janela do professor e aos alunos sem eco; guardada e entregue em `stageView.fullscreen` nos instantâneos (aluno, painel, presenter) e em `/active`; não reinicia na troca de lâmina nem de módulo; some com a aula (CA-07, CA-06).
- **Frontend, professor:** o botão do painel e o da apresentação ligam e desligam, mostram o estado e enviam a mensagem; o estado vindo do servidor atualiza as duas janelas (CA-01).
- **Frontend, aluno:** ao receber `enabled: true`, entra em modo foco e chama `requestFullscreen`; com recusa, o próximo clique ou tecla entra em tela cheia (ouvinte de uso único) e o botão é destacado; ao sair da tela cheia não reentra sozinho; `enabled: false` sai da tela cheia e do modo foco; o instantâneo com o pedido ligado aplica tudo ao entrar (CA-02 a CA-06).
- **Regressão:** testes existentes da sala, do `TopicStudy` e das SPEC-055, 057 e 058 passam sem alteração (CA-08).
- **Manual:** professor liga o pedido; os alunos entram no modo foco na hora e em tela cheia ao primeiro clique; um aluno sai com Esc e o botão volta a pulsar; o professor desliga e todos voltam.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-055, SPEC-057, SPEC-058 e esta; `backend/internal/modules/classroom/**` (`handler/ws.go`, `service`, `domain`), `platform/hub`; `frontend/src/components/Classroom/**` (`TeacherPanel`, `PresenterStage`, `LiveClassroom`), `hooks/useLiveClassroom.ts`, `services/classroomService.ts`.
2. **Ordem de execução:** só depois das SPEC-057 e SPEC-058 implementadas. Testes vermelhos e commit `test`; backend (mensagem, estado, instantâneo); frontend (botão do professor, modo foco e tela cheia do aluno); mensagens.
3. **Arquivos a criar ou alterar:** `backend/internal/platform/hub/**` e `backend/internal/modules/classroom/**` (sem migração); `frontend/src/components/Classroom/**`, `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `messages/pt-BR.ts`. **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead confirmou em 14/10/2026 a solução em dois passos (modo foco imediato e tela cheia real no primeiro clique do aluno), diante da limitação do navegador.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; a solução em dois passos fica para a revisão dele |
| 14/10/2026 | Aruna Architect | O Tech Lead confirmou a solução em dois passos; pendências encerradas |
