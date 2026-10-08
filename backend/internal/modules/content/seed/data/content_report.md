# Relatório de conversão do conteúdo legado

Gerado pelo extrator da SPEC-005. Formato do manifesto: versão 1. Hash do conteúdo: `71733eb6bf6113a459dfe2f7a439c0df3954522ed76ffd810864b4153b42278a`.

## Contagens

| Item | Quantidade |
| :--- | ---: |
| Módulos de ensino | 9 |
| Blocos | 394 |
| Cenários (base e derivados) | 236 |
| Questões práticas | 222 |
| Questões teóricas (quiz) | 30 |
| Modelos de avaliação | 7 |
| Estados de máquina nas fixtures de equivalência | 275 |

## Correções e prova de equivalência

| Resultado | Quantidade |
| :--- | ---: |
| Correções traduzidas automaticamente | 204 de 222 |
| Questões com formas alternativas testadas | 61 (183 formas) |
| Cenários encadeados (desafios de tópico que dependem dos anteriores) | 10 |
| Questões publicadas (prova aprovada) | 190 |
| Questões em rascunho (revisão pendente) | 32 |

## Questões em rascunho

| Questão | Origem | Motivos |
| :--- | :--- | :--- |
| `est-2` | `scenario/topic/estrutura` | verifier not translatable: !(Verificar.conteudo(m, "/root/invasores.txt") ?? "").includes("Accepted") |
| `arq-2` | `scenario/topic/arquivos` | verifier not translatable: ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n")).length >= 2 && ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n"))[0] === "Linux é demais" && ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n")).includes("aprovado") |
| `arq-3` | `scenario/topic/arquivos` | verifier not translatable: ((Verificar.conteudo(m, "/root/aula/linux.txt") ?? "").trim().split("\n")).length === 6 && ((Verificar.conteudo(m, "/root/aula/linux.txt") ?? "").trim().split("\n")).every((l) => l.includes("Linux")) |
| `arq-6` | `scenario/topic/arquivos` | the reference solution fails the original verifier in an isolated scenario |
| `usr-5` | `scenario/topic/usuarios` | verifier not translatable: m.usuariosNasConexoes().includes("lucas") |
| `pac-1` | `scenario/topic/pacotes` | verifier not translatable: (new GerenciadorDePacotes(m)).atualizaveis().length === 0 |
| `bas-fac-2` | `scenario/simulado/basico` | the untouched scenario already passes the original verifier |
| `bas-med-5` | `scenario/simulado/basico` | verifier not translatable: (Verificar.conteudo(m, "/home/ricardo/primeiras_contas.txt")).trim().split("\n").length === 5 |
| `bas-med-6` | `scenario/simulado/basico` | verifier not translatable: (Verificar.conteudo(m, "/home/ricardo/ultimos_grupos.txt")).trim().split("\n").length === 3 |
| `bas-dif-3` | `scenario/simulado/basico` | verifier not translatable: !Verificar.contem(m, "/home/ricardo/nomes_usuarios.txt", "/bin/bash") |
| `bas-dif-4` | `scenario/simulado/basico` | verifier not translatable: !Verificar.contem(m, "/home/ricardo/sem_root.txt", "root:") |
| `med-fac-6` | `scenario/simulado/medio` | the untouched scenario already passes the original verifier |
| `med-fac-9` | `scenario/simulado/medio` | the untouched scenario already passes the original verifier |
| `av-fac-3` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-3` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-4` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-9` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-10` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier<br>verifier not translatable: new GerenciadorDePacotes(m).atualizaveis().length === 0<br>no suggestion could be derived from the reference solution |
| `ess-fac-3` | `scenario/simulado/essentials` | the untouched scenario already passes the original verifier |
| `ess-fac-4` | `scenario/simulado/essentials` | verifier not translatable: Verificar.contem(m, "/tmp/lpi-lab/usuario_atual.txt", "root") \|\| Verificar.contem(m, "/tmp/lpi-lab/usuario_atual.txt", "ricardo") |
| `ess-med-2` | `scenario/simulado/essentials` | verifier not translatable: (Verificar.conteudo(m, "/tmp/lpi-lab/primeiros_grupos.txt")).trim().split("\n").length === 5 |
| `ess-med-3` | `scenario/simulado/essentials` | verifier not translatable: (Verificar.conteudo(m, "/tmp/lpi-lab/ultimos_usuarios.txt")).trim().split("\n").length === 5 |
| `ess-med-10` | `scenario/simulado/essentials` | verifier not translatable: Verificar.contem(m, "/tmp/lpi-lab/shells_sistema.txt", "/bin/bash") \|\| Verificar.contem(m, "/tmp/lpi-lab/shells_sistema.txt", "sh") |
| `lpic-med-1` | `scenario/simulado/lpic1` | verifier not translatable: (new GerenciadorDePacotes(m)).atualizaveis().length === 0 |
| `lpic-med-4` | `scenario/simulado/lpic1` | the untouched scenario already passes the original verifier |
| `lpic-dif-6` | `scenario/simulado/lpic1` | verifier not translatable: Verificar.contem(m, "/home/ricardo/grupos_validos.txt", "root:") \|\| Verificar.contem(m, "/home/ricardo/grupos_validos.txt", "sudo:") |
| `lpic-dif-8` | `scenario/simulado/lpic1` | verifier not translatable: !Verificar.contem(m, "/home/ricardo/passwd_sh.txt", "/bin/bash") |
| `esc-fac-1` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-fac-10` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-med-1` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-med-5` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-dif-1` | `scenario/simulado/escola` | verifier not translatable: (new GerenciadorDePacotes(m)).atualizaveis().length === 0 |
