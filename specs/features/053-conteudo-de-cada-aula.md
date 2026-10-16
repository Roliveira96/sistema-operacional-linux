# SPEC-053: Conteúdo de Cada Aula (tema, descrição, links, módulo e apresentação)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-053 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (implementada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `schedule` (aula da agenda), com ligação a `classroom` (apresentações e sala ao vivo) e `coursemodule` (módulos) |
| **Contexto de tela** | Configuração da turma, aba Horários (`/app/classes/:id/settings`); agenda da turma (`/app/classes/:id?tab=schedule`); visão geral da turma |
| **Prioridade** | Alta |
| **Depende de** | SPEC-042 (agenda), SPEC-044 (aba Horários), SPEC-048 (links da turma), SPEC-051 (sala ao vivo e apresentações), SPEC-010 (módulos de ensino) |
| **Substitui** | Nenhuma (altera o limite de apresentações por turma da SPEC-051) |
| **Fontes canônicas** | Relato do Tech Lead em 14/10/2026: "cliquei em uma aula e não consigo editar, incluir as coisas que mostra na aula; as aulas podem ser diferentes uma da outra: a de segunda é uma coisa, a de terça outra". Escolhas do Tech Lead no mesmo dia: tema, descrição do conteúdo, links, módulo de ensino e upload do PDF da apresentação em cada aula; iniciar a aula ao vivo a partir da aula do dia |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na aba Horários, ao clicar numa aula (um dia do calendário), o professor só pode alterar a situação, o horário, a quantidade de aulas e a sala ou o link. Não existe lugar para dizer **o que aquela aula trata**. A turma só tem uma ementa geral, e cada aula é igual à outra no sistema, quando na prática a de segunda trata de um assunto, a de terça de outro e a de quarta de outro, cada uma com seu material.

A aula ao vivo (SPEC-051) é iniciada só pela visão geral, sem ligação com a aula do dia, e não aproveita o que o professor preparou para aquela data.

## 2. Objetivos (Goals)

- Cada aula (cada data do calendário) tem o **seu conteúdo**, editável pelo professor: tema, descrição, links, módulo de ensino e apresentação em PDF.
- O estudante matriculado vê o conteúdo de cada aula na agenda.
- A aula ao vivo pode ser iniciada **a partir da aula do dia**, usando o tema, o módulo e a apresentação dela.
- Mudar o conteúdo de uma aula não é "alterar a aula": não manda e-mail, não marca a aula como alterada e não pede motivo.

### 2.1. Fora de escopo (Non-Goals)

- Conteúdo padrão repetido para todas as aulas de um encontro semanal (cada data tem o seu).
- Copiar o conteúdo de uma aula para outra.
- Notificar o estudante quando o conteúdo muda.
- Mostrar o conteúdo na barra de aulas do calendário geral (`/app/calendar`).
- Frequência da aula.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Editar o conteúdo (professor e administrador).** No painel de uma aula (clicando no dia, na aba Horários da configuração e na agenda), ao lado de "Alterar esta aula" entra o botão **Conteúdo da aula**, que abre o diálogo com:

- **Tema:** uma linha, até 120 caracteres.
- **Descrição do conteúdo:** texto formatado (o mesmo editor da ementa), até o limite da ementa.
- **Links da aula:** lista de nome e endereço https, até 10 (mesmo editor e regras dos links da turma, SPEC-048).
- **Módulo de ensino:** lista dos módulos que o professor pode usar, com a opção "Nenhum".
- **Apresentação (PDF):** lista das apresentações da turma, com "Nenhuma", e o botão **Enviar PDF**, que lê o arquivo no navegador, valida (PDF, até 25 MB, até 100 páginas, sem senha), envia e já seleciona a nova apresentação. Reaproveita o envio da SPEC-051.
- O botão **Salvar** grava tudo de uma vez; erros de campo aparecem junto do campo.

**Ver o conteúdo (todos).** O painel da aula mostra, quando houver: o tema (também no marcador do dia, no lugar do código da disciplina), a descrição, os links como ligações que abrem em outra aba (`rel="noopener noreferrer"`), o módulo (para o estudante, uma ligação para o módulo) e a apresentação (**Ver apresentação**, que abre o PDF por endereço assinado). Aula sem conteúdo continua como hoje.

**Aula ao vivo a partir da aula (professor e administrador).** O painel da aula ganha **Iniciar aula ao vivo**: inicia a sala com o tema como título (ou o nome da disciplina se não houver tema), o módulo e a apresentação da aula, ligada a ela (`classSessionId`); se já existe aula ativa na turma, leva a ela. O botão "Iniciar aula" da visão geral continua para a aula avulsa.

**Entrar na aula ao vivo pela agenda (todos).** Quando a turma tem aula ao vivo ativa, a aba Agenda mostra, acima do calendário, o aviso **Aula ao vivo em andamento: *título*** com o botão **Entrar na aula**, para o estudante e para o professor. Se a aula ao vivo está ligada a uma aula do calendário, o painel dessa aula mostra a marca **Ao vivo agora** e o botão **Entrar na aula ao vivo** (para o professor, **Voltar para a aula ao vivo**, no lugar de "Iniciar aula ao vivo"). Os botões levam à sala (`/app/classes/:id/live`).

Botões do padrão `Button`, tema único escuro, só tokens, alvos de 44 px, textos no arquivo de mensagens.

**Aparência do diálogo.** Cabeçalho fixo (título e uma linha de apoio), corpo com rolagem e rodapé fixo com Cancelar e Salvar, para salvar sem rolar até o fim. O corpo tem três seções com rótulo discreto e linha: **Planejamento** (tema e descrição), **Diário da aula** (as anotações da SPEC-073, as privadas num bloco destacado) e **Materiais** (links, módulo e apresentação lado a lado numa tela larga, e o envio do PDF). O rótulo visível e a linha de ajuda dos editores são os da SPEC-073 (CA-10).

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (conteúdo da aula):** cada aula tem tema (opcional, 1 a 120 caracteres), descrição (opcional, HTML filtrado pelo mesmo filtro da ementa), módulo de ensino (opcional), apresentação (opcional) e até 10 links (nome de 1 a 80 caracteres e endereço https de até 2.000, como na SPEC-048).
- **RN-02 (gravação):** o conteúdo é gravado de uma vez (substitui o anterior). Só a docente dona da turma e o administrador gravam (como a SPEC-042 RN-08). Pode-se gravar o conteúdo de aula futura, de hoje e de aula passada, e de aula cancelada.
- **RN-03 (não é alteração):** gravar o conteúdo **não** marca a aula como alterada (`overridden`), **não** exige motivo e **não** envia e-mail.
- **RN-04 (vínculos):** a apresentação precisa ser da mesma turma e o módulo precisa existir e estar disponível ao docente; senão, 404. Os dois são checados pelos serviços dos módulos de origem, nunca pelo repositório deles.
- **RN-05 (a aula com conteúdo não some):** a regeneração das aulas semanais (SPEC-042 RN-02) mantém toda aula que tem conteúdo, como já mantém as alteradas à mão. Se o encontro semanal for removido, as aulas com conteúdo continuam no calendário.
- **RN-06 (leitura):** o estudante com matrícula ativa, o docente dono e o administrador leem o conteúdo (SPEC-042 RN-08). O calendário traz o tema e se há conteúdo; o conteúdo completo vem por leitura própria.
- **RN-07 (apresentações por turma):** o limite de apresentações por turma da SPEC-051 sobe de 20 para **100**, porque cada aula pode ter a sua (um semestre tem mais de 30 aulas).
- **RN-08 (iniciar a partir da aula):** é só o início da sala já previsto na SPEC-051 (`classSessionId`, `deckId` e `initialModuleId`); nenhuma regra nova no servidor.

## 4. Modelo de Dados (Data Model)

Colunas novas em `class_sessions` (migração 00031):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `topic` | text | Não | de 1 a 120 caracteres | Tema da aula |
| `description` | text | Não | HTML filtrado | Descrição do conteúdo |
| `module_id` | uuid | Não | FK `course_modules` | Módulo de ensino da aula |
| `deck_id` | uuid | Não | FK `slide_decks` | Apresentação da aula |

Tabela nova `class_session_links`:

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | Identificador |
| `session_id` | uuid | Sim | FK `class_sessions` | Aula dona |
| `position` | smallint | Sim | de 0 a 9 | Ordem de exibição |
| `name` | text | Sim | de 1 a 80 caracteres | Nome do link |
| `url` | text | Sim | até 2.000 caracteres | Endereço https |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | Sim, Sim, Não | | Auditoria e exclusão lógica (a lista substituída fica no histórico) |

Índice em `session_id` e `position` entre os não excluídos.

## 5. Contrato de API (API Contract)

**`PUT /api/v1/classes/{id}/sessions/{sessionId}/content`**: grava o conteúdo da aula (RN-02).

- **Papéis autorizados:** docente dona e administrador.
- **Corpo:** `topic` (texto, opcional), `description` (HTML, opcional), `moduleId` (opcional), `deckId` (opcional), `links` (lista de `name` e `url`, de 0 a 10). Campo ausente ou vazio limpa o valor.
- **Resposta (200):** o conteúdo gravado, no formato da leitura.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-session-content` | tema, nome ou endereço inválidos (extensão `field`, por exemplo `links[2].url`), ou mais de 10 links |
| 400 | `content-too-long` | descrição acima do limite |
| 403 | `forbidden` | quem não é a docente dona nem administrador |
| 404 | `session-not-found` | aula inexistente ou de outra turma |
| 404 | `deck-not-found` / `module-not-found` | apresentação de outra turma ou módulo inexistente (RN-04) |

**`GET /api/v1/classes/{id}/sessions/{sessionId}/content`**: lê o conteúdo.

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa.
- **Resposta (200):** `topic`, `description`, `module` (identificador e título), `deck` (identificador, título, número de lâminas e `downloadUrl` assinada de 15 minutos) e `links` (nome, endereço e posição); vazio se a aula não tem conteúdo.
- **Erros:** 403 `forbidden`; 404 `session-not-found`.

**`GET /api/v1/classes/{id}/live/decks`**: lista as apresentações da turma, para o professor escolher uma já enviada (módulo `classroom`).

- **Papéis autorizados:** docente dona e administrador.
- **Resposta (200):** `decks`: lista, da mais recente para a mais antiga, com `id`, `title`, `pageCount` e `createdAt` (sem endereço de download).
- **Erros:** 403 `forbidden`; 404 `class-not-found`.

**Aula no calendário:** o objeto da aula nas respostas do calendário ganha `topic` (texto, ausente se vazio) e `hasContent` (verdadeiro se há qualquer conteúdo).

## 6. Impacto e Riscos (Impact & Risks)

- **Regeneração apagar conteúdo.** Mitigação: a aula com conteúdo é mantida (RN-05), com teste.
- **Endereços maliciosos e HTML.** Mitigação: só https, descrição pelo filtro da ementa e links abertos com `rel="noopener noreferrer"`.
- **Acoplamento entre módulos.** Mitigação: `schedule` usa portas (interfaces) implementadas pelos serviços de `classroom` e `coursemodule`.
- **Mais apresentações no MinIO.** Mitigação: limite de 100 por turma e de 25 MB por arquivo.
- **Resposta do calendário pesada.** Mitigação: só `topic` e `hasContent` vão no calendário; o conteúdo completo, por leitura própria.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o professor dono da turma grava o conteúdo de uma aula, O SISTEMA DEVE guardar tema, descrição, módulo, apresentação e links só nessa aula, sem alterar as outras.
- [ ] **CA-02** (evento): QUANDO o conteúdo é gravado, O SISTEMA NÃO DEVE marcar a aula como alterada, pedir motivo nem enviar e-mail.
- [ ] **CA-03** (indesejado): SE o tema, um nome ou um endereço é inválido, ou há mais de 10 links, ou a descrição passa do limite, ENTÃO O SISTEMA DEVE recusar com 400 apontando o campo, sem gravar nada.
- [ ] **CA-04** (indesejado): SE a apresentação é de outra turma ou o módulo não existe, ENTÃO O SISTEMA DEVE recusar com 404 (`deck-not-found` ou `module-not-found`).
- [ ] **CA-05** (indesejado): SE quem grava não é a docente dona nem o administrador, ENTÃO O SISTEMA DEVE responder 403; o estudante só lê, e só se tem matrícula ativa.
- [ ] **CA-06** (evento): QUANDO as aulas semanais são regeneradas, O SISTEMA DEVE manter as aulas que têm conteúdo, inclusive se o encontro semanal foi removido.
- [ ] **CA-07** (ubíquo): O calendário DEVE trazer `topic` e `hasContent` de cada aula, e a leitura própria DEVE trazer o conteúdo completo com a apresentação por endereço assinado de 15 minutos.
- [ ] **CA-08** (ubíquo): O limite de apresentações por turma DEVE ser de 100.
- [ ] **CA-09** (ubíquo): No painel de uma aula, o professor DEVE ter o botão "Conteúdo da aula" com os campos tema, descrição, links, módulo e apresentação (com envio de PDF), e DEVE conseguir salvar; erros de campo DEVEM aparecer junto do campo.
- [ ] **CA-10** (ubíquo): O painel da aula DEVE mostrar o conteúdo a quem lê (tema, descrição, links que abrem em outra aba com `rel="noopener noreferrer"`, módulo e apresentação), e o tema DEVE aparecer no marcador do dia.
- [ ] **CA-11** (evento): QUANDO o professor aciona "Iniciar aula ao vivo" no painel de uma aula, O SISTEMA DEVE iniciar a sala ligada a essa aula, com o tema como título, o módulo e a apresentação da aula; SE já há aula ativa, ENTÃO DEVE levar a ela.
- [ ] **CA-13** (evento): QUANDO o professor abre o diálogo de conteúdo, O SISTEMA DEVE listar as apresentações da turma (do mais recente para o mais antigo) para ele escolher; só a docente dona e o administrador podem listar.
- [ ] **CA-14** (estado): ENQUANTO a turma tem aula ao vivo ativa, a aba Agenda DEVE mostrar o aviso com o título e o botão "Entrar na aula" (estudante e professor), e o painel da aula ligada a ela DEVE mostrar "Ao vivo agora" e o botão de entrar (no professor, "Voltar para a aula ao vivo", sem "Iniciar aula ao vivo"); nas outras aulas, nada muda.
- [ ] **CA-12** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `schedule/domain`:** validação do conteúdo (tema, links, limites, https). Cobre CA-03.
- **Backend, `schedule/service` (com portas de teste):** `TestSaveContent_OwnerAndAdmin`, `TestSaveContent_OnlyThatSession`, `TestSaveContent_DoesNotMarkAsChangedNorMail` (CA-01, CA-02); `TestSaveContent_Invalid` (CA-03); `TestSaveContent_ForeignDeckOrMissingModule` (CA-04); `TestContent_Permissions` (CA-05); `TestRegenerationKeepsSessionsWithContent` e `TestRemovedMeetingKeepsSessionsWithContent` (CA-06).
- **Backend, `schedule/repository` (banco de teste):** a substituição de links é atômica e com exclusão lógica; a regeneração não apaga a aula com conteúdo. Cobre CA-01 e CA-06.
- **Backend, `schedule/handler`:** as duas rotas, os papéis e os erros da seção 5; `topic` e `hasContent` no calendário. Cobre CA-03 a CA-05 e CA-07.
- **Backend, `classroom` (lista):** `TestListDecks` (ordem, só da turma, papéis e 403 e 404) no serviço e no handler. Cobre CA-13.
- **Backend, `classroom` (limite):** `TestUploadDeck_SuccessAndMaxLimit` passa a testar 100. Cobre CA-08.
- **Frontend, serviço e componentes:** diálogo "Conteúdo da aula" (campos, salvar, erros junto do campo, envio de PDF com validação no navegador) cobre CA-09; painel da aula (mostra o conteúdo, tema no marcador) cobre CA-10; "Iniciar aula ao vivo" cobre CA-11, para docente e sem o botão para estudante.
- **Frontend (CA-14):** `ClassCalendar` mostra a marca e o botão só na aula ligada à sala ativa, para estudante e professor; a página da turma mostra o aviso na aba Agenda e some quando não há aula ativa.
- **Manual:** na aba Horários, abrir a aula de segunda e a de terça, dar um conteúdo diferente a cada uma, enviar um PDF, entrar como estudante e ver cada conteúdo, e iniciar a aula ao vivo a partir da aula do dia.
- **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-042, 044, 048, 051; `schedule/service/service.go` (`UpdateSession`, `ReplaceMeetings`, `readableClass`, `writableClass`), `SessionForm`, `ClassCalendar`, `ClassSessionsCalendar`, `LiveClassPanel` e o módulo `classlink` (modelo dos links).
2. **Ordem de execução:** testes vermelhos e commit `test`; migração `00031`; domain, repository, service (portas), handler, composição em `cmd/api/main.go`; limite de 100 apresentações em `classroom`; frontend (serviço, diálogo, painel da aula, iniciar aula ao vivo, mensagens).
3. **Arquivos a criar ou alterar:** `backend/migrations/00031_session_content.sql`; `backend/internal/modules/schedule/**`; `backend/internal/modules/classroom/service/**` (limite e porta de leitura de apresentação); `backend/cmd/api/main.go`; `frontend/src/services/scheduleService.ts`; `frontend/src/components/SessionContentForm/**` (novo); `frontend/src/components/ClassCalendar/**`; `frontend/src/components/ClassSessionsCalendar/**`; `frontend/src/components/Classroom/LiveClassPanel/**`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md` (termo "Conteúdo da aula").
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: tema, descrição, links, módulo e PDF da apresentação em cada aula, e a aula ao vivo iniciada a partir da aula do dia. Assumidas por recomendação: o conteúdo é por data (sem modelo padrão do encontro), o limite de apresentações sobe para 100, e o estudante não é notificado quando o conteúdo muda.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao decidir o conteúdo de cada aula e o início da aula ao vivo pela aula do dia |
| 14/10/2026 | Aruna Architect | Falha de contrato achada na implementação: o diálogo precisa listar as apresentações da turma, e não havia endpoint. Acrescentados `GET /live/decks` e o CA-13 |
| 14/10/2026 | Implementador | Implementada. Desvios: coluna `has_content` em `class_sessions` (para manter as aulas com conteúdo na regeneração e trazer `hasContent` sem consulta extra); portas `Decks` e `Modules` do `schedule` implementadas por adaptadores em `cmd/api/content_refs.go`; módulo que o leitor não pode usar sai da leitura sem erro (na gravação dá 404), e módulos privados por turma não aparecem ao estudante; os botões novos do painel da aula usam o estilo `navBtn` dos vizinhos, não o componente `Button`; aula cancelada não mostra "Iniciar aula ao vivo". O teste do limite de apresentações da SPEC-051 passou de 20 para 100 |
| 14/10/2026 | Aruna Architect | Falha achada em uso: o estudante abria a aula na agenda e não tinha como entrar na aula ao vivo, porque o botão só existia na visão geral e a spec só previa "Iniciar" para o professor. Acrescentados o aviso na Agenda, a marca e o botão no painel da aula (CA-14); volta a Aprovada |
| 14/10/2026 | Implementador | CA-14 implementado: aviso da aula ao vivo na aba Agenda e, no painel da aula ligada à sala ativa, a marca "Ao vivo agora" e o botão de entrar ("Voltar para a aula ao vivo" para o professor). A página só consulta a sala ativa na aba Agenda, e uma falha da consulta apenas esconde o aviso |
| 16/10/2026 | Implementador | Aparência do diálogo refeita a pedido do Tech Lead (cabeçalho e rodapé fixos, seções Planejamento, Diário da aula e Materiais, anotações privadas destacadas); só estilo e marcação, sem mudar o comportamento nem os critérios de aceite |
