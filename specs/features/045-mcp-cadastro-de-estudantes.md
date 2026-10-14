# SPEC-045: Ferramenta MCP para Cadastrar Estudantes

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-045 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Backend |
| **Módulo** | `mcp` (ferramenta); reutiliza `student` e `classgroup` |
| **Contexto de tela** | Não se aplica (servidor MCP) |
| **Prioridade** | Média |
| **Depende de** | SPEC-024, SPEC-041 |
| **Substitui** | Nenhuma (tira da lista "fora de escopo" da SPEC-024 apenas o cadastro de estudantes) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "usando o MCP do projeto, vamos adicionar 10 alunos de teste" e "devemos fazer isso via MCP" |

---

## 1. Contexto e Problema (Context & Problem Statement)

O servidor MCP (SPEC-024) cobre só a autoria de módulos. Para montar uma turma de teste, a docente cadastra estudantes um a um pela interface web (SPEC-041) ou por CSV. Um agente conectado ao MCP não tem como criar estudantes, nem de teste, e o Tech Lead pediu que isso seja feito pelo MCP.

## 2. Objetivos (Goals)

- Uma ferramenta MCP, `create_students`, cadastra de 1 a 50 estudantes de uma vez e, se for informada uma turma, matricula os que foram criados.
- A ferramenta não tem regra própria: o cadastro é o do `student` (RN-03 e RN-02 da SPEC-041) e a matrícula é a do `classgroup` (SPEC-041 RN-03 a RN-06).
- Cada estudante do lote é tratado sozinho: um rejeitado não impede os outros.

### 2.1. Fora de escopo (Non-Goals)

- Listar, editar, desativar ou excluir estudantes; importar CSV; ferramentas de turma.
- Definir senha: o estudante recebe o e-mail de boas-vindas e define a sua, como no cadastro manual.
- Mudar o cadastro manual do `student` ou a matrícula do `classgroup`.
- Qualquer alteração de frontend.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend

Não se aplica nesta spec.

### 3.2. Backend (Go — Camada de Módulo/Service)

Nova ferramenta no catálogo do MCP, escrita (grava), em inglês, como as demais:

| Entrada | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `students` | lista de objetos | Sim | de 1 a 50 itens (RN-01) |
| `students[].academicId` | texto | Sim | RA: 7 dígitos, com "a" opcional na frente (SPEC-041 RN-01) |
| `students[].email` | texto | Sim | e-mail válido (SPEC-041 RN-02) |
| `students[].name` | texto | Não | nome do estudante |
| `classId` | UUID | Não | turma em que matricular os estudantes criados |

Regras:

- **RN-01 (lote):** de 1 a 50 estudantes. Lista vazia ou maior que 50 é erro de validação do campo `students`, sem criar ninguém.
- **RN-02 (cadastro):** cada item chama o cadastro manual do `student` sem turma. A ferramenta não valida RA nem e-mail por conta própria (SPEC-024 RN-04): a recusa vem do service e é devolvida no item.
- **RN-03 (item rejeitado):** um item recusado entra em `rejected` com sua posição na lista (`index`), o RA e o e-mail recebidos, o `type` do problema (`invalid-academic-id`, `invalid-email`, `email-already-registered`, `academic-id-already-registered`) e o `detail`. Os demais itens seguem.
- **RN-04 (matrícula):** com `classId`, depois do cadastro, os estudantes criados são matriculados pela matrícula do `classgroup`, que decide por posse (docente dona ou administrador) e recusa turma arquivada. Se a matrícula for recusada, os estudantes **continuam criados** e o resultado traz o erro da matrícula em `enrollment.error`; a ferramenta não desfaz o cadastro. `classId` que não é UUID é erro de validação antes de criar qualquer estudante.
- **RN-05 (papéis, limites e auditoria):** vale a SPEC-024: só `ADMIN` e `TEACHER` (RN-03), taxa de gravação compartilhada (RN-10) e registro no log estruturado (RN-11) com o usuário, a ferramenta, a turma e as quantidades de criados e rejeitados, **sem RA, e-mail nem nome**.
- **RN-06 (descoberta):** a descrição da ferramenta, em inglês, informa o formato do RA, o limite do lote e que o estudante recebe o e-mail para definir a senha.

Resultado da ferramenta:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `created` | lista | Sim | por estudante criado: `studentId`, `academicId`, `email` |
| `rejected` | lista | Sim | itens recusados (RN-03) |
| `enrollment` | objeto | Só com `classId` | `classId`, `enrolled` (quantidade), `alreadyEnrolled` (quantidade), `rejected` (lista de `studentId` e `reason`) ou, se recusada, `error` com `type` e `detail` |

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não há endpoint REST novo. O contrato é a ferramenta `create_students` da seção 3.2, no `/mcp`, com o mesmo formato de erro estruturado da SPEC-024 RN-06.

## 6. Impacto e Riscos (Impact & Risks)

- **Criação em massa de contas.** Mitigação: limite de 50 por chamada, taxa de gravação compartilhada (SPEC-024 RN-10) e acesso só de `ADMIN` e `TEACHER`.
- **Dado pessoal no log.** Mitigação: o log tem só quantidades e ids de turma e de usuário (RN-05).
- **Estudantes criados e matrícula recusada.** Mitigação: o resultado diz isso claramente (RN-04) e o agente pode matricular de novo pela interface.
- **E-mails de boas-vindas** vão para a fila de e-mails; em desenvolvimento ficam no Mailpit. Estudantes de teste devem usar endereços de teste.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O catálogo do MCP DEVE ter a ferramenta `create_students`, de escrita, com a descrição da RN-06.
- [ ] **CA-02** (evento): QUANDO o agente chama `create_students` com estudantes válidos, O SISTEMA DEVE criá-los e devolvê-los em `created`.
- [ ] **CA-03** (evento): QUANDO é informado `classId` de turma que o usuário pode gerir, O SISTEMA DEVE matricular os estudantes criados e devolver `enrollment` com as quantidades.
- [ ] **CA-04** (indesejado): SE um item é recusado (RA ou e-mail inválido ou já cadastrado), ENTÃO O SISTEMA DEVE listá-lo em `rejected` com `index` e `type` e criar os demais.
- [ ] **CA-05** (indesejado): SE a lista tem menos de 1 ou mais de 50 itens, ou `classId` não é UUID, ENTÃO O SISTEMA DEVE devolver erro de validação e não criar ninguém.
- [ ] **CA-06** (indesejado): SE a matrícula é recusada (turma de outro docente, inexistente ou arquivada), ENTÃO O SISTEMA DEVE manter os estudantes criados e devolver `enrollment.error`.
- [ ] **CA-07** (ubíquo): A ferramenta DEVE ser recusada para quem não é `ADMIN` ou `TEACHER` e DEVE respeitar a taxa de gravação.
- [ ] **CA-08** (ubíquo): O log da chamada NÃO DEVE conter RA, e-mail nem nome.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Backend, `mcp/service`:** `TestCreateStudents` cobre CA-02, CA-03, CA-04, CA-05, CA-06, CA-08 (com fakes do `student` e do `classgroup` em `mcptest`) e a taxa de gravação do CA-07.
- **Backend, `mcp/domain`:** o teste do catálogo passa a contar a nova ferramenta (18 ferramentas, 12 de escrita). Cobre CA-01.
- **Backend, `mcp/handler`:** a lista de ferramentas inclui `create_students`; um chamado por um `STUDENT` é recusado. Cobre CA-01 e CA-07.
- **Cobertura:** acima de 80% no `mcp` (`go test -cover`).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-024 (RN-03, RN-04, RN-06, RN-10, RN-11), SPEC-041 (seção 5 e RN-01 a RN-06); `backend/internal/modules/mcp/service/grading.go` como modelo de ferramenta com porta própria.
2. **Ordem de execução:** (1) testes vermelhos e commit `test(mcp)`; (2) porta `Students` e `WithStudents`; (3) entrada no catálogo e no handler; (4) ligação em `cmd/api/main.go`; (5) cobertura.
3. **Arquivos a criar ou alterar:** `mcp/domain/domain.go`, `mcp/domain/catalog.go` (e `domain_test.go`), `mcp/service/students.go` (novo) e `students_test.go` (novo), `mcp/mcptest/students.go` (novo), `mcp/handler/handler.go` (e `handler_test.go`), `backend/cmd/api/main.go`; e uma nota na seção "fora de escopo" da SPEC-024.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: cadastrar estudantes pelo MCP.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao mandar fazer o cadastro de estudantes pelo MCP |
| 14/10/2026 | Implementador | Implementada: ferramenta `create_students`, porta `Students`/`Enrollments`, fakes em `mcptest` e ligação em `cmd/api/main.go`. Os testes ficaram vermelhos por não compilar (símbolos ainda inexistentes) |
