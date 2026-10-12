# SPEC-040: Pré-visualização Animada dos Tipos de Questão

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-040 |
| **Status** | Aprovada |
| **Data de criação** | 12/10/2026 |
| **Última revisão** | 12/10/2026 (aprovada) |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `content` (autoria de questões, só na tela) |
| **Contexto de tela** | Modal "Que tipo de questão?" do banco de questões do módulo e dos exercícios do card |
| **Prioridade** | Média |
| **Depende de** | SPEC-035, SPEC-036, SPEC-037, SPEC-039 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 12/10/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

Ao criar uma questão, a docente escolhe o tipo num modal: Comando Linux, Verdadeiro ou falso, Escolha única, Ligar colunas e Descritiva. Cada opção é um nome e uma frase. O tipo não muda depois de escolhido (SPEC-035 CA-18), e a docente só descobre como o aluno vai ver a questão depois de criá-la e abrir a pré-visualização.

O Tech Lead pediu que o modal mostre, de forma animada, um exemplo de cada tipo como o aluno vai ver, para a docente escolher sabendo o que está escolhendo.

## 2. Objetivos (Goals)

- Ao passar ou selecionar um tipo no modal, a docente vê um **exemplo animado** da questão desse tipo, do jeito que aparece para o aluno.
- O exemplo encena a resposta: o aluno responde e o resultado aparece, com as mesmas animações da aba "Desafios".
- O modal continua rápido de usar: escolher um tipo segue sendo um clique e "Escolher".
- Funciona no tema claro e no escuro, no celular e com teclado e leitor de tela.

### 2.1. Fora de escopo (Non-Goals)

- Criar tipos de questão novos (múltipla seleção, ordenar passos e outros ficam para specs próprias).
- Mudar o comportamento das questões para o aluno.
- Qualquer mudança no backend, na API ou no banco de dados.
- Exemplos escritos pela docente: os exemplos são fixos, do sistema.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Layout do modal:**

- À esquerda (ou em cima, no celular), a lista de tipos que já existe: nome e frase de ajuda.
- À direita (ou embaixo, no celular), um painel **"Como o aluno vê"** com o exemplo do tipo destacado.
- O painel troca de exemplo quando a docente seleciona outro tipo (clique, setas do teclado) e, na tela grande, também ao passar o mouse (ver P-02).

**O exemplo:**

- Usa os **mesmos componentes de resposta do aluno** (verdadeiro ou falso, escolha única, ligar colunas, descritiva), num modo de demonstração que não envia nada ao servidor (ver P-01).
- Tem um enunciado curto de Linux, fixo por tipo, por exemplo:
  - Comando Linux: um terminal em miniatura em que o comando é digitado e aparece "Exercício concluído";
  - Verdadeiro ou falso: "O comando `rm -r` apaga pastas com o conteúdo", com o clique em "Verdadeiro" e o acerto animado;
  - Escolha única: "Qual comando muda as permissões?", com as alternativas e a escolha certa;
  - Ligar colunas: `chmod`, `chown` e `ls` ligados às descrições, com as linhas se formando;
  - Descritiva: o texto sendo escrito, "Aguardando correção" e depois a nota em porcentagem.
- A animação roda sozinha, em ciclo: o estado inicial, a resposta, o resultado, uma pausa e recomeça (ver P-03).
- Um selo "Exemplo" deixa claro que não é uma questão de verdade.

**Acessibilidade e movimento:**

- O painel é anunciado como "Exemplo de como o aluno vê: (tipo)". A animação não rouba o foco nem pode ser acionada como se fosse uma questão de verdade.
- Com a preferência do sistema "reduzir movimento", o painel mostra o exemplo parado, já com a resposta e o resultado, sem ciclo.
- Um botão "Pausar" e "Continuar" controla a animação (ver P-04).

**Card:** no card o modal mostra só os tipos do card (sem a Descritiva, SPEC-039 D-09), com os mesmos exemplos.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: a mudança é só na tela.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema. Os exemplos são textos fixos das mensagens da tela.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota nova nem alterada; o modo de demonstração não chama o servidor.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| O exemplo ficar diferente do que o aluno vê, com o tempo | Usar os mesmos componentes da aba "Desafios", só que em modo de demonstração (P-01) |
| Modal pesado ou lento para abrir | Carregar só o exemplo do tipo destacado; o do terminal é uma encenação leve, sem o motor do terminal |
| Animação incomodar ou distrair | Ciclo com pausa, botão de pausar e respeito a "reduzir movimento" |
| Leitor de tela confundir o exemplo com uma questão | Painel marcado como exemplo, controles do exemplo fora da ordem de foco |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente abre o modal de tipo, O SISTEMA DEVE mostrar o exemplo do tipo selecionado (Comando Linux por padrão).
- [ ] **CA-02** (evento): QUANDO a docente seleciona outro tipo, O SISTEMA DEVE trocar o exemplo pelo desse tipo.
- [ ] **CA-03** (estado): ENQUANTO o exemplo está visível, O SISTEMA DEVE animá-lo em ciclo: estado inicial, resposta e resultado, com as animações da aba "Desafios".
- [ ] **CA-04** (indesejado): SE o exemplo for acionado, ENTÃO O SISTEMA NÃO DEVE enviar nada ao servidor nem gravar resposta.
- [ ] **CA-05** (estado): ENQUANTO a preferência "reduzir movimento" está ligada, O SISTEMA DEVE mostrar o exemplo parado, com o resultado.
- [ ] **CA-06** (ubíquo): O exemplo DEVE ter o selo "Exemplo" e ser anunciado como exemplo para leitores de tela.
- [ ] **CA-07** (evento): QUANDO o modal é aberto no card, O SISTEMA DEVE mostrar só os tipos do card e os seus exemplos.
- [ ] **CA-08** (ubíquo): O modal DEVE funcionar no celular (lista e exemplo empilhados) e nos temas claro e escuro.

## 8. Plano de Testes (Test Plan)

Pela SPEC-038 (se aprovada), escritos antes do código.

- **Frontend (Vitest e Testing Library):**
  - o painel mostra o exemplo do tipo selecionado e troca com a seleção;
  - o ciclo de animação avança pelos estados (com relógio simulado);
  - "reduzir movimento" mostra o estado final parado;
  - nenhum serviço de rede é chamado pelo exemplo;
  - no card, a Descritiva não aparece;
  - acessibilidade: nome do painel, selo e botão de pausa.
- **Manual:** abrir o modal no banco e no card, nos temas claro e escuro, no celular, e conferir cada exemplo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** SPEC-035 (modal de tipo, CA-01 e CA-18), SPEC-036, 037 e 039 (componentes de resposta); no código, `KindChooser`, `TrueFalseAnswer`, `SingleChoiceAnswer`, `MatchingAnswer`, `DescriptiveAnswer` e `questionKinds`.
2. **Ordem de execução**, cada passo começando pelos testes:
   1. modo de demonstração nos componentes de resposta (ou componente de exemplo, conforme P-01);
   2. exemplos fixos por tipo nas mensagens;
   3. painel "Como o aluno vê" com o ciclo e a pausa;
   4. layout do modal (lado a lado e empilhado);
   5. spec e glossário, se surgir termo novo.
3. **Arquivos a criar ou alterar:** `frontend/src/components/KindChooser/`, um componente novo de exemplo, os componentes de resposta (modo de demonstração) e `frontend/src/messages/authoring.pt-BR.ts`.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, `tsc`, ESLint e Stylelint limpos e status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (12/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | O exemplo usa os mesmos componentes de resposta do aluno, num modo de demonstração; o Comando Linux é uma encenação leve de terminal, sem o motor (resolve P-01) |
| D-02 | O exemplo troca ao selecionar o tipo (clique ou teclado) e, na tela grande, ao passar o mouse (resolve P-02) |
| D-03 | A animação roda sozinha, em ciclo de uns 6 segundos com pausa no resultado (resolve P-03) |
| D-04 | Há o botão "Pausar" e "Continuar" (resolve P-04) |
| D-05 | O exemplo mostra o acerto (resolve P-05) |

### Pendências

Nenhuma em aberto. P-01 a P-05 viraram as decisões D-01 a D-05.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 12/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (tipos animados no modal de criação, com um exemplo de como o aluno vê). Pendências P-01 a P-05 |
| 12/10/2026 | Tech Lead | Aprovada ("Aprovo"), aceitas as recomendações de P-01 a P-05 (D-01 a D-05). Status: `Aprovada` |
