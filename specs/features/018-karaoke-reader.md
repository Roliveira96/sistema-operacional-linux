# SPEC-018: Leitor Estilo Karaokê no Material do Tópico

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-018 |
| **Status** | Aprovada |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (e uma revisão pequena do backend da SPEC-017, ver P-02) |
| **Módulo** | `TopicStudy` (frontend); `tts` (backend, só o limite de taxa) |
| **Contexto de tela** | `/materials/[id]` e `/app/modules/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-016 (tela do tópico), SPEC-017 (rota de síntese de voz) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 09/10/2026 ("ao dar play no material devemos ouvir o leitor lendo as palavras; nos comandos, sempre tem que falar, vendo o comando rodando no terminal ao lado"; "leitor estilo karaokê"); `legacy/src/app/TelaTopico.ts` (o player e o "Rodar este card") |

---

## 1. Contexto e Problema (Context & Problem Statement)

A tela do tópico (SPEC-016) já executa os comandos de um card no terminal, mas em silêncio: o estudante lê o material sozinho e só vê os comandos rodando. A SPEC-017 entregou o serviço que gera a voz e o instante de cada palavra, mas nenhuma tela o usa.

O Tech Lead quer que o material seja **lido em voz alta, com a palavra falada destacada, como em um karaokê**. Ao tocar um card, o estudante ouve o texto sendo lido e acompanha cada palavra na tela. Quando chega a um comando, a voz fala dele **enquanto o comando é digitado e executado no terminal ao lado**.

## 2. Objetivos (Goals)

- Narrar, com voz, o texto dos cards na ordem em que aparecem, destacando a palavra que está sendo falada.
- Em cada comando, falar durante a execução no terminal, sem que a fala e a digitação se atropelem nem se percam.
- Integrar a narração aos controles que já existem (▶ Rodar este card, ▶ de um comando, play do cabeçalho, velocidade), sem criar um segundo player.
- Deixar o estudante ligar e desligar o som, e lembrar a escolha.
- Não travar o material: se a voz falhar, o card continua em silêncio e avisa.

### 2.1. Fora de escopo (Non-Goals)

- Mudar a rota de síntese da SPEC-017, salvo o limite de taxa da P-02.
- Escolher voz, tom ou idioma na tela (usa a voz padrão).
- Narrar o simulador de provas, a aba de desafios, a Cola e os componentes interativos (`WIDGET`).
- Guardar áudio em banco ou em MinIO. O áudio vive só na memória da página.
- Narração offline.
- Alterar o `legacy/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Linha do tempo do card.** Ao tocar um card, o player monta uma lista de itens na ordem dos blocos do card:

| Tipo de bloco | O que acontece | O que é falado |
| :--- | :--- | :--- |
| Título do card | Lido primeiro | O título |
| `TEXT`, `LEGACY_HTML`, `TIP`, `CURIOSITY`, `STEP_BY_STEP`, `CARDS` | Narrado, com destaque palavra a palavra | O texto do bloco, sem marcação |
| `COMMAND` (cada passo) | O comando é digitado e executado no terminal **enquanto** a voz fala | A explicação do passo; sem explicação, o próprio comando (ver P-03) |
| `WIDGET` | Ignorado | Nada |

**Regras do karaokê:**
- **RF-01 (palavra destacada):** a palavra falada no momento recebe o destaque da identidade visual; as já faladas ficam em tom suave e as próximas, normais.
- **RF-02 (um trecho por vez):** o texto longo é dividido em trechos de até 2000 caracteres, em fim de frase (limite da SPEC-017). O trecho seguinte é pedido enquanto o atual toca, para não haver pausa.
- **RF-03 (comando e fala juntos):** em um passo de comando, a digitação no terminal e a fala começam juntas. O próximo item só começa quando **os dois** terminam.
- **RF-04 (sempre fala):** passos de comando falam sempre que o som estiver ligado.
- **RF-05 (parar):** parar o card, pausar o play ou clicar em outro card interrompe a voz na hora e cancela os pedidos pendentes.
- **RF-06 (falha da voz):** se um trecho não puder ser gerado (limite, serviço fora, sem sessão), o item segue em silêncio, o texto é mostrado sem destaque e um aviso aparece uma vez por card.
- **RF-07 (velocidade):** a velocidade do player vale para a digitação; para a voz, a velocidade de reprodução acompanha o seletor até o limite de 2× (ver P-05).
- **RF-08 (som):** um botão 🔊/🔇 no cabeçalho liga e desliga a narração; a escolha fica salva no navegador. Com o som desligado, o player funciona como hoje (SPEC-016).
- **RF-09 (clique do estudante):** o navegador só deixa tocar áudio depois de um clique; a narração começa sempre de um clique do estudante (play, card ou comando). Se o navegador recusar, um aviso pede o clique.
- **RF-10 (cache):** o áudio de um mesmo trecho é reaproveitado enquanto a página estiver aberta, sem novo pedido ao servidor.
- **RF-11 (acessibilidade):** o botão de som tem nome acessível e estado (`aria-pressed`); o destaque não é a única indicação (a palavra atual também fica sublinhada); a página continua legível com a narração desligada.

**Destaque sem alterar o HTML do conteúdo.** O texto do bloco continua sendo o HTML já filtrado pelo backend (SPEC-011). O destaque usa a API de realce do navegador sobre intervalos de texto, sem inserir elementos nem mexer na estrutura. Navegadores sem essa API ouvem a narração sem destaque (ver P-04).

**Serviço de rede:** nova função em `services/` para a rota `POST /api/v1/speech-syntheses`, com erros RFC 7807 tipados (`rate-limited`, `speech-busy`, `speech-unavailable`, `speech-provider-failed`, `speech-timeout`, `not-authenticated`).

**Extração de texto:** função pura que transforma o HTML de um bloco em texto simples e no mapa entre as palavras e suas posições no texto exibido, para o destaque.

### 3.2. Backend (Go — Camada de Módulo/Service)

Sem rota nova. Somente a revisão do limite de taxa da SPEC-017, se a P-02 for aprovada: o limite por usuário passa de 20 para 60 requisições por minuto, configurável.

## 4. Modelo de Dados (Data Model)

Sem mudança de schema. Estruturas só em memória, no navegador:

| Estrutura | Campos | Descrição |
| :--- | :--- | :--- |
| Trecho de narração (`NarrationChunk`) | texto, posição inicial no bloco, áudio, marcas de palavra | Parte de até 2000 caracteres de um bloco, com o áudio pedido ao servidor |
| Item da linha do tempo (`NarrationItem`) | tipo (`TEXT` ou `COMMAND`), bloco, trechos, passo do roteiro quando for comando | Um bloco do card, na ordem de reprodução |
| Preferência de som | `ligado` ou `desligado` | Guardada em `localStorage`, chave própria |

## 5. Contrato de API (API Contract)

Usa a rota 5.1 da SPEC-017 sem mudar o contrato (`POST /api/v1/speech-syntheses`). O frontend consome `audioBase64`, `mimeType`, `voice` e `words` (`word`, `startMs`, `endMs`). Os erros desta spec seguem a tabela daquela rota.

## 6. Impacto e Riscos (Impact & Risks)

- **Visitantes sem voz.** A rota exige sessão (SPEC-017, P-02 aprovada), e `/materials` é pública.
  *Mitigação:* ver P-01; sem decisão contrária, o visitante vê o card em silêncio e um convite para entrar.
- **Limite de requisições estourado por um card longo.** Um card pode gerar mais de 20 trechos por minuto.
  *Mitigação:* cache de áudio (RF-10), pedido do trecho seguinte só com o atual tocando e revisão do limite (P-02).
- **Atraso na primeira palavra.** A síntese leva em torno de 1 a 2 segundos.
  *Mitigação:* o primeiro trecho de um card é pedido ao clicar; o terminal só começa a digitar quando o áudio do passo está pronto, ou após 3 segundos de espera, o que vier primeiro, avisando que a voz está atrasada.
- **Destaque desalinhado do texto.** O texto exibido pode diferir do texto falado (espaços, entidades HTML, tabelas).
  *Mitigação:* a função de extração monta o texto falado e o mapa de posições a partir do mesmo percurso do DOM; teste com blocos reais dos 8 módulos.
- **Dependência do endpoint não oficial** (riscos da SPEC-017).
  *Mitigação:* RF-06 mantém o material funcionando sem voz.
- **Autoplay bloqueado pelo navegador.**
  *Mitigação:* RF-09.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o estudante, logado e com o som ligado, clicar em "Rodar este card", O SISTEMA DEVE falar o título e o texto do card, em ordem, destacando a palavra falada.
- [ ] **CA-02** (evento): QUANDO a narração chegar a um passo de comando, O SISTEMA DEVE digitar e executar o comando no terminal enquanto fala, e SÓ DEVE passar ao próximo item quando a fala e o comando tiverem terminado.
- [ ] **CA-03** (ubíquo): ENQUANTO o som estiver ligado, O SISTEMA DEVE falar todo passo de comando, o executado pelo ▶ do comando, pelo card ou pelo play do cabeçalho.
- [ ] **CA-04** (evento): QUANDO o estudante parar o card, pausar o play ou clicar em outro card, O SISTEMA DEVE interromper a voz e cancelar os pedidos pendentes na hora.
- [ ] **CA-05** (indesejado): SE a voz de um trecho falhar, ENTÃO O SISTEMA DEVE seguir em silêncio nesse item, avisar uma vez por card e NÃO DEVE travar a execução dos comandos.
- [ ] **CA-06** (indesejado): SE não houver sessão, ENTÃO O SISTEMA DEVE manter o material em silêncio e mostrar o convite para entrar (P-01).
- [ ] **CA-07** (estado): ENQUANTO o som estiver desligado, O SISTEMA DEVE funcionar exatamente como na SPEC-016, sem pedir áudio.
- [ ] **CA-08** (evento): QUANDO o estudante alternar 🔊/🔇, O SISTEMA DEVE guardar a escolha e aplicá-la na próxima visita.
- [ ] **CA-09** (ubíquo): O SISTEMA DEVE dividir textos acima de 2000 caracteres em trechos terminados em fim de frase e NUNCA enviar mais que o limite.
- [ ] **CA-10** (ubíquo): O SISTEMA DEVE reaproveitar o áudio de um trecho já pedido na mesma visita, sem novo pedido.
- [ ] **CA-11** (ubíquo): A narração NÃO DEVE ler marcação HTML nem o conteúdo de `WIDGET`.
- [ ] **CA-12** (evento): QUANDO o navegador recusar tocar o áudio, ENTÃO O SISTEMA DEVE avisar o estudante para clicar de novo e seguir em silêncio até lá.
- [ ] **CA-13** (ubíquo): A velocidade de reprodução da voz DEVE acompanhar o seletor do player até o limite da P-05, e a digitação DEVE seguir o seletor inteiro.
- [ ] **CA-14** (ubíquo): O botão de som DEVE ter nome acessível e estado, e o destaque DEVE ter sublinhado além da cor.

## 8. Plano de Testes (Test Plan)

- **Frontend (unidade):**
  - extração de texto e mapa de palavras com HTML real dos módulos, incluindo tabelas, entidades e `<code>` (CA-09, CA-11);
  - divisão em trechos (CA-09);
  - serviço de síntese: sucesso e cada erro RFC 7807;
  - linha do tempo do card: ordem, itens ignorados, comando com e sem explicação (CA-01, CA-02, CA-03, CA-11);
  - narrador com áudio simulado: início, fim, parada, falha e recusa do navegador (CA-04, CA-05, CA-12);
  - cache e pré-busca (CA-10);
  - preferência de som (CA-08).
- **Frontend (componente):** tela com o narrador simulado: botão de som, destaque da palavra, convite a visitantes, som desligado idêntico à SPEC-016 (CA-06, CA-07, CA-13, CA-14).
- **Backend:** se a P-02 for aprovada, teste do novo limite configurável (`config` e `handler` da SPEC-017).
- **Manual:** roteiro com o serviço real: tocar um card do módulo História logado, conferir fala, destaque e comando no terminal juntos; trocar a velocidade; parar no meio; desligar o som.
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** SPEC-016, SPEC-017, `specs/ARCHITECTURE.md`, `frontend/src/components/TopicStudy/`, `frontend/src/hooks/useTopicPlayer.ts`, `frontend/src/lib/topicScript.ts` e `frontend/src/components/ContentRenderer/blocks.tsx`.
2. **Ordem de execução:**
   1. serviço de síntese em `services/` com testes;
   2. extração de texto, mapa de palavras e divisão em trechos (`lib/`), com testes sobre HTML real;
   3. narrador (`hooks/`): áudio, fila, pré-busca, cache, parada, falhas;
   4. integração com o player (linha do tempo do card, comando e fala juntos);
   5. destaque na tela e botão de som;
   6. limite de taxa configurável no backend, se a P-02 for aprovada;
   7. glossário e `ARCHITECTURE.md`, se algo mudar.
3. **Arquivos e diretórios a criar ou alterar:** `frontend/src/services/speechService.ts` e teste; `frontend/src/lib/narration.ts` e teste; `frontend/src/hooks/useNarrator.ts` e teste; `frontend/src/hooks/useTopicPlayer.ts` e teste; `frontend/src/components/TopicStudy/` (`TopicStudy.tsx`, `PlayerBar.tsx`, `LessonPanel.tsx` e estilos); `frontend/src/styles/globals.scss` e `_tokens.scss` (destaque); `frontend/src/messages/content.pt-BR.ts`; `specs/GLOSSARY.md`. Backend, só com a P-02: `backend/internal/platform/config/config.go` e teste, `backend/cmd/api/main.go` e `.env.example`. Qualquer outro arquivo exige justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, ESLint, Stylelint, `tsc` e `next build` limpos, roteiro manual registrado no histórico e status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-06 aprovadas pelo Tech Lead em 09/10/2026, nas recomendações:

- **P-01:** narração só para usuários logados; visitantes veem o convite para entrar.
- **P-02:** limite de taxa da rota de voz passa de 20 para 60 por minuto, configurável por `TTS_RATE_PER_MINUTE` (revisa a RN-08 e a CA-12 da SPEC-017).
- **P-03:** nos comandos, fala a explicação do passo; sem explicação, fala o comando.
- **P-04:** destaque pela API de realce do navegador, com degradação para navegadores sem ela.
- **P-05:** velocidade da voz limitada a 2×.
- **P-06:** som ligado por padrão para usuários logados, com a escolha guardada em `localStorage`.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação a pedido do Tech Lead ("leitor estilo karaokê"; narrar o material ao dar play e falar os comandos enquanto rodam no terminal). Pendências P-01 a P-06 |
| 09/10/2026 | Tech Lead | Aprovação integral de P-01 a P-06 nas recomendações. Status: `Aprovada` |
