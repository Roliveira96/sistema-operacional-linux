# Instruções para Agentes de IA

Este arquivo é a **porta de entrada obrigatória** para qualquer agente de IA (Claude, Gemini, Kiro, ChatGPT/Codex ou outro) que atue neste repositório. Os arquivos `CLAUDE.md`, `GEMINI.md` e `AGENTS.md` da raiz apenas apontam para cá. Em caso de divergência, vale este arquivo.

---

## 1. O projeto em uma frase

Plataforma de ensino e avaliação prática da disciplina de Sistemas Operacionais (UTFPR Campus Guarapuava, curso TSI, Profª. Dra. Sediane Carmem Lunardi Hernandes). É a evolução do simulador client-side "Linux na Prática" para uma arquitetura cliente-servidor, desenvolvida como Trabalho de Conclusão de Curso 2. A plataforma gerencia turmas, estudantes, materiais, banco de questões, modelos de avaliação, aplicação de provas e atividades e os resultados.

## 2. Papéis

| Papel | Quem | Responsabilidade |
| :--- | :--- | :--- |
| **Tech Lead** | Ricardo Martins de Oliveira (humano) | Única autoridade para **aprovar** specs e mudar o status para `Aprovada`. Decide qualquer dúvida. |
| **Aruna Architect** | Persona de arquitetura | Redige as specs em `specs/features/`, mantém `ARCHITECTURE.md` e `GLOSSARY.md` e zela pela conformidade arquitetural. |
| **Implementador** | Qualquer agente de IA ou pessoa desenvolvedora | Implementa **exatamente** o que a spec aprovada define. Não redefine escopo, arquitetura nem nomes. |

Salvo pedido explícito do Tech Lead para atuar como Aruna Architect, todo agente atua como **Implementador**.

## 3. Leitura obrigatória antes de qualquer alteração

Na ordem:

1. Este arquivo (`specs/AI_INSTRUCTIONS.md`).
2. `specs/ARCHITECTURE.md`: regras técnicas mandatórias.
3. `specs/GLOSSARY.md`: vocabulário do domínio e nomes em código.
4. A spec da tarefa em `specs/features/`, inteira, e as specs listadas em "Depende de".
5. As fontes canônicas citadas no cabeçalho da spec, quando a spec não for suficiente.

## 4. Fluxo Spec-Driven Development

1. **Nenhuma linha de código de produção sem spec com status `Aprovada`.** Pedido de código sem spec aprovada: o agente para e informa o Tech Lead.
2. Spec em `Rascunho`: só pode ser lida, discutida e revisada, nunca implementada. Uma spec só pode ser aprovada com a seção 10 (Pendências) vazia.
3. Ao concluir a implementação e verificar todos os critérios de aceite, o implementador muda o status para `Implementada` e registra a data no histórico de revisões.
4. Mudança de requisito durante a implementação: **parar**. A spec é revisada primeiro (volta a `Rascunho` se a mudança for substancial) e o código vem depois.
5. Spec substituída por outra: status `Obsoleta`, com a substituta no campo "Substitui" da nova spec. Specs nunca são apagadas.

### 4.1. Ciclo de vida do status

| Status | Significado | Quem altera para este status |
| :--- | :--- | :--- |
| `Rascunho` | Em elaboração ou revisão | Aruna Architect |
| `Aprovada` | Liberada para implementação | **Somente o Tech Lead** |
| `Implementada` | Código entregue e critérios de aceite verificados | Implementador |
| `Obsoleta` | Substituída ou descartada | Aruna Architect, com aval do Tech Lead |

### 4.2. Criação de nova spec

- Copiar `specs/_TEMPLATE.md` para `specs/features/NNN-slug-em-kebab-case.md`.
- `NNN` = maior número existente + 1, com 3 dígitos. O ID `SPEC-NNN` é imutável e nunca reaproveitado.
- A spec é decomposta das fontes canônicas: `docs/arquitetura/transicao-backend.md` (requisitos de negócio e arquitetura da transição) e os capítulos da monografia em `docs/tcc/`.

## 5. Proibições

O agente **não pode**:

- Implementar algo que não esteja na spec, ou que esteja em "Fora de escopo".
- Supor requisitos não documentados. Na dúvida, perguntar (seção 7).
- Inventar nome de domínio. Todo termo vem de `GLOSSARY.md`. Se faltar algum, propor a inclusão antes de usar.
- Violar qualquer regra de `ARCHITECTURE.md`, mesmo "temporariamente".
- Alterar arquivos em `legacy/`, exceto quando uma spec aprovada mandar.
- Colocar código, JSON mockado, SQL ou scripts dentro de documentos de spec.
- Trabalhar fora da branch `projeto-tcc2`.
- Mudar o status de uma spec para `Aprovada`.

## 6. Convenções de idioma

| Artefato | Idioma |
| :--- | :--- |
| Specs, documentação Markdown, conversa | Português |
| Mensagens de commit | Português (Conventional Commits: `feat(modulo): ...`, `fix`, `docs`, `refactor`, `test`, `chore`) |
| **Todo código**: identificadores, comentários, docstrings, logs, mensagens de erro, saídas de CLI, nomes de tabelas, colunas, rotas e valores de enumeração | **Inglês** |
| Texto de interface exibido ao usuário final | Português, centralizado em arquivos de mensagens (nunca espalhado em componentes) |

A tradução PT→EN de cada conceito está em `GLOSSARY.md` e é obrigatória.

## 7. Quando parar e perguntar

Pare e pergunte ao Tech Lead, sem implementar, quando:

- a spec for ambígua, contraditória ou incompleta para um caso concreto;
- a spec contradisser `ARCHITECTURE.md`, `GLOSSARY.md` ou outra spec;
- a implementação exigir alterar arquivos fora da lista da seção 9 da spec;
- surgir necessidade de nova dependência externa não prevista;
- um critério de aceite parecer impossível de verificar.

Ao perguntar, apresente as opções com uma recomendação justificada.

## 8. Entrega

Ao final de cada tarefa, o implementador informa:

1. Spec implementada (ID) e critérios de aceite cobertos.
2. Arquivos criados ou alterados.
3. Resultado dos testes, com números reais. Se algo falhou ou foi pulado, dizer explicitamente.
4. Desvios em relação à spec, com justificativa, ou "nenhum desvio".

## 9. Mapa do repositório

| Caminho | Conteúdo |
| :--- | :--- |
| `specs/` | Governança: este arquivo, `ARCHITECTURE.md`, `GLOSSARY.md`, `_TEMPLATE.md` |
| `specs/features/` | Specs funcionais numeradas (`NNN-slug.md`) |
| `backend/` | Serviço Go (ver `ARCHITECTURE.md`) |
| `frontend/` | Aplicação Next.js (ver `ARCHITECTURE.md`) |
| `legacy/` | Simulador client-side original "Linux na Prática" (TypeScript + Vite + Vitest). Base de conhecimento do motor POSIX/VFS, congelada: serve só para leitura. **Não rode os testes nem o build do legado** como verificação de entrega. |
| `docs/arquitetura/` | Fontes canônicas de requisitos da transição |
| `docs/tcc/` | Monografia em LaTeX (fonte canônica de domínio) |
