# SPEC-057: Palco Padronizado (Mesma Tela para Professor e Alunos) e Rolagem da Lâmina

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-057 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead; a resolução fica para a revisão dele) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend); `frontend/src/components/Classroom/`, `frontend/src/components/TopicStudy/` (só o modo de aula ao vivo) |
| **Contexto de tela** | Janela de apresentação do professor e sala do aluno (lâminas e módulo) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051, SPEC-054, SPEC-055, SPEC-056 |
| **Fontes canônicas** | Pedidos do Tech Lead em 14/10/2026: "o PDF, se for grande, deve poder ter scroll" e "devemos padronizar a visualização para todos, professor e alunos verem a mesma tela, então devemos setar uma resolução perfeita para todos" |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje o palco ocupa o tamanho da janela de cada pessoa. O professor, no projetor, e cada aluno, no próprio notebook, veem larguras diferentes. Consequências:

- O texto do módulo quebra em linhas diferentes e as colunas do terminal mudam, então "a mesma tela" não é a mesma.
- O ponteiro e os traços só batem na lâmina, porque são percentuais da página; no módulo não há correspondência e o ponteiro nem é mostrado.
- Uma lâmina mais alta do que a janela é cortada: não há rolagem, e o que está embaixo não pode ser visto.

## 2. Objetivos (Goals)

- Um **palco de tamanho fixo e lógico** (**1920 × 1080**, proporção 16:9, a do projetor), desenhado do mesmo jeito para o professor e para todos os alunos, e **ajustado por escala** à janela de cada um, com faixas escuras nas sobras. Quem vê, vê a mesma coisa, só maior ou menor.
- **Rolagem** da lâmina que passa da altura do palco, controlada pelo professor e acompanhada pelos alunos.
- O ponteiro, a caneta, a rolagem do material e a divisória do módulo **correspondem** nas duas pontas.

### 2.1. Fora de escopo (Non-Goals)

- Telas de celular em pé (o palco 16:9 escalado fica pequeno; a sala continua usável, sem layout próprio para isso).
- Aluno rolar a lâmina por conta própria (o aluno é receptor estrito, como na SPEC-051).
- Mudar o painel do professor (`/live`) ou a tela de estudo comum (`/materials/:id`).
- Escolher outra resolução por turma.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Componente `FixedStage`** (em `components/Classroom/`): um contêiner de **1920 × 1080 px lógicos** com `transform: scale(s)`, `transform-origin: top left`, centrado na área disponível, onde `s = min(largura disponível / 1920, altura disponível / 1080)`. Mede a área com `ResizeObserver` e recalcula ao redimensionar, ao entrar e sair da tela cheia. As sobras ficam com a cor de fundo do tema (token). Tudo o que é do palco (lâmina, módulo, terminal, ponteiro, traços, tela preta) é desenhado **dentro** dele, em pixels lógicos; o resto da página (cabeçalho, barra de ferramentas, notas, avisos) fica **fora**.
- **Lâminas.** A página do PDF é desenhada com a largura do palco (1920) e alta o quanto for; uma página mais alta que 1080 **rola dentro do palco** (`overflow-y: auto` na área da lâmina). A barra de rolagem aparece só para o professor; para o aluno a área é rolada pelo professor. Traços e ponteiro continuam em **percentual da página inteira** (altura total, não só a parte visível), então batem mesmo com a rolagem. Mudar de lâmina volta a rolagem ao topo.
- **Módulo** (`TopicStudyLive`). O layout da tela de estudo é desenhado no palco fixo, igual para todos. A rolagem do **material** e a **posição da divisória** acompanham o professor. O **ponteiro** passa a ser mostrado também no módulo, em percentual do palco (0 a 100 em x e y), com o laser como destaque (como nas lâminas).
- **Envio.** A janela de apresentação envia `live:stage:scroll` (a cada 100 ms no máximo, só se mudou) quando o professor rola a lâmina ou o material, e `live:stage:split` quando solta ou arrasta a divisória. O aluno aplica os valores sem interpolar além da transição de 100 ms.
- **O professor vê o mesmo que o aluno.** A janela de apresentação usa o mesmo `FixedStage`; o professor vê o palco exatamente como os alunos.

### 3.2. Backend (Go — Camada de Módulo/Service)

- Duas mensagens novas do palco, só da janela `presenter`:
  - `live:stage:scroll` com `{"pane": "slide"|"material", "y": number}`, onde `y` é a posição de rolagem como fração de 0 a 1 do que se pode rolar.
  - `live:stage:split` com `{"ratio": number}`, a fração (0,2 a 0,8) da largura do palco que o material ocupa.
- O servidor valida os campos (`pane` conhecido, números finitos, faixas), guarda **o último valor de cada um** em memória como parte do estado do palco, repassa às outras conexões aceitas (painel e alunos, sem eco) e inclui no `live:snapshot` de todos: `stageView: {"slideScroll": number, "materialScroll": number, "split": number|null}` (rolagens 0 por padrão; `split` nulo = o padrão do layout).
- O servidor volta `slideScroll` a 0 ao trocar de lâmina, e `materialScroll` a 0 ao trocar de módulo.
- Mensagem fora do papel é descartada com auditoria (`wrong-view`), a inválida é rejeitada com log `classroom message rejected`.

## 4. Modelo de Dados (Data Model)

Nenhuma tabela e nenhuma migração: o estado de rolagem e divisória fica em memória, com o estado do palco.

## 5. Contrato de API (API Contract)

- **Cliente → servidor (só `presenter`):** `live:stage:scroll {"pane": "slide"|"material", "y": 0..1}`; `live:stage:split {"ratio": 0.2..0.8}`.
- **Servidor → clientes:** as mesmas mensagens, a todas as outras conexões; `live:snapshot` leva `stageView {slideScroll, materialScroll, split}`.
- **Mudança de significado:** `live:cursor:move` (`x`, `y` em 0 a 100) é **percentual da página inteira** no modo lâminas e **do palco** no modo módulo.

## 6. Impacto e Riscos (Impact & Risks)

- **Texto pequeno em telas pequenas.** O palco 1920 × 1080 num notebook de 1366 px de largura fica a 71%; num celular, bem menor. Mitigação: é o preço de todos verem o mesmo; a sala fica utilizável e o aluno pode usar o zoom do navegador ou a tela cheia. Layout próprio para celular é fora de escopo.
- **Conflito com a SPEC-056** (mesmos componentes e mesmo arquivo `ws.go`). Mitigação: esta spec só é implementada depois da SPEC-056.
- **Desfoque do texto escalado.** O `transform: scale` pode deixar a fonte levemente borrada em escalas quebradas. Mitigação: aceita; o terminal e o texto são vetoriais e a lâmina é desenhada em alta resolução.
- **Posição do mouse com escala.** As coordenadas do mouse precisam dividir pela escala. Mitigação: um único auxiliar (`toStagePoint`) usado por lâmina e módulo, com teste.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O palco DEVE ter 1920 × 1080 px lógicos para o professor e para todos os alunos, ajustado por escala à janela de cada um, centrado, com faixas escuras nas sobras e sem cortar nem deformar.
- [ ] **CA-02** (evento): QUANDO a janela muda de tamanho ou entra ou sai da tela cheia, O SISTEMA DEVE recalcular a escala sem recarregar a aula.
- [ ] **CA-03** (ubíquo): O texto do material e as colunas do terminal DEVEM quebrar do mesmo jeito para o professor e para os alunos, qualquer que seja o tamanho da janela de cada um.
- [ ] **CA-04** (estado): ENQUANTO a página da lâmina for mais alta que o palco, O SISTEMA DEVE permitir ao professor rolar a lâmina dentro do palco e DEVE mostrar a mesma posição aos alunos em até 300 ms.
- [ ] **CA-05** (evento): QUANDO o professor muda de lâmina, O SISTEMA DEVE voltar a rolagem ao topo para todos.
- [ ] **CA-06** (ubíquo): O ponteiro, o laser e os traços DEVEM cair no mesmo ponto da lâmina para o professor e para os alunos, mesmo com a lâmina rolada e com escalas diferentes.
- [ ] **CA-07** (estado): ENQUANTO o modo for Módulo, O SISTEMA DEVE mostrar aos alunos o ponteiro do professor (em percentual do palco), a rolagem do material e a posição da divisória.
- [ ] **CA-08** (evento): QUANDO um aluno entra ou reconecta, O SISTEMA DEVE mostrar a rolagem e a divisória atuais, sem esperar o professor mexer.
- [ ] **CA-09** (ubíquo): O servidor DEVE aceitar `live:stage:scroll` e `live:stage:split` só da janela de apresentação, validar os campos, repassar sem eco e incluir os valores no instantâneo.
- [ ] **CA-10** (ubíquo): O aluno NÃO DEVE conseguir rolar a lâmina nem mover a divisória por conta própria.
- [ ] **CA-11** (ubíquo): A tela de estudo comum (`/materials/:id`), o painel do professor e o resto do `TopicStudy` NÃO DEVEM mudar; os testes existentes passam sem alteração. `engine/core` não é alterado.
- [ ] **CA-12** (ubíquo): Stylelint, ESLint, `tsc` e `go vet` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `platform/hub` e `classroom`:** as duas mensagens só do `presenter`, validadas, repassadas sem eco, guardadas e entregues nos instantâneos (CA-08, CA-09); a rolagem da lâmina volta a 0 na troca de lâmina e a do material, na troca de módulo (CA-05).
- **Frontend, `FixedStage`:** escala de `min(L/1920, A/1080)`, centragem e faixas; recálculo no redimensionamento (CA-01, CA-02); `toStagePoint` divide pela escala e soma a rolagem (CA-06).
- **Frontend, lâmina:** rolagem dentro do palco quando a página é alta; o professor envia `live:stage:scroll` limitado a 100 ms; o aluno aplica a posição e não rola sozinho (CA-04, CA-10); traços e ponteiro em percentual da página inteira (CA-06); a troca de lâmina volta ao topo (CA-05).
- **Frontend, módulo:** o ponteiro aparece no módulo; a rolagem do material e a divisória seguem o professor e o aluno não as move; o instantâneo as restaura (CA-07, CA-08, CA-10).
- **Regressão:** os testes existentes do `TopicStudy`, de `/materials/:id` e do painel passam sem alteração (CA-11).
- **Manual:** professor no projetor e dois alunos com janelas de tamanhos muito diferentes: o texto quebra igual, o ponteiro e a caneta caem no mesmo lugar, uma lâmina alta rola nas três telas.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051, SPEC-054, SPEC-055, SPEC-056 e esta; `components/Classroom/*` (`SlidePresenter`, `PresenterStage`, `LiveClassroom`, `ModuleStage`), `components/TopicStudy/LiveTopicScreen.tsx`, `hooks/useLiveClassroom.ts`; `backend/internal/modules/classroom/handler/ws.go`, `service`, `platform/hub`.
2. **Ordem de execução:** só depois da SPEC-056 implementada. Testes vermelhos e commit `test`; backend (mensagens, guarda, instantâneo, reinício nas trocas); frontend (`FixedStage`, lâmina, módulo, envio, mensagens, glossário).
3. **Arquivos a criar ou alterar:** `backend/internal/platform/hub/**`, `backend/internal/modules/classroom/**`; `frontend/src/components/Classroom/**`, `components/TopicStudy/LiveTopicScreen.tsx` (só o necessário), `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `messages/pt-BR.ts`; `specs/GLOSSARY.md` (Palco). **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu o palco igual para todos e a rolagem; a escolha de **1920 × 1080 com escala para caber**, e não uma resolução por dispositivo, é da Aruna e deve ser revisada. Alternativa descartada: tamanho fluido com regras de quebra iguais (não garante a mesma tela). Fica aberto, para depois: layout próprio para celular.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; a resolução fica para a revisão dele |
