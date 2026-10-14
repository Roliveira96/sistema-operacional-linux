# SPEC-061: Tela de Espera Animada no Lugar da Tela Preta

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-061 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `frontend/src/components/Classroom/` |
| **Contexto de tela** | Janela de apresentação do professor e sala do aluno |
| **Prioridade** | Média |
| **Depende de** | SPEC-055 (a tela preta, CA-17), SPEC-057 (palco), SPEC-058 (relógio da aula) |
| **Substitui** | A tela preta da SPEC-055 (CA-17): o que a turma vê no lugar do conteúdo deixa de ser uma tela vazia |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "ao invés de tela preta, quero uma tela animada de espera, colorida, mostrando o título da aula e quanto tempo já rolou" |

---

## 1. Contexto e Problema (Context & Problem Statement)

Quando o professor aciona a **tela preta** (tecla B ou botão), os alunos veem um quadro preto vazio: parece que a aula travou. O professor quer uma **tela de espera** que diga que a aula está de pé, com o título e o tempo decorrido, e que seja agradável de olhar enquanto ele resolve algo.

## 2. Objetivos (Goals)

- No lugar da tela preta, uma **tela de espera animada e colorida**, com o **título da aula** e o **tempo de aula** correndo.
- A mesma tela para o professor e para todos os alunos.

### 2.1. Fora de escopo (Non-Goals)

- Mensagem personalizada do professor na tela de espera.
- Mostrar mãos levantadas, alunos online ou o conteúdo da próxima lâmina.
- Mudar o protocolo: a mensagem do servidor continua a mesma.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **A tela.** Cobre **o palco inteiro** (dentro do `FixedStage`, 1280 × 720 lógicos, igual para todos, SPEC-057), no lugar do véu preto atual. Leva:
  - um **fundo animado e colorido**: um degradê escuro com **manchas de cor** desfocadas (laranja de destaque, azul, verde e âmbar da paleta) que derivam devagar e se misturam; a animação usa **só `transform` e `opacity`**;
  - o **título da aula**, grande e centralizado (o título da sessão ao vivo; se vazio, "Aula ao vivo");
  - o **tempo de aula** em `hh:mm:ss`, em números de largura fixa, que **corre a cada segundo** a partir do início da aula (`startedAt`, o mesmo relógio do cabeçalho da SPEC-058);
  - uma linha curta embaixo: "A aula já vai continuar".
- **Cores.** Só os tokens de `_tokens.scss`; se a paleta pedir novos tokens de degradê, eles são acrescentados ao próprio `_tokens.scss`. Nenhum valor de cor escrito no componente.
- **Movimento reduzido.** Com `prefers-reduced-motion: reduce`, as manchas ficam paradas (degradê estático); o tempo continua correndo.
- **Mesma tela para os dois.** O professor e os alunos veem a mesma tela, no mesmo lugar e com o mesmo tamanho (CA-22 da SPEC-057). O aviso do professor passa a dizer "Tela de espera ligada. Aperte B para voltar."
- **Nomes.** Na interface, "Tela preta" vira **"Tela de espera"** (botão, dica, lista de atalhos, rótulos de acessibilidade); a tecla **B** continua a mesma. No código e no protocolo o estado continua sendo `blank`/`live:stage:blank` (sem mudança de mensagem).
- **Por baixo.** Ao desligar, o conteúdo volta como estava (lâmina, rolagem, módulo, terminal), sem recarregar.

### 3.2. Backend (Go — Camada de Módulo/Service)

Nenhuma mudança. O estado e a mensagem `live:stage:blank {blank}` seguem como estão; só o desenho no frontend muda.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança.

## 5. Contrato de API (API Contract)

Nenhuma mudança.

## 6. Impacto e Riscos (Impact & Risks)

- **Distração.** Uma animação forte atrapalharia. Mitigação: movimento lento e suave, só manchas desfocadas, e a opção de movimento reduzido respeitada.
- **Custo de desenho.** Manchas desfocadas animadas podem pesar em máquinas fracas. Mitigação: poucas manchas, só `transform` e `opacity`, `will-change` restrito, e nada de animar tamanho ou posição por `top` e `left`.
- **Nome interno `blank` diferente do nome na interface.** Mitigação: um comentário no código e no glossário explicam; trocar o nome do protocolo não compensa agora.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o professor aciona a tela de espera (tecla B ou botão), O SISTEMA DEVE cobrir o palco do professor e dos alunos com a tela de espera animada, e NÃO DEVE mostrar uma tela preta vazia.
- [ ] **CA-02** (ubíquo): A tela de espera DEVE mostrar o título da aula e o tempo de aula em `hh:mm:ss` correndo a cada segundo a partir do início da aula, iguais para o professor e os alunos; sem título, DEVE mostrar "Aula ao vivo".
- [ ] **CA-03** (ubíquo): A tela de espera DEVE ser colorida e animada usando só tokens do tema e só `transform` e `opacity` na animação, e DEVE parar o movimento quando o navegador pede movimento reduzido, mantendo o tempo correndo.
- [ ] **CA-04** (ubíquo): A tela de espera DEVE ter o mesmo desenho, tamanho e posição para o professor e para os alunos, dentro do palco.
- [ ] **CA-05** (evento): QUANDO um aluno entra ou reconecta com a tela de espera ligada, O SISTEMA DEVE mostrá-la já na entrada; QUANDO o professor a desliga, DEVE devolver o conteúdo como estava.
- [ ] **CA-06** (ubíquo): Na interface NÃO DEVE restar o texto "Tela preta": o botão, a dica, a lista de atalhos, os rótulos de acessibilidade e o aviso do professor DEVEM dizer "Tela de espera"; o protocolo NÃO DEVE mudar.
- [ ] **CA-07** (ubíquo): Nada fora da aula ao vivo DEVE mudar; os testes existentes passam sem alteração, salvo os que verificavam o texto e o véu da tela preta, que são trocados; `engine/core` não é alterado.
- [ ] **CA-08** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Frontend, tela de espera:** mostra o título e o tempo `hh:mm:ss` que corre a cada segundo (com relógios falsos); sem título mostra "Aula ao vivo"; o tempo parte do `startedAt` (CA-02).
- **Frontend, estilo:** só tokens, sem cor escrita, só `transform` e `opacity` nas animações, e as animações param sob `prefers-reduced-motion` (leitura do SCSS, como os testes das outras specs) (CA-03).
- **Frontend, `PresenterStage` e `LiveClassroom`:** a tecla B e o botão ligam e desligam a tela de espera; ela aparece para o professor e para o aluno com a mesma estrutura; o conteúdo volta ao desligar; o aluno que entra com ela ligada a vê; os textos dizem "Tela de espera" e não há "Tela preta" nas mensagens (CA-01, CA-04, CA-05, CA-06).
- **Regressão:** os testes existentes passam sem alteração, salvo os de texto e de véu da tela preta, trocados e listados no relatório (CA-07).
- **Manual:** ligar a tela de espera com dois alunos; ver as cores e o tempo correndo igual nas três telas; desligar e ver o conteúdo voltar.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-055, SPEC-057, SPEC-058 e esta; `components/Classroom/PresenterStage`, `LiveClassroom`, `LiveHeaderStatus`, `elapsed.ts`, `styles/_tokens.scss`, `messages/pt-BR.ts` (`blank`, `blankOn`).
2. **Ordem de execução:** só depois da SPEC-060 (mesmos arquivos). Testes vermelhos e commit `test`; o componente da tela de espera, o uso nas duas janelas, os textos.
3. **Arquivos a criar ou alterar:** `frontend/src/components/Classroom/WaitingScreen/**` (novo), `PresenterStage/**`, `LiveClassroom/**`, `styles/_tokens.scss` (só se faltar token de degradê), `messages/pt-BR.ts`. **Não alterar** `engine/core`, o backend, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu a tela animada, colorida, com título e tempo. O texto "A aula já vai continuar", a paleta (laranja, azul, verde e âmbar do tema) e o movimento lento são escolhas da Aruna e devem ser revisados.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; o texto, a paleta e o movimento ficam para a revisão dele |
