# SPEC-024: Servidor MCP para Autoria dos Módulos de Ensino

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-024 |
| **Status** | Aprovada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos (backend; frontend só para emitir e revogar tokens) |
| **Módulo** | novo módulo `mcp` (transporte e ferramentas) e `auth` (token de acesso pessoal); reutiliza `coursemodule` e `content` |
| **Contexto de tela** | Tela de perfil, seção "Acesso por agentes (MCP)" (emitir e revogar tokens) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-003, SPEC-010, SPEC-011, SPEC-019, SPEC-021, SPEC-022, SPEC-023 (revisão 3: teste do banco de exercícios) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (servidor MCP para o Claude, fluxo completo dos módulos de ensino, acesso só de `ADMIN` e `TEACHER`) e o rascunho de requisitos RF-01 a RF-12 e RNF-01 a RNF-04 anexado ao pedido |

---

## 1. Contexto e Problema (Context & Problem Statement)

A autoria de um módulo (dados, blocos, snapshot, exercícios, versões) é feita por formulários da interface web. Para montar um módulo inteiro, a docente repete dezenas de cliques e campos. Ferramentas de agentes (Claude Code, Claude Desktop) conseguem produzir o material didático a partir de uma conversa, mas hoje não têm como gravá-lo na plataforma: só existe a API REST, que exige sessão por cookie de navegador.

A API REST já cobre todo o fluxo de autoria (SPEC-010, 019, 021, 022, 023). A lacuna é **um canal pensado para agentes**: autenticação sem navegador, ferramentas com nomes e erros claros, e acesso restrito a quem pode editar conteúdo.

## 2. Objetivos (Goals)

- Um servidor MCP embutido no backend expõe ferramentas que cobrem o ciclo de autoria completo: módulo, blocos, snapshot, exercícios, banco de exercícios, versões e publicação.
- **Publicar e aplicar versão são exclusivos da interface web**: o MCP nunca publica nem restaura versão (RN-08).
- **Publicar exige os dois testes aprovados**, o do conteúdo do módulo e o do banco de exercícios, feitos pela própria docente no sistema (RN-13). Vale para toda publicação, venha o conteúdo do MCP ou da edição manual.
- Só `ADMIN` e `TEACHER` usam o MCP. `STUDENT` e visitante nunca. `TEACHER` age apenas nos módulos de que é dono; `ADMIN` age em todos.
- O MCP **não tem regra de negócio própria**: cada ferramenta chama o service existente, então as validações, limites e papéis das specs anteriores valem sem cópia.
- Respostas e erros são claros e estruturados, para o agente se corrigir sozinho (campo inválido, valor recebido, valor esperado).
- O acesso é autenticado por token de acesso pessoal, revogável, emitido na interface web.

### 2.1. Fora de escopo (Non-Goals)

- Ferramentas para turmas, estudantes, provas, notas e auditoria acadêmica. Turmas ainda não foram implementadas no fluxo de módulos; ficam para spec futura (decisão do Tech Lead, 10/10/2026).
- Executar comandos de shell no servidor (D-02).
- Frontend do MCP além de emitir e revogar tokens.
- Questões teóricas (escolha, verdadeiro/falso, dissertativa): a SPEC-023 trata só das práticas e não há autoria delas na plataforma; ficam para spec futura.
- Tornar o MCP público ou liberar leitura de conteúdo para estudantes.
- Novo modelo de ciclo de vida do módulo: vale o das SPEC-010 e SPEC-021.
- Publicar uma versão e restaurar uma versão no rascunho pelo MCP: ficam só na interface web, por decisão do Tech Lead (10/10/2026).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Seção "Acesso por agentes (MCP)" no perfil, visível só para `ADMIN` e `TEACHER`:

- lista os tokens do usuário (nome, criado em, último uso, expira em);
- botão "Criar token": pede um nome e a validade (30, 90 ou 365 dias) e mostra o valor **uma única vez**, com o botão copiar e o trecho de configuração do cliente MCP;
- botão "Revogar" por token, com confirmação;
- estados: carregando, vazio, erro, sucesso. Textos em português no arquivo de mensagens; chamadas de rede só em `frontend/src/services/`.

### 3.2. Backend (Go: Camada de Módulo/Service)

**Transporte (RN-01).** Endpoint MCP no mesmo serviço Go, em `/mcp`, no transporte HTTP com streaming definido pelo protocolo MCP. Fora da árvore `/api/v1` porque não é REST.

**Autenticação e papéis (RN-02, RN-03).** O cabeçalho `Authorization: Bearer` leva o token de acesso pessoal. O servidor resolve o token para o usuário e seu papel; papel diferente de `ADMIN` ou `TEACHER` recebe recusa antes de qualquer ferramenta.

**Ferramentas (RN-04).** Cada ferramenta é um adaptador fino sobre o service existente:

| Ferramenta | O que faz | Service reutilizado |
| :--- | :--- | :--- |
| `list_modules` | Lista os módulos que o usuário pode editar, com estado e se há alterações não publicadas | `coursemodule` |
| `get_module` | Devolve dados, blocos do rascunho, snapshot, exercícios e versões | `coursemodule`, `content` |
| `create_module` | Cria o módulo (título, slug, descrição, vigência e visibilidade); nasce com a versão 1 vazia | `coursemodule` (SPEC-010, SPEC-021 RN-11) |
| `update_module_metadata` | Edita qualquer dado do módulo, inclusive o estado `ACTIVE`, `INACTIVE` ou `ARCHIVED` | `coursemodule` |
| `archive_module` | Arquiva o módulo, preservando turmas e histórico | `coursemodule` |
| `append_content_blocks` | Acrescenta blocos ao rascunho, validados pelo tipo | `content` (SPEC-019) |
| `update_content_block` | Edita, ativa, desativa ou remove um bloco do rascunho | `content` |
| `replace_content_blocks` | Substitui todos os blocos do rascunho numa só operação atômica | `content` |
| `set_module_setup` | Grava o snapshot do módulo (passos e arquivos) | `content` (SPEC-021) |
| `create_module_exercise` | Cria exercício prático do módulo (dificuldade, uso, vínculos, dependência); fica em `DRAFT` e a docente o publica na tela | `content` (SPEC-023) |
| `update_module_exercise` | Edita, remove e reordena exercícios | `content` |
| `set_exercise_setup` | Define o cenário do exercício, inclusive herança de outro exercício do módulo | `content` (SPEC-023 RN-11) |
| `validate_module` | Roda as validações estruturais do rascunho e devolve a lista de problemas, para o agente corrigir antes de a docente publicar | `content`, `coursemodule` |
| `list_module_versions` | Somente leitura: lista versões e informa alterações não publicadas | `content` |

Não existem ferramentas de publicar nem de restaurar versão (RN-08).

**Regras de negócio.**

- **RN-01 (transporte):** o MCP responde só em HTTPS em produção; em desenvolvimento aceita HTTP local.
- **RN-02 (token de acesso pessoal):** o token é aleatório, com 256 bits de entropia, mostrado uma única vez; o banco guarda só o hash (SHA-256). Validade de 30 a 365 dias. Revogar é imediato.
- **RN-03 (papéis):** só `ADMIN` e `TEACHER`. Se o papel do usuário mudar ou o usuário for desativado, os tokens dele deixam de valer na hora, porque o papel é lido do usuário a cada chamada, nunca guardado no token.
- **RN-04 (sem regra duplicada):** nenhuma ferramenta valida ou decide por conta própria; toda recusa vem do service e é traduzida para o formato de erro do MCP (RN-06).
- **RN-05 (posse):** `TEACHER` só age em módulo de que é dono (SPEC-010); `ADMIN`, em todos. Módulo alheio responde como inexistente, sem revelar que existe.
- **RN-06 (erro estruturado):** toda falha devolve: `type` (o mesmo slug do RFC 7807 do service), `title`, `detail`, e, para validação, a lista de campos com `field`, `received` e `expected`, no caminho do dado (por exemplo, a posição do bloco e o campo). Erro de ferramenta é resultado de ferramenta com indicador de erro, não falha de protocolo, para o agente ler e corrigir.
- **RN-07 (atomicidade):** ferramentas que gravam mais de um registro (substituir blocos, criar exercício com vínculos) rodam numa transação aberta no service (`ARCHITECTURE.md`, 3.6).
- **RN-08 (publicação só pela interface):** toda edição de conteúdo vai para o **rascunho**. Publicar e restaurar versão **só** existem na interface web (`POST /api/v1/teacher/modules/{id}/versions` e `.../restore`, SPEC-021), por sessão de usuário. O MCP não expõe essas operações e o token de acesso pessoal **não é aceito** nessas rotas REST: elas continuam exigindo a sessão por cookie. Assim o estudante só vê mudança depois de a docente revisar e publicar no sistema.
- **RN-13 (testes antes de publicar):** a publicação (`POST /api/v1/teacher/modules/{id}/versions`) só é aceita quando existem resultados **aprovados e válidos** de dois testes, ambos executados pela docente na tela de edição do módulo:
  - **teste do conteúdo (`MODULE`):** o "Testar o módulo" da SPEC-021 (seção 3.3: unitário e sequencial; dependências são só aviso). Vale para o `content_hash` do rascunho atual (SPEC-021 RN-05);
  - **teste do banco de exercícios (`EXERCISE_BANK`):** o "Testar Banco de Exercícios" da SPEC-023 (seção 12): consolidação dos snapshots e as três baterias. Aprovado quando o estado geral é sucesso, sem conflito de snapshot nem exercício que falhe isolado; dependências sugeridas são só aviso (SPEC-023, D-17). Vale para o `content_hash` do banco de exercícios do módulo (exercícios, vínculos, `depends_on` e cenários). Se o módulo não tem exercícios, este teste não é exigido.

  Ao terminar cada teste, a tela registra o resultado no servidor. Qualquer alteração no que o teste cobre, por tela ou por MCP, muda o hash e invalida o resultado: é preciso testar de novo. O MCP não registra nem altera resultado de teste. Se faltar algum resultado aprovado e válido, a publicação responde 409 `module-not-tested` e informa qual teste falta (`missingTests`). A carga inicial (seed, SPEC-021 RN-08) não passa por essa rota e fica isenta.
- **RN-09 (validação):** `validate_module` roda as validações estruturais do rascunho e lista os problemas. O alcance depende da D-02. Ele **não substitui** o teste do módulo da RN-13: o agente deve informar à docente que falta testar e publicar pelo sistema.
- **RN-10 (limites):** valem os limites e a taxa de gravação das SPEC-019 e SPEC-021 (120 gravações por minuto, por usuário, somando REST e MCP).
- **RN-11 (auditoria):** toda ferramenta que grava registra no log estruturado o usuário, a ferramenta e o módulo, sem o conteúdo gravado e sem o token.
- **RN-12 (descoberta):** cada ferramenta tem descrição em inglês com os valores aceitos de cada enumeração (tipos de bloco, tipos de exercício, dificuldade, uso, visibilidade), para o agente acertar na primeira chamada.

## 4. Modelo de Dados (Data Model)

Migração nova, `access_tokens`:

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid (v7) | Sim | PK | Identificador |
| `user_id` | uuid | Sim | FK `users`, índice | Dono do token |
| `name` | texto | Sim | até 80 caracteres | Rótulo dado pelo usuário |
| `token_hash` | texto | Sim | único | SHA-256 do token; o token em si nunca é gravado |
| `expires_at` | timestamp | Sim | | Fim da validade |
| `last_used_at` | timestamp | Não | | Atualizado no uso, no máximo uma vez por minuto |
| `revoked_at` | timestamp | Não | | Preenchido ao revogar |
| `created_at`, `updated_at` | timestamp | Sim | | Auditoria |

Exclusão lógica (o histórico de uso tem valor forense). Tabela nova `module_test_results` (RN-13):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid (v7) | Sim | PK | Identificador |
| `module_id` | uuid | Sim | FK `course_modules`, cascata | Módulo testado |
| `content_hash` | texto | Sim | | Hash do que foi testado: do rascunho (`MODULE`, cálculo da SPEC-021) ou do banco de exercícios (`EXERCISE_BANK`) |
| `kind` | texto | Sim | `MODULE` ou `EXERCISE_BANK` | Qual teste foi feito |
| `passed` | booleano | Sim | | Teste aprovado (`MODULE`: unitário e sequencial; `EXERCISE_BANK`: estado geral de sucesso) |
| `summary` | jsonb | Não | até 64 KB | Resultado por card e avisos de dependência, para exibição |
| `tested_by` | uuid | Sim | FK `users` | Docente que testou |
| `created_at` | timestamp | Sim | | Momento do teste |

Índice por (`module_id`, `kind`, `created_at`). Vale o resultado mais recente de cada `kind`; os antigos ficam como histórico. Nenhuma outra tabela muda: o MCP grava pelas tabelas existentes.

## 5. Contrato de API (API Contract)

**`GET /api/v1/access-tokens`**: lista os tokens do usuário autenticado. Papéis: `ADMIN`, `TEACHER`. Resposta 200 com nome, criação, último uso, validade e situação (nunca o valor).

**`POST /api/v1/access-tokens`**: cria um token. Papéis: `ADMIN`, `TEACHER`.

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `name` | texto | Sim | 1 a 80 caracteres |
| `validityDays` | inteiro | Sim | 30, 90 ou 365 |

Resposta 201: `id`, `name`, `expiresAt` e `token` (única vez em que aparece).

**`DELETE /api/v1/access-tokens/{id}`**: revoga. Só o dono, ou `ADMIN`. Resposta 204.

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `validation-error` | Nome ou validade inválidos |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Papel `STUDENT` |
| 404 | `access-token-not-found` | Token inexistente ou de outro usuário |
| 429 | `rate-limited` | Limite de criação excedido |

**`POST /api/v1/teacher/modules/{id}/test-results`**: registra o resultado de um teste do módulo. Só por sessão (cookie); token de acesso pessoal recusado. Papéis: `ADMIN` e `TEACHER` dono.

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `kind` | texto | Sim | `MODULE` ou `EXERCISE_BANK` |
| `passed` | booleano | Sim | |
| `summary` | objeto | Não | até 64 KB |

O servidor calcula o `content_hash` do que o `kind` cobre no momento do registro. Resposta 201 com `id`, `passed`, `contentHash` e `createdAt`. Erros: 400 `validation-error`, 401 `not-authenticated`, 403 `forbidden`, 404 `module-not-found`, 413 `payload-too-large`, 429 `rate-limited`.

**`POST /api/v1/teacher/modules/{id}/versions` (SPEC-021, alterada):** passa a responder também 409 `module-not-tested` com `missingTests` (RN-13). `GET /api/v1/teacher/modules/{id}/versions` passa a devolver `moduleTestPassed` e `exerciseBankTestPassed` (o resultado mais recente de cada teste está aprovado e vale para o estado atual; o segundo é verdadeiro quando o módulo não tem exercícios), para a tela habilitar o botão Publicar.

**`/mcp` (protocolo MCP):** autenticado por `Authorization: Bearer`. Falhas de autenticação: 401 `invalid-access-token` (token desconhecido, expirado ou revogado) e 403 `forbidden` (papel sem acesso). Dentro do protocolo, os erros de ferramenta seguem a RN-06.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Token vazado dá a um terceiro a autoria dos módulos do dono | Hash no banco, validade máxima de 365 dias, revogação imediata, exibição única, `last_used_at` visível, taxa limitada (RN-10) |
| Agente grava conteúdo ruim direto para os estudantes | Tudo vai para o rascunho; só a docente publica, pela interface (RN-08), e pode restaurar versão anterior |
| Agente apaga ou sobrescreve conteúdo | `replace_content_blocks` só age no rascunho; o MCP não publica e as versões nunca são apagadas (SPEC-021 RN-11) |
| Conteúdo vindo de fonte não confiável (injeção de instruções no material que o agente lê) induz ações indevidas | Posse por módulo (RN-05), sem ferramenta destrutiva fora do rascunho, auditoria (RN-11) |
| Regra duplicada entre REST e MCP diverge com o tempo | Adaptadores finos sobre os mesmos services (RN-04); teste que compara a recusa do MCP com a do service |
| Nova dependência externa (biblioteca MCP) | Aprovada na D-03 |
| O teste roda no navegador, então o resultado enviado ao servidor é declarado pelo cliente e não prova que o teste rodou | A regra é um **processo de qualidade** da docente, não uma barreira contra ela: só `ADMIN` e o dono registram, o resultado fica ligado ao `content_hash` e ao autor, e o Tech Lead aceita esse limite (D-08) |
| A RN-13 muda a SPEC-021 (publicar passa a exigir teste) e depende do botão "Testar Banco de Exercícios" da SPEC-023 (revisão 3) | Registrado no histórico; a SPEC-021 recebe uma revisão na implementação; módulos antigos e a carga inicial não são afetados |

Impacto em módulos existentes: nenhum em comportamento; `auth` ganha a validação do token de acesso. `legacy/`: nenhum.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O SISTEMA DEVE expor o MCP em `/mcp` com todas as ferramentas da seção 3.2.
- [ ] **CA-02** (indesejado): SE a chamada ao MCP não tiver token válido, ENTÃO O SISTEMA DEVE responder 401 `invalid-access-token`.
- [ ] **CA-03** (indesejado): SE o usuário do token for `STUDENT`, ENTÃO O SISTEMA DEVE responder 403 `forbidden` sem executar ferramenta alguma.
- [ ] **CA-04** (indesejado): SE um `TEACHER` chamar ferramenta sobre módulo de outro docente, ENTÃO O SISTEMA DEVE responder como módulo inexistente.
- [ ] **CA-05** (estado): ENQUANTO o usuário for `ADMIN`, O SISTEMA DEVE permitir as ferramentas sobre qualquer módulo.
- [ ] **CA-06** (evento): QUANDO o token for revogado, expirar ou o usuário mudar de papel para `STUDENT`, O SISTEMA DEVE recusar a chamada seguinte.
- [ ] **CA-07** (ubíquo): O SISTEMA DEVE guardar só o hash do token e mostrar o valor uma única vez, na criação.
- [ ] **CA-08** (evento): QUANDO `create_module` for chamada, O SISTEMA DEVE criar o módulo com a versão 1 publicada e vazia.
- [ ] **CA-09** (evento): QUANDO `append_content_blocks` ou `replace_content_blocks` for chamada, O SISTEMA DEVE gravar só no rascunho e o estudante NÃO DEVE ver a mudança antes da publicação.
- [ ] **CA-10** (indesejado): SE um bloco ou exercício for inválido, ENTÃO O SISTEMA DEVE devolver erro com `type`, caminho do campo, valor recebido e valor esperado, e NÃO DEVE gravar nada da operação.
- [ ] **CA-11** (evento): QUANDO `replace_content_blocks` falhar no meio, O SISTEMA DEVE manter o rascunho como estava (atomicidade).
- [ ] **CA-12** (ubíquo): O SISTEMA NÃO DEVE expor no MCP ferramenta que publique ou restaure versão.
- [ ] **CA-13** (indesejado): SE uma chamada às rotas REST de publicar ou restaurar vier com token de acesso pessoal, ENTÃO O SISTEMA DEVE recusar com 401 `not-authenticated`; só a sessão por cookie vale.
- [ ] **CA-17** (indesejado): SE a docente publicar sem resultado aprovado e válido do teste do conteúdo, ou do teste do banco de exercícios (quando o módulo tem exercícios), ENTÃO O SISTEMA DEVE responder 409 `module-not-tested`, listar o teste que falta e não criar versão.
- [ ] **CA-18** (evento): QUANDO o rascunho ou o banco de exercícios for alterado depois do teste (por tela ou por MCP), O SISTEMA DEVE tratar o resultado correspondente como vencido e exigir novo teste.
- [ ] **CA-19** (evento): QUANDO a docente rodar "Testar o módulo" e "Testar Banco de Exercícios" na tela e os dois forem aprovados, O SISTEMA DEVE gravar os resultados e habilitar o botão Publicar.
- [ ] **CA-20** (indesejado): SE o MCP tentar registrar resultado de teste, ENTÃO O SISTEMA NÃO DEVE oferecer essa operação (sem ferramenta e sem aceitar Bearer na rota).
- [ ] **CA-21** (estado): ENQUANTO o módulo não tiver exercícios, O SISTEMA NÃO DEVE exigir o teste do banco de exercícios.
- [ ] **CA-13a** (evento): QUANDO `validate_module` encontrar problemas, O SISTEMA DEVE listar todos, com caminho do campo.
- [ ] **CA-14** (evento): QUANDO `archive_module` for chamada, O SISTEMA DEVE impedir novo uso em turmas e preservar turmas e histórico existentes.
- [ ] **CA-15** (ubíquo): O SISTEMA DEVE registrar no log cada gravação por MCP (usuário, ferramenta, módulo), sem token nem conteúdo.
- [ ] **CA-16** (ubíquo): A tela do perfil DEVE listar, criar e revogar tokens, mostrando o valor só na criação.

## 8. Plano de Testes (Test Plan)

- **Backend (service `mcp` e `auth`):** unidade com repositories de teste: criação, hash, expiração, revogação e troca de papel (cobre CA-02, CA-03, CA-06, CA-07); posse e `ADMIN` (CA-04, CA-05); tradução de erro do service para RN-06 (CA-10); atomicidade (CA-11); registro em log (CA-15).
- **Backend (ferramentas):** teste por ferramenta contra services de teste, com o roteador `/mcp` real e `httptest` (CA-01, CA-08, CA-09, CA-12, CA-13a, CA-14); lista de ferramentas sem publicar/restaurar (CA-12); rotas de versão recusam Bearer (CA-13).
- **Teste do módulo (RN-13):** unidade do service de versões: publicar sem resultado, com resultado reprovado, com resultado de outro `content_hash`, com só um dos dois testes e com os dois válidos; módulo sem exercícios (CA-17, CA-18, CA-21); handler de `test-results` recusando Bearer (CA-20); frontend: botão Publicar desabilitado até o teste passar e habilitado depois (CA-19).
- **Repository:** integração com PostgreSQL real (`testcontainers-go`) para `access_tokens` e atomicidade de `replace_content_blocks` (CA-11).
- **Frontend:** testes de componente da seção do perfil com `fetch` falso: lista, criação com exibição única, revogação, estados de erro e vazio (CA-16).
- **Manual:** conectar o Claude Code ao `/mcp` com um token de `TEACHER`, criar um módulo com blocos e um exercício por conversa e validar; em seguida, publicar pela tela do sistema (cobre CA-01, CA-08, CA-12).
- **Cobertura:** acima de 80% em `domain`, `service` e `handler` do módulo `mcp` e do que mudar em `auth`.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-003, 010, 019, 021, 022, 023 e o código de `backend/internal/platform/authn`, `modules/coursemodule/service`, `modules/content/service`.
2. **Ordem:** (1) migração e domínio do token; (2) validador de token plugado no `authn`; (3) service e handler REST de tokens; (4) módulo `mcp` com transporte e ferramentas, de leitura para escrita; (5) tela do perfil; (6) glossário.
3. **Arquivos a criar ou alterar:** `backend/migrations/` (migração de `access_tokens`), `backend/internal/modules/auth/**`, `backend/internal/modules/content/**` (resultado de teste e regra de publicar), tela de edição do módulo (aba Versões e botão Testar), `specs/features/021-...` (revisão), `backend/internal/modules/mcp/**` (novo), `backend/internal/platform/authn/` (aceitar Bearer só na rota `/mcp`; rotas REST seguem só com cookie), `backend/cmd/api/main.go` (composition root), `frontend/src/services/`, componente e mensagens da seção do perfil, `specs/GLOSSARY.md`. Qualquer outro exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Todas foram resolvidas em 10/10/2026, com as recomendações aceitas pelo Tech Lead, e entraram nas seções acima.

### 10.1. Decisões (aprovadas pelo Tech Lead em 10/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | O MCP não cria estado novo de módulo: vale `ACTIVE`/`INACTIVE`/`ARCHIVED` e o rascunho mais as versões da SPEC-021 |
| D-02 | O MCP não executa comandos no servidor. `validate_module` faz validação estrutural (tipos, limites, referências e solução de referência contra as condições do VFS onde o motor Go permitir). Rodar comandos no servidor vira spec própria |
| D-03 | O SDK oficial MCP para Go é aprovado como nova dependência, no mesmo processo do backend, com injeção no composition root |
| D-04 | Só HTTP com streaming em `/mcp`; `stdio` e SSE ficam de fora |
| D-05 | Autenticação por token de acesso pessoal opaco, emitido no perfil; sem JWT |
| D-06 | Esta spec fica em `specs/features/024-...` e cita o rascunho de requisitos como fonte canônica |
| D-07 | Termos novos ("token de acesso pessoal" e "servidor MCP") entram no `GLOSSARY.md` na implementação |
| D-08 | O resultado dos testes é declarado pelo navegador da docente (o motor roda lá); o registro guarda autor e hash. Rodar os testes no servidor depende da spec futura da D-02 |
| D-09 | Publicar e restaurar versão só pela interface; publicar exige o teste do conteúdo e o do banco de exercícios aprovados (RN-08, RN-13) |
| D-10 | Turmas ficam fora da v1 |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect | Criação em Rascunho, a partir do pedido do Tech Lead e do rascunho de requisitos RF-01 a RF-12 |
| 10/10/2026 | Aruna Architect | Por decisão do Tech Lead: publicar e restaurar versão só pela interface web; removidas `publish_module` e `restore_module_version` do MCP (RN-08, CA-12, CA-13) |
| 10/10/2026 | Aruna Architect | Por decisão do Tech Lead: publicar exige o teste do módulo aprovado, feito pela docente no sistema (RN-13, CA-17 a CA-20) |
| 10/10/2026 | Aruna Architect | Turmas ficam fora da v1 (decisão do Tech Lead); pendência P-07 resolvida e removida |
| 10/10/2026 | Aruna Architect | Testes de conteúdo e de banco de exercícios obrigatórios para publicar (RN-13, CA-17 a CA-21). Pendências P-01 a P-09 viram decisões D-01 a D-10. Aprovada pelo Tech Lead em 10/10/2026 |
| 10/10/2026 | Implementador (Claude) | Correção: o módulo não tem vídeo nem links próprios (o vídeo é por bloco, SPEC-019); removidos de `create_module`. Exercícios criados pelo MCP ficam em `DRAFT` e a docente os publica na tela |
| 10/10/2026 | Implementador (Claude) | `create_module_exercise` é só de exercício prático, em linha com a SPEC-023 (seção 2.1); questões teóricas ficam para spec futura |
