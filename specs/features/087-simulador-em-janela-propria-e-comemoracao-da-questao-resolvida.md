# SPEC-087: Simulador da Prova: a Janela Própria da Prova e a Comemoração da Questão Resolvida

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-087 |
| **Status** | Rascunho |
| **Data de criação** | 26/10/2026 |
| **Última revisão** | 26/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `assessment` (frontend: o simulador da prova e o detalhe da avaliação) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]` (o botão *Simular prova*) e `/app/classes/[id]/assessments/[assessmentId]/simulate`, na visão da docente e do administrador |
| **Prioridade** | Alta |
| **Depende de** | SPEC-085 (a conferência da questão prática), SPEC-084 (a tela da prova com o terminal), SPEC-081 (o simulador) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-085, a exclusão da comemoração (seção 2.1, o item "comemoração do mascote") e, na SPEC-081, o arranjo da página do simulador (seção 3.1: o título da página, o link *Voltar à avaliação* no alto e a página dentro do menu da plataforma) |
| **Fontes canônicas** | Pedido do Tech Lead de 26/10/2026, depois de criar e abrir uma prova de teste: o simulador está estranho; deveria abrir numa tela separada, como se fosse a prova; e, quando o aluno acerta a questão, deve haver uma animação mostrando que acertou e que pode ir para a próxima. Referências: o simulado da branch `main` (`TelaSimulado.ts`, a comemoração do pinguim do TSI) e o modo foco da aula ao vivo (SPEC-059) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O simulador da prova (SPEC-081, 084 e 085) abre como qualquer outra página da plataforma: dentro do menu e do cabeçalho da área logada, com o link *Voltar à avaliação* e o título "Simulador da prova" em cima, e só depois a faixa da simulação, as abas e a prova. A docente, ao testar a prova, não sente que está numa prova: o menu da plataforma continua à vista, a página rola com o resto, e a prova divide a altura da janela com o que está em volta dela. O Tech Lead abriu a prova de teste e disse que o simulador "está estranho": ele deveria abrir **numa tela separada, como se fosse a prova**.

Além disso, quando a docente resolve uma questão de comando Linux no terminal, o servidor confere e o simulador só **marca** a questão como resolvida (SPEC-085 D-02): o botão do navegador de questões ganha a marca e uma linha discreta diz "Questão resolvida no terminal.". Ao pedir a SPEC-085, o Tech Lead tinha deixado de fora a comemoração do simulado antigo da `main`, que mostrava o pinguim do TSI pulando, travava a questão e avançava sozinho. Agora, depois de usar o simulador, ele pede de volta a parte que mostra o acerto: **uma animação que diga que a questão foi resolvida e que se pode ir para a próxima**. A trava e o avanço sozinho continuam de fora.

## 2. Objetivos (Goals)

- O simulador abre **numa janela própria da prova**: numa aba nova do navegador, cobrindo a janela inteira, sem o menu nem o cabeçalho da plataforma, com só a faixa da simulação, as abas e a prova.
- A docente sai da simulação por um botão **Sair da simulação**, que fecha a aba.
- Quando o servidor dá a questão de comando Linux aberta como resolvida, aparece a **comemoração da questão resolvida**: uma animação curta de acerto, o texto "Questão resolvida!" e o botão **Próxima questão** (ou **Entregar**, na última), sem travar a questão e sem avançar sozinho.
- A comemoração respeita quem pediu menos movimento ao sistema e é lida por leitor de tela.
- O resto do simulador continua como as SPEC-081, 084 e 085 definem: nada é enviado nem gravado, a aba *Professor* não muda, e as questões teóricas continuam sem dizer se estão certas.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Travar** a questão resolvida ou **passar sozinho** para a próxima (SPEC-085 D-02 continua valendo): a comemoração oferece o caminho, a docente escolhe.
- **Nota, pontuação, "errou" ou o que falta** numa questão prática ainda não resolvida (SPEC-085 D-03).
- Dizer se uma questão **teórica** está certa: a comemoração é só da questão de comando Linux, que o servidor confere (SPEC-081 D-05).
- **Som** na comemoração.
- A **tela real** da prova do aluno (rota `/take`), a tentativa, a telemetria e a infração por sair da janela; a janela própria é do simulador. A spec das tentativas decide se a prova real segue o mesmo arranjo.
- Mudanças no servidor ou nos contratos de API: esta spec só muda o frontend.
- Mudanças na janela do terminal, no motor, na tela de estudo, nos componentes de resposta ou em `frontend/src/engine/core/`.
- A tela cheia do navegador **obrigatória** ou a detecção de quem sai dela.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. O que as SPEC-081, 084 e 085 definem e esta spec não muda continua valendo.

**A entrada: o botão *Simular prova*** (D-01)

- No detalhe da avaliação, o botão *Simular prova* passa a abrir a página `simulate` **numa aba nova** do navegador, sem dar à aba nova acesso à aba de origem. O botão diz, para leitor de tela e no título, que abre em nova aba. Quem vê o botão não muda (SPEC-081 CA-01).

**A janela própria da prova** (D-01)

- A página do simulador **cobre a janela inteira**, por cima do menu e do cabeçalho da plataforma, como o modo foco da aula ao vivo (SPEC-059): nada da plataforma fica à vista, e a página não rola como um todo; cada parte rola por conta própria (a coluna da questão, a lista da aba *Professor*).
- No alto, **uma só barra**: a faixa "Simulação: nada é enviado nem gravado", a situação real da avaliação, as abas *Aluno* e *Professor*, *Sortear de novo* (só no sorteio) e o botão **Sair da simulação**. O título "Simulador da prova" fica no título da aba do navegador e, para leitor de tela, no cabeçalho da página, sem ocupar espaço visível. O link *Voltar à avaliação* do alto da página deixa de existir.
- Abaixo da barra, a prova tem **toda a altura que sobra**: a coluna da questão e o terminal crescem até ela.
- O estudante que abre o endereço continua voltando ao detalhe da avaliação (SPEC-081 CA-01), e a janela estreita (abaixo de 48 rem) continua mostrando só o aviso (SPEC-081 D-02), agora com *Sair da simulação* no lugar do link.

**Sair da simulação** (D-01)

- O botão *Sair da simulação* está na barra do alto, na tela *Entregue* (no lugar de *Voltar à avaliação*) e no aviso da janela estreita.
- Com a prova em andamento, sair pede a confirmação ("Sair da simulação? As respostas e as máquinas desta simulação serão perdidas.") no diálogo do simulador; antes de começar e depois de entregar, sai direto.
- Sair **fecha a aba** do navegador. Quando o navegador não deixa fechar a aba (por exemplo, a página foi aberta direto pelo endereço, e não pelo botão), a página vai ao detalhe da avaliação na mesma aba.

**Tela cheia** (D-02)

- O cabeçalho da prova, ao lado de *Entregar*, ganha o botão **Tela cheia**, que pede a tela cheia do navegador para a página inteira; é um gesto da docente, então o navegador aceita. Em tela cheia o botão vira **Sair da tela cheia**, e a tecla Esc do navegador também sai. Nada obriga a tela cheia, e sair dela não muda a simulação. Em navegador que não a oferece, o botão não aparece.

**A comemoração da questão resolvida** (D-03, D-04)

- **Quando aparece:** no instante em que o servidor dá como resolvida (SPEC-085) a questão de comando Linux **que está aberta**. Se a resposta do servidor chega com outra questão aberta, só a marca de resolvida entra (como hoje) e a comemoração não aparece. Cada questão comemora **uma vez**: depois do *Reset Máquina* dela, que tira a marca, resolver de novo comemora de novo; *Refazer* e *Sortear de novo* zeram tudo.
- **O que mostra:** uma camada sobre a **coluna da questão**, sem cobrir o terminal nem a barra do alto, com uma marca de acerto que aparece animada (um círculo que se desenha e o traço de certo que cresce, em cerca de meio segundo, na cor de sucesso dos tokens), o título "Questão resolvida!", a linha "Você pode ir para a próxima questão." e dois botões: **Próxima questão** (com o foco do teclado ao abrir) e **Continuar nesta questão**. Na **última questão** da prova, o primeiro botão é **Entregar**, que abre a confirmação de entrega da SPEC-081, e a linha diz "Era a última questão. Você pode entregar a prova.".
- **Sem mascote** (D-04): a marca de acerto é desenhada pelo estilo, sem imagem.
- **O que faz:** *Próxima questão* fecha a comemoração e abre a questão seguinte; *Continuar nesta questão*, a tecla Esc e um clique fora da camada só fecham a comemoração. A questão **não trava**: o terminal continua ativo o tempo todo (a camada não está sobre ele) e a docente pode seguir digitando; a marca de resolvida fica como a SPEC-085 define.
- **Menos movimento:** quando o sistema pede menos movimento (`prefers-reduced-motion`), a marca e a camada aparecem **sem animação**, de uma vez; o conteúdo é o mesmo.
- **Leitor de tela:** a camada é um diálogo com nome "Questão resolvida!", o foco vai para o primeiro botão ao abrir e volta para onde estava ao fechar; a linha "Questão resolvida no terminal." da coluna da questão (SPEC-085) continua existindo para quem não vê a camada.
- **Não muda:** a aba *Professor* ("Resolvida no terminal"), a contagem de respondidas, o *Reset Máquina*, a conferência e tudo da SPEC-085 que não é a comemoração.

**Acesso à rede.** Nenhuma chamada nova: a comemoração usa a resposta da conferência que já existe (SPEC-085). Nada é gravado (SPEC-081 RN-04).

### 3.2. Backend (Go: módulo `assessment`)

Não se aplica nesta spec: nenhuma rota, regra ou contrato muda. O servidor continua conferindo a questão prática como a SPEC-085 define, e o simulador só reage à resposta.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda; o simulador não grava.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota nova nem alterada. O simulador continua usando a pré-visualização (SPEC-081), o cenário da questão (SPEC-084) e a conferência (SPEC-085).

## 6. Impacto e Riscos (Impact & Risks)

- **O navegador pode recusar fechar a aba.** Uma aba aberta direto pelo endereço, ou que já navegou, às vezes não se fecha por script. **Mitigação:** quando fechar não funciona, a página vai ao detalhe da avaliação (seção 3.1); o teste cobre os dois caminhos.
- **A aba nova pode ser bloqueada por bloqueador de pop-up.** O link com destino em aba nova, acionado por clique, não costuma ser bloqueado, ao contrário de uma janela aberta por script. **Mitigação:** a entrada é um link comum com destino em aba nova, não uma janela aberta por script.
- **A página que cobre a janela esconde o menu, e a docente pode se perder.** **Mitigação:** a barra do alto tem sempre *Sair da simulação* e a situação real da avaliação; a aba de origem, com o detalhe, continua aberta por trás.
- **A comemoração pode atrapalhar quem usa o terminal.** **Mitigação:** a camada cobre só a coluna da questão, o terminal segue ativo, e Esc ou um clique fora fecham; cada questão comemora uma vez.
- **Animação e acessibilidade.** **Mitigação:** sem animação com `prefers-reduced-motion`, diálogo nomeado, foco controlado, contraste AA, e a linha de estado da SPEC-085 continua para o leitor de tela.
- **Os testes das SPEC-081, 084 e 085 que mudam.** Os que procuram o link *Voltar à avaliação*, o título visível da página e o botão *Simular prova* na mesma aba. **Mitigação:** ajustados no commit vermelho, com o motivo registrado na entrega.
- **A prova real pode sair diferente do simulador.** **Mitigação:** a janela própria e a comemoração ficam em componentes que a spec das tentativas pode reaproveitar; o que divergir se decide lá.
- **Impacto em outros módulos:** nenhum. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador aciona *Simular prova* no detalhe da avaliação, A página do simulador DEVE abrir numa aba nova do navegador, sem acesso à aba de origem, e o botão DEVE dizer que abre em nova aba (D-01).
- [ ] **CA-02** (estado): ENQUANTO o simulador está aberto numa janela de 48 rem ou mais, A página DEVE cobrir a janela inteira, sem o menu nem o cabeçalho da plataforma e sem o link *Voltar à avaliação*, com uma só barra no alto (a faixa da simulação, a situação real, as abas, *Sortear de novo* no sorteio e *Sair da simulação*) e a prova com toda a altura que sobra (D-01).
- [ ] **CA-03** (evento): QUANDO a pessoa aciona *Sair da simulação*, A página DEVE pedir a confirmação se a prova está em andamento (e sair direto antes de começar ou depois de entregar), fechar a aba, e, quando o navegador não deixa fechar, ir ao detalhe da avaliação (D-01).
- [ ] **CA-04** (estado): ENQUANTO a simulação está em *Entregue* ou a janela tem menos de 48 rem, A página DEVE oferecer *Sair da simulação* no lugar de *Voltar à avaliação*, com o mesmo comportamento do CA-03.
- [ ] **CA-05** (evento): QUANDO a pessoa aciona *Tela cheia* no cabeçalho da prova, A página DEVE pedir a tela cheia do navegador e trocar o botão por *Sair da tela cheia*; sair da tela cheia NÃO DEVE mudar a simulação; em navegador sem tela cheia o botão NÃO DEVE aparecer (D-02).
- [ ] **CA-06** (evento): QUANDO o servidor dá como resolvida a questão de comando Linux que está aberta, O simulador DEVE mostrar a comemoração sobre a coluna da questão, com a marca de acerto animada, "Questão resolvida!", "Você pode ir para a próxima questão." e os botões *Próxima questão* (com o foco) e *Continuar nesta questão*, sem cobrir o terminal nem a barra do alto (D-03).
- [ ] **CA-07** (estado): ENQUANTO a questão resolvida é a última da prova, A comemoração DEVE dizer "Era a última questão. Você pode entregar a prova." e oferecer *Entregar* no lugar de *Próxima questão*, levando à confirmação de entrega (D-03).
- [ ] **CA-08** (evento): QUANDO a pessoa aciona *Próxima questão*, O simulador DEVE fechar a comemoração e abrir a questão seguinte; QUANDO aciona *Continuar nesta questão*, a tecla Esc ou um clique fora da camada, DEVE só fechar a comemoração, com a questão aberta, destravada e marcada como resolvida (D-03).
- [ ] **CA-09** (indesejado): SE a resposta do servidor chega com outra questão aberta, ENTÃO O simulador DEVE só marcar a questão como resolvida, sem comemoração; e SE a questão já comemorou, ENTÃO NÃO DEVE comemorar de novo até o *Reset Máquina* dela, o *Refazer* ou o *Sortear de novo* (D-03).
- [ ] **CA-10** (ubíquo): A comemoração NÃO DEVE aparecer para questão teórica, NÃO DEVE travar a questão nem avançar sozinha, NÃO DEVE ter som nem mascote, e NÃO DEVE dizer nota, pontuação nem o que falta (D-04, SPEC-085 D-02 e D-03).
- [ ] **CA-11** (opcional): ONDE o sistema pede menos movimento, A comemoração DEVE aparecer sem animação, com o mesmo conteúdo.
- [ ] **CA-12** (ubíquo): A comemoração DEVE ser um diálogo nomeado "Questão resolvida!", com o foco no primeiro botão ao abrir e devolvido ao fechar; os textos novos DEVEM estar em `messages/pt-BR.ts`; a barra, os botões e a comemoração DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [ ] **CA-13** (ubíquo): O simulador NÃO DEVE gravar nada nem chamar rota nova; a aba *Professor*, a conferência, o *Reset Máquina*, a contagem de respondidas e o que mais as SPEC-081, 084 e 085 definem NÃO DEVEM mudar.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend**

Não se aplica: nenhuma mudança no servidor.

**Frontend** (Vitest e Testing Library; o terminal, o relógio, a tela cheia e o fechar da aba são simulados)

- `SolvedCelebration.test.tsx` (novo): o diálogo nomeado, a marca, os textos, o foco no primeiro botão e devolvido ao fechar, *Próxima questão* e *Continuar nesta questão*, a variante da última questão com *Entregar*, Esc e o clique fora, e a ausência de animação com menos movimento (CA-06, CA-07, CA-08, CA-11, CA-12)
- `AssessmentSimulator.check.test.tsx` (ajustado): a comemoração quando o servidor resolve a questão aberta, só a marca quando resolve outra, *Próxima questão* abre a seguinte, a comemoração uma vez por questão até o *Reset Máquina*, o *Refazer* e o *Sortear de novo*, o terminal ativo durante a comemoração, e nenhuma comemoração na questão teórica (CA-06, CA-08, CA-09, CA-10)
- `AssessmentSimulator.test.tsx` (ajustado): a barra do alto com *Sair da simulação*, a confirmação com a prova em andamento e a saída direta antes e depois, *Sair da simulação* na tela *Entregue* e no aviso da janela estreita, *Tela cheia* e *Sair da tela cheia*, e o botão ausente sem tela cheia (CA-02, CA-03, CA-04, CA-05)
- `simulate/page.test.tsx` (ajustado): a página que cobre a janela, sem o link *Voltar à avaliação* nem o título visível, o fechar da aba e o caminho ao detalhe quando fechar não funciona, o estudante devolvido ao detalhe, nenhuma chamada de escrita (CA-02, CA-03, CA-13)
- `[assessmentId]/page.test.tsx` (ajustado): *Simular prova* abre em aba nova, sem acesso à aba de origem, e diz isso (CA-01)
- `AssessmentSimulator.teacher.test.tsx` (conferido, sem mudança esperada): a aba *Professor* como antes (CA-13)
- Stylelint, ESLint e `tsc` limpos (CA-12)

**Manual** (roteiro)

1. No detalhe da prova de teste, acionar *Simular prova*: a aba nova abre com a página cobrindo a janela, sem o menu da plataforma; a aba do detalhe continua atrás.
2. Começar a prova, resolver a questão de comando Linux no terminal e conferir, um instante depois, a comemoração sobre a coluna da questão, com o terminal ainda ativo; acionar *Próxima questão* e conferir a questão seguinte com a anterior marcada.
3. Resolver outra questão e fechar a comemoração com Esc; digitar mais no terminal e conferir que a comemoração não volta; acionar *Reset Máquina*, confirmar, resolver de novo e conferir que ela volta.
4. Na última questão, conferir *Entregar* na comemoração e a confirmação de entrega.
5. Ligar "reduzir movimento" no sistema operacional e conferir a comemoração sem animação.
6. Acionar *Tela cheia* e *Sair da tela cheia* (e a tecla Esc) e conferir que a simulação não muda.
7. Acionar *Sair da simulação* com a prova em andamento, confirmar, e conferir que a aba fecha; abrir o endereço do simulador direto numa aba e conferir que *Sair da simulação* leva ao detalhe.
8. Conferir a aparência e o contraste (WCAG AA) da barra, da comemoração e dos botões no tema escuro, e a navegação só com o teclado.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; as SPEC-081, 084 e 085 inteiras e a SPEC-059 (o modo foco e a restrição da tela cheia). Do código: `frontend/src/components/AssessmentSimulator/` (todos os arquivos), `frontend/src/components/AssessmentDialog/AssessmentDialog.tsx`, `frontend/src/components/Classroom/LiveClassroom/LiveClassroom.module.scss` (como a página cobre a janela) e `useRequestedFullscreen.ts` (a tela cheia), `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e `simulate/page.tsx`, e `frontend/src/messages/pt-BR.ts` (a seção `simulator`).
2. **Ordem de execução:** (a) os testes do frontend, vermelhos e commitados (`test(frontend): ...`); (b) a entrada em aba nova e a janela própria com a barra e *Sair da simulação*; (c) *Tela cheia*; (d) a comemoração; (e) estilos; (f) roteiro manual; (g) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Frontend, novos:** `frontend/src/components/AssessmentSimulator/SolvedCelebration.tsx`, o `.module.scss` e o `SolvedCelebration.test.tsx`.
   - **Frontend, alterados:** `AssessmentSimulator.tsx`, `AssessmentSimulator.module.scss` e os testes dele (`AssessmentSimulator.test.tsx`, `AssessmentSimulator.check.test.tsx`), `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/simulate/page.tsx`, `page.module.scss` e `page.test.tsx` (a janela própria), `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e `page.test.tsx` (o botão em aba nova) e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec, `specs/GLOSSARY.md` (seção 4.3) e a nota de sobreposição no histórico das SPEC-081 e 085.
   - **Não alterar:** `ExamTerminal.tsx` (a não ser que a camada peça um ponto de montagem; se pedir, dizer na entrega), os componentes de resposta, `TopicStudy`, `frontend/src/engine/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | **Como é a "tela separada".** (a) Aba nova do navegador, com a página cobrindo a janela sem o menu da plataforma e *Sair da simulação* fechando a aba; (b) a mesma aba, só cobrindo a janela, como o modo foco da aula ao vivo; (c) uma janela nova aberta por script, com tamanho fixo. | **(a).** É o que mais parece uma prova: a docente perde de vista a plataforma e volta ao detalhe fechando a aba. (b) deixa a aba de origem presa na prova; (c) é bloqueada por bloqueador de pop-up e não entra em tela cheia direito. |
| P-02 | **Tela cheia do navegador.** (a) Um botão *Tela cheia* no cabeçalho da prova, opcional; (b) pedir a tela cheia ao acionar *Começar*, sem botão; (c) nada de tela cheia agora. | **(a).** Só um gesto da docente libera a tela cheia (SPEC-059), e *Começar* serviria, mas obrigar a tela cheia incomoda quem testa a prova de relance. Um botão deixa a escolha com ela e fica pronto para a spec das tentativas decidir se a prova real obriga. |
| P-03 | **O que a comemoração faz.** (a) Uma camada sobre a coluna da questão com a marca animada, "Questão resolvida!" e os botões *Próxima questão* (ou *Entregar* na última) e *Continuar nesta questão*; Esc e clique fora fecham; o terminal segue ativo; (b) a mesma camada, mas que some sozinha depois de alguns segundos; (c) só a marca animada no navegador de questões e na linha de estado, sem camada nem botão. | **(a).** É o que o Tech Lead pediu: mostrar o acerto e que se pode ir para a próxima. (b) some antes de quem usa leitor de tela ou está olhando o terminal perceber; (c) não "mostra" o bastante. A trava e o avanço sozinho ficam de fora (SPEC-085 D-02). |
| P-04 | **Mascote.** (a) Sem mascote: a marca de acerto desenhada pelo estilo; (b) trazer o pinguim do TSI do simulado da `main` (`public/tsi.png`), pulando, como antes. | **(a).** A imagem não está na plataforma e não tem a identidade visual dela; a marca desenhada respeita os tokens e o menos movimento. Se o Tech Lead quiser o pinguim, a imagem entra na plataforma com esta spec e a animação dele segue as mesmas regras de menos movimento. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 26/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 26/10/2026 de que o simulador abra numa tela separada, como a prova, e comemore a questão resolvida mostrando que se pode ir para a próxima; conferida contra as SPEC-081, 084 e 085, o modo foco da SPEC-059, o simulado da `main` (`TelaSimulado.ts`) e o código do simulador. Quatro pendências abertas (P-01 a P-04), todas com recomendação |
