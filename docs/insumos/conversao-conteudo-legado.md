# Insumo: conversão do conteúdo do legado para o banco de dados

**Natureza:** material de apoio para a redação de spec (não é spec nem fonte canônica).
**Destinatária:** Aruna Architect.
**Data:** 08/10/2026.
**Base:** Seção 3.3 da monografia (`docs/tcc/capitulos/03-arquitetura.tex`), código em `legacy/src/conteudo/` e decisões tomadas com o Tech Lead em 07/10/2026.
**Relação com outras specs:** complementa a SPEC-010 (gerenciamento de módulos de ensino), que trata de metadados, visibilidade, vigência e ordenação. Este insumo trata de **como o conteúdo que hoje está no código vira dados** nesses módulos.

O documento canônico `docs/arquitetura/transicao-backend.md` **não trata dessa migração**. A spec deve nascer da Seção 3.3 da monografia e deste insumo.

---

## 1. Objetivo

Hoje todo o material didático do simulador está escrito em TypeScript, em `legacy/src/conteudo/`: os módulos, as lições, os comandos de exemplo, os exercícios, o preparo do ambiente de cada exercício e a forma de corrigi-lo. Qualquer ajuste exige um programador.

A conversão transforma esse conteúdo em **dados no banco**. Assim, a plataforma já nasce com todo o material existente, e a docente passa a editá-lo pelas telas de autoria. A conversão roda **uma vez na instalação** (o *seed*) e pode ser executada de novo sem duplicar nada.

## 2. Inventário do que existe no legado

Medido em `legacy/src/conteudo/` (cerca de 4.800 linhas):

| Estrutura no legado | Quantidade | O que é |
| :--- | :--- | :--- |
| Tópicos (`Topico`) | 8 de estudo e 1 de simulado | História, Estrutura (FHS), Diretórios, Arquivos, Exclusão, Permissões, Usuários, Pacotes; e o Simulado |
| Lições (`Licao`) | cerca de 90 | Cards com comando, título, descrição, sintaxe, opções, exemplos, dicas, "na vida real" e "pegadinha" |
| Passos de comando (`Passo`) | cerca de 470 nos tópicos e 230 no simulado | Comando, explicação, terminal (1 a 3), login SSH e respostas a perguntas |
| Desafios dos tópicos | 42 | Exercícios práticos ao fim de cada tópico |
| Desafios do simulado | 180 | 6 modalidades × 30: Básico, Médio, Avançado, LPI Essentials, LPIC-1 e Servidor Escola |
| Questões de quiz (`QuestaoQuiz`) | 30 | Escolha única no estilo de certificação |
| Funções `preparar` | uma por tópico, mais as das modalidades | Montam o ambiente inicial por código |
| Tabela de pré-requisitos do motor do simulado (`MotorQuestoesSimulado`) | 62 regras | Preparam o ambiente de desafios específicos por ID |
| Adaptação de questões (`adaptar` e lógica genérica do motor) | 1 explícita e a lógica genérica | Renomeiam alvos quando uma questão já aparece como resolvida |
| Funções `verificar` | cerca de 220 | Corrigem os desafios inspecionando a máquina |
| Componentes interativos (`Widgets`) | 2 | Calculadora de permissões e anatomia do `ls -l` |

## 3. Mapeamento para o modelo de destino

Os termos seguem `specs/GLOSSARY.md`. Termos ausentes do glossário estão listados na seção 7.

### 3.1. Tópico → módulo de ensino

| Origem (`Topico`) | Destino |
| :--- | :--- |
| `titulo`, `subtitulo`, `resumo` | Título e descrição do módulo de ensino |
| `icone`, `cor`, `numero` | Ícone, cor e ordem de exibição |
| `conceitos` (HTML) | Bloco legado (ver 4.3) |
| `naPratica` do tópico | Bloco de texto ("Na vida real") |
| `demonstracao` (lista de passos) | Bloco de comando no início do módulo |
| `preparar` do tópico | Cenário do módulo (ver 4.1) |
| `licoes` | Blocos, em ordem (ver 3.2) |
| `desafios` | Questões do banco do módulo, com uso **exercício** |

### 3.2. Lição → blocos

Cada lição vira um grupo ordenado de blocos:

- **descrição e sintaxe** → bloco de texto;
- **exemplos** (`Passo`) → bloco de comando, com comando, explicação, terminal, login e respostas. A animação do "Rodar este card" é gerada a partir desses dados, sem configuração extra;
- **opções** → bloco de texto com uma tabela;
- **dicas** → bloco de dica;
- **naPratica** e **pegadinha** → bloco de curiosidades ou de dica (pendência 6);
- **extra** (`calculadora-permissoes` ou `anatomia-ls`) → bloco de componente interativo, apontando para o catálogo.

### 3.3. Desafio → questão prática

| Origem (`Desafio`) | Destino (`Question`, tipo `PRACTICAL`) |
| :--- | :--- |
| `id` (ex.: `bas-fac-1`) | Chave de origem do legado, usada na reexecução idempotente (ver 5) |
| `nivel` | `DifficultyLevel` (`EASY`, `MEDIUM`, `HARD`) |
| `enunciado`, `dica` | Enunciado e dica |
| `solucao` (passos) | `ReferenceSolution` |
| `preparar` e regras da tabela de pré-requisitos | `Scenario` (ver 4.1) |
| `verificar` | Condições de validação declarativas (ver 4.2) |
| `adaptar` | **Descartado** (ver 4.1) |

### 3.4. Simulado

- Os 180 desafios e as 30 questões de quiz entram como questões com uso **avaliação**.
- As **6 modalidades** viram 6 **modelos de avaliação** (`AssessmentTemplate`) de 30 questões fixas.
- O `preparar` de cada modalidade vira o **cenário base**, e o cenário de cada desafio **herda** dele.
- A spec deve decidir se as questões do simulado formam um módulo de ensino próprio ("Simulados de certificação") ou se cada desafio vai para o módulo do assunto (pendência 5). Recomendação: módulo próprio, que preserva a correspondência um a um com o legado.

### 3.5. Quiz → questão teórica

Cada `QuestaoQuiz` vira uma `Question` do tipo `THEORETICAL`, subtipo escolha única: `pergunta` → enunciado; `opcoes` → alternativas; `correta` → alternativa correta; `explicacao` → explicação. O campo `certificacao` pode virar uma etiqueta.

## 4. As três conversões difíceis

### 4.1. Preparo do ambiente (`preparar`) → cenário

**Problema:** o preparo é **código** (criar diretórios, arquivos, usuários e permissões) e está espalhado em três lugares: o `preparar` do tópico ou da modalidade, o `preparar` do desafio e a tabela de 62 regras do motor do simulado.

**Solução: executar e capturar, em vez de traduzir.** O extrator cria uma máquina simulada nova, executa o preparo na mesma ordem que o motor executa hoje e serializa o estado resultante com o `Serializador` que já existe no legado. Esse estado serializado é o cenário. Nenhuma função de preparo precisa ser reescrita à mão.

**Herança:** o cenário do tópico ou da modalidade vira o **cenário base**; o cenário de cada desafio vira um **cenário derivado**, que guarda só a diferença em relação à base.

**Fim da adaptação:** a tabela de 62 regras e a adaptação existem porque hoje **vários desafios dividem a mesma máquina**. Com **uma máquina por questão** (Seção 3.3.5 da monografia), cada regra da tabela é incorporada ao cenário da questão a que se refere, e a adaptação (renomear `projeto1` para `projeto2`, por exemplo) deixa de ser necessária e **não é migrada**.

### 4.2. Correção (`verificar`) → condições declarativas

**Problema:** cada `verificar` é uma função. A docente não escreve código, e a validação *offline* (envelope de *hashes*) exige que as condições sejam **dados**.

**Levantamento:** das cerca de 220 funções,

- **a maioria combina apenas os verificadores de `Verificar.ts`**, com 14 tipos: arquivo existe, diretório existe, *link* e seu alvo, não existe, conteúdo igual, conteúdo contém, permissão, dono, grupo do arquivo, usuário existe, membro de grupo, grupo existe, diretório vazio e nó genérico;
- **cerca de 40 usam lógica extra:** conteúdo igual depois de remover espaços, conteúdo não vazio, bits especiais de permissão (por exemplo 1777), usuário com senha definida ou bloqueado, pacote instalado ou removido, serviço ativo ou habilitado, listas de pacotes atualizadas, e listas do tipo "todos estes diretórios existem".

**Solução:**

1. **Catálogo fechado de tipos de condição**, que é também o que a interface de autoria oferece à docente. Ele cobre os 14 verificadores existentes e os casos extras acima, somando cerca de 22 tipos. Cada condição é um tipo com parâmetros (caminho, valor esperado, usuário etc.), e a questão é aprovada quando todas as condições são atendidas.
2. **Conversão em duas vias:**
   - os `verificar` que usam apenas tipos do catálogo são convertidos automaticamente;
   - para os demais, o extrator gera uma **sugestão** pela comparação entre o cenário e o estado depois da solução de referência (o mesmo mecanismo da validação sugerida na autoria) e marca a questão como **revisão pendente**, para conferência humana antes da publicação.
3. **Prova de equivalência.** Uma condição convertida só é aceita se der o mesmo resultado do `verificar` original em três situações:
   - **aprovar** a solução de referência;
   - **aprovar** todas as formas alternativas já cadastradas na suíte do legado (`simulado_formas_alternativas.test.ts`, com mais de 180 soluções alternativas);
   - **reprovar** o cenário intocado, ou seja, a questão não pode nascer resolvida.

   Assim, os testes do legado viram o critério de aceite da conversão.

### 4.3. Visual em HTML e componentes interativos

- **Textos de conceitos em HTML** (cartões de curiosidade, vídeo recomendado, passos numerados, cartões de distribuições, tabelas e a linha anotada do `ls -l`) entram como **bloco legado**. O bloco é filtrado para manter apenas as marcações e classes visuais conhecidas e remover qualquer *script*. O estudante vê o conteúdo como hoje, e a docente o converte para blocos tipados quando editar o módulo.
- **O vídeo do YouTube embutido no HTML do tópico Permissões** pode ser extraído para o campo de vídeo do bloco, com o roteiro de tempos. É um caso único e pode ser tratado pelo extrator ou manualmente.
- **Calculadora de permissões e anatomia do `ls -l`** continuam como **código**, no catálogo de componentes interativos. O *seed* grava apenas a referência ao componente e os parâmetros.

## 5. Fluxo do *seed*

1. **Extração (lado do legado):** um extrator executa o conteúdo do legado (que é código), roda os preparos, serializa os cenários, converte as validações e gera **um único artefato de dados versionado**, acompanhado de um **relatório de conversão**.
2. **Relatório de conversão:** informa quantos módulos, blocos, questões e cenários foram gerados, quais validações foram convertidas automaticamente, quais ficaram em revisão pendente e o resultado da prova de equivalência de cada questão.
3. **Importação (lado do backend):** um comando de carga lê o artefato e grava tudo em uma **transação**, usando a chave de origem do legado (por exemplo `bas-fac-1`) como identidade natural. Rodar de novo **não duplica** registros e **não sobrescreve** o que a docente já editou; itens novos do artefato são acrescentados.
4. **Situação inicial:** questões cuja prova de equivalência passou nascem **publicadas**; as que ficaram em revisão nascem como **rascunho**; os 6 modelos do simulado nascem prontos para aplicação.

## 6. Critérios de aceite sugeridos

1. Todo tópico, lição, passo, desafio e questão de quiz do legado aparece no banco, com a contagem conferida pelo relatório de conversão.
2. Para cada questão prática, a solução de referência aplicada ao cenário passa na validação convertida.
3. Todas as formas alternativas da suíte do legado passam na validação convertida.
4. Nenhuma questão passa na validação com o cenário intocado.
5. Executar o *seed* duas vezes produz o mesmo banco, sem duplicatas.
6. Editar uma questão e executar o *seed* de novo não desfaz a edição.
7. Nenhum bloco legado contém *script* depois da filtragem.
8. A suíte do `legacy/` continua passando (`ARCHITECTURE.md`, seção 5).

## 7. Pendências para o Tech Lead

1. **Glossário.** A SPEC-010 usa "módulo de ensino" (módulo de backend `course_module`), mas o termo ainda não está em `GLOSSARY.md`. Também faltam: **bloco** e seus tipos, **componente interativo**, **trecho de vídeo**, **link útil**, **condição de validação** e o **uso** da questão (exercício ou avaliação). Atenção à ambiguidade com "módulo de domínio" do `ARCHITECTURE.md`.
2. **Exercício × questão** (conflito 2 do glossário). Este insumo assume a proposta do glossário: tudo vira `Question`, e "exercício" passa a ser apenas o **uso** da questão.
3. **Onde roda o extrator.** O conteúdo é código TypeScript que só executa com o motor do legado. Isso esbarra na regra de não alterar `legacy/` sem spec e na decisão em aberto sobre o reaproveitamento do motor POSIX/VFS (`ARCHITECTURE.md`, seção 6). Recomendação: a spec autoriza um extrator dentro de `legacy/` que apenas **lê** o conteúdo e gera o artefato, de modo que o backend nunca importe código do legado.
4. **Formato e local do artefato versionado**, e se a importação é um comando separado das migrações do goose. Recomendação: separado (a migração cria a estrutura; o *seed* carrega o conteúdo).
5. **Simulado:** módulo de ensino próprio ou distribuição pelos módulos de assunto (ver 3.4).
6. **"Pegadinha" e "na vida real":** viram bloco de curiosidade ou bloco de dica.
7. **Armazenamento de imagens:** o legado não tem imagens enviadas por usuários, então o MinIO não participa do *seed*. Ele deve constar como dependência na spec de autoria de blocos.
