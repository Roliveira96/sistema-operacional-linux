# SPEC-073: Linha do Tempo da Turma e Diário da Aula (anotações e comandos do professor)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-073 |
| **Status** | Implementada |
| **Data de criação** | 16/10/2026 |
| **Última revisão** | 16/10/2026 (CA-12 e CA-13 implementados) |
| **Autor** | Aruna Architect (redigida pelo Claude a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `schedule` (linha do tempo e anotações do docente) e `classroom` (comandos do professor na aula ao vivo), com `platform/hub` |
| **Contexto de tela** | Aba Agenda da página da turma (`/app/classes/:id?tab=schedule`), painel do dia do calendário, sala ao vivo (`/app/classes/:id/live`, janela de apresentação) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-042 (agenda), SPEC-051 (sala ao vivo), SPEC-053 (conteúdo de cada aula), SPEC-055 (janela de apresentação e painel), SPEC-056 (espelho do terminal), SPEC-060 (executar exemplos na aula) |
| **Substitui** | Nenhuma. Amplia o conteúdo da aula da SPEC-053 |
| **Fontes canônicas** | Texto trazido pelo Tech Lead em 16/10/2026 (seções "Interface abaixo do calendário" e "Ciclo de vida do conteúdo", parte das anotações do docente) e a decisão dele no mesmo dia: "os comandos que o professor digita devem ser salvos". As seções do texto sobre materiais por fase (SPEC-074), caderno do aluno (spec em andamento por outra pessoa), terminal com módulo pré-selecionado e presença ficam fora desta spec |

---

## 1. Contexto e Problema (Context & Problem Statement)

A aba Agenda mostra o calendário mensal (SPEC-042) e, em cada aula, o conteúdo que o professor preparou (SPEC-053). Mas a turma não tem **uma rotina visível**: para saber o que foi dado na aula passada, o que está acontecendo agora e o que vem na semana que vem, o estudante precisa clicar dia por dia no calendário. A aula ao vivo (SPEC-051) deixa só o título e a duração, na visão geral; o que o professor **digitou no terminal** durante a aula se perde quando a sala é encerrada, e o estudante que faltou ou que quer repetir os comandos em casa não tem de onde copiar.

O professor também não tem onde registrar, por aula, **o que de fato aconteceu** (o "diário de bordo"): um resumo para a turma e anotações só dele.

## 2. Objetivos (Goals)

- Abaixo do calendário da aba Agenda, a turma ganha a **linha do tempo** em três blocos: **Aulas passadas** (as 3 últimas, recolhidas), **Aula atual** (em destaque, com o botão da sala ao vivo) e **Próximas aulas** (as 5 seguintes, com tema e material preparatório).
- Cada aula da agenda ganha o **diário da aula**: as anotações públicas do professor, as anotações privadas dele (só ele vê), o conteúdo da SPEC-053 e as salas ao vivo ligadas à aula com **os comandos que o professor executou**.
- Os comandos que o professor digita (ou executa pelo botão ▶ da SPEC-060) na janela de apresentação são **gravados no servidor**, com o terminal, o resultado e a saída, e podem ser consultados e copiados depois.
- O servidor decide o que é "passado", "atual" e "próximo" (`ARCHITECTURE.md`, seção 2: o servidor é a fonte da verdade de tempo).

### 2.1. Fora de escopo (Non-Goals)

- **Anotações do estudante** (caderno por aula, anotações na sala ao vivo): é a SPEC-072 (caderno dinâmico de anotações em aula), já implementada. Esta spec não toca `live_classroom_notes`, o `StudentNotesPanel` nem as rotas de anotações da SPEC-051; o diário não mostra nada do estudante.
- Materiais com visibilidade por fase (pré-aula, durante, pós-aula), gabaritos e arquivos além dos já previstos na SPEC-053: ficam na SPEC-074, que acrescenta os materiais ao diário desta spec.
- Frequência, presença e telemetria de engajamento: spec própria, futura.
- O estudante ter terminal próprio ou trocar de módulo na aula ao vivo (contradiz a SPEC-054): spec própria, futura.
- Reproduzir os comandos gravados no terminal do estudante ("replay") ou gravar a tela da aula.
- Gravar o que o estudante digita no exercício ao vivo (SPEC-065) ou na tela de estudo.
- Anotações do professor escritas de dentro do painel da aula ao vivo: nesta spec elas ficam no diálogo de conteúdo da aula (SPEC-053).
- Notificar alguém quando o diário muda. Mudar o calendário geral (`/app/calendar`).
- Mudar a lista "Aulas anteriores" da visão geral (SPEC-051), que continua como está.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Linha do tempo (`ClassTimeline`, todos).** Na aba Agenda, abaixo do calendário (e abaixo do aviso de aula ao vivo da SPEC-053), três blocos, nesta ordem:

- **Aula atual.** Um card em destaque com a marca **Agora** (ou **Começa às HH:MM**, nos 15 minutos antes do início), a data e o horário, o tema (ou o código da disciplina), a sala ou o link, e o botão conforme o papel e o estado: para o estudante, **Entrar na aula ao vivo** quando a turma tem sala ao vivo ativa (ligada ou não à aula), senão o texto "A aula ao vivo ainda não começou"; para o professor, **Voltar para a aula ao vivo** quando há sala ativa, senão **Iniciar aula ao vivo** (o mesmo início pela aula da SPEC-053). Quando não há aula agora, o bloco mostra "Nenhuma aula agora" e a próxima aula com data e horário.
- **Aulas passadas.** As 3 aulas mais recentes já terminadas, cada uma num card recolhido com a data, o tema e a marca "N comandos" (quando houve sala ao vivo com comandos). O botão **Ver diário** expande o card com o diário da aula.
- **Próximas aulas.** As 5 aulas seguintes, com data, horário, tema, sala ou link e, quando a aula tem conteúdo, os links e a apresentação (o material preparatório da SPEC-053). **Ver detalhes** expande o diário (só o conteúdo e as anotações).

**Ações dos cards (todos os blocos).** Cada card de aula tem o botão que abre o diário dela: **Ver diário** nas passadas e **Ver detalhes** na atual e nas próximas. Ele existe **sempre** na atual e nas passadas; nas próximas, **sempre para o professor** e, para o estudante, só quando a aula tem conteúdo (não há o que ver numa aula vazia). O diário aberto num card, sem nada registrado, diz "Nada registrado nesta aula ainda." (no painel do dia do calendário, não), e o professor tem ao lado os botões de editar abaixo. O professor dono e o administrador têm, em **todos** os cards, os botões **Conteúdo da aula** e **Alterar esta aula**, que abrem os mesmos diálogos do painel do dia do calendário (SPEC-053 e SPEC-042); ao salvar, a linha do tempo e o calendário são lidos de novo. O estudante nunca vê esses dois botões.

**Aparência dos cards.** Cada card tem a **data em destaque** à esquerda (o dia grande e o mês pequeno; cheia nas próximas, só contorno nas passadas e na cor de destaque na atual), o título e, abaixo, a linha do dia da semana, do horário, da sala (num chip) e das marcas; as ações ficam à direita numa tela larga e abaixo, com altura de 44 px, numa estreita, e os dois botões de editar ficam agrupados e separados do que abre o diário. Os três blocos têm só um rótulo discreto com uma linha, e um bloco sem aulas é uma caixa tracejada.

A linha do tempo é consultada ao abrir a aba Agenda, a cada 60 segundos enquanto a aba está visível e quando a aba volta a ficar visível; falha na consulta esconde a linha do tempo sem mensagem e a próxima consulta tenta de novo (padrão da SPEC-067). Estados: carregando (esqueleto de três cards), sem aulas (turma sem encontros: o mesmo estado vazio do calendário) e erro silencioso.

**Diário da aula (`SessionDiary`, todos).** O mesmo componente aparece expandido na linha do tempo e no painel do dia do calendário (abaixo do conteúdo da SPEC-053), com as seções, nesta ordem, cada uma só quando tem algo:

- **Anotações da aula:** o texto público do professor (HTML filtrado, como a descrição).
- **Anotações privadas:** só para o professor dono e o administrador, com a marca **Só você vê**.
- **Conteúdo:** o bloco de conteúdo da SPEC-053 (tema, descrição, links, módulo e apresentação), como já é.
- **Aulas ao vivo desta aula:** uma entrada por sala ao vivo ligada à aula (título, início, fim, duração) com a lista dos **comandos do professor**, na ordem em que rodaram: o número do terminal, a linha digitada, o código de saída (verde para 0, vermelho para os outros, "interrompido" quando não há código), a saída recolhida (**Ver saída**) e o botão **Copiar** da linha. A lista é carregada quando a entrada é expandida.

**Diálogo de conteúdo da aula (`SessionContentForm`, professor).** Ganha dois campos de texto formatado, com o mesmo editor da descrição: **Anotações da aula (a turma vê)** e **Anotações privadas (só você vê)**. Gravadas com o resto do conteúdo, pelo botão Salvar.

**Rótulo e ajuda dos editores.** Cada um dos três editores do diálogo (a descrição e as duas anotações) tem o **rótulo visível** em cima e, logo abaixo, uma **linha de ajuda** que diz quem lê o texto: na descrição, "A turma vê este texto na agenda da turma."; nas anotações da aula, "Registro do que aconteceu na aula: a turma vê assim que você salvar."; nas privadas, "Lembretes seus sobre esta aula. Nenhum estudante vê." O editor só tem rótulo para leitor de tela, então o rótulo visível é de quem o usa, e a linha de ajuda é ligada ao editor (`aria-describedby`).

**Janela de apresentação (professor).** Cada comando concluído no terminal da aula (digitado à mão ou executado pelo ▶ da SPEC-060) é enviado ao servidor uma vez, com o terminal, a linha, o código de saída e a saída impressa (cortada em 4.000 caracteres, com a marca de corte). Nada muda na tela. O adaptador do terminal (`engine/terminalWindow.ts`) ganha o retorno `onCommandRun`, lido de fora do `engine/core` como o `execute` já lê a saída e o histórico; se a leitura de fora não bastar, esta spec autoriza um aviso mínimo, só de notificação, em `engine/core/terminal/`, coberto pela conformidade da SPEC-030 (precedente da SPEC-051, P-Q1).

Botões do padrão `Button`, tema único escuro, só tokens, alvos de 44 px, textos no arquivo de mensagens, navegação por teclado; a linha do tempo é uma lista com rótulos por bloco; a marca "Agora" é texto, não só cor.

### 3.2. Backend (Go — Camada de Módulo/Service)

**Módulo `schedule`:**

- **RN-01 (linha do tempo):** calculada no servidor, em `America/Sao_Paulo` (SPEC-042 RN-13), só com aulas não canceladas: **passadas** são as que terminaram antes de agora, as 3 mais recentes, da mais recente para a mais antiga; **atual** é a aula de hoje que já entrou na sua janela, que vai de **15 minutos antes do início** até o fim (início − 15 min ≤ agora < fim; se houver mais de uma, a de início mais cedo); **próximas** são as que ainda não entraram na janela (início − 15 min > agora), as 5 primeiras. Aula alterada usa o horário alterado.
- **RN-02 (a sala ao vivo vence):** se a turma tem sala ao vivo ativa ligada a uma aula (`class_session_id`), essa aula é a **atual**, mesmo fora do horário, e sai dos outros blocos. Sala ativa sem vínculo não muda os blocos; a linha do tempo informa que há sala ativa (`liveSessionId`) para o botão de entrar.
- **RN-03 (anotações do docente):** o conteúdo da aula (SPEC-053) ganha as anotações públicas e as privadas, ambas opcionais, HTML filtrado pelo filtro da ementa, com o limite da descrição. Só a docente dona e o administrador gravam; gravar **não** marca a aula como alterada, não pede motivo nem envia e-mail (SPEC-053 RN-03). As privadas **nunca** saem para o estudante: nem na leitura do conteúdo, nem no diário, nem na linha do tempo.
- **RN-04 (leitura do diário):** docente dona, administrador e estudante com matrícula ativa (SPEC-042 RN-08). O diário traz o conteúdo (com as privadas só para quem pode) e as salas ao vivo ligadas à aula com o total de comandos. Os comandos vêm por leitura própria, por sala.

**Módulo `classroom`:**

- **RN-05 (comando gravado):** a mensagem `live:terminal:command` é aceita só da **janela de apresentação** do professor dono ou do administrador (como `live:terminal:screen`); do painel, de estudante ou da sala de espera é descartada com auditoria (`wrong-view`, `not-allowed`). O servidor valida: terminal de 1 a 3; linha de 1 a 2.000 caracteres sem caracteres de controle; código de saída inteiro ou nulo; saída de até 4.000 caracteres (o que passar disso é cortado no servidor e marcado); grava com o momento **do servidor** (`ran_at`). Mensagem inválida é rejeitada com o log `classroom message rejected`. Nada é retransmitido: o painel e os alunos já veem o terminal pelo espelho (SPEC-056).
- **RN-06 (teto por sala):** no máximo 2.000 comandos por sala ao vivo; acima disso o servidor descarta com auditoria (`command-limit`) e nada quebra na aula. A taxa segue o limite por emitente da SPEC-051 RN-05.
- **RN-07 (leitura dos comandos):** docente dona, administrador e estudante com matrícula ativa leem os comandos de uma sala da turma, durante e depois dela, na ordem em que rodaram. Sala de outra turma ou inexistente: 404.
- **RN-08 (senhas):** a linha gravada é a que o terminal guarda no histórico; o histórico do terminal não guarda o que é digitado em pedido de senha, e a saída nunca contém a senha porque o terminal não a exibe (SPEC-051). Teste confirma com `su`.

**Ligação entre os módulos:** `schedule` declara a interface de que precisa (as salas ao vivo ligadas a uma aula, com o total de comandos de cada uma), implementada pelo serviço de `classroom` em `cmd/api` (padrão da SPEC-053: `content_refs.go`). Nenhum módulo lê o repositório do outro.

## 4. Modelo de Dados (Data Model)

Migração `00038`.

Colunas novas em `class_sessions`:

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `teacher_notes` | text | Não | HTML filtrado, limite da descrição | Anotações públicas do professor (RN-03) |
| `teacher_private_notes` | text | Não | HTML filtrado, limite da descrição | Anotações privadas do professor (RN-03) |

Tabela nova `live_terminal_commands` (comando da aula ao vivo):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | Identificador |
| `session_id` | uuid | Sim | FK `live_classroom_sessions` | Sala ao vivo |
| `terminal` | smallint | Sim | de 1 a 3 | Aba do terminal |
| `command` | text | Sim | de 1 a 2.000 caracteres | A linha digitada |
| `exit_status` | smallint | Não | | Código de saída; nulo quando interrompido |
| `output` | text | Sim | até 4.000 caracteres; pode ser vazio | O que o comando imprimiu |
| `output_truncated` | boolean | Sim | padrão `false` | A saída foi cortada |
| `ran_at` | timestamptz | Sim | relógio do servidor | Quando chegou (RN-05) |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | Sim, Sim, Não | | Auditoria e exclusão lógica (valor forense) |

Índice em `(session_id, ran_at)` entre os não excluídos. Não há exclusão física de nada nesta spec.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/{id}/sessions/timeline`**: a linha do tempo da turma (RN-01, RN-02).

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa.
- **Resposta (200):**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `now` | data e hora ISO 8601 | Sim | O agora do servidor, que a tela usa para os textos relativos |
| `current` | aula ou nulo | Sim | A aula atual |
| `past` | lista de aula | Sim | Até 3, da mais recente para a mais antiga |
| `upcoming` | lista de aula | Sim | Até 5, da mais próxima para a mais distante |
| `liveSessionId` | uuid ou nulo | Sim | A sala ao vivo ativa da turma, ligada ou não a uma aula |

Cada **aula** traz: `id`, `date`, `startTime`, `endTime`, `startsAt` e `endsAt` (ISO 8601 com o deslocamento, SPEC-042 RN-13), `mode`, `room`, `onlineUrl`, `lessonCount`, `topic`, `hasContent`, `liveSessionCount` (salas ligadas, ativas ou encerradas) e `commandCount` (soma dos comandos dessas salas).

- **Erros (RFC 7807):** 403 `forbidden`; 404 `class-not-found`.

**`GET /api/v1/classes/{id}/sessions/{sessionId}/diary`**: o diário de uma aula (RN-04).

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa.
- **Resposta (200):** `session` (a aula, como na linha do tempo), `content` (a leitura da SPEC-053, mais `teacherNotes` e, só para docente e administrador, `teacherPrivateNotes`) e `liveSessions` (lista com `id`, `title`, `status`, `startedAt`, `endedAt`, `durationMinutes` e `commandCount`).
- **Erros:** 403 `forbidden`; 404 `session-not-found`.

**`PUT /api/v1/classes/{id}/sessions/{sessionId}/content`** (SPEC-053): o corpo ganha `teacherNotes` e `teacherPrivateNotes` (HTML, opcionais; ausente ou vazio limpa). Erro 400 `content-too-long` com a extensão `field` indicando qual campo. **`GET .../content`** devolve `teacherNotes` a todos e `teacherPrivateNotes` só à docente dona e ao administrador.

**`GET /api/v1/classes/{id}/live/sessions/{sessionId}/commands`**: os comandos do professor numa sala ao vivo (RN-07).

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa.
- **Resposta (200):** `sessionId` e `commands`: lista, na ordem em que rodaram, com `terminal`, `command`, `exitStatus` (inteiro ou nulo), `output`, `outputTruncated` e `ranAt`.
- **Erros:** 403 `forbidden`; 404 `session-not-found`.

**Evento `live:terminal:command`** (cliente → servidor, só a janela de apresentação): `terminal` (1 a 3), `command` (texto), `exitStatus` (inteiro ou nulo), `output` (texto, cortado pelo cliente em 4.000), `outputTruncated` (booleano). Limite de 8 KiB por mensagem. O servidor grava (RN-05, RN-06) e não responde nem retransmite.

## 6. Impacto e Riscos (Impact & Risks)

- **Anotação privada vazar para o estudante.** Mitigação: a serialização para estudante nunca inclui o campo; teste de handler para cada rota que devolve conteúdo (conteúdo, diário, linha do tempo).
- **"Aula atual" errada por fuso ou virada de dia.** Mitigação: cálculo no servidor em `America/Sao_Paulo` com testes de fronteira (15 minutos antes do início, início exato, fim exato, meia-noite, duas aulas no dia, aula alterada de horário).
- **Volume de comandos.** Mitigação: teto de 2.000 por sala (RN-06), saída cortada em 4.000 caracteres, lista carregada só quando a sala é expandida no diário.
- **Acoplamento entre `schedule` e `classroom`.** Mitigação: porta declarada no `schedule` e implementada em `cmd/api`, como na SPEC-053; nenhum repositório atravessa a fronteira.
- **Leitura de dentro do terminal legado** (histórico, status e saída por terminal). Mitigação: leitura de fora, no adaptador, coberta por `terminalWindow.test.ts` e pela conformidade da SPEC-030; aviso mínimo em `engine/core/terminal/` só se necessário, como a SPEC-051 autorizou.
- **Senha na gravação.** Mitigação: RN-08 e teste com `su` (a linha gravada é `su`, a saída não contém a senha).
- **Conflito com a spec de anotações do estudante** (SPEC-072). Mitigação: esta spec não toca nada do estudante (2.1); o `SessionDiary` é um componente com seções independentes, onde o caderno da SPEC-072 pode ser ligado ao diário numa revisão futura.
- **Consultas a mais na aba Agenda** (calendário, sala ativa e agora a linha do tempo, a cada 60 s). Mitigação: só com a aba visível; a linha do tempo resolve tudo numa chamada (as contagens por aula vêm numa consulta agregada).

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): A linha do tempo DEVE trazer, calculados no servidor em `America/Sao_Paulo` e só com aulas não canceladas, as 3 aulas passadas mais recentes, a aula atual (de 15 minutos antes do início até o fim; a de início mais cedo se houver mais de uma) e as 5 próximas, com os campos da seção 5.
- [x] **CA-02** (estado): ENQUANTO a turma tem sala ao vivo ativa ligada a uma aula, O SISTEMA DEVE tratar essa aula como a atual, mesmo fora do horário, e informar `liveSessionId`; ENQUANTO a sala ativa não tem vínculo, os blocos NÃO DEVEM mudar e `liveSessionId` DEVE vir mesmo assim.
- [x] **CA-03** (evento): QUANDO a docente dona ou o administrador grava o conteúdo com anotações públicas e privadas, O SISTEMA DEVE guardá-las só nessa aula, sem marcar a aula como alterada, pedir motivo nem enviar e-mail; SE passam do limite, ENTÃO DEVE recusar com 400 apontando o campo.
- [x] **CA-04** (ubíquo): As anotações privadas NUNCA DEVEM sair para o estudante, em nenhuma rota (conteúdo, diário, linha do tempo); as públicas DEVEM sair para todos que leem a aula.
- [x] **CA-05** (evento): QUANDO a janela de apresentação envia `live:terminal:command` válido, O SISTEMA DEVE gravá-lo com o momento do servidor; SE vem do painel, de estudante ou da sala de espera, ou é inválido, ENTÃO DEVE descartar com auditoria sem gravar; SE a sala já tem 2.000 comandos, ENTÃO DEVE descartar com auditoria.
- [x] **CA-06** (ubíquo): A leitura dos comandos de uma sala DEVE devolvê-los na ordem em que rodaram à docente dona, ao administrador e ao estudante com matrícula ativa, durante e depois da sala; sala de outra turma DEVE dar 404.
- [x] **CA-07** (ubíquo): A aba Agenda DEVE mostrar, abaixo do calendário, os blocos Aula atual (com a marca "Agora", ou "Começa às HH:MM" nos 15 minutos antes, e o botão certo para o papel e o estado, ou "Nenhuma aula agora" com a próxima), Aulas passadas (recolhidas, com a marca de comandos) e Próximas aulas (com o material preparatório); a consulta DEVE repetir a cada 60 s só com a aba visível e falhar em silêncio.
- [x] **CA-08** (ubíquo): O diário DEVE aparecer no painel do dia e nos cards expandidos, com as anotações públicas, as privadas só para o professor (com "Só você vê"), o conteúdo e as salas ao vivo com os comandos (terminal, linha, código de saída, saída recolhida e Copiar) carregados ao expandir.
- [x] **CA-09** (evento): QUANDO o professor conclui um comando na janela de apresentação, digitado ou pelo ▶ da SPEC-060, O SISTEMA DEVE enviá-lo uma única vez com o terminal, a linha, o código de saída e a saída cortada em 4.000 caracteres; o painel, a sala do aluno e o terminal do exercício do aluno NÃO DEVEM enviar nada; a senha digitada no `su` NÃO DEVE aparecer na linha nem na saída.
- [x] **CA-10** (ubíquo): O diálogo de conteúdo DEVE ter os campos "Anotações da aula (a turma vê)" e "Anotações privadas (só você vê)", gravados com o Salvar, com erro junto do campo; e cada um dos três editores do diálogo (a descrição e as duas anotações) DEVE ter o rótulo visível e a linha de ajuda que diz quem lê o texto, ligada ao editor por `aria-describedby`.
- [x] **CA-11** (ubíquo): `engine/core` NÃO DEVE mudar (salvo o aviso mínimo autorizado na seção 3.1, coberto pela conformidade); nada das anotações do estudante (SPEC-051) DEVE mudar; Stylelint, ESLint e `tsc` limpos; cores só dos tokens; alvos de 44 px; blocos e marcas legíveis por leitor de tela.
- [x] **CA-12** (ubíquo): Cada card da linha do tempo DEVE ter o botão que abre o diário da aula: sempre na aula atual e nas passadas; nas próximas, sempre para o professor e, para o estudante, só quando a aula tem conteúdo; o diário aberto num card, sem nada registrado, DEVE dizer "Nada registrado nesta aula ainda."
- [x] **CA-13** (evento): QUANDO o professor dono ou o administrador aciona "Conteúdo da aula" ou "Alterar esta aula" num card da linha do tempo, O SISTEMA DEVE abrir, para aquela aula, o mesmo diálogo do painel do dia do calendário e, ao salvar, DEVE ler de novo a linha do tempo e o calendário; o estudante NÃO DEVE ter esses botões.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

**Backend, `schedule/domain`:** `TestTimelineSplit` (passadas, atual, próximas; 16 e 15 minutos antes do início; início e fim exatos; meia-noite; duas aulas no dia; aula alterada; canceladas de fora) cobre CA-01; `TestTeacherNotes_Validate` (limite e HTML filtrado) cobre CA-03.

**Backend, `schedule/service` (portas de teste):** `TestTimeline_Roles` (CA-01), `TestTimeline_LiveLinkedWins` e `TestTimeline_LiveUnlinkedKeepsBlocks` (CA-02), `TestSaveContent_TeacherNotes_NotAnOverrideNoMail` (CA-03), `TestContent_PrivateNotesOnlyTeacherAndAdmin` e `TestDiary_StudentGetsNoPrivateNotes` (CA-04, CA-08).

**Backend, `schedule/repository` (PostgreSQL real):** `TestTimeline_CountsInOneQuery` (CA-01).

**Backend, `schedule/handler`:** `TestTimelineRoute`, `TestDiaryRoute`, `TestContentRoute_PrivateNotesHiddenFromStudent` (CA-01 a CA-04).

**Backend, `classroom/domain`:** `TestValidateTerminalCommand` (terminal, linha, controle, saída cortada e marcada) cobre CA-05.

**Backend, `classroom/service`:** `TestRecordCommand_ServerTimeAndOrder`, `TestRecordCommand_CapPerSession` (CA-05), `TestListCommands_RolesAndForeignSession` (CA-06).

**Backend, `classroom/handler`:** `TestTerminalCommand_PresenterOnly` (do painel, de estudante e da espera: descartado com auditoria), `TestTerminalCommand_InvalidRejected` (CA-05), `TestCommandsRoute` (CA-06).

**Backend, `classroom/repository`:** `TestCommands_OrderedByRanAt` (CA-06).

**Frontend:**

| Teste | Arquivo | Cobre |
| :--- | :--- | :--- |
| três blocos, marca Agora e "Começa às", botões por papel e estado, "Nenhuma aula agora", cards recolhidos e marca de comandos, consulta a cada 60 s só visível, falha silenciosa | `ClassTimeline.test.tsx` | CA-07 |
| botão do diário em todos os cards (próxima sem conteúdo: só o professor); "Conteúdo da aula" e "Alterar esta aula" em todos os cards do professor e em nenhum do estudante; os botões chamam o diálogo da aula certa | `ClassTimeline.test.tsx` | CA-12, CA-13 |
| seções do diário por papel, comandos ao expandir, Copiar; diário vazio diz "Nada registrado nesta aula ainda." | `SessionDiary.test.tsx` | CA-08, CA-12 |
| "Conteúdo da aula" e "Alterar esta aula" abertos pela linha do tempo, e a linha do tempo lida de novo ao salvar | `classes/[id]/page.test.tsx` | CA-13 |
| diário no painel do dia | `ClassCalendar.test.tsx` | CA-08 |
| dois campos novos, Salvar, erro junto do campo | `SessionContentForm.test.tsx` | CA-10 |
| `onCommandRun` para comando digitado e para `execute`, uma vez cada, terminal certo, status e saída; `su` sem a senha; conformidade continua passando | `engine/terminalWindow.test.ts` | CA-09, CA-11 |
| `sendTerminalCommand` só da janela de apresentação | `useLiveClassroom.test.ts` | CA-09 |
| professor envia, aluno e exercício não | `MirroredModuleView.test.tsx`, `ExerciseTerminal.test.tsx` | CA-09 |
| chamadas e erros RFC 7807 das rotas novas | `scheduleService.test.ts`, `classroomService.test.ts` | CA-01 a CA-06 |

**Manual:** como professor, gravar anotações públicas e privadas numa aula; entrar como estudante e conferir que só as públicas aparecem; iniciar a aula ao vivo pela aula do dia, digitar `ls`, `cat /etc/passwd`, executar um exemplo pelo ▶ e um `su` com senha; encerrar; no diário, conferir os comandos, a saída e o Copiar, e que a senha não está lá; esperar o horário da aula virar e ver o card passar de "Agora" para "Aulas passadas".

**Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest em modo de cobertura).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-042, 051, 053, 055, 056, 060, 067; `schedule/service/content.go` (portas `Decks` e `Modules` e `cmd/api/content_refs.go`), `schedule/service/service.go` (`readableClass`, calendário), `classroom/service/service.go` (`ListSessions`), `classroom/handler/ws.go` (tabela de tipos de mensagem, `Dropped`, o caso de `live:terminal:screen` e o do chat), `engine/terminalWindow.ts` (`execute`, `history`, `watchScreen`), `hooks/useLiveClassroom.ts`, `components/Classroom/MirroredModuleView`, `components/ClassCalendar/ClassCalendar.tsx` (`SessionContentBlock`, painel do dia), `components/SessionContentForm`, `app/app/classes/[id]/page.tsx` (aba Agenda e o aviso da sala ativa).
2. **Ordem de execução:** termos novos no `GLOSSARY.md`; testes vermelhos do backend e commit `test`; migração `00038`; `schedule` (domain da linha do tempo, repository, service com a porta, handler); `classroom` (domain do comando, repository, service, mensagem no `ws.go`, rota de leitura); composição em `cmd/api` (`diary_refs.go`); testes vermelhos do frontend e commit `test`; adaptador do terminal; `useLiveClassroom` e `MirroredModuleView`; serviços; `SessionDiary`; `ClassTimeline`; painel do dia e diálogo de conteúdo; página da turma; mensagens.
3. **Arquivos a criar ou alterar:** `backend/migrations/00038_session_diary.sql`; `backend/internal/modules/schedule/{domain,repository,service,handler}/**`; `backend/internal/modules/classroom/{domain,repository,service,handler}/**`; `backend/cmd/api/main.go` e `backend/cmd/api/diary_refs.go` (novo); `frontend/src/engine/terminalWindow.ts` e teste; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/services/scheduleService.ts` e `classroomService.ts`; `frontend/src/components/ClassTimeline/**` (novo); `frontend/src/components/SessionDiary/**` (novo); `frontend/src/components/ClassCalendar/**`; `frontend/src/components/SessionContentForm/**`; `frontend/src/components/Classroom/MirroredModuleView/**`; `frontend/src/app/app/classes/[id]/page.tsx` e teste; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md`. Nada em `StudentNotesPanel`, `live_classroom_notes` ou nas rotas de anotações da SPEC-051.
4. **Definição de pronto:** CA marcados, testes da seção 8 verdes, cobertura acima de 80%, nenhuma violação de `ARCHITECTURE.md`, `engine/core` intocado (ou só o aviso autorizado), status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (16/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | Os comandos que o professor digita na aula ao vivo são gravados no servidor e ficam no diário da aula |
| D-02 | O texto trazido é dividido em specs pequenas: esta (linha do tempo e diário), a SPEC-074 (materiais por fase) e, depois, presença e o terminal do aluno |
| D-03 | As anotações do estudante ficam fora: têm spec própria, a SPEC-072 |
| D-04 | A aula atual começa **15 minutos antes** do horário de início (era P-01) |
| D-05 | Ficam guardados até 4.000 caracteres de saída por comando e 2.000 comandos por sala (era P-02) |
| D-06 | Todo comando do professor na aula, digitado ou executado pelo ▶, fica registrado na ordem em que rodou, para o aluno replicar depois; o aluno lê a lista durante e depois da sala (era P-03) |

### Pendências

Nenhuma.

### Termos propostos para o `GLOSSARY.md`

| Português | Código (EN) | Definição |
| :--- | :--- | :--- |
| Linha do tempo da turma | `ClassTimeline` (rota `sessions/timeline`) | Os blocos Aulas passadas, Aula atual e Próximas aulas, calculados pelo servidor |
| Aula atual | `current` da linha do tempo | A aula de hoje na janela de 15 minutos antes do início até o fim, ou a ligada à sala ao vivo ativa |
| Diário da aula | `SessionDiary` (rota `sessions/{id}/diary`) | As anotações do professor, o conteúdo e as salas ao vivo com os comandos de uma aula da agenda |
| Anotações da aula (do professor) | `teacher_notes`, `teacher_private_notes` | Texto público e texto privado do professor numa aula da agenda. Não confundir com `LiveClassroomNote` (do estudante na sala) |
| Comando da aula ao vivo | `LiveTerminalCommand` (tabela `live_terminal_commands`, mensagem `live:terminal:command`) | Uma linha que o professor executou na janela de apresentação, com o terminal, o código de saída e a saída. Evitar `History` (reservado ao `CommandLog` da prova) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 16/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | Criação a partir do texto trazido pelo Tech Lead e da decisão de gravar os comandos do professor (D-01, D-02); pendências com recomendação |
| 16/10/2026 | Aruna Architect | Caderno do estudante retirado (D-03): outra pessoa faz a spec das anotações do aluno. Saem a tabela `class_session_notebooks`, as rotas de caderno, a regra do caderno na sala e a antiga P-01 |
| 16/10/2026 | Aruna Architect | Decisões do Tech Lead aplicadas: aula atual 15 minutos antes do início (D-04), limites de saída e de comandos (D-05), registro de todo comando, digitado ou pelo ▶, lido durante e depois (D-06). Sem pendências |
| 16/10/2026 | Tech Lead | Aprovada ("Aprovo"). Status: `Aprovada` |
| 16/10/2026 | Implementador | Implementada. Backend: migração `00038`, `SplitTimeline` e anotações no `schedule`, comandos no `classroom` (domain, repository, service, `live:terminal:command` no hub e rota de leitura), porta `LiveSessions` em `cmd/api/diary_refs.go`. Frontend: `onCommandRun` no adaptador do terminal (lido de fora, sem tocar `engine/core`), `sendTerminalCommand` no hook, `ClassTimeline`, `SessionDiary` (com `SessionContentView`, que o painel do dia passou a usar), campos de anotações no diálogo de conteúdo e a linha do tempo na aba Agenda. Desvios: o teste de uma consulta só das contagens ficou no repositório do `classroom` (`TestLinkedSessions_WithTheirCommandCounts`), porque o `schedule` reaproveita `ListSessions` e as contagens vêm pela porta; o teste da senha usa `passwd`, que pede a senha pelo mesmo caminho do `su`; o painel do dia, com o diário, lê o conteúdo pela leitura do diário (uma chamada), e os dois testes da SPEC-053 que conferiam o corpo exato do salvar passaram a incluir `teacherNotes` e `teacherPrivateNotes` vazios |
| 16/10/2026 | Implementador | Renumerada de SPEC-071 para SPEC-073 (e a SPEC-072 de materiais para SPEC-074), e a migração de `00037` para `00038`, ao juntar a branch com a `projeto-tcc2`: lá já existem a SPEC-071 (prática guiada em aula), a SPEC-072 (caderno dinâmico de anotações) e a migração `00037`. O conteúdo da spec não mudou |
| 16/10/2026 | Aruna Architect | Falha achada em uso pelo Tech Lead: na aba Agenda os cards da linha do tempo não tinham botão (a próxima aula sem conteúdo não abria nada) e o professor não tinha como editar a aula por eles; o "Conteúdo da aula" e o "Alterar esta aula" só existiam no painel do dia do calendário. Acrescentados as ações dos cards, o diário vazio com mensagem e os CA-12 e CA-13; volta a Aprovada |
| 16/10/2026 | Implementador | CA-12 e CA-13 implementados: um único card (`EntryCard`) para os três blocos, com o botão do diário, os botões Conteúdo da aula e Alterar esta aula do professor e, no diário aberto num card, a mensagem de nada registrado (`showEmpty`, desligada no painel do dia). Nenhum desvio |
| 16/10/2026 | Implementador | Aparência dos cards refeita a pedido do Tech Lead (data em destaque, ações agrupadas, chip da sala, caixa tracejada para o vazio, alvos de 44 px no celular); só estilo e marcação, sem mudar o comportamento nem os critérios de aceite |
| 16/10/2026 | Aruna Architect | Falha achada em uso pelo Tech Lead: os três editores do diálogo de conteúdo estavam sem rótulo na tela (o editor só tem rótulo para leitor de tela) e nada dizia quem lê cada texto. O CA-10 passa a pedir o rótulo visível e a linha de ajuda em cada editor |
| 16/10/2026 | Implementador | Rótulo visível e linha de ajuda dos três editores do diálogo implementados (CA-10): o rótulo é do formulário, não do editor, como no `ClassForm`; cada linha de ajuda é ligada ao editor por `aria-describedby`. Achado fora do escopo: o editor grava o `data-placeholder`, mas nenhum estilo nem extensão o desenha, em nenhum formulário que o usa; fica para o Tech Lead decidir |
