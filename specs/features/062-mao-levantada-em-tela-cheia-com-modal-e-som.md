# SPEC-062: Mão Levantada em Tela Cheia, com Modal da Dúvida e Som para o Professor

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-062 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo pedido do Tech Lead) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `frontend/src/components/Classroom/`, `frontend/src/components/TopicStudy/` (só o modo de aula ao vivo) |
| **Contexto de tela** | Sala do aluno (em tela cheia ou não) e painel do professor |
| **Prioridade** | Média |
| **Depende de** | SPEC-057 (palco e tela cheia do aluno), SPEC-058 (mão, dúvida e cabeçalho do módulo), SPEC-059 (modo foco), SPEC-055 (painel) |
| **Substitui** | Parcialmente a SPEC-058 CA-04: a dúvida deixa de ser um campo na faixa de controles e passa a ser escrita num modal |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "o modo de levantar a mão deve funcionar em tela cheia"; ao clicar no ícone de mão do cabeçalho, levanta a mão e abre um modal para o aluno escrever a dúvida; no lado do professor, ao levantar a mão, deve soar um barulho |

---

## 1. Contexto e Problema (Context & Problem Statement)

1. **Em tela cheia o aluno não consegue levantar a mão.** O botão "Tela cheia" (e a tecla F) do aluno leva **só o palco** para a tela cheia do navegador; a faixa de controles, onde está o botão "Levantar a mão", fica de fora e some. Dentro do palco só resta o cabeçalho do módulo, com o ícone de mão e o número de mãos, que hoje é só um indicador.
2. **A dúvida fica escondida na faixa.** Com a mão levantada, o campo da dúvida aparece na faixa de controles, que também some em tela cheia, e o aluno nem percebe que pode escrever.
3. **O professor não percebe a mão.** Quando um aluno levanta a mão, o professor só vê o número mudar; não há aviso sonoro (a sala de espera já tem um).

## 2. Objetivos (Goals)

- O ícone de mão do cabeçalho do módulo vira o botão de levantar a mão do aluno, e funciona em **qualquer** tela cheia.
- Ao levantar a mão, abre um **modal** onde o aluno escreve a dúvida (opcional); o mesmo modal abre pelo botão da faixa.
- O professor **ouve um som** quando um aluno levanta a mão.

### 2.1. Fora de escopo (Non-Goals)

- Mudar o servidor, o protocolo ou o limite de 300 caracteres da dúvida (SPEC-058 inalterada fora do CA-04).
- Som na janela de apresentação (é a tela da turma) ou som para o aluno.
- Escolher o som, o volume ou ter um interruptor só das mãos (vale o "Som do aviso" que o painel já tem).
- Mudar o que o professor vê na lista de mãos.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Ícone de mão como botão (só no aluno).** No cabeçalho do módulo ao vivo (`LiveHeaderStatus`), o ícone com o número passa a ser um `<button>` **na sala do aluno**; no painel e na apresentação do professor continua o indicador de hoje. O botão tem o **mesmo tamanho, o mesmo lugar e o mesmo desenho** do indicador (CA-22 da SPEC-057: nada muda de posição entre as telas), com foco visível e rótulo de acessibilidade ("Levantar a mão" com a mão baixa; "Mão levantada: escrever a dúvida" com ela levantada). Com a mão do próprio aluno levantada, o ícone fica preenchido, além da cor, para não depender só da cor.
- **O clique.**
  - Com a mão **baixa**: levanta a mão (sem texto, um clique) **e** abre o modal da dúvida.
  - Com a mão **levantada**: abre o modal, com a dúvida atual, para editar e reenviar.
- **O modal da dúvida.** Uma caixa (`role="dialog"`, `aria-modal`, com título "Sua mão está levantada") com o campo "Escreva sua dúvida (opcional)" de até 300 caracteres, o contador, o envio por botão ou Enter e o "Dúvida enviada" (o `HandQuestion` da SPEC-058, reaproveitado), mais dois botões: **"Baixar a mão"** (baixa a mão e fecha) e **"Fechar"** (só fecha; a mão continua levantada). A tecla **Esc** fecha. O foco vai para o campo ao abrir, a tecla Tab fica dentro do modal e, ao fechar, o foco volta ao botão que o abriu. O texto não é enviado ao fechar sem enviar.
- **Em qualquer tela cheia.** O ícone e o modal ficam **dentro do elemento que está em tela cheia**: o ícone no cabeçalho do módulo (dentro do palco) e o modal no mesmo elemento que envolve o palco (não dentro da caixa 1280 × 720, para não mudar o palco dos outros e não ser escalado), **sem portal para fora**, porque o navegador só desenha o que está dentro do elemento em tela cheia. Vale para a tela cheia do botão ou da tecla F (o palco) e para a do pedido do professor (a sala inteira, SPEC-059).
- **Faixa de controles.** O botão "Levantar a mão" / "Abaixar a mão" da faixa continua; levantar por ele também abre o modal. O campo da dúvida **sai** da faixa (SPEC-058 CA-04 trocado por esta spec); a faixa continua mostrando "Sua mão está levantada." e a posição na fila.
- **Som no painel do professor.** Quando entra na fila de mãos um aluno que não estava nela, o painel toca um som curto de dois tons (feito no navegador, sem arquivo), **diferente** do da chegada à sala de espera, se o "Som do aviso" estiver ligado. Não toca para as mãos que já estavam levantadas ao abrir ou recarregar o painel, nem quando o aluno só muda a dúvida, nem quando uma mão é baixada. A janela de apresentação não toca som.

### 3.2. Backend (Go — Camada de Módulo/Service)

Nenhuma mudança.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança.

## 5. Contrato de API (API Contract)

Nenhuma mudança: `live:hand:raise {question?}` e `live:hand:lower` seguem como estão.

## 6. Impacto e Riscos (Impact & Risks)

- **O som pode não tocar.** Os navegadores só liberam áudio depois de um gesto do usuário na página; o professor que abriu o painel e clicou em algo já o liberou, mas um painel recém-aberto e sem nenhum clique pode ficar mudo. Mitigação: o painel já exige cliques para aceitar alunos; sem som não é falha (a mão aparece na lista e no número).
- **Barulho demais com muitas mãos de uma vez.** Mitigação: o som toca uma vez por atualização da fila, não uma vez por aluno, e o professor desliga pelo "Som do aviso".
- **Modal sobre o material do aluno.** A SPEC-057 pedia nada sobre o palco; o modal abre por ação do aluno e se fecha com um clique ou Esc, e fica fora da caixa do palco, então o que o professor e os outros alunos veem não muda.
- **Dois pontos de entrada (ícone e faixa).** Mitigação: os dois levam ao mesmo modal e ao mesmo estado.
- **Armadilha de foco.** O Tab preso dentro do modal precisa de teste, porque um modal que prende o foco sem saída é pior que nenhum.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): Na sala do aluno, o ícone de mão do cabeçalho do módulo DEVE ser um botão, com o mesmo tamanho e o mesmo lugar do indicador do professor; no painel e na apresentação do professor NÃO DEVE ser botão.
- [ ] **CA-02** (evento): QUANDO o aluno aciona o ícone com a mão baixa, O SISTEMA DEVE levantar a mão sem exigir texto e DEVE abrir o modal da dúvida.
- [ ] **CA-03** (evento): QUANDO o aluno aciona o ícone com a mão levantada, O SISTEMA DEVE abrir o modal com a dúvida atual, sem levantar a mão de novo.
- [ ] **CA-04** (ubíquo): O modal DEVE ter o campo da dúvida (até 300 caracteres, contador, envio por botão ou Enter, "Dúvida enviada"), o botão "Baixar a mão" e o botão "Fechar"; Esc DEVE fechar sem baixar a mão; o foco DEVE ir para o campo ao abrir, ficar dentro do modal e voltar ao botão de origem ao fechar.
- [ ] **CA-05** (ubíquo): O ícone e o modal DEVEM funcionar na tela cheia do botão ou da tecla F e na do pedido do professor: DEVEM estar dentro do elemento em tela cheia e NÃO DEVEM usar portal para fora dele.
- [ ] **CA-06** (evento): QUANDO o aluno levanta a mão pelo botão da faixa, O SISTEMA DEVE abrir o mesmo modal; o campo da dúvida NÃO DEVE mais aparecer na faixa, que continua mostrando "Sua mão está levantada." e a posição na fila.
- [ ] **CA-07** (ubíquo): O modal NÃO DEVE ficar dentro da caixa 1280 × 720 do palco nem mudar o palco do professor ou dos outros alunos.
- [ ] **CA-08** (evento): QUANDO entra na fila de mãos um aluno que não estava nela, E o "Som do aviso" está ligado, O painel do professor DEVE tocar um som curto, diferente do da sala de espera, uma vez por atualização; NÃO DEVE tocar para as mãos já levantadas ao abrir ou recarregar, ao mudar só a dúvida, ao baixar a mão, nem com o som desligado; a janela de apresentação NÃO DEVE tocar.
- [ ] **CA-09** (ubíquo): Nada fora da aula ao vivo DEVE mudar; os testes existentes passam sem alteração, salvo os da dúvida na faixa (SPEC-058 CA-04), que passam a testar o modal e estão listados no relatório; o servidor e `engine/core` não são alterados.
- [ ] **CA-10** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **`LiveHeaderStatus`:** com `onHand` desenha um botão com o rótulo certo para mão baixa e levantada, chama `onHand` no clique, mostra o número; sem `onHand` é o indicador de hoje (`role="img"`), com o mesmo texto; o estilo do botão não muda o tamanho do indicador (leitura do SCSS) (CA-01).
- **Modal (`HandDialog`):** `role="dialog"` e `aria-modal` com nome; campo com a dúvida salva; envio por botão e Enter; "Baixar a mão" chama o baixar; "Fechar" e Esc chamam o fechar; foco no campo ao abrir; Tab e Shift+Tab ficam dentro; o foco volta ao botão de origem ao fechar (CA-04).
- **`LiveClassroom` (aluno):** o `ModuleStage` recebe `onHand` e o estado da mão do aluno; o clique no ícone com a mão baixa chama `raiseHand()` sem texto e abre o modal; com a mão levantada só abre o modal; o botão da faixa levanta e abre o mesmo modal; o campo não está na faixa; "Baixar a mão" no modal chama `lowerHand` e fecha; o modal está dentro do elemento que recebe a tela cheia do botão e do elemento da sala em tela cheia pedida, e fora do `fixed-stage`; não está num portal fora da sala (CA-02, CA-03, CA-05, CA-06, CA-07).
- **`ModuleStage` e `TopicStudy` ao vivo:** o aluno recebe o botão no cabeçalho e o professor, não; nada muda fora do modo ao vivo (CA-01, CA-09).
- **`TeacherPanel`:** nova mão na fila toca o som de mão uma vez; mãos já levantadas no primeiro estado pronto não tocam; a mesma mão com outra dúvida não toca; baixar não toca; som desligado não toca; a chegada à sala de espera continua tocando o som dela (CA-08).
- **Regressão:** testes existentes da sala, do painel, do `TopicStudy` e das SPEC-055 a 061 passam sem alteração, salvo os da dúvida na faixa, trocados e listados no relatório (CA-09).
- **Manual:** aluno em tela cheia (F) clica na mão do cabeçalho, escreve a dúvida no modal e envia; Esc fecha; clica de novo e baixa a mão; o professor ouve o som uma vez por mão nova; com o som desligado fica mudo; repetir com a tela cheia pedida pelo professor.
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-057, SPEC-058, SPEC-059 e esta; `components/Classroom/LiveClassroom`, `HandQuestion`, `LiveHeaderStatus`, `ModuleStage`, `TeacherPanel`; `components/TopicStudy/LiveTopicScreen.tsx`; `messages/pt-BR.ts` (`classroom.hands`).
2. **Ordem de execução:** testes vermelhos e commit `test`; o modal; o ícone como botão (cadeia `LiveClassroom` → `ModuleStage` → `TopicStudy` → `LiveHeaderStatus`); o som no painel; mensagens.
3. **Arquivos a criar ou alterar:** `frontend/src/components/Classroom/HandDialog/**` (novo), `LiveClassroom/**`, `LiveHeaderStatus/**`, `ModuleStage/**`, `TeacherPanel/**`, `frontend/src/components/TopicStudy/LiveTopicScreen.tsx`, `messages/pt-BR.ts`, `specs/GLOSSARY.md`. **Não alterar** `engine/core`, o backend, nem os arquivos do Tech Lead em andamento.
4. **Definição de pronto:** CA marcados, testes verdes, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

O Tech Lead pediu: tela cheia funcionando, ícone que levanta a mão e abre um modal, e som no professor. São escolhas da Aruna, a revisar: (1) o modal **substitui** o campo da dúvida na faixa (em vez de existirem os dois); (2) o som só no **painel**, não na janela de apresentação, e dentro do "Som do aviso" que já existe (sem interruptor próprio); (3) o som de dois tons; (4) o ícone do aluno fica preenchido quando a mão dele está levantada; (5) **Fechar** não baixa a mão, só "Baixar a mão" baixa.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo pedido do Tech Lead; as escolhas da seção 10 ficam para a revisão dele |
