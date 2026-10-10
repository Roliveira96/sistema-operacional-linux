# SPEC-022: Exercícios do Card e Snapshot do Grupo de Exercícios

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-022 |
| **Status** | Aprovada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Implementador (Claude), a partir da especificação do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (backend); tela do card, tela de estudo e preview (frontend) |
| **Contexto de tela** | `/app/modules/[id]/cards/[blockId]` (aba Exercícios), `/app/modules/[id]` e `/materials/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-016, SPEC-019, SPEC-021 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Especificação "Modelagem de Exercícios e Fluxo de Snapshot" enviada pelo Tech Lead em 10/10/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

A tela do card tem as abas Descrição, Comandos, Dicas e Exercícios (SPEC-019), mas a aba **Exercícios** ainda só diz "em breve". A docente quer cadastrar, em cada card, atividades para o estudante praticar o que viu, com um enunciado, um nível de dificuldade e dicas que o estudante pede quando precisar. Cada grupo de exercícios pode precisar de uma máquina num estado próprio (pastas, arquivos, usuários), que hoje só os snapshots do módulo e do card (SPEC-021) oferecem.

## 2. Objetivos (Goals)

- Cada card tem um **grupo de exercícios**: uma lista ordenada de **exercícios**, cada um com título, dificuldade, descrição, dicas, a **solução gravada pela docente no terminal** ("como fazer") e as **condições de finalização**.
- Um exercício pode ser feito de várias formas; **o que importa é como ele termina**. O exercício é dado como concluído quando a máquina do estudante cumpre as condições de finalização (por exemplo "a pasta existe", "o arquivo tem este texto", "o usuário existe"), seja qual for o caminho que ele seguiu.
- O grupo tem um **snapshot** opcional, o estado base da máquina antes de o estudante começar os exercícios do grupo. Ele é gravado por grupo, nunca por exercício.
- A docente grava o snapshot do grupo no terminal da aplicação, numa máquina que já está com o snapshot do módulo e o do conteúdo (card) aplicados.
- O estudante vê os exercícios no card, em ordem, e pede as dicas quando quiser.

### 2.1. Fora de escopo (Non-Goals)

- Nota e correção no servidor: a conferência das condições é só na tela do estudante e não vale nota (a prática com correção continua sendo a da SPEC-014, com `Question`).
- Exibir dica por gatilho de dificuldade (por exemplo, depois de erros seguidos): nesta spec a dica só aparece sob demanda.
- Executar o comando de referência da dica no terminal do estudante com um clique.
- Mais de um grupo de exercícios por card.
- Reordenar os exercícios arrastando (usa-se subir e descer).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend

**Aba Exercícios do card (docente).**
- Lista de exercícios, cada um recolhível, com: título (obrigatório), dificuldade (fácil, médio ou difícil), descrição (editor visual, como o texto do card) e dicas.
- Cada exercício tem um bloco **"Como fazer (solução)"**: a docente clica em **"Mostrar no terminal"**, a aplicação monta a máquina (o snapshot do módulo, o dos cards anteriores, o do card, o do grupo e as soluções dos exercícios anteriores) e libera o terminal; a docente **faz o exercício** e, em **"Usar estes comandos"**, o que ela fez é gravado como a solução do exercício, no mesmo formato do snapshot (comandos e arquivos, com o texto de editores guardado como arquivo). Ao mesmo tempo, a aplicação compara a máquina de antes com a de depois e propõe as **condições de finalização**: o que passou a existir, mudou ou deixou de existir (pastas, arquivos e seu texto, permissões, donos, links, usuários e grupos). A docente vê a lista, remove o que não importa e pode trocar "o texto é igual" por "o texto contém". Dá para regravar.
- Cada dica tem um texto e, se a docente quiser, um **comando de referência**. Há botões para adicionar, subir, descer e remover exercícios e dicas.
- Bloco **Snapshot do grupo de exercícios** (opcional), com o mesmo editor de passos e de arquivos dos outros snapshots (SPEC-021), e o botão **"Gravar no terminal"**:
  1. a aplicação monta a máquina base rodando, em ordem, o snapshot do **módulo** e o snapshot do **conteúdo** (o dos cards anteriores e o deste card), mostrando "Preparando a máquina…";
  2. pronta a máquina, libera o terminal para a docente trabalhar nela;
  3. ao confirmar com **"Usar estes comandos"**, o estado final é comparado com o da máquina base e vira o snapshot do grupo (comandos e arquivos), que é salvo junto com o card em **Salvar card**.
- Sem exercícios e sem snapshot, a aba não grava nada no card. Cadastrar exercícios sem gravar snapshot é permitido.
- O preview ao vivo mostra os exercícios como o estudante os verá.

**Tela de estudo (estudante).** Depois do conteúdo do card aparece **Exercícios**, com cada exercício mostrando título, nível, descrição e o botão **"Mostrar dica"**, que revela uma dica de cada vez ("Dica 1 de 3"). O comando de referência de uma dica aparece como um comando copiável. Quem não pede dica não vê nenhuma. Depois das dicas há **"Ver como o professor fez"**, que mostra os comandos da solução gravada, também sob demanda. O botão **"Verificar meu exercício"** confere as condições de finalização na máquina do estudante e diz o que ainda falta; ao cumprir todas, o exercício fica marcado como concluído (guardado no navegador).

**Testar comandos (docente).** O botão **"Testar comandos"** do card, e o teste do módulo (SPEC-021), passam a testar também o **snapshot do grupo** e os **exercícios**. Numa máquina nova, roda: o snapshot do módulo, os dos cards anteriores, o do card, o do grupo de exercícios; depois os comandos práticos do card; e por fim, exercício por exercício e na ordem, a **solução gravada** de cada um, conferindo ao fim de cada exercício se as **condições de finalização** foram cumpridas. Cada comando precisa terminar sem erro; o painel mostra o resultado de cada um, sob o nome do exercício, e um snapshot do grupo que dê erro é um conflito, como nos demais.

**Camadas de snapshot.** A ordem em que a máquina do estudante é preparada (e a do teste) passa a ser: módulo; e, para cada card ativo, o snapshot do card e em seguida o do seu grupo de exercícios.

### 3.2. Backend

O grupo de exercícios é um bloco novo, de tipo `EXERCISES`, no fim do card. Ele segue o que já vale para os blocos (SPEC-019): salvar o card inteiro de uma vez, conflito de edição por bloco, inativar com o card, versões do módulo (SPEC-021) e limite de gravação. Não há rota nova.

## 4. Regras de Negócio (Business Rules)

- **RN-01 (catálogo):** o catálogo de tipos de bloco ganha `EXERCISES` (SPEC-011). Um card tem no máximo um bloco `EXERCISES`.
- **RN-02 (exercício):** `title` é obrigatório (até 200 caracteres); `difficulty` é `EASY`, `MEDIUM` ou `HARD`; `description` é HTML filtrado como o do texto do card (até 50000 caracteres) e pode ser vazia; até 10 dicas.
- **RN-03 (dica):** `text` obrigatório (até 1000 caracteres); `command` opcional (até 500 caracteres).
- **RN-04 (grupo):** até 30 exercícios por grupo. O grupo precisa ter ao menos um exercício **ou** um snapshot; um bloco sem nenhum dos dois é recusado.
- **RN-05 (snapshot do grupo):** mesmo formato e mesmos limites do snapshot da SPEC-021 (passos e arquivos), validado ao salvar o card.
- **RN-06 (ordem das camadas):** a de RN da seção 3.1; cards inativos não entram.
- **RN-07 (dica sob demanda):** o estudante só vê uma dica depois de pedi-la, uma por vez e na ordem; o servidor entrega todas as dicas no card (a ordem de exibição é da tela).
- **RN-09 (teste):** a solução gravada de cada exercício entra no teste do card e no do módulo, depois dos comandos práticos do card e na ordem dos exercícios; o exercício sem solução não é testado. O comando de referência de uma dica só é mostrado, não testado. O selo de "testado" do card e o do módulo passam a depender também dos exercícios e do snapshot do grupo.
- **RN-11 (condições de finalização):** `conditions` é uma lista (até 100 por exercício) de condições sobre o estado final da máquina. Tipos: pasta existe, arquivo existe, caminho não existe, texto do arquivo (igual ou contém), permissão, dono, link para um destino, usuário existe, grupo existe, usuário está no grupo. Cada tipo tem seus campos obrigatórios (caminho absoluto, e assim por diante). A conferência é feita na tela, sobre a máquina do estudante; o servidor só valida e guarda.
- **RN-12 (concluído):** o exercício está concluído quando **todas** as condições valem. Um exercício sem condições não tem como ser conferido e a tela do estudante não oferece o botão. A solução gravada é uma das formas de chegar lá, não a única.
- **RN-10 (solução):** `solution` é opcional, tem o formato do snapshot da SPEC-021 (passos e arquivos, mesmos limites) e é validada ao salvar o card. É gravada a partir da máquina das camadas mais as soluções dos exercícios anteriores, e guarda só o que a docente fez.
- **RN-08 (gravação do snapshot):** a máquina base é a das camadas anteriores mais o snapshot do card; o snapshot do grupo guarda só o que mudou em relação a ela, como no ambiente do módulo (SPEC-021, exatidão).

## 5. Modelo de Dados (Data Model)

Não há tabela nova; há **uma migração** que acrescenta `EXERCISES` aos tipos aceitos da coluna do tipo do bloco.

Payload do bloco `EXERCISES`:

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `items` | lista | Sim (pode ser vazia se houver `setup`) | até 30 | Exercícios, na ordem |
| `items[].title` | texto | Sim | até 200 | Título |
| `items[].difficulty` | enumeração | Sim | `EASY`, `MEDIUM`, `HARD` | Nível definido pela docente |
| `items[].description` | HTML | Não | até 50000, filtrado | Enunciado |
| `items[].solution` | snapshot | Não | RN-10 | Como fazer, gravado no terminal |
| `items[].conditions` | lista | Não | até 100, RN-11 | Estado final que conclui o exercício; campos: `kind`, e conforme o tipo `path`, `content`, `match` (`equals` ou `contains`), `mode`, `owner`, `group`, `target`, `name`, `user` |
| `items[].hints` | lista | Não | até 10 | Dicas, na ordem em que o estudante as pede |
| `items[].hints[].text` | texto | Sim | até 1000 | Texto da dica |
| `items[].hints[].command` | texto | Não | até 500 | Comando de referência |
| `setup` | snapshot | Não | RN-05 | Estado base do grupo |

## 6. Contrato de API (API Contract)

Sem endpoint novo. O bloco `EXERCISES` viaja nas rotas de blocos e de card da SPEC-019 (`PUT /api/v1/teacher/modules/{id}/cards` e as de bloco) e na leitura do estudante (`GET /api/v1/modules/{id}/blocks`). Erros de validação: 400 com os campos (`items[i].title`, `items[i].hints[j].text`, `setup.files[k].path` e assim por diante).

## 7. Impacto e Riscos (Impact & Risks)

- **Tipo de bloco novo.** Telas e leitores que listam tipos precisam conhecê-lo. *Mitigação:* o bloco desconhecido já é preservado como está no editor de card; a tela de estudo e o preview o desenham.
- **Snapshot por grupo aumenta as camadas.** *Mitigação:* mesmas regras de velocidade e limites da SPEC-021.
- **A dica fica no card inteiro que o servidor entrega.** O estudante que abrir a rede do navegador vê todas as dicas. *Mitigação:* aceito; as dicas não são respostas e o exercício não vale nota.

## 8. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente salvar um card com exercícios, O SISTEMA DEVE guardá-los no bloco `EXERCISES` do card, na ordem, com título, dificuldade, descrição e dicas.
- [ ] **CA-02** (indesejado): SE um exercício não tiver título, ou tiver dificuldade inválida, ou um grupo não tiver exercício nem snapshot, ENTÃO O SISTEMA DEVE recusar com 400 e apontar o campo.
- [ ] **CA-03** (evento): QUANDO a docente abrir a aba Exercícios, O SISTEMA DEVE listar os exercícios do card e permitir adicionar, editar, subir, descer e remover exercícios e dicas.
- [ ] **CA-04** (opcional): A docente PODE cadastrar exercícios sem gravar snapshot do grupo.
- [ ] **CA-05** (evento): QUANDO a docente gravar o snapshot do grupo, O SISTEMA DEVE montar a máquina com o snapshot do módulo e o do conteúdo, liberar o terminal e, ao confirmar, guardar o estado final como snapshot do grupo.
- [ ] **CA-06** (evento): QUANDO o estudante abrir o card, O SISTEMA DEVE mostrar os exercícios em ordem e SOMENTE revelar uma dica quando ele pedir, uma de cada vez.
- [ ] **CA-07** (ubíquo): A máquina do estudante e a do teste DEVEM ser preparadas na ordem: módulo, e para cada card o snapshot do card e o do seu grupo de exercícios.
- [ ] **CA-11** (evento): QUANDO a docente gravar a solução, O SISTEMA DEVE propor as condições de finalização a partir do que mudou na máquina; QUANDO o estudante clicar em "Verificar meu exercício", O SISTEMA DEVE dizer quais condições ainda faltam e, se todas valerem, marcar o exercício como concluído, qualquer que seja a forma como foi feito.
- [ ] **CA-10** (evento): QUANDO a docente gravar a solução de um exercício, O SISTEMA DEVE montar a máquina, liberar o terminal e guardar o que ela fez como a solução daquele exercício; o estudante PODE ver essa solução sob demanda.
- [ ] **CA-09** (evento): QUANDO a docente clicar em "Testar comandos", O SISTEMA DEVE montar a máquina com o snapshot do grupo e rodar os comandos do card e a solução gravada de cada exercício, apontando o exercício de cada resultado e o conflito do snapshot do grupo, se houver.
- [ ] **CA-08** (evento): QUANDO a docente publicar o módulo, a versão DEVE incluir os exercícios e os snapshots dos grupos.

## 9. Plano de Testes (Test Plan)

- **Backend:** validação do bloco `EXERCISES` (campos, limites, dificuldade, dicas, snapshot), migração aceitando o tipo, salvar card com o bloco e publicar versão com ele (PostgreSQL real).
- **Frontend:** modelo do card com `exercises` (ler e montar o bloco), aba Exercícios (adicionar, editar, mover, remover, dicas, erros), gravação do snapshot do grupo (camadas anteriores, terminal liberado, estado final), exibição ao estudante com dica sob demanda, ordem das camadas na tela de estudo e no teste.
- **Manual:** cadastrar exercícios com e sem snapshot, gravar um snapshot de grupo, abrir como estudante e pedir dicas.
- **Cobertura:** acima de 80% no escopo da spec.

## 10. Pendências

Nenhuma em aberto. As decisões de modelagem abaixo foram tomadas pelo Implementador e valem salvo ajuste do Tech Lead:

| ID | Decisão |
| :--- | :--- |
| D-01 | O grupo de exercícios é um bloco `EXERCISES` do card (e não uma tabela nova), para herdar salvamento, versões e inativação |
| D-02 | Dificuldade em três níveis: `EASY`, `MEDIUM`, `HARD` |
| D-03 | A dica só aparece sob demanda; o gatilho por dificuldade fica para uma spec futura |
| D-04 | O snapshot do grupo entra nas camadas logo depois do snapshot do próprio card |
| D-05 | No teste, as soluções rodam depois dos comandos práticos do card, na mesma máquina e na ordem dos exercícios, como o estudante os encontraria |
| D-07 | As condições de finalização são deduzidas da comparação entre a máquina antes e depois da gravação e conferidas na tela do estudante (sem endpoint novo e sem nota) |
| D-06 | A solução de um exercício é gravada a partir da máquina que já tem as soluções dos exercícios anteriores |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação a partir da especificação enviada pelo Tech Lead e aprovada por ele na mesma data para implementação |
| 10/10/2026 | Tech Lead | Pedido: o "Testar comandos" deve testar o snapshot do grupo e os exercícios. Incluídos RN-09, CA-09 e a decisão D-05; o comando de referência da dica deixa de ser fora de escopo no teste |
| 10/10/2026 | Tech Lead | Pedido: um exercício pode ser feito de várias formas e o que importa é a finalização. Incluídos as condições de finalização (RN-11, RN-12), a decisão D-07, o CA-11 e o botão "Verificar meu exercício"; a solução gravada passa a ser uma das formas de chegar lá |
