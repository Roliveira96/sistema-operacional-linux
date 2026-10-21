# SPEC-079: Questões Escolhidas da Avaliação: Peso com Rótulo, Ordem, Aviso na Linha e Remoção Clara

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-079 |
| **Status** | Aprovada |
| **Data de criação** | 21/10/2026 |
| **Última revisão** | 21/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `assessment` (frontend: `AssessmentQuestionPicker` e `AssessmentForm`) |
| **Contexto de tela** | Aba *Questões* do formulário da avaliação, na composição manual: `/app/classes/[id]/assessments/new` e `/app/classes/[id]/assessments/[assessmentId]/edit` |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (seção 3.1, RN-06 e RN-07), SPEC-077 (indicador por aba e lista de razões do formulário) |
| **Substitui** | Nenhuma. Sobrepõe a parte da seção 3.1 da SPEC-075 que diz apenas que o seletor "mostra o peso de cada uma" |
| **Fontes canônicas** | Pedido do Tech Lead de 21/10/2026: na lista das questões escolhidas há uma caixa com um valor e sem rótulo, e a docente pode ficar confusa |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na composição manual, depois de marcar as questões, o seletor mostra "Questões da avaliação (N)": uma lista com o título de cada questão escolhida, uma etiqueta com o nível, **uma caixa numérica** e um botão **"×"**. Vendo a tela, a docente não sabe o que é o número: a caixa só tem nome para leitor de tela (`aria-label` "Peso de ..."), nenhum texto visível diz que é o **peso**, nem que é em **pontos**. O "×" também não diz o que faz.

Há ainda três lacunas do mesmo trecho:

- Uma questão recém-marcada entra com peso **0**, valor que a regra recusa (RN-06: de 0,01 a 100). O erro só aparece como diferença na barra da soma, abaixo da lista, longe da linha que o causa; a docente não sabe qual questão falta pesar. Na captura que originou o pedido, a última de cinco questões estava com 0.
- A ordem das questões é a ordem em que foram marcadas e é a ordem da prova, mas a lista não a mostra.
- A lista não mostra quanto cada questão vale da nota máxima, que é o que a docente quer conferir ao distribuir pontos.

## 2. Objetivos (Goals)

- As questões escolhidas aparecem numa **tabela com cabeçalhos visíveis**: número da ordem, questão, nível, **peso (pontos)**, parte da nota e a ação de remover.
- Cada linha com peso inválido é **marcada na própria linha**, com a razão em texto ao lado do campo.
- O botão de remover diz **"Remover"** (texto visível), com o nome completo para leitor de tela.
- A docente vê o quanto cada questão vale da nota máxima, em porcentagem.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- Reordenar as questões (arrastar ou botões subir e descer): a ordem continua sendo a da marcação.
- Mudar o peso inicial de 0 de uma questão marcada, a regra de soma, o botão "Distribuir igualmente" e a barra da soma (SPEC-075 RN-06, D-14).
- A lista de questões elegíveis acima (filtros, busca, páginas), o sorteio por nível e a pré-visualização.
- Qualquer mudança no servidor ou nos contratos de API.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**Questões escolhidas** (a seção que hoje se chama "Questões da avaliação (N)", só aparece quando há ao menos uma)

- O título da seção continua, e o que vem abaixo dele é uma **tabela** ligada ao título. Colunas, com cabeçalho sempre visível: *#* (a posição na prova, de 1 a N, sempre sem buracos), *Questão*, *Nível*, *Peso (pontos)*, *% da nota* e uma última sem título visível para a ação.
- **Peso:** a caixa numérica fica na coluna *Peso (pontos)*; o nome dela para leitor de tela continua "Peso de <título>" (mais específico que o cabeçalho). Valores válidos: de 0,01 a 100, com até 2 casas decimais.
- **Peso inválido** (vazio, 0, acima de 100 ou com mais de 2 casas): a caixa fica marcada como inválida (borda de perigo e atributo de inválido), e abaixo do título da questão aparece "Informe o peso: de 0,01 a 100, com até 2 casas." ligado à caixa. Some quando o valor passa a valer.
- **% da nota:** `peso ÷ nota máxima`, em porcentagem inteira ("25 %"). Mostra um traço quando o peso é inválido ou a nota máxima ainda não vale. A nota máxima chega do formulário.
- **Remover:** um botão com o texto "Remover" e nome para leitor de tela "Remover <título>", de no mínimo 44 px. Ao remover, os números se refazem.
- **Questões sem edição** (avaliação já iniciada, SPEC-075 RN-10): a tabela continua à vista, com a caixa e o botão desabilitados, como hoje.
- **Tela estreita:** a tabela rola na horizontal dentro da própria caixa, como a lista de avaliações; o título da questão tem largura mínima legível.
- A barra da soma, o botão "Distribuir igualmente" e a lista de questões elegíveis não mudam.

### 3.2. Backend (Go: módulo `assessment`)

Não se aplica nesta spec: só o frontend muda.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota ou campo muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Testes do seletor da SPEC-075 que mudam.** Os que procuram a lista de escolhidas como lista, e o que procura o peso e a remoção, passam a achar linhas de tabela. **Mitigação:** o título da seção segue como título (`heading`) e os nomes de acessibilidade ("Peso de ...", "Remover ...", "Incluir ...") não mudam; só os ajustes inevitáveis entram no commit vermelho, com o motivo registrado na entrega.
- **Peso 0 ao marcar a questão faz a linha nascer marcada como inválida.** Pode parecer agressivo. **Mitigação:** a mensagem diz o que fazer ("Informe o peso") e o tom é de aviso, sem alerta sonoro; o botão "Distribuir igualmente" resolve de uma vez (D-02).
- **Largura em telas estreitas.** **Mitigação:** a rolagem horizontal na própria caixa e a largura mínima do título.
- **Impacto em outros módulos:** nenhum além do formulário da avaliação, que passa a entregar a nota máxima ao seletor. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (estado): ENQUANTO há questões escolhidas, A seção DEVE mostrar uma tabela com os cabeçalhos *#*, *Questão*, *Nível*, *Peso (pontos)* e *% da nota* sempre visíveis, e cada caixa de peso DEVE manter o nome "Peso de <título>" para leitor de tela.
- [ ] **CA-02** (estado): ENQUANTO há questões escolhidas, CADA linha DEVE mostrar sua posição de 1 a N, e ao remover uma questão os números DEVEM se refazer sem buracos.
- [ ] **CA-03** (estado): ENQUANTO o peso de uma linha está vazio, é 0, passa de 100 ou tem mais de 2 casas decimais, A linha DEVE marcar a caixa como inválida e mostrar "Informe o peso: de 0,01 a 100, com até 2 casas." ligada à caixa; QUANDO o valor passa a valer, a marca e a mensagem DEVEM sumir.
- [ ] **CA-04** (estado): ENQUANTO o peso e a nota máxima valem, CADA linha DEVE mostrar a parte da nota em porcentagem inteira; SE o peso é inválido ou a nota máxima não vale, ENTÃO DEVE mostrar um traço.
- [ ] **CA-05** (evento): QUANDO a docente aciona "Remover" numa linha, O SISTEMA DEVE tirar a questão da escolha; o botão DEVE ter o texto visível "Remover", o nome "Remover <título>" e no mínimo 44 px.
- [ ] **CA-06** (estado): ENQUANTO a avaliação já começou, A tabela DEVE continuar à vista, com as caixas de peso e os botões de remover desabilitados.
- [ ] **CA-07** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; a tabela DEVE ter navegação por teclado, contraste AA e nenhuma cor fora dos tokens.
- [ ] **CA-08** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Frontend** (Vitest e Testing Library)

- `AssessmentQuestionPicker.chosen.test.tsx`: a tabela com os cabeçalhos e o nome de cada caixa (CA-01); a numeração e o refazer dos números ao remover (CA-02); a linha de peso inválido nos quatro casos, com a mensagem ligada à caixa, e que some ao valer (CA-03); a porcentagem e o traço (CA-04); o botão "Remover" com o texto visível e o nome completo (CA-05); a tabela à vista e desabilitada com a avaliação iniciada (CA-06)
- `AssessmentQuestionPicker.test.tsx` (ajustado): os testes do peso e da remoção, só no que a tabela muda (CA-01, CA-05)
- `AssessmentForm.test.tsx` (ajustado, se preciso): o formulário entrega a nota máxima ao seletor (CA-04)
- Stylelint, ESLint e `tsc` limpos (CA-07, CA-08)

**Manual** (roteiro)

1. Marcar cinco questões, deixar uma com 0 e conferir a linha marcada com a mensagem, a barra da soma e a porcentagem de cada uma; usar "Distribuir igualmente" e conferir que as marcas somem.
2. Remover a segunda questão e conferir os números e a soma.
3. Conferir a aparência, o contraste (WCAG AA) e a rolagem lateral numa janela estreita, no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (seção 3.1, RN-06 e RN-07) e a SPEC-077 (lista de razões). Do código: `frontend/src/components/AssessmentQuestionPicker` e `frontend/src/components/AssessmentForm`.
2. **Ordem de execução:** (a) testes vermelhos, rodados e commitados (`test(frontend): ...`); (b) o seletor (tabela, peso inválido, porcentagem, botão), mensagens e estilos; (c) o formulário passa a nota máxima ao seletor; (d) roteiro manual; (e) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Frontend, alterados:** `frontend/src/components/AssessmentQuestionPicker/AssessmentQuestionPicker.tsx` e `.module.scss`; `frontend/src/components/AssessmentForm/AssessmentForm.tsx` (só para passar a nota máxima); `frontend/src/messages/pt-BR.ts`; e os testes da seção 8.
   - **Frontend, novos:** `AssessmentQuestionPicker.chosen.test.tsx`.
   - **Documentação:** esta spec.
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 21/10/2026, ao aprovar a spec, todas as pendências que ela tinha. As decisões estão incorporadas às seções 2, 3, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Porcentagem da nota.** Cada linha mostra a coluna *% da nota*. |
| D-02 | **Peso inicial.** Uma questão marcada continua entrando com peso 0, e a linha fica marcada como inválida até a docente informar o peso; não muda os dados nem o "Distribuir igualmente", e a nota não é dividida sozinha. |
| D-03 | **Reordenar as questões** fica fora desta spec; se a docente precisar, vira uma spec própria. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 21/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir da queixa de 21/10/2026 sobre a caixa de valor sem rótulo na lista das questões escolhidas, conferida contra o código do seletor e a SPEC-075. Três pendências abertas (D-01 a D-03), todas com recomendação |
| 21/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das três pendências aceitas como estavam na spec: D-01 a D-03. Status: `Aprovada` |
| 21/10/2026 | Aruna Architect | Seção 10 esvaziada: as três pendências viraram decisões D-01 a D-03, incorporadas ao texto; `P-xx` renomeado para `D-xx` nas referências |
