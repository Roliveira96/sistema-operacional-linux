# SPEC-029: Simulador de Controle de Processos

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-029 |
| **Status** | Aprovada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos (motor do terminal, frontend, backend para a correção) |
| **Módulo** | `legacy/src` (processos, sinais, comandos), `content` (condições de término), telas de estudo e de exercício |
| **Contexto de tela** | Terminal do estudo e dos exercícios (terminais 1, 2 e 3), editor de exercício do professor |
| **Prioridade** | Alta |
| **Depende de** | SPEC-020 (terminais), SPEC-022 e SPEC-023 (exercícios e condições de término), SPEC-027 (ajuda dos comandos) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (matéria de controle de processos de Sistemas Operacionais) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na disciplina de Sistemas Operacionais, a matéria de **controle de processos** pede um exercício clássico: o aluno **abre um programa num terminal e, em outro terminal, o encerra** (ou o suspende, retoma, muda a prioridade), vendo o efeito no primeiro.

### O que o simulador já tem

O motor já tem uma tabela de processos compartilhada entre os terminais, os sinais `HUP`, `INT`, `QUIT`, `KILL`, `TERM`, `CONT`, `STOP` e `TSTP`, `Ctrl+C` e `Ctrl+Z`, `jobs`/`fg`/`bg`/`wait`/`nohup`, `sleep`, `top`, `ps` (PID, PPID, estado, %CPU, %MEM), `kill`/`killall`/`pkill`/`pgrep` e as mensagens "Terminado" e "Morto" quando um processo é morto por outro terminal. Ou seja, o exercício básico (`sleep 300` no terminal 1, `kill` no terminal 2) já pode ser *feito*.

### O que falta

1. **Programas que ficam rodando** e que o aluno reconhece: `ping`, `yes`, `watch` e `top` que reage a teclas (`k` para matar, `r` para mudar a prioridade, `q` para sair).
2. **Comandos da matéria** que não existem: `nice`, `renice`, `pstree`, `pidof`, `kill -l` (lista de sinais) e `ps --forest`/`-ejH` para ver pai e filhos.
3. **Ver o que está acontecendo**: hoje o aluno só vê o processo por `ps`; falta uma visão ao vivo dos processos e dos estados (rodando, dormindo, parado, zumbi) para entender o efeito dos sinais.
4. **Corrigir o exercício**: o professor não consegue dizer "ao final, o processo `sleep` não pode mais existir, e foi encerrado pelo sinal 15". As **condições de término** (SPEC-022) olham só o sistema de arquivos e as contas; **processo não faz parte do estado da máquina** que a tela e o servidor conferem.

## 2. Objetivos (Goals)

- O aluno faz, no simulador, as práticas de controle de processos de uma disciplina de Sistemas Operacionais: iniciar em primeiro e em segundo plano, listar, achar o PID, enviar sinais de um terminal para outro, suspender e retomar, mudar a prioridade, ver a árvore de processos.
- O professor cria exercícios de processos como os de arquivos: grava a solução nos terminais, e o sistema **deriva e confere como o exercício termina** (processo existe, não existe, está parado, foi encerrado por tal sinal, tem tal prioridade).
- O comportamento é o do Linux de verdade: mensagens de saída, estados e sinais iguais, para quem usa Linux de fato não se perder.

### 2.1. Fora de escopo (Non-Goals)

- Escalonamento de CPU, memória virtual e threads simulados em detalhe (a matéria de "gerência de processador" é outra); só a prioridade `nice` e o estado do processo.
- `strace`, `lsof`, `/proc` navegável e `cgroups`.
- Reabrir a máquina e continuar os processos de onde estavam: processo continua não sendo salvo, como num reinício (ver P-02).
- Processos de vários usuários simultâneos em máquinas diferentes.

## 3. Proposta de Solução (Proposed Solution)

Três entregas, na ordem, cada uma pronta e testada antes da seguinte.

### 3.1. Entrega A: comandos e programas (motor)

| Item | O que faz |
| :--- | :--- |
| `ping HOST` | Fica rodando e imprimindo respostas (`64 bytes from ...: icmp_seq=1 ttl=64 time=...`) até `Ctrl+C`, que imprime as estatísticas; `-c N` para N pacotes |
| `yes [TEXTO]` | Imprime sem parar até ser interrompido |
| `watch [-n S] COMANDO` | Repete o comando a cada S segundos até `Ctrl+C` |
| `tail -f ARQUIVO` | Já funciona no motor (segue o arquivo até `Ctrl+C`); só entra nos testes da entrega |
| `top` interativo | Atualiza a tela; `k` pede o PID e o sinal, `r` pede o PID e o `nice`, `q` sai; mostra PID, USER, PR, NI, S, %CPU, %MEM |
| `nice -n N COMANDO` e `renice N -p PID` | Iniciam com e mudam a prioridade (-20 a 19); só o root diminui abaixo de 0; a coluna NI do `ps -l` e do `top` mostra |
| `pstree [-p]` e `ps --forest` | Mostram quem é pai de quem, com os PIDs |
| `pidof NOME` | Imprime os PIDs do programa |
| `kill -l` | Lista os sinais com número e nome |
| `ps` | Passa a mostrar a coluna `NI` em `-l` e a árvore em `--forest`; os estados são `R` (rodando), `S` (dormindo), `T` (parado), `Z` (zumbi) |

Os sinais já existentes seguem, e entram `USR1`, `USR2` e `CHLD` (ignorados por padrão, como no Linux). O processo que recebe `SIGTSTP`/`SIGSTOP` mostra "Parado" no terminal onde estava, e o `kill -CONT` o faz continuar. Quando um processo é morto por outro terminal, o terminal dele mostra "Terminado" (15), "Morto" (9) ou o que o bash mostra para o sinal, e o prompt volta.

### 3.1.1. Divisão com a SPEC-028 (ampliação dos comandos)

A SPEC-028 (rascunho de outra frente) também acrescenta comandos de rede, texto e processos como código do frontend. Para não escrever o mesmo código duas vezes: `pstree` e `pidof` ficam **com a SPEC-028**; o `ping` também é dela, e esta spec só exige que ele **fique rodando até `Ctrl+C`** (CA-01); `nice` e `renice` são **desta spec** (a prioridade precisa ser guardada e mostrada por `ps -l` e `top`), e o `nice` desta spec, registrado depois, substitui o da SPEC-028.

### 3.2. Entrega B: painel de processos (frontend)

Um painel **somente de leitura**, ao lado dos terminais do estudo e dos exercícios, que se atualiza ao vivo: uma tabela com PID, PPID, usuário, estado (com cor e legenda: rodando, dormindo, parado, zumbi), `NI`, comando e **o último sinal recebido**, mais a árvore de pais e filhos. O aluno vê o efeito do `kill -STOP`, do `kill -CONT` e do `kill -9` na hora, sem precisar rodar `ps` toda vez. Liga e desliga por um botão (P-05).

### 3.3. Entrega C: processos nas condições de término (correção)

- O estado da máquina que a tela e o servidor conferem passa a levar a **lista de processos de usuário vivos** (PID, comando, estado, `nice`) e os **últimos processos encerrados** (comando e sinal que os encerrou), só para a conferência: ao reabrir a máquina eles não voltam (P-02).
- Novos tipos de condição de término (SPEC-022): `PROCESS_RUNNING` (existe um processo com esse comando), `PROCESS_ABSENT` (não existe), `PROCESS_STOPPED` (está parado), `PROCESS_ENDED_BY` (foi encerrado por tal sinal) e `PROCESS_NICE` (tem tal prioridade).
- O professor grava a solução nos terminais (inicia o programa, manda o sinal) e o sistema **deriva as condições** da diferença entre a máquina antes e depois, como já faz com arquivos; as condições podem ser editadas.
- O servidor passa a conhecer os novos tipos no catálogo de condições, para corrigir também o exercício que o aluno resolve na tela de estudo (SPEC-011 e SPEC-013).

### 3.4. Regras de negócio

| ID | Regra |
| :--- | :--- |
| RN-01 | Todos os terminais da mesma máquina veem os mesmos processos; um sinal enviado de um terminal chega ao processo que está em outro |
| RN-02 | Um processo em primeiro plano ocupa o terminal até terminar, ser interrompido (`Ctrl+C`), suspenso (`Ctrl+Z`) ou morto por outro terminal; em qualquer um desses casos o terminal volta ao prompt, com a mensagem do Linux |
| RN-03 | Usuário comum só envia sinal aos seus processos; o root, a todos; sinal para PID inexistente ou de outro usuário dá o erro do Linux (`kill: (PID) - Nenhum processo ou diretório`, `Operação não permitida`) |
| RN-04 | `SIGKILL` e `SIGSTOP` não podem ser ignorados; `SIGTERM` encerra; `SIGINT` é o `Ctrl+C`; processo iniciado com `nohup` ignora `SIGHUP` |
| RN-05 | `nice` e `renice` seguem as regras do Linux (faixa de -20 a 19; só o root diminui o valor) |
| RN-06 | O painel de processos mostra o mesmo estado que `ps` e `top` mostram; nunca um estado diferente |
| RN-07 | Os processos não são salvos com a máquina: ao recarregar, voltam a ser os do sistema, como num reinício |
| RN-08 | As condições de processo só valem para processos de usuário; os do sistema (`systemd`, serviços) não entram na conferência |
| RN-10 | **O `legacy/` não é alterado** (SPEC-014, decisão do Tech Lead de 10/10/2026): tudo desta spec é código novo em `frontend/src/engine/` (em inglês, com testes), que se registra no catálogo de comandos do motor pelo adaptador, só lendo o legado. Quando um comando novo precisa estender um do motor (`ps`, `kill`, `tail`), o comando novo **embrulha** o original: trata o que é novo e entrega o resto ao comando do motor, sem editá-lo |
| RN-09 | O comportamento (saída, códigos de saída e mensagens) é o do Linux de verdade, comando a comando, e a ajuda (`--help`, SPEC-027) descreve só o que o simulador faz |

## 4. Modelo de Dados (Data Model)

- **Motor:** `Processo` ganha `nice` e a lista de processos encerrados (comando e sinal) em memória.
- **Snapshot de conferência:** ganha `processos` e `encerrados`, só na conferência; o formato salvo da máquina não muda.
- **Banco:** nenhuma migração: as condições de término já são JSON; os novos tipos entram no catálogo do servidor (`content/domain`).

## 5. Contrato de API (API Contract)

A API de conferência do exercício passa a aceitar, no snapshot enviado, os campos `processos` e `encerrados`; as condições `PROCESS_*` entram no catálogo (SPEC-011). Contrato detalhado fixado na aprovação, em uma revisão desta spec.

## 6. Impacto e Riscos (Impact & Risks)

- **Tamanho:** é a maior das entregas do motor até agora (muitos comandos novos, o painel e o servidor). Por isso as três entregas independentes, cada uma entregue e testada.
- **Programas "que ficam rodando" e o terminal:** o terminal precisa continuar respondendo enquanto um comando roda; hoje já faz assim com `sleep`, e o `top` e o `ping` seguem o mesmo caminho.
- **Conferência:** exercício de processo depende do instante em que se confere (um processo pode terminar sozinho); a spec exige que `PROCESS_RUNNING` seja usado com processos que não terminam sozinhos (`sleep` longo, `yes`, `ping`).
- **Servidor:** novo tipo de condição exige o mesmo cuidado dos tipos anteriores (validação, limites, testes e a tradução da forma de edição para o catálogo).

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o aluno inicia `ping`, `yes`, `watch` ou `tail -f` num terminal, O SISTEMA DEVE mantê-lo rodando até `Ctrl+C`, sem travar os outros terminais.
- [ ] **CA-02** (evento): QUANDO o aluno envia um sinal de um terminal para um processo que está em outro, O SISTEMA DEVE aplicá-lo, mostrar no terminal do processo a mensagem do Linux para aquele sinal e devolver o prompt, se o sinal o encerra.
- [ ] **CA-03** (evento): QUANDO o aluno suspende (`Ctrl+Z` ou `kill -STOP`) e retoma (`fg`, `bg` ou `kill -CONT`) um processo, O SISTEMA DEVE refletir o estado `T` e depois `R`/`S` em `ps`, `top`, `jobs` e no painel.
- [ ] **CA-04** (evento): QUANDO o aluno usa `nice`/`renice`, O SISTEMA DEVE aplicar as regras do Linux e mostrar a prioridade em `ps -l` e `top`.
- [ ] **CA-05** (evento): QUANDO o aluno roda `pstree`, `ps --forest` ou `pidof`, O SISTEMA DEVE mostrar a árvore, os pais e os PIDs corretos.
- [ ] **CA-06** (evento): QUANDO o aluno roda `kill -l`, O SISTEMA DEVE listar os sinais com número e nome.
- [ ] **CA-07** (indesejado): SE o usuário envia sinal a processo de outro usuário ou a PID inexistente, ENTÃO O SISTEMA DEVE mostrar o erro do Linux e não alterar nada.
- [ ] **CA-08** (ubíquo): O painel de processos DEVE mostrar, ao vivo, o mesmo estado que `ps` e `top`, com o último sinal de cada processo.
- [ ] **CA-09** (evento): QUANDO o professor grava como se resolve um exercício de processos, O SISTEMA DEVE derivar as condições `PROCESS_*` a partir do que mudou e permitir editá-las.
- [ ] **CA-10** (evento): QUANDO o aluno faz o exercício por outro caminho que termina igual (outro sinal equivalente, outro terminal), O SISTEMA DEVE aceitá-lo; e QUANDO termina diferente, DEVE dizer qual condição falta.
- [ ] **CA-11** (evento): QUANDO o aluno confere o exercício na tela de estudo, O SERVIDOR DEVE corrigir as condições `PROCESS_*` com o snapshot enviado.

## 8. Plano de Testes (Test Plan)

- **Motor, no terminal real:** cada comando novo (saída, códigos de saída, erros); os sinais de um terminal para outro; suspender, retomar e matar; `nice`/`renice`; `pstree`; `Ctrl+C` e `Ctrl+Z` em cada programa que roda.
- **Contrato da ajuda** (SPEC-027): os comandos novos têm `ajuda`.
- **Painel:** mostra os mesmos estados que `ps`; atualiza ao enviar sinal; legenda de cores; liga e desliga.
- **Condições:** derivação a partir de antes e depois; conferência de cada tipo `PROCESS_*`; solução alternativa aceita; mensagem do que falta; o mesmo no servidor (testes de domínio, serviço e repositório do catálogo).
- **Ponta a ponta:** um exercício "inicie `sleep 300` no terminal 1 e encerre-o pelo terminal 2" gravado, derivado, conferido na tela e no servidor.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Restrição:** não editar nada em `legacy/` (RN-10).
2. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-020, SPEC-022, SPEC-023 e SPEC-027; no código, `legacy/src/linux/Processos.ts`, `legacy/src/linux/Sessao.ts`, `legacy/src/shell/comandos/Processos.ts`, `Interpretador.ts` e `frontend/src/lib/exerciseConditions.ts`.
3. **Ordem de execução:** A (comandos e programas, com testes no terminal real), depois B (painel), depois C (condições no frontend, depois no servidor).
4. **Arquivos a criar ou alterar:** `frontend/src/engine/processes/*` (comandos, estado de prioridade, painel de dados), o adaptador `terminalWindow.ts` (registro) e os componentes do painel; definidos a cada entrega.
5. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`. Todo comando ou programa novo, renomeado ou removido atualiza o manifesto de conformidade no mesmo commit (SPEC-030, RN-08).

## 10. Pendências (com recomendação)

| ID | Pergunta | Recomendação |
| :--- | :--- | :--- |
| P-01 | O "simulador" é só o terminal com os comandos certos, ou também uma visão gráfica dos processos? | As duas, em entregas separadas: A (terminal) e B (painel de leitura); o painel não substitui o terminal, ajuda a entender |
| P-02 | Salvar e restaurar os processos junto com a máquina? | Não: processo some ao recarregar, como num reinício. Para a correção, o estado dos processos vai só no snapshot de conferência (3.3) |
| P-03 | Quais tipos de condição de término? | `PROCESS_RUNNING`, `PROCESS_ABSENT`, `PROCESS_STOPPED`, `PROCESS_ENDED_BY` e `PROCESS_NICE` (3.3) |
| P-04 | Quais comandos entram na entrega A? | `ping`, `yes`, `watch`, `tail -f`, `top` interativo, `nice`, `renice`, `pstree`, `pidof`, `kill -l`, `ps --forest` e `ps -l`; fora: `strace`, `lsof`, `/proc` |
| P-05 | O painel fica sempre visível? | Botão para ligar e desligar, ligado por padrão nos exercícios de processos e desligado no resto |
| P-06 | Zumbis e órfãos (a matéria costuma mostrar)? | Entram só como estado `Z` e reparentamento ao `init` no `pstree`, quando um processo pai morre antes do filho; sem comando próprio para fabricar zumbi |
| P-07 | Exercícios prontos de processos entram nesta spec? | Não: esta spec entrega o simulador e a correção; os exercícios do módulo são conteúdo, feitos depois com o professor |

### Andamento da implementação

| Entrega | Situação |
| :--- | :--- |
| A, parte 1 | Feita: `nice`, `renice` (regras de permissão do Linux), `yes` (inclusive `yes > /dev/null &`), `watch`, `kill` completo (`kill -l` com os 64 sinais, conversão número/nome, qualquer sinal por nome ou número) e os binários no PATH, com testes de unidade e no terminal real entre terminais |
| A, parte 2 | Feita em parte: `ps -l` (PRI e NI), `ps -o CAMPOS` (pid, ppid, ni, pri, user, uid, stat, tty, time, pcpu, pmem, comm, cmd, com `campo=TÍTULO`) e `ps --forest` / `ps f` (árvore de pais e filhos sobre qualquer formato do `ps` do motor). Pendente: `top` com PR/NI e atualização ao vivo, estado `Z` e reparentamento |
| B | Feita: o painel de processos (somente leitura) aparece sob o terminal do estudo, da gravação e do teste do card, por um botão "Painel de processos" que lembra a escolha neste navegador; mostra, ao vivo, PID, PPID, usuário, estado (dormindo ou parado, com cor e ícone), NI e comando em árvore, e o sinal que acabou de encerrar um programa, que fica 12 segundos; lê a mesma tabela que `ps` e `top`, e foi conferido contra o `ps` no terminal real |
| C | Feita: o `snapshot()` do terminal leva `processos` e `encerrados` (só para conferir; a máquina não os guarda); os cinco tipos `PROCESS_*` existem no frontend (derivar, conferir, descrever) e no servidor (catálogo, validação, tradução da forma de edição e conferência do snapshot); o professor grava (iniciar em um terminal e encerrar em outro), o sistema deriva as condições por nome de programa e o aluno é conferido em outra máquina, no navegador e no servidor |

### Limitações do motor sem alterar o `legacy/` (RN-10)

O terminal só imprime "Terminado" e "Morto" quando o processo em primeiro plano é encerrado pelos sinais 15 e 9 (a mensagem fica no interpretador); outros sinais (`USR1`, `ALRM`...) encerram o processo com o código 128 mais o número do sinal, mas sem a mensagem do bash. `kill` com sinal que o motor desconhece só aceita PID (não `%JOB`). O `top` do motor é uma foto; torná-lo vivo é trabalho da parte 2. O `Ctrl+C` interrompe o comando sem passar pelo sinal do processo no motor, então ele não aparece em `encerrados` (só o que um `kill`, `pkill` ou `killall` encerra).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; o que o motor já tem foi levantado; pendências P-01 a P-07 abertas com recomendação |
| 10/10/2026 | Tech Lead | Aprovada, aceitas as recomendações de P-01 a P-07 |
| 10/10/2026 | Implementador (Claude) | Renumerada de SPEC-028 para SPEC-029: o número 028 já foi tomado pelo rascunho "Ampliação dos comandos do terminal do navegador" |
| 10/10/2026 | Tech Lead | O `legacy/` não deve ser alterado; a implementação é toda em `frontend/src/engine/`. Incluída a RN-10 |
| 10/10/2026 | Implementador (Claude) | Entrega A, parte 1 implementada em `frontend/src/engine/processes/`; divisão com a SPEC-028 (3.1.1) e limitações do motor registradas |
| 10/10/2026 | Implementador (Claude) | Entrega A, parte 2 (em parte): `ps -l`, `ps -o` e `ps --forest` |
| 10/10/2026 | Implementador (Claude) | Entrega C implementada: processos no snapshot de conferência, condições `PROCESS_*` no frontend e no servidor |
| 10/10/2026 | Implementador (Claude) | Entrega B implementada: painel de processos ao vivo ao lado dos terminais |
