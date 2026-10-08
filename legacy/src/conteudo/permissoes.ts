import type { Topico } from './Topico';
import type { Maquina } from '../linux/Maquina';
import { Verificar } from './Verificar';

/** 06 · Segurança de acesso: ler permissões, chmod, chown, chgrp, umask e testes com outros usuários. */
export const permissoes: Topico = {
  id: 'permissoes',
  numero: 6,
  titulo: 'Permissões e segurança de acesso',
  subtitulo: 'ls -l · chmod · chown · chgrp · sudo (superusuário) · umask · sticky bit',
  icone: '🔐',
  cor: '--cor-perm',
  resumo: 'Quem pode ler, escrever e executar: rwx, 775/755/644, dono e grupo, superadministradores (sudo) e testando com usuários diferentes.',
  conceitos:
    '<div class="video-recomendado">' +
    '  <div class="video-recomendado-topo">' +
    '    <div class="video-recomendado-titulo">' +
    '      <span class="video-badge">📺 Vídeo Recomendado</span>' +
    '      <span>Guia Prático: Como Funcionam as Permissões no Linux</span>' +
    '    </div>' +
    '    <a class="video-recomendado-link" href="https://www.youtube.com/watch?v=sq6pd18X63Q" target="_blank" rel="noopener">' +
    '      ▶ Assistir aula no YouTube' +
    '    </a>' +
    '  </div>' +
    '  <p class="video-recomendado-desc">' +
    '    O vídeo do canal é o guia mais simples e prático para entender permissões no Linux sem complicação. ' +
    '    Esta aula foi estruturada seguindo exatamente o mesmo modelo mental e os 4 tópicos fundamentais apresentados no vídeo:' +
    '  </p>' +
    '  <div class="video-roteiro-grade">' +
    '    <div class="video-roteiro-item">' +
    '      <span class="video-tempo-tag">01:45</span>' +
    '      <span><b>1. Entidades do Sistema:</b> Usuários humanos vs processos em background e grupos (/etc/passwd e /etc/group).</span>' +
    '    </div>' +
    '    <div class="video-roteiro-item">' +
    '      <span class="video-tempo-tag">03:33</span>' +
    '      <span><b>2. Leitura do <code>ls -l</code>:</b> O caractere de tipo (<code>-</code>, <code>d</code>, <code>l</code>) e os 3 blocos (Dono, Grupo, Outros).</span>' +
    '    </div>' +
    '    <div class="video-roteiro-item">' +
    '      <span class="video-tempo-tag">06:21</span>' +
    '      <span><b>3. Significado de RWX:</b> Leitura, escrita e execução em arquivos e pastas.</span>' +
    '    </div>' +
    '    <div class="video-roteiro-item">' +
    '      <span class="video-tempo-tag">08:05</span>' +
    '      <span><b>4. Gerenciamento <code>chmod</code>:</b> Método numérico (soma binária, destaque do <code>775</code>) e literal.</span>' +
    '    </div>' +
    '  </div>' +
    '</div>' +

    '<h3>👥 1. Entidades do Sistema: Quem acessa o quê?</h3>' +
    '<p>No Linux, toda permissão responde a uma pergunta direta: <i>"Quem tem autorização para interagir com este arquivo ou pasta?"</i>. O sistema organiza os acessos em duas entidades essenciais:</p>' +

    '<div class="perm-comparativo">' +
    '  <div class="perm-card-entidade">' +
    '    <h4>👤 Usuários</h4>' +
    '    <p><b>• Humanos:</b> Pessoas reais que utilizam o computador. Dividem-se em <i>usuários comuns</i> (que operam em suas próprias pastas pessoais sem risco de quebrar o sistema) e o administrador supremo <code>root</code> (UID 0), que possui privilégios irrestritos.</p>' +
    '    <p><b>• Usuários do Sistema:</b> Contas criadas automaticamente para rodar processos e daemons em background (como <code>www-data</code> para servidores web, <code>daemon</code>, <code>nobody</code>). Eles <b>não</b> possuem shell de login nem senha humana. Isso é uma blindagem vital de segurança: se um serviço for atacado, o invasor não ganha acesso total à máquina!</p>' +
    '  </div>' +
    '  <div class="perm-card-entidade">' +
    '    <h4>👥 Grupos</h4>' +
    '    <p>Agrupamentos de usuários que tornam a gestão de acessos rápida e colaborativa.</p>' +
    '    <p>Em vez de configurar permissões individuais para dezenas de colaboradores um a um, cria-se um grupo (ex: <code>financeiro</code> ou <code>devs</code>). Quem for adicionado ao grupo herda instantaneamente as permissões dele.</p>' +
    '  </div>' +
    '</div>' +

    '<p><b>Onde essas informações ficam gravadas?</b> Dois arquivos fundamentais de texto em <code>/etc</code> guardam esse mapa:</p>' +
    '<ul class="lista-simples">' +
    '  <li><code>📄 /etc/passwd</code>: O cadastro oficial de todas as contas do sistema (login, UID, GID padrão, pasta home e shell).</li>' +
    '  <li><code>📄 /etc/group</code>: A lista de todos os grupos existentes e quais usuários pertencem a cada um.</li>' +
    '</ul>' +

    '<div class="perm-sudo-guia">' +
    '  <div class="perm-sudo-topo">' +
    '    <div class="perm-sudo-titulo">' +
    '      <span class="perm-sudo-badge">👑 Superusuário</span>' +
    '      <span>Como Conceder Privilégios de Superadministrador (sudo)</span>' +
    '    </div>' +
    '  </div>' +
    '  <p class="perm-sudo-desc">' +
    '    Para conceder privilégios de superusuário (sudo) a um usuário no Linux, adicione-o ao grupo administrativo correspondente à distribuição que você está utilizando.' +
    '  </p>' +
    '  <div class="perm-passos-lista">' +
    '    <div class="perm-passo-item">' +
    '      <div class="perm-passo-header">' +
    '        <span class="perm-passo-num">1</span>' +
    '        <b>Acessar como root ou com usuário administrador:</b>' +
    '      </div>' +
    '      <p class="perm-passo-texto">' +
    '        Se já estiver logado com um usuário com permissão de <code>sudo</code>, execute os comandos abaixo usando <code>sudo</code>. Caso contrário, alterne para o usuário <code>root</code>:' +
    '      </p>' +
    '      <div class="perm-code-bloco"><code>su -</code></div>' +
    '      <div class="perm-verificacao-bloco">' +
    '        <span>🔍 Para verificar se o comando funcionou, execute <code>whoami</code>. O retorno deve ser <code>root</code>.</span>' +
    '      </div>' +
    '    </div>' +
    '    <div class="perm-passo-item">' +
    '      <div class="perm-passo-header">' +
    '        <span class="perm-passo-num">2</span>' +
    '        <b>Adicionar o usuário ao grupo sudo:</b>' +
    '      </div>' +
    '      <p class="perm-passo-texto">Substitua <code>nome_do_usuario</code> pelo login do usuário desejado:</p>' +
    '      <div class="perm-distros-grid">' +
    '        <div class="perm-distro-card">' +
    '          <span class="perm-distro-tag">🐧 Debian, Ubuntu e derivados:</span>' +
    '          <div class="perm-code-bloco"><code>usermod -aG sudo nome_do_usuario</code></div>' +
    '        </div>' +
    '        <div class="perm-distro-card">' +
    '          <span class="perm-distro-tag">🎩 RHEL, CentOS, Fedora, AlmaLinux e Rocky Linux:</span>' +
    '          <div class="perm-code-bloco"><code>usermod -aG wheel nome_do_usuario</code></div>' +
    '        </div>' +
    '        <div class="perm-distro-card">' +
    '          <span class="perm-distro-tag">🏹 Arch Linux:</span>' +
    '          <div class="perm-code-bloco"><code>usermod -aG wheel nome_do_usuario</code></div>' +
    '          <p class="perm-distro-nota">*(No Arch, confirme se o grupo <code>%wheel</code> está descomentado no arquivo de configuração executando <code>visudo</code>)*.</p>' +
    '        </div>' +
    '      </div>' +
    '      <div class="perm-verificacao-bloco">' +
    '        <span>🔍 Para verificar se a alteração foi aplicada, consulte os grupos do usuário:</span>' +
    '        <div class="perm-code-bloco" style="margin: 6px 0;"><code>groups nome_do_usuario</code></div>' +
    '        <span>O grupo <code>sudo</code> ou <code>wheel</code> deve constar na listagem.</span>' +
    '      </div>' +
    '    </div>' +
    '    <div class="perm-passo-item">' +
    '      <div class="perm-passo-header">' +
    '        <span class="perm-passo-num">3</span>' +
    '        <b>Validar o acesso:</b>' +
    '      </div>' +
    '      <p class="perm-passo-texto">' +
    '        Faça logout e login novamente com a conta modificada (ou use <code>su - nome_do_usuario</code>) para recarregar as permissões do grupo. Em seguida, teste a execução de um comando privilegiado:' +
    '      </p>' +
    '      <div class="perm-code-bloco"><code>sudo whoami</code></div>' +
    '      <div class="perm-verificacao-bloco">' +
    '        <span>✅ Para confirmar que a etapa foi bem-sucedida, o terminal deve solicitar a senha do próprio usuário e retornar <code>root</code>.</span>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +

    '  <div class="perm-curiosidades-secao">' +
    '    <div class="perm-curiosidades-titulo">💡 Curiosidades Históricas e do Dia a Dia do Superusuário</div>' +
    '    <div class="perm-curiosidades-grade">' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🎡</span><b>Por que "wheel" no Red Hat e Arch?</b></div>' +
    '        <p>Nos anos 1970/80 nos sistemas TENEX e BSD Unix, surgiu a gíria <i>"big wheel"</i> (referindo-se a alguém influente ou autoridade máxima). O grupo com permissão para virar root foi batizado de <code>wheel</code>. Distros como RHEL, Fedora e Arch preservam essa tradição clássica Unix!</p>' +
    '      </div>' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🧙</span><b>O que significa a sigla SUDO?</b></div>' +
    '        <p>Criado em 1980 na Universidade de Buffalo, <code>sudo</code> significava originalmente <b>"SuperUser DO"</b>. Com a adição da flag <code>-u</code> (que permite rodar comandos como qualquer usuário), passou a significar também <b>"Substitute User DO"</b>.</p>' +
    '      </div>' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🦸</span><b>As 3 Regras de Ouro e o Homem-Aranha</b></div>' +
    '        <p>No primeiro uso do <code>sudo</code> no terminal, o sistema exibe: <i>1) Respeite a privacidade alheia; 2) Pense antes de digitar; 3) Com grandes poderes vêm grandes responsabilidades</i>. Uma célebre lição de ética imortalizada nas HQs e discursos históricos!</p>' +
    '      </div>' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🎭</span><b>O Easter Egg dos Insultos</b></div>' +
    '        <p>No <code>/etc/sudoers</code>, se você adicionar a linha <code>Defaults insults</code>, o sudo fará piadas sarcásticas e bem-humoradas (inspiradas em Monty Python e no Guia do Mochileiro das Galáxias) caso você erre a sua senha!</p>' +
    '      </div>' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🛡️</span><b>Por que existe o comando visudo?</b></div>' +
    '        <p>Se você editar o <code>/etc/sudoers</code> com um editor comum e errar uma única vírgula, o <code>sudo</code> entra em pane e <b>ninguém mais</b> consegue virar root! O <code>visudo</code> trava o arquivo para edição concorrente e valida a sintaxe antes de aplicar.</p>' +
    '      </div>' +
    '      <div class="perm-curiosidade-card">' +
    '        <div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">👁️</span><b>Por que a senha não exibe asteriscos?</b></div>' +
    '        <p>O terminal oculta a digitação contra <i>shoulder surfing</i> (olhares curiosos espiando por cima do ombro), impedindo que descubram o tamanho da senha. Se quiser exibir asteriscos, pode ativar <code>Defaults pwfeedback</code> no <code>/etc/sudoers</code>.</p>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '</div>' +

    '<h3>🔍 2. Leitura do Comando <code>ls -l</code></h3>' +
    '<p>Ao rodar o comando <code>ls -l</code>, a primeira coluna com 10 caracteres revela o tipo de objeto e toda a política de permissões dele:</p>' +

    '<div class="perm-bloco">' +
    '  <div class="perm-bloco-titulo">📋 A Regra dos 10 Caracteres (1 de tipo + 3 blocos de permissões)</div>' +
    '  <pre class="anatomia-linha" style="margin: 6px 0 10px;"><span class="an-tipo">-</span> <span class="an-dono">r w x</span> <span class="an-grupo">r - x</span> <span class="an-outros">r - -</span></pre>' +
    '  <ul class="lista-simples" style="margin:0; font-size:13.5px;">' +
    '    <li><b>1º caractere (Tipo de objeto):</b> <code>-</code> para arquivo comum, <code>d</code> para diretório (pasta) e <code>l</code> para link simbólico (atalho).</li>' +
    '    <li><b>Caracteres 2 a 4 — Bloco do Usuário Dono (<code>u</code>):</b> Permissões exclusivas de quem é dono do arquivo.</li>' +
    '    <li><b>Caracteres 5 a 7 — Bloco do Grupo (<code>g</code>):</b> Permissões dos membros do grupo proprietário do arquivo.</li>' +
    '    <li><b>Caracteres 8 a 10 — Bloco dos Outros (<code>o</code>):</b> Permissões de todo o restante do mundo (outros usuários).</li>' +
    '  </ul>' +
    '</div>' +

    '<h3>🔑 3. O Significado de RWX (Read, Write, Execute)</h3>' +
    '<p>Cada um dos três blocos é composto pelas permissões fundamentais <b>r</b>, <b>w</b> e <b>x</b> (ou um traço <code>-</code> quando o acesso correspondente está desativado):</p>' +

    '<table class="tabela">' +
    '  <tr><th>Letra</th><th>Nome</th><th>O que faz num ARQUIVO</th><th>O que faz num DIRETÓRIO (PASTA)</th><th>Valor</th></tr>' +
    '  <tr><td><b>r</b></td><td>Read (Leitura)</td><td>Visualizar/ler o conteúdo (cat, less, nano)</td><td>Listar os arquivos internos (ls)</td><td><b>4</b></td></tr>' +
    '  <tr><td><b>w</b></td><td>Write (Escrita)</td><td>Modificar, alterar ou sobrescrever o conteúdo</td><td>Criar novos arquivos, renomear ou apagar itens dentro</td><td><b>2</b></td></tr>' +
    '  <tr><td><b>x</b></td><td>Execute (Execução)</td><td>Rodar como programa ou script (ex: <code>./script.sh</code>)</td><td><b>Entrar na pasta (cd)</b> e acessar arquivos internos</td><td><b>1</b></td></tr>' +
    '</table>' +

    '<p class="conceitos-dica">💡 <b>Atenção com o X em pastas:</b> Para apagar um arquivo, você precisa de <code>w</code> na <b>pasta</b> onde ele está. E para abrir qualquer arquivo dentro de uma pasta, você precisa obrigatoriamente do <code>x</code> na pasta para conseguir entrar nela!</p>' +

    '<h3>⚙️ 4. Gerenciamento via <code>chmod</code> (Numérico vs Literal)</h3>' +
    '<p>O comando <code>chmod</code> (<i>change mode</i>) permite alterar essas permissões através de dois métodos:</p>' +

    '<div class="perm-bloco">' +
    '  <div class="perm-bloco-titulo">🔢 Método Numérico (Binário / Octal: 4 = R, 2 = W, 1 = X)</div>' +
    '  <p>O sistema baseia-se em valores binários onde cada permissão tem um peso (potências de 2). A soma dos números define o nível de cada bloco:</p>' +
    '  <p><code>rwx</code> = 4+2+1 = <b>7</b> &nbsp;|&nbsp; <code>rw-</code> = 4+2+0 = <b>6</b> &nbsp;|&nbsp; <code>r-x</code> = 4+0+1 = <b>5</b> &nbsp;|&nbsp; <code>r--</code> = 4+0+0 = <b>4</b> &nbsp;|&nbsp; <code>---</code> = <b>0</b></p>' +
    '  <div class="perm-destaque-775">' +
    '    <b>⭐ O Exemplo <code>chmod 775</code> (Colaboração em Equipe):</b><br>' +
    '    • <b>Dono (7 = 4+2+1 / <code>rwx</code>):</b> O proprietário lê, altera e executa com acesso pleno.<br>' +
    '    • <b>Grupo (7 = 4+2+1 / <code>rwx</code>):</b> A equipe do projeto colabora com total liberdade.<br>' +
    '    • <b>Outros (5 = 4+0+1 / <code>r-x</code>):</b> O restante do mundo apenas consulta e entra, sem alterar nada.' +
    '  </div>' +
    '  <table class="tabela">' +
    '    <tr><th>Código</th><th>Simbólico</th><th>Uso prático clássico</th></tr>' +
    '    <tr><td><code>755</code></td><td><code>rwxr-xr-x</code></td><td>Scripts, executáveis e pastas públicas: todos leem e entram, só o dono altera</td></tr>' +
    '    <tr><td><code>775</code></td><td><code>rwxrwxr-x</code></td><td>Pastas e projetos colaborativos de equipe (dono e grupo com plenos poderes)</td></tr>' +
    '    <tr><td><code>644</code></td><td><code>rw-r--r--</code></td><td>Arquivos comuns de texto/código: todos leem, apenas o dono altera</td></tr>' +
    '    <tr><td><code>600</code></td><td><code>rw-------</code></td><td>Arquivos privados sigilosos (chaves SSH, credenciais, senhas)</td></tr>' +
    '    <tr><td><code>700</code></td><td><code>rwx------</code></td><td>Pastas privadas: somente o dono entra e altera</td></tr>' +
    '    <tr><td><code>770</code></td><td><code>rwxrwx---</code></td><td>Pasta restrita de equipe: dono e grupo fazem tudo, outros não veem nada</td></tr>' +
    '    <tr><td><code>777</code></td><td><code>rwxrwxrwx</code></td><td>Todos fazem tudo: <b>evite ao máximo em servidores</b></td></tr>' +
    '  </table>' +
    '</div>' +

    '<div class="perm-bloco">' +
    '  <div class="perm-bloco-titulo">🔤 Método Literal (Simbólico: Quem + Operação + Permissão)</div>' +
    '  <p>Ideal para ajustar permissões pontuais sem precisar recalcular todo o conjunto octal:</p>' +
    '  <ul class="lista-simples">' +
    '    <li><b>Quem:</b> <code>u</code> (usuário dono), <code>g</code> (grupo), <code>o</code> (outros) ou <code>a</code> (all/todos).</li>' +
    '    <li><b>Operador:</b> <code>+</code> (adiciona), <code>-</code> (retira), <code>=</code> (define exatamente).</li>' +
    '    <li><b>Permissão:</b> <code>r</code> (leitura), <code>w</code> (escrita), <code>x</code> (execução).</li>' +
    '  </ul>' +
    '  <p><b>Exemplos práticos:</b> <code>chmod +x script.sh</code> (torna executável) &nbsp;|&nbsp; <code>chmod g-w relatorio.txt</code> (tira escrita do grupo) &nbsp;|&nbsp; <code>chmod u=rwx,g=rwx,o=rx pasta</code> (o equivalente literal do <code>775</code>!).</p>' +
    '</div>' +

    '<p class="conceitos-dica">💡 <b>Hierarquia de Avaliação:</b> O Linux avalia apenas <b>uma</b> classe na ordem: se você é o dono, valem exclusivamente os bits do dono; senão, se está no grupo, valem os do grupo; senão, os de outros. O <b>root</b> tem poder supremo e ignora todas essas restrições.</p>' +
    '<p>Nesta máquina já existem os usuários <b>maria</b> (grupo <b>financeiro</b>) e <b>joao</b>, ambos com senha <code>123</code>, e a pasta <code>/srv/empresa</code> para você treinar tudo ao vivo.</p>',

  naPratica: 'Permissão errada é uma das maiores causas de problemas e de invasões em servidores. Um <code>.env</code> com a senha do banco legível por todos (644) expõe credenciais; um site com pastas 777 deixa qualquer processo invadido gravar código malicioso. E permissão fechada demais faz o site responder <b>403 Forbidden</b>.',
  demonstracao: [
    { comando: 'tail -n 4 /etc/passwd', explicacao: '1. Entidades: contas de sistema (nobody) e humanos (ricardo, maria, joao)' },
    { comando: 'grep financeiro /etc/group', explicacao: '1. Grupos: consulte o grupo financeiro e quem faz parte dele em /etc/group' },
    { comando: 'ls -l /srv/empresa', explicacao: '2 e 3. Leitura do ls -l e RWX: tipo de arquivo (-/d) e trios Dono, Grupo e Outros' },
    { comando: 'stat -c "%A = %a  dono: %U  grupo: %G" /srv/empresa/salarios.txt', explicacao: '4. chmod numérico vs texto: texto simbólico (rw-r-----) e octal (640)' },
  ],

  preparar(maquina: Maquina): void {
    maquina.criarUsuario('maria', '123', ['financeiro']);
    maquina.criarUsuario('joao', '123');
    maquina.criarDiretorio('/srv/empresa', 0, 0, 0o755);
    maquina.criarDiretorio('/srv/empresa/privado', 0, 0, 0o755);
    maquina.criarArquivo('/srv/empresa/privado/senhas.txt', 'wifi: linux2026\n', 0, 0, 0o644);
    maquina.criarArquivo('/srv/empresa/relatorio.txt', 'Relatório anual: tudo certo.\n', 0, 0, 0o644);
    maquina.criarArquivo('/srv/empresa/script.sh', '#!/bin/bash\necho "Olá do script!"\n', 0, 0, 0o644);
    const financeiro: number = maquina.contas.grupo('financeiro')?.gid ?? 0;
    maquina.criarArquivo('/srv/empresa/salarios.txt', 'maria: R$ 5.000\njoao: R$ 4.000\n', 0, financeiro, 0o640);
  },

  licoes: [
    {
      comando: 'ls -l',
      titulo: 'Ler as permissões',
      descricao: 'O primeiro campo do <code>ls -l</code> é o resumo de 10 caracteres: <b>1 caractere de tipo</b> (<code>-</code> arquivo, <code>d</code> diretório, <code>l</code> link) + <b>3 blocos de permissões</b> (<b>Usuário Dono</b>, <b>Grupo</b> e <b>Outros</b>). Em seguida vêm o número de links, dono, grupo, tamanho, data e nome.',
      sintaxe: 'ls -l arquivo  |  ls -ld diretório  |  stat arquivo',
      naPratica: 'Primeiro passo quando aparece "Permission denied" ou o site dá 403: <code>ls -l /var/www/html</code> para ver dono, grupo e permissões. Quase sempre o culpado é um arquivo que ficou do root em vez do usuário do servidor web (<code>www-data</code>).',
      extra: 'anatomia-ls',
      exemplos: [
        { comando: 'cd /srv/empresa' },
        { comando: 'ls -l', explicacao: 'salarios.txt é do grupo financeiro, com 640' },
        { comando: 'ls -ld privado', explicacao: '-d: a permissão da própria pasta' },
        { comando: 'stat salarios.txt', explicacao: 'mostra em número (0640) e em texto' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> O primeiro caractere indica o tipo: <code>-</code> (arquivo regular), <code>d</code> (diretório), <code>l</code> (link simbólico), <code>c</code> (caractere), <code>b</code> (bloco). Seguem os trios: Dono (u), Grupo (g) e Outros (o).',
      ],
    },
    {
      comando: 'chmod (letras)',
      titulo: 'Mudar permissões no modo literal (simbólico)',
      descricao: 'O <b>Método Literal</b> especifica <b>quem</b> (<code>u</code> = dono, <code>g</code> = grupo, <code>o</code> = outros ou <code>a</code> = todos/all), a <b>operação</b> (<code>+</code> adiciona, <code>-</code> retira, <code>=</code> fixa exatamente) e <b>quais permissões</b> (<code>r</code>, <code>w</code>, <code>x</code>).',
      sintaxe: 'chmod [ugoa][+-=][rwx] arquivo',
      naPratica: 'Tornar executável um script de backup recém-criado: <code>chmod +x backup.sh</code>. Tirar a leitura dos outros num arquivo com senhas: <code>chmod o-r .env</code>. O modo simbólico é ideal para mudar UM bit sem mexer nos demais.',
      opcoes: [
        ['u+x', 'dá execução ao dono'],
        ['g-w', 'tira a escrita do grupo'],
        ['o=', 'zera tudo dos outros'],
        ['a+r', 'todos podem ler (a = all)'],
        ['u=rw,g=r,o=', 'várias de uma vez, separadas por vírgula SEM espaço'],
        ['-v', 'mostra o antes e o depois'],
      ],
      exemplos: [
        { comando: './script.sh', explicacao: 'sem x ninguém executa: Permissão negada' },
        { comando: 'chmod -v u+x script.sh', explicacao: 'dono ganha execução' },
        { comando: './script.sh', explicacao: 'agora roda (./ = "o arquivo daqui")' },
        { comando: 'chmod -v go-r relatorio.txt', explicacao: 'grupo e outros perdem leitura' },
        { comando: 'chmod -v a+r relatorio.txt', explicacao: 'todos voltam a ler' },
        { comando: 'chmod -v u=rw,g=r,o= relatorio.txt', explicacao: '= define exatamente: vira 640' },
        { comando: 'ls -l' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> Classes: <code>u</code> (user/dono), <code>g</code> (group), <code>o</code> (others), <code>a</code> (all/todos). Operadores: <code>+</code> adiciona, <code>-</code> retira, <code>=</code> fixa. Sem letra de classe, <code>chmod +x</code> aplica a todos (<code>a+x</code>).',
      ],
    },
    {
      comando: 'chmod (números)',
      titulo: 'Mudar permissões no modo octal (numérico)',
      descricao: 'O <b>Método Numérico</b> baseia-se na soma binária de três dígitos: <b>dono</b>, <b>grupo</b> e <b>outros</b>. Cada dígito é a soma ponderada de <b>r = 4</b>, <b>w = 2</b>, <b>x = 1</b> (ou 0 quando desativado). Brinque com a calculadora interativa:',
      sintaxe: 'chmod 755 arquivo  |  chmod 775 pasta',
      naPratica: 'Os valores clássicos de um servidor: pastas <code>755</code>, arquivos <code>644</code>, pastas colaborativas de equipe <code>775</code>, arquivos com senha (<code>.env</code>, <code>wp-config.php</code>) <code>600</code> ou <code>640</code>. A chave SSH privada (<code>~/.ssh/id_ed25519</code>) precisa ser <code>600</code>: se estiver mais aberta, o próprio ssh se recusa a usá-la.',
      extra: 'calculadora-permissoes',
      exemplos: [
        { comando: 'chmod 755 script.sh', explicacao: 'rwxr-xr-x: todos executam, só o dono altera' },
        { comando: 'chmod 775 /srv/empresa', explicacao: 'rwxrwxr-x: destaque do vídeo: dono e grupo fazem tudo (77), outros leem/entram (5)' },
        { comando: 'chmod 600 salarios.txt', explicacao: 'rw-------: só o dono (root)' },
        { comando: 'chmod 640 salarios.txt', explicacao: 'rw-r-----: dono altera, grupo lê' },
        { comando: 'chmod 700 privado', explicacao: 'pasta privada: só o dono entra' },
        { comando: 'ls -l' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> Tabela octal: r=4, w=2, x=1. Padrões de prova e mercado: <code>775</code> (colaboração em equipe), <code>755</code> (scripts e pastas públicas), <code>644</code> (arquivos de texto comuns), <code>600</code> (senhas e chaves privadas).',
      ],
      pegadinha: '<b>[LPIC-1 104.5 / RHCSA EX200]:</b> Em DIRETÓRIOS, o bit <code>x</code> (1) é o direito de ENTRAR (cd) e acessar seus arquivos. Sem <code>x</code>, mesmo tendo <code>r</code>, o usuário lista os nomes pelo <code>ls</code> mas recebe "Permissão negada" ao tentar ler qualquer arquivo interno!',
    },
    {
      comando: 'chmod -R',
      titulo: 'Aplicar numa pasta inteira',
      descricao: 'Com <code>-R</code> (maiúsculo!) a mudança vale para a pasta e tudo que estiver dentro dela.',
      sintaxe: 'chmod -R modo diretório',
      naPratica: 'Corrigir as permissões de um site inteiro depois de um upload feito errado. No Ubuntu real, o jeito seguro separa pastas e arquivos: <code>find /var/www/html -type d -exec chmod 755 {} \\;</code> e <code>find /var/www/html -type f -exec chmod 644 {} \\;</code>.',
      exemplos: [
        { comando: 'chmod -Rv 750 privado', explicacao: 'repare: senhas.txt ganhou x sem precisar' },
        { comando: 'chmod -Rv u=rwX,g=rX,o= privado', explicacao: 'X maiúsculo: x só em pastas (e no que já era executável)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O caractere especial <code>X</code> maiúsculo (ex.: <code>chmod -R a+rX pasta</code>) aplica execução somente a pastas e a arquivos que já eram executáveis, evitando dar <code>x</code> a arquivos comuns.',
      ],
      pegadinha: '<b>[LPIC-1 104.5]:</b> No chmod/chown/chgrp o recursivo é <b>-R maiúsculo</b>. No rm e no cp é -r minúsculo (o cp aceita os dois).',
    },
    {
      comando: 'chown',
      titulo: 'Mudar o dono (e o grupo)',
      descricao: '<b>ch</b>ange <b>own</b>er. Só o <b>root</b> pode dar um arquivo para outra pessoa. Com <code>dono:grupo</code> troca os dois de uma vez.',
      sintaxe: 'chown dono[:grupo] arquivo',
      naPratica: 'Depois de copiar os arquivos de um site como root, eles ficam do root e o nginx/apache não consegue gravar os uploads. A correção clássica: <code>chown -R www-data:www-data /var/www/html</code>.',
      opcoes: [
        ['maria arq', 'só o dono'],
        ['maria:financeiro arq', 'dono e grupo'],
        [':financeiro arq', 'só o grupo (igual ao chgrp)'],
        ['-R', 'recursivo'],
      ],
      exemplos: [
        { comando: 'chown maria relatorio.txt' },
        { comando: 'chown -v maria:financeiro relatorio.txt' },
        { comando: 'mkdir /srv/equipe' },
        { comando: 'chown -R maria:financeiro /srv/equipe' },
        { comando: 'ls -ld /srv/equipe' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> <code>chown usuario:grupo arquivo</code> troca dono e grupo de uma só vez. <code>chown :grupo arquivo</code> altera apenas o grupo.',
      ],
      pegadinha: '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> Apenas o superusuário <b>root</b> tem permissão para alterar o dono (owner) de um arquivo no Linux. Usuários comuns não podem doar arquivos para outros.',
    },
    {
      comando: 'chgrp',
      titulo: 'Mudar só o grupo',
      descricao: '<b>ch</b>ange <b>gr</b>ou<b>p</b>. O dono do arquivo também pode usar, mas só para um grupo do qual ele participa.',
      sintaxe: 'chgrp grupo arquivo',
      naPratica: 'Dar acesso a uma pasta para uma equipe inteira: <code>chgrp -R devs /srv/projeto</code> e <code>chmod 770</code>. Quem entrar no grupo <code>devs</code> ganha acesso na hora, sem ninguém mexer em permissão de novo.',
      opcoes: [['-R', 'recursivo']],
      exemplos: [
        { comando: 'chgrp -v financeiro script.sh' },
        { comando: 'ls -l script.sh' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O usuário dono de um arquivo pode usar <code>chgrp</code> para alterar o grupo, mas somente para grupos aos quais ele próprio pertença.',
      ],
    },
    {
      comando: 'testando o acesso',
      titulo: 'Provar que funciona: outros usuários',
      descricao: 'A melhor forma de entender permissão é tentar acessar como outra pessoa. O terminal <b>2</b> entra como <b>maria</b> (grupo financeiro) e o <b>3</b> como <b>joao</b> (fora do grupo).',
      sintaxe: 'ssh maria@servidor  (ou: su - maria)',
      naPratica: 'Antes de liberar um servidor, o administrador testa como o usuário final: <code>su - usuario</code> (ou <code>sudo -u www-data cat arquivo</code>) para confirmar que ele acessa o que deve e, principalmente, NÃO acessa o que não deve.',
      exemplos: [
        { comando: 'cat /srv/empresa/salarios.txt', terminal: 2, login: { usuario: 'maria', senha: '123' }, explicacao: 'maria está no grupo financeiro: o r do grupo deixa ler' },
        { comando: 'echo "maria: R$ 9.000" >> /srv/empresa/salarios.txt', terminal: 2, explicacao: 'mas o grupo não tem w: Permissão negada' },
        { comando: 'cat /srv/empresa/salarios.txt', terminal: 3, login: { usuario: 'joao', senha: '123' }, explicacao: 'joao é "outros": 0 = nada' },
        { comando: 'cd /srv/empresa/privado', terminal: 3, explicacao: 'sem x na pasta: não entra' },
        { comando: 'cat /srv/empresa/relatorio.txt', terminal: 3, explicacao: 'relatorio.txt é 640 e joao não é do grupo: negado' },
        { comando: 'ls -l /srv/empresa', terminal: 3, explicacao: 'listar a pasta ele pode (a pasta é 755)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O kernel avalia apenas uma classe na ordem: Dono → Grupo → Outros. Se o usuário for o dono, valem exclusivamente os bits do dono.',
        'Mudou algo como root? Rode de novo no terminal do usuário: o efeito é imediato para permissões. Para <b>grupos novos</b>, o usuário precisa logar de novo.',
      ],
    },
    {
      comando: 'usermod -aG sudo',
      titulo: 'Conceder privilégios de superadministrador (sudo)',
      descricao: 'Para conceder privilégios de superusuário (sudo) a um usuário no Linux, adicione-o ao grupo administrativo correspondente à sua distribuição (<b>sudo</b> no Ubuntu/Debian, <b>wheel</b> no RHEL/CentOS/Fedora e Arch).',
      sintaxe: 'usermod -aG sudo usuario  |  usermod -aG wheel usuario',
      naPratica: 'Regra de ouro da administração de servidores: desabilite o login direto do root via SSH e conceda permissão de <code>sudo</code> apenas para contas nominais. Isso registra quem executou cada comando no <code>/var/log/auth.log</code>.',
      opcoes: [
        ['-aG sudo user', 'adiciona ao grupo administrativo no Debian, Ubuntu e derivados'],
        ['-aG wheel user', 'adiciona ao grupo administrativo no RHEL, CentOS, Fedora, Rocky, Alma e Arch Linux'],
        ['groups user', 'consulta os grupos e confirma se sudo ou wheel está presente'],
        ['sudo whoami', 'valida a execução de privilégios como root'],
      ],
      exemplos: [
        { comando: 'whoami', explicacao: '1. Acessar como root: retorno é root' },
        { comando: 'usermod -aG sudo joao', explicacao: '2. Adiciona o usuário joao ao grupo administrativo sudo' },
        { comando: 'groups joao', explicacao: 'Verificação: confere se o grupo sudo consta na listagem' },
        { comando: 'su - joao', explicacao: '3. Inicia sessão como joao para recarregar os grupos' },
        { comando: 'whoami', explicacao: 'confirma que estamos na sessão de joao' },
        { comando: 'sudo whoami', respostas: ['123'], explicacao: 'solicita a senha de joao e retorna root: acesso concedido!' },
        { comando: 'exit', explicacao: 'retorna à sessão root' },
      ],
      dicas: [
        '<b>[LPIC-1 107.1 / CompTIA Linux+]:</b> No Debian/Ubuntu o grupo administrativo chama-se <code>sudo</code>; em distribuições da família Red Hat e no Arch Linux, chama-se <code>wheel</code>.',
        '<b>Origem da palavra "wheel":</b> Vem da gíria em inglês <i>"big wheel"</i> (referindo-se a uma autoridade máxima ou chefe), surgida nos anos 1970/80 no TENEX e BSD Unix.',
        '<b>As 3 Regras de Ouro:</b> Na primeira vez que você executa o <code>sudo</code>, o Linux exibe: 1) Respeite a privacidade alheia; 2) Pense antes de digitar; 3) Com grandes poderes vêm grandes responsabilidades.',
        '<b>O Easter Egg dos Insultos:</b> Ativando <code>Defaults insults</code> no <code>/etc/sudoers</code>, o terminal brinca com frases sarcásticas do Monty Python ao errar a senha.',
        'No Arch Linux, confirme com <code>visudo</code> se a diretiva <code>%wheel ALL=(ALL:ALL) ALL</code> está descomentada.',
      ],
      pegadinha: '<b>[LPIC-1 107.1]:</b> A flag <code>-a</code> (append) junto com <code>-G</code> é estritamente obrigatória! Sem o <code>-a</code>, o usermod removerá o usuário de todos os outros grupos suplementares.',
    },
    {
      comando: 'umask',
      titulo: 'A permissão padrão dos arquivos novos',
      descricao: 'O <b>umask</b> é uma máscara que <b>tira</b> permissões de tudo que é criado. Arquivos partem de 666 e pastas de 777; o umask subtrai.',
      sintaxe: 'umask  |  umask 027',
      naPratica: 'Em servidores compartilhados, um umask <code>027</code> faz tudo que os usuários criam já nascer fechado para os outros. Serviços como servidores de arquivos (Samba, SFTP) também configuram umask para os uploads terem a permissão certa.',
      opcoes: [
        ['umask 022', '(root) arquivos 644, pastas 755'],
        ['umask 002', '(usuários no Ubuntu) arquivos 664, pastas 775'],
        ['umask 027', 'arquivos 640, pastas 750: outros não veem nada'],
        ['umask -S', 'mostra no formato u=rwx,g=rx,o=rx'],
      ],
      exemplos: [
        { comando: 'umask', explicacao: 'root: 0022' },
        { comando: 'cd /root && touch antes.txt && mkdir antes' },
        { comando: 'umask 027' },
        { comando: 'touch depois.txt && mkdir depois' },
        { comando: 'ls -l', explicacao: 'compare antes (644/755) e depois (640/750)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 & CompTIA Linux+]:</b> Base de cálculo do umask: diretórios partem de <code>777</code> e arquivos partem de <code>666</code> (nenhum arquivo comum nasce executável por padrão).',
        'O umask vale só para o shell atual. Para ficar permanente, coloque o comando no <code>~/.bashrc</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.5]:</b> O umask SUBTRAI permissões: umask <code>022</code> resulta em <code>644</code> para arquivos (666 - 022) e <code>755</code> para pastas (777 - 022). Um umask <code>027</code> gera arquivos <code>640</code> e pastas <code>750</code>.',
    },
    {
      comando: 'chmod +t',
      titulo: 'Sticky bit: pasta compartilhada segura',
      descricao: 'Numa pasta onde todos escrevem (777), qualquer um apagaria o arquivo dos outros. O <b>sticky bit</b> (o <code>t</code>, ou o <b>1</b> na frente do número) impede: cada um só apaga o que é seu. É assim no <code>/tmp</code>.',
      sintaxe: 'chmod 1777 pasta  |  chmod +t pasta',
      naPratica: 'Pastas de upload compartilhadas e o próprio <code>/tmp</code>. O SUID aparece no <code>/usr/bin/passwd</code>: ele precisa gravar no <code>/etc/shadow</code> (que é do root) mesmo quando um usuário comum troca a própria senha.',
      exemplos: [
        { comando: 'mkdir /srv/publico' },
        { comando: 'chmod 1777 /srv/publico' },
        { comando: 'ls -ld /srv/publico /tmp', explicacao: 'drwxrwxrwt: o t no lugar do último x' },
      ],
      dicas: [
        '<b>[LPIC-1 104.6 / Linux Essentials 5.4]:</b> Permissões especiais (4º dígito octal): <b>4000 = SUID</b> (executa como dono, ex: <code>/usr/bin/passwd</code>), <b>2000 = SGID</b> (arquivos herdam grupo da pasta), <b>1000 = Sticky Bit</b> (exclusão restrita ao dono, ex: <code>/tmp</code> 1777).',
        '<b>[LPIC-1 104.6]:</b> Se aparecer <code>S</code> ou <code>T</code> maiúsculo no <code>ls -l</code>, significa que o bit especial está ativo mas o bit <code>x</code> correspondente está DESLIGADO! Com <code>x</code> ligado, eles aparecem minúsculos: <code>s</code> e <code>t</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.6 / RHCSA EX200]:</b> Para pastas colaborativas compartilhadas entre membros de um mesmo grupo, a prova exige o <b>SGID</b> (<code>chmod 2770 pasta</code> ou <code>chmod g+s pasta</code>): novos arquivos herdam automaticamente o grupo da pasta.',
    },
  ],

  desafios: [
    {
      id: 'perm-1',
      enunciado: 'Deixe <code>/srv/empresa/script.sh</code> com permissão <code>rwxr-x---</code>.',
      dica: 'rwx = 7, r-x = 5, --- = 0.',
      solucao: [{ comando: 'chmod 750 /srv/empresa/script.sh' }],
      verificar: (m) => Verificar.modo(m, '/srv/empresa/script.sh', 0o750),
    },
    {
      id: 'perm-2',
      enunciado: 'Faça com que <b>somente o dono</b> consiga ler e alterar <code>/srv/empresa/privado/senhas.txt</code> (ninguém executa).',
      dica: 'rw------- = ?',
      solucao: [{ comando: 'chmod 600 /srv/empresa/privado/senhas.txt' }],
      verificar: (m) => Verificar.modo(m, '/srv/empresa/privado/senhas.txt', 0o600),
    },
    {
      id: 'perm-3',
      enunciado: 'Transforme <code>/srv/empresa/relatorio.txt</code> em arquivo da <b>maria</b> e do grupo <b>financeiro</b>.',
      dica: 'chown dono:grupo arquivo.',
      solucao: [{ comando: 'chown maria:financeiro /srv/empresa/relatorio.txt' }],
      verificar: (m) => Verificar.dono(m, '/srv/empresa/relatorio.txt', 'maria', 'financeiro'),
    },
    {
      id: 'perm-4',
      enunciado: 'Crie a pasta <code>/srv/financeiro</code> do grupo <b>financeiro</b>, onde dono e grupo fazem tudo e os outros <b>não entram</b>.',
      dica: 'mkdir, chgrp (ou chown :grupo) e chmod 770.',
      solucao: [{ comando: 'mkdir /srv/financeiro' }, { comando: 'chgrp financeiro /srv/financeiro' }, { comando: 'chmod 770 /srv/financeiro' }],
      verificar: (m) => Verificar.grupoDoNo(m, '/srv/financeiro', 'financeiro') && Verificar.modo(m, '/srv/financeiro', 0o770),
    },
    {
      id: 'perm-5',
      enunciado: 'Prove que funcionou: logada como <b>maria</b> no terminal 2, crie o arquivo <code>/srv/financeiro/balanco.txt</code>.',
      dica: 'Depois do desafio 4, abra o terminal 2, entre como maria (senha 123) e use touch ou echo.',
      solucao: [{ comando: 'touch /srv/financeiro/balanco.txt', terminal: 2, login: { usuario: 'maria', senha: '123' } }],
      verificar: (m) => Verificar.dono(m, '/srv/financeiro/balanco.txt', 'maria'),
    },
    {
      id: 'perm-6',
      enunciado: 'Crie <code>/srv/uploads</code> onde <b>todos</b> escrevem, mas ninguém apaga o arquivo dos outros.',
      dica: 'Sticky bit: 1777.',
      solucao: [{ comando: 'mkdir /srv/uploads' }, { comando: 'chmod 1777 /srv/uploads' }],
      verificar: (m) => Verificar.no(m, '/srv/uploads')?.modo === 0o1777,
    },
  ],
};
