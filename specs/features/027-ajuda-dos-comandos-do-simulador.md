# SPEC-027: Ajuda dos Comandos do Simulador (`--help`)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-027 |
| **Status** | Rascunho (aguardando aprovação) |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (motor do terminal, `legacy/src`) |
| **Módulo** | `legacy/src/shell` (interpretador e os 121 comandos registrados) |
| **Contexto de tela** | Todo terminal do simulador: estudo, exercícios, gravação do professor |
| **Prioridade** | Média |
| **Depende de** | SPEC-020 (terminal e erro esperado) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

O simulador conhece **121 comandos**, e cada um tem hoje só um `resumo` de uma linha, mostrado por `help` e `man`. Mas muitas mensagens do próprio motor mandam o usuário digitar `COMANDO --help` ("Tente 'chmod --help' para mais informações"), e esse caminho **não existe**: o comando recebe `--help` como uma opção qualquer e responde com erro ou com outra coisa. Num Linux de verdade, `--help` é o primeiro lugar onde o aluno procura como usar um comando.

O pedido do Tech Lead: dar `--help` aos comandos mapeados, útil a alunos e professores.

## 2. Objetivos (Goals)

- Todo comando registrado responde a `--help` com uma ajuda em português, no estilo GNU: **uso**, **descrição**, **opções** e **exemplos**.
- A ajuda descreve **só o que o simulador realmente faz**: uma opção que o comando não implementa não aparece, para o aluno não tentar algo que vai falhar.
- A ajuda vale para o aluno no estudo e nos exercícios, e para o professor ao gravar a solução.
- As mensagens "Tente 'x --help'" passam a levar a algo que funciona.
- Novo comando não entra sem ajuda: um teste do próprio motor confere que todos os comandos registrados têm.

### 2.1. Fora de escopo (Non-Goals)

- Manual completo (`man` com páginas longas, rolagem e busca).
- A opção curta `-h` como ajuda (ela é outra coisa em vários comandos, como `ls -h` e `df -h`).
- Ajuda em inglês e autocompletar.
- Mudar o comportamento de qualquer comando além de reconhecer `--help`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Onde fica a ajuda

O `Comando` ganha um campo opcional estruturado, ao lado do `resumo`:

```ts
ajuda?: {
  uso: string;                        // "ls [OPÇÃO]... [ARQUIVO]..."
  descricao: string;                  // o que faz, em uma ou duas frases
  opcoes?: Array<[string, string]>;   // ["-l", "formato longo: dono, tamanho e data"]
  exemplos?: Array<[string, string]>; // ["ls -la /etc", "lista tudo de /etc, inclusive ocultos"]
}
```

Fica no próprio comando, junto do código que lê as opções, para a ajuda e o comportamento mudarem juntos.

### 3.2. Como a ajuda aparece

O interpretador reconhece `--help` **antes** de executar o comando, escreve a ajuda na saída padrão e termina com código 0, sem executar o comando. Saída:

```
Uso: ls [OPÇÃO]... [ARQUIVO]...
Lista o conteúdo de diretórios.

Opções:
  -a    mostra também os arquivos ocultos (os que começam com ponto)
  -l    formato longo: permissões, dono, tamanho e data

Exemplos:
  ls -la /etc    lista tudo de /etc, inclusive ocultos
```

### 3.3. Regras de negócio

| ID | Regra |
| :--- | :--- |
| RN-01 | `COMANDO --help` mostra a ajuda do comando e termina com código 0, sem executar o comando nem alterar a máquina |
| RN-02 | O texto é em português e segue as seções Uso, descrição, Opções e Exemplos; seção sem conteúdo é omitida |
| RN-03 | Só entram as opções e os usos que o simulador implementa; a fonte é o código do comando |
| RN-04 | `--help` só conta antes de `--`; depois de `--` é um operando comum (`echo -- --help` imprime `--help`) |
| RN-05 | Os comandos que repassam argumentos a outro (`sudo`, `su`, `xargs`, `nohup`, `time` e parentes) só respondem `--help` quando ele é o **primeiro** argumento; depois do nome do comando repassado, ele pertence ao comando repassado (`sudo ls --help` mostra a ajuda do `ls`) |
| RN-06 | A ajuda funciona em pipe e redirecionamento como qualquer saída (`ls --help \| head -n 3`, `ls --help > ajuda.txt`) |
| RN-07 | Os comandos embutidos do shell (`cd`, `export`, `alias`, `unset`, `read`...) também respondem `--help` |
| RN-08 | `help COMANDO` e `man COMANDO` mostram o mesmo conteúdo (nome, uso, descrição, opções e exemplos) em vez de só o resumo (P-02) |
| RN-09 | Um teste do motor falha se um comando registrado não tem `ajuda`, ou se a ajuda não começa com o nome do comando no uso |

## 4. Modelo de Dados (Data Model)

Sem banco e sem API. A ajuda é código do motor.

## 5. Contrato de API (API Contract)

Sem rotas. Contrato do terminal: `COMANDO --help` → saída padrão com o texto da seção 3.2, código de saída 0.

## 6. Impacto e Riscos (Impact & Risks)

- **Volume:** são 121 comandos. O texto de cada um é escrito lendo o código do comando (RN-03), e não de memória do Linux real, porque o simulador implementa só parte das opções. É a parte trabalhosa.
- **Exercícios:** nenhum exercício existente depende de `--help` falhar; as condições de término olham a máquina, e a ajuda não a altera.
- **Comandos que já tratam `--help`:** podem existir casos soltos (por exemplo no `apt`); a interceptação central passa a valer e o tratamento antigo é removido onde sobrar.
- **Manutenção:** quem muda as opções de um comando deve atualizar a ajuda no mesmo lugar; o teste de RN-09 pega a ausência, não a desatualização.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o usuário roda `COMANDO --help` de qualquer comando registrado, O SISTEMA DEVE mostrar o uso, a descrição, as opções e os exemplos, em português, e terminar com código 0.
- [ ] **CA-02** (indesejado): SE o usuário roda `COMANDO --help`, ENTÃO O SISTEMA NÃO DEVE executar o comando nem alterar arquivos, usuários ou processos da máquina.
- [ ] **CA-03** (ubíquo): A ajuda NÃO DEVE listar opção que o comando não implementa.
- [ ] **CA-04** (estado): ENQUANTO `--help` vem depois de `--`, O SISTEMA DEVE tratá-lo como operando comum.
- [ ] **CA-05** (evento): QUANDO `--help` vem depois do comando repassado por `sudo`, `xargs`, `nohup` ou `time`, O SISTEMA DEVE mostrar a ajuda do comando repassado.
- [ ] **CA-06** (evento): QUANDO a saída da ajuda é enviada por pipe ou redirecionada, O SISTEMA DEVE respeitar o pipe e o redirecionamento.
- [ ] **CA-07** (evento): QUANDO o usuário roda `help COMANDO` ou `man COMANDO`, O SISTEMA DEVE mostrar a ajuda completa do comando.
- [ ] **CA-08** (ubíquo): TODO comando registrado DEVE ter `ajuda`; o teste do motor falha se faltar.

## 8. Plano de Testes (Test Plan)

- **Contrato (todos os comandos):** para cada comando registrado, `--help` termina com 0, imprime a linha `Uso: <nome> …` e não altera a máquina (comparação do estado antes e depois).
- **Interpretador:** `--` encerra a procura; `sudo --help` e `sudo ls --help`; `xargs`, `nohup`, `time`; pipe e redirecionamento; comando embutido; comando desconhecido continua dando "comando não encontrado".
- **`help` e `man`:** mostram o conteúdo estruturado; comando inexistente continua com a mensagem atual.
- **Amostra de fidelidade:** por grupo (arquivos, texto, usuários, permissões, pacotes, processos, rede/sistema), as opções listadas são exercitadas de verdade pelo comando.
- **Regressão:** a suíte do motor e os testes do frontend que usam o terminal continuam passando.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-020; no código, `legacy/src/shell/Comando.ts`, `Interpretador.ts`, `RegistroDeComandos.ts` e `comandos/*.ts`.
2. **Ordem de execução:** (1) o tipo `ajuda`, a formatação e a interceptação no interpretador, com o teste de contrato; (2) `help` e `man`; (3) a ajuda de cada comando, um grupo de arquivos por vez, lendo o código de cada um; (4) testes de fidelidade e de regressão.
3. **Arquivos a criar ou alterar:** `Comando.ts`, `Interpretador.ts`, `comandos/Utilitarios.ts` (help e man) e todos os `comandos/*.ts`; testes em `legacy/tests`.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências (com recomendação)

| ID | Pergunta | Recomendação |
| :--- | :--- | :--- |
| P-01 | Idioma da ajuda | Português, como o resto do simulador |
| P-02 | `help COMANDO` e `man COMANDO` devem mostrar a mesma ajuda estruturada? | Sim: aproveita o mesmo conteúdo e deixa o `man` do simulador menos pobre |
| P-03 | Onde fica o texto: dentro de cada comando ou num arquivo à parte? | Dentro de cada comando, junto do código que lê as opções, para mudarem juntos |
| P-04 | Incluir `-h` como atalho da ajuda? | Não: em vários comandos `-h` tem outro sentido (`ls -h`, `df -h`) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; pendências P-01 a P-04 abertas com recomendação |
