# SPEC-056: Espelho da Tela do Terminal na Aula ao Vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-056 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido de correção do Tech Lead; desenho a revisar) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` e `platform/hub` (backend); `frontend/src/components/Classroom/`, `frontend/src/engine/terminalWindow.ts` |
| **Contexto de tela** | Janela de apresentação do professor e sala do aluno, em modo Módulo |
| **Prioridade** | Alta (defeito) |
| **Depende de** | SPEC-051, SPEC-054, SPEC-055 |
| **Substitui** | Parcialmente a SPEC-051 e a SPEC-054: o espelhamento do terminal por comandos (`live:terminal:input`, `live:terminal:sync`, o instantâneo `terminal.input`, `terminal.entries` e `terminal.state`) |
| **Fontes canônicas** | Relato do Tech Lead em 14/10/2026: "o que é mostrado no terminal do professor não é mostrado na tela do aluno; o professor deu `clear` e `vim` e o aluno não viu nada" |

---

## 1. Contexto e Problema (Context & Problem Statement)

O terminal do aluno é hoje uma cópia que **repete os comandos** do professor: imprime a saída de cada comando que terminou e a linha que ele digita. Esse desenho só enxerga o que passa por `escrever`. Fica de fora tudo o que muda a tela por outro caminho:

- `clear` (e Ctrl+L): o professor limpa a tela e o aluno continua com o histórico.
- Editores `vim` e `nano`: ocupam a tela com a própria interface e o aluno não vê nada.
- Abas de terminal, lado a lado, o que o professor rolou, e qualquer comando novo que desenhe a tela de outro modo (`top`, `less`, `watch`).

Cada caso novo exigiria outro remendo. O defeito é de desenho: o aluno deve ver **a tela do professor**, não a reconstrução dela.

## 2. Objetivos (Goals)

- O aluno vê, em tempo real, **a mesma janela de terminais** que o professor vê: tela, cores, linha em digitação e cursor, `clear`, editores, abas.
- O aluno nunca executa nada: recebe só o desenho da tela.
- Um aluno que entra no meio da aula, ou reconecta, vê a tela atual.

### 2.1. Fora de escopo (Non-Goals)

- A posição de rolagem do professor (a cópia do aluno acompanha o fim da tela).
- Som, área de transferência e seleção de texto do professor.
- Mudar o terminal do professor (`src/engine/core` não é alterado; o desenho da tela é lido de fora, como o monitoramento atual).
- Gravar ou reproduzir a aula depois.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Professor (janela de apresentação).** `mountTerminalWindow` ganha um retorno de **imagem da tela** (`onScreen`): ao mudar qualquer coisa da janela dos terminais, entrega a árvore da tela, no máximo uma vez a cada 100 ms e só se mudou. A mudança é percebida por `MutationObserver` (filhos, texto e atributos `class` e `hidden`) **e** por eventos de teclado e `input` dentro da janela (o texto de `textarea` e `input` não gera mutação no DOM, e o `vim` e o `nano` vivem assim).
- **A árvore da tela** é uma cópia segura da janela de terminais: elementos de uma **lista de tags permitidas** (`div`, `span`, `b`, `i`, `em`, `strong`, `kbd`, `code`, `pre`, `br`, `button`, `textarea`, `input`, `table`, `tbody`, `tr`, `td`, `th`) e de **atributos permitidos** (`class`, `hidden`, `title`, `aria-selected`, `role`, `value`), e nós de texto. Qualquer outra tag é descartada com os filhos tornados texto; qualquer outro atributo é ignorado (nunca `on*`, `href`, `src`, `style`). O valor de um `input` de senha e o de um campo oculto **nunca** é copiado. Para caber no limite, os filhos de um elemento são cortados pelo começo (ficam os últimos 400), e se ainda passar do limite de mensagem, o corte aumenta até caber.
- **Aluno.** Um componente `TerminalMirror` desenha a árvore recebida com `createElement` e `textContent` (nunca `innerHTML`), dentro de um contêiner `inert`, com a folha de estilo do terminal já usada pelo módulo, e leva as telas `term-tela` ao fim a cada atualização. Mostra o aviso "Cópia do terminal do professor (somente leitura)" (já existente) e o estado de carregamento enquanto não chega a primeira tela. O aluno **não monta mais o motor do terminal**.
- **`MirroredModuleView`:** o papel do professor continua montando o terminal real e agora envia a imagem da tela; o do aluno passa a usar o `TerminalMirror`. Saem `setReadOnly`, `showInput`, `printScreen` e `syncMachine` de `TerminalWindow` e a fila de reaplicação de comandos.
- **`useLiveClassroom`:** `sendTerminalScreen(tree)` (só a janela de apresentação) e `room.terminal.screen` (a última árvore recebida, ou nula); saem `sendTerminalInput` e `sendTerminalSync`.

### 3.2. Backend (Go — Camada de Módulo/Service)

- Nova mensagem do palco `live:terminal:screen`, só da janela `presenter`: `data` é `{"screen": <árvore>}` (a árvore é um objeto `{tag, attrs?, children?}` em que filhos de texto são strings; o servidor **não interpreta o conteúdo**, só confere que é um objeto JSON e que cabe no limite).
- O servidor **guarda só a última tela** em memória (como o estado do palco), a repassa a todas as outras conexões (painel e alunos aceitos, sem eco) e a inclui no instantâneo dos alunos aceitos, do painel e da janela de apresentação: `terminal: {"screen": <árvore>|null}`.
- Limite de tamanho próprio da mensagem: 256 KB. Acima disso a mensagem é rejeitada com log `classroom message rejected`.
- Remove `live:terminal:input` e `live:terminal:sync` (passam a cair como `unknown-type`), o guardar a linha, o histórico e o estado da máquina, e os campos `input`, `entries` e `state` do `terminal` do instantâneo e de `GET /classes/:id/live/active`.
- Descarte com auditoria (`wrong-view`) de `live:terminal:screen` vindo do painel.

## 4. Modelo de Dados (Data Model)

Nenhuma tabela nova e nenhuma migração. A tela mais recente fica só em memória, junto do estado do palco, e se perde quando a aula acaba ou o servidor reinicia (o professor reenvia a tela na primeira mudança, e a janela de apresentação reenvia a tela inteira ao conectar).

## 5. Contrato de API (API Contract)

- **Cliente → servidor:** `live:terminal:screen {"screen": {...}}`, só `presenter`.
- **Servidor → cliente:** `live:terminal:screen {"screen": {...}}` a todas as outras conexões; o `live:snapshot` leva `terminal: {"screen": {...}|null}`.
- **Removidos:** `live:terminal:input`, `live:terminal:sync`, `terminal.input`, `terminal.entries`, `terminal.state`.

Sem mudança nos endpoints REST além do campo `terminal` de `GET /classes/:id/live/active`.

## 6. Impacto e Riscos (Impact & Risks)

- **Volume de dados.** Uma tela inteira a cada mudança é mais pesada do que um comando. Mitigação: no máximo 10 por segundo por emitente, só quando mudou, corte pelos últimos 400 filhos e limite de 256 KB; o limite de 35 eventos por segundo por emitente do servidor continua.
- **Conteúdo não confiável no navegador do aluno.** Mitigação: lista fechada de tags e atributos, sem `innerHTML`, sem URLs, sem `style` nem `on*`, contêiner `inert`; o servidor só aceita a mensagem da janela `presenter` do professor.
- **Vazamento de senha.** Mitigação: o terminal já não desenha o que se digita num prompt oculto, e a cópia da tela nunca leva o valor de `input` de senha nem de campo oculto.
- **Quebra de compatibilidade do protocolo** (os dois lados mudam juntos). Mitigação: a spec congela o formato e as duas frentes sobem juntas.
- **Mudança de comportamento da SPEC-051 e da SPEC-054 já implementadas.** Mitigação: os testes antigos do espelhamento por comandos são trocados, com a lista no relatório.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o professor limpa a tela (`clear` ou Ctrl+L), O SISTEMA DEVE mostrar ao aluno a tela limpa.
- [ ] **CA-02** (estado): ENQUANTO o professor usa o `vim` ou o `nano`, O SISTEMA DEVE mostrar ao aluno o editor com o texto, a barra de estado e o modo, atualizados à medida que o professor edita, e DEVE voltar à tela normal quando ele sair.
- [ ] **CA-03** (evento): QUANDO o professor digita ou executa um comando, O SISTEMA DEVE mostrar ao aluno a linha em digitação, o cursor, a saída e as cores iguais às do professor em até 300 ms.
- [ ] **CA-04** (ubíquo): O aluno DEVE ver as mesmas abas de terminal e a mesma aba ativa que o professor, inclusive o modo lado a lado.
- [ ] **CA-05** (evento): QUANDO um aluno entra na aula, reconecta ou é aceito depois do começo, O SISTEMA DEVE mostrar a tela atual do professor sem esperar uma nova mudança.
- [ ] **CA-06** (ubíquo): A cópia da tela NUNCA DEVE conter o que o professor digita num prompt de senha, nem o valor de um `input` de senha ou de campo oculto.
- [ ] **CA-07** (ubíquo): O aluno DEVE receber a tela só como árvore de tags e atributos da lista permitida, desenhada sem `innerHTML`, e NÃO DEVE executar nada do que vier nela.
- [ ] **CA-08** (ubíquo): O servidor DEVE aceitar `live:terminal:screen` só da janela de apresentação, descartar com auditoria a vinda do painel ou de aluno, e rejeitar a que passe de 256 KB ou não seja um objeto.
- [ ] **CA-09** (ubíquo): `live:terminal:input`, `live:terminal:sync` e os campos `input`, `entries` e `state` do terminal DEVEM deixar de existir no protocolo e no instantâneo.
- [ ] **CA-10** (ubíquo): O terminal da tela de estudo (`/materials/:id`) e o resto do `TopicStudy` NÃO DEVEM mudar, e `engine/core` NÃO DEVE ser alterado.
- [ ] **CA-11** (ubíquo): Stylelint, ESLint, `tsc` e `go vet` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `platform/hub` e `classroom`:** `live:terminal:screen` só do `presenter`, repassada sem eco ao painel e aos alunos (CA-08); descartada do painel e do aluno; rejeitada acima de 256 KB e quando não é objeto (CA-08); guardada a última e entregue nos instantâneos do aluno, do painel e do presenter (CA-05); os tipos antigos caem como `unknown-type` e o instantâneo não tem mais `input`, `entries` e `state` (CA-09).
- **Frontend, `terminalWindow`:** a imagem da tela segue a lista de tags e atributos (CA-07); nunca leva senha nem campo oculto (CA-06); corta pelo começo para caber; é entregue no máximo a cada 100 ms e só quando mudou; percebe `clear`, a abertura e a saída do `vim` e do `nano` e a digitação dentro de um `textarea` (CA-01, CA-02, CA-03).
- **Frontend, `TerminalMirror`:** desenha a árvore sem `innerHTML`, ignora tag e atributo fora da lista, leva a tela ao fim, mostra as abas e a ativa (CA-04, CA-07); mostra o carregando até a primeira tela.
- **Frontend, `MirroredModuleView`, `useLiveClassroom` e `PresenterStage`:** o professor envia a tela; o aluno a recebe e a mostra; o instantâneo coloca a tela de quem entra (CA-05); `sendTerminalInput` e `sendTerminalSync` deixaram de existir (CA-09).
- **Regressão:** os testes existentes do `TopicStudy` e da tela de estudo passam sem alteração (CA-10).
- **Manual:** professor roda comandos, `clear`, abre `vim` e `nano` e troca de aba; o aluno acompanha; um segundo aluno entra no meio e vê a tela atual.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051, SPEC-054, SPEC-055 e esta; `frontend/src/engine/terminalWindow.ts`, `components/Classroom/MirroredModuleView`, `components/TopicStudy/LiveTopicScreen`, `hooks/useLiveClassroom.ts`; `backend/internal/modules/classroom/handler/ws.go`, `service/service.go`, `platform/hub`.
2. **Ordem de execução:** testes vermelhos e commit `test`; backend (a mensagem, o guardar, os instantâneos, a remoção); frontend (a imagem da tela, o `TerminalMirror`, a troca no `MirroredModuleView` e no hook); mensagens; glossário.
3. **Arquivos a criar ou alterar:** `backend/internal/platform/hub/**` e `backend/internal/modules/classroom/**` (sem migração); `frontend/src/engine/terminalWindow.ts` (a imagem da tela; sai o que servia à cópia por comandos), `components/Classroom/**`, `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `components/TopicStudy/LiveTopicScreen.tsx` (só o necessário), `messages/pt-BR.ts`; `specs/GLOSSARY.md` (Espelho do terminal). **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu a correção ("o que é mostrado no terminal do professor não é mostrado na tela do aluno"); a escolha de **espelhar a tela, e não os comandos**, é da Aruna e deve ser revisada. Alternativa descartada: continuar remendando a repetição de comandos (um caso novo por vez: `clear`, editores, `top`, `less`).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido de correção do Tech Lead; o desenho (espelhar a tela) fica para a revisão dele |
