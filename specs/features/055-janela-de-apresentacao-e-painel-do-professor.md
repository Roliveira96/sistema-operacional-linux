# SPEC-055: Janela de Apresentação e Painel do Professor na Aula ao Vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-055 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend); `frontend/src/components/Classroom/` |
| **Contexto de tela** | Painel do professor (`/app/classes/:classId/live`) e janela de apresentação (`/app/classes/:classId/live/present`) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051 (sala ao vivo), SPEC-054 (sala de espera e módulo da aula) |
| **Substitui** | Parcialmente a SPEC-054: a seção "Tela dividida" e os critérios CA-07 a CA-10 e CA-13, a chave "Transmitir o terminal" (`live:terminal:broadcast`) e a lâmina privada versus publicada. A sala de espera e o módulo sincronizado da SPEC-054 continuam valendo |
| **Fontes canônicas** | Relato do Tech Lead em 14/10/2026: a tela da turma não faz sentido; o que se digita não aparece em tempo real; querer "uma aba para apresentação (PowerPoint, tela gigante no projetor) e uma administrativa, com o tempo de aula, quantos alunos etc., porque alguns professores usam duas telas". Escolhas do mesmo dia: o professor interage na janela de apresentação; as janelas se falam pelo servidor; o painel tem tempo e alunos online, sala de espera e lista, mãos levantadas, e controle das lâminas e do modo |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-054 deu ao professor uma tela dividida: "Minha tela", privada, e "Tela da turma", uma prévia do que os alunos veem. Na prática:

- A prévia "Tela da turma" não tem utilidade para o professor.
- O que o professor digita no terminal não aparece para a turma em tempo real, porque o terminal só é transmitido quando uma chave, desligada por padrão, é ligada.
- O professor que usa **duas telas** (um monitor ou projetor para a turma e outro para si) não tem como separar o palco do controle da aula.

## 2. Objetivos (Goals)

- Duas janelas do professor, em qualquer tela ou computador: a **janela de apresentação**, o palco em tela cheia (modo PowerPoint, para o projetor), onde ele interage, e o **painel do professor**, administrativo.
- Tudo que o professor faz na janela de apresentação (lâmina, laser, caneta, digitação e comandos no terminal) chega aos alunos **na hora**, sem chave de transmitir.
- O painel mostra o tempo de aula, os alunos online, a sala de espera, as mãos levantadas e controla as lâminas, o modo e o módulo.

### 2.1. Fora de escopo (Non-Goals)

- Lâmina privada (preparar a próxima lâmina sem a turma ver), "Mostrar para a turma", "Seguir a turma", "Minha tela", "Tela da turma" e a chave "Transmitir o terminal": saem.
- Terminal no painel administrativo: o terminal fica só na janela de apresentação.
- Anotações do professor, bate-papo, e gravação da aula.
- Mais de uma janela de apresentação e mais de um painel ao mesmo tempo (a mais nova de cada tipo substitui a anterior).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Painel do professor (`/app/classes/:classId/live`, para o docente dono e o administrador).** Tela administrativa, sem o palco, com:

- **Cabeçalho:** o título da aula, o **tempo de aula** (cronômetro desde o início da aula, que continua enquanto a aula está ativa) e o botão **Encerrar aula**.
- **Resumo:** quantos alunos estão **na aula** (aceitos e conectados), quantos **esperam**, quantos **pediram a palavra** e o estado da janela de apresentação ("Conectada" ou "Fechada").
- **Janela de apresentação:** o botão **Abrir janela de apresentação**, que a abre em outra janela do navegador (para arrastar ao projetor ou ao segundo monitor). Se já está aberta, o botão a traz à frente.
- **Sala de espera e lista de alunos:** quem espera, com **Aceitar**, **Aceitar todos** e **Recusar**; e quem está na aula, com o nome e **Remover**.
- **Mãos levantadas:** a fila na ordem, com **Baixar** uma mão e **Baixar todas**.
- **Controle das lâminas e do modo:** o seletor **Apresentação ou Módulo**; no modo Apresentação, as miniaturas das lâminas, **Anterior**, **Próxima** e a escolha de uma lâmina; no modo Módulo, o seletor de módulo e a escolha do bloco em foco. Tudo vai à turma na hora.

**Janela de apresentação (`/app/classes/:classId/live/present`).** O palco, em tela cheia, sem menus nem painéis, no tema escuro:

- **Lâminas:** a lâmina atual, grande, com o laser e a caneta do professor; setas e barra de espaço trocam de lâmina; **Tela cheia** (a janela pede a tela cheia ao navegador e mostra a dica da tecla Esc).
- **Módulo:** o conteúdo do módulo e o terminal na máquina do módulo. **O professor digita no terminal da janela de apresentação e tudo vai aos alunos na hora**, a digitação, o comando e a saída, sem chave nem espera.
- Mostra apenas o palco; nenhum dado administrativo. Um indicador discreto avisa se a conexão caiu.

**Aluno.** A tela do estudante não muda (sala de espera, palco, mão levantada, anotações).

Botões do padrão `Button`, tema único escuro, só tokens, alvos de 44 px, teclado, textos no arquivo de mensagens.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (duas conexões do professor):** o docente dono (ou o administrador) conecta à sala com um **tipo de janela**: `panel` ou `presenter` (parâmetro da conexão; sem ele, vale `panel`). Pode haver **uma conexão de cada tipo ao mesmo tempo**. Uma conexão nova do mesmo tipo substitui a anterior, que recebe `live:control:revoked` e passa a modo passivo; as de tipos diferentes convivem e não se revogam.
- **RN-02 (quem envia o quê):** as mensagens do **palco**, ou seja, `live:cursor:move`, `live:canvas:draw`, `live:terminal:input` e `live:terminal:sync`, só valem da janela `presenter`. A troca de lâmina (`live:slide:change`), a troca de modo e de módulo (`live:mode:switch`) e o bloco em foco (`live:module:focus`) valem de **qualquer** das duas. A sala de espera e as mãos (`live:admission:*` e `live:hand:moderate`) valem só do `panel`. Mensagem fora dessa regra é descartada com registro de auditoria.
- **RN-03 (as duas janelas se acompanham):** o que uma janela do professor envia chega também à outra janela do professor e aos alunos aceitos, para o painel refletir a lâmina e o modo trocados na apresentação e vice-versa; quem enviou não recebe a própria mensagem de volta.
- **RN-04 (sem chave de transmissão):** o terminal do professor é sempre transmitido: o servidor guarda a digitação, os comandos e o estado e os entrega aos alunos e no instantâneo, sem depender de uma chave. Saem a mensagem `live:terminal:broadcast` e o campo `terminalBroadcast` do instantâneo.
- **RN-05 (instantâneo e presença):** o instantâneo do `panel` leva a sala de espera, a lista dos aceitos, a fila de mãos, o horário de início da aula e se a janela `presenter` está conectada; a presença muda (`live:presence`) quando uma janela do professor entra ou sai, informando também o estado da janela de apresentação. O instantâneo do `presenter` leva o palco, sem os dados administrativos.
- **RN-06 (encerramento e rede de segurança):** a aula só termina quando o docente a encerra (pelo painel) ou pela rede de segurança de 12 horas sem nenhuma janela do professor conectada (SPEC-051 RN-03); fechar uma das janelas não encerra a aula.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de esquema.

## 5. Contrato de API (API Contract)

WebSocket `GET /api/v1/classes/{id}/live/ws` (SPEC-051, seção 5.8; SPEC-054, seção 5):

- **Parâmetro novo da conexão:** `view`, com `panel` ou `presenter`, só para o docente dono e o administrador; valor inválido é recusado com 400; o estudante o ignora.
- **Mensagens que saem** (das SPEC-051 e 054): `live:terminal:broadcast` e o campo `terminalBroadcast` do instantâneo.
- **Mensagens do servidor, novas:** `live:presenter:state` (`{connected}`), enviada ao `panel` quando a janela de apresentação entra, sai ou é substituída.
- **Instantâneo do `panel`:** acrescenta `startedAt` (início da aula), `presenterConnected`, `admissions` e a fila de mãos (já previstas). **Instantâneo do `presenter`:** só o palco.
- **Descarte:** `live:cursor:move`, `live:canvas:draw`, `live:terminal:input` e `live:terminal:sync` vindos do `panel`, e `live:admission:*` e `live:hand:moderate` vindos do `presenter`, são descartados com auditoria.

Sem mudança nos endpoints REST.

## 6. Impacto e Riscos (Impact & Risks)

- **Aluno pode ficar sem palco se a janela de apresentação não estiver aberta.** Mitigação: o painel mostra "Janela de apresentação fechada" e o botão para abri-la; as lâminas trocadas no painel valem mesmo assim, mas laser, caneta e terminal só existem na apresentação.
- **Duas conexões do professor se revogarem sem querer** (o defeito que deixava o professor passivo). Mitigação: só a de mesmo tipo é revogada, e o cliente ignora o que chega de conexão já substituída (corrigido na implementação anterior).
- **Janela bloqueada pelo navegador ao abrir.** Mitigação: o painel abre a janela por um clique do professor (permitido pelo navegador) e mostra o endereço para abrir à mão, se for bloqueada.
- **Alteração de comportamento da SPEC-054 já implementada.** Mitigação: os testes antigos que dependiam da tela dividida e da chave são trocados na implementação, com a lista no relatório.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O painel do professor DEVE mostrar o tempo de aula (cronômetro desde o início), os alunos na aula, os que esperam, os que pediram a palavra e o estado da janela de apresentação.
- [ ] **CA-02** (evento): QUANDO o professor aciona "Abrir janela de apresentação", O SISTEMA DEVE abri-la em outra janela do navegador, e DEVE traze-la à frente se já estiver aberta.
- [ ] **CA-03** (ubíquo): O painel DEVE ter a sala de espera (Aceitar, Aceitar todos e Recusar), a lista dos alunos na aula com Remover, a fila de mãos (Baixar e Baixar todas) e o controle das lâminas e do modo (Apresentação ou Módulo, miniaturas, Anterior, Próxima, seletor de módulo, bloco em foco e Encerrar aula).
- [ ] **CA-04** (ubíquo): A janela de apresentação DEVE ocupar a tela com o palco, sem menus nem dados administrativos, com o botão Tela cheia, e as lâminas DEVEM mudar por setas e barra de espaço.
- [ ] **CA-05** (evento): QUANDO o professor usa o laser, a caneta, digita ou executa comandos na janela de apresentação, O SISTEMA DEVE mostrá-los aos alunos aceitos na hora, sem depender de chave de transmissão.
- [ ] **CA-06** (evento): QUANDO a lâmina, o modo ou o módulo é trocado em uma das janelas do professor, O SISTEMA DEVE refletir a troca na outra janela e nos alunos.
- [ ] **CA-07** (estado): ENQUANTO existem as duas janelas do professor, O SISTEMA NÃO DEVE revogar uma pela outra; uma nova do mesmo tipo DEVE substituir a anterior, que passa a modo passivo.
- [ ] **CA-08** (indesejado): SE o painel envia mensagens do palco (cursor, traços, digitação ou comandos), ou a janela de apresentação envia mensagens da sala de espera ou das mãos, ENTÃO O SISTEMA DEVE descartá-las com registro de auditoria.
- [ ] **CA-09** (evento): QUANDO a janela de apresentação entra, sai ou é substituída, O SISTEMA DEVE avisar o painel do novo estado.
- [ ] **CA-10** (evento): QUANDO o professor encerra a aula pelo painel, O SISTEMA DEVE encerrá-la para todos, inclusive a janela de apresentação; fechar só uma das janelas NÃO DEVE encerrar a aula.
- [ ] **CA-11** (ubíquo): A tela dividida, "Minha tela", "Tela da turma", a lâmina privada e a chave "Transmitir o terminal" NÃO DEVEM mais existir.
- [ ] **CA-12** (ubíquo): As duas janelas DEVEM usar o tema único escuro, só tokens, alvos de 44 px e navegação por teclado.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `platform/hub`:** `TestTwoTeacherViews_DoNotRevokeEachOther`, `TestNewViewOfTheSameKindReplacesTheOld` (CA-07); `TestTeacherMessagesReachTheOtherView` (CA-06); `TestStageMessagesOnlyFromThePresenter` e `TestAdminMessagesOnlyFromThePanel` (CA-08); `TestPresenterStateIsSentToThePanel` (CA-09).
- **Backend, `classroom/handler` e `service`:** a conexão com `view` (`panel`, `presenter`, ausente e inválido); o instantâneo de cada janela (CA-01, CA-09); o terminal sempre guardado e transmitido sem chave (CA-05); `live:terminal:broadcast` deixa de existir (CA-11); encerrar pelo painel encerra as duas janelas e fechar uma não encerra (CA-10).
- **Frontend:** `TeacherPanel` (tempo de aula, resumo e contagens, sala de espera, lista, mãos, miniaturas e troca de modo e módulo, Encerrar aula; CA-01, CA-03, CA-10); botão de abrir a janela de apresentação (CA-02); `PresenterStage` (palco sem menus, tela cheia, teclado, laser, caneta e terminal enviando na hora; CA-04, CA-05); as duas janelas refletindo a troca de lâmina e de modo (CA-06); a janela substituída em modo passivo (CA-07); ausência da tela dividida, da lâmina privada e da chave (CA-11); tema, alvos e teclado (CA-12).
- **Manual:** abrir o painel no monitor do professor e a apresentação no projetor; passar lâminas por uma e pela outra e ver as duas acompanharem; digitar no terminal da apresentação e ver o aluno acompanhar na hora; conferir o cronômetro e as contagens; fechar a janela de apresentação e ver o painel avisar.
- **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051, SPEC-054 e esta; `platform/hub`, `classroom/handler/ws.go`, `components/Classroom/*` (em especial `LiveClassroom`, `TeacherSplitView`, `SlidePresenter`, `MirroredModuleView`, `ModuleStage`), `hooks/useLiveClassroom.ts` e `app/app/classes/[id]/live/page.tsx`.
2. **Ordem de execução:** testes vermelhos e commit `test`; hub e handler (as duas visões, as regras de quem envia o quê, o terminal sempre transmitido, presença, instantâneos); frontend (painel, janela de apresentação, remoção da tela dividida e da chave); mensagens.
3. **Arquivos a criar ou alterar:** `backend/internal/platform/hub/**`; `backend/internal/modules/classroom/**`; `frontend/src/services/classroomService.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/**` (novos `TeacherPanel` e `PresenterStage`; sai `TeacherSplitView`; ajustes em `LiveClassroom`, `SlidePresenter`, `MirroredModuleView`, `ModuleStage`, `AdmissionPanel`, `LiveInteractionDrawer`); `frontend/src/app/app/classes/[id]/live/page.tsx` e `frontend/src/app/app/classes/[id]/live/present/page.tsx` (novo) com seus `.module.scss`; `frontend/src/messages/pt-BR.ts`; `specs/features/054-sala-de-espera-e-visao-do-professor.md` (nota de que a tela dividida foi substituída por esta spec).
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: o professor interage na janela de apresentação; as janelas se falam pelo servidor; o painel tem tempo e alunos online, sala de espera e lista, mãos levantadas e controle das lâminas e do modo. Assumidas por recomendação: uma janela de cada tipo por vez, laser e caneta só na apresentação, terminal só na apresentação e o painel sem anotações do professor.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao decidir a janela de apresentação e o painel do professor |
