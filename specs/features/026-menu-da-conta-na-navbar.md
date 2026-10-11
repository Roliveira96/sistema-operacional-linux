# SPEC-026: Menu da Conta na Navbar

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-026 |
| **Status** | Aprovada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos (frontend; backend só para a rota das turmas do usuário) |
| **Módulo** | `classgroup` (backend); `AppShell` e `NavbarPublic` (frontend) |
| **Contexto de tela** | Barra superior da área logada (`/app/**`) e da navbar pública quando há sessão |
| **Prioridade** | Média |
| **Depende de** | SPEC-003, SPEC-007, SPEC-009, SPEC-015 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (navbar do usuário logado: só nome e foto; ao clicar, e-mail, turmas, botão do perfil e botão sair) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A barra superior da área logada mostra tudo de uma vez: foto, nome, RA ou papel e o botão "Sair" ao lado, mais os links de navegação. A navbar pública, quando há sessão, mostra foto e nome, o botão "Minha área" e o botão "Sair". O usuário vê controles de conta espalhados em dois lugares com desenhos diferentes, a barra fica cheia (principalmente em telas estreitas) e o usuário não consegue ver, num só lugar, quem ele é para o sistema: e-mail da conta e turmas em que está.

O que existe hoje: `UserBadge` (foto, nome e RA ou papel), `AppShell` (barra da área logada), `NavbarPublic` (barra pública) e a tela de perfil em `/app/profile`. Não existe rota que devolva as turmas do próprio usuário: o estudante só enxerga a matrícula pelo convite, e o docente só pela listagem de gestão de turmas.

## 2. Objetivos (Goals)

- A barra mostra, para quem está logado, **só a foto e o nome**.
- Ao clicar, abre um **painel da conta** com: e-mail, as **turmas** do usuário, o botão **Meu perfil** e o botão **Sair**.
- O mesmo componente serve à barra da área logada e à navbar pública, para o usuário ver a mesma conta nos dois lugares.
- O painel é utilizável só com teclado, em celular e por leitor de tela.

### 2.1. Fora de escopo (Non-Goals)

- Trocar ou enviar foto pelo painel (a foto continua sendo enviada no perfil do estudante; docente e administrador seguem com as iniciais).
- Notificações, troca de tema, troca de idioma e atalhos no painel.
- Mudar os links de navegação da barra (Turmas, Alunos, Módulos, Segurança).
- A barra da tela de estudo do tópico (SPEC-016), que tem desenho próprio (ver P-02).
- Gestão de turmas pelo painel: o painel só lista e leva à gestão.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Estratégia de experiência.**

| Item | Decisão |
| :--- | :--- |
| Quem usa e em que momento | Estudante ou docente, no meio de uma tarefa, querendo confirmar "com qual conta estou" ou "em quais turmas estou" e, às vezes, sair. É uma consulta rápida, não um destino. |
| Ideia central | A barra fica limpa para o trabalho; a identidade completa aparece só quando pedida (divulgação progressiva). |
| Padrão conhecido | Menu de conta no canto direito, como em Gmail, GitHub e Linear (Jakob): foto e nome abrem um painel. |
| Maior risco | Esconder o "Sair" um nível adentro torna a saída menos óbvia. Mitigação: o painel abre com um clique, o "Sair" tem posição fixa no fim e rótulo explícito. |

**Barra fechada (RN-01).** Um único botão com a foto (ou as iniciais, quando não há foto) e o nome, seguido de uma seta que indica que abre. Sem e-mail, sem RA, sem papel e sem botão "Sair" na barra. Em telas estreitas (abaixo de 640 px) mostra só a foto e as iniciais; o nome passa a aparecer no painel.

**Painel aberto (RN-02).** Abre abaixo do botão, alinhado à direita, e tem quatro blocos, de cima para baixo:

| Bloco | Conteúdo |
| :--- | :--- |
| Identidade | Foto maior, nome e e-mail. O e-mail longo quebra a linha em vez de cortar. |
| Minhas turmas | Lista das turmas (RN-03). Estados: carregando (esqueleto de duas linhas), vazio, erro com "Tentar de novo", e lista. |
| Meu perfil | Botão secundário de largura total que leva a `/app/profile`. |
| Sair | Botão de texto, último item, separado dos demais por um divisor sutil. Não é vermelho: sair é uma ação reversível. |

**Hierarquia visual.** O nome é o elemento principal do bloco de identidade; o e-mail fica em texto secundário. Meu perfil é a única ação em destaque; Sair é a mais discreta, para não ser clicada sem querer.

**Comportamento (RN-04).** Clique no botão abre e fecha. Fecha com `Esc` (e devolve o foco ao botão), com clique fora, ao escolher um item e quando a rota muda. Ao abrir, o foco vai para o painel. O painel não prende o foco: `Tab` além do último item o fecha. Animação curta de entrada (opacidade e deslocamento de poucos pixels), desligada quando o usuário pede movimento reduzido.

**Turmas (RN-03).** Mostra até 5 turmas, cada uma com nome e, em segunda linha, código da disciplina e semestre. Havendo mais de 5, aparece "Ver todas" no fim da lista: o docente vai para `/app/classes`; o estudante não tem tela de turmas (ver P-03), então para ele o painel mostra as 5 primeiras e a contagem total. O estudante com matrícula aguardando moderação vê a turma marcada como "Aguardando aprovação". O administrador não vê o bloco, porque não pertence a turmas; no lugar aparece o papel.

**Acessibilidade.** O botão da barra é um `button` com `aria-expanded` e `aria-controls`. O painel é uma região com nome ("Minha conta"), usa botões e links nativos e é navegável por `Tab`. Alvos de toque de pelo menos 44 px. Foco visível em todos os itens. Contraste mínimo WCAG AA. A foto tem texto alternativo com o nome, e as iniciais são decorativas. A lista de turmas é uma lista semântica.

**Visual.** Só tokens de design (sem cor literal), tema escuro único (SPEC-015), grade de 8 px, raio único dos controles do sistema, painel com superfície elevada (uma camada acima da barra) e borda translúcida, largura de 320 px (em celular, a largura da tela menos 32 px). Textos em português no arquivo central de mensagens; chamadas de rede só em `frontend/src/services/`.

**Mensagens (português, centralizadas).** Rótulo do botão: o nome do usuário; nome da região: "Minha conta"; "Minhas turmas"; "Meu perfil"; "Sair"; vazio: "Você ainda não está em nenhuma turma."; erro: "Não foi possível carregar as turmas." com "Tentar de novo"; "Aguardando aprovação"; "Ver todas as turmas".

### 3.2. Backend (Go: Camada de Módulo/Service)

Uma rota nova no módulo `classgroup`, que devolve as turmas do usuário da sessão.

- **RN-05 (estudante):** devolve as turmas em que há matrícula ativa ou aguardando moderação. Matrícula rejeitada, transferida ou cancelada não aparece.
- **RN-06 (docente):** devolve as turmas de que é o responsável, exceto as arquivadas.
- **RN-07 (administrador):** devolve lista vazia; o administrador não pertence a turmas.
- **RN-08 (ordem e limite):** ordenadas por data de início da turma, da mais recente para a mais antiga, no máximo 20. O total real vem num campo à parte.
- **RN-09 (privacidade):** devolve só dados da própria turma e da própria matrícula. Nunca lista outros membros nem o código de convite.
- **RN-10 (sem regra duplicada):** usa os repositories e serviços do próprio `classgroup`; o módulo `student` não é tocado.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema. A rota lê as tabelas de turmas e matrículas existentes (SPEC-009).

## 5. Contrato de API (API Contract)

**`GET /api/v1/me/classes`**: turmas do usuário autenticado.

- **Papéis autorizados:** `STUDENT`, `TEACHER`, `ADMIN` (o último recebe lista vazia).
- **Parâmetros:** nenhum.
- **Resposta de sucesso (200):**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `items` | lista | Sim | Até 20 turmas (RN-08) |
| `items[].id` | texto (uuid) | Sim | Identificador da turma |
| `items[].name` | texto | Sim | Nome da turma |
| `items[].courseCode` | texto | Sim | Código da disciplina |
| `items[].semester` | texto | Sim | Semestre |
| `items[].relation` | texto | Sim | `TEACHER` (responsável) ou `STUDENT` (matriculado) |
| `items[].enrollmentStatus` | texto | Não | Só para `STUDENT`: `ACTIVE` ou `PENDING_MODERATION` |
| `total` | inteiro | Sim | Total real de turmas, mesmo acima do limite |

- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `password-change-required` | Senha provisória ainda não trocada |

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Esconder o "Sair" no painel o torna menos descoberto | Um clique abre o painel; o botão tem posição fixa e rótulo explícito; a sessão ainda expira sozinha (SPEC-003) |
| Painel cortado ou fora da tela em celular | Largura limitada à da tela menos margem, alinhamento ajustado e teste nos breakpoints de 360 px e 768 px |
| Nome ou e-mail muito longos quebram o layout | Nome na barra com reticências; e-mail no painel com quebra de linha; teste com nomes longos |
| Duas barras (área logada e pública) divergem com o tempo | Um só componente de menu da conta usado pelas duas |
| Consulta de turmas a cada abertura sobrecarrega a API | A lista carrega na primeira abertura do painel e é reaproveitada enquanto a página não recarrega |
| Estudante sem foto fica sem identidade visual | Iniciais coloridas pelos tokens, como o `UserBadge` faz hoje |

Impacto em módulos existentes: `AppShell` e `NavbarPublic` trocam o bloco de conta pelo novo componente; `UserBadge` continua existindo para a tela de estudo (SPEC-016). `legacy/`: nenhum.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): A BARRA, para usuário logado, DEVE mostrar apenas a foto (ou as iniciais) e o nome, sem e-mail, RA, papel ou botão "Sair".
- [ ] **CA-02** (evento): QUANDO o usuário clicar no botão da conta, O SISTEMA DEVE abrir o painel com e-mail, turmas, "Meu perfil" e "Sair".
- [ ] **CA-03** (evento): QUANDO o usuário pressionar `Esc`, clicar fora ou escolher um item, O SISTEMA DEVE fechar o painel, e no `Esc` devolver o foco ao botão.
- [ ] **CA-04** (evento): QUANDO o usuário acionar "Meu perfil", O SISTEMA DEVE levá-lo a `/app/profile`.
- [ ] **CA-05** (evento): QUANDO o usuário acionar "Sair", O SISTEMA DEVE encerrar a sessão e mostrar o estado de visitante.
- [ ] **CA-06** (estado): ENQUANTO as turmas carregam, O PAINEL DEVE mostrar o esqueleto; SE a carga falhar, ENTÃO DEVE mostrar o erro com "Tentar de novo", mantendo e-mail, perfil e sair utilizáveis.
- [ ] **CA-07** (estado): ENQUANTO o usuário não tiver turmas, O PAINEL DEVE mostrar a mensagem de vazio.
- [ ] **CA-08** (ubíquo): O PAINEL DEVE mostrar até 5 turmas com nome, código e semestre, e a indicação "Aguardando aprovação" para matrícula pendente.
- [ ] **CA-09** (estado): ENQUANTO o usuário for administrador, O PAINEL NÃO DEVE mostrar o bloco de turmas.
- [ ] **CA-10** (ubíquo): O MENU DEVE ser operável só com teclado, com `aria-expanded`, região nomeada, foco visível e alvos de 44 px.
- [ ] **CA-11** (estado): ENQUANTO o usuário pedir movimento reduzido, O PAINEL NÃO DEVE animar.
- [ ] **CA-12** (estado): ENQUANTO a tela for menor que 640 px, A BARRA DEVE mostrar só a foto e o PAINEL DEVE mostrar o nome.
- [ ] **CA-13** (evento): QUANDO o estudante chamar `GET /api/v1/me/classes`, O SISTEMA DEVE devolver só as turmas com matrícula ativa ou pendente.
- [ ] **CA-14** (evento): QUANDO o docente chamar a rota, O SISTEMA DEVE devolver só as turmas de que é responsável e que não estão arquivadas.
- [ ] **CA-15** (evento): QUANDO o administrador chamar a rota, O SISTEMA DEVE devolver lista vazia.
- [ ] **CA-16** (indesejado): SE a chamada vier sem sessão, ENTÃO O SISTEMA DEVE responder 401 `not-authenticated`.
- [ ] **CA-17** (ubíquo): A ROTA NÃO DEVE devolver membros de outras matrículas nem o código de convite.

## 8. Plano de Testes (Test Plan)

- **Backend:** testes de unidade do service de turmas do usuário, com repository de teste (cobre CA-13, CA-14, CA-15, CA-17: matrícula rejeitada não aparece, turma arquivada do docente não aparece, limite de 20 e `total` real); teste de handler com `httptest` e roteador Gin real (CA-16 e o envelope RFC 7807); integração do repository com PostgreSQL real (`testcontainers-go`) para as consultas.
- **Frontend:** testes de componente do menu da conta com `fetch` falso: barra fechada (CA-01), abrir e fechar por clique, `Esc` e clique fora com retorno do foco (CA-02, CA-03), navegação do perfil e do sair (CA-04, CA-05), estados de carregando, erro, vazio, lista e pendente (CA-06 a CA-08), administrador (CA-09), atributos de acessibilidade (CA-10), movimento reduzido (CA-11); testes de `AppShell` e `NavbarPublic` conferindo que o bloco antigo saiu; teste do serviço de turmas do usuário.
- **Manual:** roteiro em 360 px, 768 px e 1280 px: abrir o painel, usar só teclado, nome muito longo, e-mail muito longo, usuário sem foto e leitor de tela (CA-10, CA-12).
- **Cobertura:** acima de 80% no escopo da spec, com `go test -cover` e Vitest.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-003, 007, 009, 015; no código, `AppShell`, `NavbarPublic`, `UserBadge`, `useIdentity`, `useAuth`, `classService` e o módulo `classgroup` do backend.
2. **Ordem de execução:** (1) service, handler e repository da rota `GET /api/v1/me/classes`; (2) serviço de rede do frontend; (3) componente do menu da conta com seu estilo; (4) trocar o bloco de conta em `AppShell` e `NavbarPublic`; (5) mensagens; (6) testes e roteiro manual.
3. **Arquivos a criar ou alterar:** `backend/internal/modules/classgroup/**` (rota, service, repository e testes), `frontend/src/components/AccountMenu/` (novo), `frontend/src/components/AppShell/`, `frontend/src/components/NavbarPublic/`, `frontend/src/services/classService.ts` (ou um serviço novo de turmas do usuário), `frontend/src/messages/pt-BR.ts`. Qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `ARCHITECTURE.md`, ESLint, Stylelint e tipos limpos, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Todas foram resolvidas em 10/10/2026, com as recomendações aceitas pelo Tech Lead.

### 10.1. Decisões (aprovadas pelo Tech Lead em 10/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | As turmas do estudante no painel são só informativas, sem link; as do docente levam a `/app/classes/[id]`. Uma tela de turmas do estudante vira outra spec |
| D-02 | A barra da tela de estudo do tópico (SPEC-016) fica fora desta spec |
| D-03 | "Ver todas" aparece só para o docente; o estudante com mais de 5 turmas vê as 5 primeiras e a contagem |
| D-04 | A matrícula aguardando moderação aparece para o estudante, com a marca "Aguardando aprovação" |
| D-05 | O link "Segurança" continua na barra de navegação |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect | Criação em Rascunho, a partir do pedido do Tech Lead, com as skills de UX e de UI |
| 10/10/2026 | Aruna Architect | Pendências P-01 a P-05 viram decisões D-01 a D-05. Aprovada pelo Tech Lead em 10/10/2026 |
| 10/10/2026 | Implementador (Claude) | Renumerada de SPEC-025 para SPEC-026: o número 025 já tinha sido tomado pela spec de upload de imagens do conteúdo, criada em paralelo |
