import type { Topico } from './Topico';
import { Verificar } from './Verificar';
import { GerenciadorDePacotes, Servicos } from '../linux/Pacotes';

/** 09 · Simulado: tarefas encadeadas no estilo da prova prática, misturando todos os tópicos. */
export const simulado: Topico = {
  id: 'simulado',
  numero: 9,
  titulo: 'Simulado de prova',
  subtitulo: 'Um cenário completo, do zero, misturando todos os tópicos',
  icone: '📝',
  cor: '--cor-sim',
  resumo: 'Monte o servidor de uma escola: pastas, arquivos, usuários, grupos e permissões. Conferência automática.',
  conceitos: '',

  preparar(): void {
    // servidor limpo: só root e ricardo
  },

  licoes: [],

  desafios: [
    {
      id: 'sim-1',
      enunciado: 'Crie a estrutura <code>/srv/escola/docs</code>, <code>/srv/escola/scripts</code> e <code>/srv/escola/publico</code>.',
      dica: 'mkdir -p aceita vários caminhos no mesmo comando.',
      solucao: [{ comando: 'mkdir -p /srv/escola/docs /srv/escola/scripts /srv/escola/publico' }],
      verificar: (m) => ['docs', 'scripts', 'publico'].every((p: string) => Verificar.diretorio(m, '/srv/escola/' + p)),
    },
    {
      id: 'sim-2',
      enunciado: 'Crie <code>/srv/escola/docs/regras.txt</code> com duas linhas: <code>Prova de Linux</code> e <code>Sem consulta</code>.',
      dica: 'Um echo com &gt; e outro com &gt;&gt;, ou o nano.',
      solucao: [
        { comando: 'echo "Prova de Linux" > /srv/escola/docs/regras.txt' },
        { comando: 'echo "Sem consulta" >> /srv/escola/docs/regras.txt' },
      ],
      verificar: (m) => {
        const linhas: string[] = (Verificar.conteudo(m, '/srv/escola/docs/regras.txt') ?? '').trim().split('\n');
        return linhas.length === 2 && linhas[0].trim() === 'Prova de Linux' && linhas[1].trim() === 'Sem consulta';
      },
    },
    {
      id: 'sim-3',
      enunciado: 'Crie o grupo <code>professores</code> e o grupo <code>alunos</code>.',
      dica: 'groupadd, um de cada vez.',
      solucao: [{ comando: 'groupadd professores' }, { comando: 'groupadd alunos' }],
      verificar: (m) => Verificar.grupo(m, 'professores') !== undefined && Verificar.grupo(m, 'alunos') !== undefined,
    },
    {
      id: 'sim-4',
      enunciado: 'Crie a usuária <code>sediane</code> (com home e bash), no grupo <code>professores</code>, com senha definida.',
      dica: 'useradd -m -s /bin/bash -G professores sediane, depois passwd sediane.',
      solucao: [
        { comando: 'useradd -m -s /bin/bash -G professores sediane' },
        { comando: 'passwd sediane', respostas: ['123', '123'] },
      ],
      verificar: (m) => Verificar.membro(m, 'sediane', 'professores') && Verificar.diretorio(m, '/home/sediane') &&
        (Verificar.usuario(m, 'sediane')?.senha ?? null) !== null,
    },
    {
      id: 'sim-5',
      enunciado: 'Crie os usuários <code>ana</code> e <code>beto</code> (com home e bash), ambos no grupo <code>alunos</code>, com senha.',
      dica: 'Repita o que fez no item anterior, trocando o grupo.',
      solucao: [
        { comando: 'useradd -m -s /bin/bash -G alunos ana' },
        { comando: 'passwd ana', respostas: ['123', '123'] },
        { comando: 'useradd -m -s /bin/bash -G alunos beto' },
        { comando: 'passwd beto', respostas: ['123', '123'] },
      ],
      verificar: (m) => ['ana', 'beto'].every((u: string) => Verificar.membro(m, u, 'alunos') && Verificar.diretorio(m, '/home/' + u) &&
        (Verificar.usuario(m, u)?.senha ?? null) !== null),
    },
    {
      id: 'sim-6',
      enunciado: 'A pasta <code>/srv/escola/docs</code> deve pertencer à <code>sediane</code> e ao grupo <code>professores</code>, com acesso total para dono e grupo e <b>nenhum</b> para os outros.',
      dica: 'chown sediane:professores e chmod 770.',
      solucao: [{ comando: 'chown -R sediane:professores /srv/escola/docs' }, { comando: 'chmod 770 /srv/escola/docs' }],
      verificar: (m) => Verificar.dono(m, '/srv/escola/docs', 'sediane', 'professores') && Verificar.modo(m, '/srv/escola/docs', 0o770),
    },
    {
      id: 'sim-7',
      enunciado: 'Crie o script <code>/srv/escola/scripts/boasvindas.sh</code> com a linha <code>echo Bem-vindo</code> e deixe-o com permissão <code>755</code>. Rode-o com <code>./</code>.',
      dica: 'echo "echo Bem-vindo" &gt; arquivo, chmod 755 arquivo, e execute com o caminho: /srv/escola/scripts/boasvindas.sh',
      solucao: [
        { comando: 'echo "echo Bem-vindo" > /srv/escola/scripts/boasvindas.sh' },
        { comando: 'chmod 755 /srv/escola/scripts/boasvindas.sh' },
        { comando: '/srv/escola/scripts/boasvindas.sh' },
      ],
      verificar: (m) => Verificar.modo(m, '/srv/escola/scripts/boasvindas.sh', 0o755) && Verificar.contem(m, '/srv/escola/scripts/boasvindas.sh', 'echo'),
    },
    {
      id: 'sim-8',
      enunciado: 'Em <code>/srv/escola/publico</code> todos devem poder criar arquivos, mas ninguém pode apagar o arquivo de outra pessoa.',
      dica: 'Sticky bit.',
      solucao: [{ comando: 'chmod 1777 /srv/escola/publico' }],
      verificar: (m) => Verificar.no(m, '/srv/escola/publico')?.modo === 0o1777,
    },
    {
      id: 'sim-9',
      enunciado: 'Logada como <code>ana</code> em outro terminal, crie <code>/srv/escola/publico/trabalho-ana.txt</code>. Depois confirme que ela <b>não</b> consegue ler <code>/srv/escola/docs</code>.',
      dica: 'Botão ＋ → login ana → touch no publico → ls /srv/escola/docs (deve dar Permissão negada).',
      solucao: [
        { comando: 'touch /srv/escola/publico/trabalho-ana.txt', terminal: 2, login: { usuario: 'ana', senha: '123' } },
        { comando: 'ls /srv/escola/docs', terminal: 2 },
      ],
      verificar: (m) => Verificar.dono(m, '/srv/escola/publico/trabalho-ana.txt', 'ana'),
    },
    {
      id: 'sim-10',
      enunciado: 'Copie <code>regras.txt</code> para a home da <code>ana</code> e faça com que ela seja a dona da cópia.',
      dica: 'cp origem /home/ana/ e depois chown ana /home/ana/regras.txt.',
      solucao: [
        { comando: 'cp /srv/escola/docs/regras.txt /home/ana/' },
        { comando: 'chown ana:ana /home/ana/regras.txt' },
      ],
      verificar: (m) => Verificar.dono(m, '/home/ana/regras.txt', 'ana') && Verificar.contem(m, '/home/ana/regras.txt', 'Prova de Linux'),
    },
    {
      id: 'sim-apt-1',
      enunciado: 'Atualize a lista de pacotes e instale as atualizações pendentes do servidor.',
      dica: 'apt update e depois apt upgrade -y.',
      solucao: [{ comando: 'apt update' }, { comando: 'apt upgrade -y' }],
      verificar: (m) => { const g = new GerenciadorDePacotes(m); return g.listasAtualizadas() && g.atualizaveis().length === 0; },
    },
    {
      id: 'sim-apt-2',
      enunciado: 'Instale o servidor web <code>nginx</code> e faça a página inicial (<code>/var/www/html/index.html</code>) mostrar <code>Escola Linux</code>. O serviço precisa estar rodando.',
      dica: 'apt install -y nginx; echo "Escola Linux" &gt; /var/www/html/index.html; confira com curl localhost.',
      solucao: [
        { comando: 'apt install -y nginx' },
        { comando: 'echo "Escola Linux" > /var/www/html/index.html' },
        { comando: 'curl localhost' },
      ],
      verificar: (m) => new Servicos(m).ativo('nginx') && Verificar.contem(m, '/var/www/html/index.html', 'Escola Linux'),
    },
    {
      id: 'sim-11',
      enunciado: 'O <code>beto</code> trancou o curso: remova o usuário e a pasta pessoal dele.',
      dica: 'userdel -r.',
      solucao: [{ comando: 'userdel -r beto' }],
      verificar: (m) => Verificar.usuario(m, 'ana') !== undefined && Verificar.usuario(m, 'beto') === undefined && Verificar.naoExiste(m, '/home/beto'),
    },
    {
      id: 'sim-12',
      enunciado: 'Por fim, apague a pasta <code>/srv/escola/scripts</code> inteira.',
      dica: 'rm com recursivo.',
      solucao: [{ comando: 'rm -r /srv/escola/scripts' }],
      verificar: (m) => Verificar.naoExiste(m, '/srv/escola/scripts') && Verificar.diretorio(m, '/srv/escola/docs'),
    },
  ],
};
