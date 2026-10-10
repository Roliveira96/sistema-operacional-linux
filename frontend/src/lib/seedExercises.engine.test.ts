// Generates the 50 exercises of the bank of "História do Linux" (SPEC-023): every solution runs on the real terminal, the conditions are
// derived from how it ends, and the whole bank is run through the bank test. Writes backend/seeds/historia-do-linux-exercicios.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { testBank, type BankItem } from "./bankTest";
import { createEngineSandbox, type EngineSandbox } from "./bankTestEngine";
import { checkConditions, deriveConditions } from "./exerciseConditions";
import type { MachineTree } from "./machineDiff";
import { runLayers } from "./setupRunner";
import type { Setup, SetupLayer } from "./setup";

vi.setConfig({ testTimeout: 600_000 });

type Difficulty = "EASY" | "MEDIUM" | "HARD";
interface Def {
  key: string;
  title: string;
  difficulty: Difficulty;
  /** HTML paragraphs of the statement. */
  statement: string[];
  hints: [string, string?][];
  solution: string[];
  dependsOn?: string;
  /** Where it is linked: the practice of the module, or the assessment (exclusive). */
  link: "practice" | "assessment";
}

const code = (s: string) => `<code>${s}</code>`;
const D = (d: Def): Def => d;

// ---- Standalone ones --------------------------------------------------------------------------------------------------------------
const solo: Def[] = [
  D({ key: "s01", title: "Criar um arquivo vazio", difficulty: "EASY", link: "practice", statement: [`Crie o arquivo vazio ${code("/labs/vazio.txt")}. O diretório ${code("/labs")} ainda não existe.`], hints: [["O comando mkdir -p cria um diretório e os que faltam no caminho."], ["O comando touch cria um arquivo vazio.", "touch /labs/vazio.txt"]], solution: ["mkdir -p /labs", "touch /labs/vazio.txt"] }),
  D({ key: "s02", title: "Criar diretórios aninhados", difficulty: "EASY", link: "practice", statement: [`Crie a estrutura de diretórios ${code("/labs/a/b/c")} de uma só vez.`], hints: [["A opção -p do mkdir cria os diretórios pais que ainda não existem."], ["Um único comando resolve.", "mkdir -p /labs/a/b/c"]], solution: ["mkdir -p /labs/a/b/c"] }),
  D({ key: "s03", title: "Escrever uma palavra em um arquivo", difficulty: "EASY", link: "practice", statement: [`Crie o arquivo ${code("/labs/linux.txt")} contendo apenas a palavra ${code("Linux")}.`], hints: [["O comando echo imprime um texto, e o símbolo > manda a saída para um arquivo."], ["Lembre de criar o diretório antes.", "echo Linux > /labs/linux.txt"]], solution: ["mkdir -p /labs", "echo Linux > /labs/linux.txt"] }),
  D({ key: "s04", title: "Copiar um arquivo", difficulty: "EASY", link: "practice", statement: [`Crie o arquivo ${code("/labs/origem.txt")} com o texto ${code("copia")} e faça uma cópia dele em ${code("/labs/destino.txt")}.`], hints: [["O comando cp copia um arquivo: cp origem destino."], ["Primeiro crie a origem, depois copie.", "cp /labs/origem.txt /labs/destino.txt"]], solution: ["mkdir -p /labs", "echo copia > /labs/origem.txt", "cp /labs/origem.txt /labs/destino.txt"] }),
  D({ key: "s05", title: "Renomear um arquivo", difficulty: "EASY", link: "practice", statement: [`Crie o arquivo ${code("/labs/velho.txt")} com o texto ${code("dados")} e renomeie-o para ${code("/labs/novo.txt")}. Ao final, só o nome novo deve existir.`], hints: [["No Linux, renomear é mover: o comando mv troca o nome do arquivo."], ["mv origem destino.", "mv /labs/velho.txt /labs/novo.txt"]], solution: ["mkdir -p /labs", "echo dados > /labs/velho.txt", "mv /labs/velho.txt /labs/novo.txt"] }),
  D({ key: "s06", title: "Criar um usuário", difficulty: "EASY", link: "practice", statement: [`Crie o usuário ${code("maria")} no sistema.`], hints: [["O comando useradd cria um usuário."], ["useradd nome.", "useradd maria"]], solution: ["useradd maria"] }),
  D({ key: "s07", title: "Criar um grupo", difficulty: "EASY", link: "practice", statement: [`Crie o grupo ${code("suporte")}.`], hints: [["O comando groupadd cria um grupo."], ["groupadd nome.", "groupadd suporte"]], solution: ["groupadd suporte"] }),
  D({ key: "s08", title: "Colocar um usuário em um grupo", difficulty: "MEDIUM", link: "practice", statement: [`Crie o usuário ${code("joao")} e o grupo ${code("redes")}, e faça o ${code("joao")} participar do grupo ${code("redes")}.`], hints: [["Crie o usuário e o grupo antes de ligar um ao outro."], ["usermod -aG adiciona o usuário a um grupo sem tirá-lo dos outros.", "usermod -aG redes joao"]], solution: ["useradd joao", "groupadd redes", "usermod -aG redes joao"] }),
  D({ key: "s09", title: "Criar um script executável", difficulty: "MEDIUM", link: "practice", statement: [`Crie o arquivo ${code("/labs/backup.sh")} com a linha ${code("#!/bin/bash")} e deixe-o executável por todos (modo ${code("755")}).`], hints: [["A primeira linha de um script diz qual interpretador o executa."], ["chmod muda as permissões. O modo 755 dá leitura e execução a todos e escrita ao dono.", "chmod 755 /labs/backup.sh"]], solution: ["mkdir -p /labs", "echo '#!/bin/bash' > /labs/backup.sh", "chmod 755 /labs/backup.sh"] }),
  D({ key: "s10", title: "Criar um link simbólico para um diretório", difficulty: "MEDIUM", link: "practice", statement: [`Crie o link simbólico ${code("/labs/logs")} apontando para o diretório ${code("/var/log")}.`], hints: [["Um link simbólico é um atalho. O comando é ln com a opção -s."], ["ln -s alvo nome-do-link.", "ln -s /var/log /labs/logs"]], solution: ["mkdir -p /labs", "ln -s /var/log /labs/logs"] }),
  D({ key: "s11", title: "Escrever várias linhas", difficulty: "MEDIUM", link: "practice", statement: [`Crie o arquivo ${code("/labs/numeros.txt")} com três linhas: ${code("um")}, ${code("dois")} e ${code("tres")}, nessa ordem.`], hints: [["O comando printf aceita \\n para mudar de linha."], ["Uma só linha de comando faz o arquivo todo.", "printf 'um\\ndois\\ntres\\n' > /labs/numeros.txt"]], solution: ["mkdir -p /labs", "printf 'um\\ndois\\ntres\\n' > /labs/numeros.txt"] }),
  D({ key: "s12", title: "Diretório de um usuário", difficulty: "MEDIUM", link: "practice", statement: [`Crie o usuário ${code("paula")}, crie o diretório ${code("/labs/paula")} e faça dela a dona do diretório.`], hints: [["O comando chown troca o dono de um arquivo ou diretório."], ["chown usuario caminho.", "chown paula /labs/paula"]], solution: ["mkdir -p /labs/paula", "useradd paula", "chown paula /labs/paula"] }),
  D({ key: "s13", title: "Diretório restrito", difficulty: "MEDIUM", link: "practice", statement: [`Crie o diretório ${code("/labs/restrito")} de modo que só o dono possa entrar, ler e escrever nele (modo ${code("700")}).`], hints: [["O mkdir aceita a opção -m para já criar com um modo."], ["mkdir -m 700 caminho.", "mkdir -m 700 /labs/restrito"]], solution: ["mkdir -p /labs", "mkdir -m 700 /labs/restrito"] }),
  D({ key: "s14", title: "Juntar o conteúdo de dois arquivos", difficulty: "MEDIUM", link: "practice", statement: [`Crie ${code("/labs/p1.txt")} com o texto ${code("a")} e ${code("/labs/p2.txt")} com o texto ${code("b")}. Depois junte os dois, nessa ordem, em ${code("/labs/juntos.txt")}.`], hints: [["O comando cat concatena arquivos e mostra o resultado."], ["Redirecione a saída do cat para o arquivo novo.", "cat /labs/p1.txt /labs/p2.txt > /labs/juntos.txt"]], solution: ["mkdir -p /labs", "echo a > /labs/p1.txt", "echo b > /labs/p2.txt", "cat /labs/p1.txt /labs/p2.txt > /labs/juntos.txt"] }),
  D({ key: "s15", title: "Guardar só o começo de um arquivo", difficulty: "MEDIUM", link: "practice", statement: [`Crie ${code("/labs/linhas.txt")} com as linhas ${code("l1")}, ${code("l2")} e ${code("l3")}. Depois guarde somente as duas primeiras linhas em ${code("/labs/topo.txt")}.`], hints: [["O comando head mostra o começo de um arquivo, e -n escolhe quantas linhas."], ["head -n 2 arquivo.", "head -n 2 /labs/linhas.txt > /labs/topo.txt"]], solution: ["mkdir -p /labs", "printf 'l1\\nl2\\nl3\\n' > /labs/linhas.txt", "head -n 2 /labs/linhas.txt > /labs/topo.txt"] }),
  D({ key: "s16", title: "Arquivo somente leitura", difficulty: "MEDIUM", link: "assessment", statement: [`Crie o arquivo ${code("/labs/leitura.txt")} e deixe-o somente para leitura para todos (modo ${code("444")}).`], hints: [["chmod com um número define as permissões de dono, grupo e outros."], ["Leitura é 4, então 444.", "chmod 444 /labs/leitura.txt"]], solution: ["mkdir -p /labs", "touch /labs/leitura.txt", "chmod 444 /labs/leitura.txt"] }),
  D({ key: "s17", title: "Criar dois diretórios", difficulty: "EASY", link: "assessment", statement: [`Crie os diretórios ${code("/labs/projetoX")} e ${code("/labs/projetoY")}.`], hints: [["O mkdir aceita vários nomes de uma vez."], ["mkdir nome1 nome2.", "mkdir /labs/projetoX /labs/projetoY"]], solution: ["mkdir -p /labs", "mkdir /labs/projetoX /labs/projetoY"] }),
  D({ key: "s18", title: "Guardar um valor em um arquivo", difficulty: "EASY", link: "assessment", statement: [`Crie o diretório ${code("/labs/s18/dados")} e, dentro dele, o arquivo ${code("valor.txt")} contendo o número ${code("42")}.`], hints: [["Crie primeiro os diretórios, com -p."], ["echo 42 > arquivo.", "echo 42 > /labs/s18/dados/valor.txt"]], solution: ["mkdir -p /labs/s18/dados", "echo 42 > /labs/s18/dados/valor.txt"] }),
  D({ key: "s19", title: "Usuário com diretório pessoal", difficulty: "MEDIUM", link: "assessment", statement: [`Crie o usuário ${code("lucas")} já com o diretório pessoal ${code("/home/lucas")}.`], hints: [["A opção -m do useradd cria o diretório pessoal."], ["useradd -m nome.", "useradd -m lucas"]], solution: ["useradd -m lucas"] }),
  D({ key: "s20", title: "Relatório privado", difficulty: "HARD", link: "assessment", statement: [`Crie o diretório ${code("/labs/s20")} e, dentro dele, o arquivo ${code("relatorio.txt")} com o texto ${code("ok")}, legível e gravável só pelo dono (modo ${code("600")}).`], hints: [["Crie o diretório, o arquivo e só então mude o modo."], ["Dono 6, grupo 0, outros 0.", "chmod 600 /labs/s20/relatorio.txt"]], solution: ["mkdir -p /labs/s20", "echo ok > /labs/s20/relatorio.txt", "chmod 600 /labs/s20/relatorio.txt"] }),
];

// ---- Chains: each exercise depends on the one before it -----------------------------------------------------------------------------
function chain(prefix: string, steps: Omit<Def, "key" | "dependsOn" | "link">[]): Def[] {
  return steps.map((s, i) => ({ ...s, key: `${prefix}${i + 1}`, link: "practice" as const, dependsOn: i === 0 ? undefined : `${prefix}${i}` }));
}

const chains: Def[][] = [
  chain("a", [
    { title: "Script, passo 1: o diretório do projeto", difficulty: "EASY", statement: [`Crie o diretório ${code("/labs/projeto")}. O diretório ${code("/labs")} ainda não existe.`], hints: [["Use mkdir com a opção -p."], ["Um comando basta.", "mkdir -p /labs/projeto"]], solution: ["mkdir -p /labs/projeto"] },
    { title: "Script, passo 2: escrever o script", difficulty: "EASY", statement: [`No diretório ${code("/labs/projeto")}, crie o arquivo ${code("ola.sh")} com uma única linha: ${code('echo "Ola, Linux"')}.`], hints: [["Um script é um arquivo de texto com comandos."], ["Use aspas simples por fora para guardar as aspas duplas.", `echo 'echo "Ola, Linux"' > /labs/projeto/ola.sh`]], solution: [`echo 'echo "Ola, Linux"' > /labs/projeto/ola.sh`] },
    { title: "Script, passo 3: permitir a execução", difficulty: "EASY", statement: [`Deixe o ${code("ola.sh")} executável (modo ${code("755")}).`], hints: [["Um arquivo só roda como programa se tiver a permissão de execução."], ["chmod +x liga a execução.", "chmod 755 /labs/projeto/ola.sh"]], solution: ["chmod 755 /labs/projeto/ola.sh"] },
    { title: "Script, passo 4: executar e guardar a saída", difficulty: "MEDIUM", statement: [`Execute o ${code("ola.sh")} e guarde o que ele imprime em ${code("/labs/projeto/saida.txt")}.`], hints: [["Chame o script pelo caminho completo e redirecione a saída com >."], ["caminho > arquivo.", "/labs/projeto/ola.sh > /labs/projeto/saida.txt"]], solution: ["/labs/projeto/ola.sh > /labs/projeto/saida.txt"] },
    { title: "Script, passo 5: fazer uma cópia de segurança", difficulty: "MEDIUM", statement: [`Faça uma cópia da saída em ${code("/labs/projeto/saida.bak")}.`], hints: [["O cp copia arquivos."], ["cp origem destino.", "cp /labs/projeto/saida.txt /labs/projeto/saida.bak"]], solution: ["cp /labs/projeto/saida.txt /labs/projeto/saida.bak"] },
  ]),
  chain("b", [
    { title: "Equipe, passo 1: o grupo", difficulty: "EASY", statement: [`Crie o grupo ${code("devs")}.`], hints: [["groupadd cria grupos."], ["Um comando.", "groupadd devs"]], solution: ["groupadd devs"] },
    { title: "Equipe, passo 2: a primeira pessoa", difficulty: "EASY", statement: [`Crie o usuário ${code("ana")} já como integrante do grupo ${code("devs")} (que o passo anterior criou).`], hints: [["A opção -G do useradd define grupos extras."], ["useradd -G grupo nome.", "useradd -G devs ana"]], solution: ["useradd -G devs ana"] },
    { title: "Equipe, passo 3: a segunda pessoa", difficulty: "MEDIUM", statement: [`Crie o usuário ${code("bruno")} e coloque-o no grupo ${code("devs")}, que já tem a ${code("ana")}.`], hints: [["Crie o usuário e depois ligue ao grupo, ou faça tudo no useradd."], ["usermod -aG acrescenta o grupo.", "usermod -aG devs bruno"]], solution: ["useradd bruno", "usermod -aG devs bruno"] },
    { title: "Equipe, passo 4: o diretório da equipe", difficulty: "EASY", statement: [`Crie o diretório ${code("/labs/equipe")}.`], hints: [["mkdir com -p cria também o /labs."], ["Um comando.", "mkdir -p /labs/equipe"]], solution: ["mkdir -p /labs/equipe"] },
    { title: "Equipe, passo 5: o grupo dono", difficulty: "MEDIUM", statement: [`Faça do grupo ${code("devs")} o grupo dono de ${code("/labs/equipe")}.`], hints: [["chgrp troca o grupo dono."], ["chgrp grupo caminho.", "chgrp devs /labs/equipe"]], solution: ["chgrp devs /labs/equipe"] },
    { title: "Equipe, passo 6: acesso só da equipe", difficulty: "HARD", statement: [`Deixe ${code("/labs/equipe")} com acesso total para o dono e para o grupo e nenhum para os outros (modo ${code("770")}).`], hints: [["Três dígitos: dono, grupo e outros."], ["7 é leitura, escrita e execução; 0 é nada.", "chmod 770 /labs/equipe"]], solution: ["chmod 770 /labs/equipe"] },
  ]),
  chain("c", [
    { title: "Links, passo 1: o arquivo original", difficulty: "EASY", statement: [`Crie o diretório ${code("/labs/links")} e, dentro dele, o arquivo ${code("original.txt")} com o texto ${code("conteudo")}.`], hints: [["Crie o diretório antes do arquivo."], ["mkdir -p e echo.", "echo conteudo > /labs/links/original.txt"]], solution: ["mkdir -p /labs/links", "echo conteudo > /labs/links/original.txt"] },
    { title: "Links, passo 2: um atalho", difficulty: "MEDIUM", statement: [`Crie o link simbólico ${code("/labs/links/atalho.txt")} apontando para ${code("/labs/links/original.txt")}.`], hints: [["ln -s cria um link simbólico."], ["ln -s alvo link.", "ln -s /labs/links/original.txt /labs/links/atalho.txt"]], solution: ["ln -s /labs/links/original.txt /labs/links/atalho.txt"] },
    { title: "Links, passo 3: um atalho para o diretório", difficulty: "MEDIUM", statement: [`Crie o link simbólico ${code("/labs/atalho_dir")} apontando para o diretório ${code("/labs/links")}.`], hints: [["Um link simbólico também pode apontar para um diretório."], ["ln -s alvo link.", "ln -s /labs/links /labs/atalho_dir"]], solution: ["ln -s /labs/links /labs/atalho_dir"] },
    { title: "Links, passo 4: apagar o original", difficulty: "HARD", statement: [`Apague o ${code("original.txt")}. O ${code("atalho.txt")} fica quebrado, porque o arquivo para onde ele aponta deixou de existir.`], hints: [["rm apaga um nome do arquivo."], ["Um comando.", "rm /labs/links/original.txt"]], solution: ["rm /labs/links/original.txt"] },
  ]),
  chain("d", [
    { title: "Sigilo, passo 1: o arquivo secreto", difficulty: "EASY", statement: [`Crie o diretório ${code("/labs/privado")} e, dentro dele, o arquivo ${code("segredo.txt")} com o texto ${code("segredo")}.`], hints: [["mkdir -p e echo."], ["echo texto > arquivo.", "echo segredo > /labs/privado/segredo.txt"]], solution: ["mkdir -p /labs/privado", "echo segredo > /labs/privado/segredo.txt"] },
    { title: "Sigilo, passo 2: só o dono lê", difficulty: "MEDIUM", statement: [`Deixe o ${code("segredo.txt")} legível e gravável só pelo dono (modo ${code("600")}).`], hints: [["Dono: 6 (ler e escrever). Grupo e outros: 0."], ["chmod 600 caminho.", "chmod 600 /labs/privado/segredo.txt"]], solution: ["chmod 600 /labs/privado/segredo.txt"] },
    { title: "Sigilo, passo 3: um novo dono", difficulty: "MEDIUM", statement: [`Crie o usuário ${code("carla")} e passe o ${code("segredo.txt")} para ela.`], hints: [["Crie o usuário, depois troque o dono."], ["chown usuario caminho.", "chown carla /labs/privado/segredo.txt"]], solution: ["useradd carla", "chown carla /labs/privado/segredo.txt"] },
    { title: "Sigilo, passo 4: o grupo também lê", difficulty: "HARD", statement: [`Libere a leitura para o grupo do ${code("segredo.txt")} (modo ${code("640")}).`], hints: [["O dígito do meio é o do grupo. Leitura vale 4."], ["Dono 6, grupo 4, outros 0.", "chmod 640 /labs/privado/segredo.txt"]], solution: ["chmod 640 /labs/privado/segredo.txt"] },
  ]),
  chain("e", [
    { title: "Cópia de segurança, passo 1: os documentos", difficulty: "EASY", statement: [`Crie o diretório ${code("/labs/docs")} com três arquivos vazios: ${code("a.txt")}, ${code("b.txt")} e ${code("c.txt")}.`], hints: [["touch aceita vários nomes."], ["Um touch com os três.", "touch /labs/docs/a.txt /labs/docs/b.txt /labs/docs/c.txt"]], solution: ["mkdir -p /labs/docs", "touch /labs/docs/a.txt /labs/docs/b.txt /labs/docs/c.txt"] },
    { title: "Cópia de segurança, passo 2: copiar o diretório", difficulty: "MEDIUM", statement: [`Faça uma cópia de ${code("/labs/docs")}, com tudo que há dentro, em ${code("/labs/docs_bkp")}.`], hints: [["Para copiar um diretório inteiro o cp precisa da opção -r (recursivo)."], ["cp -r origem destino.", "cp -r /labs/docs /labs/docs_bkp"]], solution: ["cp -r /labs/docs /labs/docs_bkp"] },
    { title: "Cópia de segurança, passo 3: um acidente", difficulty: "MEDIUM", statement: [`Apague, por engano, o arquivo ${code("/labs/docs/a.txt")}. A cópia em ${code("/labs/docs_bkp")} continua intacta.`], hints: [["rm apaga arquivos."], ["Um comando.", "rm /labs/docs/a.txt"]], solution: ["rm /labs/docs/a.txt"] },
    { title: "Cópia de segurança, passo 4: restaurar", difficulty: "HARD", statement: [`Restaure o ${code("a.txt")} em ${code("/labs/docs")}, copiando-o de ${code("/labs/docs_bkp")}.`], hints: [["Copie da cópia de segurança de volta para o lugar de origem."], ["cp origem destino.", "cp /labs/docs_bkp/a.txt /labs/docs/a.txt"]], solution: ["cp /labs/docs_bkp/a.txt /labs/docs/a.txt"] },
  ]),
  chain("f", [
    { title: "Frutas, passo 1: a lista", difficulty: "EASY", statement: [`Crie o arquivo ${code("/labs/frutas.txt")} com as linhas ${code("banana")}, ${code("abacaxi")} e ${code("uva")}, nessa ordem.`], hints: [["printf escreve várias linhas de uma vez."], ["Use \\n entre as linhas.", "printf 'banana\\nabacaxi\\nuva\\n' > /labs/frutas.txt"]], solution: ["mkdir -p /labs", "printf 'banana\\nabacaxi\\nuva\\n' > /labs/frutas.txt"] },
    { title: "Frutas, passo 2: mais uma fruta", difficulty: "EASY", statement: [`Acrescente a linha ${code("manga")} ao final do ${code("/labs/frutas.txt")}, sem apagar o que já está lá.`], hints: [["O símbolo >> acrescenta ao final, e o > sobrescreve."], ["echo texto >> arquivo.", "echo manga >> /labs/frutas.txt"]], solution: ["echo manga >> /labs/frutas.txt"] },
    { title: "Frutas, passo 3: em ordem alfabética", difficulty: "MEDIUM", statement: [`Guarde as frutas em ordem alfabética em ${code("/labs/ordenadas.txt")}.`], hints: [["O comando sort ordena as linhas."], ["Redirecione a saída.", "sort /labs/frutas.txt > /labs/ordenadas.txt"]], solution: ["sort /labs/frutas.txt > /labs/ordenadas.txt"] },
    { title: "Frutas, passo 4: filtrar", difficulty: "MEDIUM", statement: [`Guarde em ${code("/labs/comecam_b.txt")} só as linhas de ${code("/labs/ordenadas.txt")} que começam com ${code("b")}.`], hints: [["O grep filtra linhas. O símbolo ^ marca o começo da linha."], ["grep '^b' arquivo.", "grep '^b' /labs/ordenadas.txt > /labs/comecam_b.txt"]], solution: ["grep '^b' /labs/ordenadas.txt > /labs/comecam_b.txt"] },
  ]),
  chain("g", [
    { title: "Projeto, passo 1: a estrutura", difficulty: "EASY", statement: [`Crie os diretórios ${code("/labs/app/src")} e ${code("/labs/app/docs")}.`], hints: [["mkdir -p cria os pais."], ["Dois comandos.", "mkdir -p /labs/app/src"]], solution: ["mkdir -p /labs/app/src", "mkdir -p /labs/app/docs"] },
    { title: "Projeto, passo 2: o código", difficulty: "EASY", statement: [`Crie o arquivo vazio ${code("/labs/app/src/main.c")}.`], hints: [["touch cria arquivos vazios."], ["Um comando.", "touch /labs/app/src/main.c"]], solution: ["touch /labs/app/src/main.c"] },
    { title: "Projeto, passo 3: reorganizar", difficulty: "MEDIUM", statement: [`Mova o ${code("main.c")} de ${code("/labs/app/src")} para ${code("/labs/app/docs")}.`], hints: [["mv move arquivos entre diretórios."], ["mv origem destino.", "mv /labs/app/src/main.c /labs/app/docs/main.c"]], solution: ["mv /labs/app/src/main.c /labs/app/docs/main.c"] },
  ]),
];

const ORDER = [...solo.slice(0, 10), ...chains[0]!, ...chains[1]!, ...chains[2]!, ...solo.slice(10, 15), ...chains[3]!, ...chains[4]!, ...chains[5]!, ...chains[6]!, ...solo.slice(15)];

const step = (command: string) => ({ command });
const setupOf = (commands: string[]): Setup => ({ summary: "", steps: commands.map(step) });

let win: TerminalWindow | null = null;
let engine: EngineSandbox | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  engine?.destroy();
  engine = null;
  document.body.innerHTML = "";
});

// The snapshot of the module as the student gets it: the folder of the module and the script it brings.
const moduleLayer: SetupLayer = {
  id: "module",
  kind: "module",
  label: "Módulo",
  setup: { summary: "teste", steps: [step("mkdir /home/ricardo/financeiro"), step("cd /home/ricardo/financeiro/")], files: [{ path: "/home/ricardo/financeiro/teste.sh", content: "#!/bin/bash\n", mode: "755" }] },
};

describe("exercises of the bank of História do Linux", () => {
  it("has 50 exercises, with the chains declared", () => {
    expect(ORDER).toHaveLength(50);
    expect(new Set(ORDER.map((d) => d.key)).size).toBe(50);
    const keys = new Set(ORDER.map((d) => d.key));
    for (const d of ORDER) if (d.dependsOn) expect(keys.has(d.dependsOn)).toBe(true);
    expect(ORDER.filter((d) => d.dependsOn)).toHaveLength(23);
    expect(ORDER.filter((d) => d.link === "assessment")).toHaveLength(5);
  });

  // Slow (it runs the whole bank on the real terminal), so only on request: SEED_EXERCISES=1 npx vitest run src/lib/seedExercises.engine.test.ts
  it.runIf(process.env.SEED_EXERCISES)("runs every solution on the real terminal, derives how each one ends, and passes the whole bank through the bank test", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    win = await mountTerminalWindow(host, null, { onCommand: () => {} });
    win.setSpeed(100);
    expect((await runLayers(win, [moduleLayer], { restoreSpeed: 100 })).every((r) => r.status === 0)).toBe(true);
    const base = win.snapshot() as MachineTree;

    const derived = new Map<string, ReturnType<typeof deriveConditions>>();
    const states = new Map<string, MachineTree>();
    const failures: string[] = [];
    const run = async (def: Def) => {
      const before = win!.snapshot() as MachineTree;
      for (const command of def.solution) {
        const r = await win!.execute({ command });
        if (r.status !== 0) failures.push(`${def.key}: "${command}" -> ${r.status}: ${r.output.trim().slice(0, 120)}`);
      }
      const after = win!.snapshot() as MachineTree;
      const conditions = deriveConditions(before, after);
      if (conditions.length === 0) failures.push(`${def.key}: no conditions`);
      if (!checkConditions(conditions, after).done) failures.push(`${def.key}: conditions do not hold`);
      derived.set(def.key, conditions);
      states.set(def.key, after);
    };

    // A chain on one machine, the exercise after the one it depends on; the others each from the base.
    for (const def of ORDER) {
      if (def.dependsOn) win.reset(states.get(def.dependsOn)!);
      else win.reset(base);
      await run(def);
    }
    expect(failures).toEqual([]);

    const items: BankItem[] = ORDER.map((d) => ({ id: d.key, title: d.title, dependsOn: d.dependsOn ?? null, solution: setupOf(d.solution), conditions: derived.get(d.key)! }));
    engine = await createEngineSandbox(null, [moduleLayer]);
    expect(engine.conflicts).toEqual([]);
    const report = await testBank(items, engine.sandbox!, { seed: 2026 });
    expect({ conflicts: report.conflicts, isolated: report.isolated, suggested: report.suggested, untestable: report.untestable }).toEqual({ conflicts: [], isolated: [], suggested: [], untestable: [] });
    expect(report.status).toBe("ok");

    const out = ORDER.map((d) => ({
      key: d.key,
      title: d.title,
      difficulty: d.difficulty,
      statement: d.statement.map((p) => `<p>${p}</p>`).join(""),
      hints: d.hints.map(([text, command]) => (command ? { text, command } : { text })),
      solution: { summary: "", steps: d.solution.map(step) },
      conditions: derived.get(d.key),
      dependsOn: d.dependsOn ?? null,
      link: d.link,
    }));
    mkdirSync("../backend/seeds", { recursive: true });
    writeFileSync("../backend/seeds/historia-do-linux-exercicios.json", JSON.stringify(out, null, 2) + "\n");
  });
});
