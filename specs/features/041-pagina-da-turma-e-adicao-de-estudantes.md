# SPEC-041: Página da Turma, Adição de Estudantes e Apresentação da Disciplina

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-041 |
| **Status** | Implementada |
| **Data de criação** | 13/10/2026 |
| **Última revisão** | 13/10/2026 (implementada) |
| **Autor** | Aruna Architect (redigida pelo Claude a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classgroup` (turma e matrícula); no frontend, as telas de turmas |
| **Contexto de tela** | `/app/classes/:id` (nova), `/app/classes/new`, `/app/classes/:id/settings`, `/app/classes/:id/members` e `/app/classes/:id/students` (passam a redirecionar), card da turma em `/app/classes` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-002, SPEC-009, SPEC-015, SPEC-019, SPEC-026, SPEC-038 |
| **Substitui** | Nenhuma. Revisa a SPEC-009: o seletor de estudantes sai do formulário de criação e vai para a página da turma (D-03) |
| **Fontes canônicas** | Pedido do Tech Lead de 13/10/2026 (relato dos professores: "criam a turma e têm muita dificuldade para adicionar os alunos"); SPEC-009, seção 3.1 (formulário e painel de membros); análise de usabilidade de 13/10/2026 com o checklist da skill *ui-ux-pro-max* |

---

## 1. Contexto e Problema (Context & Problem Statement)

Os professores criam a turma e não conseguem colocar os estudantes nela. A análise do fluxo atual achou quatro bloqueios:

1. **Beco sem saída depois de criar.** Ao salvar, o formulário volta para a listagem `/app/classes`. Nada indica o próximo passo.
2. **A tela que adiciona estudantes está escondida.** `/app/classes/:id/students` tem o botão "Importar CSV" com a turma já escolhida, mas nenhum link do sistema leva até ela. O card da turma leva a `/app/classes/:id/members`, que só lista e modera pedidos e não tem como adicionar ninguém.
3. **Não há como matricular um estudante que já tem conta.** O cadastro manual (`POST /api/v1/students`) aceita uma turma, mas recusa e-mail ou RA já cadastrados (SPEC-002, RN-02). Quem já esteve noutra turma só entra pelo CSV ou pelo link de convite. O seletor múltiplo de estudantes previsto na SPEC-009 nunca foi feito na tela, embora o backend já aceite `initialStudentIds` na criação.
4. **Os caminhos estão espalhados por quatro telas:** cadastro manual e CSV no menu "Estudantes", CSV da turma na página escondida, link de convite nas configurações e moderação em `/members`.

Há ainda dois defeitos relacionados:

- O menu da conta (SPEC-026) aponta cada turma para `/app/classes/:id`, rota que **não existe** (404) para docentes e estudantes.
- O estudante não tem tela nenhuma para ler os dados da turma em que está matriculado.

Sobre a apresentação da disciplina, o Tech Lead pediu:

- **editor de texto formatado** para a ementa e as diretrizes institucionais, hoje caixas de texto puro;
- um **resumo da disciplina**: texto curto, escrito pela docente, que apresenta a turma.

O formulário de criação e edição também tem problemas de usabilidade:

- os erros aparecem só no topo;
- não há agrupamento de campos;
- o botão de enviar não dá retorno;
- há um `<button>` dentro de um `<a>`;
- o foco é pouco visível;
- os campos de data e as caixas de texto usam fonte monoespaçada;
- o subtítulo foi reaproveitado da listagem;
- há mensagens escritas direto no componente;
- a conversão de datas usa UTC, então na edição a data pode aparecer um dia antes no fuso de Brasília.

## 2. Objetivos (Goals)

- Uma **página da turma** em `/app/classes/:id`, que passa a ser o destino de todo link para uma turma.
- Na página da turma, a docente tem um botão principal **"Adicionar estudantes"** com três caminhos:
  - **selecionar estudantes já cadastrados** (busca e seleção múltipla);
  - **cadastrar um estudante novo** já matriculado na turma;
  - **importar CSV** para a turma.

  O link de convite aparece na mesma página, com estado e botão de copiar.
- Depois de criar a turma, a docente vai direto para a página da turma, na aba "Estudantes", com uma mensagem de sucesso e um estado vazio que explica os caminhos.
- Matrícula em lote de estudantes já cadastrados, por um endpoint novo.
- **Resumo da disciplina**: campo novo, texto puro e curto, mostrado no card da turma e no topo da página da turma.
- **Ementa e diretrizes institucionais** editadas com o `RichTextEditor` (SPEC-019), guardadas como HTML filtrado pelo servidor.
- O **estudante** com matrícula ativa lê, na página da turma, o resumo, a ementa, as diretrizes, a vigência e os horários.
- O formulário de criação e edição é corrigido nos pontos listados na seção 1.

### 2.1. Fora de escopo (Non-Goals)

- Remover estudante da turma (desmatrícula) e remanejamento (`Transfer`).
- Mudar as regras do link de convite (geração do token, janela de validade, moderação). A página só mostra o link e copia.
- Mural de avisos (`Announcement`) e qualquer conteúdo da turma além do descrito aqui.
- Imagens, vídeos ou tabelas na ementa e nas diretrizes (D-05).
- Editar dados de um estudante a partir da página da turma.
- Mudar a listagem `/app/classes`, exceto o resumo e o destino dos links no card.
- Qualquer alteração em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

#### 3.1.1. Página da turma (`/app/classes/:id`)

**Cabeçalho, comum a todos os papéis:**

- nome da turma (título `h1`);
- linha com código da disciplina, semestre letivo e status da turma (texto e cor, nunca só cor);
- o resumo da disciplina, quando houver;
- para a docente, links "Configurações" (para `/app/classes/:id/settings`) e "Voltar para Turmas".

**Visão da docente: duas abas, com estado na URL (`?tab=overview` e `?tab=students`; padrão `overview`).**

- **Visão geral:**
  - vigência (início e término, em data local);
  - horários dos encontros;
  - encontros virtuais (sim ou não);
  - ementa e diretrizes renderizadas como HTML filtrado;
  - quantidade de estudantes ativos e de pedidos pendentes.

  Seção vazia mostra "Não informado".
- **Estudantes:**
  - botão principal "Adicionar estudantes";
  - cartão do link de convite;
  - a tabela de membros atual (`ClassMembersTable`, abas "Ativos" e "Pendentes", com moderação).

  Quando não há nenhum membro, a tabela dá lugar a um **estado vazio** que explica os três caminhos e o link de convite, com um botão para cada.

**Visão do estudante:** só o conteúdo da aba "Visão geral", sem abas, contagens, membros, link de convite nem ações.

**Estados:**

- carregando: esqueleto com o espaço do cabeçalho reservado;
- turma não encontrada ou sem acesso: mensagem e link para voltar;
- erro de rede: mensagem com o botão "Tentar de novo".

#### 3.1.2. Adicionar estudantes

"Adicionar estudantes" abre um diálogo modal com três opções em abas: "Já cadastrados", "Novo estudante" e "Importar CSV".

- **Já cadastrados:**
  - campo de busca por nome, e-mail ou RA, com espera de 300 ms após a digitação, usando `GET /api/v1/students?search=`;
  - lista com caixa de seleção por estudante (nome, e-mail, RA);
  - quem já tem matrícula ativa ou pendente na turma aparece marcado como "Já na turma" e desabilitado;
  - contador "N selecionados" e botão "Matricular N estudantes";
  - a seleção se mantém entre buscas diferentes.

  Ao confirmar, chama o endpoint da seção 5.1 e mostra o resultado do lote: matriculados, já matriculados e recusados com o motivo. Depois fecha e recarrega a tabela.
- **Novo estudante:** o formulário do `StudentFormModal` com a turma fixada (sem seletor de turma).
- **Importar CSV:** o fluxo do `StudentImportCsvModal` com a turma fixada.

O diálogo:

- fecha com Esc e com o botão "Fechar";
- devolve o foco ao botão que o abriu;
- pede confirmação para fechar se houver estudantes selecionados ainda não matriculados.

#### 3.1.3. Cartão do link de convite (aba "Estudantes")

- **Link habilitado e dentro da janela:**
  - a URL completa do convite em campo somente leitura;
  - botão "Copiar link", com confirmação "Link copiado" anunciada por `aria-live`;
  - a data e hora de expiração.
- **Link desabilitado, fora da janela ou turma não ativa:** o motivo em texto e um link para as configurações da turma.

#### 3.1.4. Formulário de criação e edição (`ClassForm`)

**Grupos (`fieldset` com `legend`):**

1. **Identificação:** nome, código da disciplina, semestre letivo, resumo da disciplina (caixa de texto com contador "N/300").
2. **Vigência e encontros:** data de início, data de término, horários, encontros virtuais. Cada caixa de seleção tem um texto de ajuda.
3. **Conteúdo:**
   - ementa e diretrizes institucionais com o `RichTextEditor`, sem o botão de imagem;
   - para a edição de uma turma antiga, o texto puro existente é mostrado como parágrafos (RN-07).
4. **Ingresso:** link de convite, como hoje, com um texto de ajuda que explica a moderação.

**Validação e retorno:**

- cada erro aparece abaixo do campo, ligado por `aria-describedby`, e o campo recebe `aria-invalid`;
- havendo erros, o foco vai para o primeiro campo inválido;
- um resumo no topo, com `role="alert"`, só aparece para erros do servidor que não são de um campo.

**Envio:**

- durante o envio o botão fica desabilitado e mostra "Criando…" ou "Salvando…";
- "Cancelar" é um link com aparência de botão, sem `<button>` dentro de `<a>`.

**Após criar:** vai para `/app/classes/:id?tab=students` e mostra a mensagem "Turma criada. Agora adicione os estudantes."

**Datas:** são lidas e mostradas na data local. A data de término continua sendo enviada como o fim do dia (comportamento da SPEC-009), calculada sem deslocar o dia no fuso do navegador.

**Textos:**

- todos os textos do formulário, inclusive os erros hoje escritos no componente, ficam em `messages/pt-BR`;
- o subtítulo de `/app/classes/new` passa a descrever o cadastro.

**Estilo (tokens da SPEC-015, sem cor literal):**

- campos de data e caixas de texto herdam a fonte da interface;
- os campos de data usam o esquema de cor escuro, para o ícone do calendário ficar visível;
- o foco tem um anel visível de 2 px (token `--color-focus-ring`);
- o erro tem ícone além da cor.

#### 3.1.5. Navegação

- O card da turma (`ClassCard`) leva a `/app/classes/:id`, mostra o resumo (até 2 linhas, com reticências e o texto completo no `title`) e tem a ação "Adicionar estudantes", que abre `/app/classes/:id?tab=students`.
- `/app/classes/:id/members` e `/app/classes/:id/students` redirecionam para `/app/classes/:id?tab=students` (D-07).
- O menu da conta (SPEC-026) já aponta para `/app/classes/:id` e passa a funcionar sem mudança.

#### 3.1.6. Serviços

`classService` ganha:

- `enrollStudents(classId, studentIds)`;
- `getMyClass(classId)`;
- o campo `summary` nos tipos da turma.

Os erros RFC 7807 chegam tipados aos componentes (ARCHITECTURE, seção 4.3).

### 3.2. Backend (Go — Camada de Módulo/Service)

**Regras de negócio:**

- **RN-01 (resumo):** `summary` é texto puro, sem espaços nas pontas, com no máximo 300 caracteres (contados em runas). Vazio é permitido. Acima do limite, erro de validação no campo.
- **RN-02 (HTML da ementa e das diretrizes):**
  - `syllabus` e `institutionalGuidelines` passam pelo filtro `htmlsafe` (a mesma lista da descrição do módulo) antes de gravar, na criação e na edição;
  - imagens são removidas (D-05);
  - cada campo tem no máximo 20.000 caracteres depois do filtro.
- **RN-03 (matrícula em lote, autorização):** só a docente dona da turma, ou um administrador, matricula. Caso contrário, 403 com `forbidden` (o mesmo de hoje para turma de outra docente).
- **RN-04 (matrícula em lote, estado da turma):** turma `ARCHIVED` recusa a matrícula com 409 `class-archived`. Turmas `DRAFT` e `ACTIVE` aceitam (D-06).
- **RN-05 (matrícula em lote, tratamento por estudante).** Cada id é tratado de forma independente e entra numa das categorias do resultado:

  | Situação do id | Resultado |
  | :--- | :--- |
  | Sem matrícula na turma | Cria matrícula `ACTIVE`, origem `DIRECT_BY_TEACHER`, com `decided_at` agora → **matriculado** |
  | Matrícula `PENDING_MODERATION` | Passa a `ACTIVE` com `decided_at` agora → **matriculado** |
  | Matrícula `REJECTED` ou `UNENROLLED` | Volta a `ACTIVE`, origem `DIRECT_BY_TEACHER`, com `decided_at` agora → **matriculado** |
  | Matrícula `ACTIVE` | Nada muda → **já matriculado** |
  | Matrícula `TRANSFERRED` | Nada muda → **recusado**, motivo `transferred` |
  | Usuário inexistente, removido ou sem papel `STUDENT` | Nada muda → **recusado**, motivo `not-a-student` |

  Ids repetidos no corpo contam uma vez só.
- **RN-06 (atomicidade):**
  - o lote roda numa transação aberta no service (ARCHITECTURE, seção 3.6);
  - um conflito de unicidade em `(class_id, user_id)` não aborta a transação: a inserção usa a forma que ignora o conflito e trata a linha como já existente;
  - a mesma correção vale para `initialStudentIds` na criação da turma, que hoje continua o laço depois de um erro de unicidade, quando a transação do PostgreSQL já foi abortada (D-08).
- **RN-07 (texto antigo):** ementa e diretrizes gravadas antes desta spec como texto puro são convertidas para HTML na migração:
  - cada bloco separado por linha em branco vira um parágrafo;
  - quebras simples viram quebras de linha;
  - os caracteres especiais são escapados.

  Campos vazios continuam vazios.
- **RN-08 (leitura pelo estudante):**
  - o estudante com matrícula `ACTIVE` lê a turma pelo endpoint da seção 5.2;
  - qualquer outro estudante, ou matrícula em outro status, recebe 404 `class-not-found`, sem revelar que a turma existe;
  - turma `ARCHIVED` continua legível para quem tinha matrícula `ACTIVE`.
- **RN-09 (campos da leitura pelo estudante):** só os campos listados na seção 5.2. Nunca o token do convite, contagens de membros, motivo de arquivamento ou dados de outros estudantes.

**Camadas:**

- **Handler:** valida o corpo, aplica o RBAC por rota e traduz erros em RFC 7807.
- **Service:** aplica as regras RN-01 a RN-09 e abre a transação do lote.
- **Repository:**
  - busca as matrículas existentes dos ids em uma consulta;
  - busca os usuários e papéis dos ids em uma consulta;
  - grava as mudanças.

## 4. Modelo de Dados (Data Model)

**Tabela `classes` (entidade `ClassGroup`), alterada:**

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `summary` | text | Sim | Padrão `''`; até 300 caracteres (RN-01, validado no service) | **Novo.** Resumo da disciplina, texto puro |
| `syllabus` | text | Não | HTML filtrado, até 20.000 caracteres (RN-02) | **Muda de formato:** de texto puro para HTML; conteúdo existente convertido (RN-07) |
| `institutional_guidelines` | text | Não | HTML filtrado, até 20.000 caracteres (RN-02) | **Muda de formato:** de texto puro para HTML; conteúdo existente convertido (RN-07) |

**Tabela `class_enrollments`:** sem mudança de schema. O lote usa a unicidade existente `class_enrollments_class_user_unique` e as origens e status já definidos.

**Migração:** `00025`, que:

- cria `summary`;
- converte o texto antigo (RN-07).

A volta (down) remove `summary` e não desconverte o HTML.

**Exclusão:** nenhuma exclusão nova.

## 5. Contrato de API (API Contract)

### 5.1. **`POST /api/v1/classes/:id/enrollments`**: matricula em lote estudantes já cadastrados

- **Papéis autorizados:** `TEACHER` (dona da turma) e `ADMIN`.
- **Parâmetros de rota:**

| Nome | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | Turma existente |

- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `studentIds` | lista de UUID | Sim | De 1 a 200 itens; repetidos contam uma vez |

- **Resposta de sucesso:** `200`.

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `enrolled` | lista de UUID | Sim | Estudantes que ficaram com matrícula `ACTIVE` por este pedido |
| `alreadyEnrolled` | lista de UUID | Sim | Estudantes que já estavam `ACTIVE` |
| `rejected` | lista de objetos `{ studentId, reason }` | Sim | Ids recusados; `reason` é `not-a-student` ou `transferred` |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `malformed-request` | Corpo ilegível, `studentIds` ausente, vazio, com mais de 200 itens ou com id que não é UUID |
| 403 | `forbidden` | Docente que não é dona da turma |
| 404 | `class-not-found` | Turma inexistente ou removida |
| 409 | `class-archived` | Turma arquivada (RN-04) |

### 5.2. **`GET /api/v1/me/classes/:id`**: dados da turma para o estudante matriculado

- **Papéis autorizados:** `STUDENT`, com a senha já trocada (mesma proteção de `GET /me/classes`).
- **Parâmetros de rota:** `id` (UUID, obrigatório).
- **Resposta de sucesso:** `200`.

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | Turma |
| `name` | texto | Sim | Nome da turma |
| `courseCode` | texto | Sim | Código da disciplina |
| `semester` | texto | Sim | Semestre letivo |
| `status` | texto | Sim | `DRAFT`, `ACTIVE` ou `ARCHIVED` |
| `summary` | texto | Sim | Resumo, possivelmente vazio |
| `syllabus` | texto (HTML) | Sim | Ementa filtrada, possivelmente vazia |
| `institutionalGuidelines` | texto (HTML) | Sim | Diretrizes filtradas, possivelmente vazias |
| `startDate`, `endDate` | data e hora (ISO 8601) | Sim | Vigência |
| `scheduleDescription` | texto | Sim | Horários, possivelmente vazio |
| `enableVirtualClassroom` | booleano | Sim | Encontros virtuais |
| `teacherName` | texto | Não | Nome da docente, quando cadastrado |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-uuid` | `id` não é UUID |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Papel diferente de `STUDENT` |
| 404 | `class-not-found` | Turma inexistente ou sem matrícula `ACTIVE` do estudante (RN-08) |

### 5.3. Endpoints existentes alterados

| Endpoint | Mudança |
| :--- | :--- |
| `POST /api/v1/classes` | Aceita `summary` (RN-01). `syllabus` e `institutionalGuidelines` são filtrados (RN-02). Erro 400 `invalid-summary` ou `content-too-long`, com o campo no corpo do problema. `initialStudentIds` segue a RN-06 |
| `PATCH /api/v1/classes/:id` | Aceita `summary`, com as mesmas regras e erros |
| `GET /api/v1/classes`, `GET /api/v1/classes/:id` | Respondem com `summary` |

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| HTML na ementa e nas diretrizes abre espaço para XSS | Filtro `htmlsafe` no servidor ao gravar (RN-02) e renderização só do HTML já filtrado; teste com `<script>` e atributos `on*` |
| A conversão do texto antigo muda conteúdo existente | A migração só envolve e escapa (RN-07), sem apagar nada; teste de migração com texto multilinha e caracteres especiais |
| Docente matricula a pessoa errada no lote | A lista mostra nome, e-mail e RA; o resultado mostra quem entrou. Remover estudante fica para outra spec (fora de escopo) |
| Abuso do lote | Limite de 200 ids por pedido, só a dona da turma ou um administrador, e consultas em lote no repository (sem uma consulta por id) |
| Links antigos para `/members` e `/students` | Redirecionamento (seção 3.1.5) |
| Matrícula em turma `DRAFT` dá acesso de leitura ao estudante antes da turma começar | A leitura só expõe a apresentação da disciplina (RN-09). Avaliações e materiais seguem as próprias regras |
| Mudança na SPEC-009 (seletor sai da criação) | Registrada no histórico da SPEC-009 na implementação. O campo `initialStudentIds` continua aceito pela API |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente cria uma turma com sucesso, O SISTEMA DEVE levá-la a `/app/classes/:id?tab=students` com a mensagem "Turma criada. Agora adicione os estudantes."
- [ ] **CA-02** (estado): ENQUANTO a turma não tiver membros, a aba "Estudantes" DEVE mostrar o estado vazio com os três caminhos e o link de convite.
- [ ] **CA-03** (evento): QUANDO a docente seleciona estudantes já cadastrados e confirma, O SISTEMA DEVE matriculá-los conforme a RN-05 e mostrar o resultado com as três categorias.
- [ ] **CA-04** (estado): ENQUANTO um estudante tiver matrícula ativa ou pendente na turma, a lista "Já cadastrados" DEVE mostrá-lo como "Já na turma" e desabilitado.
- [ ] **CA-05** (indesejado): SE quem pede a matrícula em lote não for a dona da turma nem administrador, ENTÃO O SISTEMA DEVE responder 403 `forbidden` sem criar matrícula.
- [ ] **CA-06** (indesejado): SE a turma estiver arquivada, ENTÃO O SISTEMA DEVE responder 409 `class-archived` à matrícula em lote.
- [ ] **CA-07** (ubíquo): O SISTEMA DEVE gravar o lote de forma atômica e não falhar por ids repetidos ou já matriculados, na matrícula em lote e em `initialStudentIds` (RN-06).
- [ ] **CA-08** (evento): QUANDO a docente cadastra um estudante novo ou importa um CSV pela página da turma, O SISTEMA DEVE matriculá-lo nessa turma, sem pedir a escolha da turma.
- [ ] **CA-09** (estado): ENQUANTO o link de convite estiver válido, a aba "Estudantes" DEVE mostrar a URL e o botão "Copiar link", que copia a URL e anuncia "Link copiado".
- [ ] **CA-10** (ubíquo): O SISTEMA DEVE aceitar o resumo com até 300 caracteres e recusar acima disso com erro no campo (RN-01), e mostrá-lo no card e no cabeçalho da página da turma.
- [ ] **CA-11** (ubíquo): O SISTEMA DEVE editar a ementa e as diretrizes com o editor formatado e gravá-las filtradas, sem scripts, atributos de evento nem imagens (RN-02).
- [ ] **CA-12** (ubíquo): A migração DEVE converter a ementa e as diretrizes em texto puro para parágrafos de HTML com o texto escapado (RN-07).
- [ ] **CA-13** (evento): QUANDO um estudante com matrícula `ACTIVE` abre `/app/classes/:id`, O SISTEMA DEVE mostrar resumo, ementa, diretrizes, vigência e horários, sem abas, membros, convite ou ações.
- [ ] **CA-14** (indesejado): SE o estudante não tiver matrícula `ACTIVE` na turma, ENTÃO `GET /me/classes/:id` DEVE responder 404 `class-not-found`.
- [ ] **CA-15** (indesejado): SE o formulário tiver erros, ENTÃO O SISTEMA DEVE mostrar cada erro abaixo do seu campo, marcar o campo como inválido e mover o foco para o primeiro deles.
- [ ] **CA-16** (estado): ENQUANTO o formulário é enviado, o botão principal DEVE ficar desabilitado e mostrar "Criando…" (criação) ou "Salvando…" (edição).
- [ ] **CA-17** (ubíquo): O formulário de edição DEVE mostrar as datas da turma no mesmo dia gravado, no fuso de Brasília.
- [ ] **CA-18** (evento): QUANDO alguém abre `/app/classes/:id/members` ou `/app/classes/:id/students`, O SISTEMA DEVE redirecionar para `/app/classes/:id?tab=students`.
- [ ] **CA-19** (ubíquo): O card da turma DEVE levar a `/app/classes/:id` e ter a ação "Adicionar estudantes".
- [ ] **CA-20** (ubíquo): Os textos novos e os erros do formulário DEVEM vir de `messages/pt-BR`, e as folhas de estilo não podem ter cor literal (Stylelint limpo).

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

**Backend, `classgroup`:**

| Teste | Camada | Cobre |
| :--- | :--- | :--- |
| `TestEnrollStudents_CreatesActiveDirectByTeacher` | service | CA-03 |
| `TestEnrollStudents_PromotesPendingAndReactivatesRejectedOrUnenrolled` | service | CA-03 |
| `TestEnrollStudents_ReportsAlreadyEnrolledAndRejectedReasons` | service | CA-03 |
| `TestEnrollStudents_DeduplicatesIds` | service | CA-07 |
| `TestEnrollStudents_RefusesNonOwner` | service | CA-05 |
| `TestEnrollStudents_RefusesArchivedClass` | service | CA-06 |
| `TestCreateClass_ValidatesSummaryLength` e `TestUpdateClass_ValidatesSummaryLength` | service | CA-10 |
| `TestCreateClass_SanitizesSyllabusAndGuidelines` | service | CA-11 |
| `TestGetMyClass_ActiveEnrollmentOnly` | service | CA-13, CA-14 |
| `TestGetMyClass_HidesTeacherOnlyFields` | service | CA-13 |
| `TestEnrollmentsRoute_ValidationAndProblems` (400, 403, 404, 409) | handler | CA-05, CA-06 |
| `TestMyClassRoute_RolesAndNotFound` | handler | CA-14 |
| `TestRepository_EnrollStudentsIgnoresUniqueConflict` | repository (PostgreSQL real) | CA-07 |
| `TestRepository_CreateClassWithDuplicateInitialStudents` (reproduz o defeito da RN-06) | repository (PostgreSQL real) | CA-07 |
| `TestMigration00025_ConvertsPlainTextToParagraphs` | repository (PostgreSQL real) | CA-12 |

**Frontend:**

| Teste | Arquivo | Cobre |
| :--- | :--- | :--- |
| redireciona para a turma criada com a mensagem | `classes/new/page.test.tsx` | CA-01 |
| mostra o estado vazio sem membros | `classes/[id]/page.test.tsx` | CA-02 |
| seleciona, mantém a seleção entre buscas e mostra o resultado do lote | `AddStudentsDialog.test.tsx` | CA-03 |
| desabilita quem já está na turma | `AddStudentsDialog.test.tsx` | CA-04 |
| novo estudante e CSV com a turma fixada | `AddStudentsDialog.test.tsx` | CA-08 |
| copia o link e anuncia | `InviteLinkCard.test.tsx` | CA-09 |
| contador e erro do resumo; resumo no card e no cabeçalho | `ClassForm.test.tsx`, `ClassCard.test.tsx`, `classes/[id]/page.test.tsx` | CA-10 |
| ementa e diretrizes no editor, sem botão de imagem | `ClassForm.test.tsx` | CA-11 |
| visão do estudante sem abas nem ações | `classes/[id]/page.test.tsx` | CA-13 |
| erro abaixo do campo, `aria-invalid` e foco no primeiro | `ClassForm.test.tsx` | CA-15 |
| texto do botão durante o envio | `ClassForm.test.tsx` | CA-16 |
| data de edição sem deslocar o dia | `ClassForm.test.tsx` | CA-17 |
| redirecionamento das rotas antigas | `classes/[id]/members/page.test.tsx`, `classes/[id]/students/page.test.tsx` | CA-18 |
| link e ação do card | `ClassCard.test.tsx` | CA-19 |
| `enrollStudents` e `getMyClass` com `fetch` falso, inclusive erros RFC 7807 | `classService.test.ts` | CA-03, CA-14 |

**Verificação estática:** ESLint e Stylelint limpos nos arquivos alterados (CA-20).

**Manual (roteiro):**

1. Como docente, crie uma turma, preenchendo resumo, ementa formatada e diretrizes.
2. Confirme a chegada na aba "Estudantes" com o estado vazio.
3. Matricule dois estudantes já cadastrados (um deles com matrícula pendente).
4. Cadastre um estudante novo e importe um CSV.
5. Habilite o link de convite e copie.
6. Entre como um dos estudantes, abra a turma pelo menu da conta e confira a visão geral.
7. Navegue só com teclado pelo formulário e pelo diálogo.

**Cobertura:** acima de 80% em `classgroup/domain`, `service` e `handler`, e nos componentes, serviços e páginas alterados.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:**
   - `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md` e `specs/GLOSSARY.md`;
   - as SPECs 009, 019, 026 e 038;
   - `backend/internal/modules/classgroup/` inteiro;
   - `backend/internal/modules/student/` (`listStudents`, `RegisterManual`, `importCSV`);
   - `backend/internal/platform/htmlsafe/htmlsafe.go`;
   - `frontend/src/components/ClassForm/`, `ClassCard/`, `ClassMembersTable/`, `StudentFormModal/`, `StudentImportCsvModal/` e `RichTextEditor/`;
   - `frontend/src/app/app/classes/`.
2. **Ordem de execução:**
   1. Testes do backend (vermelhos) e commit `test(classgroup)`.
   2. Migração, domain, repository, service e handler, e commit `feat(classgroup)`.
   3. Testes do frontend (vermelhos) e commit `test(frontend)`.
   4. Serviço, componentes e páginas, e commit `feat(frontend)`.
   5. Estilos e mensagens.
   6. Roteiro manual.
   7. Status `Implementada` e linha no histórico da SPEC-009.
3. **Arquivos a criar ou alterar:**
   - **Backend:**
     - `backend/migrations/00025_class_summary_and_rich_text.sql`;
     - `backend/internal/modules/classgroup/domain/class.go`;
     - `service/service.go`, `repository/repository.go` e `handler/handler.go`, com os testes de cada um.
   - **Frontend, arquivos novos:**
     - `frontend/src/app/app/classes/[id]/page.tsx` e o `page.module.scss` correspondente;
     - `frontend/src/components/AddStudentsDialog/`;
     - `frontend/src/components/InviteLinkCard/`.
   - **Frontend, arquivos alterados:**
     - `frontend/src/app/app/classes/new/page.tsx`;
     - `frontend/src/app/app/classes/[id]/members/page.tsx` e `[id]/students/page.tsx` (passam a redirecionar);
     - `frontend/src/components/ClassForm/`, `ClassCard/`, `StudentFormModal/` (turma fixada) e `StudentImportCsvModal/` (turma fixada, se o componente ainda não permitir);
     - `frontend/src/services/classService.ts`;
     - `frontend/src/messages/pt-BR.ts`.
   - **Specs:** a SPEC-009 recebe uma linha no histórico. Os termos novos (resumo da disciplina, ementa e diretrizes institucionais) já entraram em `specs/GLOSSARY.md` como `Proposto` junto com este rascunho.
4. **Definição de pronto:**
   - todos os CA marcados;
   - testes da seção 8 passando, com cobertura acima de 80%;
   - ESLint, Stylelint e `tsc` limpos;
   - nenhuma violação do `ARCHITECTURE.md`;
   - roteiro manual executado ou declarado pendente;
   - status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (13/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | "Resumo da disciplina" é um texto curto escrito pela docente, mostrado no card e no topo da página da turma |
| D-02 | O estudante com matrícula ativa lê o resumo, a ementa e as diretrizes na página da turma; só a docente edita |
| D-03 | O seletor de estudantes já cadastrados fica só na página da turma, não no formulário de criação (revisa a SPEC-009) |
| D-04 | Ementa e diretrizes usam editor de texto formatado |
| D-05 | O editor da ementa e das diretrizes não aceita imagens (era P-01) |
| D-06 | Turmas em rascunho (`DRAFT`) aceitam matrícula; turma arquivada recusa (era P-02) |
| D-07 | As rotas `/members` e `/students` redirecionam para a página da turma (era P-04) |
| D-08 | O defeito de `initialStudentIds` com id repetido é corrigido nesta spec, a partir de um teste que o reproduz (era P-05) |
| D-09 | O resumo da disciplina tem no máximo 300 caracteres (era P-03) |
| D-10 | O lote reativa matrículas `REJECTED` e `UNENROLLED`; `TRANSFERRED` é recusada (era P-06) |

### Pendências

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |

### Ajustes de implementação

| ID | Ajuste |
| :--- | :--- |
| A-01 | A política sem imagens da RN-02 virou `htmlsafe.NewRichText` em `backend/internal/platform/htmlsafe/htmlsafe.go`, arquivo fora da seção 9, para não duplicar a lista de elementos permitidos |
| A-02 | A transação do lote fica no repository (`SaveEnrollments`), como no resto do módulo `classgroup`; o service decide cada matrícula e chama uma gravação só |
| A-03 | O teste `TestGetMyClass_HidesTeacherOnlyFields` virou `TestMyClassRoute_HidesTeacherOnlyFields`, no handler, onde os campos da resposta são montados |
| A-04 | No diálogo, as abas "Novo estudante" e "Importar CSV" fecham o diálogo e abrem os modais existentes com a turma fixada, em vez de repetir os formulários dentro dele |
| A-05 | Com a turma vazia, a ação principal é o cartão recomendado do estado vazio; o botão "Adicionar estudantes" aparece quando já há membros, para haver uma ação principal por tela |
| A-06 | Visual revisto pelo Tech Lead com a skill *ui-ux-pro-max*: caminho "Gestão de Turmas / turma" no lugar do link "Voltar para Turmas", contagens como indicadores no cabeçalho (nas duas abas), vigência com barra de progresso, cartões dos caminhos e o modal "Cadastrar Estudante" redesenhado |
| A-07 | Defeito anterior, fora da seção 9, autorizado pelo Tech Lead: `StudentSummary` (`backend/internal/modules/student/domain/student.go`) não tinha tags JSON, e a lista de estudantes chegava vazia ao diálogo (CA-03) e à tela Estudantes. Corrigido a partir de um teste vermelho |
| A-08 | Testes alterados depois do vermelho: no estado vazio, a busca por "link de convite" foi restrita ao texto do estado vazio, porque o cartão do convite, que a spec também manda mostrar, repete o termo; três ajustes só de tipagem (`lastCall` e o objeto `StudentClass` completo) |
| A-09 | Os testes de cobertura acharam um caso sem tratamento: um erro do servidor sobre as datas do convite com o convite desligado sumia; agora vai para o resumo do topo |
| A-10 | Ícones da página em `frontend/src/app/app/classes/[id]/icons.tsx`; a página de configurações passou a usar "Salvando…" e a cancelar para a página da turma |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 13/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | Criação do rascunho a partir do relato dos professores e da análise de usabilidade de `/app/classes/new`. Decisões D-01 a D-04; pendências P-01 a P-06 com recomendação |
| 13/10/2026 | Tech Lead | Aprovada ("eu aprovo"), aceitas as recomendações de P-01 a P-06 (D-05 a D-10). Status: `Aprovada` |
| 13/10/2026 | Implementador (Claude) | Implementada; status `Implementada`. **Backend:** migração 00025 (resumo e conversão do texto antigo, aplicada no banco de desenvolvimento), `NewRichText`, `POST /classes/:id/enrollments`, `GET /me/classes/:id`, resumo e ementa filtrados, correção de `initialStudentIds` repetidos. Testes passando, inclusive repository com PostgreSQL real; cobertura `classgroup/domain` 82,4%, `service` 90,9%, `handler` 85,4%. **Frontend:** página da turma, diálogo de adicionar estudantes, cartão do convite, formulário revisto, card, modais com a turma fixada e redirecionamentos; nos arquivos alterados, 95% das linhas e 88% dos ramos, todos acima de 80%; `tsc`, ESLint e Stylelint limpos. **Manual:** executados no navegador a validação do formulário, o estado vazio, a visão geral e a matrícula de um estudante cadastrado pelo diálogo; ficam para a revisão o cadastro de estudante novo, a importação CSV, a cópia do link de convite, a visão do estudante e a navegação só por teclado. Fora do escopo: o teste `CardBuilder` (CA-26) estoura 5 s nesta máquina também sem estas mudanças. **Ajustes:** A-01 a A-10 |
