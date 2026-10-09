# SPEC-019: Autoria dos Blocos de Conteúdo dos Módulos de Ensino

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-019 |
| **Status** | Rascunho |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (backend); tela de edição do módulo e editor de blocos (frontend) |
| **Contexto de tela** | `/app/modules/[id]/edit` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-010, SPEC-011, SPEC-012, SPEC-016 |
| **Substitui** | Nenhuma. Realiza a "autoria" que as SPECs 011 e 012 deixaram para depois |
| **Fontes canônicas** | Reclamação do cliente relatada pelo Tech Lead em 09/10/2026 ("no painel admin o cliente não está conseguindo atualizar os módulos de ensino com os blocos de cada conteúdo"); seção 4 da SPEC-011 (modelo de blocos) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O conteúdo didático da plataforma vem do protótipo e foi carregado no banco por um comando de carga (SPEC-011). Cada módulo de ensino é feito de **blocos** em ordem: textos, comandos para executar no terminal, dicas, curiosidades, passos, cartões, componentes interativos e HTML legado. É o que o estudante lê e executa na tela de estudo (SPEC-016).

Hoje o painel administrativo só edita os **dados do módulo** (título, descrição, visibilidade, status, vigência e turmas) e a **ordem dos exercícios**. Não existe nenhuma tela nem rota para criar, alterar, remover ou reordenar os blocos. A SPEC-011 (seção 2.1) e a SPEC-012 (seção 2.1) deixaram a autoria de blocos de fora de propósito. Resultado: o administrador e as docentes não conseguem corrigir um texto, acrescentar um comando ou reorganizar um módulo sem pedir uma nova carga ao desenvolvedor, e é essa a reclamação do cliente.

Há ainda uma preparação pronta no banco: toda tabela de conteúdo já tem a marca `edited_by_teacher_at`, "marcada pelas futuras telas de autoria" (SPEC-011), e a carga inicial já preserva o que foi editado.

## 2. Objetivos (Goals)

- Permitir que `ADMIN` (qualquer módulo) e `TEACHER` (só os seus) **listem, criem, editem, removam e reordenem** os blocos de um módulo, na própria tela de edição do módulo.
- Oferecer um editor adequado a cada um dos tipos de bloco do catálogo da SPEC-011, com **pré-visualização** idêntica ao que o estudante vê.
- Garantir que o que se grava é seguro e válido: HTML filtrado no servidor, estrutura de cada tipo conferida, limites de tamanho.
- Marcar todo bloco alterado como editado (`edited_by_teacher_at`), de modo que a carga inicial nunca sobrescreva a edição.
- Evitar que duas pessoas apaguem o trabalho uma da outra sem perceber (conflito de edição).
- Usar **um editor visual (WYSIWYG)** para todo texto formatado: o das caixas de texto dos blocos e o da **descrição e ementa do módulo**, que hoje é uma caixa de texto simples (decisão do Tech Lead, 09/10/2026).

### 2.1. Fora de escopo (Non-Goals)

- Autoria de **questões**, cenários e modelos de avaliação (spec futura).
- Criação de novos componentes interativos (`WIDGET`): só os dois existentes (`PERMISSION_CALCULATOR` e `LS_ANATOMY`) podem ser escolhidos.
- Envio de imagens ou arquivos para dentro dos blocos.
- Histórico de versões, desfazer e restaurar.
- Edição simultânea em tempo real e bloqueio de edição por outra pessoa.
- Importar e exportar módulos inteiros.
- Mudar a carga inicial (`seed`) ou o formato do manifesto.
- Alterar o `legacy/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Tela de edição do módulo (`/app/modules/[id]/edit`):** ganha uma terceira seção, **"Conteúdo do módulo"**, abaixo dos dados do módulo e da ordem dos exercícios.

- **Lista de blocos:** um cartão por bloco, na ordem real, com a etiqueta do tipo (Texto, Comando, Dica, Curiosidade, Passo a passo, Cartões, Componente, HTML), um resumo do conteúdo, a marca "editado" quando houver, e os botões **Editar**, **Subir**, **Descer** e **Remover**. A reordenação funciona também pelo teclado.
- **"+ Adicionar bloco":** menu com os tipos; o bloco novo entra no fim, ou logo depois do bloco escolhido.
- **Editor do bloco** (painel ao lado ou abaixo do cartão), por tipo:

| Tipo | Campos do editor |
| :--- | :--- |
| Texto | título (opcional), rótulo curto do card (opcional) e o texto formatado |
| Comando | lista de passos; cada passo tem comando, explicação, explicação da saída, terminal (1 a 3), usuário e senha para o terminal 2 ou 3 e respostas às perguntas do comando; passos podem ser reordenados e removidos |
| Dica | variante (Dica ou Atenção), título e texto formatado |
| Curiosidade | título e texto formatado |
| Passo a passo | lista de passos em texto simples |
| Cartões | lista de cartões, cada um com título e texto |
| Componente | escolha entre a calculadora de permissões e a anatomia do `ls -l` |
| HTML | código HTML (tipo legado, avançado) |

- **Pré-visualização:** ao lado do editor, o bloco é mostrado com os mesmos componentes da tela de estudo (SPEC-012 e SPEC-016), atualizando enquanto se digita.
- **Gravação:** botão **Salvar bloco**, por bloco. Enquanto grava, mostra "Salvando…"; ao terminar, mostra "Bloco salvo". Erros de validação aparecem no campo que falhou. Quem sair com alterações não salvas recebe um aviso.
- **Remoção:** pede confirmação e avisa que o progresso de leitura dos estudantes naquele bloco será apagado.
- **Conflito:** se outra pessoa alterou o bloco depois que ele foi aberto, a gravação é recusada e a tela oferece **recarregar o bloco** ou **gravar por cima** (ver P-04).
- **Estados:** carregando, módulo sem blocos ("Este módulo ainda não tem blocos. Adicione o primeiro."), erro com tentativa de novo.
- **Editor visual (WYSIWYG):** o texto formatado é escrito em um editor visual, em que o autor vê o resultado enquanto escreve, sem digitar HTML. A barra do editor oferece negrito, itálico, código em linha, bloco de código, títulos, listas com marcadores e numeradas, citação, link, tabela simples e desfazer e refazer. O mesmo editor é usado nos campos de texto formatado dos blocos (Texto, Dica, Curiosidade e as explicações dos comandos) e na **descrição e ementa do módulo**. Funciona pelo teclado, com os atalhos de costume (Ctrl+B, Ctrl+I), e os botões têm nome acessível. O tipo HTML legado continua com a caixa de código, por ser avançado.
- **Descrição e ementa do módulo:** na tela de edição, a caixa "Descrição e Ementa" passa a ser o editor visual. A descrição continua obrigatória. Os textos já cadastrados (texto simples, no formato "comandos — resumo") abrem no editor sem perda. Nos cartões de módulo, na página de materiais e no subtítulo da tela de estudo, a descrição é mostrada como **texto simples**, extraído do conteúdo formatado, para o layout dos cartões e as etiquetas de comandos continuarem como estão (ver P-07).
- **Acesso:** a seção só aparece para quem pode editar o módulo (`ADMIN`, ou `TEACHER` dono). Os textos de interface ficam no arquivo de mensagens, em português, e o estilo usa só os tokens de `_tokens.scss`.

### 3.2. Backend (Go — Camada de Módulo/Service)

Handler, service e repository no módulo `content`, reaproveitando a validação e o filtro de HTML da SPEC-011.

- **RN-01 (autorização):** `ADMIN` edita os blocos de qualquer módulo; `TEACHER` só os de módulos que ele criou. Qualquer outro papel recebe 403, e visitante recebe 401.
- **RN-02 (tipo válido):** o tipo é um dos oito do catálogo; o tipo de um bloco existente não muda (para mudar, remove-se e cria-se outro).
- **RN-03 (estrutura por tipo):** cada tipo exige os seus campos, conferidos no servidor:
  - `TEXT`, `TIP`, `CURIOSITY`, `LEGACY_HTML`: texto formatado obrigatório; `TIP` com variante `DEFAULT` ou `WARNING`;
  - `COMMAND`: de 1 a 50 passos, cada um com comando obrigatório; terminal de 1 a 3; usuário e senha juntos ou nenhum;
  - `STEP_BY_STEP`: de 1 a 50 passos de texto;
  - `CARDS`: de 1 a 30 cartões, cada um com título e texto;
  - `WIDGET`: componente de uma lista fechada.
- **RN-04 (HTML seguro):** todo campo de HTML passa pelo mesmo filtro da carga inicial (SPEC-011, RN-08) antes de ser gravado; o que for removido é descartado em silêncio e o resultado filtrado é devolvido ao editor.
- **RN-05 (limites):** cada campo de texto tem tamanho máximo (texto formatado: 50.000 caracteres; comando: 500; explicação: 1.000); acima disso a gravação é recusada.
- **RN-06 (posição):** a posição de um bloco novo é a última, ou a seguinte à do bloco indicado, deslocando os seguintes; reordenar e remover mantêm as posições sequenciais de 1 a N, em uma única transação (as posições únicas são adiáveis, SPEC-011).
- **RN-07 (marca de edição):** criar ou alterar um bloco grava `edited_by_teacher_at`; reordenar marca os blocos que mudaram de posição; a carga inicial preserva esses blocos (SPEC-011).
- **RN-08 (conflito):** a alteração de um bloco leva o instante da última alteração que o editor conhece; se o bloco mudou desde então, a resposta é 409.
- **RN-09 (remoção):** a remoção é definitiva e apaga em cascata o progresso de leitura dos estudantes naquele bloco (SPEC-016); não há lixeira (ver P-02).
- **RN-11 (descrição do módulo):** a descrição do módulo, ao ser criada ou alterada (SPEC-010), passa pelo mesmo filtro de HTML das RN-04; continua obrigatória (não vazia depois de remover a marcação) e tem o limite de 20.000 caracteres. Descrições antigas em texto simples continuam válidas.
- **RN-10 (log):** erros são registrados uma vez, na borda, sem o conteúdo do bloco; criação, alteração, remoção e reordenação geram registro de auditoria com autor, módulo, bloco e instante (ARCHITECTURE, seção 2).

## 4. Modelo de Dados (Data Model)

Nenhuma tabela nova. A tabela `content_blocks` (SPEC-011) já tem tudo o que a autoria usa:

| Campo | Uso nesta spec |
| :--- | :--- |
| `id`, `module_id` | identificam o bloco e o módulo; o módulo não muda |
| `source_key` | vazio para blocos criados pela autoria; a carga inicial só mexe nos blocos que têm chave |
| `block_type` | um dos oito tipos; não muda depois de criado |
| `position` | de 1 a N, única por módulo, adiável |
| `payload` | conteúdo do bloco, validado por tipo (RN-03) |
| `edited_by_teacher_at` | gravado em toda criação e alteração (RN-07) |
| `updated_at` | base da checagem de conflito (RN-08) |

O progresso de leitura (`block_progress`) já apaga em cascata quando o bloco é removido. O registro de auditoria usa o mecanismo existente (a confirmar na P-05). Sem mudança de schema, sem migração.

## 5. Contrato de API (API Contract)

Todas as rotas exigem sessão com senha já trocada. Papéis: `ADMIN` e `TEACHER` (dono do módulo).

### 5.1. `GET /api/v1/teacher/modules/{id}/blocks`

Blocos completos do módulo, em ordem.

| Campo da resposta | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `moduleId` | UUID | Sim | |
| `blocks` | lista | Sim | cada item com `id`, `type`, `position`, `payload`, `edited` (booleano) e `updatedAt` |

### 5.2. `POST /api/v1/teacher/modules/{id}/blocks`

Cria um bloco.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `type` | texto | Sim | um dos oito tipos |
| `payload` | objeto | Sim | estrutura do tipo (RN-03) |
| `afterBlockId` | UUID | Não | cria logo depois deste bloco; sem ele, no fim |

Resposta 201 com o bloco criado (mesmos campos de 5.1).

### 5.3. `PATCH /api/v1/teacher/blocks/{blockId}`

Altera o conteúdo de um bloco.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `payload` | objeto | Sim | estrutura do tipo do bloco (RN-02 e RN-03) |
| `expectedUpdatedAt` | timestamp | Sim | instante da última alteração conhecida (RN-08) |
| `force` | booleano | Não | grava por cima mesmo com conflito (P-04) |

Resposta 200 com o bloco alterado e o HTML já filtrado.

### 5.4. `DELETE /api/v1/teacher/blocks/{blockId}`

Remove o bloco e renumera os seguintes. Resposta 204.

### 5.5. `PUT /api/v1/teacher/modules/{id}/blocks/order`

Define a nova ordem.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `blockIds` | lista de UUID | Sim | exatamente os blocos do módulo, sem repetir nem faltar |

Resposta 200 com a lista na nova ordem.

### 5.6. Erros comuns (RFC 7807)

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Tipo inválido, estrutura do tipo incorreta, limite estourado ou lista de ordem incompleta (com a lista de campos inválidos) |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Papel sem permissão, ou docente que não é dono do módulo |
| 404 | `module-not-found` / `block-not-found` | Módulo ou bloco inexistente |
| 409 | `block-conflict` | Bloco alterado por outra pessoa depois do instante informado |
| 413 | `file-too-large` | Corpo acima de 1 MB |
| 429 | `rate-limited` | Mais de 120 gravações por minuto por usuário |

## 6. Impacto e Riscos (Impact & Risks)

- **HTML malicioso gravado por quem edita.** Um bloco é exibido a todos os estudantes.
  *Mitigação:* filtro no servidor (RN-04), o mesmo da carga inicial; o frontend continua só exibindo o que o backend filtrou; teste com cargas conhecidas de script e de atributos de evento.
- **Perda de progresso dos estudantes ao remover um bloco.**
  *Mitigação:* confirmação com aviso explícito (3.1), e reordenar ou editar nunca mexe no progresso (o identificador do bloco não muda).
- **Duas pessoas editando o mesmo bloco.**
  *Mitigação:* checagem de conflito (RN-08) com opção consciente de gravar por cima.
- **A carga inicial sobrescrever uma edição.**
  *Mitigação:* RN-07 e a regra de preservação da SPEC-011; teste de integração que edita um bloco, recarrega o manifesto e confere que a edição ficou.
- **Trabalho em andamento no mesmo módulo de backend.** Outra frente mexe em `content` (progresso de leitura por bloco).
  *Mitigação:* ver P-05; a implementação só começa depois de decidida a ordem de entrega.
- **Editor que gera conteúdo fora do que a tela de estudo sabe exibir.**
  *Mitigação:* estrutura por tipo conferida no servidor (RN-03); a pré-visualização usa os mesmos componentes da tela de estudo.
- **Peso de um módulo com centenas de blocos na tela de edição.**
  *Mitigação:* os editores abrem só sob demanda, um bloco por vez; o maior módulo tem 63 blocos.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO um `ADMIN` ou o `TEACHER` dono abrir a tela de edição de um módulo, O SISTEMA DEVE listar os blocos na ordem, com tipo, resumo e marca de editado.
- [ ] **CA-02** (evento): QUANDO o usuário criar um bloco de qualquer um dos oito tipos com conteúdo válido, O SISTEMA DEVE gravá-lo na posição pedida, mostrá-lo na lista e marcá-lo como editado.
- [ ] **CA-03** (evento): QUANDO o usuário alterar o conteúdo de um bloco e salvar, O SISTEMA DEVE gravar a alteração, devolver o HTML já filtrado e marcar o bloco como editado.
- [ ] **CA-04** (evento): QUANDO o usuário remover um bloco depois de confirmar, O SISTEMA DEVE apagá-lo, renumerar os seguintes sem lacunas e apagar o progresso de leitura dele.
- [ ] **CA-05** (evento): QUANDO o usuário reordenar os blocos, O SISTEMA DEVE gravar a nova ordem em uma única operação, com posições de 1 a N, e a tela de estudo DEVE passar a seguir essa ordem.
- [ ] **CA-06** (indesejado): SE o conteúdo de um bloco não atender à estrutura do seu tipo ou estourar um limite, ENTÃO O SISTEMA DEVE recusar a gravação com 400 e indicar o campo.
- [ ] **CA-07** (indesejado): SE o HTML de um bloco tiver script, atributo de evento ou endereço perigoso, ENTÃO O SISTEMA DEVE removê-los antes de gravar e NUNCA devolvê-los.
- [ ] **CA-08** (indesejado): SE um `TEACHER` tentar editar blocos de módulo de outra pessoa, ENTÃO O SISTEMA DEVE responder 403; SE não houver sessão, 401.
- [ ] **CA-09** (indesejado): SE o bloco foi alterado por outra pessoa depois do instante informado, ENTÃO O SISTEMA DEVE responder 409 e a tela DEVE oferecer recarregar o bloco ou gravar por cima.
- [ ] **CA-10** (estado): ENQUANTO um bloco tiver sido editado pela autoria, O SISTEMA NÃO DEVE sobrescrevê-lo na carga inicial.
- [ ] **CA-11** (ubíquo): A pré-visualização de cada bloco DEVE usar os mesmos componentes da tela de estudo.
- [ ] **CA-12** (ubíquo): Toda criação, alteração, remoção e reordenação DEVE gerar registro de auditoria com autor, módulo, bloco e instante.
- [ ] **CA-13** (estado): ENQUANTO houver alterações não salvas em um bloco, O SISTEMA DEVE avisar antes de o usuário sair da tela.
- [ ] **CA-15** (evento): QUANDO o usuário escrever um texto formatado (negrito, itálico, lista, título, link, tabela, código), O SISTEMA DEVE mostrar o resultado no próprio editor enquanto ele digita, sem exigir HTML.
- [ ] **CA-16** (evento): QUANDO o usuário editar a descrição e ementa de um módulo no editor visual e salvar, O SISTEMA DEVE gravar o texto já filtrado e mostrá-lo corretamente ao abrir a edição de novo.
- [ ] **CA-17** (estado): ENQUANTO a descrição de um módulo tiver formatação, O SISTEMA DEVE mostrar nos cartões de módulo, na página de materiais e no subtítulo da tela de estudo apenas o texto simples dela.
- [ ] **CA-18** (indesejado): SE a descrição de um módulo ficar vazia depois de remover a marcação, ENTÃO O SISTEMA DEVE recusar a gravação com 400.
- [ ] **CA-14** (ubíquo): A reordenação, a edição e a remoção DEVEM poder ser feitas só com o teclado, e os controles DEVEM ter nome acessível.

## 8. Plano de Testes (Test Plan)

- **Backend (service, com repositório de teste):** RN-01 a RN-08 por tipo de bloco (estrutura válida e inválida, limites), conflito, posição, renumeração, marca de edição e permissão por papel e dono (CA-02 a CA-08).
- **Backend (handler, `httptest`):** status, envelope RFC 7807 e campos de cada rota da seção 5, incluindo 401, 403, 404, 409, 413 e 429 (CA-06, CA-08, CA-09).
- **Backend (repository, PostgreSQL real):** criação com deslocamento, remoção com renumeração em cascata sobre o progresso, reordenação atômica e a carga inicial preservando um bloco editado (CA-04, CA-05, CA-10).
- **Segurança:** conjunto de entradas hostis no HTML (script, `onerror`, `javascript:`) nos quatro tipos com HTML (CA-07).
- **Frontend (unidade e componente):** o editor de cada tipo, a lista (criar, editar, subir, descer, remover com confirmação), a pré-visualização, o conflito, o aviso de alterações não salvas, os estados e o uso só pelo teclado (CA-01 a CA-03, CA-09, CA-11, CA-13, CA-14).
- **Manual:** com o serviço rodando, editar um texto e um comando do módulo "Pacotes, atualizações e serviços", abrir a tela de estudo e conferir o novo conteúdo, a ordem e o progresso; recarregar o conteúdo pela carga inicial e conferir que a edição ficou.
- **Cobertura:** acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`; SPEC-010, SPEC-011 (seção 4 e RN-08), SPEC-012, SPEC-016; do código: `backend/internal/modules/content/` inteiro, `backend/internal/modules/coursemodule/service/` (regra de dono e administrador), `frontend/src/app/app/modules/[id]/edit/page.tsx`, `frontend/src/components/ModuleForm/`, `frontend/src/components/ExerciseOrderList/` e `frontend/src/components/ContentRenderer/`.
2. **Ordem de execução:**
   1. alinhar com o Tech Lead a ordem de entrega com o trabalho de progresso por bloco (P-05);
   2. backend: validação por tipo e filtro de HTML reutilizados, service, repository, handler e rotas;
   3. testes de backend, inclusive o de preservação pela carga inicial;
   4. serviço de rede no frontend;
   5. lista de blocos e reordenação;
   6. editores por tipo e pré-visualização;
   7. conflito, aviso de alterações não salvas e acessibilidade;
   8. glossário.
3. **Arquivos e diretórios a criar ou alterar:** `backend/internal/modules/content/` (domain, service, repository, handler e testes), `backend/cmd/api/main.go` (rotas), `frontend/src/services/contentAuthoringService.ts` e teste, `frontend/src/components/BlockEditor/` (lista, editores por tipo e testes), `frontend/src/app/app/modules/[id]/edit/page.tsx`, `frontend/src/messages/` (textos), `specs/GLOSSARY.md`. Qualquer outro arquivo exige justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, ESLint, Stylelint, `tsc` e `next build` limpos, roteiro manual registrado e status `Implementada`.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | **Editor visual: qual biblioteca.** O Tech Lead decidiu em 09/10/2026 que o texto formatado e a descrição do módulo usam um editor WYSIWYG (opção b). Falta aprovar a **dependência nova** (`AI_INSTRUCTIONS.md`, seção 7). Candidatas, todas gratuitas: **Tiptap 3** (`@tiptap/react`, `@tiptap/starter-kit` e `@tiptap/pm`, licença MIT, aceita React 19, versão 3.31.4 conferida no registro), **Lexical** (Meta, MIT, versão 0.52, ainda abaixo da 1.0) e **Quill 2** (BSD-3, feito para JavaScript puro, sem integração própria com React). | **Tiptap 3**, em versão fixada, usado só dentro de um componente `RichTextEditor` (a troca futura de biblioteca não toca nas telas). Motivos: integra bem com React 19 e o Next, é modular, sai e entra em HTML sem conversão extra (o conteúdo do projeto já é HTML) e é a opção mais difundida. Lexical é boa, mas está em 0.x. |
| P-02 | **Remover bloco é definitivo.** Não há lixeira, e o progresso dos estudantes no bloco é apagado em cascata. | Manter definitivo, com confirmação clara. Lixeira e histórico exigiriam mudança de schema e ficam para depois. |
| P-03 | **Docente edita só os blocos dos seus módulos?** Os 9 módulos da carga pertencem ao administrador que rodou a carga. | Sim (SPEC-010, RN-01). Docentes editam os módulos que criarem; o administrador edita todos. |
| P-04 | **Conflito de edição.** Oferecer "gravar por cima" ou só "recarregar"? | Oferecer os dois, com o aviso do que será perdido. |
| P-05 | **Trabalho em andamento no mesmo módulo `content`.** Há alterações ainda sem commit de progresso de leitura por bloco (rotas, tabela `block_progress`, campo `outputExplanation`). Qual spec as cobre e em que ordem entregar? Também: o registro de auditoria usa o mecanismo de segurança da SPEC-003 ou um novo? | Fechar e commitar o trabalho de progresso primeiro, em spec própria, e só então implementar esta spec sobre o código já estável. Auditoria: reutilizar o registro de eventos existente com tipos novos. |
| P-06 | **Limites de tamanho** (RN-05) e **120 gravações por minuto** (seção 5.6). | Aprovar como estão. |
| P-07 | **Formato da descrição do módulo.** Hoje é texto simples, e três telas dependem disso: o cartão do módulo separa as etiquetas de comandos do resumo pelo padrão "comandos separados por · — resumo", a página de materiais mostra o texto cru e o subtítulo da tela de estudo usa as etiquetas. Passando a ser HTML, esse padrão só se mantém se for lido do texto extraído. | Guardar a descrição como HTML filtrado e criar uma função única de "texto simples da descrição" (usada pelos três lugares). A primeira linha de uma descrição continua podendo seguir o padrão "comandos — resumo" para gerar as etiquetas; sem o padrão, o cartão mostra só o resumo. A SPEC-010 é revisada junto com a implementação. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a partir da reclamação do cliente: o painel não permite editar os blocos de conteúdo dos módulos. Confirmado no código e no banco: a tela de edição só altera dados do módulo e a ordem dos exercícios, e não existe rota de blocos. Pendências P-01 a P-06 |
| 09/10/2026 | Tech Lead | Decisão sobre a P-01, dada ao ver o formulário de edição do módulo ("isso deve ser um editor estilo WYSIWYG", sobre a caixa "Descrição e Ementa"): o texto formatado dos blocos e a descrição do módulo usam editor visual. Incluídos o objetivo, o editor na seção 3.1, a RN-11 e as CA-15 a CA-18. Pendências: biblioteca (P-01, dependência nova) e formato da descrição (P-07) |
