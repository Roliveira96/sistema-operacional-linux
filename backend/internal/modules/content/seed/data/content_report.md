# Relatório de conversão do conteúdo legado

Gerado pelo extrator da SPEC-005. Formato do manifesto: versão 1. Hash do conteúdo: `0bd8374513cd4c580505cdf32d55bb8b27b2a3e7432b69fac50f00d074f007ec`.

## Contagens

| Item | Quantidade |
| :--- | ---: |
| Módulos de ensino | 9 |
| Blocos | 447 |
| Cenários (base e derivados) | 236 |
| Questões práticas | 222 |
| Questões teóricas (quiz) | 30 |
| Modelos de avaliação | 7 |
| Estados de máquina nas fixtures de equivalência | 275 |

## Correções e prova de equivalência

| Resultado | Quantidade |
| :--- | ---: |
| Correções traduzidas automaticamente | 219 de 222 |
| Questões com formas alternativas testadas | 61 (183 formas) |
| Cenários encadeados (desafios de tópico que dependem dos anteriores) | 10 |
| Questões publicadas (prova aprovada) | 204 |
| Questões em rascunho (revisão pendente) | 18 |

## Questões em rascunho

| Questão | Origem | Motivos |
| :--- | :--- | :--- |
| `arq-2` | `scenario/topic/arquivos` | verifier not translatable: ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n")).length >= 2 && ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n"))[0] === "Linux é demais" && ((Verificar.conteudo(m, "/root/aula/prova.txt") ?? "").trim().split("\n")).includes("aprovado") |
| `arq-3` | `scenario/topic/arquivos` | verifier not translatable: ((Verificar.conteudo(m, "/root/aula/linux.txt") ?? "").trim().split("\n")).length === 6 && ((Verificar.conteudo(m, "/root/aula/linux.txt") ?? "").trim().split("\n")).every((l) => l.includes("Linux")) |
| `arq-6` | `scenario/topic/arquivos` | the reference solution fails the original verifier in an isolated scenario |
| `usr-5` | `scenario/topic/usuarios` | verifier not translatable: m.usuariosNasConexoes().includes("lucas") |
| `bas-fac-2` | `scenario/simulado/basico` | the untouched scenario already passes the original verifier |
| `med-fac-6` | `scenario/simulado/medio` | the untouched scenario already passes the original verifier |
| `med-fac-9` | `scenario/simulado/medio` | the untouched scenario already passes the original verifier |
| `av-fac-3` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-3` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-4` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-9` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier |
| `av-med-10` | `scenario/simulado/avancado` | the untouched scenario already passes the original verifier<br>conditions decide false but the original verifier decides true on scenario<br>conditions decide false but the original verifier decides true on reference |
| `ess-fac-3` | `scenario/simulado/essentials` | the untouched scenario already passes the original verifier |
| `lpic-med-4` | `scenario/simulado/lpic1` | the untouched scenario already passes the original verifier |
| `esc-fac-1` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-fac-10` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-med-1` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
| `esc-med-5` | `scenario/simulado/escola` | the untouched scenario already passes the original verifier |
