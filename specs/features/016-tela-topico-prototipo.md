# SPEC-016: Tela de Estudo do Tópico com o Terminal do Protótipo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-016 |
| **Status** | Rascunho |
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
- **Tela de aplicação em largura total:** sem a navegação pública e o rodapé do site, como no protótipo.
- **Cabeçalho:**
  - "← Materiais" e o ícone, o título e as etiquetas do módulo;
  - o selo UTFPR Campus Guarapuava;
  - o player e a seletora de velocidade;
  - abaixo, a barra com 📋 Cola, 🔄 Reset Máquina, 💾 e 📂.
- **Coluna da esquerda, com rolagem própria e duas abas:**
  - **📘 Comandos e dicas:** os blocos do módulo agrupados em cards de lição. Um bloco `TEXT` com título abre um card novo, e os blocos seguintes sem título entram nele. Cada card que tem comandos mostra "▶ Rodar este card", e cada comando tem o seu ▶.
  - **🎯 Desafios n/m:**
    - os exercícios práticos do módulo com o círculo de status (✓ quando atendido) e "💡 Dica";
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
- **Velocidade:** 🐢 0,5×, 1×, 2× e 🐇 4×. Vale para a digitação automática e fica salva no navegador.
- **Passos especiais:** passos com `terminal` maior que 1 rodam no terminal indicado. Passos com `login` abrem o terminal com o usuário indicado. As `answers` respondem às perguntas, como no protótipo.

**Máquina:**
- **Origem:** começa no cenário do tópico, entregue pela rota 5.1.
- **Persistência:** salva no navegador a cada comando, por módulo, como no protótipo (P-03).
- **🔄 Reset Máquina:** volta ao cenário do tópico, com a animação do protótipo.
- **💾 e 📂:** baixam e carregam a máquina em JSON, no formato `exame-so/maquina`.

**Desafios:**
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

- [ ] **CA-01**: QUANDO o estudante abrir um módulo, O SISTEMA DEVE mostrar o cabeçalho com o player e a velocidade, as abas "Comandos e dicas" e "Desafios" à esquerda e a janela de terminais do protótipo à direita, aberta e pronta.
- [ ] **CA-02**: A máquina DEVE começar no cenário do tópico; QUANDO o estudante clicar em Reset Máquina, O SISTEMA DEVE voltar a ele.
- [ ] **CA-03**: QUANDO o estudante clicar em ▶ de um comando, em "Rodar este card" ou no player, O SISTEMA DEVE digitar e executar os comandos na velocidade escolhida, no terminal e com o usuário indicados no passo.
- [ ] **CA-04**: QUANDO um comando terminar e o estudante tiver sessão, O SISTEMA DEVE conferir os desafios no servidor e marcar os atendidos, registrando a primeira aprovação.
- [ ] **CA-05**: SE o visitante não tiver sessão, ENTÃO a aba de desafios DEVE convidar a entrar, e a rota 5.2 DEVE responder 401.
- [ ] **CA-06**: A máquina DEVE sobreviver a uma recarga da página; 💾 DEVE baixar o JSON e 📂 DEVE carregá-lo.
- [ ] **CA-07**: QUANDO o estudante clicar em Cola, O SISTEMA DEVE abrir a cola de comandos do protótipo.
- [ ] **CA-08**: Nenhum arquivo fora de `frontend/src/engine/` DEVE importar o legado.
- [ ] **CA-09**: As rotas 5.1 e 5.2 DEVEM seguir as regras de acesso e os erros da seção 5.

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
3. **Definição de pronto:** CA-01 a CA-09 verificados e comparação manual com o protótipo registrada no histórico.

## 10. Pendências para aprovação

- **P-01 (cards de lição):** os blocos do banco não guardam a estrutura de lição do protótipo (comando, sintaxe, opções).
  *Recomendação:* agrupar os blocos em cards pela regra da seção 3.1. É visualmente próximo e não mexe no banco. Uma reextração com a estrutura de lição fica para outra spec, se a diferença incomodar.
- **P-02 (👀 Solução nos desafios):** o protótipo mostrava a solução, mas a SPEC-014 (CA-02) proibiu expô-la.
  *Recomendação:* mostrar a solução só para questões de uso `EXERCISE`, que são treino, como no protótipo; questões de avaliação nunca.
- **P-03 (máquina salva no navegador):** o protótipo salvava a máquina a cada comando.
  *Recomendação:* manter, por módulo e por usuário, no navegador. Não é estado oficial: o progresso oficial é o do servidor.
- **P-04 (Cola):** a cola do protótipo é uma tabela fixa, escrita no código do legado, e não vem do banco.
  *Recomendação:* reaproveitar como está, pelo adaptador. Gerá-la a partir do banco fica para depois.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a pedido do Tech Lead ("use o que tem no protótipo como base"; "temos que usar o que foi feito"), depois de comparar o frontend novo com o protótipo rodando. Decisões já tomadas pelo Tech Lead: rota da máquina do tópico, conferência automática após cada comando, Cola, salvar e abrir e até 3 terminais. Pendências P-01 a P-04 |
