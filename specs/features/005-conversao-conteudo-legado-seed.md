08-10-26-spec-conversao-conteudo-legado-seed-dinamico.md

# Tech Spec / SDD: Conversão de Conteúdo Didático Legado em Dados e Mecanismo de Carga Inicial

**Data:** 08/10/2026

**Escopo:** Ambos

**Módulo:** content

**Contexto de Tela (se aplicável):** /app/content e /app/assessment-templates

**Prioridade sugerida:** Alta

---

## 1. Contexto e Problema (Context & Problem Statement)

A base didática do simulador educacional encontra-se inteiramente codificada de maneira estática em TypeScript. Tópicos de estudo, lições, passos demonstrativos, exercícios práticos, suítes de validação programática e questões teóricas residem no diretório legado, totalizando milhares de linhas de código rígido. Qualquer ajuste ortográfico, inclusão de nova abordagem explicativa ou alteração em gabaritos exige intervenção manual de desenvolvimento e reconstrução da aplicação.

Essa rigidez técnica inviabiliza as ferramentas de autoria docente e a montagem dinâmica de avaliações parametrizadas descritas na Seção 3.3 da monografia. Para que o corpo docente possa criar, versionar e gerir conteúdos de forma autônoma sem perder o material didático já consolidado e validado pela suíte de testes, faz-se indispensável converter o acervo estático em estruturas relacionais persistidas no banco de dados. A falta desse mecanismo de conversão e carga inicial (seed) impede o avanço das funcionalidades de autoria, bloqueia a criação de bancos de questões parametrizados e inviabiliza a montagem de exames.

---

## 2. Objetivos (Goals)

* Extrair o acervo estático do ambiente legado sem violar a integridade da suíte de testes.


* Executar e serializar programaticamente as rotinas de preparação de ambiente do legado em estruturas canônicas de cenários isolados.


* Mapear as funções imperativas de verificação do legado em um catálogo declarativo estruturado de condições de validação legíveis para asserções de retaguarda e envelopes criptográficos.


* Estabelecer a equivalência estrita de aprovação das condições declarativas geradas frente à solução oficial de referência e a todas as soluções alternativas pré-existentes.


* Estruturar os dados extraídos em modelos relacionais normalizados contendo tópicos didáticos, blocos com tipagem semântica, banco de questões com distinção de uso e modelos de avaliação.


* Implementar um comando de carga inicial (seed) idempotente na plataforma de retaguarda, capaz de ingerir o artefato gerado sem duplicar registros ou sobrescrever dados editados por docentes.


* Higienizar fragmentos visuais de conteúdo em formato HTML, neutralizando qualquer instrução de script e preservando apenas formatações aceitas no catálogo institucional.



---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

O frontend consome a estrutura dinâmica carregada no banco de dados e substitui a leitura de arquivos estáticos legados:

* **Renderizador de Blocos Dinâmicos:** componente genérico encarregado de iterar a lista ordenada de blocos associados a uma unidade de conteúdo. Para cada bloco, invoca o componente especializado correspondente (texto com formatação enriquecida, comandos interativos acoplados ao terminal, orientações em destaque, curiosidades contextuais ou passos instrucionais numerados).


* **Integração de Componentes do Catálogo:** preservação dos componentes funcionais (calculadora interativa de permissões e inspeção visual da saída de listagem de arquivos), associando-os aos parâmetros declarativos fornecidos pela carga.


* **Filtragem Segura de Marcação:** módulo utilitário de higienização de marcação textual responsável por processar blocos legados, eliminando propriedades perigosas e retendo classes estruturais homologadas.


* **Padronização Visual:** folhas de estilo associadas aos blocos estruturadas sob SCSS Modules em co-location, utilizando tokens semânticos centralizados para bordas, fundos e tipografia, mantendo compatibilidade nos modos claro e escuro.

### 3.2. Backend (Go — Camada de Módulo/Service)

A arquitetura no backend Go estabelece a ingestão e o gerenciamento dos conteúdos no módulo de domínio correspondente:

* **Script Utilitário de Extração (Ambiente Legado):** script isolado no ecossistema legado encarregado de instanciar o sistema de arquivos virtual em memória, invocar as rotinas de preparação na ordem homologada, capturar o estado resultante através do serializador já existente e mapear as funções de verificação para o catálogo declarativo. O resultado é exportado como um manifesto estruturado versionado, acompanhado de sumário de auditoria.


* **Validador de Equivalência de Asserções:** componente do extrator que submete as condições declarativas propostas a três verificações obrigatórias: validação positiva com a solução de referência, validação positiva com todas as formas alternativas cadastradas e validação negativa com o cenário intocado. Questões com divergência são sinalizadas com pendência de revisão e marcadas com estado de rascunho.


* **Comando de Ingestão e Carga (Seed):** rotina de linha de comando no backend Go desacoplada das migrações estruturais do banco de dados. Executa sob transação relacional atômica utilizando o padrão transacional configurado.


* **Mapeamento e Idempotência:** utilização das chaves identificadoras originais do legado como chaves naturais de conciliação. Na execução do comando, registros inexistentes são inseridos; registros existentes sem alteração por docentes são atualizados com metadados do pacote; registros que possuam indicação de modificação manual docente são integralmente preservados.


* **Tratamento de Erros:** mapeamento de inconsistências no manifesto, corrupção sintática de arquivos e falhas de persistência utilizando o envelope padronizado de Problem Details (RFC 7807).



---

## 4. Modelo de Dados (Data Model)

A modelagem de dados situa-se no schema relacional `project-manager`:

* **Tabela `study_topics`:**
* Armazena as unidades temáticas de estudo.


* Colunas: identificador primário UUIDv7, chave de reconciliação de origem (texto, única, indexada), título (texto, não nulo), descrição resumida (texto, não nulo), identificador do ícone institucional (texto, não nulo), identificador cromático (texto, não nulo), ordem ordinal de exibição (inteiro, não nulo), chave do cenário base (UUIDv7, opcional), carimbos de criação, atualização e exclusão lógica.




* **Tabela `content_blocks`:**
* Armazena os blocos ordenados de cada tópico de estudo.


* Colunas: identificador primário UUIDv7, chave estrangeira para `study_topics` (UUIDv7, não nula), tipo de bloco (enum: TEXT, COMMAND, TIP, CURIOSITY, STEP_BY_STEP, CARDS, WIDGET, LEGACY_HTML), ordem sequencial (inteiro, não nulo), payload estruturado em JSONB contendo os dados específicos do tipo de bloco (textos, tabelas, comandos, parâmetros de componentes ou HTML higienizado), carimbos de criação e atualização.


* Índices: índice composto sobre tópico e ordem sequencial para acelerar a renderização da trilha.


* **Tabela `scenarios`:**
* Armazena as estruturas de ambiente e receitas de montagem do sistema de arquivos virtual.


* Colunas: identificador primário UUIDv7, chave de reconciliação de origem (texto, opcional, indexada), chave estrangeira para cenário ascendente (UUIDv7, opcional, autorreferenciada para suporte à herança em camadas), snapshot estruturado em JSONB (árvore de nós, propriedades de permissão, contas de usuário e grupos), carimbos de criação e atualização.




* **Tabela `questions`:**
* Banco unificado de itens teóricos e práticos.


* Colunas: identificador primário UUIDv7, chave de reconciliação de origem (texto, única, indexada), chave estrangeira para `study_topics` (UUIDv7, não nula), tipo da questão (enum: PRACTICAL, THEORETICAL_SINGLE, THEORETICAL_MULTIPLE, THEORETICAL_BOOLEAN, DISCURSIVE), finalidade de uso (enum: EXERCISE, ASSESSMENT), nível de dificuldade (enum: EASY, MEDIUM, HARD), status de publicação (enum: DRAFT, PUBLISHED, ARCHIVED), título (texto, não nulo), enunciado em Markdown (texto, não nulo), texto de dica (texto, opcional), chave estrangeira para `scenarios` (UUIDv7, opcional, aplicável a questões práticas), passos da solução de referência em JSONB (opcional), lista declarativa de condições de validação em JSONB (opcional), alternativas e gabarito em JSONB (aplicável a questões teóricas), indicador booleano de modificação manual docente, carimbos de criação, atualização e exclusão lógica.


* Índices: índices compostos para filtragem por tópico, finalidade de uso, nível de dificuldade e status de publicação.




* **Tabela `assessment_templates`:**
* Modelos reutilizáveis de provas e simulados.


* Colunas: identificador primário UUIDv7, chave de reconciliação de origem (texto, única, indexada), título (texto, não nulo), descrição (texto, não nulo), duração regulamentar em minutos (inteiro, não nulo), nota máxima atribuída (decimal, não nulo), status de disponibilidade (enum: ACTIVE, ARCHIVED), carimbos de criação, atualização e exclusão lógica.




* **Tabela `assessment_template_questions`:**
* Composição fixa de questões associadas aos modelos de simulado.


* Colunas: identificador primário UUIDv7, chave estrangeira para `assessment_templates` (UUIDv7, não nula), chave estrangeira para `questions` (UUIDv7, não nula), ordem ordinal na avaliação (inteiro, não nulo), peso individual atribuído (decimal, não nulo).


* Constraints: unicidade composta entre modelo de avaliação e questão.



---

## 5. Contrato de API (API Contract)

Sem endpoints novos voltados ao usuário final nesta especificação. A funcionalidade é executada internamente via comando de carga inicial (seed) acionado por utilitário de console do backend Go e por rotinas internas de consulta dos módulos.

---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Quebra na Execução da Suíte Legada:** a criação do script extrator alterar arquivos de regras ou a árvore original do simulador client-side, quebrando testes existentes.


*Mitigação:* O extrator deve operar estritamente em modo de leitura sobre o diretório legado, utilizando chamadas idempotentes e gerando o manifesto de saída sem modificar nenhum arquivo fonte ou de teste.


* **Risco de Divergência entre Validação Imperativa e Declarativa:** funções antigas de verificação utilizarem lógicas customizadas complexas que não se adaptem ao catálogo declarativo, provocando aprovações ou reprovações indevidas.


*Mitigação:* Aplicação compulsória da prova de equivalência tripla no extrator (solução canônica, soluções alternativas cadastradas e cenário inicial). Questões com qualquer inconsistência são marcadas com estado de rascunho para auditoria e aprovação docente antes da entrada em produção.


* **Risco de Sobrescrita de Modificações Docentes em Reexecuções de Carga:** reexecutar a carga em ambiente já populado sobrescrever alterações efetuadas pelos professores na interface.


*Mitigação:* Avaliação obrigatória do indicador booleano de modificação manual antes de aplicar atualizações vindas do manifesto, preservando alterações humanas de forma definitiva.


* **Risco de Execução de Scripts Maliciosos via Conteúdo Histórico:** fragmentos HTML legados possuírem vetores de script que venham a ser executados nos navegadores dos estudantes.


*Mitigação:* Passagem obrigatória de todo conteúdo HTML por analisador de segurança no extrator e no renderizador, retendo apenas tags visuais homologadas e rejeitando qualquer manipulação de eventos ou scripts.



---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] QUANDO o extrator de dados for executado sobre o módulo legado, O SISTEMA DEVE gerar o manifesto estruturado contendo a totalidade dos tópicos didáticos, lições, passos, exercícios práticos, modalidades do simulado e questões teóricas sem falhas de sintaxe.


* [ ] QUANDO as rotinas de preparação de ambiente do legado forem processadas, O SISTEMA DEVE instanciar o sistema de arquivos virtual, aplicar as instruções e serializar o estado resultante em entidades canônicas de cenários.


* [ ] QUANDO um cenário herdar de outro na árvore de conteúdo, O SISTEMA DEVE preservar a referência ao cenário ascendente e manter a imutabilidade entre execuções concorrentes de questões práticas.


* [ ] QUANDO as funções legadas de verificação forem convertidas, O SISTEMA DEVE mapeá-las unicamente a regras suportadas no catálogo declarativo de condições de validação.


* [ ] QUANDO uma condição declarativa for submetida ao validador de equivalência, O SISTEMA DEVE aprovar a solução de referência oficial, aprovar a totalidade das formas alternativas registradas e reprovar o cenário não modificado.


* [ ] SE uma questão prática falhar em qualquer etapa da validação tripla de equivalência, ENTÃO O SISTEMA DEVE sinalizar a pendência no relatório e persistir a questão com status de rascunho.


* [ ] QUANDO o comando de carga inicial for executado pela primeira vez, O SISTEMA DEVE persistir todos os tópicos didáticos, blocos de conteúdo, cenários, questões e modelos de avaliação dentro de uma transação relacional atômica.


* [ ] QUANDO o comando de carga inicial for executado subsequentemente sobre uma base já populada, O SISTEMA DEVE manter a integridade dos dados sem gerar registros duplicados.


* [ ] SE um registro no banco de dados possuir a indicação de alteração manual realizada por docente, ENTÃO O SISTEMA DEVE preservar os valores existentes sem sobrescrevê-los pelos dados do manifesto.


* [ ] QUANDO blocos de conteúdo contendo marcações HTML forem processados, O SISTEMA DEVE eliminar quaisquer declarações de scripts e propriedades executáveis, preservando exclusivamente elementos visuais estruturados.


* [ ] QUANDO a suíte completa de testes automatizados do ecossistema legado for executada, TODOS OS TESTES DEVEM continuar passando com sucesso, sem nenhuma regressão.


* [ ] QUANDO os componentes de visualização de blocos e questões forem renderizados no frontend, O SISTEMA DEVE utilizar estritamente tokens semânticos contidos em `_tokens.scss`, mantendo contraste e paridade nos modos claro e escuro.

---

## 8. Plano de Testes (Test Plan)

### Backend

* Executar teste de validação do comando de carga inicial garantindo a inserção atômica de todos os itens do manifesto relacional.


* Testar a idempotência da carga inicial executando o comando duas vezes consecutivas sobre o mesmo banco de dados e verificando se as contagens totais de linhas nas tabelas permanecem rigorosamente idênticas.


* Testar a proteção de edição docente alterando manualmente o enunciado de uma questão no banco, marcando o indicador de edição manual, reexecutando a carga e atestando que a alteração docente foi preservada.


* Executar testes de unidade sobre o avaliador de regras declarativas, assegurando que todas as regras cadastradas (existência de nós, integridade de conteúdo, octais de permissão, propriedades de grupos e pacotes) reproduzam com fidelidade o comportamento das chamadas imperativas correspondentes.



### Frontend

* Testar a renderização dos tópicos didáticos e de seus blocos dinâmicos em tela, validando a alternância visual e o contraste em ambos os temas (claro e escuro).
* Testar a higienização de blocos contendo marcações HTML, submetendo fragmentos com scripts embutidos e garantindo que o sanitizador remova as instruções perigosas mantendo a estrutura textual íntegra.


* Validar a correta exibição dos parâmetros nos componentes interativos preservados (calculadora de permissões e anatomia da listagem).



### Legado / Integridade

* Executar integralmente a suíte de testes Vitest dentro da pasta legada, atestando que o isolamento do extrator de conteúdo não causou impactos nas execuções de conformidade do terminal e do sistema de arquivos.



---

## 9. Contexto Final da IA (AI Final Context Execution)

Para executar esta especificação, o desenvolvedor ou agente automatizado deve seguir uma sequência coordenada entre os ambientes legado e backend:

1. Desenvolver o extrator no ecossistema legado (`legacy/scripts/extract_content.ts`), consumindo os tópicos e desafios de `legacy/src/conteudo/`, instanciando a máquina simulada para capturar snapshots de cenários e aplicando a bateria de testes de equivalência de validações declarativas.


2. Executar a extração gerando o manifesto consolidado e o relatório de conversão sob `backend/internal/modules/content/seeds/data/content_manifest.json`.
3. Implementar as migrações relacionais no banco de dados para criação das tabelas no schema `project-manager`.


4. Desenvolver as entidades, repositórios e serviços no módulo de conteúdo do backend (`backend/internal/modules/content/...`), implementando o motor de asserções declarativas e o comando utilitário de carga inicial com controle de idempotência.


5. Implementar no frontend os componentes dinâmicos de visualização de blocos e sanitização segura em `frontend/src/components/ContentRenderer/...` consumindo os tokens semânticos.



Arquivos e pacotes a criar ou alterar:

* `legacy/scripts/extract_content.ts`
* `backend/migrations/[timestamp]_create_content_tables.sql`
* `backend/internal/modules/content/domain/topic.go`
* `backend/internal/modules/content/domain/block.go`
* `backend/internal/modules/content/domain/scenario.go`
* `backend/internal/modules/content/domain/question.go`
* `backend/internal/modules/content/domain/assessment_template.go`
* `backend/internal/modules/content/repository/content_repository.go`
* `backend/internal/modules/content/service/content_service.go`
* `backend/internal/modules/content/service/validator_engine.go`
* `backend/internal/modules/content/seeds/seed_content.go`
* `backend/internal/modules/content/seeds/data/content_manifest.json`
* `frontend/src/components/ContentRenderer/ContentRenderer.tsx`
* `frontend/src/components/ContentRenderer/ContentRenderer.module.scss`
* `frontend/src/components/ContentRenderer/blocks/TextBlock.tsx`
* `frontend/src/components/ContentRenderer/blocks/CommandBlock.tsx`
* `frontend/src/components/ContentRenderer/blocks/LegacyHtmlBlock.tsx`
* `frontend/src/utils/sanitizer.ts`

Dependências de execução: a implementação depende da conclusão e aprovação da infraestrutura compartilhada (SPEC-004). O comando de carga deve ser executado obrigatoriamente após as migrações estruturais do banco de dados e antes do início das avaliações formais na plataforma.