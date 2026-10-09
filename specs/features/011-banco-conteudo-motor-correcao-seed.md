# SPEC-011: Banco de Conteúdo, Motor de Correção e Carga Inicial

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-011 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Backend |
| **Módulo** | `content` |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004, SPEC-003, SPEC-010, SPEC-005 (artefato e fixtures) |
| **Substitui** | Parte da SPEC-005 original (banco e carga) |
| **Fontes canônicas** | Seção 3.3 da monografia; insumo `docs/insumos/conversao-conteudo-legado.md`; `docs/arquitetura/transicao-backend.md`, seção 6.4 (herança de cenários) e seção 2.1 (correção no servidor) |


---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-005 gera um artefato com todo o conteúdo do legado, mas ele ainda precisa morar no banco, ligado aos módulos de ensino da SPEC-010, e a plataforma precisa corrigir questões práticas **no servidor**, a partir de condições declarativas, e não mais com código rodando no navegador. Sem tabelas de conteúdo, sem motor de correção e sem uma carga idempotente, nada do material existente chega à docente nem aos estudantes.

## 2. Objetivos (Goals)

- Criar as tabelas de blocos, cenários, questões e modelos de avaliação, e estender os módulos de ensino da SPEC-010 com chave de origem, ícone, cor e ordem.
- Definir o **catálogo fechado de condições de validação** e o **catálogo de blocos**.
- Implementar o **motor de correção em Go**, que avalia condições sobre o estado serializado da máquina, com o mesmo veredito do avaliador TypeScript da SPEC-005.
- Implementar o **comando de carga** (seed), idempotente e transacional, que nunca sobrescreve o que a docente editou.
- Filtrar o HTML legado de novo na importação.

### 2.1. Fora de escopo (Non-Goals)

- Endpoints de leitura e telas: SPEC-012.
- Telas e endpoints de autoria (criar e editar blocos e questões).
- Aplicação de provas, tentativas e submissões (spec futura); esta spec entrega o motor de correção como serviço interno.
- Validação *offline* por envelope de *hashes* (seção 5 do documento canônico).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não se aplica nesta spec.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo `backend/internal/modules/content/` (`domain`, `service`, `repository`) e comando `backend/cmd/seed/`.

**Catálogo de blocos (`block_type`)** e o conteúdo de cada um (`payload`):

| Tipo | Conteúdo |
| :--- | :--- |
| `TEXT` | Título opcional e HTML filtrado |
| `COMMAND` | Lista de passos: comando, explicação, terminal (1 a 3), login opcional e respostas |
| `TIP` | Texto e variante (`DEFAULT` ou `WARNING`) |
| `CURIOSITY` | Título e texto |
| `STEP_BY_STEP` | Lista ordenada de passos em texto |
| `CARDS` | Lista de cartões (título e texto) |
| `WIDGET` | Componente (`PERMISSION_CALCULATOR` ou `LS_ANATOMY`) e parâmetros |
| `LEGACY_HTML` | HTML filtrado vindo do legado |

**Catálogo de condições de validação** (uma questão é aprovada quando **todas** as condições são atendidas):

| Tipo | Parâmetros | Semântica (mesma do `Verificar` do legado) |
| :--- | :--- | :--- |
| `FILE_EXISTS` | `path` | Existe e é arquivo (links seguidos) |
| `DIRECTORY_EXISTS` | `path` | Existe e é diretório |
| `NODE_EXISTS` | `path` | Existe qualquer nó |
| `SYMLINK` | `path`, `target` opcional | É link (sem seguir) e, se informado, aponta para `target` |
| `PATH_ABSENT` | `path` | Não existe |
| `CONTENT_EQUALS` | `path`, `value`, `trimWhitespace` | Conteúdo igual, opcionalmente sem espaços nas pontas |
| `CONTENT_CONTAINS` | `path`, `value` | Contém o trecho, sem diferenciar maiúsculas de minúsculas |
| `CONTENT_NOT_EMPTY` | `path` | Arquivo com conteúdo |
| `DIRECTORY_EMPTY` | `path` | Diretório sem filhos |
| `PERMISSION_MODE` | `path`, `mode` (octal), `includeSpecialBits` | Permissão igual; com `includeSpecialBits`, compara também setuid, setgid e sticky |
| `OWNER` | `path`, `user`, `group` opcional | Dono (e grupo) do nó |
| `GROUP_OWNER` | `path`, `group` | Grupo dono do nó |
| `USER_EXISTS` | `user` | Conta existe |
| `USER_ABSENT` | `user` | Conta não existe |
| `USER_ATTRIBUTE` | `user`, `field` (`HOME`, `SHELL`, `COMMENT`, `UID`, `PRIMARY_GROUP`), `value` | Atributo da conta |
| `USER_PASSWORD_SET` | `user` | Conta com senha definida |
| `USER_LOCKED` | `user`, `locked` | Conta bloqueada ou não |
| `GROUP_EXISTS` | `group` | Grupo existe |
| `GROUP_ABSENT` | `group` | Grupo não existe |
| `USER_IN_GROUP` | `user`, `group` | Membro secundário ou grupo primário |
| `PACKAGE_INSTALLED` | `package`, `installed` | Estado no `/var/lib/dpkg/status` da máquina |
| `SERVICE_STATE` | `service`, `active` opcional, `enabled` opcional | Ativo = arquivo de execução da unidade; habilitado = link em `multi-user.target.wants` (como o systemd simplificado do legado) |
| `APT_LISTS_UPDATED` | — | Lista de pacotes atualizada presente |

Um tipo novo só entra por revisão desta spec, antes de ser usado.

**Revisão de 08/10/2026 (SPEC-013):** o catálogo ganhou quatro tipos.

| Tipo | Parâmetros | Semântica |
| :--- | :--- | :--- |
| `CONTENT_NOT_CONTAINS` | `path`, `value`, `caseSensitive` | O conteúdo não contém o trecho; arquivo inexistente conta como vazio |
| `CONTENT_LINE_COUNT` | `path`, `comparison` (`EQUAL` ou `AT_LEAST`), `count` | O arquivo existe e tem a quantidade de linhas indicada |
| `ANY_OF` | `conditions` | Pelo menos uma condição interna é atendida; um nível só |
| `PACKAGES_AT_VERSIONS` | `packages` (`package` e `version`) | Todo pacote listado que estiver instalado tem a versão indicada |

Regras de negócio:

- **RN-01 (motor de correção):** função pura do domínio que recebe o estado serializado da máquina (formato `exame-so/maquina`, versão 1, do `Serializador` do legado) e a lista de condições, e devolve o veredito geral e o resultado de cada condição. Não acessa banco, rede nem relógio.
- **RN-02 (paridade com o TypeScript):** o motor DEVE produzir, para cada caso das fixtures de equivalência da SPEC-005, o mesmo veredito esperado. As fixtures são um teste obrigatório do módulo.
- **RN-03 (validação de condições):** tipo desconhecido, parâmetro ausente ou `mode` não octal invalidam a lista inteira; o motor nunca aprova uma lista inválida.
- **RN-04 (carga idempotente):** o comando lê o manifesto e grava tudo numa única transação, usando a chave de origem como identidade natural. Item novo é inserido; item existente **sem** edição docente é atualizado com os dados do manifesto; item existente **com** edição docente (`edited_by_teacher_at` preenchido) não é tocado. A carga nunca exclui registros.
- **RN-05 (dono dos módulos carregados):** os módulos criados pela carga pertencem à conta de administrador configurada em `ADMIN_EMAIL`; se ela não existir, o comando falha com mensagem clara.
- **RN-06 (visibilidade inicial):** módulos de estudo nascem `PUBLIC`; o módulo "Simulados de certificação" nasce `AUTHENTICATED`.
- **RN-07 (exercícios dos módulos):** cada questão com uso `EXERCISE` é ligada ao seu módulo em `module_exercise_items` (SPEC-010), na ordem do legado, como obrigatória.
- **RN-08 (HTML seguro):** o conteúdo `TEXT` e `LEGACY_HTML` é filtrado de novo na importação por lista fechada de marcações e classes, com a biblioteca `bluemonday`.
- **RN-09 (relatório da carga):** ao final, o comando registra com o logger as contagens de inseridos, atualizados e preservados por tipo de entidade.
- **RN-10 (integridade):** a migração acrescenta a chave estrangeira de `module_exercise_items.exercise_id` para `questions.id`, que a SPEC-010 deixou sem referência porque a tabela ainda não existia.

## 4. Modelo de Dados (Data Model)

Toda tabela de conteúdo editável tem `edited_by_teacher_at` (marcado pelas futuras telas de autoria), `created_at` e `updated_at`. Chaves UUIDv7.

### 4.1. Alteração em `course_modules` (SPEC-010)

| Campo novo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `source_key` | texto | Não | único quando presente | Chave de origem do legado |
| `icon` | texto | Não | | Ícone do módulo |
| `color` | texto | Não | | Nome do token de cor do módulo |
| `display_order` | inteiro | Não | | Ordem de exibição |
| `edited_by_teacher_at` | timestamp | Não | | Protege o módulo contra a carga |

### 4.2. `content_blocks`

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK | |
| `module_id` | UUID | Sim | FK → `course_modules.id`, exclusão em cascata | |
| `source_key` | texto | Não | único quando presente | |
| `block_type` | enum | Sim | catálogo de blocos | |
| `position` | inteiro | Sim | ≥ 1; único por módulo | Ordem no módulo |
| `payload` | JSONB | Sim | | Conteúdo conforme o tipo |
| `edited_by_teacher_at`, `created_at`, `updated_at` | timestamp | | | |

### 4.3. `scenarios`

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK | |
| `source_key` | texto | Não | único quando presente | |
| `base_scenario_id` | UUID | Não | FK → `scenarios.id` | Cenário base (herança) |
| `snapshot` | JSONB | Sim | | Estado serializado da máquina |
| `format_version` | inteiro | Sim | | Versão do formato do estado |
| `created_at`, `updated_at` | timestamp | Sim | | |

Cenários são imutáveis depois de criados; uma alteração gera um cenário novo (documento canônico, seção 6.4).

### 4.4. `questions`

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK | |
| `source_key` | texto | Não | único quando presente | |
| `module_id` | UUID | Sim | FK → `course_modules.id` | |
| `kind` | enum | Sim | `PRACTICAL`, `THEORETICAL_SINGLE`, `THEORETICAL_MULTIPLE`, `THEORETICAL_BOOLEAN`, `DISCURSIVE` | |
| `usage` | enum | Sim | `EXERCISE`, `ASSESSMENT` | Uso da questão |
| `difficulty` | enum | Sim | `EASY`, `MEDIUM`, `HARD` | |
| `status` | enum | Sim | `DRAFT`, `PUBLISHED`, `ARCHIVED` | |
| `title` | texto | Sim | | |
| `statement` | texto | Sim | | Enunciado |
| `hint` | texto | Não | | |
| `explanation` | texto | Não | | Explicação do gabarito |
| `scenario_id` | UUID | Não | FK → `scenarios.id`; obrigatório quando `PRACTICAL` | |
| `reference_solution` | JSONB | Não | | Passos da solução de referência |
| `validation_conditions` | JSONB | Não | obrigatório quando `PRACTICAL` | Lista do catálogo |
| `choices` | JSONB | Não | obrigatório nas teóricas objetivas | Alternativas |
| `answer_key` | JSONB | Não | obrigatório nas teóricas objetivas | Gabarito |
| `tags` | lista de texto | Não | | Ex.: certificação |
| `edited_by_teacher_at`, `created_at`, `updated_at`, `deleted_at` | timestamp | | | |

Índices: (`module_id`, `usage`, `status`) e (`difficulty`).

### 4.5. `assessment_templates` e `assessment_template_questions`

| `assessment_templates` | Tipo | Obrigatório | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK |
| `source_key` | texto | Não | único quando presente |
| `title`, `description` | texto | Sim | |
| `duration_minutes` | inteiro | Sim | > 0 |
| `max_score` | decimal | Sim | > 0 |
| `status` | enum | Sim | `ACTIVE`, `ARCHIVED` |
| `edited_by_teacher_at`, `created_at`, `updated_at`, `deleted_at` | timestamp | | |

| `assessment_template_questions` | Tipo | Obrigatório | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK |
| `template_id` | UUID | Sim | FK → `assessment_templates.id`, exclusão em cascata |
| `question_id` | UUID | Sim | FK → `questions.id` |
| `position` | inteiro | Sim | ≥ 1; único por modelo |
| `weight` | decimal | Sim | > 0 |

Unicidade (`template_id`, `question_id`).

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: o motor é um serviço interno e a carga é um comando de linha. O comando `seed` aceita o caminho do manifesto (padrão: o arquivo gerado pela SPEC-005) e usa as mesmas variáveis de ambiente do backend.

## 6. Impacto e Riscos (Impact & Risks)

- **Motor em Go decidindo diferente do legado.**
  *Mitigação:* fixtures de equivalência da SPEC-005 como teste obrigatório (RN-02).
- **Carga apagando trabalho da docente.**
  *Mitigação:* `edited_by_teacher_at` preserva o item; a carga nunca exclui (RN-04).
- **Carga parcial por falha no meio.**
  *Mitigação:* transação única (RN-04).
- **Exposição de gabaritos.**
  *Mitigação:* `validation_conditions` e `answer_key` nunca saem em endpoints de estudante (regra reforçada na SPEC-012).
- **HTML perigoso.**
  *Mitigação:* filtragem na extração e de novo na importação (RN-08).

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: QUANDO as migrações rodarem, O SISTEMA DEVE criar as tabelas da seção 4, as colunas novas de `course_modules` e a chave estrangeira de `module_exercise_items.exercise_id`.
- [x] **CA-02**: QUANDO o motor avaliar cada caso das fixtures de equivalência, O SISTEMA DEVE produzir exatamente o veredito esperado.
- [x] **CA-03**: Cada tipo de condição do catálogo DEVE ter pelo menos um teste positivo e um negativo.
- [x] **CA-04**: SE a lista de condições for inválida, ENTÃO O SISTEMA DEVE recusá-la sem aprovar.
- [x] **CA-05**: QUANDO a carga rodar num banco vazio, O SISTEMA DEVE inserir tudo numa transação e registrar as contagens.
- [x] **CA-06**: QUANDO a carga rodar duas vezes, as contagens de linhas DEVEM ser idênticas.
- [x] **CA-07**: SE um item tiver `edited_by_teacher_at` preenchido, ENTÃO a carga NÃO DEVE alterá-lo.
- [x] **CA-08**: SE a carga falhar no meio, ENTÃO nenhuma linha DEVE ficar gravada.
- [x] **CA-09**: SE a conta de `ADMIN_EMAIL` não existir, ENTÃO o comando DEVE falhar com mensagem clara.
- [x] **CA-10**: Nenhum bloco gravado DEVE conter `<script`, atributos `on*` ou URLs `javascript:`.
- [x] **CA-11**: Cada questão de uso `EXERCISE` DEVE estar ligada ao seu módulo em `module_exercise_items`, na ordem do legado.

## 8. Plano de Testes (Test Plan)

- **Domínio:** testes unitários do motor por tipo de condição (CA-03, CA-04) e teste de paridade com as fixtures (CA-02).
- **Service:** carga com repositório substituído por implementação em memória: inserção, atualização, preservação de editados e contagens (CA-05 a CA-07, CA-09, CA-11).
- **Repository:** integração com PostgreSQL real via `testcontainers-go`: migrações (CA-01), transação revertida em falha simulada (CA-08) e carga duplicada (CA-06).
- **Filtragem de HTML:** fragmentos com *script*, eventos e `javascript:` (CA-10).
- **Cobertura:** acima de 80% em `domain` e `service` do módulo `content`.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** SPEC-005 (formato do manifesto e das fixtures), SPEC-010 (módulos de ensino) e `legacy/src/linux/Serializador.ts` (formato do estado).
2. **Ordem:** migração → domínio (catálogos, motor) → repository → service de carga → comando `seed` → testes.
3. **Arquivos a criar ou alterar:** `backend/migrations/` (nova migração), `backend/internal/modules/content/` (`domain`, `service`, `repository`, `seed/data/`), `backend/cmd/seed/` e `backend/go.mod` (`bluemonday`).
4. **Definição de pronto:** CA-01 a CA-11 verificados e cobertura acima de 80%.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-08 aprovadas pelo Tech Lead em 08/10/2026 (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Implementador (Claude) | Criação a partir da divisão aprovada da SPEC-005 original (banco, motor de correção e carga), alinhada à SPEC-010 e ao insumo de conversão. Pendências P-01 a P-08 |
| 08/10/2026 | Tech Lead | Aprovação integral das recomendações P-01 a P-08. Status: `Aprovada` |
| 08/10/2026 | Implementador (Claude) | Implementação concluída; status `Implementada`. **Verificação:** o motor em Go reproduziu o veredito do avaliador TypeScript em todos os 625 estados das 221 questões das fixtures (CA-02); 23 tipos com teste positivo e negativo (CA-03); listas inválidas recusadas (CA-04); teste de integração com PostgreSQL real e o manifesto verdadeiro cobrindo CA-01 e CA-05 a CA-11; cobertura de 85,7% (`content/domain`), 91,6% (`content/service`) e 93,6% (`coursemodule/service`); suíte completa do backend passando. Carga real no banco de desenvolvimento: 9 módulos, 394 blocos, 236 cenários, 252 questões (220 publicadas), 7 modelos e 42 exercícios ligados. **Desvios:** (1) `tags` gravado como `jsonb`, e não como lista de texto do PostgreSQL, para não depender de `lib/pq`, que não está autorizado; (2) questão prática em `DRAFT` sem condições é gravada com lista vazia, que o motor nunca aprova, porque o extrator não consegue sugerir condições para todos os rascunhos (ex.: `av-med-10`); as publicadas continuam obrigadas a ter lista válida; (3) o comando `seed` aplica as migrações pendentes antes de carregar e embute o manifesto no binário (`-manifest` permite outro arquivo); (4) a carga passa pelo novo `Seeder` do módulo `coursemodule` (inserir, atualizar ou preservar módulos e ligar exercícios), e a edição de módulo pelo PATCH da SPEC-010 passa a marcar `edited_by_teacher_at`; módulo excluído pela docente conta como editado e não é recriado; (5) cenários da carga são atualizados quando o manifesto muda, porque ainda não há autoria de cenários; a imutabilidade da seção 4.3 vale para cenários criados pela futura autoria; (6) as unicidades de posição de blocos e de questões de modelo são adiáveis (`DEFERRABLE`), para reordenações dentro de uma transação; (7) o teste de repositório da SPEC-010 inseria itens de exercício com IDs aleatórios e passou a criar questões reais, por causa da chave estrangeira desta spec (RN-10); (8) recarga conta itens não editados como "atualizados", sem categoria separada para "sem mudança". |
| 08/10/2026 | Implementador (Claude) | Catálogo revisado pela SPEC-013: tipos `CONTENT_NOT_CONTAINS`, `CONTENT_LINE_COUNT`, `ANY_OF` e `PACKAGES_AT_VERSIONS` |
