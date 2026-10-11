# SPEC-030: Verificação de conformidade do motor (teste de todos os comandos e programas, pelo administrador)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-030 |
| **Status** | Implementada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 11/10/2026 |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (sem backend, sem banco, sem API) |
| **Módulo** | `engine` (adaptador do motor em `frontend/src/engine/`) e tela de administração |
| **Contexto de tela** | Botão no cabeçalho (`AppShell`), visível só ao administrador, que abre a tela `/app/admin/conformidade` |
| **Prioridade** | Média |
| **Depende de** | SPEC-014, SPEC-027 (ajuda dos comandos), SPEC-028 (ampliação dos comandos), SPEC-029 (controle de processos) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026. `docs/arquitetura/transicao-backend.md` não trata do motor do terminal. |

---

## 1. Contexto e Problema (Context & Problem Statement)

O terminal do navegador roda um motor POSIX/VFS (SPEC-014) que reconhece mais de uma centena de comandos, e as SPEC-028 e SPEC-029 acrescentam dezenas de outros, alguns deles programas de longa duração (`yes`, `watch`, `sleep`). Hoje a única garantia de que tudo funciona está nos testes automatizados do repositório, que rodam na máquina de quem desenvolve. O administrador do sistema, que responde pelo ambiente em uso, não tem como conferir, dentro do próprio sistema e no navegador em que a plataforma roda, se o simulador está íntegro: um comando que passou a falhar depois de uma atualização só aparece quando uma docente ou um estudante esbarra nele durante uma aula.

Há também uma segunda lacuna, de processo: quando um comando ou programa novo entra no motor, nada obriga a lista do que é verificado a crescer junto. Uma verificação desatualizada dá falsa segurança, o que é pior do que não ter verificação.

## 2. Objetivos (Goals)

- O administrador tem um botão no cabeçalho que abre uma tela e executa, no motor do navegador, **todos os comandos e programas** do sistema, mostrando ao final se o simulador está **em conformidade** ou quais itens falharam.
- Cada comando e cada programa tem uma verificação própria, descrita em uma lista única de verificações (o **manifesto de conformidade**), com o que se executa e o que se espera.
- **A lista nunca fica para trás:** um teste automatizado do repositório compara o catálogo real do motor com o manifesto e **falha** se existir comando ou programa sem verificação (ou verificação de algo que não existe mais). Assim, quem acrescentar um comando é obrigado a acrescentar a verificação no mesmo commit.
- A obrigação fica escrita nas regras do projeto (`ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das specs que mexem no catálogo), para valer também para agentes de IA.

### 2.1. Fora de escopo (Non-Goals)

- Qualquer alteração em `legacy/`, nos comandos existentes ou no comportamento do terminal. A verificação só lê e executa o que já existe.
- Executar a verificação no servidor, guardar o resultado em banco ou criar rota de API. O resultado vive na tela, até o administrador sair dela. Histórico de execuções é spec futura.
- Verificar o conteúdo dos módulos de ensino, os exercícios ou a correção do servidor (já cobertos pelas SPEC-021, SPEC-023 e SPEC-011).
- Rodar para docente ou estudante. A tela é só do administrador.
- Verificação de desempenho, de acessibilidade ou de aparência do terminal.
- Verificar comandos de rede reais: nenhuma conexão sai do navegador (SPEC-028, RN-07). A verificação confere a resposta simulada.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Botão no cabeçalho.** No `AppShell`, ao lado dos links de gestão, aparece o link-botão "Conformidade do motor" **somente para o papel ADMIN**. Docente e estudante não o veem, e a rota, se aberta direto por eles, os leva à tela inicial (a proteção não depende de esconder o botão).

**Tela `/app/admin/conformidade`.**

1. **Ao abrir**, a tela monta uma máquina simulada nova e isolada (a mesma máquina padrão dos exercícios), executa a verificação inteira sem pedir nada e mostra o andamento. Um clique no cabeçalho é tudo o que o administrador faz. O botão "Executar de novo" repete a verificação do zero, com máquina nova.
2. **Andamento:** barra de progresso com "N de M itens" e o nome do item em execução, anunciado a leitores de tela de forma discreta (região viva, sem repetir a cada item: só a cada 10%).
3. **Resultado:** um selo geral no topo, que usa texto e ícone além da cor:
   - "Em conformidade": todos os itens passaram;
   - "Fora de conformidade: N itens falharam": há pelo menos um item com falha.
   Abaixo do selo, os totais (verificados, aprovados, com falha) e a tabela dos itens, com falhas primeiro. Cada linha mostra o nome, o tipo (comando ou programa), o grupo, o estado (aprovado, falhou) e, nas falhas, o comando executado, o que se esperava e o que o motor respondeu (o início da saída, limitado a 300 caracteres).
4. **Filtros:** "Só falhas" (marcado por padrão quando há falha) e uma busca por nome. A tabela rola dentro do próprio quadro no celular, sem estourar a largura.
5. **Estados da tela:**
   - *carregando:* o motor é grande e a primeira montagem é lenta: mostra a barra de progresso em estado indeterminado e a frase "Preparando o motor…" até o primeiro item executar;
   - *vazio:* não existe (o manifesto nunca é vazio, e o teste do repositório garante isso);
   - *erro do motor:* se o motor não montar ou a verificação for interrompida por exceção, mostra uma mensagem de erro com o motivo e o botão "Tentar de novo", sem selo de conformidade (não se afirma conformidade sem ter verificado);
   - *sucesso* e *com falhas:* conforme o item 3.
6. **Itens que falham não interrompem a verificação.** Cada item roda isolado, com limite de tempo de 5 segundos (RN-04), e o próximo começa de qualquer jeito.
7. Todos os textos da interface ficam em `src/messages/pt-BR.ts`. Estilo só com SCSS Modules e tokens, tema único escuro, alvos de toque de 44px, `prefers-reduced-motion` respeitado, rotas e serviços na estrutura atual (`src/app`, `src/components`). O motor é usado só por `frontend/src/engine/` (regra de ESLint da SPEC-014), então a tela consome uma função exportada por lá, e não importa o legado.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: a verificação roda inteira no navegador, onde o motor está, e não grava nada no servidor. A tela só exige sessão com papel ADMIN, como as demais telas do `/app`.

### 3.3. O que é "comando" e o que é "programa"

| Termo | Definição para esta spec |
| :--- | :--- |
| **Comando** | Todo nome registrado no catálogo do motor (os embutidos do legado e os que as SPEC-028 e SPEC-029 acrescentam), aquele que `help` lista |
| **Programa** | Todo executável que existe em pasta do `PATH` da máquina padrão (`/usr/bin`, `/usr/sbin` e semelhantes) e **não** é um comando do catálogo, mais os programas de longa duração tratados como processos pelo controle de processos (SPEC-029). Inclui o que um pacote instalado pelo `apt` simulado passa a oferecer |

Cada comando ou programa verificado é um **item** do manifesto.

### 3.4. Regras de negócio

- **RN-01 (um item por comando e por programa):** o manifesto tem pelo menos um item para cada comando e cada programa do catálogo real, sem exceção. Um item guarda: o nome, o tipo, o grupo, o comando a executar, o estado inicial necessário (arquivos ou usuário, quando preciso) e a expectativa.
- **RN-02 (expectativa verificável):** a expectativa de um item é o código de saída esperado (zero na maioria; diferente de zero nos casos em que o certo é falhar, como `false`) e, quando o comando tem saída estável, um trecho que a saída deve conter. Itens que dependem de relógio, de número de processo ou de sorteio verificam só o formato (por exemplo, "a saída tem uma data"), nunca o valor exato.
- **RN-03 (ajuda junto):** além do uso normal, todo comando é executado também com `--help` (SPEC-027), que deve terminar com sucesso e mostrar a linha de uso. Isso é um segundo passo do mesmo item, não um item à parte.
- **RN-04 (isolamento e tempo):** cada item roda com o estado inicial que declarou, sem depender do resultado de outro, e tem limite de 5 segundos. Programa de longa duração (`yes`, `watch`, `sleep`) é verificado até produzir a primeira saída (ou até o início do processo) e então interrompido pelo próprio verificador, de modo que a verificação termine sozinha. Estourar o tempo é falha do item.
- **RN-05 (nada de efeito fora do motor):** a verificação não faz requisição de rede, não grava no armazenamento do navegador e não altera nenhuma máquina de estudante. A máquina usada é criada em memória para a execução e descartada ao sair da tela ou ao executar de novo.
- **RN-06 (resultado honesto):** o selo "Em conformidade" só aparece se **todos** os itens do manifesto rodaram e passaram. Item não executado (por interrupção) conta como falha, nunca como aprovado.
- **RN-07 (a lista acompanha o catálogo):** um teste automatizado do repositório calcula o catálogo real (comandos e programas, como na seção 3.3) e o compara com o manifesto. Falta de item para algo do catálogo **ou** item de algo que não existe mais faz o teste falhar, com a mensagem listando os nomes. É esse teste que impede a lista de ficar desatualizada.
- **RN-08 (obrigação de manter):** todo comando ou programa novo, renomeado ou removido exige a atualização do manifesto **no mesmo commit** da spec que o cria. A regra entra em `ARCHITECTURE.md` (seção do motor), no `GLOSSARY.md` (termo "verificação de conformidade") e na "Definição de pronto" das specs que alteram o catálogo (SPEC-028 e SPEC-029, e as futuras).
- **RN-09 (só administrador):** a tela e o botão são do papel ADMIN. Para os demais papéis, a rota redireciona para a tela inicial.
- **RN-10 (reuso):** a verificação reaproveita o que já existe em vez de duplicar: o card de 200 comandos (SPEC-028, `commands200`) e as listas de verificação dos testes de comandos de `frontend/src/engine/` são a fonte inicial dos itens, para o manifesto não nascer em paralelo com eles.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema. Não se aplica nesta spec: nada é persistido no servidor nem no navegador.

Estrutura em memória (descrita em tabela, não é tabela de banco):

| Campo do item | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| nome | texto | Sim | único no manifesto | Nome do comando ou programa |
| tipo | enumeração | Sim | `command` ou `program` | Conforme a seção 3.3 |
| grupo | texto | Sim | | Agrupamento para a tabela (texto, arquivos, sistema, processos, rede, disco, usuários, pacotes etc.) |
| comando | texto | Sim | | O que é digitado no terminal |
| estado inicial | lista | Não | | Arquivos, pastas ou usuário que precisam existir antes do item |
| código esperado | inteiro | Sim | 0 a 255 | Código de saída esperado |
| trecho esperado | texto | Não | | Trecho que a saída deve conter |
| longa duração | booleano | Não | padrão falso | Se verdadeiro, verifica a primeira saída e interrompe (RN-04) |

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: não há endpoint nem evento de tempo real. O papel ADMIN vem da sessão que o frontend já tem.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| O manifesto ficar desatualizado | O teste da RN-07 falha no CI quando o catálogo e a lista divergem; a regra RN-08 vai para `ARCHITECTURE.md` e para as specs |
| Comando que depende de relógio, sorteio ou número de processo gerar falha intermitente | RN-02: esses itens verificam só o formato; o teste automatizado roda o manifesto várias vezes seguidas para pegar intermitência |
| Verificação lenta ou travada por programa de longa duração | RN-04: limite de 5 segundos por item e interrupção pelo verificador |
| Falsa segurança ("em conformidade" sem ter rodado tudo) | RN-06: só há selo verde se todos os itens rodaram e passaram; erro do motor mostra erro, não selo |
| A SPEC-028 e a SPEC-029 estão em rascunho e ainda mudam o catálogo | A verificação só vale para o catálogo que existir na implementação; a RN-07 protege contra a diferença. Esta spec só pode ser implementada depois delas, ou junto com elas (seção 9) |
| Interferir no motor ou em máquinas reais de estudantes | RN-05: máquina nova em memória, nada gravado, `legacy/` intacto |
| Primeira montagem do motor lenta no celular | Estado "Preparando o motor…" e progresso indeterminado até o primeiro item |

Impacto em módulos existentes: um link novo no `AppShell` (visível ao ADMIN), uma rota nova, uma função exportada por `frontend/src/engine/`. Nada no backend, nada em `legacy/`.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): ENQUANTO o usuário logado for ADMIN, O SISTEMA DEVE mostrar no cabeçalho o botão "Conformidade do motor" e, para TEACHER e STUDENT, NÃO DEVE mostrá-lo.
- [x] **CA-02** (indesejado): SE um usuário que não é ADMIN abrir `/app/admin/conformidade`, ENTÃO O SISTEMA DEVE redirecioná-lo à tela inicial sem executar a verificação (RN-09).
- [x] **CA-03** (evento): QUANDO o administrador abrir a tela, O SISTEMA DEVE criar uma máquina nova em memória e executar a verificação de todos os itens do manifesto, sem nenhum clique adicional, mostrando o andamento "N de M itens" (RN-01, RN-05).
- [x] **CA-04** (evento): QUANDO todos os itens rodarem e passarem, O SISTEMA DEVE mostrar o selo "Em conformidade" com texto e ícone, e os totais (RN-06).
- [x] **CA-05** (evento): QUANDO ao menos um item falhar, O SISTEMA DEVE mostrar "Fora de conformidade", a quantidade de falhas e, para cada falha, o comando executado, o esperado e o que o motor respondeu (limitado a 300 caracteres), com as falhas no topo da tabela.
- [x] **CA-06** (indesejado): SE um item falhar ou estourar o limite de 5 segundos, ENTÃO O SISTEMA DEVE registrar a falha daquele item e continuar com os seguintes (RN-04).
- [x] **CA-07** (indesejado): SE o motor não montar ou a verificação for interrompida por exceção, ENTÃO O SISTEMA DEVE mostrar a mensagem de erro com o motivo e o botão "Tentar de novo", sem exibir selo de conformidade; itens não executados contam como falha (RN-06).
- [x] **CA-08** (evento): QUANDO o administrador acionar "Executar de novo", O SISTEMA DEVE descartar a máquina e o resultado anteriores e repetir a verificação do zero.
- [x] **CA-09** (ubíquo): O SISTEMA DEVE ter no manifesto um item para cada comando do catálogo do motor e para cada programa (seção 3.3), e o teste automatizado do repositório DEVE falhar, listando os nomes, quando o catálogo e o manifesto divergirem em qualquer direção (RN-01, RN-07).
- [x] **CA-10** (ubíquo): O SISTEMA DEVE executar o `--help` de todo comando como parte do seu item e exigir sucesso e a linha de uso (RN-03).
- [x] **CA-11** (ubíquo): O SISTEMA DEVE verificar programas de longa duração até a primeira saída e interrompê-los sozinho, de modo que a verificação inteira termine (RN-04).
- [x] **CA-12** (ubíquo): O SISTEMA NÃO DEVE fazer requisição de rede, gravar no armazenamento do navegador, alterar máquina de estudante nem alterar arquivo de `legacy/` durante a verificação (RN-05).
- [x] **CA-13** (ubíquo): O SISTEMA DEVE manter a obrigação de atualizar o manifesto registrada em `ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das SPEC-028 e SPEC-029 (RN-08).
- [x] **CA-14** (ubíquo): O SISTEMA DEVE oferecer a tela com navegação por teclado, selo e estados com texto além da cor, alvos de 44px, região viva de progresso discreta e `prefers-reduced-motion` respeitado, sem texto solto fora de `src/messages/pt-BR.ts`.
- [x] **CA-15** (estado): ENQUANTO houver falha, O SISTEMA DEVE manter o filtro "Só falhas" marcado por padrão, e a busca por nome DEVE filtrar a tabela sem reexecutar a verificação.

## 8. Plano de Testes (Test Plan)

- **Backend:** não se aplica (sem backend).
- **Frontend, motor (Vitest, motor real):**
  - catálogo × manifesto, nas duas direções, com mensagem listando os nomes (cobre CA-09, RN-07);
  - o manifesto inteiro executado na máquina padrão passa (cobre CA-03, CA-04, RN-02); a ausência de intermitência foi conferida rodando esse teste várias vezes seguidas na entrega, pois cada execução leva cerca de 2,5 minutos;
  - `--help` de cada comando (cobre CA-10);
  - programa de longa duração termina sozinho dentro do limite (cobre CA-11);
  - item com falha e item que estoura o tempo são registrados e a execução continua, usando um manifesto de teste com itens propositalmente quebrados (cobre CA-05, CA-06);
  - interrupção por exceção não gera selo (cobre CA-07, RN-06);
  - a verificação não chama rede nem armazenamento (espiões em `fetch` e `localStorage`) (cobre CA-12).
- **Frontend, tela (Testing Library):**
  - botão visível só ao ADMIN e redirecionamento dos demais (cobre CA-01, CA-02);
  - execução automática ao abrir, progresso e selo verde (cobre CA-03, CA-04);
  - selo vermelho, tabela de falhas e detalhe do que se esperava e do que o motor respondeu (cobre CA-05);
  - erro do motor com "Tentar de novo" (cobre CA-07), "Executar de novo" (cobre CA-08);
  - filtros e busca (cobre CA-15); rótulos e foco por teclado (cobre CA-14).
- **Documentação:** teste simples que lê `ARCHITECTURE.md`, `GLOSSARY.md` e as SPEC-028 e SPEC-029 e confere a presença da regra de manutenção (cobre CA-13).
- **Manual:** abrir a tela como administrador em 360, 768 e 1280px, conferir selo, progresso e a rolagem da tabela; abrir como docente e confirmar o redirecionamento.
- **Cobertura:** meta acima de 80% no escopo da spec, medida com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, as SPEC-014, SPEC-027, SPEC-028 e SPEC-029, e o código em `frontend/src/engine/` (em especial `commands/index.ts`, `commands/registry.ts`, `commands/binaries.ts`, `commands/fixtures/commands200.ts`, `processes/binaries.ts` e `testkit.ts`), mais `frontend/src/components/AppShell/AppShell.tsx` e `src/messages/pt-BR.ts`.
2. **Ordem de execução:**
   1. Implementar depois que a SPEC-028 e a SPEC-029 estiverem `Implementadas` (ou junto, no mesmo ramo), porque o manifesto precisa cobrir o catálogo final.
   2. Criar o manifesto, partindo dos itens já existentes nos testes do motor (RN-10), e a função que o executa, em `frontend/src/engine/conformance/`.
   3. Criar o teste catálogo × manifesto (RN-07) e fazê-lo passar completando o manifesto.
   4. Criar a tela, o botão no cabeçalho e as mensagens em `pt-BR.ts`.
   5. Escrever a regra RN-08 em `ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das SPEC-028 e SPEC-029.
   6. Rodar Vitest, ESLint, Stylelint e `tsc`; fazer o roteiro manual.
3. **Arquivos e diretórios a criar ou alterar:**
   - criar `frontend/src/engine/conformance/` (manifesto, executor, tipos, testes);
   - criar `frontend/src/app/app/admin/conformidade/page.tsx` e o componente da tela com estilos e testes em `frontend/src/components/`;
   - alterar `frontend/src/components/AppShell/AppShell.tsx` (botão do ADMIN) e `frontend/src/messages/pt-BR.ts`;
   - alterar `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/features/028-...md` e `specs/features/029-...md` (somente a regra de manutenção);
   - alterar qualquer outro arquivo exige justificativa no resumo da entrega. `legacy/` é proibido.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Todas foram resolvidas em 10/10/2026, com as recomendações aceitas pelo Tech Lead, e entraram nas seções acima.

### 10.1. Decisões (aprovadas pelo Tech Lead em 10/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | A verificação roda ao abrir a tela, sem clique extra; "Executar de novo" repete (seção 3.1) |
| D-02 | O resultado não é guardado: sem histórico, tabela ou rota nesta spec. Histórico é spec futura |
| D-03 | "Programa" inclui o que um pacote instalado pelo `apt` simulado oferece. Cada pacote do catálogo do `apt` é verificado (instala, roda o programa, remove) dentro do limite de tempo e na máquina em memória (seção 3.3, RN-01) |
| D-04 | A regra de manutenção (RN-08) já foi escrita em `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-028 e SPEC-029 (só a linha da regra) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect | Criação em rascunho |
| 10/10/2026 | Aruna Architect | Pendências P-01 a P-04 viram decisões D-01 a D-04. Regra RN-08 registrada em ARCHITECTURE, GLOSSARY, SPEC-028 e SPEC-029. Aprovada pelo Tech Lead em 10/10/2026 |
| 11/10/2026 | Implementador (Claude) | Implementada: manifesto de 189 itens (183 comandos e 6 programas), executor, tela `/app/admin/conformidade`, botão do ADMIN e testes. Cada item parte do mesmo instantâneo da máquina preparada; o `--help` roda junto com o item. A verificação completa leva cerca de 2 a 3 minutos no navegador, com barra de progresso |
