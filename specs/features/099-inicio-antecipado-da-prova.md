# SPEC-099: Início Antecipado da Prova pela Docente

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-099 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: o início antes do horário, o período ajustado e o e-mail aos alunos; frontend: o botão *Iniciar a prova* e a sala antes do horário) |
| **Contexto de tela** | O detalhe da avaliação e a sala da prova (`/room`) |
| **Prioridade** | Média |
| **Depende de** | SPEC-042 (a caixa de saída de e-mails), SPEC-075 (o período e a fase pelo relógio), SPEC-083 e SPEC-089 (o início pela docente), SPEC-090 (o prazo da tentativa), SPEC-091 e 096 (a sala da prova, a admissão e finalizar) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-083 RN-01 (mantida pela SPEC-089), a exigência da fase `RUNNING` para iniciar, e na SPEC-091 D-01 a sala que só abre no horário marcado. |
| **Fontes canônicas** | Pedido do Tech Lead no roteiro manual de 04/11/2026: a docente deve poder iniciar a prova antes do horário marcado, por exemplo quando adiantou a aula ou ficou livre para aplicá-la. Decisão do Tech Lead de 05/11/2026: "pode abrir a prova para fazer antes, tipo 1 hora, mas os alunos devem ser avisados sobre isso via e-mail; fora desse intervalo não é permitido". |

---

## 1. Contexto e Problema (Context & Problem Statement)

O botão *Iniciar a prova* fica travado até o horário marcado ("A prova pode ser iniciada a partir de DD/MM/AAAA, HH:MM."), e a sala da prova só abre nesse horário (SPEC-083 RN-01, SPEC-091 D-01). A agenda real muda: a aula adianta, a turma termina outra atividade mais cedo, e a docente quer aplicar a prova na hora, sem reagendar e esperar o relógio.

## 2. Objetivos (Goals)

- A docente **inicia a prova até 1 hora antes do horário marcado** (D-03); antes disso, não.
- O **período da prova acompanha o início**: começa agora e mantém a mesma duração, para ninguém perder tempo (D-01, D-02).
- A **sala da prova abre 1 hora antes do horário**, para a docente iniciar por ela e os alunos já esperarem (D-04).
- Os **alunos elegíveis recebem um e-mail** quando a prova é iniciada antes do horário (D-05).
- O histórico registra que a prova foi iniciada antes do horário marcado.

### 2.1. Fora de escopo (Non-Goals)

- Iniciar mais de 1 hora antes do horário marcado (para isso, reagendar, SPEC-075).
- Iniciar uma atividade (`ASSIGNMENT`): continua abrindo pelo relógio (SPEC-089 RN-01).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Detalhe da avaliação e sala:** na hora anterior ao horário marcado, o botão **Iniciar a prova** fica liberado e a frase vira "Marcada para HH:MM. Você pode iniciar agora." Antes dessa hora, continua travado, com "A prova pode ser iniciada a partir de HH:MM (1 hora antes do horário marcado)."
- **Diálogo de início antecipado:** "Iniciar a prova agora, antes do horário marcado (HH:MM)? O período passa a ser de HH:MM (agora) a HH:MM, com a mesma duração, e os alunos recebem um e-mail avisando." Confirmado, a sala abre como hoje.
- **Sala da prova antes do horário:** a docente abre a sala 1 hora antes do horário marcado; os alunos que abrem a prova nessa hora ficam na sala de espera (SPEC-091 RN-02), já que a prova ainda não começou.
- **Detalhe depois do início antecipado:** "Prova iniciada às HH:MM por <nome>, antes do horário marcado (HH:MM)." O período mostrado é o novo.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Iniciar** (`Start`, SPEC-083): passa a aceitar a fase `UPCOMING` quando faltam até 60 minutos para o `starts_at` (D-03, pelo relógio do servidor); com mais de 60 minutos, `409 assessment-not-open-yet`. Nesse caso, numa transação: `starts_at` vira agora, `ends_at` vira agora mais a duração original (`ends_at − starts_at`, D-02), grava `started_at`/`started_by` e o evento `STARTED` com o período antigo e o novo (D-06). Iniciar na fase `RUNNING` continua como hoje (o período não muda).
- **A composição congela** no início, como já faz pelo `starts_at` (SPEC-075 RN-10): com o `starts_at` em agora, ela congela no mesmo instante.
- **A sala** (`EnterRoom`): a docente entra a partir de 60 minutos antes do `starts_at`; o aluno também, e fica esperando (SPEC-091 RN-02, SPEC-096).
- **O e-mail aos alunos** (D-05): no início antecipado, na mesma transação, entra na caixa de saída de e-mails da SPEC-042 uma mensagem para cada aluno elegível: assunto "Prova iniciada antes do horário: <título>", e o texto "A docente iniciou a prova <título> às HH:MM, antes do horário marcado (HH:MM). O término passou para HH:MM. Entre na plataforma para fazer a prova: <link da avaliação>." O envio e as novas tentativas são os da caixa de saída.
- **O prazo da tentativa** usa o período novo (SPEC-090 RN-03), sem mudança no cálculo.

## 4. Modelo de Dados (Data Model)

Nenhuma coluna nova. Os e-mails usam a caixa de saída da SPEC-042 como está. No início antecipado, o evento `STARTED` do histórico preenche `old_starts_at`/`old_ends_at` (o período marcado) e `new_starts_at`/`new_ends_at` (o período novo), as mesmas colunas que o reagendamento já usa (SPEC-075 RN-15); no início no horário, ficam vazias como hoje.

## 5. Contrato de API (API Contract)

| Rota | Mudança |
| :--- | :--- |
| `POST .../assessments/{id}/start` (SPEC-083) | Aceita a fase `UPCOMING` até 60 minutos antes do `starts_at`; responde o resumo com o período novo e põe os e-mails na caixa de saída |
| `GET .../room/ws` (SPEC-091) | Aceita a conexão a partir de 60 minutos antes do `starts_at` |

**Erros:** `409 assessment-not-open-yet` continua para quem tenta iniciar ou entrar na sala **mais de 60 minutos antes** do horário marcado; o resto como hoje.

## 6. Impacto e Riscos (Impact & Risks)

- **Aluno que conta com o horário marcado** chega depois e encontra a prova correndo. **Mitigação:** o e-mail avisa na hora (D-05); ele entra pela admissão (SPEC-096) e tem o tempo até o novo término; a antecipação é de no máximo 1 hora.
- **O calendário da turma** passa a mostrar o horário novo, porque mostra o período da avaliação.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente inicia a prova até 60 minutos antes do horário marcado, O servidor DEVE gravar o início, mover o período para começar agora com a mesma duração e registrar no histórico o período antigo e o novo; com mais de 60 minutos, `409 assessment-not-open-yet` (D-01 a D-03, D-06).
- [x] **CA-02** (evento): QUANDO a docente inicia na fase `RUNNING`, O período NÃO DEVE mudar (como hoje).
- [x] **CA-03** (estado): ENQUANTO faltam até 60 minutos para o horário marcado e a prova não começou, A sala DEVE aceitar a docente e deixar os alunos na sala de espera; antes disso, DEVE recusar (D-04).
- [x] **CA-06** (evento): QUANDO a prova é iniciada antes do horário, O servidor DEVE pôr na caixa de saída um e-mail para cada aluno elegível, com o título, o horário do início, o horário marcado, o novo término e o link; QUANDO é iniciada no horário, NÃO DEVE enviar e-mail (D-05).
- [x] **CA-04** (estado): ENQUANTO faltam até 60 minutos para o horário marcado, O detalhe e a sala DEVEM ter *Iniciar a prova* liberado, com a frase e o diálogo da seção 3.1; antes, travado com a frase da hora em que libera; depois do início, a frase "antes do horário marcado".
- [x] **CA-05** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`.

## 8. Plano de Testes (Test Plan)

- **Backend (Go):** `service`: o início antecipado move o período, grava o evento e põe um e-mail por aluno elegível na caixa de saída; com 61 minutos de antecedência, recusa; na fase `RUNNING`, não mexe no período nem manda e-mail; a sala com 60 minutos de antecedência e a recusa antes; `handler`: a rota de início com o período novo.
- **Frontend (Vitest):** `canStart` liberado na hora anterior e travado antes; o diálogo com o período novo e o aviso do e-mail; a frase depois do início.
- **Roteiro manual:** criar uma prova para daqui a 50 minutos, iniciar agora, conferir o período novo, o histórico, o e-mail no Mailpit e a entrada dos alunos pela admissão; numa prova para daqui a 2 horas, conferir que o início fica travado.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-075, 083, 089, 090, 091 e 096.
2. **Arquivos:** `backend/internal/modules/assessment/` (`service/start.go`, `service/room.go`, o evento, a porta do e-mail), `backend/cmd/api` (a ligação com a caixa de saída de `platform/mailer`), `frontend/src/lib/assessment.ts` (`canStart`), o diálogo de início (`AssessmentStartDialog`), o detalhe, a sala e `messages/pt-BR.ts`.
3. Testes antes, vermelhos, num commit `test(...)`; depois o código.

## 10. Decisões (antes: pendências para aprovação)

| ID | Decisão |
| :--- | :--- |
| D-01 | **O início do período passa a ser o instante do início** (recomendação). |
| D-02 | **O término anda junto, mantendo a mesma duração** (recomendação). |
| D-03 | **Até 1 hora antes do horário marcado; fora desse intervalo não é permitido** (decisão do Tech Lead de 05/11/2026). |
| D-04 | **A sala abre 1 hora antes**, acompanhando a D-03. |
| D-05 | **Os alunos elegíveis recebem um e-mail** quando a prova é iniciada antes do horário (decisão do Tech Lead de 05/11/2026), pela caixa de saída da SPEC-042. |
| D-06 | **O histórico guarda o período antigo e o novo** (recomendação). |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a partir do pedido do Tech Lead de 04/11/2026. Pendências D-01 a D-06. |
| 05/11/2026 | Aruna Architect | Decisões do Tech Lead incorporadas: D-03 até 1 hora antes, e fora disso não; D-05 e-mail aos alunos elegíveis no início antecipado (CA-06 novo); D-04 a sala abre 1 hora antes; D-01, D-02 e D-06 com as recomendações. Aguarda o "aprovo". |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo"). Status: `Aprovada` |
| 05/11/2026 | Implementador | Implementada, menos o roteiro manual, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-06, em T1 (backend: `EarlyStartWindow` e `InEarlyHour` no domínio, o `Start` que move o período e grava o antigo e o novo no evento `STARTED`, a sala e o acesso `NOT_STARTED` 1 hora antes), T2 (a porta `Mailer`, o e-mail em português no service e o adaptador `assessmentMail` na caixa de saída da SPEC-042) e T3 (`inEarlyHour`, `canStart`, `earlyPeriod` e `earlyStartFrom`, as frases, o diálogo e a sala). **Medido:** cada tarefa com o vermelho pelo motivo esperado; backend verde (service 83,8%, handler 87,1%, domain 96,2%, `cmd/api` verde); frontend com 613 testes verdes nas pastas da avaliação (as 10 falhas do calendário estão corrigidas na branch `fix/testes-do-calendario`), `tsc` e ESLint limpos. **Desvios:** os e-mails entram na caixa de saída logo depois do início, não na mesma transação; o acesso do aluno na hora antecipada vira `NOT_STARTED`, para o botão *Entrar na prova* levar à sala de espera; a tela usa o relógio do servidor da última leitura e o fuso fixo de Brasília. **Testes alterados depois do vermelho:** o caso "antes do início" da tabela de acesso (SPEC-075) passou de 08:59 para 07:59, por ser uma prova. **Aberto:** o roteiro manual. |
