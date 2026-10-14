# SPEC-057: Palco Padronizado (Mesma Tela para Professor e Alunos) e Rolagem da Lâmina

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-057 |
| **Status** | Implementada |
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

- Um **palco de tamanho fixo e lógico** (**1280 × 720**, proporção 16:9, a do projetor), desenhado do mesmo jeito para o professor e para todos os alunos, e **ajustado por escala** à janela de cada um, com faixas escuras nas sobras. Quem vê, vê a mesma coisa, só maior ou menor.
- **Rolagem** da lâmina que passa da altura do palco, controlada pelo professor e acompanhada pelos alunos.
- O ponteiro, a caneta, a rolagem do material e a divisória do módulo **correspondem** nas duas pontas.
- **Zoom do professor:** o professor aumenta ou diminui o tamanho do conteúdo no palco e **todos os alunos veem o mesmo zoom**, para o texto ficar legível em qualquer tela.

### 2.1. Fora de escopo (Non-Goals)

- Telas de celular em pé (o palco 16:9 escalado fica pequeno; a sala continua usável, sem layout próprio para isso).
- Aluno rolar a lâmina por conta própria (o aluno é receptor estrito, como na SPEC-051).
- Mudar o painel do professor (`/live`) ou a tela de estudo comum (`/materials/:id`).
- Escolher outra resolução por turma.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Componente `FixedStage`** (em `components/Classroom/`): um contêiner de **1280 × 720 px lógicos** com `transform: scale(s)`, `transform-origin: top left`, centrado na área disponível, onde `s = min(largura disponível / 1280, altura disponível / 720)`. Mede a área com `ResizeObserver` e recalcula ao redimensionar, ao entrar e sair da tela cheia. As sobras ficam com a cor de fundo do tema (token). Tudo o que é do palco (lâmina, módulo, terminal, ponteiro, traços, tela preta) é desenhado **dentro** dele, em pixels lógicos; o resto da página (cabeçalho, barra de ferramentas, notas, avisos) fica **fora**.
- **Lâminas.** A página do PDF é desenhada com a largura do palco (1280) e alta o quanto for; uma página mais alta que 720 **rola dentro do palco** (`overflow-y: auto` na área da lâmina). A barra de rolagem aparece só para o professor; para o aluno a área é rolada pelo professor. Traços e ponteiro continuam em **percentual da página inteira** (altura total, não só a parte visível), então batem mesmo com a rolagem. Mudar de lâmina volta a rolagem ao topo.
- **Módulo** (`TopicStudyLive`). O layout da tela de estudo é desenhado no palco fixo, igual para todos. A rolagem do **material** e a **posição da divisória** acompanham o professor. O **ponteiro** passa a ser mostrado também no módulo, em percentual do palco (0 a 100 em x e y), com o laser como destaque (como nas lâminas).
- **Envio.** A janela de apresentação envia `live:stage:scroll` (a cada 100 ms no máximo, só se mudou) quando o professor rola a lâmina ou o material, e `live:stage:split` quando solta ou arrasta a divisória. O aluno aplica os valores sem interpolar além da transição de 100 ms.
- **Palco do aluno o maior possível, no estilo do Google Meet.** Na sala do aluno não há cabeçalho nem margens: o palco ocupa **toda a janela**, menos uma **faixa de controles fixa embaixo** (uns 56 px, que **nunca cobre** o material). A faixa leva, à esquerda, o título, o tempo e quantos estão online; ao centro, os botões **Levantar a mão** (com o estado "mão levantada" visível), **Anotações** e **Tela cheia** (também a tecla F); à direita, **Sair**. As **anotações abrem numa coluna ao lado** (uns 320 px), e o palco **se reajusta** ao espaço que sobra, sem ficar coberto; fechadas, o palco volta a ocupar tudo. Nenhum painel, menu ou aviso fica por cima do palco (só a tela preta do professor e o aviso de "aguardando" cobrem, por serem o próprio palco). A escala é a maior que cabe, sem cortar nada.
- **Janela de apresentação do professor sem espaço perdido.** O palco ocupa a janela inteira, sem margens nem faixas; a barra de ferramentas do professor (SPEC-055) aparece ao mover o mouse e some sozinha. O painel (`/live`) continua sendo a tela de controle.
- **Zoom do professor.** A janela de apresentação ganha os botões **Aumentar** e **Diminuir** (e as teclas `+`, `-` e `0` para voltar a 100%) com o valor atual (por exemplo "125%"). Os níveis são 100%, 125%, 150%, 175% e 200%. O zoom `z` vale para o módulo e para as lâminas e funciona assim: o **tamanho lógico do palco** passa a ser `(1280 / z) × (720 / z)`, desenhado e escalado à janela como sempre, e por isso o texto do material e do terminal fica `z` vezes maior e quebra de novo no espaço menor (o módulo e o terminal se reorganizam); a **página da lâmina continua sendo desenhada com a largura-base de 1280** e, como o palco ficou menor, ela fica `z` vezes maior na tela e **rola nos dois sentidos** (a rolagem horizontal também acompanha o professor). O zoom vale até o fim da aula e não volta sozinho a 100% ao trocar de lâmina ou de módulo. O aluno só **acompanha** o zoom: não tem controle próprio, e o zoom do navegador dele não muda o tamanho do conteúdo no palco (a escala sempre ajusta o palco à janela).
- **O professor não vê o ponteiro desenhado.** O ponto que representa o mouse (o ponteiro simples) aparece **só para os alunos**; na tela do professor aparece apenas o mouse dele. O laser (o destaque vermelho) continua visível também para o professor, para ele saber que está ligado, e a traços da caneta também.
- **Seleção de texto do professor.** O texto que o professor seleciona no **material** e no **terminal** aparece **marcado** para os alunos, no mesmo trecho. O professor envia a seleção com `live:stage:selection` (no máximo 10 por segundo, e a final ao soltar o mouse; desmarcar envia `{"clear": true}`). O trecho é descrito sem depender do desenho da tela: no material, pelo **bloco** (`data-block`) e pelo deslocamento em caracteres dentro do texto do bloco; no terminal, pelo número do terminal e pelos deslocamentos em caracteres sobre o texto da última tela enviada (`live:terminal:screen`). O aluno marca o trecho com a **API de realce do navegador** (`CSS.highlights`) ou, se não houver, com um marcador equivalente que não altere o texto; reaplica depois de cada nova tela do terminal; e nunca fica com seleção própria (o conteúdo é `inert`). A seleção some para todos quando o professor desmarca, troca o módulo ou encerra a aula.
- **Rolagem do histórico do terminal.** Quando o professor rola a tela de um terminal para cima (para mostrar uma saída antiga), o aluno vê **a mesma posição**. A janela de apresentação envia `live:stage:scroll` com `pane: "terminal"` e o número do terminal (`terminal`, de 1 a 3), com `y` como fração (0 a 1) da rolagem possível daquela tela; o aluno aplica a posição na tela do terminal da cópia. Enquanto o professor estiver **no fim** da tela (`y = 1`), o aluno também fica no fim e acompanha a saída nova; ao voltar ao fim, o aluno volta a acompanhar.
- **Desenho idêntico dentro do palco.** O que está dentro do palco é **exatamente igual** para o professor e para o aluno: o aluno **não tem** aviso, rótulo ou faixa que o professor não tenha. Em particular, **sai** o aviso "Você acompanha o terminal do professor. O teclado fica travado." (SPEC-056) acima do terminal do aluno, porque ele desloca o conteúdo e faz o ponteiro cair fora do lugar. O terminal do aluno continua somente leitura (`inert`, sem teclado) sem dizer isso na tela. O que for só do aluno (carregando, reconectando, sala encerrada) fica **fora** do palco, na faixa de controles, ou ocupa o palco inteiro no lugar do conteúdo.
- **O professor vê o mesmo que o aluno.** A janela de apresentação usa o mesmo `FixedStage`; o professor vê o palco exatamente como os alunos.

### 3.2. Backend (Go — Camada de Módulo/Service)

- Duas mensagens novas do palco, só da janela `presenter`:
  - `live:stage:scroll` com `{"pane": "slide"|"material"|"terminal", "y": number}`, onde `y` é a posição de rolagem como fração de 0 a 1 do que se pode rolar; com `pane: "terminal"` leva também `terminal` (inteiro de 1 a 3, obrigatório; nos outros `pane` é rejeitado) e o servidor guarda uma posição por terminal (`stageView.terminalScroll`, um objeto de `"1"` a `"3"` para `y`, vazio por padrão).
  - `live:stage:split` com `{"ratio": number}`, a fração (0,2 a 0,8) da largura do palco que o material ocupa.
- O servidor valida os campos (`pane` conhecido, números finitos, faixas), guarda **o último valor de cada um** em memória como parte do estado do palco, repassa às outras conexões aceitas (painel e alunos, sem eco) e inclui no `live:snapshot` de todos: `stageView: {"slideScroll": number, "materialScroll": number, "split": number|null}` (rolagens 0 por padrão; `split` nulo = o padrão do layout).
- Mais uma mensagem do palco, só do `presenter`: `live:stage:zoom` com `{"zoom": number}` finito de 1 a 2 (inclusive). Guardada em memória (1 por padrão), repassada sem eco, com Coalesce e sem `Limited`, e levada pelo instantâneo em `stageView.zoom`. Não é reiniciada por troca de lâmina ou de módulo.
- A rolagem da lâmina ganha o eixo horizontal: `live:stage:scroll` com `pane: "slide"` aceita também `x` (fração de 0 a 1), opcional (ausente = 0); o instantâneo leva `stageView.slideScrollX`. Trocar de lâmina volta `slideScroll` e `slideScrollX` a 0.
- Mais uma mensagem do palco, só do `presenter`: `live:stage:selection` com `{"clear": true}` ou `{"pane": "material", "start": {"block": string, "offset": int}, "end": {"block": string, "offset": int}}` ou `{"pane": "terminal", "terminal": int, "start": int, "end": int}` (`block` de até 128 caracteres, números inteiros de 0 a 1.000.000, `terminal` de 1 a 3, `start` e `end` do terminal com `start` menor ou igual a `end`). Guardada em memória (a última seleção, ou nenhuma), repassada sem eco, MaxBytes de 1 KiB, Coalesce, sem `Limited`, levada pelo instantâneo em `stageView.selection` (nulo = sem seleção) e **apagada** quando o módulo da aula troca. Não interpreta o que é um bloco.
- O servidor volta `slideScroll` a 0 ao trocar de lâmina, e `materialScroll` a 0 ao trocar de módulo.
- Mensagem fora do papel é descartada com auditoria (`wrong-view`), a inválida é rejeitada com log `classroom message rejected`.

## 4. Modelo de Dados (Data Model)

Nenhuma tabela e nenhuma migração: o estado de rolagem e divisória fica em memória, com o estado do palco.

## 5. Contrato de API (API Contract)

- **Cliente → servidor (só `presenter`):** `live:stage:scroll {"pane": "slide"|"material", "y": 0..1}`; `live:stage:split {"ratio": 0.2..0.8}`.
- **Seleção:** `live:stage:selection` no formato da seção 3.2, só `presenter`; o instantâneo leva `stageView.selection`.
- **Cliente → servidor (só `presenter`), acréscimos:** `live:stage:zoom {"zoom": 1..2}`; `live:stage:scroll` com `pane: "slide"` aceita `x` (0..1, opcional).
- **Servidor → clientes:** as mesmas mensagens, a todas as outras conexões; `live:snapshot` leva `stageView {slideScroll, slideScrollX, materialScroll, split, zoom, selection}`.
- **Mudança de significado:** `live:cursor:move` (`x`, `y` em 0 a 100) é **percentual da página inteira** no modo lâminas e **do palco** no modo módulo.

## 6. Impacto e Riscos (Impact & Risks)

- **Texto pequeno em telas pequenas.** Por isso o palco é de **1280 × 720** e não de 1920 × 1080: num notebook de 1366 px de largura a escala é de cerca de 107%, e o texto fica nítido e grande (com 1920 ficaria a 71%, pequeno demais para ler); num projetor Full HD, 150%. Em celular em pé o palco ainda fica pequeno (fora de escopo).
- **Conflito com a SPEC-056** (mesmos componentes e mesmo arquivo `ws.go`). Mitigação: esta spec só é implementada depois da SPEC-056.
- **Desfoque do texto escalado.** O `transform: scale` pode deixar a fonte levemente borrada em escalas quebradas. Mitigação: aceita; o terminal e o texto são vetoriais e a lâmina é desenhada em alta resolução.
- **Posição do mouse com escala.** As coordenadas do mouse precisam dividir pela escala. Mitigação: um único auxiliar (`toStagePoint`) usado por lâmina e módulo, com teste.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O palco DEVE ter 1280 × 720 px lógicos para o professor e para todos os alunos, ajustado por escala à janela de cada um, centrado, com faixas escuras nas sobras e sem cortar nem deformar.
- [ ] **CA-02** (evento): QUANDO a janela muda de tamanho ou entra ou sai da tela cheia, O SISTEMA DEVE recalcular a escala sem recarregar a aula.
- [ ] **CA-03** (ubíquo): O texto do material e as colunas do terminal DEVEM quebrar do mesmo jeito para o professor e para os alunos, qualquer que seja o tamanho da janela de cada um.
- [ ] **CA-04** (estado): ENQUANTO a página da lâmina for mais alta que o palco, O SISTEMA DEVE permitir ao professor rolar a lâmina dentro do palco e DEVE mostrar a mesma posição aos alunos em até 300 ms.
- [ ] **CA-05** (evento): QUANDO o professor muda de lâmina, O SISTEMA DEVE voltar a rolagem ao topo para todos.
- [ ] **CA-06** (ubíquo): O ponteiro, o laser e os traços DEVEM cair no mesmo ponto da lâmina para o professor e para os alunos, mesmo com a lâmina rolada e com escalas diferentes.
- [ ] **CA-07** (estado): ENQUANTO o modo for Módulo, O SISTEMA DEVE mostrar aos alunos o ponteiro do professor (em percentual do palco), a rolagem do material e a posição da divisória.
- [ ] **CA-08** (evento): QUANDO um aluno entra ou reconecta, O SISTEMA DEVE mostrar a rolagem e a divisória atuais, sem esperar o professor mexer.
- [ ] **CA-09** (ubíquo): O servidor DEVE aceitar `live:stage:scroll` (com `x` opcional), `live:stage:split`, `live:stage:zoom` e `live:stage:selection` só da janela de apresentação, validar os campos, repassar sem eco e incluir os valores no instantâneo.
- [ ] **CA-10** (ubíquo): O aluno NÃO DEVE conseguir rolar a lâmina nem mover a divisória por conta própria.
- [ ] **CA-11** (ubíquo): A tela de estudo comum (`/materials/:id`), o painel do professor e o resto do `TopicStudy` NÃO DEVEM mudar; os testes existentes passam sem alteração. `engine/core` não é alterado.
- [ ] **CA-13** (ubíquo): Na sala do aluno, o palco DEVE ocupar toda a janela, menos uma faixa de controles fixa embaixo; os botões de levantar a mão, anotações, tela cheia e sair DEVEM ficar nessa faixa; as anotações DEVEM abrir numa coluna ao lado que reajusta o palco; e NENHUM painel, menu ou aviso DEVE ficar por cima do palco.
- [ ] **CA-14** (ubíquo): Na janela de apresentação do professor, o palco DEVE ocupar a janela inteira, sem margens nem faixas fixas, com a barra de ferramentas aparecendo só ao mover o mouse.
- [ ] **CA-15** (evento): QUANDO o professor aciona Aumentar, Diminuir ou as teclas `+`, `-` e `0`, O SISTEMA DEVE mudar o zoom entre 100% e 200%, nos níveis combinados, e DEVE mostrar o mesmo zoom aos alunos em até 300 ms, no módulo e nas lâminas.
- [ ] **CA-16** (ubíquo): Com zoom maior que 100%, o texto do material e do terminal DEVE ficar maior e se reorganizar no espaço menor do palco, igual para o professor e os alunos, sem cortar nada.
- [ ] **CA-17** (estado): ENQUANTO o zoom for maior que 100% no modo lâminas, a página DEVE rolar nos dois sentidos, e as duas rolagens do professor DEVEM aparecer aos alunos.
- [ ] **CA-18** (evento): QUANDO um aluno entra ou reconecta, O SISTEMA DEVE aplicar o zoom atual (e a rolagem horizontal) do instantâneo; o aluno NÃO DEVE ter controle de zoom, e o zoom do navegador dele NÃO DEVE mudar o tamanho do conteúdo no palco.
- [ ] **CA-19** (ubíquo): Na tela do professor NÃO DEVE aparecer o ponteiro simples desenhado (só o mouse dele); o ponteiro aparece aos alunos, e o laser e os traços da caneta aparecem aos dois.
- [ ] **CA-20** (evento): QUANDO o professor seleciona texto no material ou no terminal, O SISTEMA DEVE marcar o mesmo trecho aos alunos em até 300 ms, e DEVE tirar a marca quando ele desmarca, troca o módulo ou encerra a aula.
- [ ] **CA-21** (evento): QUANDO um aluno entra ou reconecta com uma seleção ativa, O SISTEMA DEVE mostrar a marca; e a marca DEVE seguir o texto depois de uma nova tela do terminal; o aluno NÃO DEVE ter seleção própria nem poder apagar a marca.
- [ ] **CA-22** (ubíquo): Dentro do palco, a tela do aluno NÃO DEVE ter nenhum elemento que a do professor não tenha (inclusive o aviso de terminal somente leitura, que DEVE ser removido), de modo que o conteúdo e o ponteiro do professor caiam no mesmo ponto para os dois.
- [ ] **CA-23** (estado): ENQUANTO o professor rola a tela de um terminal para longe do fim, O SISTEMA DEVE mostrar aos alunos a mesma posição daquele terminal em até 300 ms, e DEVE voltar a acompanhar o fim quando o professor voltar ao fim; quem entra ou reconecta DEVE ver a posição atual de cada terminal.
- [ ] **CA-12** (ubíquo): Stylelint, ESLint, `tsc` e `go vet` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `platform/hub` e `classroom`:** as duas mensagens só do `presenter`, validadas, repassadas sem eco, guardadas e entregues nos instantâneos (CA-08, CA-09); a rolagem da lâmina volta a 0 na troca de lâmina e a do material, na troca de módulo (CA-05).
- **Frontend, `FixedStage`:** escala de `min(L/1280, A/720)`, centragem e faixas; recálculo no redimensionamento (CA-01, CA-02); `toStagePoint` divide pela escala e soma a rolagem (CA-06).
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

O Tech Lead pediu o palco igual para todos e a rolagem; a escolha de **1280 × 720 com escala para caber** (e não 1920 × 1080, que deixa o texto pequeno demais no notebook do aluno), e não uma resolução por dispositivo, é da Aruna e deve ser revisada. Alternativa descartada: tamanho fluido com regras de quebra iguais (não garante a mesma tela). Fica aberto, para depois: layout próprio para celular.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; a resolução fica para a revisão dele |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: a tela do aluno deve ser maior, com o scroll do professor refletido e nada cortado. Acrescentados o palco do aluno ocupando a área toda, com anotações em gaveta e tela cheia, e o CA-13 |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead ("como o Meet"): o menu de levantar a mão não pode ficar em cima do material, e a visualização do aluno e do professor deve aproveitar o espaço. CA-13 corrigido (faixa de controles fixa embaixo, anotações em coluna lateral que reajusta o palco, nada por cima) e CA-14 novo (palco do professor na janela inteira) |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: a tela do aluno fica pequena demais para ler. Palco trocado de 1920 × 1080 para 1280 × 720 (mesma proporção, texto cerca de 1,5 vez maior na tela do aluno); a largura e a altura ficam em uma constante só |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: os alunos reclamam do tamanho do texto; o professor aumenta o tamanho da tela dele e o zoom reflete para os alunos. Acrescentados o zoom do professor (níveis de 100% a 200%, tamanho lógico do palco dividido pelo zoom), `live:stage:zoom`, o eixo horizontal da rolagem da lâmina e os CA-15 a CA-18 |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: o professor não precisa ver a bolinha (só o mouse dele), e o texto selecionado pelo professor deve aparecer selecionado ao aluno. Acrescentados o ponteiro só para os alunos, a seleção de texto (`live:stage:selection`, `stageView.selection`) e os CA-19 a CA-21 |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: o aviso "Você acompanha o terminal do professor. O teclado fica travado." desloca o conteúdo do aluno e o ponteiro cai fora do lugar. Acrescentados o desenho idêntico dentro do palco, a remoção do aviso (que a SPEC-056 mandava mostrar) e o CA-22 |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: o scroll do professor tem de aparecer ao aluno. O do material já estava coberto (CA-07); acrescentada a rolagem do histórico do terminal (`pane: "terminal"`, `stageView.terminalScroll`) e o CA-23 |
| 14/10/2026 | Aruna Architect | Implementada e aprovada no teste manual do Tech Lead ("ficou muito bom"). Commits: backend `eb51ba1`, `92d22ae`, `57459cd`, `37aafbd`, `babfdd2`, `3655134`, `a2492d3`, `b6f3db6`; frontend `4983db9`, `cc5d294`, `a86b703` (e os `test` correspondentes). Desvios: o `Coalesce` do hub ganhou chave de fusão por regra (`CoalesceKey`); a rolagem dos terminais também zera na troca de módulo; as anotações abrem fechadas por padrão; a sala do aluno é `fixed` sobre o `AppShell` |
