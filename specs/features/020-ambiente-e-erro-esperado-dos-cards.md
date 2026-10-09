# SPEC-020: Ambiente Preparado (Snapshot) e Erro Esperado nos Cards

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-020 |
| **Status** | Implementada |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (backend); tela do card e `TopicStudy` (frontend) |
| **Contexto de tela** | `/app/modules/[id]/cards/[blockId]` (autoria) e `/materials/[id]`, `/app/modules/[id]` (estudo) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-016, SPEC-019 |
| **Substitui** | Nenhuma. Realiza o "snapshot" e o "exercício" do gerador de cards do cliente que a SPEC-019 deixou de fora |
| **Fontes canônicas** | Pedido do Tech Lead de 09/10/2026 ("vamos gravar o snapshot: abrir o terminal Linux da aplicação, o usuário roda os comandos (criar pasta, arquivos, usuários, grupos, configs), e todos rodam quando a página carregar; comandos que devem dar erro são marcados como erro esperado") e as respostas dele às três perguntas desta spec (seção 10) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O gerador de cards do cliente tem uma seção de **preparação da máquina** ("snapshot"): comandos rodados no ambiente antes de o aluno clicar nos comandos da aula (criar arquivos que serão lidos com `cat`, criar usuários e grupos, deixar uma configuração pronta). A tela do card (SPEC-019) não tem isso. Hoje o ambiente do aluno é sempre o **cenário do tópico**, que só o extrator sabe produzir, e a docente não consegue preparar uma máquina para o seu card.

Há também comandos que **devem falhar de propósito** (por exemplo, `curl` para um servidor que ainda não existe). A tela de estudo os trata como qualquer outro, sem avisar o aluno nem a voz de que o erro é esperado.

## 2. Objetivos (Goals)

- Na tela do card, abrir o **terminal Linux da aplicação**, deixar a docente preparar o ambiente rodando comandos e **gravar o estado final da máquina** (pastas, arquivos, usuários, grupos, configurações, senhas e o que foi editado no nano ou no vim).
- Aplicar esse ambiente **uma vez, quando a página de estudo carrega** (resposta do Tech Lead à P-03).
- Marcar um comando prático como **erro esperado**, e mostrar isso ao aluno e à voz.

### 2.1. Fora de escopo (Non-Goals)

- Autoria dos **desafios** validados pelo servidor (questões, condições e modelos de avaliação): continuam em spec futura (resposta à P-01).
- Reexecutar comandos no aluno (resposta à P-02: grava-se o estado, não os comandos).
- Mesclar ambientes de cards diferentes: cada ambiente é uma máquina inteira (ver RN-03).
- Gravar o que se faz nos terminais 2 e 3 como comandos (o estado da máquina inclui o efeito deles, mas a lista de comandos mostrada só vem do terminal 1).
- Apagar do banco as máquinas gravadas que deixaram de ser usadas.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend

**Seção "5. Ambiente do card (snapshot)"** na tela do card, depois das caixas especiais:

- Texto de apoio: o que é o ambiente e que ele vale para o módulo inteiro a partir deste card.
- Botão **"Abrir terminal para preparar o ambiente"**: monta o terminal Linux da aplicação (o mesmo da tela de estudo) na própria tela. A máquina começa no **ambiente anterior**: o do card mais próximo antes deste que tem ambiente, ou o cenário do tópico quando não há nenhum (RN-03). Aparece "Preparando máquina…" enquanto ela carrega.
- A docente roda os comandos. Os comandos digitados no terminal 1 são listados ao lado, para consulta.
- Campo **"Resumo do cenário preparado"** (texto curto, opcional) e botão **"Gravar ambiente"**: guarda o estado da máquina e liga o ambiente ao card.
- Com o ambiente gravado, a seção mostra o resumo, a lista de comandos e os botões **"Preparar de novo"** (abre o terminal a partir do ambiente anterior, descartando o gravado ao salvar de novo) e **"Remover ambiente"**.
- O ambiente vive no cabeçalho do card; o card sem título não tem onde guardá-lo, e a seção pede o título primeiro.
- Gravar o ambiente é uma alteração do card: vale quando o card é salvo, como o resto.

**Erro esperado.** Cada comando da seção 3 do card ganha a caixa **"Erro esperado (este comando deve falhar de propósito)"**. Na tela de estudo o comando aparece com a marca **"erro esperado"**, e a voz avisa antes de rodá-lo ("Atenção: este comando vai dar erro de propósito.").

**Tela de estudo:** nada muda no fluxo. A máquina inicial e o "Reset Máquina" já vêm do cenário do tópico (SPEC-016, 5.1); passam a vir do ambiente do módulo quando ele existe (RN-04).

### 3.2. Backend (Go, módulo `content`)

- **RN-01 (gravar):** `ADMIN` e o `TEACHER` dono do módulo gravam um ambiente: o corpo traz a máquina serializada (formato `exame-so/maquina`); o servidor confere o formato, limita o tamanho a 2 MB e a guarda na tabela `scenarios` (SPEC-011), sem chave de origem. A resposta traz o `scenarioId`.
- **RN-02 (ligar ao card):** o cabeçalho do card (`TEXT` com título) pode ter o campo `environment`, com `scenarioId`, `summary` (até 500 caracteres) e `commands` (até 200 comandos de até 500 caracteres). Ao salvar o card, o `scenarioId` precisa existir (RN-13 da SPEC-019 devolve erro de campo `blocks[i].environment.scenarioId`).
- **RN-03 (ambiente anterior e efetivo):** cada ambiente é uma **máquina inteira**. O que a docente prepara num card parte do ambiente do card anterior que tem um (ou do cenário do tópico), então ele já contém o que veio antes. O ambiente **efetivo** do módulo é o do **último card ativo, na ordem, que tem ambiente**; cards inativos não contam.
- **RN-04 (entrega ao aluno):** a rota que já devolve o cenário do tópico (`GET /api/v1/modules/{id}/scenario`, SPEC-016, 5.1) devolve o ambiente efetivo quando há um, e o cenário do tópico quando não há. As regras de visibilidade do módulo (SPEC-010) valem como hoje.
- **RN-05 (ler para continuar a preparar):** `ADMIN` e `TEACHER` leem a máquina de um ambiente pelo `scenarioId` (para a docente continuar de onde o card anterior parou).
- **RN-06 (erro esperado):** o passo de `COMMAND` aceita `expectError` (booleano, padrão falso), conferido e gravado como os demais campos do passo.
- **RN-07 (segurança):** a máquina é dado, nunca código; o servidor só a guarda e devolve. Gravar vale o limite de 120 gravações por minuto por usuário (SPEC-019 5.6).

## 4. Modelo de Dados (Data Model)

Sem tabela nem migração. A máquina gravada é uma linha de `scenarios` (SPEC-011), com `source_key` nulo. O que liga o card a ela é o campo `environment` no `payload` do cabeçalho, e o `expectError` entra no passo do `COMMAND`.

## 5. Contrato de API (API Contract)

### 5.1. `POST /api/v1/teacher/modules/{id}/environments`

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `snapshot` | objeto | Sim | máquina serializada (`formato` = `exame-so/maquina`), até 2 MB |

Resposta 201: `{ "scenarioId": "<uuid>" }`. Erros: 400 `validation-error` (formato inválido), 403, 404 `module-not-found`, 413, 429.

### 5.2. `GET /api/v1/teacher/environments/{scenarioId}`

Resposta 200: `{ "scenarioId": "<uuid>", "snapshot": { ... } }`. 404 `scenario-not-found`.

### 5.3. `GET /api/v1/modules/{id}/scenario` (alterada)

Mesmo contrato da SPEC-016, 5.1. O `snapshot` passa a ser o ambiente efetivo (RN-03), ou o cenário do tópico.

### 5.4. Campos novos de payload

`TEXT` (cabeçalho): `environment: { scenarioId, summary?, commands? }`. `COMMAND`, passo: `expectError?: boolean`.

## 6. Impacto e Riscos (Impact & Risks)

- **Ambientes de cards diferentes não se somam, o último vence.** *Mitigação:* RN-03 (cada ambiente parte do anterior) e o texto da tela.
- **Editar um card do meio deixa os ambientes de trás desatualizados** (o dos cards seguintes não inclui a mudança). *Mitigação:* o aviso na tela; refazer os seguintes é decisão da docente.
- **Máquinas gravadas e não usadas ficam no banco** (cada uma cerca de 80 KB). *Mitigação:* fora de escopo agora; limpeza em spec futura.
- **O estado gravado leva a senha em texto da máquina simulada** (já é assim nos cenários do extrator, e a máquina é um brinquedo no navegador).
- **Voz e erro esperado:** um aviso a mais antes do comando. *Mitigação:* uma frase curta, só nos comandos marcados.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente abrir o terminal do ambiente na tela do card, O SISTEMA DEVE iniciar a máquina no ambiente anterior (ou no cenário do tópico) e listar os comandos que ela digitar.
- [ ] **CA-02** (evento): QUANDO a docente gravar o ambiente e salvar o card, O SISTEMA DEVE guardar o estado da máquina e ligar o ambiente ao cabeçalho do card.
- [ ] **CA-03** (evento): QUANDO o aluno abrir a página de estudo de um módulo com ambiente, O SISTEMA DEVE iniciar o terminal no ambiente efetivo, e o "Reset Máquina" DEVE voltar a ele.
- [ ] **CA-04** (estado): ENQUANTO o card com o último ambiente estiver inativo, O SISTEMA DEVE usar o ambiente do card ativo anterior, ou o cenário do tópico.
- [ ] **CA-05** (indesejado): SE a máquina enviada não tiver o formato esperado ou passar de 2 MB, ENTÃO O SISTEMA DEVE recusar com 400 ou 413 e NÃO DEVE gravar nada.
- [ ] **CA-06** (indesejado): SE um card for salvo com um `scenarioId` que não existe, ENTÃO O SISTEMA DEVE recusar o card com 400 e indicar o campo.
- [ ] **CA-07** (evento): QUANDO a docente marcar um comando como erro esperado e salvar, O SISTEMA DEVE gravar `expectError` no passo, mostrar a marca "erro esperado" ao aluno e avisar pela voz antes de rodar o comando.
- [ ] **CA-08** (indesejado): SE um `TEACHER` tentar gravar ou ler um ambiente de módulo que não é dele, ENTÃO O SISTEMA DEVE responder 403 (gravar); SE não houver sessão, 401.
- [ ] **CA-09** (ubíquo): O terminal da tela do card DEVE funcionar só com o teclado, como o da tela de estudo.

## 8. Plano de Testes (Test Plan)

- **Backend (domínio):** o campo `environment` e o `expectError` na validação dos payloads, com os limites.
- **Backend (serviço, handler, PostgreSQL real):** gravar (formato, tamanho, dono), ler, ligar ao card (id inexistente), e o ambiente efetivo (último ativo, inativo ignorado, sem ambiente cai no cenário do tópico).
- **Frontend:** o modelo do card (ambiente e `expectError` ida e volta), a seção do ambiente (abrir, gravar, remover, comandos listados), a caixa de erro esperado, a marca e a fala na tela de estudo.
- **Manual:** gravar um ambiente com `mkdir` e `useradd`, salvar, abrir a tela do aluno e conferir que a máquina nasce com eles; marcar um comando como erro esperado e ouvir o aviso.
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`; SPEC-011 (cenários), SPEC-016 (5.1 e o terminal), SPEC-019 (RN-13 e a tela do card); do código: `backend/internal/modules/content/` e `practice/`, `frontend/src/engine/terminalWindow.ts`, `components/TopicStudy/`, `components/CardBuilder/`, `lib/cardModel.ts`.
2. **Ordem:** backend (payload, gravar e ler, ambiente efetivo) com testes; modelo do card; adaptador do terminal; seção do ambiente; erro esperado; tela de estudo; testes e verificação manual.
3. **Pronto quando:** todos os CA marcados, testes passando, cobertura acima de 80%, lints e `next build` limpos, e o roteiro manual feito.

## 10. Pendências

Nenhuma em aberto. O Tech Lead respondeu em 09/10/2026:

| ID | Pergunta | Resposta |
| :--- | :--- | :--- |
| P-01 | A que "exercício" o erro esperado se refere? | Aos **comandos práticos do card** (não aos desafios validados) |
| P-02 | Como gravar o ambiente? | Guardar o **estado final da máquina** (com a lista de comandos só para consulta) |
| P-03 | Quando preparar o ambiente para o aluno? | **Uma vez, ao carregar a página** (ver RN-03 para como isso convive com cards diferentes) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a partir do pedido do Tech Lead de gravar o snapshot pelo terminal da aplicação e marcar comandos com erro esperado, e das respostas dele às três perguntas. Aprovada na mesma data |
| 09/10/2026 | Implementador (Claude) | Implementada. Backend: campo `environment` no cabeçalho e `expectError` no passo, gravar e ler ambientes (5.1 e 5.2) e `GET /modules/{id}/scenario` com o ambiente efetivo. Frontend: seção 5 da tela do card com o terminal da aplicação (comandos do terminal 1 listados, estado final gravado), caixa de erro esperado, marca e aviso de voz na tela de estudo. Verificado no navegador: dois comandos digitados no terminal (`mkdir /financeiro`, `useradd ana`), gravados e salvos com o card; a rota do aluno devolveu a máquina com os dois. A carga (`go run ./cmd/seed`) não mexe nos ambientes, que não têm chave de origem |
