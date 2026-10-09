# SPEC-021: Versões do Módulo e Snapshots em Camadas

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-021 |
| **Status** | Aprovada |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` e `coursemodule` (backend); tela de edição do módulo, tela do card e `TopicStudy` (frontend) |
| **Contexto de tela** | `/app/modules/[id]/edit` (abas Ambiente e Versões), `/app/modules/[id]/cards/[blockId]`, `/materials/[id]` e `/app/modules/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-010, SPEC-011, SPEC-016, SPEC-019, SPEC-020 |
| **Substitui** | Em parte a SPEC-020: o snapshot deixa de ser a imagem da máquina e passa a ser um **script de comandos** (seção 3.1). Todo o resto da SPEC-020 (erro esperado, teste do card, ordem das seções) continua |
| **Fontes canônicas** | Pedido do Tech Lead de 09/10/2026 ("o conteúdo do módulo vai ter versão; o módulo também vai ter snapshot para compartilhar entre os conteúdos; o teste do conteúdo usa o do módulo e em seguida o do material; se der problema, informar caso os snapshots deem conflito") e as respostas dele às três perguntas desta spec (seção 10) |

---

## 1. Contexto e Problema (Context & Problem Statement)

1. **Versões.** Hoje toda edição de bloco ou de card vale na hora para os estudantes. A docente não tem como montar uma mudança grande com calma, nem como voltar a um conteúdo anterior.
2. **Snapshot compartilhado.** O ambiente preparado (SPEC-020) é por card e é a imagem inteira da máquina, então um ambiente apenas **substitui** o outro. A docente quer um snapshot do **módulo**, comum a todos os cards, e os dos cards em cima dele; e quer saber quando eles **entram em conflito**.

## 2. Objetivos (Goals)

- O módulo tem **versões**: a docente edita um **rascunho** e **publica** quando quiser. O estudante só vê a versão publicada. O histórico das versões guarda o conteúdo de cada uma e permite voltar a uma antiga.
- O **snapshot** passa a ser um **script de comandos**, e existem dois níveis: o do **módulo** (comum a todos os cards) e o de cada **card**. Ao abrir a página de estudo, a máquina é preparada rodando o script do módulo e, em seguida, os dos cards, na ordem.
- O **teste do card** faz o mesmo (máquina nova, script do módulo, scripts dos cards até o testado, comandos do card) e **informa os conflitos**: o comando de um snapshot que dá erro.

### 2.1. Fora de escopo (Non-Goals)

- Versões dos dados do módulo (título, descrição, visibilidade, vigência, turmas) e das questões e desafios: continuam valendo na hora.
- Comparar duas versões lado a lado (só listar, publicar e restaurar).
- Rascunhos por docente (há um rascunho por módulo).
- Gravar o que o terminal pede no meio de um comando (senha do `passwd`, edição no nano ou no vim) sem que a docente informe as respostas do passo (RN-04).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Snapshot como script em camadas

**Formato.** Um snapshot é `{ summary, steps }`, com `steps` uma lista de `{ command, terminal?, login?, answers? }` (o mesmo passo dos comandos práticos, sem `expectError`).

**Onde fica.** O do módulo, no módulo. O de cada card, no cabeçalho dele (campo `setup`, que substitui o `environment` da SPEC-020).

**Gravar.** Em cada nível há o mesmo editor:
- botão **"Abrir terminal para preparar o ambiente"**: abre o terminal da aplicação numa máquina que já está **como o aluno a teria antes deste snapshot** (o cenário do tópico, mais os scripts das camadas anteriores, rodados em alta velocidade); a docente digita os comandos e eles entram na lista de passos do terminal 1;
- a **lista de passos** é editável: cada passo tem o comando, o terminal (1 a 3), "Avançado" (usuário, senha e respostas às perguntas do comando) e os botões de subir, descer e remover; também dá para adicionar um passo à mão;
- campo **resumo** e botão **Testar** do nível.

**Ordem das camadas** (a mesma para o aluno e para o teste): máquina do tópico, script do **módulo**, depois os scripts dos **cards ativos** na ordem em que aparecem.

**Aluno.** Quando a tela de estudo abre numa máquina nova (sem máquina salva no navegador) e em cada "Reset Máquina", o terminal mostra "Preparando máquina…", roda as camadas em alta velocidade e entrega a máquina pronta. Um passo que falha para o aluno não interrompe nada.

**Conflito.** No **teste**, um passo de snapshot que termina com erro é um **conflito**: o painel mostra de qual camada ele é (módulo ou o título do card), o comando e o que o terminal disse (por exemplo, `mkdir /financeiro` do card quando o do módulo já criou a pasta). O teste continua e lista todos os conflitos, além do resultado dos comandos do card.

### 3.2. Versões

- O que o módulo tem hoje (cards, blocos e o snapshot do módulo) é o **rascunho**. A docente o edita como sempre; o estudante **não vê** a mudança.
- **Publicar** cria a próxima **versão** (v1, v2...) com uma cópia do rascunho, uma nota opcional, o autor e a data. O estudante sempre lê a **versão mais recente**.
- **Sempre há uma versão publicada** enquanto a docente edita o rascunho (decisão do Tech Lead, 09/10/2026): um módulo novo já nasce com a **v1** publicada (vazia), as versões nunca são apagadas e restaurar nunca deixa o módulo sem publicada. O estudante nunca fica sem conteúdo por causa de uma edição em andamento.
- O módulo mostra se há **alterações não publicadas** (o rascunho é diferente da última versão).
- **Versões** (aba na edição do módulo): lista com número, data, autor, nota e quantidade de cards; a atual aparece marcada. **Restaurar** copia o conteúdo de uma versão para o rascunho (não publica); depois a docente revisa e publica se quiser.
- Quem edita vê o rascunho; o link **"Ver como o aluno"** mostra a versão publicada, e **"Ver rascunho"** mostra o rascunho.
- Os módulos que já existem recebem uma **versão 1** com o conteúdo de hoje, e a carga inicial (seed) publica uma nova versão quando muda o conteúdo de um módulo que a autoria não tocou (RN-08).

## 4. Regras de Negócio (Business Rules)

- **RN-01 (snapshot do módulo):** `ADMIN` e o `TEACHER` dono gravam o snapshot do módulo (`summary` até 500 caracteres; até 200 passos; comando até 500; até 20 respostas de até 500). Faz parte do rascunho.
- **RN-02 (snapshot do card):** o cabeçalho do card (`TEXT` com título) aceita `setup` com o mesmo formato e os mesmos limites (SPEC-019 RN-13 valida ao salvar o card). O campo `environment` da SPEC-020 deixa de existir: ao abrir um card antigo, os comandos que ele guardava viram os passos do `setup`.
- **RN-03 (camadas):** as camadas valem na ordem da seção 3.1; cards inativos não entram.
- **RN-04 (respostas):** o que o terminal pergunta no meio de um comando só pode ser reproduzido com as `answers` do passo; sem elas, o passo roda sem respostas e a docente vê o resultado no teste.
- **RN-05 (publicar):** só `ADMIN` e o `TEACHER` dono publicam. Publicar sem alterações em relação à última versão responde 409 `no-changes`. A versão guarda o conteúdo inteiro: os blocos (id, tipo, posição, conteúdo, situação ativo ou inativo) e o snapshot do módulo.
- **RN-06 (leitura):** estudantes e visitantes leem só a última versão (blocos ativos e snapshot do módulo); como todo módulo tem versão publicada (RN-11), a leitura nunca fica sem versão. `ADMIN` e o dono podem pedir o rascunho (`draft=true`). A visibilidade do módulo (SPEC-010) vale como sempre.
- **RN-07 (restaurar):** restaurar substitui os blocos do rascunho e o snapshot do módulo pelos da versão, **mantendo a identidade** dos blocos que existem nos dois (o progresso de leitura deles não se perde); os que só existem na versão são recriados com o mesmo id, e os que só existem no rascunho são removidos.
- **RN-08 (carga inicial):** a carga publica uma nova versão de um módulo quando o conteúdo carregado difere da última versão, exceto em módulo congelado (SPEC-011, RN-04a), que fica como está.
- **RN-09 (progresso):** o progresso de leitura continua por bloco. Bloco que existe numa versão e foi removido do rascunho não aceita mais progresso (a rota ignora e responde 404 `block-not-found`).
- **RN-11 (sempre publicada):** ao criar um módulo, o servidor cria a **versão 1**, vazia, já publicada, e as versões não têm rota de exclusão. Publicar exige que o rascunho seja diferente da última versão (RN-05); restaurar só mexe no rascunho.
- **RN-10 (segurança):** o snapshot é dado, nunca código executado no servidor; o servidor só o guarda e o devolve. Os limites de gravação da SPEC-019 (120 por minuto) valem.

## 5. Modelo de Dados (Data Model)

Migração 00012:

| Alteração | Descrição |
| :--- | :--- |
| `course_modules.setup` (`jsonb`, nulo) | snapshot do módulo (rascunho) |
| tabela `module_versions` | `id` (uuid), `module_id` (FK, cascata), `number` (inteiro, único por módulo), `note` (texto, até 200), `content` (`jsonb`: `{ blocks, setup }`), `content_hash` (texto), `created_by` (uuid do usuário), `created_at` |
| versão 1 dos módulos existentes | criada na própria migração a partir de `content_blocks` e do `setup` nulo, com a nota "Versão inicial" e autor o dono do módulo |

O `content_hash` é o resumo (SHA-256) do conteúdo; compara-se com o do rascunho para saber se há alterações. O campo `environment` e a tabela de máquinas gravadas pela SPEC-020 deixam de ser usados (as linhas já gravadas ficam no banco).

## 6. Contrato de API (API Contract)

- `PUT /api/v1/teacher/modules/{id}/setup`: grava o snapshot do módulo (corpo `{ summary, steps }`); resposta 200 com o snapshot. 400, 403, 404, 413, 429.
- `GET /api/v1/modules/{id}/blocks` e `GET /api/v1/teacher/modules/{id}/blocks` passam a devolver `setup` (o snapshot do módulo) além de `blocks`. O primeiro devolve a **última versão** (ou o rascunho com `?draft=true` para `ADMIN` e o dono); o segundo, sempre o rascunho.
- `GET /api/v1/teacher/modules/{id}/versions`: `{ versions: [{ number, note, createdAt, createdBy, blockCount, current }], hasUnpublishedChanges }`.
- `POST /api/v1/teacher/modules/{id}/versions`: publica (corpo `{ note? }`); 201 com a versão; 409 `no-changes`.
- `POST /api/v1/teacher/modules/{id}/versions/{number}/restore`: copia a versão para o rascunho; 200 com os blocos e o snapshot do rascunho; 404 `version-not-found`.
- Passos e `setup`: erros de validação 400 com os campos (`setup.steps[i].command` e assim por diante).

## 7. Impacto e Riscos (Impact & Risks)

- **A leitura do estudante passa a vir da versão publicada.** *Mitigação:* todo módulo tem versão 1 (na migração e na criação do módulo) e a carga inicial publica as mudanças.
- **Rodar muitos comandos ao abrir a página.** Pode atrasar a tela. *Mitigação:* alta velocidade, mensagem "Preparando máquina…" e limite de 200 passos por snapshot.
- **Reproduzir comandos perde o que o terminal pede no meio.** *Mitigação:* RN-04 e o teste, que mostra o resultado de cada passo.
- **Duas docentes editam o mesmo rascunho.** *Mitigação:* o conflito de edição por bloco (SPEC-019 RN-08) continua valendo; o rascunho é um só.
- **Publicar deixa de refletir mudanças só no rascunho do estudante que já estava lendo.** *Mitigação:* o aluno vê a nova versão na próxima abertura da tela.

## 8. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente gravar o snapshot do módulo ou do card (passos digitados no terminal, editados ou adicionados à mão), O SISTEMA DEVE guardá-lo como script de passos.
- [ ] **CA-02** (evento): QUANDO a docente abrir o terminal para preparar um snapshot, O SISTEMA DEVE iniciar a máquina como o aluno a teria antes dele (tópico mais camadas anteriores).
- [ ] **CA-03** (evento): QUANDO o aluno abrir a página de estudo numa máquina nova, e a cada "Reset Máquina", O SISTEMA DEVE rodar o script do módulo e em seguida os dos cards, na ordem, e entregar a máquina pronta.
- [ ] **CA-04** (evento): QUANDO a docente testar um card, O SISTEMA DEVE começar de uma máquina nova, rodar o snapshot do módulo, os dos cards anteriores e o do card, e só então os comandos do card.
- [ ] **CA-05** (indesejado): SE um passo de snapshot terminar com erro no teste, ENTÃO O SISTEMA DEVE listá-lo como **conflito**, dizendo a camada, o comando e o que o terminal disse, e DEVE seguir com o teste.
- [ ] **CA-06** (evento): QUANDO a docente publicar, O SISTEMA DEVE criar a próxima versão com o conteúdo do rascunho; SE não houver alterações, DEVE recusar com 409.
- [ ] **CA-07** (estado): ENQUANTO houver alterações não publicadas, O SISTEMA DEVE mostrá-lo na edição do módulo, e o estudante NÃO DEVE ver essas alterações.
- [ ] **CA-08** (evento): QUANDO a docente restaurar uma versão, O SISTEMA DEVE copiá-la para o rascunho, mantendo a identidade e o progresso dos blocos que existem nos dois, sem publicar.
- [ ] **CA-09** (ubíquo): Os módulos que já existem DEVEM ter a versão 1, e o que o estudante vê DEVE ser o mesmo de antes; um módulo novo DEVE nascer com a versão 1 publicada (vazia), e SEMPRE DEVE haver uma versão publicada enquanto o rascunho é editado.
- [ ] **CA-10** (evento): QUANDO a carga inicial mudar o conteúdo de um módulo que a autoria não tocou, O SISTEMA DEVE publicar uma nova versão dele.
- [ ] **CA-11** (indesejado): SE um `TEACHER` tentar gravar, publicar ou restaurar um módulo que não é dele, ENTÃO O SISTEMA DEVE responder 403; SE não houver sessão, 401.
- [ ] **CA-12** (evento): QUANDO a docente abrir um card antigo com `environment`, O SISTEMA DEVE mostrar os comandos dele como passos do snapshot do card.

## 9. Plano de Testes (Test Plan)

- **Backend (domínio, serviço, handler, PostgreSQL real):** validação do `setup`; publicar (primeira versão, versão seguinte, sem alterações), listar, restaurar com identidade dos blocos, leitura do estudante (última versão, sem versão, rascunho só para o dono), progresso de bloco removido, a versão 1 da migração e a carga inicial publicando.
- **Frontend:** o modelo do card e do módulo com `setup` (inclusive o card antigo), o editor de passos e o gravador, a repetição das camadas na tela de estudo, o teste em camadas com conflitos, a aba Versões e a aba Ambiente.
- **Manual:** gravar um snapshot no módulo e outro no card com um conflito proposital, testar e ver o conflito; publicar, editar, conferir que o aluno não vê o rascunho, restaurar.
- **Cobertura:** acima de 80% no escopo da spec.

## 10. Pendências

Nenhuma em aberto. O Tech Lead respondeu em 09/10/2026:

| ID | Pergunta | Resposta |
| :--- | :--- | :--- |
| P-01 | Como combinar os snapshots? | **Scripts de comandos em camadas**; conflito é um comando que falha por causa de outra camada |
| P-02 | O que a versão deve fazer? | **Publicar versões (rascunho e publicada)** |
| P-03 | O que o aluno recebe? | **Módulo, depois todos os cards em ordem**, e o teste faz o mesmo até o card testado |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a partir do pedido do Tech Lead de versionar o módulo e de ter um snapshot do módulo compartilhado com os cards, e das respostas dele às três perguntas. Aprovada na mesma data |
| 09/10/2026 | Tech Lead | Regra acrescentada: sempre há uma versão publicada enquanto outra (o rascunho) é editada. Incluídas a RN-11 (a v1 nasce com o módulo) e o ajuste da CA-09 |
