# SPEC-042: Agenda de Aulas da Turma, Calendário e Avisos por E-mail

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-042 |
| **Status** | Rascunho |
| **Data de criação** | 13/10/2026 |
| **Última revisão** | 13/10/2026 |
| **Autor** | Aruna Architect (redigida pelo Claude a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `schedule` (novo: encontros, aulas, eventos, períodos e feriados); `classgroup` (cor da turma); `platform/mailer` e um agendador novo em `platform/` |
| **Contexto de tela** | Aba "Agenda" da página da turma (`/app/classes/:id?tab=schedule`), calendário geral (`/app/calendar`), formulário da turma (encontros semanais), cadastro de feriados do administrador (`/app/admin/holidays`) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-009, SPEC-026, SPEC-038, SPEC-041 |
| **Substitui** | Nenhuma. Revisa a SPEC-009: o campo de texto livre "Horários dos encontros" dá lugar aos encontros semanais |
| **Fontes canônicas** | Pedido da professora trazido pelo Tech Lead em 13/10/2026 (horário das aulas, avisos por e-mail, alteração de uma aula específica, aula online); protótipo HTML da professora "Calendário & Gestão de Turmas" (13/10/2026, entregue no chat, fora do repositório); pedidos do Tech Lead de 13/10/2026 (aula ou evento avulso direto no calendário; edição em massa de um intervalo de dias, como a "semana do saco cheio") |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje o horário da turma é um texto livre ("Segundas e Quartas, 08:20 às 10:00"). O sistema não sabe quando há aula. Por isso:

- não avisa os alunos;
- não mostra um calendário;
- não deixa a professora mudar uma aula específica.

A professora pediu:

1. **Configurar o horário das aulas de cada turma**, para o sistema "ser inteligente" com ele.
2. **Avisar os alunos por e-mail** sobre os horários.
3. **Alterar uma aula específica.** Exemplos:
   - "não haverá aula no dia X";
   - "a aula do dia Y será na sala Z às 12 h";
   - "a aula de hoje será online".
4. **Mostrar aos alunos que estão no sistema um aviso com o botão "assistir aula"** (fica para outra spec; ver 2.1).

O protótipo da professora mostra o que ela imagina:

- calendário mensal com filtro por turma;
- feriados nacionais, fixos e móveis;
- início e término da turma destacados;
- cor por turma;
- horário por dia da semana, com início, fim e quantidade de aulas;
- detalhes de cada dia;
- indicadores (aulas no mês, feriados no mês, horas-aula por semana).

O Tech Lead acrescentou dois pedidos:

- **incluir uma aula ou um evento avulso** direto no calendário ("Palestra de fulano"), visível aos alunos da turma;
- **selecionar um intervalo de dias e editar em massa**, como a "semana do saco cheio", em que os professores preparam material e os alunos não têm aula.

## 2. Objetivos (Goals)

- **Encontros semanais.** A docente cadastra os encontros da turma, cada um com:
  - dia da semana, início e fim;
  - quantidade de aulas (horas-aula);
  - modalidade (presencial ou online);
  - sala, quando presencial, ou link, quando online.
- **Geração das aulas.** O sistema gera as aulas de cada data dentro da vigência da turma.
- **Alteração de uma aula.** A docente muda uma aula específica: cancela, troca horário, sala, modalidade ou link, e informa um motivo.
- **Aula avulsa e evento.** A docente inclui, direto no calendário:
  - uma **aula avulsa** (fora dos encontros);
  - um **evento da turma** (palestra, visita, prova externa), com título, descrição, data, horário e local ou link.
- **Edição em massa de um período.** A docente escolhe o primeiro e o último dia de um intervalo e aplica a ação a todas as aulas dele:
  - **suspender as aulas**, com um rótulo, como "Semana de preparação: sem aula";
  - **passar as aulas para online**, com um link.

  O período aparece como faixa no calendário.
- **Feriados.**
  - Os nacionais, fixos e móveis (Carnaval, Sexta-feira Santa, Corpus Christi), já vêm carregados.
  - O administrador cadastra os locais e o recesso.
  - Aula marcada num feriado é **sinalizada** à docente, que decide se a cancela (D-02).
- **Calendário mensal**, como no protótipo, com o mesmo componente em dois lugares:
  - na **aba "Agenda" da página da turma**;
  - no **calendário geral** (`/app/calendar`): para a docente, todas as turmas, com filtro; para o estudante, as turmas em que está matriculado, só leitura.
- **Cor da turma**, escolhida numa paleta fixa, usada no calendário.
- **E-mails aos estudantes com matrícula ativa:**
  1. **a cada alteração**: aula alterada ou cancelada, aula avulsa, evento, período editado;
  2. **a agenda da turma**, ao ser matriculado;
  3. **lembrete antes de cada aula**;
  4. **resumo semanal** com as aulas da semana seguinte.
- **Indicadores** no calendário: aulas no mês, feriados no mês e horas-aula por semana.

### 2.1. Fora de escopo (Non-Goals)

- O aviso "assistir aula" para quem está no sistema e qualquer transmissão de aula. Uma spec futura usa o link desta spec.
- Datas comemorativas (D-04).
- Frequência e chamada.
- Notificações por WhatsApp, Discord ou push.
- Sincronização com Google Agenda e arquivo `.ics` (ver P-07).
- Remover turma de forma física: o protótipo tem "Remover", o projeto só arquiva (SPEC-009).
- Docente digitada como texto livre: a docente é a dona da turma.
- Qualquer alteração em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

#### 3.1.1. Encontros semanais (formulário da turma)

No grupo "Vigência e encontros" do `ClassForm` (SPEC-041), o campo de texto "Horários dos encontros" dá lugar ao **editor de encontros**:

- sete botões, de Dom a Sáb, que ligam e desligam o dia;
- cada dia ligado abre uma linha com:
  - início e fim;
  - quantidade de aulas, de 1 a 8, com sugestão automática pela duração;
  - modalidade (Presencial ou Online);
  - sala ou link, conforme a modalidade.

Validações junto do campo:

- o fim é depois do início;
- dois encontros do mesmo dia não se sobrepõem;
- um encontro online tem link https.

Um dia pode ter mais de um encontro, com o botão "Adicionar outro horário".

O formulário mostra a soma de horas-aula por semana e o seletor de **cor da turma** (paleta de 8 cores dos tokens).

#### 3.1.2. Calendário (componente `ClassCalendar`)

- **Cabeçalho:**
  - mês e ano, com anterior, próximo e "Hoje";
  - filtro de turma, só no calendário geral;
  - legenda.
- **Grade** de 7 colunas (Dom a Sáb). Cada dia mostra:
  - o número, com destaque no dia de hoje;
  - um marcador de início ou término de turma (verde, com ícone e texto);
  - o feriado (ícone e nome em telas largas);
  - uma bolinha na cor da turma e o código de cada aula, riscada se cancelada, com ícone se online;
  - os eventos (ícone de estrela e título curto);
  - os períodos especiais, como faixa contínua entre os dias.
- **Clique num dia** abre o **painel do dia** (`DayPanel`), com:
  - feriados, marcos e períodos;
  - a lista de aulas e eventos, com horário, sala ou link, modalidade e motivo da alteração.

  Para a docente, cada aula tem "Alterar esta aula" e o painel tem "Incluir aula avulsa" e "Incluir evento".
- **Modo seleção** (só docente, botão "Selecionar período"): o primeiro clique marca o início, o segundo o fim, e abre o painel do período com as ações da seção 2. Teclado: setas movem o foco, Enter seleciona.
- **Indicadores** acima da grade: aulas no mês, feriados no mês e horas-aula por semana. No calendário geral da docente, também o total de turmas.
- **Estados:**
  - carregando: esqueleto da grade;
  - sem encontros cadastrados: estado vazio com link para o formulário da turma;
  - erro: mensagem com "Tentar de novo".
- **Acessibilidade:**
  - a grade é uma tabela com rótulos por dia ("Segunda-feira, 12 de outubro, 2 aulas, feriado");
  - cancelado e online são indicados por texto e ícone, não só por cor.

#### 3.1.3. Formulários de alteração

- **Alterar esta aula:**
  - status: Mantida ou Cancelada;
  - início e fim, modalidade, sala ou link;
  - motivo, obrigatório se cancelada.

  "Desfazer alteração" volta a aula ao encontro semanal.
- **Aula avulsa:** data, início, fim, quantidade de aulas, modalidade, sala ou link, observação.
- **Evento:** título, descrição curta, data, início e fim (ou "dia todo"), local ou link.
- **Período:**
  - primeiro e último dia (pré-preenchidos pela seleção);
  - ação: Suspender aulas ou Passar para online;
  - rótulo, por exemplo "Semana de preparação";
  - link, quando online.

  O formulário mostra o número de aulas afetadas antes de confirmar.

Toda gravação que gera e-mail mostra, antes de confirmar: "Os N estudantes ativos receberão um e-mail".

#### 3.1.4. Telas

- **Página da turma (SPEC-041):** nova aba **"Agenda"**, para a docente e para o estudante. O estudante só lê.
- **Calendário geral:** `/app/calendar`, com o link "Calendário" na barra de navegação, para docente e estudante.
- **Feriados:** `/app/admin/holidays`, só administrador. Lista por ano, com inclusão, edição e exclusão de feriados locais e recessos. Os nacionais aparecem marcados como "Nacional" e não podem ser apagados.

#### 3.1.5. Serviços

`scheduleService` com as chamadas da seção 5, e `classService` com a cor e os encontros da turma.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo novo **`schedule`** (domain, service, repository, handler), mais um **agendador** em `backend/internal/platform/scheduler/`: um laço no próprio processo, com tarefas registradas e trava no banco para não rodar duas vezes.

**Regras de negócio:**

- **RN-01 (encontro semanal):**
  - dia da semana de 0 (domingo) a 6;
  - início antes do fim, em hora local de `America/Sao_Paulo`;
  - quantidade de aulas de 1 a 8;
  - modalidade `IN_PERSON` (sala opcional, até 60 caracteres) ou `ONLINE` (link https obrigatório);
  - dois encontros do mesmo dia não se sobrepõem.
- **RN-02 (geração das aulas):**
  - salvar os encontros gera uma aula (`ClassSession`) para cada data da vigência em que o dia da semana coincide;
  - mudar os encontros ou a vigência regenera só as aulas **futuras e não alteradas**;
  - aulas passadas e aulas alteradas à mão ficam como estão (P-01).
- **RN-03 (feriado):** a aula cuja data cai num feriado ativo é criada normalmente e marcada `onHoliday = true`. O sistema não cancela sozinho (D-02).
- **RN-04 (alteração de uma aula):**
  - a docente muda status, horário, modalidade, sala ou link;
  - a aula passa a `overridden = true`, guarda o motivo e quem alterou;
  - cancelar exige motivo;
  - "desfazer" volta aos valores do encontro e zera `overridden`.
- **RN-05 (aula avulsa):** `origin = EXTRA`, com as mesmas validações da RN-01. Não é afetada pela regeneração.
- **RN-06 (evento da turma):** título obrigatório (até 120 caracteres), descrição opcional (até 1.000, texto puro), data, início e fim (ou dia todo), local ou link https.
- **RN-07 (período especial):**
  - primeiro e último dia dentro da vigência, com o primeiro antes ou igual ao último;
  - ação `NO_CLASSES` (cancela as aulas do intervalo, com o rótulo como motivo) ou `ONLINE` (passa as aulas para online com o link);
  - grava um `SpecialPeriod` e altera as aulas numa transação só;
  - apagar o período desfaz o que ele mudou nas aulas que ele alterou.
- **RN-08 (autorização):**
  - só a docente dona da turma, ou o administrador, escreve na agenda;
  - estudantes com matrícula `ACTIVE` leem;
  - os feriados são só do administrador.
- **RN-09 (e-mails):** destinatários são os estudantes com matrícula `ACTIVE` e e-mail confirmado. Cada e-mail é registrado numa fila (`EmailOutbox`) e enviado pelo agendador, com até 3 novas tentativas.
  - **(a) alteração:** um e-mail por gravação. Um período gera um e-mail só, não um por aula.
  - **(b) agenda:** ao ativar uma matrícula (SPEC-041 e moderação), com as próximas aulas e os encontros.
  - **(c) lembrete:** antes de cada aula não cancelada (antecedência na P-03).
  - **(d) resumo semanal:** no dia e hora da P-04, com as aulas da semana seguinte, só se houver aula.
- **RN-10 (preferências):** o estudante pode desligar (c) e (d) no perfil. (a) e (b) sempre vão (P-05).
- **RN-11 (feriados nacionais):**
  - a migração carrega os fixos;
  - o agendador calcula e grava os móveis (Carnaval, Sexta-feira Santa, Corpus Christi), pela data da Páscoa, para o ano atual e o seguinte, uma vez por ano;
  - nacionais não podem ser apagados, só desativados.
- **RN-12 (cor):** `ClassGroup.color` é uma das 8 chaves da paleta (`orange`, `blue`, `green`, `purple`, `pink`, `teal`, `yellow`, `red`). A cor de verdade vem dos tokens do frontend.
- **RN-13 (fuso):** horários gravados como hora local mais a data, interpretados em `America/Sao_Paulo`. As respostas da API levam data e hora em ISO 8601 com o deslocamento.

## 4. Modelo de Dados (Data Model)

Todas as tabelas têm `id` UUIDv7, `created_at`, `updated_at` e `deleted_at` (exclusão lógica), como manda o `ARCHITECTURE.md`.

**`class_weekly_meetings` (`WeeklyMeeting`):**

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `class_id` | uuid | Sim | FK `classes` | Turma |
| `weekday` | smallint | Sim | 0 a 6 | Dia da semana (RN-01) |
| `start_time`, `end_time` | time | Sim | início < fim | Hora local |
| `lesson_count` | smallint | Sim | 1 a 8 | Horas-aula do encontro |
| `mode` | text | Sim | `IN_PERSON`, `ONLINE` | Modalidade |
| `room` | text | Não | até 60 | Sala |
| `online_url` | text | Não | https; obrigatório se `ONLINE` | Link |

**`class_sessions` (`ClassSession`):**

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `class_id` | uuid | Sim | FK `classes` | Turma |
| `meeting_id` | uuid | Não | FK `class_weekly_meetings` | Nulo na aula avulsa |
| `date` | date | Sim | dentro da vigência | Data |
| `start_time`, `end_time` | time | Sim | início < fim | Hora local |
| `lesson_count` | smallint | Sim | 1 a 8 | Horas-aula |
| `mode`, `room`, `online_url` | | | como no encontro | Valores efetivos da aula |
| `status` | text | Sim | `SCHEDULED`, `CANCELED` | Situação |
| `origin` | text | Sim | `WEEKLY`, `EXTRA` | Gerada pelo encontro ou avulsa |
| `overridden` | boolean | Sim | padrão `false` | Alterada à mão (RN-04) |
| `change_reason` | text | Não | até 300 | Motivo da alteração |
| `period_id` | uuid | Não | FK `special_periods` | Período que a alterou (RN-07) |
| `on_holiday` | boolean | Sim | padrão `false` | Cai em feriado (RN-03) |
| `reminder_sent_at` | timestamptz | Não | | Lembrete enviado (RN-09c) |

Índice único: (`class_id`, `meeting_id`, `date`) com `deleted_at` nulo e `meeting_id` não nulo.

**`class_events` (`ClassEvent`):** `class_id`, `title`, `description`, `date`, `start_time` e `end_time` (nulos se dia todo), `all_day`, `location`, `online_url`.

**`special_periods` (`SpecialPeriod`):** `class_id`, `first_day`, `last_day`, `action` (`NO_CLASSES`, `ONLINE`), `label` (até 80), `online_url`.

**`holidays` (`Holiday`):** `date`, `name` (até 120), `scope` (`NATIONAL`, `LOCAL`, `RECESS`), `active`. Único (`date`, `name`) com `deleted_at` nulo.

**`email_outbox` (`EmailOutbox`):** `recipient_user_id`, `kind` (`SCHEDULE_CHANGE`, `SCHEDULE_ON_ENROLL`, `SESSION_REMINDER`, `WEEKLY_DIGEST`), `subject`, `body_html`, `body_text`, `status` (`PENDING`, `SENT`, `FAILED`), `attempts`, `send_after`, `sent_at`, `last_error`.

**Alterações:**

- `classes.color`: text, padrão `orange` (RN-12);
- `users`: duas preferências booleanas, `email_session_reminders` e `email_weekly_digest`, padrão `true` (RN-10).

**Migração:**

- cria as tabelas;
- carrega os feriados nacionais fixos;
- mantém `classes.schedule_description` para turmas sem encontros (P-06).

## 5. Contrato de API (API Contract)

Resumo; os campos seguem a seção 4 em `camelCase`. Erros RFC 7807 com os slugs abaixo e os comuns do projeto (`malformed-request`, `invalid-uuid`, `forbidden`, `class-not-found`).

| Método e rota | Papéis | Descrição | Erros específicos |
| :--- | :--- | :--- | :--- |
| `PUT /api/v1/classes/:id/meetings` | Docente dona, admin | Substitui os encontros e regenera as aulas (RN-01, RN-02) | `invalid-meeting`, `meetings-overlap` |
| `GET /api/v1/classes/:id/calendar?from=&to=` | Docente dona, admin, estudante ativo | Aulas, eventos, períodos, feriados e marcos do intervalo (até 62 dias) | `range-too-large` |
| `PATCH /api/v1/classes/:id/sessions/:sessionId` | Docente dona, admin | Altera uma aula (RN-04) | `reason-required`, `invalid-session` |
| `DELETE /api/v1/classes/:id/sessions/:sessionId/override` | Docente dona, admin | Desfaz a alteração (RN-04) | |
| `POST /api/v1/classes/:id/sessions` | Docente dona, admin | Aula avulsa (RN-05) | `invalid-session` |
| `DELETE /api/v1/classes/:id/sessions/:sessionId` | Docente dona, admin | Apaga uma aula avulsa (lógica) | `not-extra-session` |
| `POST`, `PATCH`, `DELETE /api/v1/classes/:id/events[/:eventId]` | Docente dona, admin | Eventos (RN-06) | `invalid-event` |
| `POST /api/v1/classes/:id/periods` | Docente dona, admin | Período especial (RN-07); responde as aulas afetadas | `invalid-period` |
| `DELETE /api/v1/classes/:id/periods/:periodId` | Docente dona, admin | Desfaz o período (RN-07) | |
| `GET /api/v1/me/calendar?from=&to=` | Docente, estudante | Calendário geral: turmas da docente ou do estudante | `range-too-large` |
| `GET`, `POST`, `PATCH`, `DELETE /api/v1/holidays[/:id]` | Admin (leitura: todos autenticados) | Feriados (RN-11) | `national-holiday-locked` |
| `PATCH /api/v1/students/me/notifications` | Estudante | Preferências de e-mail (RN-10) | |

`POST /classes` e `PATCH /classes/:id` aceitam `color` (RN-12, erro `invalid-color`).

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Muitos e-mails (um período de uma semana numa turma de 40) | Um e-mail por gravação, nunca por aula (RN-09a); fila com envio espaçado pelo agendador |
| Regenerar aulas apaga alterações da docente | A regeneração só toca aulas futuras, não alteradas e não avulsas (RN-02); teste dedicado |
| O agendador roda duas vezes se houver duas instâncias | Trava no banco por tarefa (`pg_try_advisory_lock`); hoje há uma instância só |
| Fuso horário e horário de verão | Hora local mais data, interpretadas em `America/Sao_Paulo` (RN-13); testes nas viradas de mês e de ano |
| Feriado móvel calculado errado | Teste da Páscoa contra datas conhecidas (2024 a 2030) |
| E-mail para quem não quer | Preferências para lembrete e resumo (RN-10); alterações sempre vão, porque mudam a vida do aluno |
| Turmas antigas só com o texto livre | O texto continua aparecendo enquanto a turma não tiver encontros (P-06) |
| Link malicioso no link da aula | Só https, mostrado como link externo com `rel="noopener noreferrer"` |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente salva os encontros semanais, O SISTEMA DEVE gerar uma aula para cada data da vigência no dia da semana de cada encontro.
- [ ] **CA-02** (indesejado): SE dois encontros do mesmo dia se sobrepõem, ou um encontro online não tem link https, ENTÃO O SISTEMA DEVE recusar com o erro junto do encontro.
- [ ] **CA-03** (evento): QUANDO os encontros ou a vigência mudam, O SISTEMA DEVE regenerar só as aulas futuras não alteradas e não avulsas.
- [ ] **CA-04** (estado): ENQUANTO uma aula cair num feriado ativo, O SISTEMA DEVE sinalizá-la à docente sem cancelá-la.
- [ ] **CA-05** (evento): QUANDO a docente altera ou cancela uma aula, O SISTEMA DEVE gravar o motivo, mostrar a aula alterada no calendário e enfileirar um e-mail aos estudantes ativos.
- [ ] **CA-06** (indesejado): SE a docente cancela uma aula sem motivo, ENTÃO O SISTEMA DEVE recusar com `reason-required`.
- [ ] **CA-07** (evento): QUANDO a docente inclui uma aula avulsa ou um evento, O SISTEMA DEVE mostrá-lo no calendário da turma e dos estudantes e enfileirar um e-mail.
- [ ] **CA-08** (evento): QUANDO a docente aplica "Suspender aulas" ou "Passar para online" a um intervalo, O SISTEMA DEVE alterar todas as aulas do intervalo numa transação, mostrar o período como faixa e enfileirar um único e-mail.
- [ ] **CA-09** (evento): QUANDO a docente desfaz um período, O SISTEMA DEVE devolver as aulas que ele alterou ao estado anterior.
- [ ] **CA-10** (ubíquo): O calendário DEVE mostrar mês, navegação, "Hoje", legenda, marcos de início e término, feriados, aulas na cor da turma (canceladas e online com texto ou ícone), eventos e períodos, e abrir o painel do dia ao clicar.
- [ ] **CA-11** (ubíquo): O calendário DEVE mostrar aulas no mês, feriados no mês e horas-aula por semana.
- [ ] **CA-12** (estado): ENQUANTO o usuário for estudante, o calendário DEVE ser só leitura e mostrar só as turmas com matrícula ativa.
- [ ] **CA-13** (evento): QUANDO uma matrícula passa a `ACTIVE`, O SISTEMA DEVE enfileirar o e-mail com a agenda da turma.
- [ ] **CA-14** (evento): QUANDO chega a hora do lembrete de uma aula não cancelada, O SISTEMA DEVE enfileirar um lembrete por estudante que não o desligou, uma única vez por aula.
- [ ] **CA-15** (evento): QUANDO chega a hora do resumo semanal, O SISTEMA DEVE enviar a cada estudante que não o desligou as aulas da semana seguinte, se houver.
- [ ] **CA-16** (indesejado): SE o envio de um e-mail falhar, ENTÃO O SISTEMA DEVE tentar de novo até 3 vezes e marcá-lo `FAILED`, sem travar a fila.
- [ ] **CA-17** (ubíquo): O SISTEMA DEVE calcular Carnaval, Sexta-feira Santa e Corpus Christi a partir da Páscoa e listar os feriados nacionais do ano atual e do seguinte.
- [ ] **CA-18** (indesejado): SE o administrador tentar apagar um feriado nacional, ENTÃO O SISTEMA DEVE recusar com `national-holiday-locked`.
- [ ] **CA-19** (indesejado): SE alguém que não é a dona da turma nem admin tentar escrever na agenda, ENTÃO O SISTEMA DEVE responder 403 `forbidden`.
- [ ] **CA-20** (ubíquo): Textos em `messages/pt-BR`, cores só por tokens (a cor da turma por chave da paleta), Stylelint limpo, contraste AA e calendário operável só por teclado.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038). A lista definitiva por nome entra na revisão que resolver as pendências; abaixo, os testes por camada e critério.

**Backend, `schedule`:**

- *domain:*
  - validação de encontros e sobreposição (CA-02);
  - geração de datas pela vigência, inclusive nas viradas de mês e de ano (CA-01);
  - Páscoa e feriados móveis de 2024 a 2030 (CA-17).
- *service:*
  - regeneração que preserva aulas alteradas, avulsas e passadas (CA-03);
  - sinalização de feriado (CA-04);
  - alteração e cancelamento com motivo (CA-05, CA-06);
  - aula avulsa e evento (CA-07);
  - período e desfazer (CA-08, CA-09);
  - autorização (CA-19);
  - enfileiramento de cada tipo de e-mail e preferências (CA-05, CA-07, CA-08, CA-13 a CA-15).
- *handler:* validação, códigos HTTP e problemas de cada rota (seção 5).
- *repository (PostgreSQL real):* unicidade das aulas, transação do período, consulta do calendário por intervalo.
- *platform/scheduler:* trava por tarefa e novas tentativas da fila (CA-16), com relógio injetado.

**Frontend:**

- `ClassCalendar`: grade e navegação, marcos, feriados, aulas, eventos, períodos, painel do dia, modo seleção por mouse e teclado, indicadores, estudante só leitura (CA-10 a CA-12, CA-20).
- Editor de encontros no `ClassForm` (CA-02).
- Formulários de alteração, aula avulsa, evento e período, com o aviso de e-mail (CA-05 a CA-09).
- Tela de feriados (CA-18).
- `scheduleService` com `fetch` falso.

**Manual:** cadastrar encontros, ver o calendário, alterar uma aula, cancelar com motivo, incluir palestra, suspender uma semana e conferir os e-mails no Mailpit (`http://192.168.3.111:8125`).

**Cobertura:** acima de 80% no escopo (ARCHITECTURE, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:**
   - SPEC-009, SPEC-038 e SPEC-041;
   - `backend/internal/platform/mailer/`;
   - `backend/internal/modules/classgroup/`;
   - `frontend/src/app/app/classes/[id]/`;
   - `frontend/src/components/ClassForm/`.
2. **Ordem de execução:**
   1. domain e migração;
   2. agendador e fila de e-mail;
   3. service e handler;
   4. calendário (componente);
   5. editor de encontros;
   6. formulários;
   7. telas (aba Agenda, `/app/calendar`, feriados);
   8. e-mails.

   Cada etapa com o par `test(...)` vermelho e `feat(...)`.
3. **Arquivos:**
   - `backend/internal/modules/schedule/` (novo);
   - `backend/internal/platform/scheduler/` (novo);
   - migração `00026`;
   - `classgroup` (cor e encontros na resposta da turma);
   - `user` (preferências);
   - `frontend/src/components/ClassCalendar/`, `MeetingsEditor/`, `SessionForm/`, `EventForm/`, `PeriodForm/` (novos);
   - `frontend/src/app/app/calendar/` e `frontend/src/app/app/admin/holidays/` (novos);
   - página da turma, `ClassForm`, `AppShell` (link "Calendário");
   - `frontend/src/services/scheduleService.ts` (novo);
   - mensagens.
4. **Definição de pronto:** os CA marcados, testes passando com cobertura acima de 80%, ESLint, Stylelint e `tsc` limpos, roteiro manual com os e-mails conferidos no Mailpit, status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (13/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | O horário regular são encontros semanais que geram as aulas de cada data; a docente informa o link da aula online; os quatro tipos de e-mail entram |
| D-02 | Aula em feriado é só sinalizada; a docente decide |
| D-03 | Feriados cadastráveis pelo administrador, com os nacionais (fixos e móveis) já carregados |
| D-04 | Datas comemorativas ficam fora da primeira versão |
| D-05 | Calendário na página da turma e calendário geral, com o mesmo componente |
| D-06 | A docente inclui aula avulsa ou evento direto no calendário, visível aos alunos da turma |
| D-07 | A docente seleciona um intervalo (primeiro e último dia) e edita em massa, como na "semana do saco cheio" |

### Pendências

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | Guardar as aulas como linhas no banco (geradas) ou calculá-las na hora a partir dos encontros mais as exceções? | **Guardar como linhas** (`class_sessions`): alterar, lembrar e consultar fica simples; a regeneração preserva o que foi mexido (RN-02) |
| P-02 | Uma turma pode ter mais de um encontro no mesmo dia (ex.: 08:20 e 13:50)? | **Sim**, desde que não se sobreponham |
| P-03 | Antecedência do lembrete | **Na véspera, às 18 h**, para aulas da manhã, e **2 h antes** para as demais; ou fixar só "véspera às 18 h", mais simples |
| P-04 | Dia e hora do resumo semanal | **Domingo, 18 h** |
| P-05 | O estudante pode desligar os e-mails? | **Só lembrete e resumo**; alterações e agenda sempre vão |
| P-06 | O que fazer com o texto livre "Horários dos encontros" das turmas existentes? | **Manter e mostrar** enquanto a turma não tiver encontros; sumir do formulário quando houver |
| P-07 | Oferecer o calendário em `.ics` para Google Agenda e celular? | **Não nesta spec**; fica para depois |
| P-08 | Período especial só pode suspender ou passar para online, ou também trocar a sala de todas as aulas do intervalo? | **Só suspender ou online** nesta versão |
| P-09 | O evento da turma conta como aula (horas-aula) ou é só informativo? | **Só informativo**; para contar horas-aula, a docente cria uma aula avulsa |
| P-10 | Quem cadastra os feriados locais da UTFPR e o recesso: só o administrador ou também a docente para a própria turma? | **Só o administrador**, valendo para todas as turmas; a docente usa o período especial para a turma dela |
| P-11 | Termos novos no glossário (seção ao lado) | Aprovar como estão ou ajustar os nomes |

### Termos propostos para o `GLOSSARY.md`

| Português | Código (EN) | Definição |
| :--- | :--- | :--- |
| Agenda da turma | módulo `schedule` | Encontros, aulas, eventos e períodos de uma turma |
| Encontro semanal | `WeeklyMeeting` | Horário fixo da turma num dia da semana |
| Aula (sessão de aula) | `ClassSession` | Ocorrência numa data, gerada por um encontro ou avulsa. Evita `Lesson`, reservado a "Módulo de ensino" |
| Aula avulsa | `ClassSession` com `origin = EXTRA` | Aula fora dos encontros |
| Evento da turma | `ClassEvent` | Palestra, visita ou atividade informada aos alunos |
| Período especial | `SpecialPeriod` | Intervalo de dias com aulas suspensas ou online |
| Feriado | `Holiday` | Data sem expediente, nacional, local ou recesso |
| Modalidade | `IN_PERSON`, `ONLINE` | Presencial ou online |
| Fila de e-mails | `EmailOutbox` | Mensagens a enviar pelo agendador |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 13/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | Criação do rascunho a partir do pedido da professora, do protótipo dela e dos pedidos do Tech Lead (aula ou evento avulso; edição em massa de um intervalo). Decisões D-01 a D-07; pendências P-01 a P-11 com recomendação |
