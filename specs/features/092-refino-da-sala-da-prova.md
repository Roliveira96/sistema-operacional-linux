# SPEC-092: Refino de UX/UI da Sala da Prova e Relógio para a Turma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-092 |
| **Status** | Aprovada |
| **Data de criação** | 03/11/2026 |
| **Última revisão** | 04/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos (a revisão 2 acrescenta uma mensagem ao websocket da sala) |
| **Módulo** | `assessment` (frontend: o componente `ExamRoom` da rota `/app/classes/[id]/assessments/[assessmentId]/room` e a rota nova `.../room/clock`, o relógio para a turma) |
| **Contexto de tela** | A sala da prova da docente (SPEC-091, seção 3.1) e o relógio para a turma, numa aba própria, para projetar |
| **Prioridade** | Alta |
| **Depende de** | SPEC-091 (a sala da prova); SPEC-063 (os cartões da aula ao vivo, padrão visual reaproveitado) |
| **Substitui** | Na SPEC-091, seção 3.1: a ordem dos cartões ("ordenados pelo nome"), o filtro por lista de seleção e a disposição do painel lateral; e, em parte, o item *telão* do fora de escopo da SPEC-091 (só o relógio e as mãos levantadas, seção 3.1). O resto da SPEC-091 continua valendo |
| **Fontes canônicas** | Pedido do Tech Lead de 03/11/2026: "essa tela precisa melhorar o UXUI" (a sala da prova); pedido do Tech Lead de 03/11/2026, na aprovação: "eu tenho que ter em uma outra aba o contador de tempo da prova, e se alguém levanta a mão mostre nessa tela, que ficará visível para a sala toda"; prints da sala no computador (1440 px) e no celular (390 px) de 03/11/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

A sala da prova funciona, mas não ajuda a docente a achar rápido quem precisa dela. Os prints de 03/11/2026 mostram:

1. **Os cartões são iguais:** a situação é só uma palavra cinza, sem cor nem ícone, e não há o ponto de conexão nem a barra de progresso. Os ausentes ocupam a grade inteira e escondem quem está fazendo a prova ou pediu ajuda.
2. **Contadores e filtro repetidos:** os contadores são texto solto no cabeçalho, e o filtro é uma lista de seleção nativa, branca e fora do tema escuro, que repete as mesmas situações.
3. **O painel lateral confunde:** a fila de ajuda vazia ocupa o topo. Ao abrir um aluno ausente aparece um bloco roxo grande escrito "O aluno está numa questão sem terminal.", o que é falso, porque ele nem entrou. Sem aluno aberto, a coluna fica vazia, sem dizer que dá para clicar num cartão.
4. **O tempo não tem rótulo:** "04:39:49" aparece sozinho, sem dizer que é o tempo até o término.
5. **No celular**, o cabeçalho ocupa um quarto da tela, e o aluno aberto aparece depois dos 10 cartões, fora da vista.

## 2. Objetivos (Goals)

- **Quem precisa de atenção primeiro:** a mão levantada e quem está fazendo aparecem antes de quem já entregou ou está ausente.
- **Situação legível de relance:** cor, ícone e texto juntos, nunca só cor.
- **Um único controle de filtro:** os contadores viram o filtro.
- **Painel do aluno honesto:** mostra o que existe para aquela situação.
- Ficar no padrão visual do painel da aula ao vivo (SPEC-063).
- **Relógio para a turma:** uma aba própria, para projetar, com o tempo da prova em tamanho grande e o aviso de quem levantou a mão.

### 2.1. Fora de escopo (Non-Goals)

- Qualquer mudança no backend, nas mensagens do websocket ou no que o aluno vê.
- Funções novas: chat, assumir o terminal e ações em lote. Do telão, só o relógio e as mãos (seção 3.1); nada da tela de um aluno vai para a projeção.
- A dúvida escrita do aluno na projeção: ela é só da docente.
- Mudar o diálogo de início e o de encerramento (só herdam o estilo de sempre).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema escuro, tokens semânticos, textos em `messages/pt-BR.ts`, teclado, contraste AA e alvos de 44 px, como na SPEC-091.

**Cabeçalho, em uma faixa:**

- À esquerda: "Sala da prova", o título e "Prova iniciada às HH:MM por <nome>."
- À direita: o bloco do tempo, com o rótulo **"Termina em"**, o tempo grande (`HH:MM:SS`) e a hora do término embaixo ("às 23:30"). Nos últimos 10 minutos o bloco fica em aviso (cor de aviso e texto igual).
- O aviso **Reconectando…** vira uma pílula de aviso ao lado do título, visível só quando a conexão cai.
- O botão **Iniciar a prova** continua igual, antes do início.

**Contadores que filtram** (substituem a lista de seleção):

- Uma linha de pílulas, cada uma um botão com `aria-pressed`: **Todos (10)**, **Mãos levantadas (n)**, **Na sala de espera (n)**, **Fazendo (n)**, **Entregues (n)** e **Ausentes (n)**.
- Clicar filtra a grade; clicar na pílula ativa volta para *Todos*.
- **Mãos levantadas** fica em destaque de aviso quando `n > 0`.
- Com o filtro vazio, a grade diz "Nenhum aluno nesta situação."

**Cartões:**

- **Ordem:** mão levantada primeiro (a mais antiga antes); depois fazendo, na sala de espera, entregues e ausentes; dentro de cada grupo, pelo nome.
- **Topo:** o nome e, à direita, uma pílula de situação com ícone, cor e texto:

  | Situação | Cor |
  | :--- | :--- |
  | Fazendo | acento |
  | Na sala de espera | informação |
  | Entregue | sucesso |
  | Tempo esgotado | neutro |
  | Encerrada pela docente | perigo |
  | Ausente | neutro |

- **Abaixo do topo:** o RA e o ponto de conexão: verde *online*, ou cinza com "sem conexão" para quem está fazendo e caiu.
- **Quem está fazendo:** uma barra de progresso (respondidas / total, com `role="progressbar"`), o texto "4 de 9 respondidas · 2 práticas resolvidas" e o tempo dele.
- **Mão levantada:** borda de aviso, a pílula "Mão levantada" e a dúvida em até 2 linhas, como na aula ao vivo.
- **Cartão aberto:** borda e fundo de acento, como na SPEC-063.
- **Ausentes:** com opacidade reduzida e sem a linha do progresso, para pesarem menos.

**Painel lateral** (computador, `>= 64rem`, fixo na altura da janela):

- **Ordem:** o aluno aberto vem primeiro e a fila de ajuda embaixo.
- **Fila de ajuda vazia:** vira uma linha só, "Pedidos de ajuda: nenhum", sem caixa grande.
- **Fila com pedidos:** cada pedido mostra "há N min", e o campo de resposta e o botão **Atendido** ficam lado a lado no computador. Clicar no nome do pedido abre aquele aluno.
- **Sem aluno aberto:** uma dica, "Clique num aluno para ver a tela e os comandos dele."

**O aluno aberto:**

- **Cabeçalho:** o nome, a pílula de situação e o botão **Fechar**.
- **Lugar do terminal**, conforme a situação:
  - *Fazendo*, em questão prática: o terminal ao vivo, com a linha "Questão N: <título>" acima.
  - *Fazendo*, em questão sem terminal: uma caixa baixa, neutra (não roxa), com "O aluno está numa questão sem terminal."
  - *Ausente* ou *Na sala de espera*: "O aluno ainda não entrou na prova.", sem caixa de terminal.
  - *Entregue*, *Tempo esgotado* ou *Encerrada*: "A prova deste aluno terminou." e, se houver, o motivo do encerramento.
- **Comandos:** cada linha em fonte monoespaçada, como um registro de terminal: `14:52 · Q4  $ mkdir /a`, com a saída resumida em tom secundário. A lista rola sozinha e o mais novo fica em cima.
- **Encerrar a prova deste aluno:** fica no rodapé do painel, separado por uma linha, com o estilo de perigo de sempre.

**Celular** (`< 64rem`):

- **Cabeçalho compacto:** o título e o tempo na mesma linha, e as pílulas numa linha que rola na horizontal.
- **Aluno aberto:** ocupa a tela inteira, por cima da grade, com o botão **Voltar aos alunos**.
- **Fila de ajuda com pedidos:** aparece acima da grade.

**Relógio para a turma** (rota `.../room/clock`, aba própria, docente dona e administrador; o estudante volta para a avaliação):

- **Abrir:** no cabeçalho da sala, o botão secundário **Abrir o relógio para a turma** abre o relógio numa aba nova, para a docente arrastar para o projetor.
- **Tela:** fundo escuro, tela inteira, letras grandes, legível do fundo da sala:
  - o título da prova;
  - o rótulo "Termina em" e o tempo `HH:MM:SS` gigante, pelo relógio do servidor;
  - a hora do término ("às 23:30").
- **Situações:**
  - Antes do início: "A prova ainda não começou.", sem o tempo.
  - Nos últimos 10 minutos: o tempo em cor de aviso.
  - Depois do término: "Tempo esgotado."
- **Mão levantada:** com pedidos de ajuda abertos, uma faixa de aviso grande: "Mão levantada: Ana, Bruno". São só os nomes, do pedido mais antigo para o mais novo, e nunca a dúvida. A faixa some quando a fila esvazia.
- **De onde vêm os dados:**
  - O título e os horários vêm da API da avaliação.
  - O início, a fila de mãos e o relógio do servidor vêm da **aba da sala**, pelo `BroadcastChannel` do navegador, no canal `exam-room:<id da avaliação>`. Ao abrir, o relógio pede o estado e a sala responde; a cada mudança, a sala manda de novo.
  - O relógio não abre outra conexão com a sala, porque o servidor aceita uma conexão de docente por sala e derrubaria a da aba da sala.
  - Sem a aba da sala aberta no mesmo navegador, o relógio continua contando, mas sem as mãos.

**Revisão 2: cartões maiores, com a questão do aluno** (pedido do Tech Lead de 03/11/2026: "quero que sejam cards maiores, mostrando qual é a questão que o aluno está fazendo"):

- **Tamanho:** a grade usa cartões de no mínimo 18rem de largura (eram 13rem). O cartão ganha mais respiro, o nome em `--font-size-md` e uma altura mínima igual para todos os cartões de uma linha.
- **Questão do aluno:** o destaque do cartão de quem está fazendo a prova é o **número da questão em que ele está**: "Questão 4 de 9", logo abaixo do nome, em letra grande e forte. Embaixo, menor, vem o título da questão ("Criar pasta"), em até 2 linhas.
  - Se o aluno ainda não informou a questão (por exemplo, entrou antes desta revisão), a linha não aparece.
  - Para quem não está fazendo, nada muda.
- **Painel do aluno aberto:** a linha "Questão N: <título>" passa a vir da questão do cartão. Ela aparece também em questão sem terminal.

**Revisão 3: o painel do aluno, com tamanho ajustável, comandos por questão e a ajuda em abas** (pedidos do Tech Lead no roteiro manual de 04/11/2026: "devemos poder ajustar o tamanho da visualização no lado do professor"; "o professor quer ver os comandos que ele usou no geral, e por atividade"; "esse menu de ajuda deve ser mostrado no mesmo aside do terminal e comandos, em abinhas"):

- **Tamanho do painel** (decisão do Tech Lead: divisória e *Expandir*):
  - Entre a grade dos cartões e o painel lateral há uma **divisória arrastável** (cursor `col-resize`), como a do estudo de tópico. O painel vai de 22rem até 70% da largura da sala. Pelo teclado, a divisória tem foco e as setas mudam a largura.
  - O botão **Expandir** do painel faz ele ocupar a sala inteira, sem os cartões; **Recolher** ou `Esc` voltam ao tamanho anterior.
  - A largura escolhida fica guardada no navegador (`localStorage`); sem ela, vale a largura de hoje.
  - O terminal do aluno ocupa a altura que sobra no painel.
  - No celular não há divisória: o painel continua abaixo dos cartões.
- **Comandos** (decisão do Tech Lead: filtro por questão, na ordem do terminal):
  - A lista vai **do mais antigo para o mais novo**, como num terminal, e rola sozinha para o último enquanto a docente não sobe a lista.
  - No topo, pílulas que filtram: **Todas (N)** e uma por questão em que o aluno digitou, **Questão 6 (5)**, na ordem das questões. Começa em *Todas*.
  - Em *Todas*, um separador com "Questão N" e o título, quando a sala o conhece, marca cada troca de questão. Com uma questão escolhida, a lista mostra só os comandos dela, sem separador.
  - Cada linha tem a hora, o comando e a saída, como hoje.
- **Abas do painel** (pedido do Tech Lead):
  - O painel lateral tem duas abas: **Aluno**, com o terminal e os comandos do aluno aberto (ou a dica, sem aluno aberto), e **Pedidos de ajuda (N)**, com a fila de hoje. N é o número de pedidos abertos.
  - Abrir um aluno, pelo cartão ou pelo nome num pedido, mostra a aba *Aluno*. Um pedido novo não troca de aba: a contagem da aba e o som da SPEC-091 avisam.
  - As abas seguem o padrão de abas acessível (`role="tablist"`, `tab` e `tabpanel`, setas entre as abas).

### 3.2. Backend

A revisão 3 não muda o backend. Só na revisão 2: a sala passa a saber em que questão cada aluno está, sem depender de a docente acompanhá-lo.

- **Mensagem nova do aluno para a sala:** `room:question` com `{ position, title }`. A janela da prova manda essa mensagem quando o aluno abre uma questão, quando troca de questão e de novo quando a conexão com a sala volta.
- **Regras da mensagem:**
  - Só vale vinda do estudante, até 1 KiB.
  - A posição precisa ser maior que zero, e o título é cortado em 200 caracteres.
  - Uma mensagem inválida é descartada, como as demais da sala.
- **O servidor:**
  - guarda **em memória**, por sala e por aluno, a última questão informada;
  - não grava no banco, e um reinício do servidor perde a informação até o aluno trocar de questão ou reconectar;
  - manda o cartão atualizado à docente (`room:student`).
- **O cartão** (`snapshot` e `room:student`) ganha o campo opcional `question: { position, title }`.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança no banco. A questão atual de cada aluno fica só na memória da sala (revisão 2).

## 5. Contrato de API (API Contract)

Nenhuma rota nova. Websocket da sala (revisão 2):

| Direção | Tipo | Dados |
| :--- | :--- | :--- |
| aluno → sala | `room:question` | `{ "position": 4, "title": "Criar pasta" }` |
| sala → docente | cartão em `room:snapshot` e `room:student` | campo novo opcional `"question": { "position": 4, "title": "Criar pasta" }` |

## 6. Impacto e Riscos (Impact & Risks)

- Só o `ExamRoom`, o seu SCSS e a rota nova do relógio mudam, e o painel da aula ao vivo fica igual. A pílula de situação e a barra de progresso nascem no próprio `ExamRoom`.
- Os testes do `ExamRoom` que procuram o filtro por `select` mudam: o filtro passa a ser um botão. A troca fica num commit de teste próprio, com o motivo.
- O relógio depende da aba da sala aberta no mesmo navegador para mostrar as mãos. É o caso do laboratório: o computador da docente ligado ao projetor, com a tela estendida.
- A ordem por prioridade faz um cartão trocar de lugar quando a situação muda. Para não "pular" sob o mouse, a ordem só muda quando a situação muda, não a cada segundo.

## 7. Critérios de Aceite (Acceptance Criteria)

- **CA-01:** com uma mão levantada e alunos fazendo, entregues e ausentes, a grade mostra primeiro a mão, depois quem faz, quem espera, quem entregou e os ausentes; dentro de cada grupo, pelo nome.
- **CA-02:** as pílulas mostram as contagens. Clicar em *Fazendo* deixa só quem faz, e a pílula fica `aria-pressed="true"`. Clicar de novo volta a *Todos*.
- **CA-03:** cada cartão mostra a situação em texto. Quem está fazendo tem a barra de progresso com `aria-valuenow` = respondidas e `aria-valuemax` = total.
- **CA-04:** abrir um aluno ausente diz "O aluno ainda não entrou na prova." e não mostra o terminal. Abrir um aluno com a prova encerrada mostra "A prova deste aluno terminou." e o motivo.
- **CA-05:** sem aluno aberto, o painel mostra a dica. Com a fila vazia, mostra "Pedidos de ajuda: nenhum".
- **CA-06:** o tempo tem o rótulo "Termina em" e a hora do término.
- **CA-08:** a sala tem o botão **Abrir o relógio para a turma**, que abre `.../room/clock` numa aba nova.
- **CA-09:** o relógio mostra o título, "Termina em", o tempo e a hora do término; antes do início, "A prova ainda não começou."; depois do término, "Tempo esgotado."
- **CA-10:** quando a sala manda uma fila com Ana e Bruno, o relógio mostra "Mão levantada: Ana, Bruno", sem a dúvida. Com a fila vazia, a faixa some. Ao abrir, o relógio pede o estado e a sala responde.
- **CA-11:** (revisão 2) ao abrir ou trocar de questão, a janela da prova manda `room:question` com a posição e o título, e manda de novo quando a conexão com a sala volta.
- **CA-12:** (revisão 2) o servidor guarda a última questão de cada aluno e a põe no cartão, tanto no `room:snapshot` quanto no `room:student`. Uma `room:question` da docente, com posição zero ou com mais de 1 KiB é descartada, e o título é cortado em 200 caracteres.
- **CA-13:** (revisão 2) o cartão de quem está fazendo mostra "Questão 4 de 9" e o título da questão. Sem questão informada, a linha não aparece.
- **CA-14:** (revisão 3) arrastar a divisória, ou usar as setas com ela em foco, muda a largura do painel entre 22rem e 70% da sala, e a largura volta igual ao reabrir a sala; *Expandir* esconde os cartões e *Recolher* ou `Esc` os mostram de novo.
- **CA-15:** (revisão 3) os comandos vão do mais antigo para o mais novo; as pílulas mostram *Todas* e cada questão com a contagem; escolher a questão 6 deixa só os comandos dela; em *Todas*, um separador marca cada troca de questão.
- **CA-16:** (revisão 3) o painel tem as abas *Aluno* e *Pedidos de ajuda (N)*; abrir um aluno pelo cartão ou pelo pedido mostra a aba *Aluno*, e um pedido novo só muda a contagem.
- **CA-17:** (revisão 3, correção do roteiro) o terminal do aluno aberto tem altura definida e acompanha o fim enquanto ele digita.
- **CA-07:** os testes atuais da SPEC-091 continuam verdes, ajustados só onde o filtro virou botão.

## 8. Plano de Testes (Test Plan)

- **Primeiro, vermelhos** (`ExamRoom.test.tsx`): a ordem (CA-01), as pílulas que filtram (CA-02), a pílula e a barra (CA-03), o painel por situação (CA-04), a dica e a fila vazia (CA-05) e o rótulo do tempo (CA-06), o botão do relógio e o que a sala manda pelo canal (CA-08, CA-10); e o relógio (`ExamClock.test.tsx`: CA-09, CA-10).
- **Visual:** prints da sala no computador e no celular, com um aluno fazendo e uma mão levantada.

## 9. Contexto Final da IA (AI Final Context Execution)

- **Ler:** `frontend/src/components/ExamRoom/ExamRoom.tsx`, o SCSS dele e o `OnlineStudents.module.scss` (o padrão dos cartões).
- **Não mexer:** nos componentes da aula ao vivo e no backend.
- **Textos novos:** no bloco `room` de `messages/pt-BR.ts`.

## 10. Pendências para aprovação

Nenhuma.

## Histórico de revisões

| Data | Autor | Mudança |
| :--- | :--- | :--- |
| 03/11/2026 | Aruna Architect | Criação a partir do pedido do Tech Lead e dos prints da sala |
| 03/11/2026 | Aruna Architect | Aprovada pelo Tech Lead, com o pedido do relógio para a turma, em aba própria, com as mãos levantadas (seção 3.1, CA-08 a CA-10) |
| 03/11/2026 | Claude (implementação) | Implementada no frontend, sem mudar o backend: `ExamRoom` (pílulas que filtram, ordem por necessidade, cartões com situação, ponto e barra, painel por situação, tempo com rótulo, botão do relógio e o canal `exam-room:<id>`), `ExamClock` e a rota `.../room/clock`; a sala e o relógio passam a usar a mesma moldura `TeacherWindow`. Diferenças: o motivo do encerramento não aparece no painel, porque o cartão da sala não o traz e o backend ficou fora do escopo; no celular o botão do aluno aberto continua **Fechar**, não **Voltar aos alunos**. |
| 03/11/2026 | Aruna Architect | Revisão 2, a pedido do Tech Lead: cartões maiores com a questão em que o aluno está; mensagem `room:question` do aluno e o campo `question` do cartão (seções 3.1, 3.2, 5, CA-11 a CA-13) |
| 03/11/2026 | Aruna Architect | Revisão 2 aprovada pelo Tech Lead, com o ajuste: "deve mostrar o número do exercício da prova que ele está fazendo"; o número da questão é o destaque do cartão |
| 03/11/2026 | Claude (implementação) | Revisão 2 implementada: `room:question` no hub da sala (só do estudante, até 1 KiB, posição > 0, título cortado em 200), a questão guardada em memória e posta no cartão; a janela da prova manda a questão ao abrir, ao trocar e ao reconectar; o cartão, com no mínimo 18rem, mostra "Questão N de T" em destaque e o título embaixo |
| 04/11/2026 | Aruna Architect | Revisão 3, a pedido do Tech Lead no roteiro manual: divisória arrastável e *Expandir* no painel, comandos na ordem do terminal com filtro por questão, abas *Aluno* e *Pedidos de ajuda* (seção 3.1, CA-14 a CA-16), e o terminal com altura definida (CA-17, já corrigido como bug na `fix/aplicacao-da-prova`). Decisões do tamanho e dos comandos tomadas pelo Tech Lead na conversa |
| 04/11/2026 | Tech Lead | Revisão 3 aprovada ("aprovo"), na branch geral `fix/aplicacao-da-prova` |
| 04/11/2026 | Claude (implementação) | Revisão 3 implementada na `fix/aplicacao-da-prova`, só no frontend: divisória `role="separator"` (arrasto e setas, de 352 px a 70% da sala, passo de 32 px, guardada em `exam-room:side-width`), *Expandir*/*Recolher*/`Esc`, abas *Aluno* e *Pedidos de ajuda (N)* com setas, comandos do mais antigo ao mais novo com pílulas *Todas*/*Questão N* e separadores com o título quando a sala o conhece (dos cartões e das telas). **Teste alterado depois do vermelho:** em "asks to watch the student…", a linha "Questão 4: Criar pasta" passa a ser buscada no parágrafo, porque o separador repete o texto. CA-14 a CA-17 cobertos; o arrasto com o mouse fica para o roteiro manual (o jsdom não mede layout). |
