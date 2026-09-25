import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 01 · Navegação e diretórios: pwd, ls, cd, mkdir, rmdir, tree. */
export const diretorios: Topico = {
  id: 'diretorios',
  numero: 1,
  titulo: 'Navegação e diretórios',
  subtitulo: 'pwd · ls · cd · mkdir · rmdir · tree',
  icone: '📁',
  cor: '--cor-dir',
  resumo: 'Onde estou, o que tem aqui e como criar pastas: caminhos absolutos e relativos, ., .. e ~.',
  conceitos:
    '<h3>🗺️ Antes dos comandos: como o Linux organiza as pastas</h3>' +
    '<p>Tudo começa na <b>raiz</b> <code>/</code>. Não existe "C:\\": discos, pendrives e até dispositivos aparecem como pastas dentro dela.</p>' +
    '<table class="tabela"><tr><td><code>/</code></td><td>raiz: o topo de tudo</td></tr>' +
    '<tr><td><code>/home</code></td><td>as pastas pessoais dos usuários (<code>/home/maria</code>)</td></tr>' +
    '<tr><td><code>/root</code></td><td>a pasta pessoal do <b>root</b> (não é /home/root!)</td></tr>' +
    '<tr><td><code>/etc</code></td><td>configurações do sistema: <code>passwd</code>, <code>group</code>, <code>shadow</code></td></tr>' +
    '<tr><td><code>/tmp</code></td><td>arquivos temporários (todo mundo escreve)</td></tr>' +
    '<tr><td><code>/bin</code> e <code>/usr/bin</code></td><td>os programas (comandos)</td></tr>' +
    '<tr><td><code>/var/log</code></td><td>registros (logs) do sistema</td></tr></table>' +
    '<h3>🧭 Caminho absoluto × relativo</h3>' +
    '<p><b>Absoluto</b> começa com <code>/</code> e funciona de qualquer lugar: <code>/home/ricardo/Documentos</code>. ' +
    '<b>Relativo</b> parte de onde você está: se você está em <code>/home/ricardo</code>, basta <code>Documentos</code>.</p>' +
    '<table class="tabela"><tr><td><code>.</code></td><td>o diretório atual</td></tr>' +
    '<tr><td><code>..</code></td><td>o diretório de cima (pai)</td></tr>' +
    '<tr><td><code>~</code></td><td>a sua pasta pessoal (home). Para o root é <code>/root</code></td></tr>' +
    '<tr><td><code>-</code></td><td>(no <code>cd -</code>) o diretório em que você estava antes</td></tr></table>' +
    '<p class="conceitos-dica">💡 No terminal, o <b>prompt</b> <code>root@servidor:~#</code> já diz muito: <b>usuário</b>@<b>máquina</b>:<b>onde estou</b> e ' +
    '<code>#</code> = root, <code>$</code> = usuário comum.</p>',

  preparar(): void {
    // começa com a máquina padrão
  },

  licoes: [
    {
      comando: 'pwd',
      titulo: 'Mostrar onde estou',
      descricao: '<b>p</b>rint <b>w</b>orking <b>d</b>irectory: imprime o caminho absoluto do diretório atual. É o "você está aqui" do mapa.',
      sintaxe: 'pwd',
      exemplos: [
        { comando: 'pwd', explicacao: 'o root começa em /root' },
      ],
      dicas: ['Perdido? <code>pwd</code> resolve. Quer voltar para casa? <code>cd</code> sozinho.'],
    },
    {
      comando: 'ls',
      titulo: 'Listar o conteúdo',
      descricao: '<b>l</b>i<b>s</b>t: mostra o que existe dentro de um diretório. Sem argumentos, lista o diretório atual. ' +
        'No terminal, <span class="cor-dir">azul</span> = diretório e <span class="cor-exe">verde</span> = executável.',
      sintaxe: 'ls [opções] [caminho...]',
      opcoes: [
        ['-l', 'formato <b>longo</b>: permissões, dono, grupo, tamanho e data'],
        ['-a', 'mostra <b>todos</b>, inclusive os ocultos (que começam com <code>.</code>)'],
        ['-la', 'as duas juntas (a ordem não importa: <code>-al</code> também vale)'],
        ['-h', 'tamanhos legíveis (4,0K, 1,2M), usado com -l'],
        ['-d', 'mostra o próprio diretório, não o conteúdo dele'],
        ['-R', 'recursivo: entra em todas as subpastas'],
      ],
      exemplos: [
        { comando: 'ls', explicacao: 'lista a pasta atual (/root)' },
        { comando: 'ls /', explicacao: 'lista a raiz usando caminho absoluto' },
        { comando: 'ls -l /home', explicacao: 'detalhes: repare no dono e nas permissões' },
        { comando: 'ls -la /home/ricardo', explicacao: 'inclui os ocultos, como .bashrc' },
        { comando: 'ls -ld /tmp', explicacao: 'dados do PRÓPRIO /tmp (repare no "t" no final)' },
      ],
      dicas: [
        'Arquivos ocultos são só arquivos cujo nome começa com ponto. Não é segurança, é só para não poluir a listagem.',
        'Nomes com espaço aparecem entre aspas no ls, como <code>\'Área de Trabalho\'</code>. Para usá-los, coloque aspas: <code>cd "Área de Trabalho"</code>.',
      ],
      pegadinha: '<code>ls -l</code> de um diretório lista o <b>conteúdo</b> dele. Para ver as permissões do diretório em si, use <code>ls -ld pasta</code>.',
    },
    {
      comando: 'cd',
      titulo: 'Entrar em um diretório',
      descricao: '<b>c</b>hange <b>d</b>irectory: muda o diretório atual. Aceita caminho absoluto ou relativo.',
      sintaxe: 'cd [caminho]',
      opcoes: [
        ['cd', 'sozinho: volta para a sua home (~)'],
        ['cd ..', 'sobe um nível'],
        ['cd ../..', 'sobe dois níveis'],
        ['cd -', 'volta para o diretório anterior'],
        ['cd /', 'vai para a raiz'],
        ['cd ~', 'vai para a home (igual ao cd sozinho)'],
      ],
      exemplos: [
        { comando: 'cd /etc', explicacao: 'caminho absoluto' },
        { comando: 'pwd' },
        { comando: 'cd ..', explicacao: 'sobe para a raiz /' },
        { comando: 'cd home/ricardo/Documentos', explicacao: 'caminho relativo (a partir de /)' },
        { comando: 'cd -', explicacao: 'volta para onde estava e mostra o caminho' },
        { comando: 'cd', explicacao: 'volta para casa: /root' },
      ],
      dicas: [
        'Use <kbd>Tab</kbd> para completar nomes: digite <code>cd /ho</code> e aperte Tab.',
        'O <code>cd</code> é um comando <b>embutido</b> no bash; por isso <code>sudo cd</code> não funciona.',
      ],
      pegadinha: '<code>cd..</code> (sem espaço) dá "comando não encontrado". O certo é <code>cd ..</code>.',
    },
    {
      comando: 'mkdir',
      titulo: 'Criar diretórios',
      descricao: '<b>m</b>a<b>k</b>e <b>dir</b>ectory: cria uma ou várias pastas de uma vez.',
      sintaxe: 'mkdir [opções] diretório...',
      opcoes: [
        ['-p', 'cria os diretórios <b>pais</b> que faltarem e não reclama se já existir'],
        ['-v', 'verboso: mostra cada diretório criado'],
        ['-m 700', 'já cria com essa permissão'],
      ],
      exemplos: [
        { comando: 'mkdir projetos', explicacao: 'cria projetos/ dentro de /root' },
        { comando: 'mkdir aulas provas trabalhos', explicacao: 'vários de uma vez' },
        { comando: 'mkdir faculdade/2026/linux', explicacao: 'ERRO: o pai faculdade/ não existe' },
        { comando: 'mkdir -pv faculdade/2026/linux', explicacao: 'com -p cria a árvore inteira' },
        { comando: 'mkdir "minhas fotos"', explicacao: 'nome com espaço precisa de aspas' },
        { comando: 'ls' },
      ],
      dicas: [
        'Sem aspas, <code>mkdir minhas fotos</code> cria <b>duas</b> pastas: <code>minhas</code> e <code>fotos</code>.',
        'Chaves criam em lote: <code>mkdir -p site/{css,js,img}</code> (no bash real). Aqui, liste um por um.',
      ],
      pegadinha: 'Sem o <code>-p</code>, o mkdir não cria pastas intermediárias: "Arquivo ou diretório inexistente".',
    },
    {
      comando: 'tree',
      titulo: 'Ver a árvore de pastas',
      descricao: 'Desenha a estrutura de diretórios em forma de árvore. Ótimo para conferir o que você criou.',
      sintaxe: 'tree [-a] [-d] [-L nível] [caminho]',
      opcoes: [
        ['-d', 'só diretórios'],
        ['-a', 'inclui ocultos'],
        ['-L 2', 'desce no máximo 2 níveis'],
      ],
      exemplos: [
        { comando: 'tree faculdade' },
        { comando: 'tree -d -L 1 /', explicacao: 'as pastas principais do sistema' },
      ],
      dicas: ['No Ubuntu recém-instalado o tree não vem por padrão: <code>sudo apt install tree</code>.'],
    },
    {
      comando: 'rmdir',
      titulo: 'Remover diretórios vazios',
      descricao: '<b>r</b>e<b>m</b>ove <b>dir</b>ectory: apaga diretórios, mas <b>só se estiverem vazios</b>. É o jeito "seguro".',
      sintaxe: 'rmdir [-p] diretório...',
      opcoes: [
        ['-p', 'remove também os pais, se ficarem vazios'],
        ['-v', 'mostra o que foi removido'],
      ],
      exemplos: [
        { comando: 'rmdir trabalhos', explicacao: 'vazio: some sem reclamar' },
        { comando: 'rmdir faculdade', explicacao: 'ERRO: Diretório não vazio' },
        { comando: 'rmdir -pv faculdade/2026/linux', explicacao: 'apaga linux, 2026 e faculdade' },
        { comando: 'ls' },
      ],
      pegadinha: 'Diretório com conteúdo não sai com rmdir. Aí é <code>rm -r</code> (veja o tópico Exclusão).',
    },
  ],

  desafios: [
    {
      id: 'dir-1',
      enunciado: 'Crie o diretório <code>/root/empresa</code>.',
      dica: 'Você já está em /root: <code>mkdir empresa</code> resolve. De qualquer lugar: <code>mkdir /root/empresa</code>.',
      solucao: [{ comando: 'mkdir /root/empresa' }],
      verificar: (m) => Verificar.diretorio(m, '/root/empresa'),
    },
    {
      id: 'dir-2',
      enunciado: 'Com <b>um único comando</b>, crie a árvore <code>/root/empresa/ti/suporte/chamados</code>.',
      dica: 'Precisa da opção que cria os pais que faltam.',
      solucao: [{ comando: 'mkdir -p /root/empresa/ti/suporte/chamados' }],
      verificar: (m) => Verificar.diretorio(m, '/root/empresa/ti/suporte/chamados'),
    },
    {
      id: 'dir-3',
      enunciado: 'Crie, dentro de <code>/root/empresa</code>, as pastas <code>rh</code>, <code>financeiro</code> e <code>vendas</code> com um único comando.',
      dica: 'O mkdir aceita vários nomes separados por espaço.',
      solucao: [{ comando: 'cd /root/empresa' }, { comando: 'mkdir rh financeiro vendas' }],
      verificar: (m) => ['rh', 'financeiro', 'vendas'].every((p: string) => Verificar.diretorio(m, '/root/empresa/' + p)),
    },
    {
      id: 'dir-4',
      enunciado: 'Crie a pasta <code>/root/empresa/Relatórios Anuais</code> (com espaço no nome).',
      dica: 'Aspas: <code>mkdir "Relatórios Anuais"</code>, ou escape o espaço com barra: <code>Relatórios\\ Anuais</code>.',
      solucao: [{ comando: 'mkdir "/root/empresa/Relatórios Anuais"' }],
      verificar: (m) => Verificar.diretorio(m, '/root/empresa/Relatórios Anuais'),
    },
    {
      id: 'dir-5',
      enunciado: 'Remova a pasta vazia <code>/root/empresa/vendas</code> usando o comando que <b>só</b> apaga diretórios vazios.',
      dica: 'É o rmdir.',
      solucao: [{ comando: 'rmdir /root/empresa/vendas' }],
      verificar: (m) => Verificar.diretorio(m, '/root/empresa/rh') && Verificar.naoExiste(m, '/root/empresa/vendas'),
    },
  ],
};
