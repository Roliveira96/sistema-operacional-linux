import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 04 · Arquivos: criar, ver, escrever, copiar, mover e editar. */
export const arquivos: Topico = {
  id: 'arquivos',
  numero: 4,
  titulo: 'Arquivos',
  subtitulo: 'touch · echo > >> · cat · cp · mv · head · tail · grep · nano · vim',
  icone: '📄',
  cor: '--cor-arq',
  resumo: 'Criar, ler, escrever, copiar, mover e renomear arquivos, e editar com nano e vim.',
  conceitos:
    '<h3>📄 Tudo é arquivo</h3>' +
    '<p>No Linux quase tudo é tratado como arquivo: textos, configurações (<code>/etc/passwd</code>), até dispositivos (<code>/dev/null</code>). ' +
    'A <b>extensão não manda em nada</b>: <code>notas.txt</code> e <code>notas</code> são igualmente arquivos de texto. Quem define se algo executa é a <b>permissão x</b>.</p>' +
    '<h3>➡️ Redirecionamento: mandar a saída para um arquivo</h3>' +
    '<table class="tabela">' +
    '<tr><td><code>comando &gt; arq</code></td><td><b>cria ou SOBRESCREVE</b> o arquivo com a saída</td></tr>' +
    '<tr><td><code>comando &gt;&gt; arq</code></td><td><b>ACRESCENTA</b> no final (não apaga o que já tinha)</td></tr>' +
    '<tr><td><code>comando 2&gt; erros.txt</code></td><td>manda só as <b>mensagens de erro</b> para o arquivo</td></tr>' +
    '<tr><td><code>cmd1 | cmd2</code></td><td><b>pipe</b>: a saída do primeiro vira a entrada do segundo</td></tr></table>' +
    '<p class="conceitos-dica">💡 Decore assim: <b>um</b> sinal <code>&gt;</code> apaga e escreve; <b>dois</b> <code>&gt;&gt;</code> somam.</p>',

  naPratica: 'Em servidores, redirecionamento é usado o tempo todo: tarefas agendadas no <b>cron</b> gravam o resultado com <code>&gt;&gt; /var/log/backup.log</code> para manter o histórico, e os erros vão para outro arquivo com <code>2&gt; erros.log</code>. O pipe junta ferramentas: <code>cat access.log | grep 404 | wc -l</code> conta quantas vezes o site respondeu "página não encontrada".',
  demonstracao: [
    { comando: 'echo "um" > demo.txt', explicacao: '> cria' },
    { comando: 'echo "dois" >> demo.txt', explicacao: '>> acrescenta' },
    { comando: 'cat demo.txt' },
    { comando: 'ls /nao-existe 2> erros.txt', explicacao: '2> guarda só o erro' },
    { comando: 'cat erros.txt' },
    { comando: 'ls /etc | head -3', explicacao: '| pipe: saída do ls vira entrada do head' },
  ],

  preparar(maquina): void {
    maquina.criarDiretorio('/root/aula', 0, 0, 0o755);
    maquina.criarArquivo('/root/aula/alunos.txt',
      'Ana;Linux;9.5\nBruno;Redes;7.0\nCarla;Linux;8.0\nDiego;Banco de Dados;6.5\nElisa;Linux;10\nFábio;Redes;5.5\n' +
      'Gabi;Linux;7.5\nHugo;Redes;9.0\nIris;Banco de Dados;8.5\nJoão;Linux;6.0\nKátia;Redes;7.5\nLuan;Linux;9.0\n', 0, 0, 0o644);
  },

  licoes: [
    {
      comando: 'touch',
      titulo: 'Criar arquivo vazio',
      descricao: 'Cria um arquivo vazio. Se ele já existir, <b>não apaga nada</b>: só atualiza a data de modificação.',
      sintaxe: 'touch arquivo...',
      naPratica: 'Alguns serviços só iniciam se o arquivo de log já existir: <code>touch /var/log/app.log</code> e depois ajusta-se o dono. Também é usado como "sinal": um script cria <code>/tmp/backup.lock</code> para avisar que o backup está rodando e evitar dois ao mesmo tempo.',
      exemplos: [
        { comando: 'cd aula', explicacao: 'entra na pasta de prática' },
        { comando: 'touch notas.txt' },
        { comando: 'touch a.txt b.txt c.txt', explicacao: 'vários de uma vez' },
        { comando: 'ls -l', explicacao: 'repare no tamanho 0 dos novos' },
      ],
      dicas: ['Arquivos novos nascem com permissão <code>644</code> para o root (<code>664</code> para usuários comuns), por causa do <b>umask</b>.'],
    },
    {
      comando: 'echo',
      titulo: 'Escrever texto (e gravar com > e >>)',
      descricao: 'Imprime um texto na tela. Junto com <code>&gt;</code> ou <code>&gt;&gt;</code> vira o jeito mais rápido de escrever em arquivos, sem editor.',
      sintaxe: 'echo "texto" [> arquivo | >> arquivo]',
      naPratica: 'Adicionar uma linha de configuração sem abrir editor: <code>echo "192.168.0.20 banco" &gt;&gt; /etc/hosts</code>. Em scripts, registrar o que aconteceu: <code>echo "backup concluído" &gt;&gt; /var/log/backup.log</code>. Trocar o <code>&gt;&gt;</code> por <code>&gt;</code> no /etc/hosts apagaria o arquivo inteiro e o servidor perderia os nomes cadastrados.',
      opcoes: [['-n', 'não pula linha no final'], ['-e', 'interpreta \\n (nova linha) e \\t (tab)']],
      exemplos: [
        { comando: 'echo "Olá, Linux!"', explicacao: 'só mostra na tela' },
        { comando: 'echo "primeira linha" > notas.txt', explicacao: '> cria/SOBRESCREVE' },
        { comando: 'echo "segunda linha" >> notas.txt', explicacao: '>> acrescenta no final' },
        { comando: 'cat notas.txt' },
        { comando: 'echo "sumiu tudo?" > notas.txt', explicacao: 'de novo com > ...' },
        { comando: 'cat notas.txt', explicacao: '... as duas linhas anteriores foram apagadas!' },
        { comando: 'echo "Usuário: $USER, casa: $HOME"', explicacao: 'aspas duplas expandem variáveis' },
        { comando: 'echo \'Usuário: $USER\'', explicacao: 'aspas simples mostram literalmente' },
      ],
      pegadinha: 'Usar <code>&gt;</code> quando queria <code>&gt;&gt;</code> apaga o conteúdo anterior sem perguntar nada.',
    },
    {
      comando: 'cat',
      titulo: 'Mostrar o conteúdo',
      descricao: 'con<b>cat</b>enate: mostra o conteúdo de um ou mais arquivos, um atrás do outro.',
      sintaxe: 'cat [-n] arquivo...',
      naPratica: 'Conferir rapidamente uma configuração: <code>cat /etc/hostname</code>, <code>cat /etc/os-release</code> (qual versão do Ubuntu este servidor roda?), <code>cat /etc/resolv.conf</code> (quais DNS ele usa?).',
      opcoes: [['-n', 'numera as linhas']],
      exemplos: [
        { comando: 'cat alunos.txt' },
        { comando: 'cat -n alunos.txt', explicacao: 'com número de linha' },
        { comando: 'cat /etc/hostname /etc/os-release', explicacao: 'dois arquivos seguidos' },
        { comando: 'cat a.txt notas.txt > junto.txt', explicacao: 'junta arquivos num novo' },
      ],
      dicas: ['Arquivo grande? Use <code>less arquivo</code> no Ubuntu real (setas rolam, <kbd>q</kbd> sai), ou <code>head</code>/<code>tail</code>.'],
    },
    {
      comando: 'head / tail',
      titulo: 'Ver o começo ou o fim',
      descricao: '<code>head</code> mostra as primeiras linhas e <code>tail</code>, as últimas. O padrão é 10 linhas.',
      sintaxe: 'head -n N arquivo  |  tail -n N arquivo',
      naPratica: '<code>tail -f /var/log/nginx/error.log</code> talvez seja o comando mais usado por quem cuida de servidor: você deixa rodando e vê os erros aparecendo em tempo real enquanto testa o site. O <code>head</code> serve para espiar arquivos enormes (logs de vários GB, CSVs) sem abrir tudo.',
      opcoes: [['-n 3', 'quantidade de linhas (também vale -3)'], ['tail -f', '(Ubuntu real) acompanha o arquivo crescendo, ótimo para logs']],
      exemplos: [
        { comando: 'head -n 3 alunos.txt', explicacao: 'as 3 primeiras' },
        { comando: 'tail -n 2 alunos.txt', explicacao: 'as 2 últimas' },
        { comando: 'tail -1 /etc/passwd', explicacao: 'o último usuário criado fica no fim do passwd' },
      ],
    },
    {
      comando: 'grep',
      titulo: 'Procurar texto dentro de arquivos',
      descricao: 'Mostra só as linhas que contêm um texto. Combinado com <code>|</code> (pipe), filtra a saída de qualquer comando.',
      sintaxe: 'grep [opções] "texto" arquivo...  |  comando | grep "texto"',
      naPratica: 'Achar um erro no meio de milhões de linhas: <code>grep -i error /var/log/syslog</code>. Ver quem tentou invadir por SSH: <code>grep "Failed password" /var/log/auth.log</code>. Checar se uma opção está ativa: <code>grep -n PermitRootLogin /etc/ssh/sshd_config</code>.',
      opcoes: [
        ['-i', 'ignora maiúsculas/minúsculas'],
        ['-v', 'inverte: linhas que NÃO têm o texto'],
        ['-n', 'mostra o número da linha'],
        ['-c', 'só conta quantas linhas bateram'],
      ],
      exemplos: [
        { comando: 'grep Linux alunos.txt' },
        { comando: 'grep -c Linux alunos.txt', explicacao: 'quantos alunos de Linux' },
        { comando: 'grep -in redes alunos.txt', explicacao: 'sem diferenciar maiúsculas, com número da linha' },
        { comando: 'cat /etc/passwd | grep bash', explicacao: 'pipe: quem usa o bash como shell' },
        { comando: 'ls -l /etc | grep shadow' },
      ],
    },
    {
      comando: 'wc',
      titulo: 'Contar linhas, palavras e bytes',
      descricao: '<b>w</b>ord <b>c</b>ount. Muito usado com pipe para contar resultados.',
      sintaxe: 'wc [-l] [-w] [-c] arquivo',
      naPratica: 'Contar acessos a uma página: <code>grep "GET /login" access.log | wc -l</code>. Saber quantas contas o servidor tem: <code>wc -l /etc/passwd</code>. Monitorar uma fila: <code>ls /var/spool/fila | wc -l</code>.',
      opcoes: [['-l', 'linhas'], ['-w', 'palavras'], ['-c', 'bytes']],
      exemplos: [
        { comando: 'wc alunos.txt', explicacao: 'linhas, palavras, bytes' },
        { comando: 'wc -l /etc/passwd', explicacao: 'quantas contas existem' },
        { comando: 'ls /etc | wc -l', explicacao: 'quantos itens há no /etc' },
      ],
    },
    {
      comando: 'cp',
      titulo: 'Copiar',
      descricao: '<b>c</b>o<b>p</b>y: copia arquivos. O original continua lá. Para copiar <b>diretórios</b> precisa de <code>-r</code>.',
      sintaxe: 'cp [opções] origem destino  |  cp origem... pasta/',
      naPratica: 'Regra de ouro antes de editar configuração: faça uma cópia. <code>cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak</code>. Se a alteração derrubar o serviço, basta copiar de volta. O <code>cp -r</code> duplica a pasta de um site antes de uma atualização arriscada.',
      opcoes: [
        ['-r', 'recursivo: copia diretórios inteiros'],
        ['-v', 'mostra cada cópia'],
        ['-i', '(Ubuntu real) pergunta antes de sobrescrever'],
        ['-p', '(Ubuntu real) preserva dono, permissões e datas'],
      ],
      exemplos: [
        { comando: 'cp alunos.txt alunos.bak', explicacao: 'cópia com outro nome' },
        { comando: 'mkdir backup' },
        { comando: 'cp -v a.txt b.txt backup/', explicacao: 'vários arquivos para dentro de uma pasta' },
        { comando: 'cp backup copia', explicacao: 'ERRO: diretório precisa de -r' },
        { comando: 'cp -r backup copia', explicacao: 'agora sim' },
        { comando: 'ls copia' },
      ],
      pegadinha: 'Se o destino já existe, o <code>cp</code> <b>sobrescreve sem perguntar</b> (a menos que use <code>-i</code>).',
    },
    {
      comando: 'mv',
      titulo: 'Mover e renomear',
      descricao: '<b>m</b>o<b>v</b>e: move para outro lugar. No Linux <b>não existe comando "renomear"</b>: renomear é "mover para outro nome" no mesmo lugar.',
      sintaxe: 'mv origem destino',
      naPratica: 'Rotação manual de log: <code>mv app.log app.log.1</code> e o serviço começa um arquivo novo. Desativar um site sem apagar: <code>mv site.conf site.conf.desativado</code>. Publicar uma versão nova trocando a pasta antiga pela nova com um <code>mv</code>.',
      opcoes: [['-v', 'mostra o que foi feito'], ['-i', '(Ubuntu real) pergunta antes de sobrescrever']],
      exemplos: [
        { comando: 'mv c.txt c-renomeado.txt', explicacao: 'RENOMEAR' },
        { comando: 'mv -v c-renomeado.txt backup/', explicacao: 'MOVER para dentro da pasta' },
        { comando: 'mv copia copia-antiga', explicacao: 'também serve para diretórios (sem -r)' },
        { comando: 'ls -R', explicacao: 'confere tudo, recursivamente' },
      ],
      dicas: ['Diferente do <code>cp</code>, o <code>mv</code> move diretórios sem precisar de <code>-r</code>.'],
    },
    {
      comando: 'ln -s',
      titulo: 'Atalhos: links simbólicos',
      descricao: 'Um <b>link simbólico</b> é um atalho: um arquivo que só guarda o caminho de outro. No <code>ls -l</code> ele aparece com <b>l</b> no começo e uma seta <code>nome -&gt; destino</code>. ' +
        'Apagar o link não apaga o original; apagar o original deixa o link "quebrado".',
      sintaxe: 'ln -s DESTINO NOME_DO_LINK',
      opcoes: [['-s', 'simbólico (o mais usado)'], ['-f', 'substitui se o link já existir'], ['-v', 'mostra o que fez']],
      exemplos: [
        { comando: 'ln -s /var/log/syslog log-do-sistema', explicacao: 'atalho para um arquivo longe daqui' },
        { comando: 'ls -l log-do-sistema', explicacao: 'l no começo e a seta mostrando o destino' },
        { comando: 'tail -2 log-do-sistema', explicacao: 'usar o link = usar o arquivo original' },
        { comando: 'rm log-do-sistema', explicacao: 'apaga só o atalho' },
        { comando: 'ls -l /var/log/syslog', explicacao: 'o original continua lá' },
        { comando: 'ls -l / | grep bin', explicacao: 'o próprio sistema usa links: bin -> usr/bin' },
      ],
      pegadinha: 'A ordem é <code>ln -s ORIGEM NOME</code>, igual ao <code>cp</code>: primeiro o que já existe, depois o nome novo.',
      naPratica: 'O nginx ativa sites com links: o arquivo fica em <code>sites-available</code> e um <code>ln -s</code> em <code>sites-enabled</code> liga o site. ' +
        'Em deploys, <code>/srv/app/current</code> é um link para a versão atual: trocar de versão (ou voltar) é só refazer o link.',
    },
    {
      comando: 'nano',
      titulo: 'Editor simples',
      descricao: 'O editor mais amigável do terminal: abre e você já digita. Os atalhos ficam no rodapé; <code>^</code> significa <kbd>Ctrl</kbd>.',
      sintaxe: 'nano arquivo',
      naPratica: 'Não existe interface gráfica num servidor: toda configuração é editada no terminal. <code>sudo nano /etc/ssh/sshd_config</code>, <code>sudo nano /etc/hosts</code>. O nano é o editor padrão do Ubuntu e o mais amigável para ajustes rápidos.',
      opcoes: [
        ['Ctrl+O', 'grava (o nano pergunta o nome: <kbd>Enter</kbd> confirma)'],
        ['Ctrl+X', 'sai (se houver alteração, pergunta se quer salvar: S/N)'],
        ['Ctrl+K / Ctrl+U', 'recorta a linha / cola'],
      ],
      exemplos: [
        { comando: 'nano lista.txt', explicacao: 'digite algo, Ctrl+O, Enter, Ctrl+X (o roteiro espera você sair)' },
        { comando: 'cat lista.txt', explicacao: 'confere o que foi gravado' },
      ],
      dicas: ['Se o arquivo não existe, o nano cria na hora de gravar. Sem permissão de escrita, ele avisa <i>Permissão negada</i> ao gravar.'],
    },
    {
      comando: 'vim',
      titulo: 'Editor modal',
      descricao: 'O vim tem <b>modos</b>. Ele abre no modo <b>NORMAL</b> (as teclas são comandos, não texto). ' +
        'Aperte <kbd>i</kbd> para o modo <b>INSERÇÃO</b> e digitar; <kbd>Esc</kbd> volta ao NORMAL; <kbd>:</kbd> abre a linha de comando.',
      sintaxe: 'vim arquivo',
      naPratica: 'O vi/vim existe em praticamente todo Linux, inclusive servidores mínimos e containers onde o nano não está instalado. Saber pelo menos <code>i</code>, <code>Esc</code>, <code>:wq</code> e <code>:q!</code> salva você quando precisar editar algo numa máquina desconhecida.',
      opcoes: [
        ['i / a / o', 'inserir antes do cursor / depois / em nova linha abaixo'],
        ['Esc', 'volta para o modo NORMAL'],
        [':w', 'grava'],
        [':q', 'sai (recusa se houver alteração não gravada)'],
        [':wq  ou  :x', 'grava e sai'],
        [':q!', 'sai SEM gravar (descarta alterações)'],
        ['dd / x', 'apaga a linha / apaga um caractere (no modo NORMAL)'],
      ],
      exemplos: [
        { comando: 'vim ideias.txt', explicacao: 'i, digite, Esc, :wq, Enter (o roteiro espera você sair)' },
        { comando: 'cat ideias.txt' },
      ],
      pegadinha: '"Não consigo sair do vim": aperte <kbd>Esc</kbd> e digite <code>:q!</code> + <kbd>Enter</kbd> (sai sem salvar) ou <code>:wq</code> (salva e sai).',
    },
  ],

  desafios: [
    {
      id: 'arq-1',
      enunciado: 'Crie o arquivo <code>/root/aula/prova.txt</code> contendo exatamente a linha <code>Linux é demais</code>.',
      dica: 'echo com aspas e o redirecionamento que cria/sobrescreve.',
      solucao: [{ comando: 'echo "Linux é demais" > /root/aula/prova.txt' }],
      verificar: (m) => Verificar.conteudo(m, '/root/aula/prova.txt')?.trim() === 'Linux é demais',
    },
    {
      id: 'arq-2',
      enunciado: 'Acrescente uma <b>segunda linha</b> <code>aprovado</code> ao <code>prova.txt</code> sem apagar a primeira.',
      dica: 'São dois sinais de maior.',
      solucao: [{ comando: 'echo "aprovado" >> /root/aula/prova.txt' }],
      verificar: (m) => {
        const linhas: string[] = (Verificar.conteudo(m, '/root/aula/prova.txt') ?? '').trim().split('\n');
        return linhas.length >= 2 && linhas[0] === 'Linux é demais' && linhas.includes('aprovado');
      },
    },
    {
      id: 'arq-3',
      enunciado: 'Crie <code>/root/aula/linux.txt</code> contendo <b>somente</b> as linhas de <code>alunos.txt</code> que têm a palavra <code>Linux</code>.',
      dica: 'grep + redirecionamento: <code>grep ... &gt; ...</code>',
      solucao: [{ comando: 'grep Linux /root/aula/alunos.txt > /root/aula/linux.txt' }],
      verificar: (m) => {
        const texto: string = Verificar.conteudo(m, '/root/aula/linux.txt') ?? '';
        const linhas: string[] = texto.trim().split('\n');
        return linhas.length === 6 && linhas.every((l: string) => l.includes('Linux'));
      },
    },
    {
      id: 'arq-4',
      enunciado: 'Faça uma cópia de <code>alunos.txt</code> chamada <code>alunos-2026.txt</code> dentro de uma nova pasta <code>/root/aula/arquivo-morto</code>.',
      dica: 'Primeiro mkdir, depois cp origem destino/novo-nome.',
      solucao: [{ comando: 'mkdir -p /root/aula/arquivo-morto' }, { comando: 'cp /root/aula/alunos.txt /root/aula/arquivo-morto/alunos-2026.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/aula/arquivo-morto/alunos-2026.txt', 'Ana;Linux') && Verificar.arquivo(m, '/root/aula/alunos.txt'),
    },
    {
      id: 'arq-5',
      enunciado: 'Renomeie <code>/root/aula/alunos.txt</code> para <code>turma.txt</code> (na mesma pasta).',
      dica: 'Renomear = mv.',
      solucao: [{ comando: 'mv /root/aula/alunos.txt /root/aula/turma.txt' }],
      verificar: (m) => Verificar.arquivo(m, '/root/aula/turma.txt') && Verificar.naoExiste(m, '/root/aula/alunos.txt'),
    },
    {
      id: 'arq-6',
      enunciado: 'Usando o <b>nano</b> ou o <b>vim</b>, crie <code>/root/aula/editado.txt</code> com a palavra <code>pronto</code>.',
      dica: 'nano: digite, Ctrl+O, Enter, Ctrl+X. vim: i, digite, Esc, :wq, Enter.',
      solucao: [{ comando: 'nano /root/aula/editado.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/aula/editado.txt', 'pronto'),
    },
  ],
};
