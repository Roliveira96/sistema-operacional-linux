# SPEC-077: Instruções Gerais da Avaliação em Texto Formatado e Duração Individual na Aba Período

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-077 |
| **Status** | Aprovada |
| **Data de criação** | 21/10/2026 |
| **Última revisão** | 21/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` |
| **Contexto de tela** | `/app/classes/[id]/assessments/new` e `/app/classes/[id]/assessments/[assessmentId]/edit` (formulário), `/app/classes/[id]/assessments/[assessmentId]` (detalhe da docente) e o cartão da avaliação do estudante |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (avaliação, formulário em abas, RN-02 e RN-10), SPEC-076 (modalidade no formulário), SPEC-019 (`RichTextEditor`), SPEC-041 (precedente de HTML filtrado sem imagens: RN-02, D-05 e RN-07), SPEC-044 (padrão de abas) |
| **Substitui** | Nenhuma. Sobrepõe a RN-02 da SPEC-075 (instruções gerais em texto puro) e a organização das abas *Dados* e *Período* do `AssessmentForm`, como a SPEC-075 fez com o rascunho 052 (D-01) |
| **Fontes canônicas** | Pedido do Tech Lead de 21/10/2026 (as instruções gerais devem usar o editor que o sistema já tem; a duração individual pertence ao período); rascunho `052-avaliacao-telemetria-player-sessao.md`, que já descreve as instruções gerais como texto longo formatado |

---

## 1. Contexto e Problema (Context & Problem Statement)

A docente escreve as **instruções gerais** de uma prova ou atividade numa caixa de texto puro de quatro linhas (SPEC-075 RN-02, até 5.000 caracteres, quebras de linha preservadas). É o único texto longo da plataforma que ainda não usa o editor visual: a ementa e as diretrizes da turma (SPEC-041), a descrição dos módulos e o conteúdo da aula já usam o `RichTextEditor`, com lista, título, link e trecho de comando. Numa avaliação de Linux, a docente precisa de listas numeradas ("leia todas as questões antes de começar"), de comandos em destaque ("não use `sudo`") e de ênfase, e hoje não consegue. O estudante, por sua vez, lê as instruções como um bloco corrido de texto.

Na mesma tela, a **duração individual** está na aba *Dados*, ao lado do tipo e da nota máxima, com a frase de ajuda solta numa linha abaixo. Só que a regra dela depende do período: a duração vai de 5 minutos até o tamanho do período, e o período está na aba *Período*. A docente vê o erro "a duração vai de 5 minutos até o tamanho do período (N minutos)" numa aba e precisa trocar de aba para entender e corrigir. A aba *Dados* ainda concentra título, instruções, tipo, nota máxima, duração, modalidade e exigência de habilitação.

Esta spec resolve esses dois pontos. O restante do "ajuste de UX/UI" do formulário pedido pelo Tech Lead depende de decisões dele e está na seção 10.

## 2. Objetivos (Goals)

- A docente edita as **instruções gerais** no `RichTextEditor` (o mesmo da ementa da turma), com lista, título, ênfase, citação, link e trecho de comando, sem imagens.
- O servidor guarda as instruções como **HTML filtrado**, e a docente e o estudante as veem formatadas (detalhe da avaliação da docente e cartão do estudante).
- As instruções já gravadas como texto puro continuam legíveis: a migração as converte em parágrafos de texto escapado.
- A **duração individual** sai da aba *Dados* e passa para a aba *Período*, abaixo do início e do término, com a ajuda e a mensagem de faixa juntas do período de que dependem. As regras da duração não mudam.
- A aba *Dados* fica com título, instruções gerais, tipo, nota máxima, modalidade e exigência de habilitação.
- *Modalidade* e *Exigir habilitação* ficam agrupadas numa seção da aba *Dados*, com uma frase que explica o que a habilitação faz (D-03).
- Cada aba que a docente já visitou e deixou, e que ainda tem algo impedindo de gravar, mostra um indicador; e a lista de bloqueios diz em que aba está cada pendência (D-03).

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Imagens e vídeos** nas instruções (D-01); o editor das instruções não tem o botão de imagem, e nenhuma rota de envio de imagem é criada para avaliação.
- **Observações privadas** formatadas: continuam texto puro (SPEC-075 D-10).
- Mudar qualquer regra da duração individual (inteiro, de 5 minutos até o tamanho do período; congelamento da SPEC-075 RN-10). Muda só o lugar do campo.
- Mudar a composição, o público, a modalidade, a habilitação, o reagendamento ou o cancelamento.
- Barra de ações fixa no rodapé do formulário e botões *Anterior* e *Próxima* entre as abas (D-03).
- Mostrar as instruções no calendário ou na lista da turma, onde hoje não aparecem.
- Leitura em voz alta das instruções.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px (`ARCHITECTURE.md`, seção 4). Nenhuma chamada de rede nova: o formulário continua entregando o valor à página, que chama `services/assessmentService.ts`.

**Formulário da avaliação** (`AssessmentForm`, nas telas de nova e de edição)

- **Aba *Dados*:** título; **instruções gerais no `RichTextEditor`**, com o rótulo "Instruções gerais" e um texto de orientação em `messages/pt-BR.ts`; tipo; nota máxima; modalidade; exigir habilitação. O campo de duração individual **não existe mais** nesta aba.
- **Instruções no editor:** sem o botão de imagem (o editor só mostra esse botão quando recebe a função de envio, e o formulário não a passa). O texto gravado como texto puro abre como um parágrafo por linha (`descriptionHtml`, de `lib/description.ts`). Editor vazio entrega texto vazio. O formulário **trava o gravar** com a razão em texto quando o HTML das instruções passa do limite da RN-01; a mensagem entra na lista de bloqueios que o formulário já mostra.
- **Aba *Período*, na criação:** início e término; **abaixo deles, a duração individual (minutos)**, com a ajuda "Sem duração, o aluno usa o período inteiro." e, quando a duração está fora da faixa, a mensagem de faixa com o tamanho do período, na mesma aba e junto do campo. As validações são as de hoje.
- **Aba *Período*, na edição:** o período como texto, a dica "Para mudar as datas, use Reagendar." e, abaixo, a duração individual editável. Com a avaliação congelada (SPEC-075 RN-10), a duração fica desabilitada, com o aviso que o formulário já usa para o congelamento.
- **Bloqueio por duração:** o gravar continua travado com a razão da duração quando ela é inválida, qualquer que seja a aba aberta.
- **Seção *Aplicação* na aba *Dados*:** *Modalidade* e *Exigir habilitação dos alunos* ficam juntas, sob o título *Aplicação*. A caixa de habilitação ganha uma frase de ajuda que explica que, com a exigência ligada, só entra na prova o aluno que a docente habilitar (SPEC-076). O comportamento da modalidade, da exigência e do congelamento não muda.
- **Indicador por aba e lista de bloqueios (D-03):** a razão que trava o gravar pertence a uma aba (*Dados*: título, instruções acima do limite, nota máxima; *Período*: datas e duração; *Questões*: módulo, questões, pesos, sorteio e estoque; *Participantes*: alunos escolhidos). Uma aba que a docente já abriu e deixou, e que tem pelo menos uma razão ativa, mostra um indicador ("!", com o texto "Esta aba tem algo a corrigir" para leitor de tela), e some quando a razão some. A lista de razões que o formulário já mostra abaixo das abas passa a dizer a aba de cada uma ("Título (aba Dados)") e cada item abre a aba correspondente. A aba em que a docente está não mostra o indicador.

**Detalhe da avaliação da docente** (`/app/classes/[id]/assessments/[assessmentId]`)

- A seção "Instruções gerais" mostra o HTML formatado (lista, título, comando, link e citação). Sem instruções, mostra o traço que mostra hoje.

**Cartão da avaliação do estudante** (`AssessmentCard`)

- As instruções aparecem formatadas, no lugar do parágrafo de texto puro. Sem instruções, o bloco não aparece, como hoje.

**Regras de exibição do HTML:** só o HTML que o servidor já filtrou ao gravar é mostrado, como na ementa da turma (SPEC-041). O estilo do texto formatado usa só tokens, no mesmo padrão visual da ementa.

### 3.2. Backend (Go: módulo `assessment`)

As regras entram no módulo `assessment`, ajustando a RN-02 da SPEC-075. Nenhuma rota nova.

- **RN-01 (instruções em HTML filtrado):** na criação e na alteração, o servidor passa `description` pelo mesmo filtro da ementa da turma (`htmlsafe.NewRichText`, sem imagens e sem vídeos) antes de gravar. O resultado, depois do filtro e sem espaços nas pontas, tem no máximo **20.000 caracteres** (contados em runas, D-02); acima disso, 400 `invalid-assessment`. Se o texto visível ficar vazio (por exemplo, só um parágrafo vazio), grava-se texto vazio. Isto substitui "texto puro de até 5.000 caracteres" da SPEC-075 RN-02.
- **RN-02 (leitura):** `description` volta nas respostas como o HTML gravado, no `AssessmentPublic`, no `AssessmentSummary` e no `AssessmentDetail`. O sigilo da SPEC-075 RN-09 não muda: o estudante continua sem questão, gabarito, peso, regra de sorteio, quantidade de questões, módulo, composição, público e observação privada.
- **RN-03 (texto antigo):** a migração converte as instruções já gravadas, que são texto puro e nunca foram filtradas: escapa `&`, `<` e `>`, faz de cada linha não vazia um parágrafo e descarta as linhas em branco. Texto vazio continua vazio. O texto escapado é inofensivo ao ser mostrado como HTML (D-04).
- **RN-04 (duração):** as regras da SPEC-075 RN-02 e RN-10 não mudam; o contrato da API também não.
- **RN-05 (auditoria):** o nome de campo `description` em `changed_fields` do evento `UPDATED` continua o mesmo (SPEC-075 RN-15).
- **RN-06 (congelamento):** as instruções continuam editáveis com a avaliação congelada (SPEC-075 RN-10), agora com a RN-01.

## 4. Modelo de Dados (Data Model)

Migração nova com o próximo número livre depois da `00042` (conferir em `origin/projeto-tcc2` antes de criar; hoje seria `00043_assessment_description_html.sql`). Nenhuma tabela e nenhuma coluna novas.

**`assessments`** (coluna alterada)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `description` | text | Não | HTML filtrado, até 20.000 caracteres (RN-01) | **Muda de formato:** de texto puro para HTML; o limite da restrição de tamanho sobe de 5.000 para 20.000; conteúdo existente convertido (RN-03) |

**Relacionamentos, índices e enumerações:** sem mudança. **Exclusão:** sem mudança. **Descida da migração:** devolve o limite de tamanho a 5.000 só se nenhuma linha o ultrapassar; a conversão do texto não é desfeita (o texto escapado continua legível).

## 5. Contrato de API (API Contract)

Nenhuma rota nova. Mudam as regras do campo `description` em duas rotas da SPEC-075:

**`POST /api/v1/classes/:id/assessments`** e **`PATCH /api/v1/classes/:id/assessments/:assessmentId`**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `description` | texto | Não | HTML; filtrado pelo servidor (sem script, atributos de evento, imagens e vídeos); até 20.000 caracteres depois do filtro (RN-01) |

- **Resposta de sucesso:** a mesma da SPEC-075, com `description` trazendo o HTML gravado.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-assessment` | Instruções com mais de 20.000 caracteres depois do filtro (RN-01); os demais casos da SPEC-075 não mudam |

**Rotas de leitura** (lista, detalhe, calendário): o formato não muda; `description` passa a ser HTML.

## 6. Impacto e Riscos (Impact & Risks)

- **Script injetado nas instruções (XSS).** A docente grava HTML e a tela o mostra com `dangerouslySetInnerHTML`, inclusive ao estudante. **Mitigação:** filtro `htmlsafe` no servidor ao gravar, tela que mostra só o HTML já filtrado, e teste com `<script>`, atributo `on*` e `javascript:` na criação e na alteração (RN-01).
- **Texto antigo nunca filtrado.** As instruções gravadas pela SPEC-075 são texto puro sem filtro; mostrá-las como HTML sem tratamento reabriria o risco anterior. **Mitigação:** a migração as escapa (RN-03) e um teste confere que um texto com `<script>` vira texto inerte.
- **Restrição de 5.000 caracteres no banco.** A migração `00041` limita `description`. **Mitigação:** a migração nova sobe o limite para 20.000 e o teste do repositório confere os dois lados do limite.
- **Calendário traz `description` inteiro.** Cada item do calendário carrega o campo (SPEC-075 RN-17) e agora ele pode ter até 20.000 caracteres. **Mitigação:** o limite da RN-01 já o delimita, e a janela de 62 dias da SPEC-042 limita os itens; a tela do calendário não usa o campo.
- **Testes da SPEC-075 e da SPEC-076 que mudam:** o do formulário que digita as instruções num campo de texto, o do limite de 5.000 caracteres (domínio e repositório), o do cartão do estudante e o do detalhe da docente, que esperam texto puro, e o do formulário que procura a duração na aba *Dados*. **Mitigação:** todos ajustados no commit dos testes vermelhos, com o motivo registrado na entrega.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre em `origin/projeto-tcc2` imediatamente antes de criar.
- **CA-29 da SPEC-075 e CA-19 da SPEC-076 seguem abertos** (contraste e tema escuro, à mão). **Mitigação:** o roteiro manual desta spec cobre o editor e as seções novas.
- **Impacto em outros módulos:** nenhum além do `assessment` e do `frontend`; o `RichTextEditor` não muda. **Desempenho:** sem consulta nova. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente cria ou altera uma avaliação com instruções formatadas, O SISTEMA DEVE gravá-las filtradas, sem script, atributos de evento, imagens e vídeos, mantendo lista, título, ênfase, citação, link e trecho de comando (RN-01).
- [x] **CA-02** (indesejado): SE as instruções passam de 20.000 caracteres depois do filtro, ENTÃO O SISTEMA DEVE responder 400 `invalid-assessment` e não gravar nada (RN-01).
- [x] **CA-03** (estado): ENQUANTO as instruções não têm texto visível (por exemplo, só um parágrafo vazio), O SISTEMA DEVE gravá-las vazias (RN-01).
- [x] **CA-04** (ubíquo): As respostas à docente e ao estudante DEVEM trazer `description` com o HTML gravado, e a resposta do estudante NÃO DEVE ganhar nenhum campo além dos do `AssessmentPublic` (RN-02).
- [x] **CA-05** (evento): QUANDO a migração roda, O SISTEMA DEVE converter as instruções antigas em parágrafos de texto escapado, de modo que um texto com `<script>` nunca vire elemento; e a migração DEVE subir e descer sem erro, com o limite de tamanho nos 20.000 (RN-03, seção 4).
- [x] **CA-06** (evento): QUANDO a docente abre o formulário, A aba *Dados* DEVE mostrar as instruções gerais no `RichTextEditor`, sem botão de imagem e com a barra de ferramentas operável por teclado; o texto antigo DEVE abrir como parágrafos; o editor vazio DEVE entregar texto vazio.
- [x] **CA-07** (estado): ENQUANTO o HTML das instruções passa do limite, O FORMULÁRIO DEVE travar o gravar e dizer a razão na lista de bloqueios (RN-01).
- [x] **CA-08** (evento): QUANDO a docente abre a aba *Período* para criar uma avaliação, ELA DEVE ver início, término e, abaixo, a duração individual com a ajuda e a mensagem de faixa; a aba *Dados* NÃO DEVE ter o campo de duração.
- [x] **CA-09** (estado): ENQUANTO a docente edita uma avaliação, a aba *Período* DEVE mostrar o período como texto, a dica de Reagendar e a duração editável; ENQUANTO a avaliação está congelada, a duração DEVE estar desabilitada com o aviso do congelamento (SPEC-075 RN-10).
- [x] **CA-10** (indesejado): SE a duração não é inteira, é menor que 5 ou passa do tamanho do período, ENTÃO O FORMULÁRIO DEVE travar o gravar e dizer a razão da duração, estando aberta qualquer aba (SPEC-075 RN-02).
- [x] **CA-11** (estado): ENQUANTO a docente vê o detalhe da avaliação e o estudante vê o cartão, AS INSTRUÇÕES DEVEM aparecer formatadas e sem executar script; sem instruções, o detalhe DEVE mostrar o traço e o cartão NÃO DEVE mostrar o bloco.
- [x] **CA-12** (estado): ENQUANTO a aba *Dados* está aberta, *Modalidade* e *Exigir habilitação dos alunos* DEVEM aparecer juntas na seção *Aplicação*, com a frase que explica a habilitação ligada à caixa; a modalidade, a exigência e o congelamento DEVEM se comportar como na SPEC-076.
- [x] **CA-13** (estado): ENQUANTO uma aba que a docente já abriu e deixou tem alguma razão que trava o gravar, ELA DEVE mostrar o indicador, que some quando a razão some; a aba aberta NÃO DEVE mostrar o indicador; a lista de razões DEVE dizer a aba de cada uma, e cada item DEVE abrir a aba correspondente.
- [ ] **CA-14** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; as telas DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [x] **CA-15** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038); o commit `test(...)` vem antes do `feat(...)`. Nomes em inglês, como no código.

**Backend, `assessment/domain` e `assessment/service`** (unidade, com repositórios e portas de teste escritos à mão)

- `TestDescription_IsFilteredAsRichTextWithoutImages`: script, `on*`, `javascript:`, imagem e vídeo removidos; lista, título, citação, link e comando mantidos (CA-01)
- `TestDescription_TooLongAfterTheFilterIsInvalid`, nos dois lados dos 20.000 (CA-02)
- `TestDescription_WithoutVisibleTextIsStoredEmpty` (CA-03)
- `TestUpdate_DescriptionIsFilteredAlsoWhenFrozen` (CA-01)

**Backend, `assessment/handler`** (`httptest` contra o roteador Gin real)

- `TestHandler_DescriptionComesBackAsStoredHtmlToTeacherAndStudent` (CA-04)
- `TestHandler_CreateRefusesDescriptionOverTheLimit`: 400 `invalid-assessment` (CA-02)
- `TestHandler_StudentResponseHasExactlyThePublicKeys`, já existente na SPEC-075, rodando de novo (CA-04)

**Backend, `assessment/repository`** (integração com PostgreSQL via `testcontainers-go`)

- `TestRepository_DescriptionAcceptsUpTo20000AndRefusesMore` (CA-02, CA-05)
- `TestMigration00043_ConvertsPlainDescriptionToEscapedParagraphs`: linhas viram parágrafos, `<script>` vira texto escapado, vazio continua vazio (o número real conferido na hora) (CA-05)
- `TestMigration00043_UpAndDown` (CA-05)

**Frontend** (Vitest e Testing Library)

- `AssessmentForm.description.test.tsx`: o editor visual no lugar da caixa de texto, sem botão de imagem, texto antigo aberto como parágrafos, HTML enviado ao gravar, editor vazio entrega texto vazio, gravar travado acima do limite (CA-06, CA-07)
- `AssessmentForm.period.test.tsx`: duração só na aba *Período* (criação e edição), ajuda e faixa junto do campo, desabilitada no congelamento, gravar travado com a razão da duração em qualquer aba (CA-08, CA-09, CA-10)
- `AssessmentCard.test.tsx` e `assessments/[assessmentId]/page.test.tsx` (ajustados): instruções formatadas, script inerte, traço e ausência do bloco quando vazias (CA-11)
- `AssessmentForm.sections.test.tsx`: a seção *Aplicação* com a frase da habilitação, o indicador nas abas visitadas e deixadas, a aba aberta sem indicador, o indicador que some com a razão, e a lista de razões com a aba de cada uma, que abre a aba ao ser acionada (CA-12, CA-13)
- `AssessmentForm.a11y.test.tsx` (ajustado): foco, rótulos e teclado no editor, na aba *Período* e no indicador de aba (CA-14)
- Stylelint, ESLint e `tsc` limpos (CA-14, CA-15)

**Testes da SPEC-075 e da SPEC-076 que mudam** (ajustados no commit vermelho, com o motivo na entrega): `AssessmentForm.test.tsx` (a duração e as instruções mudam de lugar e de campo), `AssessmentForm.modality.test.tsx` (se procurar a duração em *Dados*), os testes de domínio e de repositório do limite de 5.000 caracteres, e o teste de migração `00041`/`00042`, que desce a `00043` antes e a sobe depois.

**Manual** (roteiro)

1. Criar uma avaliação com instruções em lista numerada, um trecho de comando e um link; abrir o detalhe da docente e o cartão do estudante e conferir a formatação.
2. Colar no editor um texto com `<script>alert(1)</script>` e conferir que nada executa, nem no detalhe nem no cartão do estudante.
3. Abrir uma avaliação criada antes desta spec e conferir que as instruções aparecem como parágrafos e que a edição as abre no editor.
4. Na aba *Período*, digitar uma duração maior que o período e conferir a mensagem de faixa junto do campo; trocar para a aba *Dados* e conferir a razão no aviso de bloqueio.
5. Deixar o título em branco, abrir outra aba e conferir o indicador na aba *Dados* e, na lista de razões, o item "Título (aba Dados)" que abre a aba ao ser acionado; preencher o título e conferir que o indicador some.
6. Conferir a aparência e o contraste (WCAG AA) do editor, da seção *Aplicação*, do indicador de aba, da aba *Período* e do texto formatado no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com `go test -cover` em `domain`, `service` e `handler` do `assessment` e com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec inteira; a SPEC-075 (RN-02, RN-09, RN-10 e RN-17), a SPEC-076 (modalidade no formulário) e a SPEC-041 (RN-02 e RN-07, que são o precedente). Do código: `backend/internal/platform/htmlsafe/htmlsafe.go`, o módulo `backend/internal/modules/assessment`, `backend/internal/modules/classgroup/service/service.go` (o campo de texto formatado `richTextField`), `backend/migrations/00041_assessments.sql`, `frontend/src/components/AssessmentForm`, `frontend/src/components/RichTextEditor`, `frontend/src/lib/description.ts`, `frontend/src/components/AssessmentCard` e a página de detalhe da avaliação.
2. **Ordem de execução:** (a) confirmar as pendências da seção 10 decididas; (b) testes vermelhos do backend, rodados e commitados (`test(backend): ...`); (c) migração e limite no `domain`; (d) filtro no `service` (criação e alteração); (e) testes vermelhos do frontend, rodados e commitados; (f) formulário (editor e aba *Período*), detalhe da docente, cartão do estudante, mensagens e estilos; (g) roteiro manual; (h) status e histórico da spec. Backend e frontend podem ser PRs separados, o do backend primeiro.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** `backend/migrations/<próximo número livre>_assessment_description_html.sql`.
   - **Backend, alterados:** `assessment/domain` (limite de tamanho das instruções), `assessment/service` (`create.go`, `change.go` e a construção do service, para o filtro), `assessment/handler` só se o mapeamento de erro pedir, os testes dos três pacotes e o do repositório; `backend/cmd/api/main.go` só se a construção do service mudar de assinatura.
   - **Frontend, alterados:** `frontend/src/components/AssessmentForm/AssessmentForm.tsx` e `.module.scss`; `frontend/src/components/AssessmentCard/AssessmentCard.tsx` e `.module.scss`; `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e `page.module.scss`; `frontend/src/messages/pt-BR.ts`; e os testes citados na seção 8.
   - **Frontend, novos:** os testes `AssessmentForm.description.test.tsx`, `AssessmentForm.period.test.tsx` e `AssessmentForm.sections.test.tsx`.
   - **Documentação:** esta spec; a SPEC-075 ganha uma linha no histórico dizendo que a RN-02 foi sobreposta por esta spec.
   - **Não alterar:** `frontend/src/components/RichTextEditor`, `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 21/10/2026, ao aprovar a spec, todas as pendências que ela tinha. As decisões estão incorporadas às seções 2, 3, 4, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Imagens nas instruções.** Sem imagens, como a ementa da turma (SPEC-041 D-05): o editor das instruções não tem o botão de imagem e nenhuma rota de envio de imagem é criada para avaliação. |
| D-02 | **Limite das instruções.** 20.000 caracteres de HTML depois do filtro, o mesmo limite da ementa (SPEC-041 RN-02). |
| D-03 | **O que mais entra no ajuste de UX/UI do formulário.** Entram: (a) *Modalidade* e *Exigir habilitação* agrupadas na seção *Aplicação*, com a frase que explica a habilitação; (b) o indicador por aba e a lista de razões que diz a aba de cada uma. Ficam de fora: a barra de ações fixa e os botões *Anterior* e *Próxima* entre as abas. |
| D-04 | **Texto antigo.** Convertido na migração (RN-03), como a SPEC-041 fez com a ementa; o texto antigo nunca foi filtrado e a tela o mostra como HTML. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 21/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir de dois pedidos dele em 21/10/2026: as instruções gerais da avaliação devem usar o editor que o sistema já tem, e a duração individual deve ficar na aba *Período*. Conferida contra a SPEC-075 (RN-02), a SPEC-076, o precedente da SPEC-041, o filtro `htmlsafe` e a restrição de 5.000 caracteres da migração `00041`. Quatro pendências abertas (D-01 a D-04), todas com recomendação |
| 21/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das quatro pendências aceitas como estavam na spec: D-01 a D-04. Na D-03, o Tech Lead aceitou incluir os itens (a) e (b) e deixar de fora a barra de ações fixa e os botões *Anterior* e *Próxima*. Status: `Aprovada` |
| 21/10/2026 | Aruna Architect | Seção 10 esvaziada: as quatro pendências viraram decisões D-01 a D-04, incorporadas ao texto (a D-03 trouxe a seção *Aplicação* e o indicador por aba, com os critérios CA-12 e CA-13 e o teste `AssessmentForm.sections.test.tsx`; os antigos CA-12 e CA-13 passaram a CA-14 e CA-15); `P-xx` renomeado para `D-xx` nas referências |
| 21/10/2026 | Implementador | Implementada, menos a conferência à mão: CA-01 a CA-13 e CA-15 marcados; o CA-14 segue aberto porque o contraste AA e a aparência do editor, da seção *Aplicação*, do indicador de aba e do texto formatado no tema escuro só se conferem à mão (roteiro manual, itens 1 a 6, ainda não feito), por isso o status continua `Aprovada`. Medido: backend, `go vet` limpo e a suíte completa verde (66 pacotes); cobertura `assessment/domain` 97,1%, `service` 83,9% e `handler` 84,3%; a migração `00043` subiu no banco de desenvolvimento (versão 43, limite de 20.000) e o teste dela cobre subida, descida e conversão; frontend, `tsc`, ESLint e Stylelint limpos, as pastas `components`, `app`, `lib`, `services`, `hooks`, `messages`, `styles` e `test` do Vitest passam (263 arquivos, 3.166 testes, 1 pulado que já existia; a pasta `engine` não rodou, é a lenta por desenho); cobertura dos componentes alterados: 98,8% das linhas e 93,5% dos ramos. Testes alterados depois do vermelho, todos por erro de consulta e não de regra: `getByLabelText(/^Título/)` passou a pedir `input` (a barra do editor tem um botão "Título", que tornava a consulta ambígua) nos testes do formulário e na acessibilidade; e o aviso de congelamento da aba *Questões* é buscado dentro do painel aberto, porque agora também aparece na aba *Período* (reaproveitando o aviso que o formulário já usa, como o CA-09 manda). Testes da seção 8 que não foram escritos, por não haver comportamento novo: os dois do `handler` (a camada repassa o texto sem mexer; o filtro, o limite e o texto vazio são do `service`, e o `TestHandler_StudentResponseHasExactlyThePublicKeys` da SPEC-075 rodou de novo e passou) e o "script inerte" do cartão e do detalhe (o navegador não executa script de `innerHTML`; a defesa é o filtro do servidor, que tem teste, e o roteiro manual, item 2). O teste de migração `00041`/`00042` não precisou mudar. Acréscimo fora da lista original da seção 9: o mixin `rich-text` em `frontend/src/styles/_mixins.scss`, para o cartão e o detalhe não copiarem o estilo do texto formatado (que hoje também existe, copiado, na página da turma; a SPEC-078 passa essa página a usá-lo). Nenhum desvio de requisito |
