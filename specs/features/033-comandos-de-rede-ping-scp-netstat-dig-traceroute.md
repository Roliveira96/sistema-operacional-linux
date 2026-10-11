# SPEC-033: Comandos de rede do terminal (ping, traceroute, netstat, dig, scp)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-033 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (sem backend, sem banco, sem API) |
| **Módulo** | `engine` (comandos do terminal em `frontend/src/engine/commands/`) |
| **Contexto de tela** | Terminal do simulador e `/app/admin/conformidade` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-014, SPEC-027, SPEC-028, SPEC-030 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026 ("vamos adicionar o grupo 1 da nossa prioridade e incluir na conformidade do motor"). |

---

## 1. Contexto e Problema (Context & Problem Statement)

O motor reconhece 189 comandos e programas, mas faltam os que um aluno de Sistemas Operacionais digita nas primeiras aulas de rede: `ping`, `traceroute`, `netstat`, `dig` e `scp`. Hoje o terminal responde "comando não encontrado" a eles, o que quebra o exercício e passa a impressão de simulador incompleto.

## 2. Objetivos (Goals)

- O terminal passa a reconhecer `ping`, `traceroute`, `netstat`, `dig` e `scp`, com a saída no formato do Ubuntu 24.04 e a ajuda no padrão da SPEC-027.
- Cada um tem uma **suíte de conformidade** (SPEC-030) no mesmo commit, e o teste de catálogo continua verde (RN-08 da SPEC-030).

### 2.1. Fora de escopo (Non-Goals)

- Rede real: tudo é simulado, com os nomes e endereços que o motor já conhece (`localhost`, o próprio nome da máquina, o gateway, `/etc/hosts`, `google.com`, `ubuntu.com`, `8.8.8.8`, `1.1.1.1`).
- `ping6`, `tracepath`, `mtr`, `nc`, `sftp`, `rsync` por SSH.
- Registros DNS além de A no `dig`; consulta reversa (`dig -x`).
- Alterar `legacy/`, ou qualquer comando existente além de exportar funções auxiliares do arquivo de rede.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Sem mudança de tela: os comandos aparecem no terminal e a suíte de cada um aparece na tela de conformidade, que já lê o manifesto.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: tudo roda no navegador.

### 3.3. Regras de negócio

- **RN-01 (resolução):** os cinco comandos resolvem nomes pelas mesmas regras do `nslookup` e do `curl` (a máquina, o gateway, `/etc/hosts` e a lista fixa da internet). Nome desconhecido falha como no Ubuntu.
- **RN-02 (ping):** `ping [-c N] [-q] [-i S] [-W S] DESTINO`. Sem `-c`, **fica rodando até `Ctrl+C` ou `kill`**, como pede a SPEC-029 (CA-01), e ao ser encerrado imprime o resumo; em um pipe ou arquivo, onde o motor junta a saída antes de entregá-la, envia 4 pacotes e termina; redirecionado para `/dev/null` fica vivo até ser encerrado. `-i S` muda o intervalo (padrão 1 s; abaixo de 0,2 s só o root, como no Linux). Saída: cabeçalho `PING nome (ip) 56(84) bytes of data.`, uma linha `64 bytes from ...: icmp_seq=N ttl=T time=X ms` por pacote, e o resumo (`N packets transmitted, M received, P% packet loss, time Tms` e `rtt min/avg/max/mdev`). Os tempos são fixos e repetíveis (dependem só do destino e do número do pacote). Status 0 se algum pacote voltou, 1 se nenhum, 2 em erro de uso ou nome não resolvido (`ping: NOME: Nome ou serviço desconhecido`). Um endereço numérico que o motor não conhece perde 100% dos pacotes.
- **RN-03 (traceroute):** `traceroute [-n] [-m SALTOS] DESTINO`. Cabeçalho `traceroute to nome (ip), 30 hops max, 60 byte packets`, um salto por linha com três tempos. A própria máquina tem 1 salto; a rede local, o gateway; a internet, 4 saltos fixos (gateway, dois de provedor e o destino). Nome desconhecido: status 2.
- **RN-04 (netstat):** `netstat [-t] [-u] [-l] [-a] [-n] [-p] [-r]`. Mostra os sockets dos serviços ativos (`ssh`, `nginx`, `mysql`) no formato do `netstat` clássico (`Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program name`), consistentes com o que o `ss` mostra. `-r` mostra a tabela de rotas do `ip route`. Sem `-l` nem `-a` mostra as conexões ativas, que no simulador não existem (só o cabeçalho).
- **RN-05 (dig):** `dig [@SERVIDOR] NOME [TIPO] [+short]`. Só o tipo A responde com dados; os outros tipos dão `NOERROR` sem resposta. Nome desconhecido: `status: NXDOMAIN`, status de saída 0 (como o dig real). `+short` imprime só o endereço (nada, se não existe). Sem argumentos: mostra o uso, status 1.
- **RN-06 (scp):** `scp [-r] [-q] [-P PORTA] ORIGEM... DESTINO`, com um lado remoto no formato `[USUÁRIO@]MÁQUINA:CAMINHO`. O simulador só alcança a própria máquina (`localhost` e o nome dela), copiando como o `cp` quando o serviço `ssh` está ativo; com ele parado, `ssh: connect to host ... port 22: Connection refused` (status 255). Máquina desconhecida: `ssh: Could not resolve hostname NOME: Nome ou serviço desconhecido` (255). Não pede senha. Pasta sem `-r`: `scp: CAMINHO: not a regular file` (1). Origem inexistente: `scp: CAMINHO: No such file or directory` (1). Sem `-q`, mostra a linha de progresso `ARQUIVO 100% TAMANHO ...` de cada arquivo copiado.
- **RN-07 (ajuda e instalação):** cada comando tem `--help` com `Uso`, descrição, opções e exemplos (SPEC-027), e ganha o binário no `PATH` como os demais comandos novos.
- **RN-08 (conformidade):** cada comando tem uma suíte no grupo `rede` com pelo menos 3 casos além do `--help` (uso básico, variações e erro esperado), no mesmo commit.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema: nenhum dado novo é guardado.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: não há endpoint nem evento de tempo real.

## 6. Impacto e Riscos (Impact & Risks)

- **Risco:** saída diferente do Ubuntu confundir quem compara com a máquina real. **Mitigação:** os formatos seguem o Ubuntu 24.04; os desvios (RN-02: 4 pacotes em pipe, RN-06: sem senha) estão na ajuda de cada comando.
- **Impacto:** `network.ts` passa a exportar as funções de resolução e de serviços; o catálogo cresce de 189 para 194 itens, e a verificação completa ganha os casos novos.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): O SISTEMA DEVE reconhecer `ping`, `traceroute`, `netstat`, `dig` e `scp`, cada um com `--help` que começa pelo nome e traz `Uso` (RN-07).
- [x] **CA-02** (evento): QUANDO o aluno executa `ping -c 3 localhost`, O SISTEMA DEVE mostrar o cabeçalho, 3 respostas numeradas e o resumo com 0% de perda, e terminar com status 0 (RN-02).
- [x] **CA-03** (indesejado): SE o destino do `ping` não existe, ENTÃO O SISTEMA DEVE avisar que o nome é desconhecido e terminar com status 2; SE é um endereço numérico desconhecido, ENTÃO DEVE mostrar 100% de perda e status 1 (RN-02).
- [x] **CA-04** (evento): QUANDO o aluno executa `traceroute google.com`, O SISTEMA DEVE mostrar o cabeçalho e 4 saltos, o último sendo o destino (RN-03).
- [x] **CA-05** (estado): ENQUANTO o serviço `ssh` está ativo, `netstat -tln` DEVE listar a porta 22; ENQUANTO está parado, NÃO DEVE listá-la (RN-04).
- [x] **CA-06** (evento): QUANDO o aluno executa `dig google.com`, O SISTEMA DEVE mostrar a seção de resposta com o endereço; `dig +short google.com` DEVE mostrar só o endereço; um nome desconhecido DEVE mostrar `NXDOMAIN` (RN-05).
- [x] **CA-07** (evento): QUANDO o aluno executa `scp arquivo localhost:/tmp/` com o `ssh` ativo, O SISTEMA DEVE copiar o arquivo e mostrar o progresso; com o `ssh` parado, DEVE recusar a conexão com status 255 (RN-06).
- [x] **CA-08** (ubíquo): O SISTEMA DEVE ter uma suíte de conformidade para cada um dos cinco comandos, e o teste de catálogo DEVE passar (RN-08).

## 8. Plano de Testes (Test Plan)

- **Motor real (Vitest):** um teste por comando com os cenários dos CA-02 a CA-07, rodando no terminal real (cobre CA-02 a CA-07).
- **Ajuda:** o teste de ajuda dos comandos novos passa a listar os cinco (cobre CA-01).
- **Conformidade:** o teste de catálogo e o de suítes (mínimo de casos) passam; a verificação do grupo `rede` roda com 0 falhas (cobre CA-08).
- **Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-028 e SPEC-030, `frontend/src/engine/commands/network.ts`, `messages.ts`, `helpers.ts`.
2. **Ordem de execução:** (1) exportar o que o arquivo de rede já tem; (2) escrever os cinco comandos; (3) registrá-los em `index.ts`; (4) suítes de conformidade; (5) testes; (6) status e histórico.
3. **Arquivos a criar ou alterar:** criar `frontend/src/engine/commands/network-tools.ts` (traceroute, netstat, dig, scp) e `frontend/src/engine/processes/ping.ts` (o `ping` é um programa que fica rodando e pertence ao controle de processos da SPEC-029), com os testes; alterar `network.ts` (só exportar), `index.ts`, `processes/register.ts`, `processes/messages.ts`, `commands/fixtures/commands200.ts` (o `ping` deixa de ser falha esperada), `help.test.ts`, `messages.ts` se preciso, `frontend/src/engine/conformance/suites/rede.ts` e a lista de cobertura do catálogo, se houver. Qualquer outro arquivo exige justificativa. `legacy/` é proibido.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Aruna Architect | Criação, a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Aprovada pelo Tech Lead ao pedir a implementação ("vamos adicionar o grupo 1") |
| 11/10/2026 | Implementador (Claude) | Implementada: `ping` em `processes/ping.ts` (fica rodando até Ctrl+C ou kill, como pede a SPEC-029) e `traceroute`, `netstat`, `dig` e `scp` em `commands/network-tools.ts`; cinco suítes no grupo `rede` (342 linhas de casos), 18 testes no motor real. As cinco suítes passam no motor real. Catálogo: 194 itens. Desvio da primeira redação: o `ping` sem `-c` não termina sozinho (a SPEC-029 CA-01 manda ficar rodando); só em pipe ou arquivo termina após 4 pacotes |
