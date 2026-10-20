# SPEC-067: Aula ao vivo em andamento visível para o estudante

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-067 |
| **Status** | Implementada |
| **Data de criação** | 15/10/2026 |
| **Última revisão** | 15/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (backend) e `AppShell` (frontend) |
| **Contexto de tela** | Toda a área logada do estudante (`/app/**`), exceto dentro da própria sala ao vivo |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051, SPEC-053, SPEC-054, SPEC-041 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 15/10/2026: "no lado do aluno devemos mostrar a aula que está ocorrendo para ele poder entrar" |

---

## 1. Contexto e Problema (Context & Problem Statement)

Quando a docente inicia uma sala ao vivo, o estudante só fica sabendo se abrir a turma: o botão "Entrar na aula" está na visão geral da turma (SPEC-051) e no aviso da aba Agenda (SPEC-053). Quem está na página inicial, no calendário ou em qualquer outra tela não vê nada. A página inicial do estudante hoje só tem a saudação e o horário em que a sessão termina. O estudante precisa adivinhar em qual turma entrar, e a aula começa com a turma incompleta.

## 2. Objetivos (Goals)

- O estudante com matrícula ativa vê, em qualquer tela da área logada, um aviso da sala ao vivo em andamento nas suas turmas, com o título da aula, o nome da turma e o botão **Entrar na aula**.
- O aviso aparece quando a aula começa e some quando ela termina, sem o estudante recarregar a página.

### 2.1. Fora de escopo (Non-Goals)

- Mudar a sala de espera: o botão leva à sala ao vivo e o estudante continua esperando a aceitação da docente (SPEC-054).
- Avisar aulas da agenda que ainda não começaram ou que não têm sala ao vivo aberta.
- Notificação do navegador, som ou e-mail fora da sala (a SPEC-064 trata dos avisos dentro da aula).
- Mostrar o aviso para a docente e para o administrador, que já têm o painel da aula.
- Mudar o aviso da aba Agenda e o botão da visão geral da turma, que seguem como estão.
- Canal de tempo real novo para o estudante fora da sala.
- Distinguir a aula "em andamento" da sala mantida aberta só para tirar dúvidas: para o aviso, sala aberta é sala aberta (RN-07).
- Mudar a regra de uma sala aberta por turma (SPEC-051 RN-01).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Aviso:** uma faixa logo abaixo da barra superior do `AppShell`, só para o papel de estudante, em todas as telas de `/app/**`. Quando não há aula em andamento, a faixa não ocupa espaço.
- **Conteúdo:** um indicador "ao vivo", o texto "Aula ao vivo agora: *título*", o nome da turma e o botão **Entrar na aula**, que leva a `/app/classes/{id}/live`. Se mais de uma turma tem aula aberta ao mesmo tempo, há uma linha para cada uma.
- **Dentro da sala:** a faixa não aparece em `/app/classes/{id}/live` (e abaixo dela), onde o estudante já está.
- **Atualização:** o aviso é consultado ao carregar a área logada, a cada 20 segundos enquanto a aba está visível e quando a aba volta a ficar visível. Com a aba escondida, não consulta.
- **Falha:** se a consulta falhar, a faixa some sem mensagem de erro e a próxima consulta tenta de novo (mesmo padrão do aviso da SPEC-053).
- **Rede:** a consulta fica em `frontend/src/services/classroomService.ts`; o componente não chama a API diretamente.
- **Texto e aparência:** textos no arquivo de mensagens; cores só dos tokens, nos temas claro e escuro; no celular a faixa quebra de linha; botão com alvo de toque de no mínimo 44 px; a faixa é uma região de estado (`role="status"`) e o botão tem foco visível.

### 3.2. Backend (Go — Camada de Módulo/Service)

Um endpoint de leitura, no módulo `classroom`, que devolve as salas ao vivo abertas das turmas do estudante.

- **RN-01 (quais turmas):** só entram turmas em que o estudante tem matrícula `ACTIVE` (quem está em `PENDING_MODERATION` ou saiu não vê o aviso) e que não foram excluídas.
- **RN-02 (quais salas):** só salas com status `ACTIVE`, no máximo uma por turma (SPEC-051 RN-01). Sala encerrada ou excluída não entra.
- **RN-03 (o que sai):** apenas o necessário para o aviso: turma (id e nome), id e título da sala e hora de início. Nada do estado da sala (dúvidas, alunos online, fila, exercício).
- **RN-04 (sem aula):** sem sala aberta nas turmas do estudante, a resposta é sucesso com lista vazia.
- **RN-05 (papel):** só o estudante usa o endpoint; os demais papéis recebem 403.
- **RN-06 (uma consulta):** o endpoint resolve todas as turmas do estudante numa única consulta, sem uma chamada por turma.
- **RN-07 (aberta é aberta):** a sala entra enquanto estiver `ACTIVE`, sem olhar o horário da aula da agenda. Docente que encerra o horário da aula mas mantém a sala aberta para tirar dúvidas continua aparecendo para os estudantes, até encerrar a sala (SPEC-051 RN-02).
- **RN-08 (várias salas ao mesmo tempo):** o estudante pode ter salas abertas em várias turmas ao mesmo tempo (uma por turma, SPEC-051 RN-01), e todas saem, da que começou há menos tempo para a mais antiga.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema. O endpoint lê `live_classroom_sessions`, `classes` e `class_enrollments` já existentes.

## 5. Contrato de API (API Contract)

**`GET /api/v1/me/live`**: lista as salas ao vivo abertas nas turmas em que o estudante tem matrícula ativa.

- **Papéis autorizados:** `STUDENT`.
- **Parâmetros de rota e de query:** nenhum.
- **Corpo da requisição:** não se aplica.
- **Resposta de sucesso** (200):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `items` | lista | Sim | Salas abertas; vazia quando não há nenhuma |
| `items[].classId` | texto (uuid) | Sim | Turma da sala |
| `items[].className` | texto | Sim | Nome da turma |
| `items[].sessionId` | texto (uuid) | Sim | Sala ao vivo aberta |
| `items[].title` | texto | Sim | Título da aula |
| `items[].startedAt` | data e hora | Sim | Início da sala |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Sem sessão válida |
| 403 | `forbidden` | Usuário que não é estudante |

## 6. Impacto e Riscos (Impact & Risks)

- **Carga de consultas:** cada estudante com a área aberta consulta a cada 20 segundos. Mitigação: uma consulta só por chamada (RN-06), resposta pequena, aba escondida não consulta; a tabela já tem índice parcial para salas abertas por turma.
- **Vazamento de dados da sala:** o endpoint poderia expor o estado da aula. Mitigação: RN-03 limita os campos; teste de handler confere que só os campos do contrato saem.
- **Aviso para quem ainda não pode entrar:** matrícula pendente. Mitigação: RN-01; o botão só leva à sala, e a admissão continua a cargo da docente (SPEC-054).
- **Faixa que empurra a página:** aparece e some sem o estudante pedir. Mitigação: ocupa a altura de uma linha, só existe enquanto há aula, e não aparece dentro da sala.
- **Sala mantida aberta só para dúvidas** aparece como "Aula ao vivo agora". Aceito pelo Tech Lead: o estudante pode entrar para tirar dúvidas (RN-07).
- **Muitas salas ao mesmo tempo** deixam a faixa alta. Mitigação: uma linha curta por sala, e um estudante tem poucas turmas.
- **Atraso de até 20 segundos** entre a docente iniciar a sala e o aviso aparecer. Aceito; a consulta ao voltar para a aba reduz o atraso de quem troca de aba.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO o estudante com matrícula `ACTIVE` pede `GET /api/v1/me/live` e uma das suas turmas tem sala ao vivo aberta, O SISTEMA DEVE responder 200 com um item contendo turma, nome da turma, id da sala, título e início (RN-01, RN-02, RN-03).
- [x] **CA-02** (estado): ENQUANTO nenhuma turma do estudante tem sala aberta, O SISTEMA DEVE responder 200 com lista vazia (RN-04).
- [x] **CA-03** (indesejado): SE a matrícula do estudante na turma não está `ACTIVE`, ou a sala foi encerrada, ou a turma foi excluída, ENTÃO O SISTEMA NÃO DEVE incluir a sala na resposta (RN-01, RN-02).
- [x] **CA-04** (indesejado): SE quem pede é docente ou administrador, ENTÃO O SISTEMA DEVE responder 403 `forbidden`; SE não há sessão, ENTÃO 401 `not-authenticated` (RN-05).
- [x] **CA-05** (ubíquo): O SISTEMA NÃO DEVE devolver, no item, nenhum campo além dos do contrato (RN-03).
- [x] **CA-06** (estado): ENQUANTO há sala aberta numa turma do estudante, O SISTEMA DEVE mostrar a faixa em toda tela de `/app/**`, com o título, o nome da turma e o botão "Entrar na aula" apontando para `/app/classes/{id}/live`.
- [x] **CA-07** (estado): ENQUANTO duas turmas do estudante têm sala aberta, O SISTEMA DEVE mostrar uma linha para cada uma.
- [x] **CA-08** (estado): ENQUANTO não há sala aberta, O SISTEMA NÃO DEVE mostrar a faixa nem reservar espaço para ela.
- [x] **CA-09** (estado): ENQUANTO o estudante está dentro da sala ao vivo (`/app/classes/{id}/live`), O SISTEMA NÃO DEVE mostrar a faixa.
- [x] **CA-10** (ubíquo): O SISTEMA NÃO DEVE mostrar a faixa para docente nem para administrador.
- [x] **CA-11** (evento): QUANDO passam 20 segundos com a aba visível, O SISTEMA DEVE consultar de novo e mostrar ou esconder a faixa conforme a resposta; QUANDO a aba volta a ficar visível, DEVE consultar na hora; ENQUANTO a aba está escondida, NÃO DEVE consultar.
- [x] **CA-12** (indesejado): SE a consulta falha, ENTÃO O SISTEMA DEVE esconder a faixa, sem mensagem de erro, e tentar de novo na próxima consulta.
- [x] **CA-13** (ubíquo): O SISTEMA DEVE fazer a consulta só pelo serviço de classroom, e o botão DEVE ter alvo de toque de no mínimo 44 px, nos temas claro e escuro.
- [x] **CA-14** (estado): ENQUANTO a sala continua aberta depois do horário da aula da agenda (docente tirando dúvidas), O SISTEMA DEVE continuar devolvendo a sala e mostrando a faixa, até a docente encerrá-la (RN-07).
- [x] **CA-15** (estado): ENQUANTO o estudante tem salas abertas em mais de uma turma, O SISTEMA DEVE devolver todas, da mais recente para a mais antiga, e a faixa DEVE mostrar as linhas nessa ordem (RN-08).

## 8. Plano de Testes (Test Plan)

- **Backend, service (`classroom`):** o estudante recebe o que o repositório achou, na ordem dele e só o dele (CA-01, CA-15); sem sala, lista vazia e não nula (CA-02); docente e administrador são recusados antes de consultar (CA-04). Os filtros de matrícula, sala e turma ficam na consulta e são testados no repository (CA-03, CA-14, CA-15).
- **Backend, handler (`classroom`):** 200 com item e só os campos do contrato (CA-01, CA-05); 200 vazio (CA-02); 403 `forbidden` para docente e administrador (CA-04); 401 sem sessão (CA-04).
- **Backend, repository (integração com PostgreSQL):** a consulta única devolve só salas `ACTIVE` de matrículas `ACTIVE` de turmas não excluídas, entre vários estudantes e turmas (CA-03, RN-06).
- **Frontend, `classroomService.test.ts`:** a chamada a `GET /me/live` devolve a lista tipada e vazia quando não há sala (CA-01, CA-02).
- **Frontend, teste da faixa (componente novo):** mostra título, turma e o botão com o destino certo (CA-06); uma linha por turma, na ordem recebida (CA-07, CA-15); some e não ocupa espaço sem sala (CA-08); falha esconde a faixa sem erro (CA-12); consulta a cada 20 segundos, na volta da aba e não com a aba escondida, com relógio simulado (CA-11).
- **Frontend, `AppShell.test.tsx`:** a faixa aparece para estudante, não aparece para docente nem administrador (CA-10), e não aparece em `/app/classes/{id}/live` (CA-09).
- **Manual:** (1) entrar como estudante com matrícula ativa na página inicial; (2) como docente, iniciar a sala da turma; (3) conferir que a faixa aparece em até 20 segundos e que "Entrar na aula" leva à tela de espera; (4) encerrar a sala e conferir que a faixa some; (5) repetir nos temas claro e escuro e no celular (CA-06, CA-13). Justificativa: a leitura visual e o toque no celular não são automatizáveis.
- **Cobertura:** acima de 80% no escopo da spec, medida com `go test -cover` e com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051 (seção da sala e RN-01), SPEC-053 (aviso da Agenda, CA-14), SPEC-054 (sala de espera), `backend/internal/modules/classroom/` (handler, service, repository), `backend/internal/modules/classgroup/repository/repository.go` (`ListStudentClassesForMenu`, como referência de matrícula ativa), `frontend/src/components/AppShell/AppShell.tsx`, `frontend/src/services/classroomService.ts`, e o aviso da Agenda em `frontend/src/app/app/classes/[id]/page.tsx` como modelo de comportamento.
2. **Ordem de execução:** (1) testes de backend e de frontend da seção 8, rodar e conferir o vermelho pelo motivo certo; (2) commit `test(backend)` e `test(frontend)` com os testes vermelhos; (3) consulta no repository, service e handler, com a rota `GET /me/live`; (4) método no `classroomService`; (5) componente da faixa e encaixe no `AppShell`; (6) mensagens em `messages/pt-BR.ts`; (7) rodar testes, ESLint, Stylelint e verificação de tipos; (8) commits `feat(backend)` e `feat(frontend)`; (9) status `Implementada` e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend:** `backend/internal/modules/classroom/repository/`, `service/` e `handler/` (consulta, regra e rota) e seus testes.
   - **Frontend:** `frontend/src/components/AppShell/AppShell.tsx` e seu teste e estilo; novo componente da faixa com teste e estilo, em `frontend/src/components/`; `frontend/src/services/classroomService.ts` e seu teste; `frontend/src/messages/pt-BR.ts`.
   - Qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80% no escopo, ESLint e Stylelint sem erros, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 15/10/2026, aprovadas como recomendadas: faixa em todas as telas do estudante (e não só na página inicial) e atualização por consulta a cada 20 segundos (e não por WebSocket).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 15/10/2026 | Aruna Architect | Criação em Rascunho, a pedido do Tech Lead |
| 15/10/2026 | Aruna Architect | Aprovada pelo Tech Lead, com a observação de que pode haver mais de uma aula ao mesmo tempo e de que há docentes que mantêm a sala aberta para tirar dúvidas: RN-07, RN-08, CA-14, CA-15 e testes correspondentes; pendências P-01 e P-02 resolvidas como recomendado |
| 20/10/2026 | Implementador | Implementada, com CA-01 a CA-15 conferidos contra o código e os testes. Backend (CA-01 a CA-05, CA-14, CA-15): `handler_myrooms_test.go`, `service_myrooms_test.go` e `repository_myrooms_test.go`. Tela (CA-06 a CA-12): `LiveNowBanner.test.tsx` e `AppShell.test.tsx` (CA-09 e CA-10). CA-13 conferida no código: a consulta passa só por `classroomService.listMyLive` e o botão tem `min-height: 2.75rem` (44 px). Medição de cobertura e lint, a mesma da SPEC-071 (mesmos pacotes e pastas). Nenhum desvio |
