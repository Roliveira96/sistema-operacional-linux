# SPEC-060: Executar os Comandos do Material na Aula ao Vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-060 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `frontend/src/components/TopicStudy/` (só o modo de aula ao vivo), `frontend/src/components/Classroom/` |
| **Contexto de tela** | Modo Módulo da aula ao vivo (janela de apresentação do professor e sala do aluno) |
| **Prioridade** | Média |
| **Depende de** | SPEC-055 (modo de aula ao vivo do `TopicStudy`), SPEC-056 (espelho do terminal), SPEC-057 (palco idêntico) |
| **Substitui** | Parcialmente a SPEC-055 CA-13: o modo ao vivo deixa de esconder o botão de executar cada exemplo de comando |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026, a pedido do professor: "cada item que for de comando, dê o botão para reproduzir, para que o professor não precise digitar" |

---

## 1. Contexto e Problema (Context & Problem Statement)

No modo Módulo da aula ao vivo, o material mostra cada exemplo de comando (por exemplo `uname -o`, com a explicação), mas **sem o botão de executar** que a tela de estudo tem. O professor precisa digitar o comando à mão no terminal da aula, o que gasta tempo e arrisca erro de digitação.

## 2. Objetivos (Goals)

- Cada exemplo de comando do material tem o botão **▶** na tela do professor; um clique executa o exemplo no terminal da aula, digitado na tela como na tela de estudo.
- Os alunos veem o comando ser digitado e executado pelo espelho do terminal (SPEC-056), sem nada a mais.
- A tela do aluno continua com o mesmo desenho da do professor (SPEC-057, CA-22).

### 2.1. Fora de escopo (Non-Goals)

- Executar todos os exemplos em sequência, ou o modo "reproduzir tudo" da tela de estudo.
- Marcas de "feito" nos exemplos, narração por voz e velocidade configurável.
- O aluno executar exemplos.
- Mudar a tela de estudo comum (`/materials/:id`).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Botão no professor.** No modo ao vivo, o `LessonPanel` mostra o botão ▶ de cada exemplo de comando (`title` e rótulo de acessibilidade como na tela de estudo: "Executar no terminal N: *comando*"). O clique executa **aquele exemplo** no terminal real da aula (o terminal indicado pelo exemplo, de 1 a 3), com a digitação na tela, na velocidade normal; o espelho do terminal leva a digitação e a saída aos alunos.
- **Mesmo desenho no aluno.** O botão é desenhado **também na tela do aluno**, do mesmo tamanho e no mesmo lugar, mas **desativado** (`disabled`, fora da ordem de tabulação, sem ação), para que o conteúdo do material tenha **exatamente o mesmo layout** nas duas telas (SPEC-057 CA-22). O aluno não tem como executar nada.
- **Um por vez.** Enquanto um exemplo executa, o botão dele mostra o estado de execução e os botões dos outros exemplos ficam desativados; ao terminar, voltam. Se o exemplo não puder executar (terminal ocupado, fechado ou falha ao preparar), o botão volta ao normal e a janela de apresentação mostra o aviso curto "Não foi possível executar o exemplo" (o aviso que a janela já tem, sem painel por cima do palco do aluno).
- **Ligação com o terminal.** O modo ao vivo passa a ter um executor de exemplos ligado ao terminal da aula (o `MirroredModuleView` do professor expõe a execução de um passo ao `LiveTopicScreen`); o `idlePlayer` continua para tudo que não é executar um exemplo (próximo, voltar, reproduzir tudo, velocidade).
- **Sem mudança fora da aula ao vivo.** A tela de estudo comum e seus testes ficam como estão.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança e nenhuma mensagem nova: o que o professor executa chega aos alunos pelo espelho do terminal (SPEC-056).

## 5. Contrato de API (API Contract)

Nenhum endpoint nem mensagem novos.

## 6. Impacto e Riscos (Impact & Risks)

- **Layout diferente entre professor e aluno.** Mitigação: o botão é desenhado nos dois, desativado no aluno, e um teste compara o layout dos dois lados (como o da SPEC-057).
- **Comando de exemplo com efeito no terminal da aula** (por exemplo `rm`). Mitigação: é o mesmo exemplo que a tela de estudo já executa no terminal simulado; a máquina é do motor, não do servidor.
- **Executar duas coisas ao mesmo tempo.** Mitigação: um por vez, os outros botões desativados.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o professor aciona o ▶ de um exemplo de comando no modo ao vivo, O SISTEMA DEVE executar aquele exemplo no terminal da aula indicado por ele, com a digitação na tela, e os alunos DEVEM ver a digitação e a saída pelo espelho do terminal.
- [ ] **CA-02** (ubíquo): O botão ▶ DEVE aparecer em cada exemplo de comando, na tela do professor e na do aluno, do mesmo tamanho e no mesmo lugar; na do aluno DEVE ser desativado e fora da ordem de tabulação, e NÃO DEVE executar nada.
- [ ] **CA-03** (estado): ENQUANTO um exemplo executa, O SISTEMA DEVE mostrar o estado de execução no botão dele e desativar os dos outros exemplos; ao terminar, DEVE reativá-los.
- [ ] **CA-04** (evento): QUANDO o exemplo não puder ser executado, O SISTEMA DEVE reativar o botão e DEVE mostrar ao professor o aviso curto na janela de apresentação, sem painel por cima do palco.
- [ ] **CA-05** (ubíquo): O layout do material DEVE ser o mesmo para o professor e para o aluno (a posição e o tamanho dos exemplos e dos botões).
- [ ] **CA-06** (ubíquo): A tela de estudo comum (`/materials/:id`) e o restante do `TopicStudy` NÃO DEVEM mudar; os testes existentes passam sem alteração; `engine/core` não é alterado.
- [ ] **CA-07** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Frontend, `LessonPanel` e `LiveTopicScreen`:** o professor vê o ▶ em cada exemplo e o clique chama a execução do passo certo, com o terminal certo; o aluno vê o botão desativado, fora da tabulação, e o clique não faz nada; a estrutura (posição e tamanho) é a mesma nos dois lados (CA-01, CA-02, CA-05).
- **Frontend, execução:** durante a execução o botão mostra o estado e os outros ficam desativados; ao terminar voltam; a falha reativa o botão e mostra o aviso (CA-03, CA-04).
- **Frontend, `MirroredModuleView`:** o terminal do professor expõe a execução de um passo e ela passa pelo espelho (a digitação e a saída chegam na tela enviada) (CA-01).
- **Regressão:** os testes existentes do `TopicStudy` e da tela de estudo passam sem alteração (CA-06).
- **Manual:** o professor clica nos ▶ de dois exemplos seguidos; os alunos veem a digitação e a saída; o material fica igual nas duas telas.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-055, SPEC-056, SPEC-057 e esta; `frontend/src/components/TopicStudy/LiveTopicScreen.tsx`, `LessonPanel.tsx`, `hooks/useTopicPlayer.ts`, `components/Classroom/MirroredModuleView`, `engine/terminalWindow.ts` (`run`, `execute`).
2. **Ordem de execução:** só depois das SPEC-058 e SPEC-059 (mesmos arquivos). Testes vermelhos e commit `test`; a execução exposta pelo terminal do professor; o botão e o estado no `LessonPanel` do modo ao vivo; mensagens.
3. **Arquivos a criar ou alterar:** `frontend/src/components/TopicStudy/LiveTopicScreen.tsx`, `LessonPanel.tsx` (só o modo ao vivo), `frontend/src/components/Classroom/MirroredModuleView/**`, `ModuleStage/**`, `PresenterStage/**` (o aviso), `messages/pt-BR.ts`. **Não alterar** `engine/core`, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu o botão de executar por exemplo; o botão **desativado** no aluno (para o layout ser idêntico) e o **um por vez** são escolhas da Aruna e devem ser revisadas. Fica para depois, se quiser: "executar todos em sequência".

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; o botão desativado no aluno e o um por vez ficam para a revisão dele |
| 14/10/2026 | Aruna Architect | Implementada (`84b0a70`, `58f6028`). Desvios: `LessonPanel` ganhou a prop `canRun` (com `readOnly` o ▶ é sempre desenhado); o adaptador do terminal ganhou `isBusy` para o aviso de terminal ocupado não esperar 30 s; só `null`, exceção ou terminal ausente contam como falha; o aviso some sozinho em 5 s; sem verificação no navegador |
