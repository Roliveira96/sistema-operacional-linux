import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 03 · Navegação e diretórios: pwd, ls, cd, mkdir, rmdir, tree. */
export const diretorios: Topico = {
  id: 'diretorios',
  numero: 3,
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

  naPratica: 'Num servidor web, o site costuma ficar em <code>/var/www/html</code>, os logs em <code>/var/log</code> (ex.: <code>/var/log/nginx/error.log</code>) e as configurações em <code>/etc</code> (ex.: <code>/etc/nginx/nginx.conf</code>, <code>/etc/ssh/sshd_config</code>). Conhecer essa organização é o que permite entrar por SSH num servidor que você nunca viu e achar as coisas em segundos.',
  demonstracao: [
    { comando: 'ls /', explicacao: 'a raiz: todas as pastas principais' },
    { comando: 'ls -ld /root /home /etc /tmp', explicacao: 'as pastas-chave, com dono e permissão' },
    { comando: 'cd /home/ricardo', explicacao: 'caminho absoluto' },
    { comando: 'cd ..', explicacao: '.. sobe um nível: /home' },
    { comando: 'pwd' },
    { comando: 'cd ~', explicacao: '~ = home do root' },
    { comando: 'pwd' },
    { comando: 'cd -', explicacao: '- volta para onde estava (/home)' },
    { comando: 'cd' },
  ],

  preparar(): void {
    // começa com a máquina padrão
  },

  licoes: [
    {
      comando: 'pwd',
      titulo: 'Mostrar onde estou',
      descricao: '<b>p</b>rint <b>w</b>orking <b>d</b>irectory: imprime o caminho absoluto do diretório atual. É o "você está aqui" do mapa.',
      sintaxe: 'pwd',
      naPratica: 'Antes de um comando perigoso (como <code>rm -r *</code>) num servidor de produção, o administrador confere com <code>pwd</code> se está mesmo na pasta certa. Um <code>rm -r *</code> na pasta errada já derrubou muito site.',
      exemplos: [
        { comando: 'pwd', explicacao: 'o root começa em /root' },
      ],
      dicas: [
        '<b>[LPI Linux Essentials 2.3 / LPIC-1 103.3]:</b> <code>pwd</code> (print working directory) imprime o caminho absoluto. O bash guarda esse valor na variável <code>$PWD</code>.',
        'Perdido? <code>pwd</code> resolve. Quer voltar para casa? <code>cd</code> sozinho.',
      ],
    },
    {
      comando: 'ls',
      titulo: 'Listar o conteúdo',
      descricao: '<b>l</b>i<b>s</b>t: mostra o que existe dentro de um diretório. Sem argumentos, lista o diretório atual. ' +
        'No terminal, <span class="cor-dir">azul</span> = diretório e <span class="cor-exe">verde</span> = executável.',
      sintaxe: 'ls [opções] [caminho...]',
      naPratica: 'Chegou um chamado dizendo que o site parou? <code>ls -lh /var/log/nginx</code> mostra se o log de erros cresceu. Depois de publicar uma versão nova, <code>ls -la /var/www/html</code> confirma se os arquivos chegaram e com qual dono. O <code>-a</code> revela arquivos ocultos importantes, como <code>.env</code> (senhas da aplicação) e <code>.htaccess</code>.',
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
        '<b>[LPI Linux Essentials 2.3 / LPIC-1 103.3]:</b> Arquivos ocultos começam com <code>.</code> (use <code>-a</code> para vê-los). As opções <code>-t</code> (ordena por data de modificação) e <code>-S</code> (ordena por tamanho) caem com frequência em provas.',
        'Nomes com espaço aparecem entre aspas no ls, como <code>\'Área de Trabalho\'</code>. Para usá-los, coloque aspas: <code>cd "Área de Trabalho"</code>.',
      ],
      pegadinha: '<b>[LPIC-1 103.3]:</b> <code>ls -l pasta</code> lista o CONTEÚDO da pasta. Para examinar as permissões e o dono da própria pasta, a prova exige a opção <code>-d</code> (ex.: <code>ls -ld pasta</code>).',
    },
    {
      comando: 'cd',
      titulo: 'Entrar em um diretório',
      descricao: '<b>c</b>hange <b>d</b>irectory: muda o diretório atual. Aceita caminho absoluto ou relativo.',
      sintaxe: 'cd [caminho]',
      naPratica: 'O dia a dia de quem administra servidor por SSH é navegar: <code>cd /etc/nginx/sites-available</code> para mexer na configuração do site, <code>cd /var/log</code> para investigar um erro, e <code>cd -</code> para alternar rapidinho entre as duas pastas.',
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
        '<b>[LPIC-1 103.3]:</b> <code>cd</code> é um comando interno do shell (built-in); por isso <code>sudo cd</code> não existe. O atalho <code>cd -</code> lê a variável <code>$OLDPWD</code>.',
        'Use <kbd>Tab</kbd> para autocompletar caminhos rapidamente.',
      ],
      pegadinha: '<b>[LPI Linux Essentials 2.3]:</b> <code>cd..</code> (sem espaço) falha. O espaço é obrigatório: <code>cd ..</code>.',
    },
    {
      comando: 'mkdir',
      titulo: 'Criar diretórios',
      descricao: '<b>m</b>a<b>k</b>e <b>dir</b>ectory: cria uma ou várias pastas de uma vez.',
      sintaxe: 'mkdir [opções] diretório...',
      naPratica: 'Ao preparar um servidor para um sistema novo, cria-se a estrutura de uma vez: <code>mkdir -p /srv/app/releases /srv/app/logs</code>. Scripts de backup usam <code>mkdir -p /backup/2026-09-25</code>: com <code>-p</code> não dá erro se a pasta já existir, então o script não quebra na segunda execução.',
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
        '<b>[LPIC-1 103.3]:</b> A opção <code>mkdir -m 700 pasta</code> permite definir permissões octais diretamente na criação.',
        'Sem aspas, <code>mkdir minhas fotos</code> cria <b>duas</b> pastas: <code>minhas</code> e <code>fotos</code>.',
      ],
      pegadinha: '<b>[LPIC-1 103.3 / Linux Essentials 2.4]:</b> Sem a opção <code>-p</code> (parents), o <code>mkdir</code> gera erro se as pastas pai não existirem ("Arquivo ou diretório inexistente").',
    },
    {
      comando: 'tree',
      titulo: 'Ver a árvore de pastas',
      descricao: 'Desenha a estrutura de diretórios em forma de árvore. Ótimo para conferir o que você criou.',
      sintaxe: 'tree [-a] [-d] [-L nível] [caminho]',
      naPratica: 'Útil para entender a estrutura de um projeto recém-clonado no servidor (<code>tree -L 2 /var/www/app</code>), conferir se uma instalação criou todas as pastas esperadas ou colar a estrutura numa documentação.',
      opcoes: [
        ['-d', 'só diretórios'],
        ['-a', 'inclui ocultos'],
        ['-L 2', 'desce no máximo 2 níveis'],
      ],
      exemplos: [
        { comando: 'tree faculdade', explicacao: 'o tree não vem instalado: o Ubuntu sugere o pacote' },
        { comando: 'apt install -y tree', explicacao: 'instala (o apt é explicado no tópico Pacotes)' },
        { comando: 'tree faculdade' },
        { comando: 'tree -d -L 1 /', explicacao: 'as pastas principais do sistema' },
      ],
      dicas: [
        '<b>[LPIC-1 103.3]:</b> No Linux padrão o tree pode não vir instalado. Na prova, utilize <code>ls -R</code> ou <code>find . -type d</code> para inspecionar hierarquias recursivas.',
      ],
    },
    {
      comando: 'rmdir',
      titulo: 'Remover diretórios vazios',
      descricao: '<b>r</b>e<b>m</b>ove <b>dir</b>ectory: apaga diretórios, mas <b>só se estiverem vazios</b>. É o jeito "seguro".',
      sintaxe: 'rmdir [-p] diretório...',
      naPratica: 'Em rotinas de limpeza, apagar só pastas vazias é o caminho seguro: se algo ainda estiver lá dentro (um upload, um log), o <code>rmdir</code> recusa e você não perde dados por engano.',
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
      dicas: [
        '<b>[LPIC-1 103.3]:</b> <code>rmdir -p a/b/c</code> remove em cadeia c, b e a caso cada pai se torne vazio após a remoção do filho.',
      ],
      pegadinha: '<b>[LPIC-1 103.3]:</b> Diretório com qualquer conteúdo (mesmo arquivos ocultos) recusa <code>rmdir</code> ("Diretório não vazio"). Para apagar com conteúdo, a prova cobra <code>rm -r</code>.',
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
