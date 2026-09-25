import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 03 · Exclusão: rm, rm -r, rm -i, rm -f, curingas e rmdir. */
export const exclusao: Topico = {
  id: 'exclusao',
  numero: 3,
  titulo: 'Exclusão',
  subtitulo: 'rm · rm -r · rm -i · rm -f · curingas * ? · rmdir',
  icone: '🗑️',
  cor: '--cor-rm',
  resumo: 'Apagar arquivos e pastas com segurança: não existe lixeira no terminal!',
  conceitos:
    '<h3>⚠️ No terminal não existe lixeira</h3>' +
    '<p>O que o <code>rm</code> apaga <b>some de vez</b>. Por isso vale conferir com <code>ls</code> antes, principalmente quando usar curingas.</p>' +
    '<h3>🃏 Curingas (o shell expande antes do comando rodar)</h3>' +
    '<table class="tabela">' +
    '<tr><td><code>*</code></td><td>qualquer coisa (inclusive nada): <code>*.txt</code> = todos que terminam em .txt</td></tr>' +
    '<tr><td><code>?</code></td><td>exatamente um caractere: <code>foto?.jpg</code> = foto1.jpg, fotoA.jpg...</td></tr></table>' +
    '<p class="conceitos-dica">💡 Truque de segurança: rode <code>ls *.log</code> primeiro. Se listou o que você queria, troque o <code>ls</code> por <code>rm</code>.</p>' +
    '<h3>🔐 Quem pode apagar?</h3>' +
    '<p>Apagar um arquivo é <b>alterar a pasta</b> onde ele está. Então o que importa é ter permissão de escrita (<b>w</b>) e entrada (<b>x</b>) no <b>diretório</b>, ' +
    'não no arquivo. Exceção: pastas com <b>sticky bit</b> (o <code>t</code> em <code>drwxrwxrwt</code>, como o <code>/tmp</code>): lá cada um só apaga o que é seu.</p>',

  naPratica: 'Servidores enchem o disco com logs, backups antigos e arquivos temporários, e disco cheio derruba banco de dados e site. Limpar é rotina, mas é também onde acontecem os maiores desastres: não há lixeira e algum serviço pode depender do arquivo. Por isso: confira com <code>ls</code>, apague com precisão e prefira perguntar (<code>-i</code>) quando estiver em dúvida.',
  demonstracao: [
    { comando: 'ls /root/bagunca' },
    { comando: 'ls /root/bagunca/*.log', explicacao: '* : tudo que termina em .log' },
    { comando: 'ls /root/bagunca/foto?.jpg', explicacao: '? : um caractere só' },
    { comando: 'ls -ld /tmp', explicacao: 'o t no final = sticky bit' },
  ],

  preparar(maquina): void {
    maquina.criarDiretorio('/root/bagunca/temp/cache', 0, 0, 0o755);
    maquina.criarDiretorio('/root/bagunca/vazia', 0, 0, 0o755);
    for (const nome of ['relatorio.txt', 'lista.txt', 'foto1.jpg', 'foto2.jpg', 'foto10.jpg', 'app.log', 'erro.log', 'backup.old']) {
      maquina.criarArquivo('/root/bagunca/' + nome, nome.endsWith('.txt') ? 'conteúdo de ' + nome + '\n' : '', 0, 0, 0o644);
    }
    maquina.criarArquivo('/root/bagunca/temp/sessao1.tmp', 'x\n', 0, 0, 0o644);
    maquina.criarArquivo('/root/bagunca/temp/cache/img.tmp', 'x\n', 0, 0, 0o644);
    maquina.criarArquivo('/home/ricardo/protegido.txt', 'não me apague\n', 1000, 1000, 0o444);
    maquina.criarArquivo('/tmp/do-root.txt', 'arquivo do root no /tmp\n', 0, 0, 0o666);
  },

  licoes: [
    {
      comando: 'rm',
      titulo: 'Apagar arquivos',
      descricao: '<b>r</b>e<b>m</b>ove: apaga arquivos. Sem opções, <b>não apaga diretórios</b>.',
      sintaxe: 'rm [opções] arquivo...',
      naPratica: 'Remover um dump de banco que já foi para o backup, um arquivo de configuração antigo, ou um arquivo de trava que ficou para trás depois de uma queda de energia (<code>rm /tmp/backup.lock</code>) e está impedindo o backup de rodar.',
      opcoes: [
        ['-i', 'interativo: pergunta antes de cada um (responda s ou n)'],
        ['-f', 'força: não pergunta e não reclama de arquivo inexistente'],
        ['-v', 'mostra o que apagou'],
        ['-r', 'recursivo: apaga diretórios com tudo dentro'],
      ],
      exemplos: [
        { comando: 'cd bagunca' },
        { comando: 'ls' },
        { comando: 'rm backup.old', explicacao: 'some sem perguntar nada' },
        { comando: 'rm -v relatorio.txt lista.txt', explicacao: 'vários de uma vez, mostrando' },
        { comando: 'rm -i app.log', respostas: ['n'], explicacao: 'pergunta: respondemos n (não)' },
        { comando: 'rm nao-existe.txt', explicacao: 'erro: não existe' },
        { comando: 'rm -f nao-existe.txt', explicacao: 'com -f, silêncio' },
        { comando: 'rm temp', explicacao: 'ERRO: é um diretório' },
      ],
      pegadinha: '<code>rm</code> sozinho não apaga pasta ("É um diretório"). Para pasta vazia use <code>rmdir</code>; com conteúdo, <code>rm -r</code>.',
    },
    {
      comando: 'rm *',
      titulo: 'Apagar vários com curingas',
      descricao: 'O shell troca o curinga pela lista de nomes que combinam e só então chama o rm.',
      sintaxe: 'rm *.extensão  |  rm nome?.ext',
      naPratica: 'Limpar logs antigos compactados: <code>rm /var/log/app/*.gz</code>. Apagar temporários de upload: <code>rm /tmp/upload_*</code>. Sempre rode o mesmo padrão com <code>ls</code> antes para ver o que vai ser apagado.',
      exemplos: [
        { comando: 'ls *.log', explicacao: 'SEMPRE confira antes' },
        { comando: 'rm -v *.log', explicacao: 'apaga app.log e erro.log' },
        { comando: 'ls foto?.jpg', explicacao: '? = 1 caractere: foto10.jpg não entra' },
        { comando: 'rm -v foto?.jpg' },
        { comando: 'ls' },
      ],
      pegadinha: 'Um espaço a mais é fatal: <code>rm * .log</code> (com espaço) apaga <b>tudo</b> da pasta e depois reclama que ".log" não existe.',
    },
    {
      comando: 'rm -r',
      titulo: 'Apagar diretórios com conteúdo',
      descricao: 'Com <code>-r</code> (recursivo) o rm entra nas subpastas e apaga tudo. Combinado com <code>-f</code> vira o famoso <code>rm -rf</code>: poderoso e perigoso.',
      sintaxe: 'rm -r diretório  |  rm -rf diretório',
      naPratica: 'Remover versões antigas de um sistema depois de publicar a nova, ou limpar o cache de uma aplicação para forçar a recriação (<code>rm -rf /var/www/app/cache/*</code>). Cuidado em scripts: se a variável estiver vazia, <code>rm -rf $PASTA/</code> vira <code>rm -rf /</code>. Scripts profissionais sempre validam a variável antes.',
      exemplos: [
        { comando: 'tree temp' },
        { comando: 'rm -rv temp', explicacao: 'apaga a pasta e tudo dentro' },
        { comando: 'rm -ri vazia', respostas: ['s'], explicacao: '-i também funciona com -r' },
        { comando: 'rm -rf /', explicacao: 'o Linux se protege: recusa apagar a raiz' },
      ],
      dicas: ['A ordem das letras não importa: <code>-rf</code>, <code>-fr</code>, <code>-r -f</code> são iguais.'],
      pegadinha: 'Não existe "desfazer". <code>rm -rf pasta /</code> (com espaço antes da barra) tenta apagar a raiz também.',
    },
    {
      comando: 'rm (protegido)',
      titulo: 'Arquivo protegido contra escrita',
      descricao: 'Se o arquivo não tem permissão de escrita (<code>r--r--r--</code>), o rm <b>pergunta</b> antes de apagar. ' +
        'O root nunca é perguntado (ele pode tudo), então vamos testar no <b>terminal 2</b> como <b>ricardo</b>. Repare: quem decide se dá para apagar é a <b>pasta</b>.',
      sintaxe: 'rm arquivo  (e responda s/n)',
      naPratica: 'Arquivos importantes costumam ficar sem permissão de escrita justamente para o <code>rm</code> perguntar antes. Se ele pedir confirmação, pare e pense: alguém protegeu aquele arquivo por um motivo.',
      exemplos: [
        { comando: 'ls -l protegido.txt', terminal: 2, login: { usuario: 'ricardo', senha: '123' }, explicacao: 'permissão 444: só leitura' },
        { comando: 'rm protegido.txt', terminal: 2, respostas: ['n'], explicacao: 'pergunta; respondemos n' },
        { comando: 'rm -f protegido.txt', terminal: 2, explicacao: '-f não pergunta: apagou mesmo sendo 444, porque a pasta é do ricardo' },
      ],
    },
    {
      comando: 'rm (sticky /tmp)',
      titulo: 'Quem pode apagar: o sticky bit do /tmp',
      descricao: 'No <code>/tmp</code> todo mundo escreve, mas o <b>t</b> (sticky bit) impede que um usuário apague o arquivo de outro. ' +
        'Vamos testar no <b>terminal 2</b>, logado como <b>ricardo</b>.',
      sintaxe: 'ls -ld /tmp  →  drwxrwxrwt',
      naPratica: 'Num servidor usado por vários usuários e serviços (site, banco, tarefas agendadas), todos gravam no <code>/tmp</code>. Sem o sticky bit, qualquer um apagaria os arquivos temporários do banco de dados e derrubaria o serviço.',
      exemplos: [
        { comando: 'ls -ld /tmp', explicacao: 'o t no final = sticky bit' },
        { comando: 'ls -l /tmp', explicacao: 'do-root.txt tem permissão 666 (todos escrevem)' },
        { comando: 'rm /tmp/do-root.txt', terminal: 2, login: { usuario: 'ricardo', senha: '123' }, explicacao: 'como ricardo: Permissão negada' },
        { comando: 'echo "meu" > /tmp/do-ricardo.txt', terminal: 2, explicacao: 'mas ricardo cria o dele...' },
        { comando: 'rm /tmp/do-ricardo.txt', terminal: 2, explicacao: '... e apaga o dele normalmente' },
      ],
    },
    {
      comando: 'rmdir',
      titulo: 'A alternativa segura para pastas',
      descricao: 'Relembrando: <code>rmdir</code> só remove diretórios <b>vazios</b>. Se tiver algo dentro, ele se recusa, e isso é uma proteção.',
      sintaxe: 'rmdir diretório',
      naPratica: 'Scripts de limpeza removem pastas de upload que ficaram vazias sem o risco de apagar algo que ainda está em uso.',
      exemplos: [
        { comando: 'mkdir -p x/y' },
        { comando: 'rmdir x', explicacao: 'recusa: não está vazio' },
        { comando: 'rmdir x/y x', explicacao: 'primeiro o de dentro, depois o de fora' },
      ],
    },
  ],

  desafios: [
    {
      id: 'rm-1',
      enunciado: 'Apague <b>todos</b> os arquivos <code>.jpg</code> de <code>/root/bagunca</code> com um único comando.',
      dica: 'Curinga * com a extensão.',
      solucao: [{ comando: 'rm /root/bagunca/*.jpg' }],
      verificar: (m) => ['foto1.jpg', 'foto2.jpg', 'foto10.jpg'].every((f: string) => Verificar.naoExiste(m, '/root/bagunca/' + f)),
    },
    {
      id: 'rm-2',
      enunciado: 'Apague a pasta <code>/root/bagunca/temp</code> com <b>tudo</b> o que tem dentro.',
      dica: 'rm com a opção recursiva.',
      solucao: [{ comando: 'rm -r /root/bagunca/temp' }],
      verificar: (m) => Verificar.naoExiste(m, '/root/bagunca/temp'),
    },
    {
      id: 'rm-3',
      enunciado: 'Remova a pasta vazia <code>/root/bagunca/vazia</code>.',
      dica: 'rmdir, ou rm -r.',
      solucao: [{ comando: 'rmdir /root/bagunca/vazia' }],
      verificar: (m) => Verificar.naoExiste(m, '/root/bagunca/vazia'),
    },
    {
      id: 'rm-4',
      enunciado: 'No <b>terminal 2</b>, logado como <b>ricardo</b> (senha 123), apague <code>/home/ricardo/protegido.txt</code> (somente leitura) <b>sem que o rm pergunte</b>.',
      dica: 'Abra o terminal 2 com ＋, faça login como ricardo e use a opção que força.',
      solucao: [{ comando: 'rm -f /home/ricardo/protegido.txt', terminal: 2, login: { usuario: 'ricardo', senha: '123' } }],
      verificar: (m) => Verificar.naoExiste(m, '/home/ricardo/protegido.txt'),
    },
    {
      id: 'rm-5',
      enunciado: 'Deixe <code>/root/bagunca</code> completamente <b>vazia</b> (mas a pasta deve continuar existindo).',
      dica: '<code>rm -rf /root/bagunca/*</code> apaga o conteúdo e mantém a pasta.',
      solucao: [{ comando: 'rm -rf /root/bagunca/*' }],
      verificar: (m) => Verificar.vazio(m, '/root/bagunca'),
    },
  ],
};
