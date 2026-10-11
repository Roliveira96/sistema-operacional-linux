# SPEC-030: Verificação de conformidade do motor (teste de todos os comandos e programas, pelo administrador)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-030 |
| **Status** | Rascunho (revisão 10 aguarda aprovação do Tech Lead) |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 11/10/2026 (revisão 10) |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (sem backend, sem banco, sem API) |
| **Módulo** | `engine` (adaptador do motor em `frontend/src/engine/`) e tela de administração |
| **Contexto de tela** | Botão no cabeçalho (`AppShell`), visível só ao administrador, que abre a tela `/app/admin/conformidade` |
| **Prioridade** | Média |
| **Depende de** | SPEC-014, SPEC-027 (ajuda dos comandos), SPEC-028 (ampliação dos comandos), SPEC-029 (controle de processos) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026. `docs/arquitetura/transicao-backend.md` não trata do motor do terminal. |

---

## 1. Contexto e Problema (Context & Problem Statement)

O terminal do navegador roda um motor POSIX/VFS (SPEC-014) que reconhece mais de uma centena de comandos, e as SPEC-028 e SPEC-029 acrescentam dezenas de outros, alguns deles programas de longa duração (`yes`, `watch`, `sleep`). Hoje a única garantia de que tudo funciona está nos testes automatizados do repositório, que rodam na máquina de quem desenvolve. O administrador do sistema, que responde pelo ambiente em uso, não tem como conferir, dentro do próprio sistema e no navegador em que a plataforma roda, se o simulador está íntegro: um comando que passou a falhar depois de uma atualização só aparece quando uma docente ou um estudante esbarra nele durante uma aula.

Há também uma segunda lacuna, de processo: quando um comando ou programa novo entra no motor, nada obriga a lista do que é verificado a crescer junto. Uma verificação desatualizada dá falsa segurança, o que é pior do que não ter verificação.

## 2. Objetivos (Goals)

- O administrador tem um botão no cabeçalho que abre uma tela e executa, no motor do navegador, **todos os comandos e programas** do sistema, mostrando ao final se o simulador está **em conformidade** ou quais itens falharam.
- Cada comando e cada programa tem uma verificação própria, descrita em uma lista única de verificações (o **manifesto de conformidade**), com o que se executa e o que se espera.
- **A lista nunca fica para trás:** um teste automatizado do repositório compara o catálogo real do motor com o manifesto e **falha** se existir comando ou programa sem verificação (ou verificação de algo que não existe mais). Assim, quem acrescentar um comando é obrigado a acrescentar a verificação no mesmo commit.
- A obrigação fica escrita nas regras do projeto (`ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das specs que mexem no catálogo), para valer também para agentes de IA.

- **Cada comando e cada programa é uma suíte de casos de teste** (por exemplo `ls`, `ls -a`, `ls -la`, `ls /pasta-que-nao-existe`), e a tela mostra todos os casos executados, cada um com o comando digitado, o que se esperava e o que o motor respondeu. A suíte existe para evitar, em aula, o comando inesperado de um aluno mais avançado que não funciona (revisão 2, pedido do Tech Lead em 11/10/2026).

### 2.1. Fora de escopo (Non-Goals)

- Qualquer alteração em `legacy/`, nos comandos existentes ou no comportamento do terminal. A verificação só lê e executa o que já existe.
- Executar a verificação no servidor, guardar o resultado em banco ou criar rota de API. O resultado vive na tela, até o administrador sair dela. Histórico de execuções é spec futura.
- Verificar o conteúdo dos módulos de ensino, os exercícios ou a correção do servidor (já cobertos pelas SPEC-021, SPEC-023 e SPEC-011).
- Rodar para docente ou estudante. A tela é só do administrador.
- Verificação de desempenho, de acessibilidade ou de aparência do terminal.
- Verificar comandos de rede reais: nenhuma conexão sai do navegador (SPEC-028, RN-07). A verificação confere a resposta simulada.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Botão no cabeçalho.** No `AppShell`, ao lado dos links de gestão, aparece o link-botão "Conformidade do motor" **somente para o papel ADMIN**. Docente e estudante não o veem, e a rota, se aberta direto por eles, os leva à tela inicial (a proteção não depende de esconder o botão).

**Tela `/app/admin/conformidade`.**

1. **Ao abrir**, a tela **não executa nada**: mostra o que a verificação faz, quantos comandos e casos ela tem, que leva vários minutos e que nada é gravado, e o botão "Iniciar a verificação". **Só quando o administrador aciona esse botão** a tela monta uma máquina simulada nova e isolada (a mesma máquina padrão dos exercícios), executa a verificação inteira e mostra o andamento (revisão 9, pedido do Tech Lead em 11/10/2026: o administrador escolhe se quer rodar). Ao terminar, o botão "Executar de novo" repete a verificação do zero, com máquina nova.
2. **Andamento:** barra de progresso com "N de M itens" e o nome do item em execução, anunciado a leitores de tela de forma discreta (região viva, sem repetir a cada item: só a cada 10%).
3. **Resultado:** um selo geral no topo, que usa texto e ícone além da cor:
   - "Em conformidade": todos os itens passaram;
   - "Fora de conformidade: N itens falharam": há pelo menos um item com falha.
   Abaixo do selo, os totais (verificados, aprovados, com falha) e a tabela dos itens, com falhas primeiro. Cada linha mostra o nome, o tipo (comando ou programa), o grupo, o estado (aprovado, falhou) e, nas falhas, o comando executado, o que se esperava e o que o motor respondeu (o início da saída, limitado a 300 caracteres).
4. **Filtros:** "Só falhas" (marcado por padrão quando há falha) e uma busca por nome. A tabela rola dentro do próprio quadro no celular, sem estourar a largura.
5. **Estados da tela:**
   - *carregando:* o motor é grande e a primeira montagem é lenta: mostra a barra de progresso em estado indeterminado e a frase "Preparando o motor…" até o primeiro item executar;
   - *vazio:* não existe (o manifesto nunca é vazio, e o teste do repositório garante isso);
   - *erro do motor:* se o motor não montar ou a verificação for interrompida por exceção, mostra uma mensagem de erro com o motivo e o botão "Tentar de novo", sem selo de conformidade (não se afirma conformidade sem ter verificado);
   - *sucesso* e *com falhas:* conforme o item 3.
6. **Itens que falham não interrompem a verificação.** Cada item roda isolado, com limite de tempo de 5 segundos (RN-04), e o próximo começa de qualquer jeito.
7. Todos os textos da interface ficam em `src/messages/pt-BR.ts`. Estilo só com SCSS Modules e tokens, tema único escuro, alvos de toque de 44px, `prefers-reduced-motion` respeitado, rotas e serviços na estrutura atual (`src/app`, `src/components`). O motor é usado só por `frontend/src/engine/` (regra de ESLint da SPEC-014), então a tela consome uma função exportada por lá, e não importa o legado.

**Terminal ao vivo (revisão 3).** Enquanto a verificação roda, a tela mostra o **terminal do simulador**, com os comandos de cada caso sendo digitados e executados diante do administrador, como o aluno os veria. A **animação de digitação sempre roda**, e a velocidade do terminal é **sempre a extremamente rápida** (o máximo do motor: a digitação continua aparecendo, com pausas quase nulas). Não há seletor de velocidade nem opção que desligue a animação (revisão 5). O terminal **não reinicia** entre um comando e outro nem entre uma suíte e outra: a tela e o histórico dos comandos ficam, com uma marca (`# comando ls`) onde cada suíte começa, e **continuam na tela quando a verificação termina**, abaixo do resultado, para o administrador selecionar e copiar. O terminal só é descartado ao executar de novo ou ao sair da tela.

**Suítes por comando (revisão 2).** O resultado se organiza **por comando ou programa**, e não mais por item único:

- **Lista de suítes:** uma linha por comando ou programa, com o nome, o grupo, a contagem "N de M casos aprovados" e o estado (aprovada se todos os casos passaram, falhou se algum falhou). Ela abre e fecha por um botão (padrão de divulgação, com `aria-expanded`), e com falhas as suítes que falharam vêm primeiro e já abertas.
- **Dentro da suíte:** a lista de **todos os casos executados**, na ordem, cada um com: o comando digitado (por exemplo `ls -la /tmp/lab`), o estado do caso, o que se esperava (código de saída e, quando há, o trecho de saída) e o que o motor respondeu (a saída, com limite de 2000 caracteres e um aviso quando cortada). O `--help` é o primeiro caso de toda suíte de comando.
- **Totais:** passam a contar **casos** (verificados, aprovados, com falha) e também suítes.
- **Busca:** acha pelo nome da suíte **e** pelo texto de um comando de caso (digitar `-la` mostra as suítes que têm um caso com `-la`). O filtro "Só falhas" mostra só as suítes com falha; dentro delas aparecem **só os casos que falharam**, já com a saída aberta, e um contador "mostrando N falhas de M casos" (revisão 10; antes todos os casos apareciam). Com o filtro desligado, todos os casos aparecem, com os que falharam em destaque. Há também "Abrir todos" e "Fechar todos".
- **Copiar e exportar:** dois botões, "Copiar todos os comandos" e "Copiar só as falhas" (desabilitado se nada falhou), copiam para a área de transferência um texto simples com **todos os comandos digitados**, em ordem e agrupados por comando ou programa, cada um marcado `[ok]` ou `[FAILED]` e, nos que falharam, o esperado, o código obtido e o começo da saída do motor. Uma mensagem confirma "Copiado" ou avisa que não foi possível copiar (revisão 6).
- **Baixar os comandos (revisão 10):** dois botões, "Baixar todos os comandos (.txt)" e "Baixar só as falhas (.txt)" (desabilitado se nada falhou), salvam como arquivo o mesmo texto que os botões de copiar geram (RN-17), para quem não quer copiar da tela. Os nomes trazem a data e a hora (`comandos-conformidade-AAAA-MM-DD-HHMM.txt` e `falhas-conformidade-AAAA-MM-DD-HHMM.txt`). O arquivo das falhas traz, em cada caso, o esperado, o código obtido e a saída do motor.
- **Baixar o terminal:** o botão "Baixar o terminal (.txt)" salva um arquivo de texto com **tudo o que o terminal imprimiu** durante a verificação, para análise: cada comando digitado, a saída **inteira** (sem corte) e o estado (`[exit 0 · ok]`, `[exit 2 · FAILED]`, `[timeout … · FAILED]`), na ordem em que rodaram, com a marca `# comando ls` onde cada suíte começa e um cabeçalho com data, totais e a explicação do formato. O nome do arquivo traz a data e a hora (`terminal-conformidade-AAAA-MM-DD-HHMM.txt`) (revisão 8).
- **Progresso:** conta casos ("N de M casos") e mostra o comando do caso em execução.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: a verificação roda inteira no navegador, onde o motor está, e não grava nada no servidor. A tela só exige sessão com papel ADMIN, como as demais telas do `/app`.

### 3.3. O que é "comando" e o que é "programa"

| Termo | Definição para esta spec |
| :--- | :--- |
| **Comando** | Todo nome registrado no catálogo do motor (os embutidos do legado e os que as SPEC-028 e SPEC-029 acrescentam), aquele que `help` lista |
| **Programa** | Todo executável que existe em pasta do `PATH` da máquina padrão (`/usr/bin`, `/usr/sbin` e semelhantes) e **não** é um comando do catálogo, mais os programas de longa duração tratados como processos pelo controle de processos (SPEC-029). Inclui o que um pacote instalado pelo `apt` simulado passa a oferecer |

Cada comando ou programa verificado é um **item** do manifesto.

### 3.4. Regras de negócio

- **RN-01 (uma suíte por comando e por programa):** o manifesto tem pelo menos uma suíte para cada comando e cada programa do catálogo real, sem exceção. Uma suíte guarda: nome, tipo, grupo, estado inicial e a lista de casos (RN-11). Um caso guarda: o nome, o tipo, o grupo, o comando a executar, o estado inicial necessário (arquivos ou usuário, quando preciso) e a expectativa.
- **RN-02 (expectativa verificável):** a expectativa de um item é o código de saída esperado (zero na maioria; diferente de zero nos casos em que o certo é falhar, como `false`) e, quando o comando tem saída estável, um trecho que a saída deve conter. Itens que dependem de relógio, de número de processo ou de sorteio verificam só o formato (por exemplo, "a saída tem uma data"), nunca o valor exato.
- **RN-03 (ajuda junto):** além do uso normal, todo comando é executado também com `--help` (SPEC-027), que deve terminar com sucesso e mostrar a linha de uso. Isso é um segundo passo do mesmo item, não um item à parte.
- **RN-04 (isolamento e tempo):** cada item roda com o estado inicial que declarou, sem depender do resultado de outro, e tem limite de 5 segundos. Programa de longa duração (`yes`, `watch`, `sleep`) é verificado até produzir a primeira saída (ou até o início do processo) e então interrompido pelo próprio verificador, de modo que a verificação termine sozinha. Estourar o tempo é falha do item.
- **RN-05 (nada de efeito fora do motor):** a verificação não faz requisição de rede, não grava no armazenamento do navegador e não altera nenhuma máquina de estudante. A máquina usada é criada em memória para a execução e descartada ao sair da tela ou ao executar de novo.
- **RN-06 (resultado honesto):** o selo "Em conformidade" só aparece se **todos** os itens do manifesto rodaram e passaram. Item não executado (por interrupção) conta como falha, nunca como aprovado.
- **RN-07 (a lista acompanha o catálogo):** um teste automatizado do repositório calcula o catálogo real (comandos e programas, como na seção 3.3) e o compara com o manifesto. Falta de item para algo do catálogo **ou** item de algo que não existe mais faz o teste falhar, com a mensagem listando os nomes. É esse teste que impede a lista de ficar desatualizada.
- **RN-08 (obrigação de manter):** todo comando ou programa novo, renomeado ou removido exige a atualização do manifesto **no mesmo commit** da spec que o cria. A regra entra em `ARCHITECTURE.md` (seção do motor), no `GLOSSARY.md` (termo "verificação de conformidade") e na "Definição de pronto" das specs que alteram o catálogo (SPEC-028 e SPEC-029, e as futuras).
- **RN-11 (suíte de casos):** cada comando e cada programa tem uma **suíte**: uma lista ordenada de **casos**. Um caso é uma linha digitada no terminal com a expectativa (código de saída e, quando a saída é estável, um trecho que ela deve conter). Os casos de uma suíte rodam na ordem, na mesma máquina, e **podem se apoiar nos anteriores** da própria suíte (por exemplo, `touch` e depois `ls`); suítes diferentes não se apoiam (RN-14).
- **RN-12 (profundidade mínima):** toda suíte de comando tem, além do `--help`, **pelo menos 3 casos**: o uso básico, ao menos uma variação de opção ou de argumento e ao menos um caso de **erro previsto** (argumento ou arquivo inexistente, opção inválida), em que a expectativa é o código de erro e a mensagem do próprio comando. Comandos com muitas opções (por exemplo `ls`, `grep`, `find`, `sort`, `chmod`, `tar`, `ps`) cobrem as combinações que um aluno avançado usaria. Um teste do repositório faz cumprir o mínimo.
- **RN-13 (tudo visível):** a tela mostra **todos** os casos de todas as suítes, e não só as falhas, de modo que o administrador veja o que o sistema sabe fazer (revisão 2).
- **RN-15 (terminal ao vivo e sempre animado):** a verificação desenha o terminal na própria tela e executa cada caso nele, com a animação de digitação ligada o tempo todo (revisão 3, pedido do Tech Lead em 11/10/2026). A velocidade é fixa no máximo do motor e só encurta as pausas e a digitação, nunca as remove (revisão 5: sem seletor). A janela não é gravada nem enviada: ao terminar ou sair da tela, é descartada (RN-05).
- **RN-16 (o terminal não reinicia):** entre as suítes, só a máquina de baixo é trocada pelo instantâneo preparado; o terminal mantém a tela e todo o histórico impresso (comandos e saídas), e cada suíte abre uma sessão nova nele, sem variáveis, apelidos nem histórico de shell da suíte anterior. A exceção é o terminal fechado por `exit` ou `logout`, que só se reabre recriando a janela, e isso limpa a tela (revisão 4, pedido do Tech Lead em 11/10/2026).
- **RN-17 (exportar os comandos):** o administrador copia, por botão, o texto com todos os comandos executados e o estado de cada um, ou só o das falhas, para enviar os comandos que deram errado (revisão 6, pedido do Tech Lead em 11/10/2026). O texto é gerado no navegador, na hora; nada é enviado a servidor.
- **RN-18 (volume mínimo):** o manifesto tem **pelo menos 5000 casos** no total, além do `--help` automático de cada comando, para dar segurança num ambiente de simulado de Sistemas Operacionais em que um aluno avançado pode digitar qualquer coisa (revisão 7, pedido do Tech Lead em 11/10/2026). O volume vem de variedade real (matrizes de opções, variações de argumentos, cenários de várias etapas, pipelines e erros previstos), não de repetição, e um teste do repositório cobra o total.
- **RN-20 (baixar os comandos e filtrar as falhas):** o texto da RN-17 também pode ser baixado como arquivo (todos os comandos, ou só as falhas), e o filtro "Só falhas" da tela esconde os casos aprovados dentro das suítes. Tudo é gerado no navegador; nada é enviado a servidor (revisão 10, pedido do Tech Lead em 11/10/2026).
- **RN-19 (o terminal exportado):** além do texto resumido da RN-17, a verificação guarda, durante a execução, **a transcrição completa** do que o terminal imprimiu, sem o corte de 2000 caracteres da tela, e o administrador a baixa como arquivo `.txt` por botão (revisão 8, pedido do Tech Lead em 11/10/2026). O arquivo é montado no navegador; nada é enviado a servidor.
- **RN-14 (isolamento por suíte):** cada suíte começa de um instantâneo novo da máquina preparada; o tempo limite de 5 segundos vale **por caso**.
- **RN-09 (só administrador):** a tela e o botão são do papel ADMIN. Para os demais papéis, a rota redireciona para a tela inicial.
- **RN-10 (reuso):** a verificação reaproveita o que já existe em vez de duplicar: o card de 200 comandos (SPEC-028, `commands200`) e as listas de verificação dos testes de comandos de `frontend/src/engine/` são a fonte inicial dos itens, para o manifesto não nascer em paralelo com eles.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema. Não se aplica nesta spec: nada é persistido no servidor nem no navegador.

Estrutura em memória (descrita em tabela, não é tabela de banco):

| Campo do item | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| nome | texto | Sim | único no manifesto | Nome do comando ou programa |
| tipo | enumeração | Sim | `command` ou `program` | Conforme a seção 3.3 |
| grupo | texto | Sim | | Agrupamento para a tabela (texto, arquivos, sistema, processos, rede, disco, usuários, pacotes etc.) |
| comando | texto | Sim | | O que é digitado no terminal |
| estado inicial | lista | Não | | Arquivos, pastas ou usuário que precisam existir antes do item |
| código esperado | inteiro | Sim | 0 a 255 | Código de saída esperado |
| trecho esperado | texto | Não | | Trecho que a saída deve conter |
| longa duração | booleano | Não | padrão falso | Se verdadeiro, verifica a primeira saída e interrompe (RN-04) |

Revisão 2: o item vira **suíte** e ganha a lista de **casos**. Campos da suíte: nome, tipo, grupo e estado inicial (como na tabela acima) e `casos`. Cada caso, em memória:

| Campo do caso | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| comando | texto | Sim | | A linha digitada no terminal |
| respostas | lista | Não | | Respostas a perguntas do comando (senhas) |
| código esperado | inteiro ou nulo | Não | padrão 0 | Código de saída esperado; nulo quando o terminal fecha (exit, logout) |
| trecho esperado | texto | Não | | Trecho que a saída deve conter |
| trecho proibido | texto | Não | | Trecho que a saída **não** pode conter (por exemplo, o nome de um arquivo que o comando deveria ocultar) |

Resultado de um caso, em memória: o comando, o estado (aprovado ou falhou), o código obtido, a saída (até 2000 caracteres), a indicação de saída cortada e, na falha, o que se esperava.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: não há endpoint nem evento de tempo real. O papel ADMIN vem da sessão que o frontend já tem.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| O manifesto ficar desatualizado | O teste da RN-07 falha no CI quando o catálogo e a lista divergem; a regra RN-08 vai para `ARCHITECTURE.md` e para as specs |
| Comando que depende de relógio, sorteio ou número de processo gerar falha intermitente | RN-02: esses itens verificam só o formato; o teste automatizado roda o manifesto várias vezes seguidas para pegar intermitência |
| Verificação lenta ou travada por programa de longa duração | RN-04: limite de 5 segundos por item e interrupção pelo verificador |
| Falsa segurança ("em conformidade" sem ter rodado tudo) | RN-06: só há selo verde se todos os itens rodaram e passaram; erro do motor mostra erro, não selo |
| A SPEC-028 e a SPEC-029 estão em rascunho e ainda mudam o catálogo | A verificação só vale para o catálogo que existir na implementação; a RN-07 protege contra a diferença. Esta spec só pode ser implementada depois delas, ou junto com elas (seção 9) |
| Interferir no motor ou em máquinas reais de estudantes | RN-05: máquina nova em memória, nada gravado, `legacy/` intacto |
| Primeira montagem do motor lenta no celular | Estado "Preparando o motor…" e progresso indeterminado até o primeiro item |

Impacto em módulos existentes: um link novo no `AppShell` (visível ao ADMIN), uma rota nova, uma função exportada por `frontend/src/engine/`. Nada no backend, nada em `legacy/`.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): ENQUANTO o usuário logado for ADMIN, O SISTEMA DEVE mostrar no cabeçalho o botão "Conformidade do motor" e, para TEACHER e STUDENT, NÃO DEVE mostrá-lo.
- [x] **CA-02** (indesejado): SE um usuário que não é ADMIN abrir `/app/admin/conformidade`, ENTÃO O SISTEMA DEVE redirecioná-lo à tela inicial sem executar a verificação (RN-09).
- [x] **CA-03** (evento): QUANDO o administrador abrir a tela, O SISTEMA NÃO DEVE executar a verificação, e DEVE mostrar a explicação e o botão "Iniciar a verificação"; QUANDO o administrador acionar o botão, O SISTEMA DEVE criar uma máquina nova em memória e executar a verificação de todos os casos do manifesto, mostrando o andamento "N de M casos" (RN-01, RN-05).
- [x] **CA-04** (evento): QUANDO todos os itens rodarem e passarem, O SISTEMA DEVE mostrar o selo "Em conformidade" com texto e ícone, e os totais (RN-06).
- [x] **CA-05** (evento): QUANDO ao menos um item falhar, O SISTEMA DEVE mostrar "Fora de conformidade", a quantidade de falhas e, para cada falha, o comando executado, o esperado e o que o motor respondeu (limitado a 300 caracteres), com as falhas no topo da tabela.
- [x] **CA-06** (indesejado): SE um item falhar ou estourar o limite de 5 segundos, ENTÃO O SISTEMA DEVE registrar a falha daquele item e continuar com os seguintes (RN-04).
- [x] **CA-07** (indesejado): SE o motor não montar ou a verificação for interrompida por exceção, ENTÃO O SISTEMA DEVE mostrar a mensagem de erro com o motivo e o botão "Tentar de novo", sem exibir selo de conformidade; itens não executados contam como falha (RN-06).
- [x] **CA-08** (evento): QUANDO o administrador acionar "Executar de novo", O SISTEMA DEVE descartar a máquina e o resultado anteriores e repetir a verificação do zero.
- [x] **CA-09** (ubíquo): O SISTEMA DEVE ter no manifesto um item para cada comando do catálogo do motor e para cada programa (seção 3.3), e o teste automatizado do repositório DEVE falhar, listando os nomes, quando o catálogo e o manifesto divergirem em qualquer direção (RN-01, RN-07).
- [x] **CA-10** (ubíquo): O SISTEMA DEVE executar o `--help` de todo comando como parte do seu item e exigir sucesso e a linha de uso (RN-03).
- [x] **CA-11** (ubíquo): O SISTEMA DEVE verificar programas de longa duração até a primeira saída e interrompê-los sozinho, de modo que a verificação inteira termine (RN-04).
- [x] **CA-12** (ubíquo): O SISTEMA NÃO DEVE fazer requisição de rede, gravar no armazenamento do navegador, alterar máquina de estudante nem alterar arquivo de `legacy/` durante a verificação (RN-05).
- [x] **CA-13** (ubíquo): O SISTEMA DEVE manter a obrigação de atualizar o manifesto registrada em `ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das SPEC-028 e SPEC-029 (RN-08).
- [x] **CA-14** (ubíquo): O SISTEMA DEVE oferecer a tela com navegação por teclado, selo e estados com texto além da cor, alvos de 44px, região viva de progresso discreta e `prefers-reduced-motion` respeitado, sem texto solto fora de `src/messages/pt-BR.ts`.
- [x] **CA-15** (estado): ENQUANTO houver falha, O SISTEMA DEVE manter o filtro "Só falhas" marcado por padrão, e a busca por nome DEVE filtrar a tabela sem reexecutar a verificação.

- [x] **CA-16** (ubíquo): O SISTEMA DEVE organizar o resultado por comando ou programa, cada um com a contagem de casos aprovados e a lista de **todos** os casos executados, cada caso com o comando digitado, o esperado e a resposta do motor (RN-11, RN-13).
- [x] **CA-17** (ubíquo): O SISTEMA DEVE ter, para todo comando, a suíte com o `--help` e pelo menos 3 casos: uso básico, variação de opção ou argumento e erro previsto, e o teste do repositório DEVE falhar, listando os nomes, se alguma suíte tiver menos (RN-12).
- [x] **CA-18** (evento): QUANDO o administrador abrir uma suíte, O SISTEMA DEVE mostrar os casos dela, e SE a suíte tiver falha, ENTÃO DEVE mostrá-la aberta e antes das demais (RN-13).
- [x] **CA-19** (evento): QUANDO o administrador buscar um texto, O SISTEMA DEVE filtrar as suítes pelo nome e pelo comando de qualquer caso, sem reexecutar a verificação.
- [x] **CA-20** (indesejado): SE a saída de um caso passar de 2000 caracteres, ENTÃO O SISTEMA DEVE mostrar o início dela e avisar que foi cortada.
- [x] **CA-22** (estado): ENQUANTO a verificação estiver em andamento, O SISTEMA DEVE mostrar na tela o terminal com cada comando sendo digitado e executado, sempre na velocidade extremamente rápida e com a animação de digitação ligada, sem oferecer controle de velocidade (RN-15).
- [x] **CA-23** (estado): ENQUANTO a verificação roda e DEPOIS que ela termina, O SISTEMA DEVE manter no terminal da tela todo o histórico dos comandos e das saídas, sem limpá-lo entre comandos e suítes (salvo após `exit` ou `logout`), e DEVE deixá-lo na tela, selecionável para cópia, até o administrador executar de novo ou sair (RN-16).
- [x] **CA-24** (evento): QUANDO o administrador acionar "Copiar todos os comandos", O SISTEMA DEVE copiar o texto com todos os comandos digitados, em ordem, cada um com `[ok]` ou `[FAILED]` e, nas falhas, o esperado, o código obtido e o começo da saída; QUANDO acionar "Copiar só as falhas", DEVE copiar só os casos que falharam; SE a cópia não for possível, ENTÃO DEVE avisar e manter o texto do terminal selecionável (RN-17).
- [x] **CA-25** (ubíquo): O SISTEMA DEVE ter no manifesto pelo menos 5000 casos, além do `--help` automático de cada comando, e o teste do repositório DEVE falhar se o total ficar abaixo disso (RN-18).
- [x] **CA-26** (evento): QUANDO o administrador acionar "Baixar o terminal (.txt)", O SISTEMA DEVE salvar um arquivo de texto com o cabeçalho, e a transcrição completa do terminal, na ordem, com cada comando, a saída inteira e o estado, sem cortar a saída (RN-19).
- [ ] **CA-27** (evento): QUANDO o administrador acionar "Baixar todos os comandos (.txt)" ou "Baixar só as falhas (.txt)", O SISTEMA DEVE salvar um arquivo de texto com o mesmo conteúdo que o respectivo botão de copiar geraria; o segundo DEVE ficar desabilitado se nada falhou (RN-20).
- [ ] **CA-28** (estado): ENQUANTO o filtro "Só falhas" estiver ligado, O SISTEMA DEVE mostrar dentro de cada suíte apenas os casos que falharam, com o contador de falhas mostradas, e DEVE voltar a mostrar todos os casos ao desligá-lo, sem reexecutar a verificação (RN-20).
- [x] **CA-21** (indesejado): SE um caso falhar, ENTÃO O SISTEMA DEVE seguir para os casos seguintes da suíte e das demais, registrando cada falha (RN-04, RN-11).

## 8. Plano de Testes (Test Plan)

- **Backend:** não se aplica (sem backend).
- **Frontend, motor (Vitest, motor real):**
  - catálogo × manifesto, nas duas direções, com mensagem listando os nomes (cobre CA-09, RN-07);
  - o manifesto inteiro executado na máquina padrão passa (cobre CA-03, CA-04, RN-02); a ausência de intermitência foi conferida rodando esse teste várias vezes seguidas na entrega, pois cada execução leva cerca de 2,5 minutos;
  - `--help` de cada comando (cobre CA-10);
  - programa de longa duração termina sozinho dentro do limite (cobre CA-11);
  - item com falha e item que estoura o tempo são registrados e a execução continua, usando um manifesto de teste com itens propositalmente quebrados (cobre CA-05, CA-06);
  - interrupção por exceção não gera selo (cobre CA-07, RN-06);
  - a verificação não chama rede nem armazenamento (espiões em `fetch` e `localStorage`) (cobre CA-12).
  - transcrição: cada comando com a saída inteira e o estado, na ordem, com a marca de cada suíte; nome e cabeçalho do arquivo; entrega do texto ao navegador como arquivo (cobre CA-26);
  - volume: o total de casos do manifesto é de pelo menos 5000 (cobre CA-25);
  - suítes: cada comando tem o `--help` e ao menos 3 casos, com mensagem listando as que têm menos (cobre CA-17); os casos de uma suíte rodam em ordem e um apoia-se no anterior; caso que falha não interrompe os seguintes (cobre CA-21); saída acima de 2000 caracteres é cortada com aviso (cobre CA-20);
  - troca de máquina real: a tela e o histórico ficam, a marca aparece, e a sessão nova não herda variável, apelido nem histórico; após `exit` a janela é recriada e os comandos seguintes rodam (cobre CA-23);
  - terminal ao vivo: a verificação recebe o elemento da tela, roda todos os casos na velocidade máxima e deixa a janela aberta no fim (cobre CA-22, CA-23);
  - texto de exportação: todos os comandos em ordem, falhas explicadas, saída longa cortada, só falhas (cobre CA-24);
- **Frontend, tela (Testing Library):**
  - botão visível só ao ADMIN e redirecionamento dos demais (cobre CA-01, CA-02);
  - ao abrir nada roda e a tela oferece o botão de iniciar, com o tamanho da verificação; ao iniciar, progresso e selo verde (cobre CA-03, CA-04);
  - selo vermelho, tabela de falhas e detalhe do que se esperava e do que o motor respondeu (cobre CA-05);
  - erro do motor com "Tentar de novo" (cobre CA-07), "Executar de novo" (cobre CA-08);
  - terminal ao vivo, sem seletor de velocidade (cobre CA-22); botões de copiar, com e sem falhas e com erro de cópia (cobre CA-24); botão de baixar o terminal (cobre CA-26); botões de baixar todos os comandos e só as falhas, o segundo desabilitado sem falhas (cobre CA-27); filtro "Só falhas" esconde os casos aprovados e mostra o contador (cobre CA-28);
  - lista de suítes, abrir e fechar, casos com comando, esperado e resposta, suíte com falha aberta e primeiro (cobre CA-16, CA-18); busca por comando de caso (cobre CA-19);
  - filtros e busca (cobre CA-15); rótulos e foco por teclado (cobre CA-14).
- **Documentação:** teste simples que lê `ARCHITECTURE.md`, `GLOSSARY.md` e as SPEC-028 e SPEC-029 e confere a presença da regra de manutenção (cobre CA-13).
- **Manual:** abrir a tela como administrador em 360, 768 e 1280px, conferir selo, progresso e a rolagem da tabela; abrir como docente e confirmar o redirecionamento.
- **Cobertura:** meta acima de 80% no escopo da spec, medida com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, as SPEC-014, SPEC-027, SPEC-028 e SPEC-029, e o código em `frontend/src/engine/` (em especial `commands/index.ts`, `commands/registry.ts`, `commands/binaries.ts`, `commands/fixtures/commands200.ts`, `processes/binaries.ts` e `testkit.ts`), mais `frontend/src/components/AppShell/AppShell.tsx` e `src/messages/pt-BR.ts`.
2. **Ordem de execução:**
   1. Implementar depois que a SPEC-028 e a SPEC-029 estiverem `Implementadas` (ou junto, no mesmo ramo), porque o manifesto precisa cobrir o catálogo final.
   2. Criar o manifesto, partindo dos itens já existentes nos testes do motor (RN-10), e a função que o executa, em `frontend/src/engine/conformance/`.
   3. Criar o teste catálogo × manifesto (RN-07) e fazê-lo passar completando o manifesto.
   4. Criar a tela, o botão no cabeçalho e as mensagens em `pt-BR.ts`.
   5. Escrever a regra RN-08 em `ARCHITECTURE.md`, `GLOSSARY.md` e na definição de pronto das SPEC-028 e SPEC-029.
   6. Rodar Vitest, ESLint, Stylelint e `tsc`; fazer o roteiro manual.
3. **Arquivos e diretórios a criar ou alterar:**
   - criar `frontend/src/engine/conformance/` (manifesto, executor, tipos, testes);
   - criar `frontend/src/app/app/admin/conformidade/page.tsx` e o componente da tela com estilos e testes em `frontend/src/components/`;
   - alterar `frontend/src/engine/terminalWindow.ts` (somente o método `swapMachine`, que mantém a tela do terminal; revisão 4);
   - alterar `frontend/src/components/AppShell/AppShell.tsx` (botão do ADMIN) e `frontend/src/messages/pt-BR.ts`;
   - alterar `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/features/028-...md` e `specs/features/029-...md` (somente a regra de manutenção);
   - alterar qualquer outro arquivo exige justificativa no resumo da entrega. `legacy/` é proibido.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status atualizado para `Implementada`.

## 10. Pendências para aprovação

Uma, aberta pela revisão 10. As anteriores foram resolvidas em 10/10/2026, com as recomendações aceitas pelo Tech Lead, e entraram nas seções acima.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-05 | A busca por texto, com "Só falhas" ligado, também deve esconder os casos que não contêm o termo dentro da suíte, ou só filtrar as suítes como hoje? | Esconder também os casos, para a tela mostrar só o que bate com a busca e com o filtro. |

### 10.1. Decisões (aprovadas pelo Tech Lead em 10/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | (Substituída pela D-12.) A verificação rodava ao abrir a tela |
| D-02 | O resultado não é guardado: sem histórico, tabela ou rota nesta spec. Histórico é spec futura |
| D-03 | "Programa" inclui o que um pacote instalado pelo `apt` simulado oferece. Cada pacote do catálogo do `apt` é verificado (instala, roda o programa, remove) dentro do limite de tempo e na máquina em memória (seção 3.3, RN-01) |
| D-04 | A regra de manutenção (RN-08) já foi escrita em `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-028 e SPEC-029 (só a linha da regra) |
| D-13 | Revisão 10 (11/10/2026): baixar todos os comandos e só as falhas como arquivo, e "Só falhas" passa a esconder os casos aprovados (RN-20, CA-27, CA-28) |
| D-12 | Revisão 9 (11/10/2026): a verificação **não** roda ao abrir a tela; o administrador escolhe iniciar, por um botão (CA-03). Substitui a D-01 |
| D-11 | Revisão 8 (11/10/2026): botão para baixar tudo o que o terminal imprimiu em um `.txt`, saída inteira, para análise (RN-19, CA-26) |
| D-10 | Revisão 7 (11/10/2026): o manifesto passa a ter pelo menos 5000 casos, de variedade real (RN-18, CA-25) |
| D-09 | Revisão 6 (11/10/2026): botões para copiar todos os comandos e só as falhas, em texto simples, para exportar (RN-17, CA-24) |
| D-08 | Revisão 5 (11/10/2026): a velocidade do terminal é fixa e extremamente rápida, com a animação de digitação ligada; o seletor de velocidade sai (RN-15, CA-22) |
| D-07 | Revisão 4 (11/10/2026): o terminal não reinicia entre comandos e suítes, o histórico fica e permanece na tela ao terminar, para copiar (RN-16, CA-23). Exige o método `swapMachine` em `frontend/src/engine/terminalWindow.ts` |
| D-06 | Revisão 3 (11/10/2026): terminal ao vivo na tela, sempre com a animação de digitação (RN-15, CA-22) |
| D-05 | Revisão 2 (11/10/2026): o item único vira suíte de casos por comando, com mínimo de 3 casos além do `--help`, e a tela mostra todos os casos (RN-11 a RN-14, CA-16 a CA-21). Pedido pelo Tech Lead para cobrir o uso de alunos avançados |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect | Criação em rascunho |
| 10/10/2026 | Aruna Architect | Pendências P-01 a P-04 viram decisões D-01 a D-04. Regra RN-08 registrada em ARCHITECTURE, GLOSSARY, SPEC-028 e SPEC-029. Aprovada pelo Tech Lead em 10/10/2026 |
| 11/10/2026 | Implementador (Claude) | Implementada: manifesto de 189 itens (183 comandos e 6 programas), executor, tela `/app/admin/conformidade`, botão do ADMIN e testes. Cada item parte do mesmo instantâneo da máquina preparada; o `--help` roda junto com o item. A verificação completa leva cerca de 2 a 3 minutos no navegador, com barra de progresso |
| 11/10/2026 | Aruna Architect | Revisão 2: suítes de casos por comando (RN-11 a RN-14, CA-16 a CA-21, D-05), a pedido do Tech Lead; status Aprovada até a reimplementação |
| 11/10/2026 | Aruna Architect | Revisão 3: terminal ao vivo na tela, com animação de digitação sempre ligada e seletor de velocidade (RN-15, CA-22, D-06), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 4: o terminal não reinicia e o histórico fica na tela para copiar (RN-16, CA-23, D-07), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 5: velocidade do terminal fixa no máximo, sem seletor, animação sempre ligada (RN-15, CA-22, D-08), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 6: copiar todos os comandos e só as falhas, para exportar (RN-17, CA-24, D-09), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 7: volume mínimo de 5000 casos (RN-18, CA-25, D-10), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 8: exportar a transcrição completa do terminal em `.txt` (RN-19, CA-26, D-11), a pedido do Tech Lead |
| 11/10/2026 | Aruna Architect | Revisão 9: a verificação só começa quando o administrador aciona "Iniciar a verificação"; ao abrir a tela nada roda (CA-03, D-12), a pedido do Tech Lead |
| 11/10/2026 | Implementador (Claude) | Revisões 2 a 9 implementadas: manifesto de 189 comandos e programas com 8209 casos (1136 de usuários, 2095 de arquivos, 1270 de texto, 1442 com programas, 1283 de rede e processos, 1135 de pacotes e sistema e 984 de shell), terminal ao vivo sempre na velocidade máxima, que mantém a tela entre as suítes (`swapMachine`), copiar, baixar o terminal em `.txt`, início por botão. A verificação completa no motor real levou 62 min e passou depois da correção de 7 casos mal escritos (openssl, ufw, wget). As lacunas do motor achadas (comandos que o motor não faz como o Linux) ficaram fora dos casos e vão para uma spec futura de correção |
| 11/10/2026 | Aruna Architect | Revisão 10: baixar todos os comandos e só as falhas em `.txt`, e filtro "Só falhas" que esconde os casos aprovados (RN-20, CA-27, CA-28, D-13, P-05), a pedido do Tech Lead; volta a Rascunho até a aprovação |
