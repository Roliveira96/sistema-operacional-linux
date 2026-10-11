# SPEC-032: Modo rápido da verificação de conformidade do motor (sem animação de digitação)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-032 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 (implementada) |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (sem backend, sem banco, sem API) |
| **Módulo** | `engine` (adaptador do motor em `frontend/src/engine/`) e tela de administração |
| **Contexto de tela** | `/app/admin/conformidade` |
| **Prioridade** | Média |
| **Depende de** | SPEC-030 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026. Medição de 11/10/2026: ~0,5 s por caso mesmo na velocidade máxima. |

---

## 1. Contexto e Problema (Context & Problem Statement)

A verificação de conformidade (SPEC-030) executa mais de 8 mil casos no terminal da tela. Mesmo na velocidade máxima, cada caso leva cerca de meio segundo, porque o terminal mantém a animação de digitação e pausas fixas entre o comando e a resposta. A execução completa leva mais de uma hora em sequência. O administrador não consegue repetir a verificação depois de corrigir uma falha, e o desenvolvedor só consegue rodar tudo no Node dividindo as suítes em grupos paralelos.

As pausas ficam no terminal herdado de `legacy/`, congelado pela regra do projeto. Por isso a mudança exige spec aprovada.

## 2. Objetivos (Goals)

- A tela de conformidade oferece um **modo rápido**, que executa os casos sem a animação de digitação e sem as pausas do terminal, produzindo as mesmas respostas, os mesmos códigos de saída e o mesmo transcript.
- O resultado de cada caso no modo rápido é idêntico ao do modo ao vivo (mesmo status e mesma saída). O modo só muda o tempo gasto.
- A execução completa no modo rápido leva no máximo 10% do tempo do modo ao vivo.

### 2.1. Fora de escopo (Non-Goals)

- Mudar o comportamento do terminal em aula (estudantes e docentes continuam com a animação).
- Remover o modo ao vivo: ele continua sendo o padrão e o único que mostra o terminal sendo digitado.
- Paralelizar a execução em várias janelas.
- Alterar o manifesto, os casos ou as regras de aprovação da SPEC-030.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- Na tela de conformidade, uma opção "Modo rápido (sem animação)" ao lado do botão de iniciar, desligada por padrão, travada enquanto a verificação roda.
- No modo rápido a tela mostra a barra de progresso e o caso corrente, mas o terminal ao vivo não é animado: ele recebe o histórico ao final (ou a cada suíte).
- O transcript exportado (copiar e baixar) é o mesmo nos dois modos.
- Textos da opção ficam no arquivo de mensagens da tela, nos dois temas.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: a verificação roda só no navegador.

### 3.3. Regras de negócio

- **RN-01:** O modo rápido não pode mudar o resultado de nenhum caso: status, saída e aprovação são os do modo ao vivo.
- **RN-02:** O modo rápido só vale para a verificação de conformidade. O terminal usado em aula não muda.
- **RN-03:** O tempo máximo por caso (SPEC-030 RN-14) continua valendo no modo rápido.
- **RN-04:** Casos que dependem de tempo real do terminal (`sleep`, `watch`, `yes`, `timeout`) mantêm seus tempos, pois o que se verifica neles é o tempo.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema. A escolha do modo vive só no estado da tela.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: não há endpoint nem evento de tempo real.

## 6. Impacto e Riscos (Impact & Risks)

- **Risco:** o modo rápido passar um caso que o ao vivo reprova (ou o contrário), por diferença de sequência de eventos. **Mitigação:** teste automatizado que executa as mesmas suítes nos dois modos e compara status e saída caso a caso (CA-02).
- **Risco:** alterar `legacy/` quebrar o simulador original. **Mitigação:** a mudança, se necessária (P-01), é só uma opção que por padrão mantém o comportamento atual; os testes do legado não são usados como verificação de entrega.
- **Impacto:** `terminalWindow` e o runner da conformidade; nenhum outro módulo.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): A tela de conformidade DEVE oferecer o modo rápido, desligado por padrão.
- [x] **CA-02** (evento): QUANDO as mesmas suítes rodam nos dois modos, O SISTEMA DEVE produzir o mesmo status, a mesma saída e a mesma aprovação para cada caso.
- [x] **CA-03** (evento): QUANDO a verificação completa roda no modo rápido, O SISTEMA DEVE terminá-la em no máximo 10% do tempo do modo ao vivo.
- [x] **CA-04** (estado): ENQUANTO a verificação roda, O SISTEMA DEVE manter a opção de modo travada.
- [x] **CA-05** (indesejado): SE um caso excede o tempo máximo no modo rápido, ENTÃO O SISTEMA DEVE registrá-lo como falha, como no modo ao vivo.
- [x] **CA-06** (ubíquo): O terminal de aula DEVE continuar com a animação de digitação inalterada.
- [x] **CA-07** (evento): QUANDO o administrador copia ou baixa o terminal, O SISTEMA DEVE gerar o mesmo conteúdo nos dois modos.

## 8. Plano de Testes (Test Plan)

- **Frontend (componente):** a opção aparece desligada, trava durante a execução, nos dois temas (cobre CA-01, CA-04).
- **Frontend (motor real):** suítes pequenas rodadas nos dois modos, com comparação caso a caso (cobre CA-02, CA-07); caso com tempo excedido (cobre CA-05); terminal de aula sem alteração (cobre CA-06).
- **Manual:** cronometrar a verificação completa nos dois modos (cobre CA-03).
- **Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-030, `frontend/src/engine/terminalWindow.ts`, `frontend/src/engine/conformance/runner.ts`, `frontend/src/components/EngineConformance/`.
2. **Ordem de execução:** (1) decidir a abordagem da P-01 com o Tech Lead; (2) implementar o modo no adaptador; (3) opção na tela e mensagens; (4) testes; (5) atualizar a SPEC-030 (histórico).
3. **Arquivos a criar ou alterar:** a lista final depende da P-01; qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| — | Nenhuma em aberto | P-01 resolvida pelo Tech Lead em 11/10/2026: abordagem (b), só no motor da conformidade, ignorando `legacy/`. P-02 deixou de existir: o terminal da tela segue desenhando cada comando, só sem as pausas |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Aruna Architect | Criação em rascunho |
| 11/10/2026 | Implementador (Claude) | Implementada pela abordagem (b), a pedido do Tech Lead: o adaptador (`terminalWindow.ts`) ganha `setInstant`, que envia a linha direto ao terminal sem digitar nem pausar; o executor recebe `instant`; a tela ganha a opção "Modo rápido". Medido no motor real em 4 suítes (ls, grep, cat, sudo): 132 s ao vivo contra 3,5 s no modo rápido (cerca de 37 vezes mais rápido), com a mesma saída, o mesmo status e o mesmo transcript (horários normalizados). CA-03 medido só nesse subconjunto; a verificação completa não foi cronometrada. Desvio: nenhum arquivo de `legacy/` foi tocado |
