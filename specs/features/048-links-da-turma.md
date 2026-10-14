# SPEC-048: Links da Turma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-048 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | novo módulo `classlink` |
| **Contexto de tela** | Página da turma, aba Visão geral (`/app/classes/{id}`) |
| **Prioridade** | Média |
| **Depende de** | SPEC-009, SPEC-041 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "na turma o professor pode adicionar links, por exemplo: esse é o link do Meet, ou esse é o link do conteúdo; ele inclui o nome e o link" |

---

## 1. Contexto e Problema (Context & Problem Statement)

A docente passa aos estudantes endereços úteis da turma, como o da sala do Meet, o do material ou o de um repositório, por mensagem avulsa. Os links se perdem e cada estudante pergunta de novo. A plataforma não tem onde guardar esses endereços junto da turma.

## 2. Objetivos (Goals)

- A docente cadastra, na turma, **links com nome e endereço** ("Link do Meet", "Conteúdo da aula 3").
- Os estudantes matriculados na turma veem a lista e abrem os links.
- A lista é curta, ordenada pela docente e segura (só endereços https).

### 2.1. Fora de escopo (Non-Goals)

- Anexar arquivos; categorias ou pastas de links; link por aula ou por data.
- Reordenar por arrastar e soltar (a docente remove e inclui na ordem que quer; a ordem é a da lista).
- Verificar se o endereço responde; pré-visualização do site.
- Notificar os estudantes quando um link muda.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Na aba **Visão geral** da página da turma, uma seção **Links da turma**.

**Para a docente (dona da turma) e o administrador:**

- lista dos links, cada um com o nome, o endereço e o botão **Remover**;
- formulário em linha, abaixo da lista: campo **Nome** (até 80 caracteres), campo **Endereço** (começa com https) e botão **Adicionar link**;
- ao adicionar ou remover, a lista é salva na hora, com mensagem de sucesso ou de erro; o botão mostra "Adicionando…" enquanto salva;
- o erro de um campo aparece junto dele (nome vazio ou longo, endereço sem https);
- estado vazio: "Nenhum link ainda. Adicione o da sala do Meet ou o do conteúdo.";
- turma arquivada: só leitura.

**Para o estudante matriculado:** a mesma lista, só de leitura; cada nome é um link que abre o endereço em outra aba, com `rel="noopener noreferrer"`. Sem links, a seção mostra "A docente ainda não publicou links.".

Ícone de link, alvos de toque de 44 px, botões do padrão `Button` do sistema (SPEC-047), cores só dos tokens. Chamadas de rede só em `frontend/src/services/`; textos no arquivo de mensagens.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo novo `classlink`, com domain, repository, service e handler.

- **RN-01 (link):** o nome é obrigatório, sem espaços nas pontas, de 1 a 80 caracteres; o endereço é obrigatório, sem espaços nas pontas, até 2.000 caracteres, absoluto, com esquema `https` e com host.
- **RN-02 (limite):** até 20 links por turma.
- **RN-03 (substituição):** a docente envia a **lista inteira** (como os encontros, SPEC-042). A ordem da lista é a ordem de exibição (`position`, de 0). A lista nova substitui a antiga numa única transação: os links que saíram são excluídos logicamente e os novos são inseridos. Lista vazia remove todos.
- **RN-04 (autorização):** para **gravar**, só a docente dona da turma e o administrador. Para **ler**, também o estudante com matrícula `ACTIVE` na turma. Outro docente, ou estudante sem matrícula ativa, recebe a mesma recusa que a agenda dá (SPEC-042 RN-08): o estudante sem matrícula ativa vê a turma como inexistente (404); o docente de outra turma recebe 403.
- **RN-05 (turma arquivada):** gravar numa turma arquivada é recusado (409); ler continua permitido.
- **RN-06 (HTML):** nome e endereço são texto puro; a interface os mostra sempre escapados.

## 4. Modelo de Dados (Data Model)

Tabela nova `class_links` (migração 00027):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | Identificador |
| `class_id` | uuid | Sim | FK `classes` | Turma dona |
| `position` | smallint | Sim | de 0 a 19 | Ordem de exibição (RN-03) |
| `name` | text | Sim | de 1 a 80 caracteres | Nome do link (RN-01) |
| `url` | text | Sim | até 2.000 caracteres | Endereço https (RN-01) |
| `created_at`, `updated_at` | timestamptz | Sim | | Auditoria |
| `deleted_at` | timestamptz | Não | | Exclusão lógica (RN-03) |

Índice em `class_id` e `position` entre os não excluídos. Exclusão lógica: a lista substituída fica no histórico.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/{id}/links`**: lista os links da turma, na ordem.

- **Papéis autorizados:** docente dona, administrador e estudante com matrícula ativa (RN-04).
- **Resposta (200):** `links`: lista de `id`, `name`, `url`, `position`.
- **Erros (RFC 7807):** 400 `invalid-uuid`; 404 `class-not-found`; 403 `forbidden`.

**`PUT /api/v1/classes/{id}/links`**: substitui a lista (RN-03).

- **Papéis autorizados:** docente dona e administrador.
- **Corpo:** `links`: lista de `name` e `url` (de 0 a 20 itens).
- **Resposta (200):** a lista gravada, no formato do `GET`.
- **Erros:**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-link` | nome ou endereço inválido (RN-01); a extensão `field` aponta o item e o campo, por exemplo `links[2].url` |
| 400 | `too-many-links` | mais de 20 links (RN-02) |
| 400 | `invalid-uuid` | id da turma inválido |
| 403 | `forbidden` | docente de outra turma, ou estudante (RN-04) |
| 404 | `class-not-found` | turma inexistente |
| 409 | `class-archived` | turma arquivada (RN-05) |

## 6. Impacto e Riscos (Impact & Risks)

- **Endereço malicioso** (`javascript:`, `data:`). Mitigação: só `https` com host (RN-01), nome e endereço como texto puro e links abertos com `rel="noopener noreferrer"`.
- **Lista grande demais.** Mitigação: limite de 20 (RN-02).
- **Edição simultânea** de duas abas da docente: vale a última gravação (a lista inteira é substituída). Aceito pela simplicidade; a lista é curta.
- **Sem impacto** nas demais rotas e tabelas.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona envia uma lista válida, O SISTEMA DEVE gravá-la na ordem enviada e devolvê-la.
- [ ] **CA-02** (evento): QUANDO a docente envia uma lista vazia, O SISTEMA DEVE remover todos os links.
- [ ] **CA-03** (indesejado): SE um nome tem mais de 80 caracteres ou está vazio, ou um endereço não é https absoluto com host ou passa de 2.000 caracteres, ENTÃO O SISTEMA DEVE recusar com `invalid-link` apontando o item e o campo (`field`), sem gravar nada.
- [ ] **CA-04** (indesejado): SE a lista tem mais de 20 links, ENTÃO O SISTEMA DEVE recusar com `too-many-links`.
- [ ] **CA-05** (estado): ENQUANTO a turma está arquivada, O SISTEMA DEVE recusar a gravação com `class-archived` e permitir a leitura.
- [ ] **CA-06** (ubíquo): Só a docente dona e o administrador DEVEM gravar; docente de outra turma recebe 403.
- [ ] **CA-07** (evento): QUANDO um estudante com matrícula ativa lê a lista, O SISTEMA DEVE devolvê-la; SE não tem matrícula ativa, ENTÃO DEVE responder 404; e NÃO DEVE permitir que ele grave.
- [ ] **CA-08** (ubíquo): A substituição DEVE ser atômica e excluir logicamente os links que saíram.
- [ ] **CA-09** (ubíquo): Na aba Visão geral, a docente DEVE ver a lista, adicionar (nome e endereço) e remover links, salvando na hora, com o erro de cada campo junto dele.
- [ ] **CA-10** (ubíquo): O estudante matriculado DEVE ver os links como ligações que abrem em outra aba com `rel="noopener noreferrer"`, sem poder editar; sem links, DEVE ver a mensagem de vazio.
- [ ] **CA-11** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `classlink/domain`:** validação do nome e do endereço (vazio, longo, `http`, `javascript:`, sem host, com espaços), limite de 20. Cobre CA-03 e CA-04.
- **Backend, `classlink/service` (com repositório de teste):** substituição na ordem, lista vazia, ordem preservada, erros, posse, administrador, estudante ativo e sem matrícula, turma arquivada e inexistente. Cobre CA-01 a CA-07.
- **Backend, `classlink/repository` (banco de teste):** a substituição é atômica, exclui logicamente e relê na ordem. Cobre CA-08.
- **Backend, `classlink/handler`:** rotas, papéis, corpo e os erros RFC 7807 da seção 5. Cobre CA-01 a CA-07.
- **Frontend, `classService`:** `getLinks` e `replaceLinks` chamam as rotas. Cobre a rede.
- **Frontend, componente `ClassLinks` e página da turma:** docente adiciona e remove, erros junto do campo, estado vazio, arquivada em leitura; estudante vê só leitura com `rel`. Cobre CA-09 e CA-10.
- **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-042 (módulo `schedule`: rotas de encontros, `readableClass` e `writableClass`), SPEC-047 (botões).
2. **Ordem de execução:** (1) testes vermelhos e commit `test`; (2) migração; (3) domain, repository, service, handler; (4) composição em `cmd/api/main.go`; (5) frontend: serviço, componente e página; (6) cobertura.
3. **Arquivos a criar ou alterar:** `backend/migrations/00027_class_links.sql`; `backend/internal/modules/classlink/**` (novo); `backend/cmd/api/main.go`; `specs/GLOSSARY.md` (termo "Link da turma"); `frontend/src/services/classService.ts` e seu teste; `frontend/src/components/ClassLinks/**` (novo); `frontend/src/app/app/classes/[id]/page.tsx` e seu teste; `frontend/src/messages/pt-BR.ts`.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões assumidas por recomendação, sem objeção do Tech Lead: lista inteira por `PUT`, ordem pela lista, limite de 20 links, só `https`, leitura para estudantes ativos.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao pedir os links da turma |
| 14/10/2026 | Implementador | Implementada: módulo `classlink` (migração 00027, domain, repository, service, handler), serviço, componente `ClassLinks` e seção na visão geral. O erro de validação usa `invalid-link` com a extensão `field`, no padrão da agenda |
