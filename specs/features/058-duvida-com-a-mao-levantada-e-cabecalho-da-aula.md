# SPEC-058: Dúvida junto da Mão Levantada e Cabeçalho da Aula ao Vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-058 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (backend, com migração `00033`); `frontend/src/components/Classroom/`, `frontend/src/components/TopicStudy/` (só o modo de aula ao vivo) |
| **Contexto de tela** | Sala do aluno (faixa de controles), painel do professor (lista de mãos) e cabeçalho do módulo na aula ao vivo |
| **Prioridade** | Média |
| **Depende de** | SPEC-051 (mão levantada), SPEC-055 (painel), SPEC-057 (palco e faixa de controles) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026, a pedido do professor: mostrar no cabeçalho do módulo (o título da tela de estudo) quanto tempo tem de aula e quantos alunos levantaram a mão; e, ao levantar a mão, o aluno já formula a pergunta por texto, **sem ser obrigatório**, para agilizar |

---

## 1. Contexto e Problema (Context & Problem Statement)

- O cabeçalho do módulo, na aula ao vivo, mostra só o título. Nem o professor nem o aluno veem **quanto tempo de aula** passou nem **quantas mãos** estão levantadas.
- Hoje a mão levantada não diz o que o aluno quer. O professor para, dá a palavra e só então descobre a dúvida, e a aula perde ritmo.

## 2. Objetivos (Goals)

- O cabeçalho do módulo mostra o **tempo de aula** e o **número de mãos levantadas**, igual para o professor e para os alunos.
- O aluno pode **escrever a dúvida** ao levantar a mão, sem obrigação e sem atrasar quem só quer levantar a mão; o professor lê a dúvida de cada mão no painel.

### 2.1. Fora de escopo (Non-Goals)

- Chat da turma, respostas por escrito do professor ou conversa entre alunos.
- Mostrar a dúvida de um aluno aos outros alunos.
- Anexos, formatação ou imagens na dúvida.
- Cabeçalho com tempo e mãos no modo lâminas (lá o painel do professor e a faixa do aluno já mostram o tempo; as mãos ficam no painel).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Cabeçalho do módulo (`TopicStudy`, modo de aula ao vivo, dentro do palco).** À direita do título, dois indicadores, **iguais para o professor e para os alunos** (SPEC-057, CA-22): o **tempo de aula** (`hh:mm:ss`, contado desde o início da aula, `startedAt`, com relógio local que se corrige a cada instantâneo) e as **mãos levantadas** (ícone de mão e o número; `0` quando ninguém levantou, com o rótulo de acessibilidade "N mãos levantadas"). O número acompanha em tempo real o levantar e o baixar. Fora da aula ao vivo, o cabeçalho não muda.
- **Aluno, na faixa de controles (SPEC-057).** O botão **Levantar a mão** levanta a mão **com um clique**, sem pedir nada. Com a mão levantada, na própria faixa (sem painel por cima do material) aparece um **campo de texto** "Escreva sua dúvida (opcional)", até **300 caracteres**, com o contador, e o botão **Enviar dúvida** (ou Enter). Enviada, o campo mostra "Dúvida enviada" e pode ser **editada** e reenviada enquanto a mão estiver levantada. **Baixar a mão** apaga a dúvida. Quem reconecta com a mão levantada vê a mão e a dúvida de volta.
- **Professor, no painel (`/live`).** Cada mão da lista mostra o **nome**, **há quanto tempo** está levantada e a **dúvida**, quando houver (texto simples, com quebra de linha; sem dúvida, só o nome). As ações existentes (baixar a mão, baixar todas) continuam. Os alunos e a janela de apresentação **não recebem** o texto da dúvida.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Migração `00033`:** coluna `question` (texto, nula) na tabela das mãos levantadas.
- **`live:hand:raise`** passa a aceitar `{"question": string}` **opcional**. A mão é levantada com ou sem texto. Se o aluno já tem mão levantada, a mensagem **só atualiza a dúvida** (idempotente). O texto é aparado das pontas, tem de 0 a **300 caracteres** (contados por caractere, não por byte), sem caracteres de controle (exceto quebra de linha, no máximo 3 seguidas); vazio vale "sem dúvida". Acima do limite, a mensagem é rejeitada com log `classroom message rejected` e a mão não muda. Só aluno aceito envia; as regras de papel e de limite de taxa são as de hoje.
- **`live:hand:lower`** e a moderação do professor apagam a dúvida junto com a mão.
- **Quem recebe o quê:** `live:hand:queue` ao **painel** leva `question` em cada item (`{studentId, name, requestedAt, question}`, `question` vazia quando não há); ao **aluno aceito** e à **janela de apresentação** leva os itens **sem** `question`. O `live:snapshot` do painel traz as dúvidas em `handRaises`; o do aluno traz `myHand: {"raised": bool, "question": string}` (a dele, para restaurar o campo); o da apresentação, as mãos sem texto.
- A dúvida é guardada com a mão, na mesma sessão da aula, e fica no registro da aula; é texto simples e a tela a mostra como texto (nunca como HTML).

## 4. Modelo de Dados (Data Model)

`live_classroom_hand_raises` (a tabela das mãos, SPEC-051) ganha a coluna `question TEXT NULL`. A migração é a `00033`, com reversão. Sem outra tabela.

## 5. Contrato de API (API Contract)

- **Cliente (aluno) → servidor:** `live:hand:raise {"question"?: string}` (0 a 300 caracteres); `live:hand:lower {}` como antes.
- **Servidor → painel:** `live:hand:queue {"queue": [{studentId, name, requestedAt, question}]}`; **servidor → alunos e apresentação:** `live:hand:queue {"queue": [{studentId, name, requestedAt}]}`.
- **Instantâneos:** painel, `handRaises[].question`; aluno aceito, `myHand {raised, question}`; apresentação, sem texto.
- Sem mudança nos endpoints REST, salvo o que `GET /classes/:id/live/active` devolve em `handRaises` para o professor (com `question`).

## 6. Impacto e Riscos (Impact & Risks)

- **Texto livre de aluno chegando ao professor.** Mitigação: limite de 300 caracteres, controle de caracteres, exibição só como texto, e só aluno aceito envia.
- **Dado novo guardado.** Mitigação: coluna nula, na sessão da aula, sem dado pessoal além do que já há (o nome da mão).
- **Atraso para quem só quer levantar a mão.** Mitigação: um clique levanta a mão; a dúvida é sempre opcional e vem depois.
- **Conflito com a SPEC-057** (mesma faixa de controles, mesmo hook e mesmo `ws.go`). Mitigação: esta spec só é implementada depois da SPEC-057.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O cabeçalho do módulo na aula ao vivo DEVE mostrar o tempo de aula (`hh:mm:ss`, desde o início da aula) e o número de mãos levantadas, iguais para o professor e para os alunos.
- [ ] **CA-02** (evento): QUANDO um aluno levanta ou baixa a mão, O SISTEMA DEVE atualizar o número de mãos levantadas do cabeçalho de todos em até 300 ms.
- [ ] **CA-03** (evento): QUANDO o aluno aciona "Levantar a mão", O SISTEMA DEVE levantá-la com um clique, sem exigir texto.
- [ ] **CA-04** (estado): ENQUANTO a mão do aluno estiver levantada, a faixa de controles DEVE mostrar o campo "Escreva sua dúvida (opcional)" de até 300 caracteres, com o contador, e o envio por botão ou Enter; DEVE permitir editar e reenviar; e DEVE mostrar "Dúvida enviada".
- [ ] **CA-05** (evento): QUANDO o aluno baixa a mão, ou o professor a baixa, O SISTEMA DEVE apagar a dúvida junto.
- [ ] **CA-06** (ubíquo): O painel do professor DEVE mostrar, em cada mão, o nome, há quanto tempo está levantada e a dúvida (quando houver), como texto; e os alunos e a janela de apresentação NÃO DEVEM receber o texto da dúvida.
- [ ] **CA-07** (evento): QUANDO o aluno reconecta com a mão levantada, O SISTEMA DEVE devolver a mão e a dúvida dele (`myHand`); e o painel DEVE mostrar as dúvidas ao recarregar.
- [ ] **CA-08** (ubíquo): O servidor DEVE aceitar `live:hand:raise` com `question` opcional, apará-la, rejeitar a de mais de 300 caracteres ou com caracteres de controle indevidos (sem alterar a mão), tratar o reenvio como atualização da dúvida, e aceitar só de aluno aceito.
- [ ] **CA-09** (ubíquo): O cabeçalho do `TopicStudy` fora da aula ao vivo e o restante da tela de estudo NÃO DEVEM mudar; os testes existentes passam sem alteração; `engine/core` não é alterado.
- [ ] **CA-10** (ubíquo): Stylelint, ESLint, `tsc` e `go vet` limpos; cobertura acima de 80% no escopo; migração `00033` aplicada e revertida sem erro.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `repository`:** a coluna `question` é gravada na mão, lida na fila, atualizada no reenvio e apagada ao baixar; a migração `00033` sobe e desce (CA-05, CA-07, CA-10).
- **Backend, `service` e `handler`:** `live:hand:raise` com e sem `question`; aparo; limite de 300 caracteres (por caractere, com acento e emoji); caracteres de controle; reenvio atualiza; só aluno aceito; a fila do painel leva `question` e a de aluno e da apresentação não; `myHand` no instantâneo do aluno; dúvidas em `handRaises` do painel (CA-06, CA-07, CA-08).
- **Frontend, cabeçalho:** `TopicStudy` no modo ao vivo mostra o tempo e as mãos, atualiza o número com a fila, e o relógio se corrige pelo instantâneo; fora do modo ao vivo o cabeçalho é o mesmo de hoje (CA-01, CA-02, CA-09).
- **Frontend, faixa do aluno:** o clique levanta a mão sem texto; o campo aparece com a mão levantada, conta caracteres, limita a 300, envia por botão e Enter, mostra "Dúvida enviada", pode ser editado e some ao baixar; reconectar restaura (CA-03, CA-04, CA-05, CA-07).
- **Frontend, painel:** cada mão mostra o nome, o tempo e a dúvida como texto (sem HTML); sem dúvida mostra só o nome (CA-06).
- **Regressão:** os testes existentes do `TopicStudy`, da tela de estudo e da SPEC-055/057 passam sem alteração (CA-09).
- **Manual:** um aluno levanta a mão sem texto; outro levanta e escreve; o professor lê as duas no painel e baixa uma; o número no cabeçalho do professor e dos alunos acompanha; o tempo corre igual nas telas.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051, SPEC-055, SPEC-057 e esta; `backend/internal/modules/classroom/**` (`domain`, `repository`, `service`, `handler/ws.go`), `backend/migrations/`; `frontend/src/components/Classroom/**`, `components/TopicStudy/**` (modo ao vivo), `hooks/useLiveClassroom.ts`, `services/classroomService.ts`.
2. **Ordem de execução:** só depois da SPEC-057 implementada. Testes vermelhos e commit `test`; migração, repositório, serviço e handler; frontend (cabeçalho, faixa do aluno, painel); mensagens.
3. **Arquivos a criar ou alterar:** `backend/migrations/00033_hand_raise_question.sql` (no formato das anteriores), `backend/internal/modules/classroom/**`; `frontend/src/components/Classroom/**`, `components/TopicStudy/**` (só o modo ao vivo), `hooks/useLiveClassroom.ts`, `services/classroomService.ts`, `messages/pt-BR.ts`. **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, migração aplicada no banco local, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu o cabeçalho com tempo e mãos e a dúvida opcional por texto; o limite de **300 caracteres**, o campo **na faixa de controles** (sem painel por cima) e a dúvida **visível só ao professor** são escolhas da Aruna e devem ser revisadas. Alternativa descartada: mostrar a dúvida aos outros alunos (pode virar spec própria, de chat).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; os limites e a visibilidade da dúvida ficam para a revisão dele |
| 14/10/2026 | Aruna Architect | Implementada (backend `893985e`, `91d0740`; frontend `97e7bab`, `d261ca9`). Desvios: a coluna tem `CHECK` de 300 caracteres; a tabela é `live_hand_raises`; o limite do quadro da mão foi a 4 KiB; "Dúvida enviada" é otimista (o servidor não confirma); a dúvida é apagada ao baixar a mão, então o histórico não guarda o texto; o relógio usa a hora local da máquina; sem verificação no navegador |
