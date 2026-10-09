# SPEC-016: Tela de Estudo do Tópico com o Terminal do Protótipo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-016 |
| **Status** | Implementada |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `practice` e `content` (backend); tela do módulo e adaptador do motor (frontend) |
| **Contexto de tela** | `/materials/[id]` e `/app/modules/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-012, SPEC-014, SPEC-015 |
| **Substitui** | A interface de prática da SPEC-014 (painel por exercício, terminal próprio em React e diálogo do `nano`) e a P-03 da SPEC-015. As rotas 5.1 a 5.3 da SPEC-014 continuam valendo |
| **Fontes canônicas** | Protótipo em execução (`legacy/`, `npx vite`): `legacy/src/app/TelaTopico.ts`, `Bancada.ts`, `ColaDeComandos.ts`, `legacy/src/terminal/*`, `legacy/src/estilos/topico.css` e `terminal.css` |


---

## 1. Contexto e Problema (Context & Problem Statement)

O protótipo "Linux na Prática" foi aprovado como TCC 1. A tela de estudo de cada tópico é o centro dele:
- **Esquerda:** abas "📘 Comandos e dicas" e "🎯 Desafios".
- **Direita:** um servidor Ubuntu simulado, com até 3 terminais.
- **Topo:** um player que digita os exemplos sozinho, com controle de velocidade, e os botões Cola, Reset Máquina, salvar e abrir a máquina.

A implementação da SPEC-014 criou outra interface:
- um terminal próprio por exercício, em React;
- cada exercício com uma máquina separada;
- sem player, sem velocidade, sem os terminais múltiplos.

O Tech Lead decidiu que o que foi feito e aprovado no protótipo deve ser reaproveitado, não reescrito. Os pontos que ficam iguais ao protótipo:
- os desafios são resolvidos na mesma máquina do tópico;
- são conferidos automaticamente depois de cada comando.

## 2. Objetivos (Goals)

- Reproduzir a tela de tópico do protótipo na página do módulo, com o mesmo layout e o mesmo comportamento.
- Reaproveitar a janela de terminais do protótipo (`JanelaDeTerminais`, `TerminalUbuntu`, `EditorNano`, `EditorVim`) pelo adaptador do motor, sem reescrevê-la.
- Iniciar a máquina no estado preparado do tópico (`scenario/topic/<módulo>`), que já está no banco.
- Conferir os desafios no servidor, automaticamente, depois de cada comando, sobre a máquina do tópico.

### 2.1. Fora de escopo (Non-Goals)

- A aba "Simulados e Questões" do tópico de simulados (entra na spec de avaliações).
- Edição do conteúdo pela docente (SPEC-012 continua valendo).
- Mudanças no motor do legado: ele continua somente leitura.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Layout:**
- **Tela de aplicação em largura total:** sem a navegação pública e o rodapé do site, como no protótipo; o contêiner da página não tem `max-width`.
- **Uma máquina só:** não há abas por exercício ("Livre", "1", "2"); a janela de terminais é a mesma para o conteúdo e para os desafios.
- **Cabeçalho:**
  - **no canto esquerdo, o usuário logado:** foto, nome e RA. Estudantes mostram foto e RA do perfil; docentes e administradores, que não têm RA nem foto no cadastro, mostram só o nome, com as iniciais no lugar da foto. Visitantes não veem esse bloco;
  - "← Materiais" e o ícone, o título e as etiquetas do módulo;
  - o selo UTFPR Campus Guarapuava;
  - o player, com dois controles deslizantes de velocidade (leitura da voz e digitação, ver SPEC-018);
  - abaixo, a barra com 📋 Cola, 🔄 Reset Máquina, 💾 e 📂.
- **Coluna da esquerda, com rolagem própria e duas abas:**
  - **📘 Comandos e dicas:** os blocos do módulo agrupados em cards de lição. Um bloco `TEXT` com título abre um card novo, e os blocos seguintes sem título entram nele. Cada card que tem comandos mostra "▶ Rodar este card", e cada comando tem o seu ▶.
  - **🎯 Desafios n/m:**
    - os exercícios práticos do módulo com o círculo de status (✓ quando atendido), "💡 Dica" e o botão "Iniciar";
    - "👀 Solução", conforme a P-02;
    - o texto explicativo do protótipo sobre a conferência automática.
- **Coluna da direita:** a janela de terminais do protótipo e o rodapé com as senhas e os atalhos.
- **Telas estreitas:** as colunas se empilham, com o terminal depois do conteúdo.

**Player (igual ao protótipo):**
- **Roteiro:** os passos de todos os blocos `COMMAND`, na ordem.
- **Botões:**
  - ⏮ reinicia a máquina e refaz até o passo anterior;
  - ▶ executa todos em sequência, e clicar de novo para;
  - ⏭ executa só o próximo.
- **Informação:** mostra "Próximo card: i/N · título", o próximo comando, o contador k/total e a barra de progresso.
- **Velocidade:** passou a ser o controle deslizante de digitação (de 0,5× a 4×), ao lado do controle de leitura da voz (SPEC-018, RF-07). Vale para a digitação automática e fica salva no navegador.
- **Passos especiais:** passos com `terminal` maior que 1 rodam no terminal indicado. Passos com `login` abrem o terminal com o usuário indicado. As `answers` respondem às perguntas, como no protótipo.

**Máquina:**
- **Origem:** começa no cenário do tópico, entregue pela rota 5.1.
- **Persistência:** salva no navegador a cada comando, por módulo, como no protótipo (P-03).
- **🔄 Reset Máquina:** volta ao cenário do tópico, com a animação do protótipo.
- **💾 e 📂:** baixam e carregam a máquina em JSON, no formato `exame-so/maquina`.

**Desafios:**
- **Iniciar um exercício:**
  - o terminal mostra "Preparando máquina…", com a animação do reset do protótipo;
  - carrega o cenário daquele exercício (rota 5.1 da SPEC-014) na mesma janela;
  - mantém o histórico de comandos (↑) de cada terminal e o que já está na tela.
- Sem iniciar nenhum exercício, a máquina é a do tópico, e os desafios podem ser feitos em sequência, como no protótipo.
- Depois de cada comando, o frontend envia o estado à rota 5.2, com a espera descrita na RN-03.
- Marca como atendidos os desafios devolvidos.
- Para visitantes, mostra o convite para entrar, porque a conferência exige sessão.

**Cola:** abre a "Cola de comandos" do protótipo, um modal com a tabela geral dos tópicos e o botão de imprimir, conforme a P-04.

**Adaptador (`frontend/src/engine/`):**
- `mountTerminalWindow(container, snapshot, callbacks)` monta a `JanelaDeTerminais` do legado.
- Expõe `run(step)`, `setSpeed`, `reset(snapshot)`, `snapshot()`, `exportJson()`, `importJson()` e `destroy()`.
- Importa os estilos `terminal.css` do legado.
- O restante da tela é React com SCSS Modules e tokens da SPEC-015.

**Remoções:** o terminal em React (`components/Terminal`), o `NanoDialog` e o painel de prática deixam de existir.

### 3.2. Backend (Go)

- **Rota 5.1, máquina do tópico:**
  - devolve o cenário `scenario/topic/<sourceKey do módulo>`, com as mesmas regras de acesso do conteúdo do módulo (SPEC-012);
  - módulo sem cenário de tópico devolve a máquina padrão (`snapshot` nulo, e o frontend usa `Maquina.criar()`).
- **Rota 5.2, conferência em lote:**
  - avalia, com o motor em Go da SPEC-011, todas as questões `PRACTICAL`, `EXERCISE` e `PUBLISHED` do módulo contra o estado enviado;
  - registra a primeira aprovação de cada uma em `exercise_progress`, como na SPEC-014;
  - devolve a lista das atendidas.
- **RN-01 (tentativas):** a conferência automática não conta tentativas; `attempts` só aumenta na rota individual da SPEC-014.
- **RN-02 (limite):** 120 conferências em lote por minuto por usuário; o corpo vai até 2 MB, como na SPEC-014.
- **RN-03 (cliente):**
  - espera 600 ms sem comandos novos antes de conferir;
  - nunca mantém mais de uma conferência em andamento;
  - com 429, aguarda o `Retry-After`.

## 4. Modelo de Dados (Data Model)

Sem alteração de schema. O vínculo módulo → cenário do tópico usa a chave de origem (`scenario/topic/` + `course_modules.source_key`).

## 5. Contrato de API (API Contract)

### 5.1. `GET /api/v1/modules/{id}/scenario`

Máquina inicial do tópico. **Acesso:** o mesmo do conteúdo do módulo (autenticação opcional).

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `moduleId` | UUID | |
| `snapshot` | objeto ou nulo | Estado serializado (formato `exame-so/maquina`); nulo para a máquina padrão |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Módulo não público sem sessão |
| 403 | `forbidden` | Módulo privado não liberado |
| 404 | `module-not-found` | Módulo inexistente |

### 5.2. `POST /api/v1/modules/{id}/check`

Confere todos os desafios do módulo sobre o estado enviado. **Acesso:** autenticado, com acesso ao módulo.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `snapshot` | objeto | Sim | Formato `exame-so/maquina` versão 1; corpo até 2 MB |

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `passed` | lista de UUID | Questões atendidas pelo estado |
| `progress` | lista | `questionId` e `completedAt` de cada questão já concluída pelo estudante |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Estado ausente ou fora do formato |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Sem acesso ao módulo |
| 404 | `module-not-found` | Módulo inexistente |
| 413 | `file-too-large` | Corpo acima de 2 MB |
| 429 | `rate-limited` | Limite excedido |

### 5.3. Solução dos desafios (conforme P-02)

Se a P-02 for aprovada, a lista de questões de uso `EXERCISE` (SPEC-012) passa a incluir `referenceSolution` (lista de comandos) para questões práticas. Questões `ASSESSMENT` nunca expõem a solução.

## 6. Impacto e Riscos (Impact & Risks)

- **Código de interface do legado dentro do frontend novo.**
  *Mitigação:*
  - continua só leitura e importado apenas por `frontend/src/engine/`;
  - a regra de ESLint da SPEC-014 vale também para `legacy/src/terminal` e `legacy/src/app`;
  - a exceção fica registrada na `ARCHITECTURE.md`.
- **Estilos do legado com cores fixas.**
  *Mitigação:* ficam fora de `frontend/src` (o Stylelint não os alcança) e restritos às classes da janela do terminal.
- **Carga no servidor com conferência automática.**
  *Mitigação:* espera de 600 ms, uma conferência por vez, limite de 120 por minuto e corpo de até 2 MB.
- **Desafios que dependiam de pré-requisitos nos cenários individuais** (por exemplo, `dir-3` precisa de `/root/empresa`).
  *Mitigação:* na máquina única eles são feitos em sequência, como no protótipo. Os cenários individuais continuam disponíveis para as avaliações.
- **Máquina salva no navegador ficar desatualizada após uma recarga de conteúdo.**
  *Mitigação:* a chave de armazenamento inclui o hash do cenário do tópico.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: QUANDO o estudante abrir um módulo, O SISTEMA DEVE mostrar o cabeçalho com o player e a velocidade, as abas "Comandos e dicas" e "Desafios" à esquerda e a janela de terminais do protótipo à direita, aberta e pronta.
- [x] **CA-02**: A máquina DEVE começar no cenário do tópico; QUANDO o estudante clicar em Reset Máquina, O SISTEMA DEVE voltar a ele.
- [x] **CA-10**: QUANDO o estudante iniciar um exercício, O SISTEMA DEVE mostrar "Preparando máquina…" no terminal, carregar o cenário do exercício na mesma janela e manter o histórico de comandos de cada terminal.
- [x] **CA-11**: QUANDO houver um usuário logado, O SISTEMA DEVE mostrar no canto esquerdo do cabeçalho a foto (ou as iniciais), o nome e, para estudantes, o RA; SE não houver sessão, ENTÃO O SISTEMA NÃO DEVE mostrar esse bloco.
- [x] **CA-03**: QUANDO o estudante clicar em ▶ de um comando, em "Rodar este card" ou no player, O SISTEMA DEVE digitar e executar os comandos na velocidade escolhida, no terminal e com o usuário indicados no passo.
- [x] **CA-04**: QUANDO um comando terminar e o estudante tiver sessão, O SISTEMA DEVE conferir os desafios no servidor e marcar os atendidos, registrando a primeira aprovação.
- [x] **CA-05**: SE o visitante não tiver sessão, ENTÃO a aba de desafios DEVE convidar a entrar, e a rota 5.2 DEVE responder 401.
- [x] **CA-06**: A máquina DEVE sobreviver a uma recarga da página; 💾 DEVE baixar o JSON e 📂 DEVE carregá-lo.
- [x] **CA-07**: QUANDO o estudante clicar em Cola, O SISTEMA DEVE abrir a cola de comandos do protótipo.
- [x] **CA-08**: Nenhum arquivo fora de `frontend/src/engine/` DEVE importar o legado.
- [x] **CA-09**: As rotas 5.1 e 5.2 DEVEM seguir as regras de acesso e os erros da seção 5.

## 8. Plano de Testes (Test Plan)

- **Backend:** service e handler das rotas 5.1 e 5.2 com fakes e `httptest`; teste ponta a ponta com o manifesto real (as soluções de referência de `dir-1` a `dir-5`, em sequência sobre a máquina do tópico, atendem os cinco desafios).
- **Frontend:**
  - adaptador montando a janela do legado em `jsdom`;
  - agrupamento dos blocos em cards;
  - player (roteiro, avançar, voltar e velocidade);
  - conferência automática com espera e tratamento de 401 e 429;
  - persistência e exportação.
- **Manual:** comparação lado a lado com o protótipo rodando (`legacy`, `npx vite`) em todos os tópicos.
- **Cobertura:** acima de 80%.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** SPEC-014, SPEC-015, `TelaTopico.ts`, `Bancada.ts` e `JanelaDeTerminais.ts`.
2. **Ordem:**
   1. rotas 5.1 e 5.2;
   2. adaptador da janela;
   3. tela (cabeçalho, abas, cards, player);
   4. desafios automáticos;
   5. persistência, Cola, 💾 e 📂;
   6. remoção da interface antiga;
   7. `ARCHITECTURE.md`.
3. **Definição de pronto:** CA-01 a CA-10 verificados e comparação manual com o protótipo registrada no histórico.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-04 aprovadas pelo Tech Lead em 09/10/2026, nas recomendações:

- **P-01:** blocos agrupados em cards de lição.
- **P-02:** "👀 Solução" só nos desafios de uso `EXERCISE`.
- **P-03:** máquina salva no navegador a cada comando.
- **P-04:** Cola do protótipo reaproveitada como está.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a pedido do Tech Lead ("use o que tem no protótipo como base"; "temos que usar o que foi feito"), depois de comparar o frontend novo com o protótipo rodando. Decisões já tomadas pelo Tech Lead: rota da máquina do tópico, conferência automática após cada comando, Cola, salvar e abrir e até 3 terminais. Pendências P-01 a P-04 |
| 09/10/2026 | Implementador (Claude) | Ajustes pedidos pelo Tech Lead ao ver a tela: largura total, sem abas por exercício (máquina única), "Iniciar" exercício com "Preparando máquina…" mantendo o histórico (CA-10), e Reset Máquina, player e velocidade visíveis |
| 09/10/2026 | Tech Lead | Aprovação de P-01 a P-04 nas recomendações. Status: `Aprovada` |
| 09/10/2026 | Implementador (Claude) | Implementação do frontend concluída (o backend das rotas 5.1 e 5.2 já estava no commit `b83bfc1`); status `Implementada`. **Verificação:** frontend com `vitest` (300 testes, 68 arquivos, sem falhas), cobertura geral de 95% das linhas e 87,5% dos ramos (`TopicStudy` 97% e 87%), ESLint, Stylelint, `tsc` e `next build` limpos. **CA → testes:** CA-01 `TopicStudy.test.tsx` ("shows the header, the tabs…") e `TerminalPane.test.tsx`; CA-02 "resets the machine after confirming" e `terminalWindow.test.ts` ("resets to a snapshot"); CA-03 `useTopicPlayer.test.ts`, "runs a whole card…" e `terminalWindow.test.ts` (passo com terminal 2 e login); CA-04 `useModuleCheck.test.ts` e "checks the machine after the quiet time…"; CA-05 "invites a visitor to sign in…" e a rota 5.2 no backend; CA-06 `machineStorage.test.ts`, "starts from the machine saved…" e "exports and imports the machine"; CA-07 "opens and closes the cheat sheet"; CA-08 regra de ESLint (`no-restricted-imports`, limpa); CA-09 testes de backend do commit `b83bfc1`; CA-10 `terminalWindow.test.ts` ("loads a scenario keeping the screen and the history") e "loads the scenario of the exercise in the same window". **Comparação com o protótipo** (rodando em `http://192.168.3.104:5173`), feita por capturas de tela automatizadas (Edge sem cabeça) do módulo História, nas abas Comandos e Desafios e na Cola, além de um teste de fumaça dos 8 módulos públicos (abrir, tocar o primeiro card, sem erros de console); não houve comparação visual manual dos outros 7 módulos. **Desvios:** (1) o `Rodar este card` só aparece em cards com comandos; (2) a janela do terminal é montada em um elemento próprio a cada montagem, porque o modo estrito do React monta duas vezes e uma montagem apagava a outra; (3) na CA-10 a máquina é trocada sob os terminais abertos por campos privados do `TerminalUbuntu` (sem alterar o legado), copiando o histórico de cada sessão; (4) o Reset Máquina usa `window.confirm`, como o protótipo; (5) o realce de cada módulo usa variáveis `--accent*` montadas no componente (`topicAccentVars`), porque a cor varia por módulo e `color-mix` é proibido nas folhas; foram acrescentados tokens translúcidos em `_tokens.scss`; (6) o Stylelint ganhou uma exceção só para `CheatSheetModal.module.scss` (classes `:global` do HTML da cola); (7) o `ContentRenderer` passou a manter a primeira coluna das tabelas sem quebra e a caixa "Na vida real" ficou azul, como no protótipo; (8) `engine/engine.ts`, as mensagens `practice` e `nano` e o alias do `Shell` foram removidos junto com a interface antiga; (9) em `/app/modules/[id]` a tela desconta a barra da conta (`--topic-offset`); (10) `frontend/src/test/domMatchers.ts` traz cinco verificações de DOM locais, sem nova dependência. **Fora de escopo, como na spec:** a aba "Simulados e Questões" do tópico de simulados |
| 09/10/2026 | Tech Lead | Revisão pedida depois da implementação ("essa navbar, no canto esquerdo devemos mostrar a foto do usuário, nome e RA"): bloco do usuário logado no cabeçalho (CA-11) e velocidade em dois controles deslizantes (SPEC-018, RF-07) |
