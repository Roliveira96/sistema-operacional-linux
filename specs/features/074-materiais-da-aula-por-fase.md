# SPEC-074: Materiais da Aula com Visibilidade por Fase (antes, durante e depois da aula)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-074 |
| **Status** | Implementada |
| **Data de criação** | 16/10/2026 |
| **Última revisão** | 19/10/2026 (implementada) |
| **Autor** | Aruna Architect (redigida pelo Claude a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `schedule` (materiais da aula), com `platform/storage` (MinIO) e uma porta para a validação de arquivos de `classroom` |
| **Contexto de tela** | Diálogo de conteúdo da aula (SPEC-053), painel do dia do calendário, linha do tempo e diário da aula (SPEC-073) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-053 (conteúdo de cada aula), SPEC-068 (validação de arquivos por assinatura), SPEC-073 (linha do tempo, diário e a janela da aula atual), SPEC-004 (MinIO) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Texto trazido pelo Tech Lead em 16/10/2026, seção "Ciclo de vida do conteúdo e materiais da aula" (planejamento pré-aula, materiais com visibilidade condicional, liberação ao encerrar a aula ou por agendamento), e as decisões dele no mesmo dia (seção 10) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Uma aula tem **materiais de momentos diferentes**: os slides e o roteiro que o estudante pode ler antes; a lista de exercícios que só faz sentido na hora da aula; a resolução dos exercícios que **não pode** aparecer antes de a aula terminar, senão o exercício perde o sentido. Hoje a aula só tem links e uma apresentação (SPEC-053), todos visíveis o tempo todo. O professor que quer liberar a resolução depois da aula precisa lembrar de voltar ao sistema e editar o conteúdo, ou mandar por e-mail.

## 2. Objetivos (Goals)

- Cada aula da agenda tem uma **lista de materiais**: arquivo (PDF ou imagem) ou link, com título, tipo (slides, exercícios, resolução dos exercícios, referência) e **fase de visibilidade**, escolhida pelo professor: sempre, só durante a aula, só depois da aula, ou durante e depois da aula. No diálogo da aula, cada fase é uma **área** própria onde o professor **arrasta os arquivos**.
- O professor envia **quantos arquivos quiser** (até 50 por aula) como materiais: apresentações, exercícios, resoluções, o que vai valer no trabalho, documentos que só exibe na aula. A fase de cada um é escolha dele; **o arquivo que ele não classificou nasce em "Durante a aula"** (D-06).
- Todo arquivo que o estudante lê ou baixa chega **só** pelos materiais, com a regra das fases: a apresentação única da SPEC-053 sai do conteúdo da aula (D-07, D-08).
- Para projetar na aula ao vivo, o professor escolhe, **dentro da sala**, um PDF ou uma imagem dos materiais da aula (D-08).
- O **servidor decide** o que o estudante vê em cada momento, pelo relógio dele e pela janela da aula atual (SPEC-073): o estudante nunca recebe o que não está liberado, nem a existência dele.
- O que é "depois da aula" **se libera sozinho** quando a aula termina (pelo horário ou quando o professor encerra a sala ao vivo ligada à aula), por data e hora marcadas, ou na hora, pelo botão **Liberar agora**.
- Os materiais aparecem no diário, no painel do dia e na linha do tempo (SPEC-073), agrupados por fase; o professor vê também os ocultos, com a marca do motivo.

### 2.1. Fora de escopo (Non-Goals)

- Projetar um link no palco: só PDF e imagem se projetam. O envio de arquivo direto pela sala (SPEC-068) continua como é.
- Materiais da turma inteira, fora de uma aula (os links da turma da SPEC-048 continuam como são), e o `StudyMaterial` dos módulos de ensino.
- Formatos além de PDF, PNG, JPEG e WebP (D-01). Gravações de aula (não há vídeo, SPEC-051).
- Notificar o estudante quando um material é liberado. Copiar materiais entre aulas.
- Quem baixou o quê (telemetria): spec de presença, futura.
- Anotações do estudante: têm spec própria, a SPEC-072.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Diálogo de conteúdo da aula (`SessionContentForm`, professor).** Ganha a seção **Materiais**, com **quatro áreas, uma por fase**, nesta ordem: **Sempre visível**, **Só durante a aula**, **Durante e depois da aula** e **Só depois da aula**. Cada área mostra os materiais dela, na ordem do professor, e tem uma **zona de soltar arquivos**: o professor **arrasta um ou vários arquivos** para a área e cada um vira um material daquela fase. Como alternativa para quem não arrasta (teclado, celular), a zona tem o botão **Escolher arquivos**, que abre o seletor do navegador. Cada área tem também o botão **Adicionar link**, que inclui um link na fase dela.

A área onde o material foi solto define a **fase**; o **tipo** começa pela fase (Sempre visível → Slides; Só durante e Durante e depois → Exercícios; Só depois → Resolução dos exercícios) e o professor muda os dois depois. Cada material tem:

- **Título** (1 a 120 caracteres; para um arquivo, começa pelo nome dele sem a extensão);
- **Tipo:** Slides, Exercícios, Resolução dos exercícios ou Referência;
- **Fase:** Sempre, Só durante, Durante e depois ou Só depois, para passar o material de uma área para outra;
- nas fases que incluem "depois", a data e hora opcionais de liberação (por padrão, o fim da aula);
- o botão **Liberar agora** (só para material ainda oculto), **Subir**, **Descer** e **Remover**.

**Enviar arquivos (fase padrão).** No alto da seção Materiais há uma área **Enviar arquivos**, por clique ou arrastando e soltando, que aceita **vários arquivos de uma vez**. Cada arquivo entra como material na fase **Durante a aula**, com o tipo inicial dessa fase, e o professor muda a fase (e o tipo) depois, no próprio material ou passando-o para outra área. As quatro áreas por fase continuam: o arquivo solto ou escolhido dentro de uma delas entra **naquela** fase (CA-13).

**Sem apresentação no diálogo.** O diálogo não tem mais o campo **Apresentação** nem a área **Enviar PDF** da SPEC-053: todo arquivo da aula é enviado em Materiais. O painel da aula e o diário deixam de mostrar **Ver apresentação**.

**Projetar na sala ao vivo (professor).** No painel do professor da sala (`TeacherPanel`, seção Arquivos, SPEC-068), quando a sala está **ligada a uma aula** (`classSessionId`), aparece o bloco **Materiais da aula** com os materiais de arquivo (PDF e imagem) dessa aula, na ordem do professor, cada um com o título, o tipo e o botão **Projetar**. O professor vê também os que ainda estão ocultos para a turma: projetar não muda a visibilidade. **Projetar** chama a rota da seção 5 e, com a apresentação devolvida, a coloca no palco como o "Projetar" da lista de arquivos da sala. Sala avulsa não tem o bloco, e link não tem **Projetar**.

O envio de arquivo lê o arquivo no navegador e valida antes de enviar (PDF até 25 MB e até 100 páginas, sem senha; PNG, JPEG ou WebP até 10 MB), como o envio da SPEC-053 e da SPEC-068. Cada arquivo mostra o seu estado (**Enviando…**, enviado ou o erro), sem a porcentagem: o navegador não informa o avanço de um envio feito por `fetch`. Vários arquivos soltos de uma vez são enviados um depois do outro, e um recusado não impede os outros. A lista de materiais é gravada **por material** (cada envio, edição, reordenação ou remoção é uma chamada), não junto com o Salvar do conteúdo, para o arquivo grande não travar o resto. Erros aparecem junto do material.

**Onde o estudante vê (`SessionDiary` e painel do dia, SPEC-073).** A seção **Materiais** lista os materiais visíveis agora, agrupados por fase (**Sempre**, **Durante a aula**, **Depois da aula**), cada um com o ícone do tipo, o título, o tamanho (arquivo) ou o domínio (link), e a ação: **Abrir** (link, em outra aba com `rel="noopener noreferrer"`) ou **Baixar** (arquivo, por endereço assinado, obtido na hora do clique para não vencer). O estudante não vê os ocultos nem um "há N materiais ocultos".

**Onde o professor vê.** A mesma seção, com os ocultos também, cada um com a marca do motivo: **Oculto até o início da aula**, **Oculto até o fim da aula**, **Oculto até DD/MM HH:MM** ou **Oculto: a aula já terminou** (material só "durante") ou **Oculto: a aula foi cancelada**, e o botão **Liberar agora**.

**Linha do tempo (SPEC-073).** Os cards mostram a marca "N materiais" (os visíveis ao leitor) e os de **Próximas aulas** listam os materiais de "Sempre" como material preparatório.

Botões do padrão `Button`, tema único escuro, só tokens, alvos de 44 px, textos no arquivo de mensagens, navegação por teclado; a fase e o motivo de oculto são texto, não só ícone.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo `schedule`:

- **RN-01 (material):** pertence a uma aula da agenda; tem título (1 a 120), tipo (`SLIDES`, `EXERCISES`, `EXERCISE_SOLUTION`, `REFERENCE`), fase (`ALWAYS`, `DURING_CLASS`, `AFTER_CLASS`, `DURING_AND_AFTER`), posição e **exatamente uma** origem: um link https de até 2.000 caracteres, ou um arquivo no MinIO. Até **50 materiais por aula**.
- **RN-02 (arquivo):** PDF (até 25 MB, de 1 a 100 páginas, contagem informada pelo navegador) ou PNG, JPEG ou WebP (até 10 MB), conferidos **pela assinatura** do arquivo e não pelo nome ou tipo declarado, pela mesma validação da SPEC-068, usada por uma porta declarada no `schedule` e implementada em `cmd/api`. O tamanho é limitado enquanto o arquivo é lido. A chave no bucket é gerada pelo servidor (`classes/{classId}/sessions/{sessionId}/materials/{uuid}{extensão}`); o nome original fica só para exibição. Download por URL pré-assinada de 15 minutos.
- **RN-03 (quem grava):** só a docente dona e o administrador (SPEC-042 RN-08). Gravar material **não** marca a aula como alterada, não pede motivo nem envia e-mail (SPEC-053 RN-03). Pode-se gravar em aula futura, de hoje, passada ou cancelada.
- **RN-04 (quando o estudante vê):** avaliado no servidor, na leitura, em `America/Sao_Paulo`, a partir de dois momentos da aula:
  - a aula está **em andamento** quando está na janela da aula atual da SPEC-073 (de 15 minutos antes do início até o fim pelo horário, RN-01) ou quando uma sala ao vivo ligada a ela está ativa (RN-02);
  - a aula **terminou** quando uma sala ao vivo ligada a ela foi encerrada (`ended_at`), ou quando o horário de fim passou **e nenhuma sala ligada a ela está ativa**: enquanto a sala está aberta a aula não terminou, mesmo depois do horário (SPEC-067 RN-07, sala aberta é sala aberta), para a resolução dos exercícios não aparecer com o professor ainda dando a aula.

  Com isso: `ALWAYS` é sempre visível; `DURING_CLASS` só enquanto a aula está em andamento (depois, volta a ficar oculto); `AFTER_CLASS` depois que a aula terminou; `DURING_AND_AFTER` a partir de a aula entrar em andamento, sem voltar a esconder. Em qualquer fase, a **data de liberação** (`release_at`), quando marcada e já atingida, deixa o material visível daí em diante; "Liberar agora" grava `release_at` com o agora do servidor. Aula **cancelada** não entra em andamento nem termina: só `ALWAYS` e os liberados por `release_at`.

  Material não visível **não sai** na resposta ao estudante, nem como contagem.
- **RN-05 (leitura pelo professor):** a docente dona e o administrador leem todos os materiais, cada um com `visibleNow` e, quando oculto, `hiddenUntil` (`CLASS_START`, `CLASS_END`, `CLASS_OVER` para o "só durante" de aula que terminou, `CLASS_CANCELED` para a aula cancelada, ou a data e hora da liberação, quando ela marcada vem antes do momento da fase, ou quando a fase não volta mais).
- **RN-06 (exclusão):** lógica; o objeto no bucket fica. A aula excluída (avulsa apagada, SPEC-042) leva os materiais junto, logicamente.
- **RN-07 (regeneração):** a aula que tem material conta como "tem conteúdo" para a regeneração das aulas semanais (SPEC-053 RN-05) e para `hasContent`.
- **RN-08 (projetar um material):** o `classroom` declara a porta `LessonMaterials` (devolve título, chave do objeto, páginas e tipo do arquivo de um **material de arquivo** de uma aula da turma), implementada em `cmd/api` pelo serviço do `schedule`, nunca pelo repositório. Projetar cria uma apresentação da turma (`slide_decks`) com a **mesma chave de objeto** (o arquivo não é copiado), o título do material, as páginas e o `kind` pelo tipo do arquivo (PDF, ou IMAGE para PNG, JPEG e WebP); se a turma já tem uma apresentação não excluída com essa chave, **reaproveita-a**, sem gastar o limite de 100 (SPEC-053 RN-07). O material pode ser de qualquer aula da turma. A exclusão lógica de um dos dois mantém o objeto, então o outro continua abrindo. Só quem conduz a sala (docente dona e administrador) projeta.
- **RN-09 (a apresentação sai do conteúdo da aula):** a gravação e a leitura do conteúdo (SPEC-053) deixam de ter `deckId` e `deck`; a coluna `class_sessions.deck_id` fica **sem uso** (sai numa migração futura, sem perder dado agora). Aula que tinha apresentação continua com ela na lista de arquivos da sala ao vivo, mas perde a ligação com a aula. "Iniciar aula ao vivo" a partir da aula não leva apresentação: o professor projeta um material dentro da sala (RN-08).

## 4. Modelo de Dados (Data Model)

Migração `00039`. Tabela nova `class_session_materials` (material da aula):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | Identificador |
| `session_id` | uuid | Sim | FK `class_sessions` | Aula da agenda |
| `position` | smallint | Sim | de 0 a 49 | Ordem na lista |
| `title` | text | Sim | de 1 a 120 caracteres | Título |
| `kind` | text | Sim | `SLIDES`, `EXERCISES`, `EXERCISE_SOLUTION`, `REFERENCE` | Tipo |
| `visibility` | text | Sim | `ALWAYS`, `DURING_CLASS`, `AFTER_CLASS`, `DURING_AND_AFTER` | Fase (RN-04) |
| `release_at` | timestamptz | Não | | Liberação marcada ou "Liberar agora" (RN-04) |
| `url` | text | Não | https, até 2.000; nulo se arquivo | Link |
| `object_key` | text | Não | gerado pelo servidor; nulo se link | Arquivo no bucket (RN-02) |
| `content_type` | text | Não | | Tipo do arquivo gravado |
| `size_bytes` | bigint | Não | | Tamanho do arquivo |
| `file_name` | text | Não | até 255 | Nome original, só para exibir |
| `page_count` | smallint | Não | de 1 a 100 | Lâminas do PDF |
| `created_by` | uuid | Sim | FK `users` | Quem incluiu |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | Sim, Sim, Não | | Auditoria e exclusão lógica (RN-06) |

Restrição: exatamente um de `url` e `object_key` preenchido. Índice em `(session_id, position)` entre os não excluídos. Enumerações como texto `UPPER_SNAKE_CASE`.

## 5. Contrato de API (API Contract)

Todas as rotas abaixo exigem a turma e a aula existentes (404 `session-not-found` para aula inexistente ou de outra turma) e dão 403 `forbidden` a quem não pode.

**`GET /api/v1/classes/{id}/sessions/{sessionId}/materials`**: lista os materiais (RN-04, RN-05).

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa.
- **Resposta (200):** `materials`: lista na ordem, cada um com `id`, `position`, `title`, `kind`, `visibility`, `releaseAt`, `source` (`LINK` ou `FILE`), `url` (link), `fileName`, `contentType`, `sizeBytes`, `pageCount` (arquivo) e, para docente e administrador, `visibleNow` e `hiddenUntil`. Para o estudante, só os visíveis agora.

**`GET /api/v1/classes/{id}/sessions/{sessionId}/materials/{materialId}/download`**: o endereço assinado de 15 minutos de um arquivo (RN-02).

- **Papéis autorizados:** os mesmos; o estudante só para material visível agora (senão 404 `material-not-found`, sem revelar a existência).
- **Resposta (200):** `downloadUrl`, `expiresAt`.
- **Erros:** 404 `material-not-found`; 400 `not-a-file` (material de link).

**`POST /api/v1/classes/{id}/sessions/{sessionId}/materials/files`**: envia um arquivo (multipart).

- **Papéis autorizados:** docente dona e administrador.
- **Corpo:** `file`; `title`; `kind`; `visibility`; `releaseAt` (opcional); `pageCount` (obrigatório para PDF, de 1 a 100).
- **Resposta (201):** o material, como na lista.
- **Erros:** 400 `invalid-material` (extensão `field`); 400 `invalid-file`; 413 `file-too-large`; 409 `material-limit-exceeded`.

**`POST /api/v1/classes/{id}/sessions/{sessionId}/materials/links`**: inclui um link.

- **Corpo:** `url` (https); `title`; `kind`; `visibility`; `releaseAt` (opcional).
- **Resposta (201)** e **erros:** como acima, sem os de arquivo.

**`PATCH /api/v1/classes/{id}/sessions/{sessionId}/materials/{materialId}`**: edita `title`, `kind`, `visibility`, `releaseAt` (nulo limpa) e `position` (os outros se reacomodam). A origem (arquivo ou link) não muda: para trocar, remove e inclui outro. Resposta (200): o material. Erros: 400 `invalid-material`; 404 `material-not-found`.

**`POST /api/v1/classes/{id}/sessions/{sessionId}/materials/{materialId}/release`**: "Liberar agora" (RN-04): grava `release_at` com o agora do servidor. Sem corpo. Resposta (200): o material, com `visibleNow` verdadeiro. Erros: 404 `material-not-found`; 409 `already-visible`.

**`DELETE /api/v1/classes/{id}/sessions/{sessionId}/materials/{materialId}`**: exclusão lógica (RN-06). Resposta 204. Erros: 404 `material-not-found`.

**Leituras da SPEC-073:** a linha do tempo ganha, em cada aula, `materialCount` (os visíveis ao leitor); o diário ganha `materials`, a mesma lista da rota de listagem, já filtrada. **Calendário (SPEC-053):** `hasContent` passa a considerar os materiais (RN-07).

**`POST /api/v1/classes/{id}/live/decks/from-material`** (módulo `classroom`): põe um material de arquivo da turma na lista de apresentações da turma, para ser projetado (RN-08).

- **Papéis autorizados:** docente dona e administrador.
- **Corpo:** `materialId` (uuid).
- **Resposta (201 se criou, 200 se reaproveitou):** a apresentação, como no envio da SPEC-068 (`id`, `title`, `pageCount`, `kind`, `downloadUrl` assinada de 15 minutos, `createdAt`). Quem chama a põe no palco pelo mesmo comando de WebSocket do "Projetar" da SPEC-068.
- **Erros:** 400 `material-not-projectable` (o material é um link); 403 `forbidden`; 404 `material-not-found` (inexistente, excluído, ou de aula de outra turma); 409 `deck-limit-exceeded` (só quando seria criada uma apresentação nova e a turma já tem 100).

**Mudança na SPEC-053 (RN-09):** `PUT` e `GET /api/v1/classes/{id}/sessions/{sessionId}/content` deixam de ter `deckId` e `deck`.

## 6. Impacto e Riscos (Impact & Risks)

- **Resolução dos exercícios visível antes da hora.** Mitigação: a filtragem é no servidor (RN-04), com testes de fronteira (um minuto antes e depois do início da janela e do fim, sala ao vivo encerrada, liberação marcada, aula cancelada); o endereço de download do oculto responde 404 ao estudante.
- **Material "só durante" que some e confunde.** Mitigação: a opção é explícita na interface ("Durante a aula" e "Durante e depois da aula" são escolhas separadas) e o professor vê o oculto com o motivo "a aula já terminou".
- **Arquivo malicioso ou grande demais.** Mitigação: validação por assinatura e limites lidos durante o envio (SPEC-068, RN-02); chave gerada; URL de 15 minutos; link só https, aberto com `rel="noopener noreferrer"`.
- **Acoplamento com `classroom` pela validação.** Mitigação: porta declarada no `schedule`, implementada em `cmd/api` (como `content_refs.go`); o `schedule` não importa o `classroom`.
- **Fuso e virada de dia.** Mitigação: a mesma janela da aula atual da SPEC-073, em `America/Sao_Paulo`, com testes.
- **Aula com apresentação ligada antes desta revisão** perde a ligação (RN-09); as apresentações continuam na lista da sala. Mitigação: nada se apaga e o professor projeta o material pela sala.
- **Material projetado vira apresentação da turma** (a mesma chave de objeto). Mitigação: reaproveita a que já existe e só gasta o limite de 100 na primeira vez; exclusão lógica mantém o objeto.
- **Espaço no MinIO.** Mitigação: 50 materiais por aula, 25 MB por PDF e 10 MB por imagem; exclusão lógica mantém o objeto, como as apresentações.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente dona ou o administrador envia um arquivo PDF ou imagem dentro dos limites, com título, tipo e fase, O SISTEMA DEVE conferir a assinatura, gravar no bucket sob chave gerada, guardar o material na última posição e devolvê-lo; SE o arquivo não é PDF, PNG, JPEG ou WebP, ENTÃO DEVE recusar com 400 `invalid-file`; SE passa do tamanho, com 413; SE a aula já tem 50 materiais, com 409.
- [x] **CA-02** (evento): QUANDO inclui um link https com título, tipo e fase, O SISTEMA DEVE guardá-lo; SE o endereço não é https, o título é inválido ou o tipo ou a fase não existem, ENTÃO DEVE recusar com 400 apontando o campo.
- [x] **CA-03** (evento): QUANDO edita título, tipo, fase, liberação ou posição, ou remove um material, O SISTEMA DEVE aplicar só àquele material (reacomodando as posições), sem mudar a origem, sem marcar a aula como alterada, pedir motivo nem enviar e-mail; a remoção DEVE ser lógica.
- [x] **CA-04** (ubíquo): Para o estudante, O SISTEMA DEVE devolver só os materiais visíveis agora segundo a RN-04: `ALWAYS` sempre; `DURING_CLASS` só com a aula em andamento (janela da SPEC-073 ou sala ao vivo ligada ativa); `AFTER_CLASS` depois que a aula terminou (fim pelo horário ou sala ligada encerrada); `DURING_AND_AFTER` desde que a aula entrou em andamento; a liberação marcada e atingida torna visível em qualquer fase; em aula cancelada, só `ALWAYS` e os liberados; sem contagem nem endereço dos ocultos (404 no download).
- [x] **CA-05** (evento): QUANDO o professor aciona "Liberar agora" num material oculto, O SISTEMA DEVE gravar a liberação com o relógio do servidor e o material DEVE sair na próxima leitura do estudante; SE já está visível, ENTÃO DEVE responder 409.
- [x] **CA-06** (ubíquo): Para a docente dona e o administrador, a lista DEVE trazer todos os materiais com `visibleNow` e o motivo do oculto (`CLASS_START`, `CLASS_END`, `CLASS_OVER`, `CLASS_CANCELED` ou a data e hora).
- [x] **CA-07** (ubíquo): O download DEVE ser por endereço assinado de 15 minutos, com o tipo do arquivo gravado; a chave do objeto NUNCA DEVE conter o nome original.
- [x] **CA-08** (indesejado): SE quem grava não é a docente dona nem o administrador, ENTÃO O SISTEMA DEVE responder 403; SE a aula é de outra turma, 404.
- [x] **CA-09** (ubíquo): A aula com material DEVE contar como "tem conteúdo" na regeneração das aulas semanais e em `hasContent`; a linha do tempo DEVE trazer `materialCount` e o diário DEVE trazer `materials`, filtrados para o leitor.
- [x] **CA-10** (ubíquo): O diálogo de conteúdo DEVE ter a seção Materiais com **quatro áreas, uma por fase** (Sempre visível, Só durante a aula, Durante e depois da aula, Só depois da aula), cada uma com a lista dos materiais dela, Escolher arquivos (validado no navegador, com o estado Enviando…), Adicionar link, e, em cada material, título, tipo, fase, data de liberação, Liberar agora, Subir, Descer e Remover, cada ação gravada na hora, com erro junto do material.
- [x] **CA-11** (ubíquo): O diário, o painel do dia e a linha do tempo DEVEM mostrar os materiais agrupados por fase com ícone, título, tamanho ou domínio e Abrir ou Baixar (endereço obtido no clique); o professor DEVE ver também os ocultos com a marca do motivo e Liberar agora; o estudante NÃO DEVE ver nada dos ocultos.
- [x] **CA-12** (ubíquo): Stylelint, ESLint e `tsc` limpos; cores só dos tokens; alvos de 44 px; fase e motivo em texto.
- [x] **CA-13** (evento): QUANDO o professor arrasta um ou vários arquivos para uma das quatro áreas, O SISTEMA DEVE destacar a área enquanto o arquivo está sobre ela, validar cada arquivo no navegador, enviá-lo um depois do outro como material **daquela fase**, com o tipo inicial da fase e o título pelo nome do arquivo; SE um arquivo é recusado, ENTÃO DEVE mostrar o erro junto dele e seguir com os outros; arquivos soltos fora das áreas NÃO DEVEM ser abertos pelo navegador; o botão Escolher arquivos DEVE fazer o mesmo para quem não arrasta.
- [x] **CA-14** (evento): QUANDO o professor escolhe ou arrasta um ou vários arquivos para a área **Enviar arquivos** (sem escolher uma das quatro áreas), O SISTEMA DEVE enviar cada um, um depois do outro, como material da fase **Durante a aula** (`DURING_CLASS`) com o tipo inicial dessa fase e o título pelo nome do arquivo, com a mesma validação, o mesmo limite de 50 por aula e o mesmo tratamento de arquivo recusado do CA-13; o professor DEVE conseguir mudar a fase depois.
- [x] **CA-15** (ubíquo): A gravação do conteúdo da aula NÃO DEVE aceitar `deckId` e a leitura NÃO DEVE trazer `deck`, para nenhum papel (RN-09); o estudante vê arquivos só pelos materiais, filtrados pela fase (CA-04).
- [x] **CA-16** (evento): QUANDO a docente dona ou o administrador pede para projetar um material de arquivo (PDF ou imagem) de uma aula da turma, O SISTEMA DEVE criar a apresentação da turma com a mesma chave de objeto, o título, as páginas e o `kind` do arquivo, ou reaproveitar a que já tem essa chave, e devolvê-la com endereço assinado; SE o material é um link, ENTÃO DEVE recusar com 400 `material-not-projectable`; SE é inexistente, excluído ou de outra turma, com 404 `material-not-found`; SE quem pede não conduz a sala, com 403; SE a turma já tem 100 apresentações e seria criada uma nova, com 409.
- [x] **CA-17** (estado): ENQUANTO a sala ao vivo está ligada a uma aula, o painel do professor DEVE mostrar o bloco **Materiais da aula** com os materiais de arquivo da aula (inclusive os ocultos à turma) e **Projetar** em cada um, que DEVE pôr a apresentação no palco; a sala avulsa NÃO DEVE ter o bloco.
- [x] **CA-18** (ubíquo): O diálogo de conteúdo NÃO DEVE ter o campo Apresentação nem a área Enviar PDF; o painel da aula e o diário NÃO DEVEM mostrar "Ver apresentação"; "Iniciar aula ao vivo" NÃO DEVE enviar `deckId`.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

**Backend, `schedule/domain`:** `TestMaterial_Validate` (título, tipo, fase, https, uma origem só, limite de 50) cobre CA-01, CA-02; `TestMaterial_VisibleAt` (as quatro fases; um minuto antes e depois do início da janela de 15 minutos e do fim; sala ligada ativa e encerrada; "só durante" depois do fim; liberação marcada em cada fase; aula cancelada) cobre CA-04, CA-05.

**Backend, `schedule/service` (portas de teste para arquivos, salas ao vivo e armazenamento):** `TestAddFileMaterial_ClassifiesAndStoresWithGeneratedKey` (CA-01, CA-07), `TestAddFileMaterial_RejectsFormatSizeAndLimit` (CA-01), `TestAddLinkMaterial` (CA-02), `TestUpdateMaterial_ReordersAndKeepsSource` e `TestDeleteMaterial_Logical` (CA-03), `TestMaterials_NoOverrideNoMail` (CA-03), `TestListMaterials_StudentSeesOnlyVisible` e `TestDownload_HiddenIs404ForStudent` (CA-04), `TestRelease_NowAndAlreadyVisible` (CA-05), `TestListMaterials_TeacherSeesHiddenUntil` (CA-06), `TestMaterials_Permissions` (CA-08), `TestHasContent_CountsMaterials` e `TestRegenerationKeepsSessionsWithMaterials` (CA-09).

**Backend, `schedule` (CA-15 e RN-08):** `TestContentRoutes` e `TestContentRouteChecksTheRequest` (a resposta não traz `deck` e um `deckId` no corpo nem é lido), os testes do conteúdo sem apresentação em `schedule/service` e `schedule/repository`, e `TestProjectableFile` (o arquivo de um material de qualquer aula da turma, oculto ou não; link, excluído e de outra turma não).

**Backend, `classroom/service` (CA-16, porta de teste para os materiais):** `TestProjectMaterial_CreatesDeckWithSameKey`, `TestProjectMaterial_ReusesDeckOfSameKey` (não gasta o limite), `TestProjectMaterial_LinkIsNotProjectable`, `TestProjectMaterial_OtherClassOrDeletedIs404`, `TestProjectMaterial_LimitOnlyWhenNew`, `TestProjectMaterial_OnlyWhoRunsTheClass`; `classroom/repository`: `TestFindDeckByObjectKey`; `classroom/handler`: `TestProjectMaterialRoute` e `TestProjectMaterialRouteErrors` (201, 200, 400, 403, 404, 409 e os `type` da seção 5).

**Backend, `schedule/repository` (PostgreSQL real):** `TestMaterials_OneSourceConstraint`, `TestMaterials_PositionReorder`, `TestMaterials_SoftDeleteWithSession` (CA-01, CA-03, CA-06).

**Backend, `schedule/handler`:** `TestMaterialRoutes` (listar, enviar multipart, link, editar, liberar, remover, download; códigos 200, 201, 204, 400, 403, 404, 409, 413 e os `type` da seção 5) cobre CA-01 a CA-08; `TestTimelineAndDiary_CarryMaterials` cobre CA-09.

**Frontend:**

| Teste | Arquivo | Cobre |
| :--- | :--- | :--- |
| seção Materiais: quatro áreas na ordem, lista de cada fase, Escolher arquivos com validação e o estado Enviando…, link na fase da área, campos (título, tipo, fase, liberação), passar de fase, liberar, subir, descer, remover, erro junto do material | `SessionMaterials.test.tsx` (a seção) e `SessionContentForm.test.tsx` (a seção dentro do diálogo) | CA-10 |
| área Enviar arquivos: clique e arrastar, vários arquivos de uma vez em ordem, cada um entra em "Durante a aula" com o tipo inicial da fase, recusado não impede os outros, o limite de 50, e mudar a fase depois | `SessionMaterials.test.tsx` | CA-14 |
| bloco Materiais da aula no painel do professor da sala: só com sala ligada a aula, lista PDF e imagem (sem link), inclusive ocultos, Projetar chama a rota e põe no palco | `TeacherPanel.test.tsx` e `FilesPanel.test.tsx` | CA-17 |
| diálogo sem Apresentação nem Enviar PDF; painel da aula e diário sem "Ver apresentação"; "Iniciar aula ao vivo" sem `deckId` | `SessionContentForm.test.tsx`, `SessionContentView.test.tsx`, `scheduleService.test.ts` | CA-18 |
| arrastar e soltar: destaque da área, vários arquivos em ordem, fase da área e tipo inicial, recusado não impede os outros, solto fora da área não é aberto | `SessionMaterials.test.tsx` | CA-13 |
| grupos por fase, ícone, Abrir e Baixar (endereço no clique), ocultos só para o professor com o motivo, nada para o estudante | `SessionDiary.test.tsx` | CA-11 |
| "N materiais" nos cards e material preparatório nas próximas | `ClassTimeline.test.tsx` | CA-11 |
| chamadas e erros RFC 7807 | `scheduleService.materials.test.ts` | CA-01 a CA-09 |

**Manual:** numa aula de hoje, incluir um PDF "Sempre", uma lista de exercícios "Durante a aula", um roteiro "Durante e depois da aula" e a resolução "Depois da aula"; entrar como estudante 20 minutos antes e ver só o PDF; 10 minutos antes, ver a lista e o roteiro; iniciar e encerrar a sala ao vivo ligada à aula e ver a resolução aparecer e a lista sumir; noutra aula, marcar uma data de liberação e usar "Liberar agora"; conferir que o endereço de download vence em 15 minutos.

**Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest em modo de cobertura).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-053, 068, 071; `classroom/domain/upload.go` (`ClassifyUpload`, limites) e o handler do envio da SPEC-068 (leitura limitada do multipart); `platform/storage` (`PutObject`, `PresignedGetURL`); `schedule/service/content.go` e `cmd/api/content_refs.go` (portas); a regra da aula atual do `schedule/domain` (SPEC-073); `components/SessionContentForm` (envio de PDF da SPEC-053); `components/SessionDiary` e `components/ClassTimeline` (SPEC-073).
2. **Ordem de execução:** termos novos no `GLOSSARY.md`; testes vermelhos do backend e commit `test`; migração `00039`; `schedule` (domain do material e da visibilidade, repository, service com a porta de arquivos e o armazenamento, handler); composição em `cmd/api` (`material_refs.go`); `hasContent` e regeneração; linha do tempo e diário com materiais; testes vermelhos do frontend e commit `test`; serviço; seção Materiais do diálogo; materiais no diário e na linha do tempo; mensagens.
3. **Arquivos a criar ou alterar:** `backend/migrations/00039_session_materials.sql`; `backend/internal/modules/schedule/{domain,repository,service,handler}/**`; `backend/cmd/api/main.go` e `backend/cmd/api/material_refs.go` (novo); `frontend/src/services/scheduleService.ts`; `frontend/src/components/SessionContentForm/**`; `frontend/src/components/SessionMaterials/**` (novo); `frontend/src/components/SessionDiary/**`; `frontend/src/components/ClassTimeline/**`; `frontend/src/messages/pt-BR.ts`; `specs/GLOSSARY.md`.
4. **Definição de pronto:** CA marcados, testes da seção 8 verdes, cobertura acima de 80%, nenhuma violação de `ARCHITECTURE.md`, status `Implementada`.

5. **Escopo da revisão de 19/10/2026 (arquivos a criar ou alterar, além dos da lista acima):** `backend/internal/modules/classroom/**` (porta `LessonMaterials`, `ProjectMaterial` e a rota `from-material`); `backend/internal/modules/schedule/service/content.go`, `handler/**` e `domain/**` (sem `deckId` e `deck`; a porta `Decks` e `WithContentRefs` perdem o uso de apresentação); `backend/cmd/api/main.go` e `content_refs.go` (adaptador da porta nova, sem o adaptador de apresentação); `frontend/src/services/scheduleService.ts` e `classroomService.ts`; `frontend/src/components/SessionContentForm/**`, `SessionMaterials/**`, `SessionDiary/**` (`SessionContentView`), `Classroom/TeacherPanel/**` e `Classroom/FilesPanel/**`; `frontend/src/messages/pt-BR.ts`. Nenhuma migração: `class_sessions.deck_id` fica sem uso (RN-09).

## 10. Pendências para aprovação

### Decisões do Tech Lead (16/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | Só PDF e imagens por enquanto (era P-01) |
| D-02 | O professor escolhe a fase de cada material: sempre, só durante a aula, só depois da aula, ou durante e depois (era P-02) |
| D-03 | Há limite, mas acima de 20, porque a professora gosta de incluir PDFs: **50 por aula** (era P-03; o número é recomendação da Aruna Architect) |
| D-04 | Não há "gabarito" da aula; o que se libera depois da aula é a **resolução dos exercícios** (tipo `EXERCISE_SOLUTION`) |
| D-06 | (19/10/2026, a pedido do Tech Lead) O professor pode subir **n arquivos** (apresentações, resoluções, o que vai no trabalho, documentos só para a aula) e decide a fase de cada um; **todo arquivo enviado sem fase escolhida fica em "Durante a aula"** |
| D-07 | (19/10/2026) O estudante só vê arquivos pela regra das fases: a apresentação da SPEC-053 deixa de chegar a ele |
| D-08 | (19/10/2026, opção B da P-01) A apresentação sai do diálogo de conteúdo; para projetar, o professor escolhe um PDF ou uma imagem dos materiais da aula **dentro da sala ao vivo** |
| D-05 | O encerramento da sala ao vivo só libera o "depois da aula" quando a sala está **ligada** à aula (RN-04); sala avulsa não libera nada (era P-04, recomendação aceita na aprovação) |

### Pendências

Nenhuma.

### Termos propostos para o `GLOSSARY.md`

| Português | Código (EN) | Definição |
| :--- | :--- | :--- |
| Material da aula | `ClassSessionMaterial` (tabela `class_session_materials`) | Arquivo ou link de uma aula da agenda, com tipo e fase de visibilidade. Não confundir com `StudyMaterial` (material do módulo de ensino) nem com `ClassLink` (link da turma) |
| Tipo do material | `SLIDES`, `EXERCISES`, `EXERCISE_SOLUTION`, `REFERENCE` | Slides, exercícios, resolução dos exercícios e referência. Evitar `ANSWER_KEY` ("gabarito": não existe na aula) |
| Fase de visibilidade | `ALWAYS`, `DURING_CLASS`, `AFTER_CLASS`, `DURING_AND_AFTER` | Sempre; só com a aula em andamento; só depois que a aula terminou; desde que a aula entrou em andamento. Evitar `PRE_CLASS` (o "pré-aula" é o `ALWAYS`) |
| Aula em andamento / aula terminada | janela da aula atual (SPEC-073) e `CLASS_END` | Em andamento: de 15 minutos antes do início até o fim, ou com sala ao vivo ligada ativa; terminada: fim pelo horário ou sala ligada encerrada |
| Liberação | `release_at` (rota `materials/{id}/release`) | Data e hora a partir da qual o material fica visível, em qualquer fase; "Liberar agora" grava o agora do servidor |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 16/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | Criação a partir do texto trazido pelo Tech Lead (materiais com visibilidade condicional); pendências P-01 a P-04 com recomendação |
| 16/10/2026 | Aruna Architect | Decisões do Tech Lead aplicadas: só PDF e imagens (D-01); quatro fases escolhidas pelo professor, com "só durante" voltando a esconder (D-02); limite de 50 por aula (D-03); "gabarito" vira "resolução dos exercícios" (D-04); a janela da aula segue os 15 minutos antes da SPEC-073. Resta a P-04 |
| 16/10/2026 | Tech Lead | Aprovada ("Aprovo"), aceita a recomendação da P-04 (D-05). Status: `Aprovada` |
| 16/10/2026 | Implementador | Renumerada de SPEC-072 para SPEC-074 (e a SPEC-071 de linha do tempo para SPEC-073), e a migração prevista de `00038` para `00039`, ao juntar a branch com a `projeto-tcc2`, onde a SPEC-071 e a SPEC-072 já são outras specs. O conteúdo da spec não mudou |
| 16/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | O Tech Lead, ao ver o diálogo de conteúdo, apontou que a spec previa os materiais por fase mas a tela tinha só um campo de envio e nada de arrastar e soltar. Revisão: a seção Materiais passa a ter **quatro áreas, uma por fase**, cada uma com zona de **arrastar e soltar vários arquivos** e o botão Escolher arquivos (CA-10, CA-13); o tipo inicial vem da fase; o estado do envio é "Enviando…" e não uma barra de porcentagem (o `fetch` não informa o avanço). RN-04: sala ao vivo ligada ativa mantém a aula em andamento mesmo depois do horário de fim. Contrato de API: só o motivo novo `CLASS_CANCELED` no `hiddenUntil` (aula cancelada); o resto do backend sem mudança. Termos novos no `GLOSSARY.md`. Status: `Aprovada` (pelo pedido do Tech Lead) |
| 16/10/2026 | Implementador | Implementada: migração `00039`; `schedule` (domínio da visibilidade e do motivo do oculto, serviço, rotas, repositório) e `cmd/api/material_refs.go`; no frontend, `SessionMaterials` (quatro áreas com arrastar e soltar), `DiaryMaterials` e a marca "N materiais" da linha do tempo. A seção Materiais ficou num componente próprio, `components/SessionMaterials`, usado pelo diálogo. A liberação ("Liberar em") grava ao sair do campo, e não a cada tecla. Conferida com capturas de tela em 390 e 1280 px. Status: `Implementada` |
| 19/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | Revisão pedida pelo Tech Lead: o professor sobe vários arquivos e escolhe a fase de cada um, e o arquivo sem fase escolhida fica em "Durante a aula" (D-06, CA-14); o estudante só vê arquivos pela regra das fases (D-07); escolhida a opção B da P-01: a apresentação sai do diálogo e do conteúdo da aula, e a sala ao vivo projeta um PDF ou imagem dos materiais (D-08, RN-08, RN-09, CA-15 a CA-18, rota `from-material`). Volta a Rascunho; sem pendências |
| 19/10/2026 | Tech Lead | Aprovada ("Aprovado."), com a opção B da P-01 e a área geral Enviar arquivos. Status: `Aprovada` |
| 19/10/2026 | Implementador | Implementada. Backend: porta `LessonMaterials` e `ProjectMaterial` no `classroom`, rota `POST /live/decks/from-material`, `FindDeckByObjectKey`, `ProjectableFile` no `schedule` e o adaptador em `cmd/api`; `deckId` e `deck` saíram do conteúdo da aula e `DeckOfClass` e seu adaptador saíram junto. Frontend: área Enviar arquivos (fase Só durante a aula), diálogo e painel sem apresentação, bloco Materiais da aula no painel do professor da sala. Testes alterados depois do vermelho, por estarem errados ou obsoletos pela spec: `TestProjectMaterialRouteErrors` (o pedido sem login usa o token vazio, que é o 401 do validador de teste, e não um token desconhecido), `TestDeckOfClass` (removido com `DeckOfClass`), o teste de problemas do servidor do diálogo (sem o `deck-not-found`) e o ajuste de tipo do `service` do `FilesPanel.test.tsx`. Nenhum desvio da spec |
