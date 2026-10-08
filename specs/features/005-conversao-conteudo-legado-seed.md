# SPEC-005: Extração do Conteúdo Legado e Prova de Equivalência

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-005 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Legado (somente leitura) e artefato de dados |
| **Módulo** | `legacy/scripts/extract` |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Alta |
| **Depende de** | SPEC-010 (módulos de ensino) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Seção 3.3 da monografia (`docs/tcc/capitulos/03-arquitetura.tex`); insumo `docs/insumos/conversao-conteudo-legado.md`; código em `legacy/src/conteudo/` |

> **Divisão aprovada pelo Tech Lead em 08/10/2026:** a SPEC-005 original foi dividida em três. Esta spec (005) extrai o conteúdo e prova a equivalência das correções; a **SPEC-011** cria o banco de conteúdo, o motor de correção em Go e a carga (seed); a **SPEC-012** lê e exibe o conteúdo. Ordem: 005 → 011 → 012.

---

## 1. Contexto e Problema (Context & Problem Statement)

Todo o material didático do simulador está escrito em TypeScript em `legacy/src/conteudo/` (cerca de 5.600 linhas): 8 tópicos de estudo e 1 de simulado, cerca de 90 lições, cerca de 700 passos de comando, 42 desafios de tópico, 180 desafios do simulado em 6 modalidades, 30 questões de quiz, as funções que preparam o ambiente e cerca de 220 funções que corrigem os desafios. Qualquer ajuste exige um programador, e a correção roda no navegador, o que permite fraude.

Para a plataforma nascer com esse material e a docente passar a editá-lo, o conteúdo precisa virar **dados**. Como ele é código (preparos e correções são funções), a conversão não pode ser uma tradução manual: precisa executar o legado, capturar o resultado e provar que as correções convertidas decidem igual às originais.

## 2. Objetivos (Goals)

- Gerar, a partir do legado, **um único artefato de dados versionado** (manifesto) com módulos, blocos, cenários, questões e modelos de avaliação.
- Capturar os ambientes de partida **executando** os preparos do legado e serializando o estado com o `Serializador` existente (cenários).
- Converter cada função `verificar` em uma lista de **condições de validação declarativas** do catálogo fechado definido na SPEC-011.
- **Provar a equivalência** de cada conversão contra a solução de referência, contra todas as formas alternativas da suíte do legado e contra o cenário intocado.
- Gerar um **relatório de conversão** legível, com contagens, pendências de revisão e o resultado da prova de cada questão.
- Exportar **fixtures de equivalência** (estados antes e depois de cada solução, com o resultado esperado) para que o motor de correção em Go (SPEC-011) seja testado contra o mesmo veredito.

### 2.1. Fora de escopo (Non-Goals)

- Tabelas, motor de correção em Go e importação no banco: SPEC-011.
- Telas de leitura do conteúdo: SPEC-012.
- Telas de autoria (edição de blocos e questões pela docente).
- Alterar qualquer arquivo existente em `legacy/`: o extrator só **lê**.
- Migrar a função `adaptar` e a lógica de adaptação do motor do simulado: com uma máquina por questão, elas deixam de existir (insumo, seção 4.1).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não se aplica nesta spec.

### 3.2. Extrator (TypeScript, dentro de `legacy/`)

O extrator fica em `legacy/scripts/extract/`, roda com o Vitest já instalado no legado, por meio de uma configuração própria (`vitest.extract.config.ts`), sem nova dependência. Ele importa o conteúdo e o motor do legado em modo somente leitura.

Regras:

- **RN-01 (inventário):** percorre `CatalogoDeTopicos`, as modalidades do simulado e o quiz e gera um item para cada tópico, lição, passo, desafio e questão, com a chave de origem do legado (por exemplo, `bas-fac-1`) como identidade estável.
- **RN-02 (módulos e blocos):** cada tópico vira um módulo de ensino (SPEC-010) com título, descrição, ícone, cor e ordem. Cada lição vira um grupo ordenado de blocos tipados (catálogo de blocos da SPEC-011):
  - descrição e sintaxe → `TEXT`;
  - exemplos → `COMMAND`, com comando, explicação, terminal, login e respostas;
  - opções → `TEXT` com tabela;
  - dicas → `TIP`;
  - "na vida real" → `CURIOSITY` e "pegadinha" → `TIP` com destaque de alerta;
  - componente extra → `WIDGET` com a referência do componente (`PERMISSION_CALCULATOR` ou `LS_ANATOMY`).
  
  Os conceitos em HTML de cada tópico viram `LEGACY_HTML`, já filtrados pela lista de marcações permitidas (RN-08).
- **RN-03 (simulado):** os 180 desafios e as 30 questões do quiz formam um módulo de ensino próprio, "Simulados de certificação", com uso `ASSESSMENT`. As 6 modalidades viram 6 modelos de avaliação de 30 questões fixas cada.
- **RN-04 (cenários):** para cada questão prática, o extrator cria uma máquina nova, executa o preparo na mesma ordem do motor do legado (preparo do tópico ou da modalidade, preparo do desafio e regras da tabela de pré-requisitos do `MotorQuestoesSimulado`) e serializa o resultado. O preparo do tópico ou da modalidade gera o **cenário base**; o de cada desafio gera um **cenário derivado**, com referência ao base. Nesta fase, o derivado guarda o estado completo, e não só a diferença.
- **RN-05 (conversão de correções):** cada `verificar` é convertido em condições do catálogo da SPEC-011 por uma tabela de tradução escrita no extrator, uma entrada por desafio. Desafios sem tradução automática recebem uma **sugestão** gerada pela diferença entre o cenário e o estado depois da solução de referência e ficam com status de revisão pendente.
- **RN-06 (prova de equivalência):** cada lista de condições só é aceita se, avaliada pelo avaliador TypeScript do catálogo, (a) **aprovar** o estado depois da solução de referência, (b) **aprovar** o estado depois de cada forma alternativa cadastrada em `legacy/tests/simulado_formas_alternativas.test.ts` e (c) **reprovar** o cenário intocado. Os vereditos são comparados com o `verificar` original nos mesmos estados; qualquer divergência rebaixa a questão para revisão pendente.
- **RN-07 (status inicial):** questão com prova aprovada sai como `PUBLISHED`; com revisão pendente, como `DRAFT`.
- **RN-08 (HTML seguro):** o HTML legado passa por uma lista fechada de marcações e classes visuais; *scripts*, atributos de evento e URLs `javascript:` são removidos. O backend repete a filtragem na importação (SPEC-011), como defesa em profundidade.
- **RN-09 (artefato):** o manifesto é gravado em `backend/internal/modules/content/seed/data/content_manifest.json`, com campo de versão do formato, data de geração e *hash* do conteúdo. O relatório vai para `content_report.md`, e as fixtures de equivalência para `equivalence_fixtures.json`, no mesmo diretório.
- **RN-10 (reprodutibilidade):** duas execuções seguidas sobre o mesmo legado geram artefatos idênticos byte a byte (ordenação estável e nenhum carimbo de tempo dentro dos itens).

## 4. Modelo de Dados (Data Model)

Não há tabelas nesta spec. O formato do manifesto segue as entidades da SPEC-011:

| Seção do manifesto | Conteúdo |
| :--- | :--- |
| `formatVersion`, `generatedFrom`, `contentHash` | Metadados de versão e rastreabilidade |
| `modules` | Chave de origem, título, descrição, ícone, cor, ordem e lista ordenada de blocos (tipo e conteúdo) |
| `scenarios` | Chave de origem, chave do cenário base (opcional) e estado serializado da máquina |
| `questions` | Chave de origem, módulo, tipo, uso, nível, enunciado, dica, cenário, solução de referência, condições de validação ou alternativas e gabarito, status inicial |
| `assessmentTemplates` | Chave de origem, título, descrição, duração, nota máxima e lista ordenada de questões com peso |

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint é criado.

## 6. Impacto e Riscos (Impact & Risks)

- **Alterar o legado sem querer.**
  *Mitigação:* o extrator só lê; o único conteúdo novo em `legacy/` é `legacy/scripts/extract/` e a configuração `vitest.extract.config.ts`. A revisão do commit confirma que nenhum arquivo existente mudou.
- **Correção convertida aprovando ou reprovando diferente da original.**
  *Mitigação:* prova de equivalência (RN-06) e rebaixamento para rascunho em qualquer divergência.
- **Motor em Go divergindo do avaliador TypeScript.**
  *Mitigação:* as fixtures de equivalência (RN-09) viram testes obrigatórios do motor em Go na SPEC-011.
- **HTML legado com código executável.**
  *Mitigação:* filtragem por lista fechada na extração e de novo na importação (RN-08).

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: QUANDO o extrator for executado, O SISTEMA DEVE gerar o manifesto com todos os tópicos, lições, passos, desafios, questões de quiz e modalidades do legado, e o relatório DEVE trazer as contagens de cada um.
- [x] **CA-02**: QUANDO o extrator for executado duas vezes seguidas, os três artefatos DEVEM ser idênticos byte a byte.
- [x] **CA-03**: Para cada questão prática `PUBLISHED`, as condições convertidas DEVEM aprovar o estado depois da solução de referência e de todas as formas alternativas cadastradas, e DEVEM reprovar o cenário intocado.
- [x] **CA-04**: SE alguma etapa da prova falhar ou divergir do `verificar` original, ENTÃO a questão DEVE sair como `DRAFT` e constar no relatório com o motivo.
- [x] **CA-05**: Todo cenário derivado DEVE referenciar o seu cenário base.
- [x] **CA-06**: Nenhum bloco `LEGACY_HTML` do manifesto DEVE conter `<script`, atributos `on*` ou URLs `javascript:`.
- [x] **CA-07**: O extrator NÃO DEVE alterar nenhum arquivo existente em `legacy/`.
- [x] **CA-08**: As fixtures de equivalência DEVEM conter, para cada questão prática, os estados testados e o veredito esperado.

## 8. Plano de Testes (Test Plan)

- **Extrator (Vitest, dentro de `legacy/`):** testes do avaliador TypeScript para cada tipo de condição (positivo e negativo); da tabela de tradução sobre uma amostra de cada tópico; da filtragem de HTML com *scripts*, eventos e `javascript:` (CA-06); e de reprodutibilidade (CA-02).
- **Prova de equivalência:** a própria execução é o teste de CA-03 e CA-04; o relatório lista o resultado por questão.
- **Inspeção:** `git status` depois da execução mostra só arquivos novos (CA-07).
- **Cobertura:** acima de 80% nas funções do extrator (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** insumo `docs/insumos/conversao-conteudo-legado.md`, SPEC-010, SPEC-011 (catálogo de blocos e condições) e o código de `legacy/src/conteudo/`, `legacy/src/linux/Serializador.ts` e `legacy/src/app/MotorQuestoesSimulado.ts`.
2. **Ordem:** avaliador TypeScript do catálogo → captura de cenários → tabela de tradução das correções → prova de equivalência → montagem de módulos e blocos → filtragem de HTML → escrita dos três artefatos.
3. **Arquivos a criar:** `legacy/scripts/extract/` (código e testes), `legacy/vitest.extract.config.ts` e os três artefatos em `backend/internal/modules/content/seed/data/`.
4. **Definição de pronto:** CA-01 a CA-08 verificados e relatório revisado pelo Tech Lead.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-07 aprovadas pelo Tech Lead em 08/10/2026 (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação (versão única com extração, banco, seed e exibição) |
| 08/10/2026 | Implementador (Claude) | Divisão aprovada pelo Tech Lead: esta spec fica com a extração e a prova de equivalência; banco, motor de correção e carga vão para a SPEC-011; leitura e exibição, para a SPEC-012. Alinhada à SPEC-010 (módulos de ensino), ao insumo `docs/insumos/conversao-conteudo-legado.md` e ao congelamento do legado. Pendências P-01 a P-07 |
| 08/10/2026 | Tech Lead | Aprovação integral das recomendações P-01 a P-07. Status: `Aprovada` |
| 08/10/2026 | Implementador (Claude) | Implementação concluída; status `Implementada`. **Resultado:** 9 módulos, 394 blocos, 236 cenários, 222 questões práticas e 30 teóricas, 7 modelos de avaliação; 204 de 222 correções traduzidas automaticamente; 61 questões provadas também contra as 183 formas alternativas; **190 questões publicadas** (prova aprovada, sem nenhuma divergência entre condição e correção original) e **32 em rascunho**. **Verificação:** 43 testes do extrator (cobertura de 94% das instruções e 90% dos ramos, medida com o Vitest do frontend, porque o legado não tem provedor de cobertura e o `package.json` dele está congelado); artefatos idênticos byte a byte em execuções seguidas; nenhum HTML perigoso nos 646 blocos e enunciados; todos os 222 cenários derivados apontam para um base; `git status` mostra só arquivos novos em `legacy/`. **Rascunhos por motivo:** 13 cenários já nascem resolvidos (no legado dependiam da adaptação de alvo, que não é migrada) e precisam de revisão da docente; 18 usam lógica fora do catálogo aprovado (contagem de linhas: 7; negação de conteúdo: 4; "nenhum pacote atualizável": 4; alternativa com "ou": 3, com um caso que soma dois motivos; sessão aberta: 1); 1 (`arq-6`) tem a solução de referência falhando mesmo com o cenário encadeado. **Desvios:** (1) manifesto e fixtures gravados compactados (`content_manifest.json.gz` e `equivalence_fixtures.json.gz`), porque os 236 estados completos somam 19 MB em JSON puro; (2) a tradução das correções é automática, lendo o código de cada função `verificar` e reconhecendo as expressões do `Verificar` (com expansão de listas `.every` e substituição de constantes), em vez de uma tabela escrita à mão por desafio; não foi preciso nenhuma entrada manual; (3) 10 desafios de tópico dependem dos anteriores (no legado todos dividem uma máquina): o cenário deles aplica antes as soluções dos desafios anteriores do mesmo tópico; (4) o quiz teórico vira um 7º modelo de avaliação, além dos 6 práticos; (5) a lista própria do tópico "simulado" repete a modalidade "Servidor Escola" e é ignorada; (6) relógio, `performance` e números aleatórios são congelados durante a extração, para a reprodutibilidade. **Sugestão para revisão futura do catálogo (SPEC-011):** os tipos `CONTENT_NOT_CONTAINS`, `CONTENT_LINE_COUNT`, `ANY_OF` e `PACKAGES_UP_TO_DATE` recuperariam 17 dos 18 rascunhos por falta de tipo. |
