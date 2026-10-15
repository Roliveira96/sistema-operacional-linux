# SPEC-070: Tela de espera para os alunos enquanto não há janela de apresentação

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-070 |
| **Status** | Aprovada |
| **Data de criação** | 15/10/2026 |
| **Última revisão** | 15/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (backend) e `Classroom` (frontend) |
| **Contexto de tela** | Sala do aluno (`/app/classes/[id]/live`) e painel do professor |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051, SPEC-054, SPEC-055, SPEC-061 |
| **Substitui** | Nenhuma (muda o comportamento que a SPEC-055 lista como risco: "aluno pode ficar sem palco se a janela de apresentação não estiver aberta") |
| **Fontes canônicas** | Pedido do Tech Lead em 15/10/2026: "se o professor fechar a janela de apresentação, devemos mudar a tela do aluno para a tela de espera de forma obrigatória"; decisões do mesmo dia: mostrar a tela de espera sempre que não houver janela de apresentação, até o professor mudar para o modo de apresentação, e esperar uns 10 segundos quando a janela some por recarga |

---

## 1. Contexto e Problema (Context & Problem Statement)

O palco que os alunos veem é o da janela de apresentação do professor (SPEC-055): lâmina, laser, caneta e terminal só existem nela. Sem essa janela, os alunos olham uma tela parada, que não é o que o professor quer mostrar: no começo da aula, antes de a janela ser aberta, e depois que ela é fechada ou cai, o servidor avisa só o painel. A tela de espera (SPEC-061) só liga se o professor apertar B dentro da própria janela de apresentação, que é justamente a janela que está faltando.

## 2. Objetivos (Goals)

- Enquanto não houver janela de apresentação conectada na sala, os alunos aceitos veem a tela de espera, sem ação do professor, desde o começo da aula.
- Quando o professor abre a janela de apresentação (muda para o modo de apresentação), a tela de espera sai sozinha e o palco aparece para todos.
- Quando a janela some, por fechamento, recarga ou queda de conexão, os alunos só vão para a tela de espera se ela não voltar em 10 segundos.
- O painel diz ao professor que a turma está vendo a tela de espera e como sair dela.

### 2.1. Fora de escopo (Non-Goals)

- Mudar o desenho da tela de espera (SPEC-061), a sala de espera de admissão (SPEC-054) e a tecla B do professor.
- Encerrar a aula ao fechar a janela (SPEC-055 CA-10 continua valendo).
- Dar ao painel o comando de desligar a tela de espera: ela só sai quando a janela de apresentação conecta.
- Mensagem nova no protocolo da sala: a mensagem `live:stage:blank` e o campo `stageBlank` do instantâneo já existem.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Aluno:** nenhuma tela nova. A sala do aluno já desenha a tela de espera quando recebe `live:stage:blank` com `blank` verdadeiro e quando o instantâneo traz `stageBlank` verdadeiro (SPEC-061); a mudança é o servidor passar a decidir isso também pela falta da janela de apresentação.
- **Painel do professor:** enquanto a janela de apresentação não está conectada, o aviso do painel (hoje "Janela de apresentação fechada") ganha uma segunda linha: "Sem a janela de apresentação, a turma vê a tela de espera. Abra a janela de apresentação para continuar a aula.", ao lado do botão **Abrir janela de apresentação**. Ao conectar, o aviso some. O passo "Abrir a janela de apresentação" do começo guiado (SPEC-055) segue como está. Textos no arquivo de mensagens, cores só dos tokens, nos temas claro e escuro.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (sem janela, tela de espera):** a tela de espera dos alunos vale quando a tecla B está ligada **ou** quando nenhuma janela de apresentação está conectada na sala e a tolerância da RN-03 não está correndo. A sala guarda em memória só se uma janela de apresentação já conectou e a tolerância não acabou sem ela; uma sala sem esse registro conta como "sem janela". Reiniciar o servidor volta, então, ao "sem janela", que é o valor certo até a janela conectar de novo.
- **RN-02 (começo da aula):** numa sala que ainda não teve janela de apresentação, a tela de espera vale desde o primeiro aluno aceito, sem tolerância. Quando a primeira janela conecta, a tela de espera sai e todos são avisados.
- **RN-03 (tolerância de 10 segundos):** quando a última janela de apresentação sai da sala, a tela de espera **não** liga na hora: o servidor espera 10 segundos. Se uma janela de apresentação conectar nesse prazo (recarga, queda curta ou substituição da janela por outra, SPEC-055 RN-01), nada muda para os alunos e nenhum aviso é enviado. Se o prazo acabar sem janela, o servidor envia `live:stage:blank` com `blank` verdadeiro a todos os conectados da sala. O prazo é fixo, de 10 segundos.
- **RN-04 (reabrir desliga):** quando uma janela de apresentação conecta e a tela de espera estava ligada, por falta da janela ou pela tecla B, ela sai e todos recebem `live:stage:blank` com `blank` falso (a SPEC-055 já faz isso para a tecla B).
- **RN-05 (quem entra depois):** o aluno que entra ou reconecta recebe `stageBlank` pela RN-01: verdadeiro se não há janela e a tolerância não está correndo, falso se há janela, e o valor da tecla B nos demais casos.
- **RN-06 (fim da aula não liga):** o encerramento da aula, pelo painel ou pela rede de segurança, fecha a sala e desconecta todos; isso não liga a tela de espera, não envia o aviso e cancela a tolerância que estiver correndo.
- **RN-07 (o painel não desliga):** sem a janela, trocar lâmina, modo ou módulo pelo painel continua valendo no servidor, mas o aluno só vê o palco depois que a janela de apresentação conectar (a tecla B é da janela de apresentação, SPEC-055 RN-02).

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema. Em memória, por sala: o registro de que uma janela de apresentação conectou (e ainda não acabou a tolerância sem ela) e o temporizador da tolerância de 10 segundos. Nenhum dos dois sobrevive a reinício do servidor, e não precisam: sem registro, a sala conta como "sem janela" (RN-01).

## 5. Contrato de API (API Contract)

Nenhum endpoint e nenhuma mensagem nova.

- **`live:stage:blank`** (servidor → todos os conectados da sala): `blank` verdadeiro passa a ser enviado também quando acaba a tolerância sem janela (RN-03); `blank` falso, quando uma janela conecta com a tela de espera ligada (RN-04).
- **Instantâneo** de painel, apresentação e aluno: o campo `stageBlank` (já existe) passa a seguir a RN-01 e a RN-05.

## 6. Impacto e Riscos (Impact & Risks)

- **Professor que dá a aula só pelo painel:** a turma fica na tela de espera até ele abrir a janela de apresentação. Mitigação: é a decisão do Tech Lead; o painel diz isso, mostra o botão para abrir a janela e o começo guiado já tem esse passo em primeiro lugar.
- **Recarga ou queda curta da janela:** a tolerância de 10 segundos evita que os alunos vejam a tela de espera por um instante. Mitigação: RN-03; se a janela demorar mais que isso, a tela de espera aparece, o que é verdadeiro.
- **Fechamento de propósito também espera 10 segundos:** o servidor não distingue fechar de recarregar. Mitigação: aceito; são 10 segundos.
- **Fim da aula:** desconectar todos não pode ligar a tela de espera nem gerar mensagens para uma sala que fechou, e a tolerância pendente deve ser cancelada. Mitigação: RN-06 e CA-06.
- **Corridas:** janela nova entrando enquanto a antiga sai, e tolerância acabando no instante em que a janela conecta. Mitigação: a decisão olha quem está conectado no momento em que a tolerância acaba (RN-01); testes com relógio controlado.
- **Dublês dos testes da sala:** a interface do serviço ou do hub pode crescer; os testes existentes não mudam o que verificam, só os que esperavam o palco visível sem janela de apresentação ganham a janela conectada.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (estado): ENQUANTO a sala não tem janela de apresentação conectada e nenhuma tolerância está correndo, O SISTEMA DEVE mostrar aos alunos aceitos a tela de espera, inclusive no começo da aula, antes da primeira janela.
- [ ] **CA-02** (evento): QUANDO uma janela de apresentação conecta com a tela de espera ligada, O SISTEMA DEVE desligá-la e enviar `live:stage:blank` com `blank` falso a todos os conectados da sala.
- [ ] **CA-03** (evento): QUANDO a última janela de apresentação sai da sala, O SISTEMA DEVE esperar 10 segundos e, se nenhuma janela conectou nesse prazo, ligar a tela de espera e enviar `live:stage:blank` com `blank` verdadeiro a todos os conectados da sala.
- [ ] **CA-04** (indesejado): SE uma janela de apresentação conecta dentro dos 10 segundos (recarga, queda curta ou substituição por outra janela), ENTÃO O SISTEMA NÃO DEVE ligar a tela de espera nem enviar o aviso.
- [ ] **CA-05** (estado): ENQUANTO não há janela de apresentação e a tolerância não está correndo, O SISTEMA DEVE dar a quem entra ou reconecta o instantâneo com `stageBlank` verdadeiro; ENQUANTO a tolerância corre, o valor da tecla B.
- [ ] **CA-06** (indesejado): SE a aula é encerrada, pelo painel ou pela rede de segurança, ENTÃO O SISTEMA NÃO DEVE ligar a tela de espera nem enviar `live:stage:blank` por causa da saída da janela, e DEVE cancelar a tolerância em andamento.
- [ ] **CA-07** (estado): ENQUANTO não há janela de apresentação, O SISTEMA DEVE manter a tela de espera para os alunos, mesmo que o painel troque lâmina, modo ou módulo.
- [ ] **CA-08** (estado): ENQUANTO a janela de apresentação não está conectada, O painel DEVE dizer que a turma vê a tela de espera e mostrar o botão **Abrir janela de apresentação**, e DEVE tirar o aviso quando a janela conectar.
- [ ] **CA-09** (ubíquo): O SISTEMA NÃO DEVE mudar nada para o estudante que ainda espera ser aceito (SPEC-054) nem para quem não está na sala.
- [ ] **CA-10** (ubíquo): O SISTEMA DEVE manter a tecla B como está: com a janela conectada, a tela de espera liga e desliga só por ela.

## 8. Plano de Testes (Test Plan)

- **Backend, handler (`classroom`, WebSocket com painel, janela de apresentação, aluno aceito e aluno em espera; tolerância com relógio controlado):**
  - sala sem janela: o aluno aceito recebe o instantâneo com `stageBlank` verdadeiro (CA-01, CA-05);
  - a primeira janela conecta e todos recebem `blank` falso (CA-02);
  - a janela sai, passam 9 segundos e ninguém recebe aviso; passam os 10 e o aluno aceito e o painel recebem `blank` verdadeiro, e o aluno em espera não recebe nada (CA-03, CA-09);
  - a janela sai e uma nova conecta antes dos 10 segundos, e ninguém recebe `blank` verdadeiro, nem depois que o prazo passa (CA-04);
  - uma janela nova substitui a antiga e nada muda (CA-04);
  - o aluno que entra durante a tolerância recebe o valor da tecla B, e depois do prazo, `stageBlank` verdadeiro (CA-05);
  - a aula é encerrada durante a tolerância e nada é enviado depois (CA-06);
  - o painel troca a lâmina sem janela e o aluno continua com `stageBlank` verdadeiro (CA-07);
  - com a janela conectada, a tecla B liga e desliga como antes (CA-10).
- **Backend, service:** o estado da tecla B continua o mesmo; a decisão da RN-01 com e sem janela (CA-01, CA-05, CA-10).
- **Frontend, painel do professor:** sem a janela, o aviso e o botão aparecem, nos dois temas, e somem ao conectar (CA-08).
- **Frontend, sala do aluno:** ao receber `live:stage:blank` verdadeiro sem ação do professor, o aluno vê a tela de espera, e o palco volta ao receber `blank` falso (CA-01, CA-02; o desenho em si já é testado pela SPEC-061).
- **Testes existentes:** os da sala que esperavam o palco visível sem janela de apresentação ganham a janela conectada, sem mudar o que verificam.
- **Manual:** professor entra na aula e a turma vê a tela de espera; abre a janela de apresentação e o palco aparece; recarrega a janela e os alunos não veem nada de diferente; fecha a janela, espera 10 segundos e os alunos vão para a tela de espera; reabre e o palco volta; encerra a aula com a janela aberta e nada estranho aparece (CA-01 a CA-06).
- **Cobertura:** acima de 80% no escopo da spec (`go test -cover` e Vitest em modo de cobertura).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-054, SPEC-055 (RN-01, RN-02, RN-05, CA-09), SPEC-061; `backend/internal/modules/classroom/handler/ws.go` (`Left`, `Joined`, `presenterState`, `takeOverStage`, `snapshot`), `service/livestate.go` e `backend/internal/platform/hub/` (`KindConnected`); `frontend/src/components/Classroom/TeacherPanel/` e `frontend/src/hooks/useLiveClassroom.ts`.
2. **Ordem de execução:** (1) testes da seção 8, vermelhos, e commit `test`; (2) o instantâneo e o aviso passam a seguir a RN-01 e a RN-05; (3) a tolerância de 10 segundos, com o relógio injetável, e o aviso ao conectar a janela; (4) o aviso e o texto no painel; (5) mensagens; (6) verificação e commit `feat`; (7) roteiro manual e status `Implementada`.
3. **Arquivos e diretórios a criar ou alterar:** `backend/internal/modules/classroom/handler/ws.go` (e o que a tolerância precisar do serviço) e seus testes; `frontend/src/components/Classroom/TeacherPanel/**`; `frontend/src/messages/pt-BR.ts`. Qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, ESLint e Stylelint sem erros, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 15/10/2026: a tela de espera vale sempre que não há janela de apresentação, inclusive no começo da aula, e a tolerância para recarga é de 10 segundos.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 15/10/2026 | Aruna Architect | Criação em Rascunho, a pedido do Tech Lead |
| 15/10/2026 | Aruna Architect | Aprovada pelo Tech Lead ("Sim chat, pode ir fazendo em ordem"); RN-01 e seção 4 ajustadas para dizer que o registro da janela fica em memória, o que o desenho exige |
| 15/10/2026 | Aruna Architect | Decisões do Tech Lead: a tela de espera vale também antes da primeira janela (sai o caso "só pelo painel") e há tolerância de 10 segundos para recarga; P-01 e P-02 resolvidas; o nome do arquivo passa a refletir o novo escopo |
