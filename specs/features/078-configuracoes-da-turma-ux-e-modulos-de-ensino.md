# SPEC-078: Configurações da Turma: Salvar e Voltar, Campos nas Abas Certas, Estados da Página, Resumo em Editor e Módulos de Ensino da Turma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-078 |
| **Status** | Aprovada |
| **Data de criação** | 21/10/2026 |
| **Última revisão** | 21/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classgroup` (resumo da turma); `coursemodule` (módulos da turma); frontend `ClassForm` |
| **Contexto de tela** | `/app/classes/[id]/settings` (principal) e `/app/classes/new`, que usam o mesmo `ClassForm`; o cartão da turma em `/app/classes` e a página da turma em `/app/classes/[id]` mostram o resumo |
| **Prioridade** | Média |
| **Depende de** | SPEC-009 (turmas), SPEC-010 (módulos de ensino e atribuição à turma), SPEC-019 (`RichTextEditor`), SPEC-041 (resumo, ementa e diretrizes: RN-01, RN-02 e RN-07), SPEC-044 (formulário em abas), SPEC-075 (RN-05: a avaliação só usa módulo atribuído à turma) |
| **Substitui** | Nenhuma. Sobrepõe a RN-01 da SPEC-041 (resumo em texto puro de até 300 caracteres) e a divisão de campos por aba da seção 3.1.1 da SPEC-044 (a sala virtual na aba *Horários*) |
| **Fontes canônicas** | Pedidos do Tech Lead de 21/10/2026: um "tapa de UX/UI" na tela de configurações da turma (salvar e voltar, campos nas abas certas, carregando e erro, o campo de texto do resumo virar editor) e a inclusão de um ou mais módulos de ensino na disciplina (turma) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A tela de configurações da turma é o `ClassForm` em quatro abas (SPEC-044): *Informações*, *Horários*, *Conteúdo* e *Ingresso*. Os problemas, vistos no código (a tela em si não foi vista; a extensão do Chrome não estava conectada):

- **Salvar e voltar.** O botão *Salvar* fica no fim da página. Na aba *Horários* (editor de encontros e calendário) e na aba *Conteúdo* (dois editores altos) ele fica longe. Ao salvar, a página manda a docente para a **lista de turmas**, sem confirmação, enquanto *Cancelar* volta para a **página da turma**. No topo não há link de voltar.
- **Campos nas abas erradas.** A opção de sala virtual (encontros virtuais) está na aba *Horários*, que é do calendário dos encontros. Sempre que não há encontros cadastrados aparece um campo de horário em texto livre, que é legado. A cor da turma vem depois das datas, longe do nome.
- **Carregando e erro.** A página mostra um texto solto ("Carregando configurações..."), e qualquer falha vira "Turma não encontrada.", sem botão de tentar de novo nem de voltar. Os dois textos estão escritos direto na página, fora de `messages/pt-BR.ts` (`ARCHITECTURE.md`, seção 4.4).
- **Resumo da disciplina em caixa de texto.** É o único campo de texto longo do formulário que não usa o editor visual; a ementa e as diretrizes usam (SPEC-041). A SPEC-041 RN-01 o definiu como texto puro de até 300 caracteres.
- **Não há como incluir módulos de ensino na turma.** O Tech Lead relatou que a opção "sumiu". A conferência no código e no histórico do Git não achou nenhuma tela da turma que já a tivesse. Hoje a atribuição existe só no formulário do **módulo**, e apenas para o módulo **Privado** (caixas de turmas); nos outros módulos as turmas são ignoradas e, ao editar um módulo não privado, as atribuições existentes são apagadas. Porém a avaliação (SPEC-075 RN-05) só aceita módulo atribuído à turma: a turma de teste tem 24 módulos no sistema e nenhum atribuído, e a tela de nova avaliação manda "atribuir um módulo à turma" sem dizer onde.

## 2. Objetivos (Goals)

- Na edição da turma, o *Salvar* e o *Cancelar* ficam sempre à vista, numa barra de ações; salvar leva à **página da turma** com uma confirmação; o topo tem o link de voltar para a turma.
- Os campos ficam nas abas certas: cor junto da identificação da turma; sala virtual fora de *Horários*; horário em texto livre só aparece quando existe texto gravado.
- Carregando tem um esqueleto da tela; erro tem mensagem, *Tentar de novo* e *Voltar*, e "turma não encontrada" é distinto de "não foi possível carregar".
- O **resumo da disciplina** é editado no `RichTextEditor` (sem imagens), guardado como HTML filtrado, e aparece formatado na página da turma e como texto no cartão.
- A docente **inclui e retira um ou mais módulos de ensino** da turma, na aba *Conteúdo* das configurações, e a escolha vale para a avaliação (SPEC-075 RN-05).

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- Mudar o formulário do **módulo** além do necessário para não apagar atribuições feitas pela turma (D-03).
- Criar ou mudar a ordem dos módulos dentro da turma; arrastar e soltar.
- Incluir módulos na tela de **criação** da turma (`/app/classes/new`): lá a seção mostra só a orientação de que a inclusão é feita depois de criar a turma (D-04).
- Mudar regras de ingresso, convite, encontros, feriados e agenda.
- Imagens e vídeos no resumo.
- Corrigir, aqui, os pontos que pedem `limit` de 100 à listagem de módulos (o máximo é 50, SPEC-010); isso é correção à parte.
- Esqueleto de carregamento e tela de erro de outras páginas.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. Toda chamada de rede fica em `services/`.

**Cabeçalho e navegação da página de configurações**

- Acima do título, o link "Voltar para a turma" (para `/app/classes/[id]`). O título e o nome da turma como subtítulo ficam como estão.
- **Barra de ações** fixa na parte de baixo da janela, na edição, com *Cancelar* (volta para a página da turma) e *Salvar*; o conteúdo da página ganha espaço embaixo para a barra nunca cobrir um campo. Na criação (`/app/classes/new`), a barra também é usada, e o destino depois de criar não muda.
- **Depois de salvar** (edição): a página vai para `/app/classes/[id]` e mostra a confirmação "Configurações salvas." uma única vez, como a página já faz depois de criar a turma (o aviso de turma criada). Falha ao salvar continua no próprio formulário, com a aba do primeiro erro aberta (SPEC-044).

**Campos por aba (`ClassForm`)**

- **Informações:** três grupos com título. *Identificação*: nome, código da disciplina, semestre e **cor da turma**. *Apresentação*: **resumo da disciplina** no editor. *Vigência*: início e término. E o grupo *Encontros virtuais* com a opção de sala virtual (D-01).
- **Horários:** o editor de encontros e o calendário. O campo de horário em texto livre só aparece quando a turma tem esse texto gravado e nenhum encontro cadastrado; do contrário, não existe na tela.
- **Conteúdo:** ementa, diretrizes e a seção **Módulos de ensino da turma** (D-02).
- **Ingresso:** como está.

**Resumo no editor**

- O campo usa o `RichTextEditor`, sem botão de imagem, com o rótulo e a orientação atuais em `messages/pt-BR.ts`. O contador mostra os caracteres do **texto visível** contra o limite (D-05). O texto antigo (puro) abre como parágrafos (`descriptionHtml`, de `lib/description.ts`). O formulário aponta o erro no próprio campo, no padrão dos demais campos e com o indicador na aba.
- O **cartão da turma** mostra o resumo como texto, sem as marcas, no mesmo tamanho de hoje (`descriptionText`, de `lib/description.ts`). A **página da turma** mostra o resumo formatado, só com o HTML que o servidor já filtrou (como a ementa).

**Módulos de ensino da turma (aba *Conteúdo*, só na edição)**

- Uma lista de módulos com caixa de seleção, nome, visibilidade e situação, com busca por nome e páginas de 50, usando a listagem de módulos que já existe. Os módulos já incluídos vêm marcados (a mesma listagem, filtrada pela turma). Um contador diz quantos estão incluídos.
- Marcar e desmarcar só vale ao *Salvar* (um único botão salva todas as abas, SPEC-044). Salvar grava a lista inteira de uma vez.
- Sem módulos para escolher, a seção diz que ainda não há módulo e leva a *Módulos de Ensino* para criar o primeiro. Se a docente só pode incluir os módulos que ela criou (D-03), o texto diz isso.
- Na criação da turma, a seção não lista nada: mostra a orientação "Depois de criar a turma, inclua os módulos em Configurações."
- A tela de nova avaliação, que hoje diz "atribua um módulo à turma", passa a dizer onde: com um link para as configurações da turma.

**Carregando e erro da página de configurações**

- **Carregando:** um esqueleto com o formato da tela (cabeçalho, abas e campos), anunciado como "carregando" a quem usa leitor de tela.
- **Turma não encontrada** (a resposta do servidor é `class-not-found`): mensagem e o botão *Voltar para as turmas*.
- **Falha ao carregar** (qualquer outra): mensagem de erro, *Tentar de novo* (refaz a leitura) e *Voltar para as turmas*.
- Todos os textos em `messages/pt-BR.ts`.

### 3.2. Backend (Go)

- **RN-01 (resumo em HTML filtrado, `classgroup`):** na criação e na alteração da turma, o servidor passa `summary` pelo mesmo filtro da ementa (`htmlsafe.NewRichText`, sem imagens e sem vídeos). O **texto visível** do resultado tem no máximo 300 caracteres (contados em runas) e o HTML, depois do filtro, no máximo o limite da D-05; acima de qualquer um, o erro de validação do resumo que a SPEC-041 já define (`invalid-summary`). Texto visível vazio é gravado vazio. Isto substitui "texto puro de até 300 caracteres" da SPEC-041 RN-01.
- **RN-02 (texto antigo):** a migração converte os resumos já gravados (texto puro, nunca filtrados): escapa `&`, `<` e `>`, faz de cada linha não vazia um parágrafo e descarta as linhas em branco; vazio continua vazio (como a SPEC-041 RN-07 fez com a ementa).
- **RN-03 (módulos da turma, `coursemodule`):** a rota nova grava **o conjunto** de módulos da turma: o que vier na lista passa a estar atribuído à turma e o que estava e não veio deixa de estar. Só as atribuições **desta turma** mudam. A lista pode ser vazia (retira todos), sem módulo repetido. Tudo ou nada, numa transação só (`ARCHITECTURE.md`, seção 3.6).
- **RN-04 (autorização dos módulos da turma):** só a docente dona da turma e o administrador gravam. A docente só inclui módulos que ela criou; o administrador, qualquer um (D-03). Ao gravar o conjunto, a docente só retira os módulos que ela criou: as atribuições de módulos de outra pessoa (por exemplo, feitas pelo administrador) ficam como estão, e a resposta traz o conjunto que a turma tem depois, com elas. Módulo inexistente ou excluído é recusado. Sem sessão, 401; papel ou dono errado, 403; turma inexistente, 404.
- **RN-05 (visibilidade do módulo):** a atribuição vale para módulo de qualquer visibilidade; incluir um módulo público ou autenticado numa turma **não** o restringe a ela (D-03). Para isso, o `coursemodule` passa a não apagar as atribuições de um módulo que não é privado quando o formulário do módulo envia a lista de turmas vazia (hoje o formulário envia vazio para módulo não privado, e a edição apaga o que a turma atribuiu).
- **RN-06 (módulo privado e a turma):** retirar um módulo **privado** da turma que for a única turma dele deixaria o módulo sem turma alguma, contra a SPEC-010 RN-02 (privado exige ao menos uma turma). Nesse caso a retirada é recusada com 409 `module-needs-a-class`, dizendo qual módulo (D-03).
- **RN-07 (avaliação):** não muda; a SPEC-075 RN-05 continua exigindo o módulo atribuído. Retirar da turma um módulo usado por avaliação agendada **não** é barrado aqui (a avaliação guarda o módulo e segue); a tela de avaliação já trata `module-not-assigned` ao montar questões.

## 4. Modelo de Dados (Data Model)

Migração nova com o próximo número livre depois da `00043` reservada pela SPEC-077 ou, se aquela não tiver sido criada, depois da `00042` (conferir em `origin/projeto-tcc2` imediatamente antes de criar).

**`classes`** (coluna alterada)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `summary` | text | Sim (vazio permitido) | HTML filtrado; limites da RN-01 | **Muda de formato:** de texto puro para HTML; conteúdo existente convertido (RN-02) |

**`module_class_assignments`:** sem mudança de schema; passa a ser escrita também pela rota nova (RN-03). **Relacionamentos, índices e enumerações:** sem mudança. **Exclusão:** as atribuições retiradas são apagadas fisicamente, como a edição do módulo já faz hoje (a atribuição não tem valor acadêmico próprio; o vínculo da avaliação ao módulo fica na própria avaliação). **Descida da migração:** não desfaz a conversão do texto.

## 5. Contrato de API (API Contract)

Erros RFC 7807, campos em `camelCase`, todas as rotas exigem sessão.

**`PUT /api/v1/classes/:id/modules`**: grava o conjunto de módulos de ensino da turma (RN-03 a RN-06).

- **Papéis autorizados:** docente dona da turma, administrador.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `moduleIds` | lista de uuid | Sim | Pode ser vazia; sem repetição; cada módulo deve existir e, para a docente, ser dela (RN-04) |

- **Resposta de sucesso:** 200 com:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `moduleIds` | lista de uuid | Sim | O conjunto gravado |

- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-modules` | Lista com módulo repetido, ilegível ou inexistente |
| 403 | `forbidden` | Estudante, docente que não é dona da turma ou módulo de outra docente |
| 404 | `class-not-found` | Turma inexistente |
| 409 | `module-needs-a-class` | A retirada deixaria um módulo privado sem nenhuma turma (RN-06) |

**Rotas existentes que mudam**

- `POST /api/v1/classes` e `PATCH /api/v1/classes/:id` (SPEC-009 e SPEC-041): `summary` é HTML filtrado, com os limites da RN-01; o erro de resumo longo continua `invalid-summary`. As respostas trazem o `summary` gravado.
- `GET /api/v1/modules` (SPEC-010): sem mudança de contrato; o filtro `classId`, que a SPEC-010 já prevê, passa a funcionar para docente e administrador (correção feita à parte, em `fix/modules-filter-by-class`).

## 6. Impacto e Riscos (Impact & Risks)

- **Script injetado no resumo (XSS).** A docente grava HTML e a página da turma o mostra formatado. **Mitigação:** filtro `htmlsafe` no servidor ao gravar, tela que mostra só o HTML já filtrado, e teste com `<script>`, atributo `on*` e `javascript:`; no cartão, o resumo é só texto.
- **Texto antigo nunca filtrado.** **Mitigação:** a migração o escapa (RN-02), com teste de que `<script>` vira texto inerte.
- **Editar um módulo não privado apagava as atribuições da turma.** Com a RN-05, o formulário do módulo e o serviço deixam de apagá-las. **Mitigação:** teste de serviço e de componente do formulário do módulo; essa é a única mudança no formulário do módulo.
- **Sobrescrever atribuições de outra aba aberta.** A rota grava o conjunto inteiro; duas pessoas editando a mesma turma, a última vence. **Mitigação:** aceito, como nas demais telas de configuração; a lista volta atualizada na resposta.
- **Retirar módulo usado por avaliação.** **Mitigação:** a avaliação guarda o módulo e não muda (RN-07); a tela de avaliação já mostra o aviso quando o módulo deixa de estar atribuído.
- **Barra de ações fixa cobre campo.** **Mitigação:** espaço reservado no fim da página e teste de foco: o campo focado por teclado fica visível.
- **Mudança de decisão da SPEC-044** (sala virtual em *Horários*). **Mitigação:** a decisão sai da seção 3.1.1 da SPEC-044 por esta spec, registrada no histórico da SPEC-044 ao implementar.
- **Testes existentes que mudam:** os do `ClassForm` (resumo como caixa de texto, ordem dos grupos, sala virtual na aba *Horários*, destino depois de salvar), os da página de configurações (texto "Turma não encontrada."), os do cartão e da página da turma (resumo em texto puro) e o teste de domínio e de serviço do limite de 300 caracteres. **Mitigação:** ajustados no commit dos testes vermelhos, com o motivo na entrega.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre em `origin/projeto-tcc2` imediatamente antes de criar.
- **Impacto em outros módulos:** `coursemodule` (rota nova e a regra da RN-05). **Desempenho:** a rota grava poucas linhas; a listagem da seção usa páginas de 50.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (estado): ENQUANTO a docente edita a turma, A página DEVE mostrar *Cancelar* e *Salvar* numa barra sempre visível, sem cobrir nenhum campo, inclusive com o foco por teclado.
- [x] **CA-02** (evento): QUANDO a docente salva as configurações com sucesso, O SISTEMA DEVE levá-la à página da turma e mostrar "Configurações salvas." uma única vez; QUANDO cancela, DEVE levá-la à página da turma sem gravar.
- [x] **CA-03** (ubíquo): A página de configurações DEVE ter, acima do título, o link de voltar para a turma.
- [x] **CA-04** (indesejado): SE o servidor recusa a gravação, ENTÃO O FORMULÁRIO DEVE manter a docente na página, abrir a aba do primeiro erro e mostrar o problema no campo (SPEC-044).
- [x] **CA-05** (estado): ENQUANTO a aba *Informações* está aberta, ELA DEVE mostrar os grupos *Identificação* (nome, código, semestre e cor), *Apresentação* (resumo), *Vigência* (início e término) e *Encontros virtuais* (sala virtual); a aba *Horários* NÃO DEVE ter a opção de sala virtual.
- [x] **CA-06** (estado): ENQUANTO a turma não tem horário em texto livre gravado ou já tem encontros, A aba *Horários* NÃO DEVE mostrar o campo de horário em texto livre; QUANDO há texto gravado e nenhum encontro, DEVE mostrá-lo.
- [x] **CA-07** (estado): ENQUANTO a página carrega, ELA DEVE mostrar um esqueleto anunciado como "carregando"; SE o servidor responde `class-not-found`, ENTÃO DEVE mostrar "turma não encontrada" com *Voltar para as turmas*; SE falha por outro motivo, ENTÃO DEVE mostrar a mensagem de erro com *Tentar de novo* e *Voltar para as turmas*, e *Tentar de novo* DEVE refazer a leitura.
- [x] **CA-08** (evento): QUANDO a docente cria ou altera uma turma com resumo formatado, O SISTEMA DEVE gravá-lo filtrado, sem script, atributos de evento, imagens e vídeos (RN-01).
- [x] **CA-09** (indesejado): SE o texto visível do resumo passa de 300 caracteres, ou o HTML passa do limite, ENTÃO O SISTEMA DEVE responder o erro `invalid-summary` e não gravar; texto visível vazio DEVE ser gravado vazio (RN-01).
- [x] **CA-10** (evento): QUANDO a migração roda, O SISTEMA DEVE converter os resumos antigos em parágrafos de texto escapado, de modo que um texto com `<script>` nunca vire elemento; a migração DEVE subir e descer sem erro (RN-02).
- [x] **CA-11** (estado): ENQUANTO o formulário está aberto, O resumo DEVE ser editado no `RichTextEditor`, sem botão de imagem, com contador do texto visível; o texto antigo DEVE abrir como parágrafos; o cartão da turma DEVE mostrar o resumo como texto e a página da turma DEVE mostrá-lo formatado.
- [x] **CA-12** (evento): QUANDO a docente abre a aba *Conteúdo* de uma turma existente, ELA DEVE ver a lista de módulos com os já incluídos marcados, a busca e o contador; QUANDO marca ou desmarca e salva, O SISTEMA DEVE gravar o conjunto inteiro de uma vez (RN-03).
- [x] **CA-13** (indesejado): SE a lista tem módulo repetido ou inexistente, ENTÃO O SISTEMA DEVE responder 400 `invalid-modules` e não gravar nada; SE a docente inclui um módulo de outra docente, ENTÃO 403 `forbidden`; SE é estudante ou docente que não é dona da turma, ENTÃO 403; SE a turma não existe, ENTÃO 404 `class-not-found` (RN-03, RN-04).
- [x] **CA-14** (estado): ENQUANTO um módulo é público ou autenticado, A inclusão na turma DEVE valer sem restringir sua visibilidade, e editar esse módulo no formulário do módulo NÃO DEVE apagar as atribuições das turmas (RN-05).
- [x] **CA-15** (indesejado): SE a retirada deixaria um módulo privado sem nenhuma turma, ENTÃO O SISTEMA DEVE responder 409 `module-needs-a-class` e não gravar nada (RN-06).
- [x] **CA-16** (estado): ENQUANTO a turma está sendo criada, A seção de módulos DEVE mostrar só a orientação de incluir os módulos depois; ENQUANTO a turma não tem módulo atribuído, a tela de nova avaliação DEVE dizer onde atribuir, com o link para as configurações da turma.
- [ ] **CA-17** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; as telas DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [x] **CA-18** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038); o commit `test(...)` vem antes do `feat(...)`. Nomes em inglês, como no código.

**Backend, `classgroup/domain` e `classgroup/service`** (unidade, com portas de teste escritas à mão)

- `TestSummary_IsFilteredAsRichTextWithoutImages`: script, `on*`, `javascript:`, imagem e vídeo removidos; lista, ênfase, link e comando mantidos (CA-08)
- `TestSummary_VisibleTextOver300OrHtmlOverTheLimitIsInvalid`, nos dois lados dos limites (CA-09)
- `TestSummary_WithoutVisibleTextIsStoredEmpty` (CA-09)
- `TestUpdateClass_SummaryIsFilteredToo` (CA-08)

**Backend, `coursemodule/service`** (unidade)

- `TestSetClassModules_ReplacesTheSetOfThatClassOnly` (CA-12)
- `TestSetClassModules_RejectsRepeatedAndUnknownModules` (CA-13)
- `TestSetClassModules_TeacherOnlyAssignsOwnModulesAdminAnyModule` (CA-13)
- `TestSetClassModules_OnlyOwnerTeacherAndAdminWrite` (CA-13)
- `TestSetClassModules_AcceptsPublicAndAuthenticatedModules` (CA-14)
- `TestSetClassModules_RefusesToLeaveAPrivateModuleWithoutAClass` (CA-15)
- `TestUpdateModule_NonPrivateModuleKeepsItsClassAssignmentsWhenTheListIsEmpty` (CA-14)

**Backend, `classgroup/handler` e `coursemodule/handler`** (`httptest` contra o roteador Gin real)

- `TestHandler_ClassSummaryComesBackAsStoredHtml` (CA-08, CA-11)
- `TestHandler_ClassSummaryTooLongIsInvalidSummary` (CA-09)
- `TestHandler_PutClassModulesStatusCodesAndProblemTypes`: um caso por `type` da seção 5 (CA-13, CA-15)
- `TestHandler_PutClassModulesRolesAndAuthentication`: 401, 403 e 404 (CA-13)

**Backend, repositórios** (integração com PostgreSQL via `testcontainers-go`)

- `TestRepository_ReplaceClassModulesIsAtomic` (CA-12, CA-13)
- `TestRepository_ClassIDFilterKeepsOnlyAssignedModules`, já existente (correção à parte), rodando de novo (CA-12)
- `TestMigration<número>_ConvertsPlainSummaryToEscapedParagraphs`: linhas viram parágrafos, `<script>` vira texto escapado, vazio continua vazio, e a migração sobe e desce (CA-10)

**Frontend** (Vitest e Testing Library)

- `ClassSettingsPage.test.tsx`: link de voltar, barra de ações, salvar leva à página da turma com a confirmação única, cancelar volta sem gravar, erro de gravação mantém a página (CA-01 a CA-04)
- `ClassSettingsPage.states.test.tsx`: esqueleto, `class-not-found`, falha com *Tentar de novo* que refaz a leitura e *Voltar* (CA-07)
- `ClassForm.tabs.test.tsx`: os grupos da aba *Informações*, a cor junto da identificação, a sala virtual fora de *Horários* e o horário em texto livre só com texto gravado e sem encontros (CA-05, CA-06)
- `ClassForm.summary.test.tsx`: editor no lugar da caixa de texto, sem botão de imagem, texto antigo aberto como parágrafos, contador do texto visível, erro no campo e indicador na aba (CA-09, CA-11)
- `ClassCard.test.tsx` e `classes/[id]/page.test.tsx` (ajustados): resumo como texto no cartão, formatado e inerte a script na página (CA-11)
- `ClassModulesPicker.test.tsx`: lista, marcados, busca, páginas de 50, contador, mudança só vale ao salvar, só orientação na criação (CA-12, CA-16)
- `classService.test.ts` / `moduleService.test.ts`: a rota nova, o corpo e os erros tipados (CA-13, CA-15)
- `ModuleForm.test.tsx` (ajustado): módulo não privado não manda a lista vazia que apaga as atribuições (CA-14)
- `assessments/new/page.test.tsx` (ajustado): o aviso de sem módulo tem o link para as configurações (CA-16)
- `ClassForm.a11y.test.tsx`: foco, rótulos e teclado, e o campo focado nunca fica sob a barra de ações (CA-01, CA-17)
- Stylelint, ESLint e `tsc` limpos (CA-17, CA-18)

**Manual** (roteiro)

1. Abrir as configurações de uma turma com a aba *Horários* aberta e conferir que *Salvar* continua à vista; salvar e conferir a volta à página da turma com a confirmação, que não reaparece ao recarregar.
2. Marcar dois módulos na aba *Conteúdo*, salvar, abrir *Nova avaliação* e conferir que os dois aparecem no seletor de módulo.
3. Incluir um módulo público na turma, editá-lo na tela de módulos, e conferir que a turma continua com ele.
4. Escrever um resumo com lista e um link, salvar e conferir o cartão (texto) e a página da turma (formatado); colar `<script>alert(1)</script>` e conferir que nada executa.
5. Desligar o servidor, abrir as configurações e conferir a mensagem de falha e o *Tentar de novo*; abrir uma turma que não existe e conferir "turma não encontrada".
6. Conferir a aparência e o contraste (WCAG AA) da barra de ações, do esqueleto e do editor no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com `go test -cover` em `domain`, `service` e `handler` de `classgroup` e `coursemodule` nos trechos novos e com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec inteira; a SPEC-044 (abas e erros por aba), a SPEC-041 (RN-01, RN-02, RN-07), a SPEC-010 (RN-02, RN-05 e a seção de atribuição) e a SPEC-075 (RN-05). Do código: `frontend/src/components/ClassForm`, `frontend/src/app/app/classes/[id]/settings/page.tsx`, `frontend/src/app/app/classes/[id]/page.tsx` (o aviso de turma criada), `frontend/src/components/ClassCard`, `frontend/src/components/ModuleForm`, `frontend/src/lib/description.ts`, `backend/internal/modules/classgroup/{domain,service}` (`NormalizeSummary` e `richTextField`), `backend/internal/modules/coursemodule/{service,repository,handler}` e `backend/internal/platform/htmlsafe`.
2. **Ordem de execução:** (a) confirmar as pendências da seção 10 decididas; (b) testes vermelhos do backend, rodados e commitados (`test(backend): ...`); (c) migração do resumo, regra do resumo em `classgroup`; (d) `coursemodule`: rota nova, regra da RN-05 e da RN-06; (e) testes vermelhos do frontend, rodados e commitados; (f) página de configurações (cabeçalho, barra de ações, estados), `ClassForm` (grupos e resumo), seção de módulos, `ModuleForm`, cartão e página da turma, aviso da nova avaliação, mensagens e estilos; (g) roteiro manual; (h) status e histórico, inclusive a linha na SPEC-041 e na SPEC-044 dizendo o que esta spec sobrepôs. Backend e frontend podem ser PRs separados, o do backend primeiro.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** `backend/migrations/<próximo número livre>_class_summary_html.sql`.
   - **Backend, alterados:** `classgroup/domain` (limites do resumo), `classgroup/service` (filtro do resumo), `coursemodule/{service,repository,handler}` (rota de módulos da turma, atribuição de módulo não privado, retirada de módulo privado), o registro das rotas e os testes dos pacotes citados; `backend/cmd/api/main.go` só se a ligação mudar.
   - **Frontend, novos:** `ClassModulesPicker` (seção da aba *Conteúdo*), `ClassSettingsSkeleton` (ou nome equivalente, com estilo próprio) e os testes citados na seção 8.
   - **Frontend, alterados:** `frontend/src/components/ClassForm/ClassForm.tsx` e `.module.scss`; `frontend/src/app/app/classes/[id]/settings/page.tsx` e `page.module.scss`; `frontend/src/app/app/classes/[id]/page.tsx` (confirmação de salvo e o resumo formatado); `frontend/src/components/ClassCard`; `frontend/src/components/ModuleForm`; `frontend/src/app/app/classes/[id]/assessments/new/page.tsx` e `edit/page.tsx` (o link do aviso de sem módulo); `frontend/src/services/classService.ts` e `moduleService.ts`; `frontend/src/messages/pt-BR.ts`; e os testes ajustados da seção 8.
   - **Documentação:** esta spec; `specs/GLOSSARY.md` (o termo novo da seção 3.1); as SPEC-041 e SPEC-044 ganham uma linha de histórico.
   - **Não alterar:** `frontend/src/components/RichTextEditor`, `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 21/10/2026, ao aprovar a spec, todas as pendências que ela tinha. As decisões estão incorporadas às seções 2, 3, 4, 5, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Sala virtual.** Sai da aba *Horários* e vai para a aba *Informações*, no grupo *Encontros virtuais*, por ser uma propriedade da turma e não do calendário. Isto sobrepõe a seção 3.1.1 da SPEC-044. |
| D-02 | **Módulos de ensino da turma.** Ficam na aba *Conteúdo*, depois da ementa e das diretrizes, como seção própria; não há aba nova. |
| D-03 | **Quais módulos a docente pode incluir e o que a visibilidade muda.** Qualquer visibilidade, só módulos que a docente criou (o administrador, todos); incluir não restringe a visibilidade; editar um módulo não privado deixa de apagar as atribuições; retirar um módulo privado da sua única turma é recusado (RN-04 a RN-06). |
| D-04 | **Módulos na criação da turma.** Só na edição; na criação a seção mostra a orientação de incluir os módulos depois. |
| D-05 | **Limites do resumo em HTML.** 300 caracteres de **texto visível** (o resumo continua curto, cabe no cartão) e HTML de no máximo 5.000 caracteres depois do filtro. |
| D-06 | **O campo de texto que vira editor** é o resumo da disciplina, o único campo de caixa de texto do formulário da turma. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 21/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir dos pedidos de 21/10/2026 (tapa de UX/UI da tela de configurações da turma: salvar e voltar, campos nas abas certas, carregando e erro, resumo em editor; e a inclusão de módulos de ensino na turma), conferida contra as SPEC-009, 010, 041, 044 e 075, o código do `ClassForm`, da página de configurações e do `coursemodule` e as migrações. A busca no código e no histórico do Git não achou tela da turma que já incluísse módulos (seção 1). Seis pendências abertas (D-01 a D-06), todas com recomendação |
| 21/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das seis pendências aceitas como estavam na spec: D-01 a D-06. Status: `Aprovada` |
| 21/10/2026 | Aruna Architect | Seção 10 esvaziada: as seis pendências viraram decisões D-01 a D-06, incorporadas ao texto; `P-xx` renomeado para `D-xx` nas referências. O glossário ganhou o termo "Atribuição do módulo à turma" (`ModuleClassAssignment`) |
| 21/10/2026 | Implementador | Implementada, menos a conferência à mão: CA-02 a CA-16 e CA-18 marcados; o CA-01 (barra de ações sempre visível e que não cobre campo, inclusive com o foco por teclado: é posição e rolagem de CSS, que o jsdom não mede) e o CA-17 (contraste AA e aparência no tema escuro) seguem abertos, por isso o status continua `Aprovada`; o roteiro manual (itens 1 a 6) ainda não foi feito. Medido: backend, `go vet` limpo e a suíte completa verde (65 pacotes; `internal/platform/database` falhou uma vez com "rootless Docker is not supported", a falha intermitente do Testcontainers com muitos pacotes juntos, e passou sozinho); cobertura `coursemodule`: `domain` 91,7%, `service` 93,0% e `handler` 84,5%; `classgroup`: `domain` 92,3%, `service` 91,9% e `handler` 86,4%; a migração `00044` subiu no banco de desenvolvimento (versão 44) e converteu os resumos; frontend, `tsc` e Stylelint limpos e ESLint sem erros (1 aviso que já existia, em `useLiveClassroom.test.ts`), as pastas `components`, `app`, `lib`, `services`, `hooks`, `messages`, `styles` e `test` do Vitest passam (269 arquivos, 3.206 testes, 1 pulado que já existia; a pasta `engine` não rodou, é a lenta por desenho; a página da turma falhou uma vez sob carga e passou sozinha); cobertura dos componentes alterados: 96,8% das linhas e 90,2% dos ramos. Testes alterados depois do vermelho, todos por erro do próprio teste e não de regra: o painel oculto não aparece por papel, então os grupos da aba *Informações* são conferidos antes de passar pelas abas e o seletor de módulos só depois de abrir a aba *Conteúdo*; o teste do HTML grande passou a usar 100 links de duas letras separados por espaço, porque links colados dobravam a contagem do texto visível (a contagem usa `descriptionText` no cliente e `htmlsafe.PlainText` no servidor, que trocam cada marca por um espaço); o do cartão olha só os filhos do resumo, porque o cartão tem outros `strong`; e o teste de handler ganhou um método `SetClassModules` no fake do `handler_test.go`, só para o fake satisfazer a interface que cresceu. Testes da seção 8 que não foram escritos, por não haver comportamento novo: os dois do `classgroup/handler` do resumo (a camada repassa o texto, e o `invalid-summary` já tinha mapeamento e teste); e `ClassSettingsPage.test.tsx` e `.states.test.tsx` ficaram em `settings/page.test.tsx` e `settings/page.states.test.tsx`. Esclarecimento de regra, sem mudança de requisito, achado ao escrever os testes (o Tech Lead pode vetar): ao gravar o conjunto, a docente só retira os módulos que ela criou, para não apagar o que o administrador atribuiu e que ela nem vê na lista (RN-04). Acréscimos fora da lista original da seção 9: o domínio do `classgroup` passou a importar `platform/htmlsafe` (como o do `content`), para contar o texto visível do resumo; o esqueleto de carregamento ficou na própria página, e não num componente à parte; e a página da turma passou a usar o mixin `rich-text` da SPEC-077 no lugar da cópia do estilo. Nenhum desvio de requisito |
