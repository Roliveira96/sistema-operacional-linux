import { describe, it, expect } from 'vitest';
import {
  desafiosBasico,
  desafiosMedio,
  desafiosAvancado,
  desafiosEssentials,
  desafiosLPIC1,
  desafiosEscola,
  modalidades,
} from '../src/conteudo/simulado';
import type { Desafio, ModalidadeSimulado } from '../src/conteudo/Topico';
import { rodarSolucao } from './simulado_oficial.test';

interface CasoAlternativo {
  id: string;
  modalidadeId: string;
  descricao: string;
  alternativas: Array<{
    nome: string;
    comandos: string[];
  }>;
}

export const CASOS_ALTERNATIVOS: CasoAlternativo[] = [
  // ─────────────────────────────────────────────────────────────
  // 1. Linux Básico (7 cenários x 3 formas = 21 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'bas-fac-1',
    modalidadeId: 'basico',
    descricao: 'Criação de diretório aninhado (mkdir -p /home/ricardo/workspace/projeto1)',
    alternativas: [
      {
        nome: 'Forma 1: Navegação com cd e criação relativa',
        comandos: ['cd /home/ricardo/workspace', 'mkdir projeto1'],
      },
      {
        nome: 'Forma 2: Caminho absoluto sem -p (já que workspace existe)',
        comandos: ['mkdir /home/ricardo/workspace/projeto1'],
      },
      {
        nome: 'Forma 3: cd para a home e caminho relativo aninhado',
        comandos: ['cd /home/ricardo', 'mkdir -p workspace/projeto1'],
      },
    ],
  },
  {
    id: 'bas-fac-3',
    modalidadeId: 'basico',
    descricao: 'Criação de arquivo vazio (touch /home/ricardo/workspace/vazio.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Redirecionamento echo -n vazio',
        comandos: ['echo -n "" > /home/ricardo/workspace/vazio.txt'],
      },
      {
        nome: 'Forma 2: Operador de criação direta do shell (> arquivo)',
        comandos: ['> /home/ricardo/workspace/vazio.txt'],
      },
      {
        nome: 'Forma 3: Navegação com cd e touch relativo',
        comandos: ['cd /home/ricardo/workspace', 'touch vazio.txt'],
      },
    ],
  },
  {
    id: 'bas-fac-7',
    modalidadeId: 'basico',
    descricao: 'Anexação de linha em arquivo existente (echo >> /home/ricardo/workspace/notas.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Uso de printf com quebra de linha',
        comandos: ['printf "Pratica diaria no terminal\\n" >> /home/ricardo/workspace/notas.txt'],
      },
      {
        nome: 'Forma 2: cd no diretório de trabalho e append relativo',
        comandos: ['cd /home/ricardo/workspace', 'echo "Pratica diaria no terminal" >> notas.txt'],
      },
      {
        nome: 'Forma 3: Aspas simples protegidas no echo',
        comandos: ["echo 'Pratica diaria no terminal' >> /home/ricardo/workspace/notas.txt"],
      },
    ],
  },
  {
    id: 'bas-fac-8',
    modalidadeId: 'basico',
    descricao: 'Criação do arquivo temp.log (mkdir -p /home/ricardo/temporario && touch temp.log)',
    alternativas: [
      {
        nome: 'Forma 1: mkdir -p e echo -n vazio',
        comandos: ['mkdir -p /home/ricardo/temporario', 'echo -n "" > /home/ricardo/temporario/temp.log'],
      },
      {
        nome: 'Forma 2: cd na home e criação relativa',
        comandos: ['cd /home/ricardo', 'mkdir -p temporario', 'touch temporario/temp.log'],
      },
      {
        nome: 'Forma 3: mkdir -p e operador direto > arquivo',
        comandos: ['mkdir -p /home/ricardo/temporario', '> /home/ricardo/temporario/temp.log'],
      },
    ],
  },
  {
    id: 'bas-fac-9',
    modalidadeId: 'basico',
    descricao: 'Cópia do hostname para a home (cp /etc/hostname /home/ricardo/nome_maquina.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Leitura e redirecionamento com cat (cat > dest)',
        comandos: ['cat /etc/hostname > /home/ricardo/nome_maquina.txt'],
      },
      {
        nome: 'Forma 2: Filtro de início com head (head -n 1 > dest)',
        comandos: ['head -n 1 /etc/hostname > /home/ricardo/nome_maquina.txt'],
      },
      {
        nome: 'Forma 3: Navegação com cd na home e cópia com nome relativo',
        comandos: ['cd /home/ricardo', 'cp /etc/hostname nome_maquina.txt'],
      },
    ],
  },
  {
    id: 'bas-med-7',
    modalidadeId: 'basico',
    descricao: 'Contagem de linhas de usuários (wc -l /etc/passwd > total_usuarios.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Opção longa oficial (--lines)',
        comandos: ['wc --lines /etc/passwd > /home/ricardo/total_usuarios.txt'],
      },
      {
        nome: 'Forma 2: Entrada através de pipe (cat | wc -l)',
        comandos: ['cat /etc/passwd | wc -l > /home/ricardo/total_usuarios.txt'],
      },
      {
        nome: 'Forma 3: cd na home e redirecionamento para arquivo local',
        comandos: ['cd /home/ricardo', 'wc -l /etc/passwd > total_usuarios.txt'],
      },
    ],
  },
  {
    id: 'bas-dif-3',
    modalidadeId: 'basico',
    descricao: 'Extração de usuários do passwd (cut -d: -f1 /etc/passwd > nomes_usuarios.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem invertida das flags (-f antes de -d)',
        comandos: ['cut -f1 -d: /etc/passwd > /home/ricardo/nomes_usuarios.txt'],
      },
      {
        nome: 'Forma 2: Entrada através de pipe (cat | cut)',
        comandos: ['cat /etc/passwd | cut -d: -f1 > /home/ricardo/nomes_usuarios.txt'],
      },
      {
        nome: 'Forma 3: cd na home e gravação local',
        comandos: ['cd /home/ricardo', 'cut -d: -f1 /etc/passwd > nomes_usuarios.txt'],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 2. Linux Médio (11 cenários x 3 formas = 33 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'med-fac-1',
    modalidadeId: 'medio',
    descricao: 'Criação de grupo de segurança (groupadd suporte)',
    alternativas: [
      {
        nome: 'Forma 1: groupadd com flag de sistema (-r)',
        comandos: ['groupadd -r suporte'],
      },
      {
        nome: 'Forma 2: utilitário addgroup',
        comandos: ['addgroup suporte'],
      },
      {
        nome: 'Forma 3: groupadd com caminho absoluto do binário /usr/sbin',
        comandos: ['/usr/sbin/groupadd suporte'],
      },
    ],
  },
  {
    id: 'med-fac-4',
    modalidadeId: 'medio',
    descricao: 'Criação de usuário completo (useradd -m -s /bin/bash carlos)',
    alternativas: [
      {
        nome: 'Forma 1: Inversão da ordem das opções (-s antes de -m)',
        comandos: ['useradd -s /bin/bash -m carlos'],
      },
      {
        nome: 'Forma 2: Opções longas do padrão GNU (--shell e --create-home)',
        comandos: ['useradd --shell /bin/bash --create-home carlos'],
      },
      {
        nome: 'Forma 3: Posição do nome do usuário intercalada',
        comandos: ['useradd -m carlos -s /bin/bash'],
      },
    ],
  },
  {
    id: 'med-fac-6',
    modalidadeId: 'medio',
    descricao: 'Criação da pasta compartilhado (mkdir -p /srv/compartilhado)',
    alternativas: [
      {
        nome: 'Forma 1: mkdir sem -p já que /srv existe',
        comandos: ['mkdir /srv/compartilhado'],
      },
      {
        nome: 'Forma 2: cd em /srv e criação relativa',
        comandos: ['cd /srv', 'mkdir compartilhado'],
      },
      {
        nome: 'Forma 3: mkdir com permissão explícita (-m 755)',
        comandos: ['mkdir -m 755 /srv/compartilhado'],
      },
    ],
  },
  {
    id: 'med-fac-7',
    modalidadeId: 'medio',
    descricao: 'Atribuição de proprietário (chown carlos /srv/compartilhado)',
    alternativas: [
      {
        nome: 'Forma 1: Notação com dois pontos explícitos (carlos:)',
        comandos: ['chown carlos: /srv/compartilhado'],
      },
      {
        nome: 'Forma 2: cd em /srv e alteração por caminho relativo',
        comandos: ['cd /srv', 'chown carlos compartilhado'],
      },
      {
        nome: 'Forma 3: chown com flag verbosa (-v)',
        comandos: ['chown -v carlos /srv/compartilhado'],
      },
    ],
  },
  {
    id: 'med-fac-8',
    modalidadeId: 'medio',
    descricao: 'Atribuição de grupo proprietário (chgrp suporte /srv/compartilhado)',
    alternativas: [
      {
        nome: 'Forma 1: chown apenas com grupo usando dois pontos (:suporte)',
        comandos: ['chown :suporte /srv/compartilhado'],
      },
      {
        nome: 'Forma 2: chown apenas com grupo usando ponto (.suporte)',
        comandos: ['chown .suporte /srv/compartilhado'],
      },
      {
        nome: 'Forma 3: cd em /srv e chgrp com caminho relativo',
        comandos: ['cd /srv', 'chgrp suporte compartilhado'],
      },
    ],
  },
  {
    id: 'med-fac-9',
    modalidadeId: 'medio',
    descricao: 'Permissão padrão 755 (chmod 755 /srv/compartilhado)',
    alternativas: [
      {
        nome: 'Forma 1: Notação octal de 4 dígitos (0755)',
        comandos: ['chmod 0755 /srv/compartilhado'],
      },
      {
        nome: 'Forma 2: Notação simbólica explícita (u=rwx,go=rx)',
        comandos: ['chmod u=rwx,go=rx /srv/compartilhado'],
      },
      {
        nome: 'Forma 3: cd em /srv e chmod com caminho relativo',
        comandos: ['cd /srv', 'chmod 755 compartilhado'],
      },
    ],
  },
  {
    id: 'med-fac-10',
    modalidadeId: 'medio',
    descricao: 'Privatização da home com 700 (chmod 700 /home/carlos)',
    alternativas: [
      {
        nome: 'Forma 1: Notação octal de 4 dígitos (0700)',
        comandos: ['chmod 0700 /home/carlos'],
      },
      {
        nome: 'Forma 2: Notação simbólica explícita (u=rwx,go=)',
        comandos: ['chmod u=rwx,go= /home/carlos'],
      },
      {
        nome: 'Forma 3: cd em /home e chmod relativo',
        comandos: ['cd /home', 'chmod 700 carlos'],
      },
    ],
  },
  {
    id: 'med-med-2',
    modalidadeId: 'medio',
    descricao: 'Adição de grupo secundário (usermod -aG financeiro carlos)',
    alternativas: [
      {
        nome: 'Forma 1: Opções separadas (-a -G)',
        comandos: ['usermod -a -G financeiro carlos'],
      },
      {
        nome: 'Forma 2: Ordem invertida das flags (-G financeiro -a)',
        comandos: ['usermod -G financeiro -a carlos'],
      },
      {
        nome: 'Forma 3: Utilitário gpasswd com adição (-a)',
        comandos: ['gpasswd -a carlos financeiro'],
      },
    ],
  },
  {
    id: 'med-med-4',
    modalidadeId: 'medio',
    descricao: 'Permissão estrita 770 (chmod 770 /srv/suporte)',
    alternativas: [
      {
        nome: 'Forma 1: Notação octal de 4 dígitos (0770)',
        comandos: ['chmod 0770 /srv/suporte'],
      },
      {
        nome: 'Forma 2: Notação simbólica completa (u=rwx,g=rwx,o=)',
        comandos: ['chmod u=rwx,g=rwx,o= /srv/suporte'],
      },
      {
        nome: 'Forma 3: cd no diretório pai e chmod com caminho relativo',
        comandos: ['cd /srv', 'chmod 770 suporte'],
      },
    ],
  },
  {
    id: 'med-dif-2',
    modalidadeId: 'medio',
    descricao: 'Sticky Bit no compartilhado (chmod 1777 /srv/compartilhado)',
    alternativas: [
      {
        nome: 'Forma 1: Notação simbólica com +t e permissões plenas',
        comandos: ['chmod +t,u=rwx,go=rwx /srv/compartilhado'],
      },
      {
        nome: 'Forma 2: Notação octal de 5 dígitos/padrão (01777)',
        comandos: ['chmod 01777 /srv/compartilhado'],
      },
      {
        nome: 'Forma 3: cd em /srv e chmod 1777 relativo',
        comandos: ['cd /srv', 'chmod 1777 compartilhado'],
      },
    ],
  },
  {
    id: 'med-dif-4',
    modalidadeId: 'medio',
    descricao: 'Adição de usuário ao sudo (usermod -aG sudo carlos)',
    alternativas: [
      {
        nome: 'Forma 1: Opções separadas (-a -G)',
        comandos: ['usermod -a -G sudo carlos'],
      },
      {
        nome: 'Forma 2: Ordem invertida (-G sudo -a)',
        comandos: ['usermod -G sudo -a carlos'],
      },
      {
        nome: 'Forma 3: Utilitário gpasswd (-a carlos sudo)',
        comandos: ['gpasswd -a carlos sudo'],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 3. Linux Avançado (8 cenários x 3 formas = 24 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'av-fac-9',
    modalidadeId: 'avancado',
    descricao: 'Link simbólico para banner (ln -s /etc/issue /home/ricardo/banner_link)',
    alternativas: [
      {
        nome: 'Forma 1: Opção longa oficial (--symbolic)',
        comandos: ['ln --symbolic /etc/issue /home/ricardo/banner_link'],
      },
      {
        nome: 'Forma 2: cd na home e link relativo',
        comandos: ['cd /home/ricardo', 'ln -s /etc/issue banner_link'],
      },
      {
        nome: 'Forma 3: Flag combinada com force (-sf)',
        comandos: ['ln -sf /etc/issue /home/ricardo/banner_link'],
      },
    ],
  },
  {
    id: 'av-med-3',
    modalidadeId: 'avancado',
    descricao: 'Reinicio de daemon web (systemctl restart nginx)',
    alternativas: [
      {
        nome: 'Forma 1: Utilitário compatível service (service nginx restart)',
        comandos: ['service nginx restart'],
      },
      {
        nome: 'Forma 2: Especificação completa com sufixo .service',
        comandos: ['systemctl restart nginx.service'],
      },
      {
        nome: 'Forma 3: Sequência de parada e inicialização (stop && start)',
        comandos: ['systemctl stop nginx', 'systemctl start nginx'],
      },
    ],
  },
  {
    id: 'av-med-4',
    modalidadeId: 'avancado',
    descricao: 'Habilitação de inicialização no boot (systemctl enable nginx)',
    alternativas: [
      {
        nome: 'Forma 1: Com nome completo da unit nginx.service',
        comandos: ['systemctl enable nginx.service'],
      },
      {
        nome: 'Forma 2: Com ativação imediata agregada (--now)',
        comandos: ['systemctl enable --now nginx'],
      },
      {
        nome: 'Forma 3: Caminho completo do binário systemd /usr/bin/systemctl',
        comandos: ['/usr/bin/systemctl enable nginx'],
      },
    ],
  },
  {
    id: 'av-med-5',
    modalidadeId: 'avancado',
    descricao: 'Atalho simbólico de pasta web (ln -s /var/www/html /home/ricardo/meusite)',
    alternativas: [
      {
        nome: 'Forma 1: Flag longa --symbolic',
        comandos: ['ln --symbolic /var/www/html /home/ricardo/meusite'],
      },
      {
        nome: 'Forma 2: cd no destino e criação com nome local',
        comandos: ['cd /home/ricardo', 'ln -s /var/www/html meusite'],
      },
      {
        nome: 'Forma 3: Flags agrupadas de criação forçada (-sf)',
        comandos: ['ln -sf /var/www/html /home/ricardo/meusite'],
      },
    ],
  },
  {
    id: 'av-med-8',
    modalidadeId: 'avancado',
    descricao: 'Criação com Sticky Bit 1777 (mkdir + chmod 1777 /srv/upload)',
    alternativas: [
      {
        nome: 'Forma 1: mkdir com flag direta de modo (-m 1777)',
        comandos: ['mkdir -p -m 1777 /srv/upload'],
      },
      {
        nome: 'Forma 2: Notação simbólica com +t e permissões plenas',
        comandos: ['mkdir -p /srv/upload', 'chmod +t,u=rwx,go=rwx /srv/upload'],
      },
      {
        nome: 'Forma 3: cd no pai e chmod 1777 relativo',
        comandos: ['mkdir -p /srv/upload', 'cd /srv', 'chmod 1777 upload'],
      },
    ],
  },
  {
    id: 'av-dif-3',
    modalidadeId: 'avancado',
    descricao: 'Backup em tar.gz do diretório /etc/ (tar -czf backup_etc.tar.gz /etc/)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem alternativa de flags (-zcf)',
        comandos: ['tar -zcf /home/ricardo/backup_etc.tar.gz /etc/'],
      },
      {
        nome: 'Forma 2: Flag verbosa adicionada (-czvf)',
        comandos: ['tar -czvf /home/ricardo/backup_etc.tar.gz /etc/'],
      },
      {
        nome: 'Forma 3: cd na home e geração relativa do arquivo',
        comandos: ['cd /home/ricardo', 'tar -czf backup_etc.tar.gz /etc/'],
      },
    ],
  },
  {
    id: 'av-dif-7',
    modalidadeId: 'avancado',
    descricao: 'Atalho srv-web para o binário do nginx (ln -s /usr/sbin/nginx /usr/local/bin/srv-web)',
    alternativas: [
      {
        nome: 'Forma 1: Flag longa oficial (--symbolic)',
        comandos: ['ln --symbolic /usr/sbin/nginx /usr/local/bin/srv-web'],
      },
      {
        nome: 'Forma 2: cd em /usr/local/bin e criação com nome local',
        comandos: ['cd /usr/local/bin', 'ln -s /usr/sbin/nginx srv-web'],
      },
      {
        nome: 'Forma 3: Flag combinada de sobrescrita (-sf)',
        comandos: ['ln -sf /usr/sbin/nginx /usr/local/bin/srv-web'],
      },
    ],
  },
  {
    id: 'av-dif-10',
    modalidadeId: 'avancado',
    descricao: 'Estrutura com permissão 755 em /opt/app (mkdir -p + chmod 755 /opt/app)',
    alternativas: [
      {
        nome: 'Forma 1: Criação direta com modo no mkdir (-m 755)',
        comandos: ['mkdir -p -m 755 /opt/app'],
      },
      {
        nome: 'Forma 2: Notação octal de 4 dígitos (0755)',
        comandos: ['mkdir -p /opt/app', 'chmod 0755 /opt/app'],
      },
      {
        nome: 'Forma 3: Notação simbólica explícita (u=rwx,go=rx)',
        comandos: ['mkdir -p /opt/app', 'chmod u=rwx,go=rx /opt/app'],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 4. LPI Linux Essentials (9 cenários x 3 formas = 27 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'ess-fac-2',
    modalidadeId: 'essentials',
    descricao: 'Criação de log de monitoramento (touch /var/log/app-monitor.log)',
    alternativas: [
      {
        nome: 'Forma 1: Redirecionamento echo -n vazio',
        comandos: ['echo -n "" > /var/log/app-monitor.log'],
      },
      {
        nome: 'Forma 2: Operador de criação direta do shell (> arquivo)',
        comandos: ['> /var/log/app-monitor.log'],
      },
      {
        nome: 'Forma 3: cd em /var/log e touch local',
        comandos: ['cd /var/log', 'touch app-monitor.log'],
      },
    ],
  },
  {
    id: 'ess-fac-3',
    modalidadeId: 'essentials',
    descricao: 'Criação do lab lpi com 755 (mkdir -p /tmp/lpi-lab; chmod 755 /tmp/lpi-lab)',
    alternativas: [
      {
        nome: 'Forma 1: Criação com flag de modo direto (-m 755)',
        comandos: ['mkdir -p -m 755 /tmp/lpi-lab'],
      },
      {
        nome: 'Forma 2: Notação octal de 4 dígitos (0755)',
        comandos: ['mkdir -p /tmp/lpi-lab', 'chmod 0755 /tmp/lpi-lab'],
      },
      {
        nome: 'Forma 3: Notação simbólica (u=rwx,go=rx)',
        comandos: ['mkdir -p /tmp/lpi-lab', 'chmod u=rwx,go=rx /tmp/lpi-lab'],
      },
    ],
  },
  {
    id: 'ess-fac-6',
    modalidadeId: 'essentials',
    descricao: 'Criação de arquivo oculto (touch /home/ricardo/.documento_oculto)',
    alternativas: [
      {
        nome: 'Forma 1: Redirecionamento de string vazia via echo',
        comandos: ['echo -n "" > /home/ricardo/.documento_oculto'],
      },
      {
        nome: 'Forma 2: Operador de truncamento do shell (> .arquivo)',
        comandos: ['> /home/ricardo/.documento_oculto'],
      },
      {
        nome: 'Forma 3: cd na home e touch relativo',
        comandos: ['cd /home/ricardo', 'touch .documento_oculto'],
      },
    ],
  },
  {
    id: 'ess-fac-8',
    modalidadeId: 'essentials',
    descricao: 'Criação de subpasta lpi (mkdir -p /home/ricardo/documentos/lpi)',
    alternativas: [
      {
        nome: 'Forma 1: cd em documentos e criação direta',
        comandos: ['cd /home/ricardo/documentos', 'mkdir lpi'],
      },
      {
        nome: 'Forma 2: mkdir com caminho absoluto sem -p (pai já existe)',
        comandos: ['mkdir /home/ricardo/documentos/lpi'],
      },
      {
        nome: 'Forma 3: cd na home e caminho relativo',
        comandos: ['cd /home/ricardo', 'mkdir -p documentos/lpi'],
      },
    ],
  },
  {
    id: 'ess-med-1',
    modalidadeId: 'essentials',
    descricao: 'Contagem de contas do sistema (wc -l /etc/passwd > /tmp/lpi-lab/total-contas.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Opção longa oficial (--lines)',
        comandos: ['wc --lines /etc/passwd > /tmp/lpi-lab/total-contas.txt'],
      },
      {
        nome: 'Forma 2: Encadeamento via pipe (cat | wc -l)',
        comandos: ['cat /etc/passwd | wc -l > /tmp/lpi-lab/total-contas.txt'],
      },
      {
        nome: 'Forma 3: cd no destino e gravação local',
        comandos: ['cd /tmp/lpi-lab', 'wc -l /etc/passwd > total-contas.txt'],
      },
    ],
  },
  {
    id: 'ess-med-10',
    modalidadeId: 'essentials',
    descricao: 'Extração da coluna de shells (cut -d: -f7 /etc/passwd > shells_sistema.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem invertida das opções (-f antes de -d)',
        comandos: ['cut -f7 -d: /etc/passwd > /tmp/lpi-lab/shells_sistema.txt'],
      },
      {
        nome: 'Forma 2: Entrada através de pipe (cat | cut)',
        comandos: ['cat /etc/passwd | cut -d: -f7 > /tmp/lpi-lab/shells_sistema.txt'],
      },
      {
        nome: 'Forma 3: cd em /tmp/lpi-lab e gravação com nome relativo',
        comandos: ['cd /tmp/lpi-lab', 'cut -d: -f7 /etc/passwd > shells_sistema.txt'],
      },
    ],
  },
  {
    id: 'ess-dif-2',
    modalidadeId: 'essentials',
    descricao: 'Permissão pública 1777 no lab (chmod 1777 /tmp/lpi-lab)',
    alternativas: [
      {
        nome: 'Forma 1: Notação simbólica com +t e permissões plenas',
        comandos: ['chmod +t,u=rwx,go=rwx /tmp/lpi-lab'],
      },
      {
        nome: 'Forma 2: Notação octal de 4 dígitos (01777)',
        comandos: ['chmod 01777 /tmp/lpi-lab'],
      },
      {
        nome: 'Forma 3: cd em /tmp e chmod 1777 relativo',
        comandos: ['cd /tmp', 'chmod 1777 lpi-lab'],
      },
    ],
  },
  {
    id: 'ess-dif-3',
    modalidadeId: 'essentials',
    descricao: 'Link simbólico para texto de filosofia (ln -s /tmp/lpi-lab/filosofia.txt link_filosofia)',
    alternativas: [
      {
        nome: 'Forma 1: Flag longa oficial (--symbolic)',
        comandos: ['ln --symbolic /tmp/lpi-lab/filosofia.txt /home/ricardo/link_filosofia'],
      },
      {
        nome: 'Forma 2: cd na home e link relativo local',
        comandos: ['cd /home/ricardo', 'ln -s /tmp/lpi-lab/filosofia.txt link_filosofia'],
      },
      {
        nome: 'Forma 3: Forçando criação com -sf',
        comandos: ['ln -sf /tmp/lpi-lab/filosofia.txt /home/ricardo/link_filosofia'],
      },
    ],
  },
  {
    id: 'ess-dif-10',
    modalidadeId: 'essentials',
    descricao: 'Atribuição de dono e grupo em script (chown aluno1:lpistudents /tmp/lpi-lab/script.sh)',
    alternativas: [
      {
        nome: 'Forma 1: chown para usuário e chgrp para o grupo separadamente',
        comandos: [
          'chown aluno1 /tmp/lpi-lab/script.sh',
          'chgrp lpistudents /tmp/lpi-lab/script.sh',
        ],
      },
      {
        nome: 'Forma 2: Separador com ponto (.lpistudents)',
        comandos: ['chown aluno1.lpistudents /tmp/lpi-lab/script.sh'],
      },
      {
        nome: 'Forma 3: cd no diretório e chown com caminho relativo',
        comandos: ['cd /tmp/lpi-lab', 'chown aluno1:lpistudents script.sh'],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 5. LPIC-1 (12 cenários x 3 formas = 36 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'lpic-fac-4',
    modalidadeId: 'lpic1',
    descricao: 'Criação de grupo auditores (groupadd auditores)',
    alternativas: [
      {
        nome: 'Forma 1: groupadd com flag de sistema (-r)',
        comandos: ['groupadd -r auditores'],
      },
      {
        nome: 'Forma 2: utilitário addgroup',
        comandos: ['addgroup auditores'],
      },
      {
        nome: 'Forma 3: groupadd via /usr/sbin',
        comandos: ['/usr/sbin/groupadd auditores'],
      },
    ],
  },
  {
    id: 'lpic-fac-5',
    modalidadeId: 'lpic1',
    descricao: 'Criação do usuário auditor1 (useradd -m -s /bin/bash auditor1)',
    alternativas: [
      {
        nome: 'Forma 1: Inversão das flags (-s antes de -m)',
        comandos: ['useradd -s /bin/bash -m auditor1'],
      },
      {
        nome: 'Forma 2: Opções longas (--create-home --shell)',
        comandos: ['useradd --create-home --shell /bin/bash auditor1'],
      },
      {
        nome: 'Forma 3: Nome do usuário intercalado',
        comandos: ['useradd -m auditor1 -s /bin/bash'],
      },
    ],
  },
  {
    id: 'lpic-fac-7',
    modalidadeId: 'lpic1',
    descricao: 'Link simbólico para fstab (ln -s /etc/fstab /home/ricardo/fstab_link)',
    alternativas: [
      {
        nome: 'Forma 1: Opção longa --symbolic',
        comandos: ['ln --symbolic /etc/fstab /home/ricardo/fstab_link'],
      },
      {
        nome: 'Forma 2: cd na home e link relativo',
        comandos: ['cd /home/ricardo', 'ln -s /etc/fstab fstab_link'],
      },
      {
        nome: 'Forma 3: Forçando criação com -sf',
        comandos: ['ln -sf /etc/fstab /home/ricardo/fstab_link'],
      },
    ],
  },
  {
    id: 'lpic-fac-8',
    modalidadeId: 'lpic1',
    descricao: 'Permissão crítica de segurança 600 em shadow (chmod 600 /etc/shadow)',
    alternativas: [
      {
        nome: 'Forma 1: Octal de 4 dígitos (0600)',
        comandos: ['chmod 0600 /etc/shadow'],
      },
      {
        nome: 'Forma 2: Notação simbólica explícita (u=rw,go=)',
        comandos: ['chmod u=rw,go= /etc/shadow'],
      },
      {
        nome: 'Forma 3: cd em /etc e chmod com caminho relativo',
        comandos: ['cd /etc', 'chmod 600 shadow'],
      },
    ],
  },
  {
    id: 'lpic-med-2',
    modalidadeId: 'lpic1',
    descricao: 'Criação de conta de serviço (useradd -m -s /usr/sbin/nologin deploybot)',
    alternativas: [
      {
        nome: 'Forma 1: Inversão das flags (-s antes de -m)',
        comandos: ['useradd -s /usr/sbin/nologin -m deploybot'],
      },
      {
        nome: 'Forma 2: Opções longas (--create-home --shell)',
        comandos: ['useradd --create-home --shell /usr/sbin/nologin deploybot'],
      },
      {
        nome: 'Forma 3: Nome do usuário intercalado',
        comandos: ['useradd -m deploybot -s /usr/sbin/nologin'],
      },
    ],
  },
  {
    id: 'lpic-med-3',
    modalidadeId: 'lpic1',
    descricao: 'Atalho srv-web para nginx (ln -s /usr/sbin/nginx /usr/local/bin/srv-web)',
    alternativas: [
      {
        nome: 'Forma 1: Flag longa oficial (--symbolic)',
        comandos: ['ln --symbolic /usr/sbin/nginx /usr/local/bin/srv-web'],
      },
      {
        nome: 'Forma 2: cd em /usr/local/bin e criação com nome local',
        comandos: ['cd /usr/local/bin', 'ln -s /usr/sbin/nginx srv-web'],
      },
      {
        nome: 'Forma 3: Flag combinada de sobrescrita (-sf)',
        comandos: ['ln -sf /usr/sbin/nginx /usr/local/bin/srv-web'],
      },
    ],
  },
  {
    id: 'lpic-med-4',
    modalidadeId: 'lpic1',
    descricao: 'Concessão de privilégio sudo a ricardo (usermod -aG sudo ricardo)',
    alternativas: [
      {
        nome: 'Forma 1: Flags separadas (-a -G)',
        comandos: ['usermod -a -G sudo ricardo'],
      },
      {
        nome: 'Forma 2: Ordem invertida (-G sudo -a)',
        comandos: ['usermod -G sudo -a ricardo'],
      },
      {
        nome: 'Forma 3: Comando gpasswd com adição (-a)',
        comandos: ['gpasswd -a ricardo sudo'],
      },
    ],
  },
  {
    id: 'lpic-med-6',
    modalidadeId: 'lpic1',
    descricao: 'Associação de usuário a grupo suplementar (usermod -aG auditores auditor1)',
    alternativas: [
      {
        nome: 'Forma 1: Flags separadas (-a -G)',
        comandos: ['usermod -a -G auditores auditor1'],
      },
      {
        nome: 'Forma 2: Ordem invertida (-G auditores -a)',
        comandos: ['usermod -G auditores -a auditor1'],
      },
      {
        nome: 'Forma 3: Comando gpasswd com adição (-a)',
        comandos: ['gpasswd -a auditor1 auditores'],
      },
    ],
  },
  {
    id: 'lpic-med-7',
    modalidadeId: 'lpic1',
    descricao: 'Compactação de diretório com tar gzip (tar -czf pam_backup.tar.gz /etc/pam.d)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem alternativa de flags (-zcf)',
        comandos: ['tar -zcf /home/ricardo/pam_backup.tar.gz /etc/pam.d'],
      },
      {
        nome: 'Forma 2: Modo detalhado / verbose com -v (-czvf)',
        comandos: ['tar -czvf /home/ricardo/pam_backup.tar.gz /etc/pam.d'],
      },
      {
        nome: 'Forma 3: cd na home e criação do arquivo local',
        comandos: ['cd /home/ricardo', 'tar -czf pam_backup.tar.gz /etc/pam.d'],
      },
    ],
  },
  {
    id: 'lpic-med-8',
    modalidadeId: 'lpic1',
    descricao: 'Extração de colunas com cut (cut -d: -f1,3 /etc/passwd > uid_usuarios.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem invertida das flags (-f antes de -d)',
        comandos: ['cut -f1,3 -d: /etc/passwd > /home/ricardo/uid_usuarios.txt'],
      },
      {
        nome: 'Forma 2: Entrada através de pipe (cat | cut)',
        comandos: ['cat /etc/passwd | cut -d: -f1,3 > /home/ricardo/uid_usuarios.txt'],
      },
      {
        nome: 'Forma 3: cd na home e redirecionamento para arquivo local',
        comandos: ['cd /home/ricardo', 'cut -d: -f1,3 /etc/passwd > uid_usuarios.txt'],
      },
    ],
  },
  {
    id: 'lpic-med-9',
    modalidadeId: 'lpic1',
    descricao: 'Criação de dropzone com Sticky Bit (mkdir + chmod 1777 /srv/dropzone)',
    alternativas: [
      {
        nome: 'Forma 1: Criação com flag de modo direto (-m 1777)',
        comandos: ['mkdir -p -m 1777 /srv/dropzone'],
      },
      {
        nome: 'Forma 2: Notação simbólica explícita (+t,u=rwx,go=rwx)',
        comandos: ['mkdir -p /srv/dropzone', 'chmod +t,u=rwx,go=rwx /srv/dropzone'],
      },
      {
        nome: 'Forma 3: cd em /srv e chmod 1777 relativo',
        comandos: ['mkdir -p /srv/dropzone', 'cd /srv', 'chmod 1777 dropzone'],
      },
    ],
  },
  {
    id: 'lpic-dif-10',
    modalidadeId: 'lpic1',
    descricao: 'Mapeamento de homes com cut (cut -d: -f1,6 /etc/passwd > mapeamento_homes.txt)',
    alternativas: [
      {
        nome: 'Forma 1: Inversão de ordem das flags (-f1,6 -d:)',
        comandos: ['cut -f1,6 -d: /etc/passwd > /home/ricardo/mapeamento_homes.txt'],
      },
      {
        nome: 'Forma 2: Entrada com cat via pipeline',
        comandos: ['cat /etc/passwd | cut -d: -f1,6 > /home/ricardo/mapeamento_homes.txt'],
      },
      {
        nome: 'Forma 3: cd na home e gravação local',
        comandos: ['cd /home/ricardo', 'cut -d: -f1,6 /etc/passwd > mapeamento_homes.txt'],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────
  // 6. Servidor Escola (14 cenários x 3 formas = 42 testes)
  // ─────────────────────────────────────────────────────────────
  {
    id: 'esc-fac-1',
    modalidadeId: 'escola',
    descricao: 'Criação de estrutura institucional escolar (mkdir -p /srv/escola/docs scripts publico)',
    alternativas: [
      {
        nome: 'Forma 1: Comandos mkdir separados para cada subpasta',
        comandos: [
          'mkdir -p /srv/escola/docs',
          'mkdir -p /srv/escola/scripts',
          'mkdir -p /srv/escola/publico',
        ],
      },
      {
        nome: 'Forma 2: cd no diretório base /srv/escola e criação das três pastas',
        comandos: ['cd /srv/escola', 'mkdir -p docs scripts publico'],
      },
      {
        nome: 'Forma 3: Expansão de chaves bash {docs,scripts,publico}',
        comandos: ['mkdir -p /srv/escola/{docs,scripts,publico}'],
      },
    ],
  },
  {
    id: 'esc-fac-3',
    modalidadeId: 'escola',
    descricao: 'Criação do grupo professores (groupadd professores)',
    alternativas: [
      {
        nome: 'Forma 1: groupadd com flag de sistema (-r)',
        comandos: ['groupadd -r professores'],
      },
      {
        nome: 'Forma 2: addgroup dedicado',
        comandos: ['addgroup professores'],
      },
      {
        nome: 'Forma 3: Execução com caminho absoluto do binário /usr/sbin',
        comandos: ['/usr/sbin/groupadd professores'],
      },
    ],
  },
  {
    id: 'esc-fac-4',
    modalidadeId: 'escola',
    descricao: 'Criação do grupo alunos (groupadd alunos)',
    alternativas: [
      {
        nome: 'Forma 1: groupadd com flag de sistema (-r)',
        comandos: ['groupadd -r alunos'],
      },
      {
        nome: 'Forma 2: addgroup dedicado',
        comandos: ['addgroup alunos'],
      },
      {
        nome: 'Forma 3: groupadd via /usr/sbin',
        comandos: ['/usr/sbin/groupadd alunos'],
      },
    ],
  },
  {
    id: 'esc-fac-5',
    modalidadeId: 'escola',
    descricao: 'Criação da usuária coordenadora sediane (useradd -m -s /bin/bash sediane)',
    alternativas: [
      {
        nome: 'Forma 1: Flags em ordem alternada (-s /bin/bash -m)',
        comandos: ['useradd -s /bin/bash -m sediane'],
      },
      {
        nome: 'Forma 2: Opções longas padrão (--create-home --shell)',
        comandos: ['useradd --create-home --shell /bin/bash sediane'],
      },
      {
        nome: 'Forma 3: Nome da usuária intercalado',
        comandos: ['useradd -m sediane -s /bin/bash'],
      },
    ],
  },
  {
    id: 'esc-fac-7',
    modalidadeId: 'escola',
    descricao: 'Criação da aluna ana (useradd -m -s /bin/bash ana)',
    alternativas: [
      {
        nome: 'Forma 1: Flags em ordem alternada (-s antes de -m)',
        comandos: ['useradd -s /bin/bash -m ana'],
      },
      {
        nome: 'Forma 2: Opções longas padrão GNU (--create-home --shell)',
        comandos: ['useradd --create-home --shell /bin/bash ana'],
      },
      {
        nome: 'Forma 3: Nome da aluna intercalado',
        comandos: ['useradd -m ana -s /bin/bash'],
      },
    ],
  },
  {
    id: 'esc-fac-10',
    modalidadeId: 'escola',
    descricao: 'Permissão padrão 755 em docs (chmod 755 /srv/escola/docs)',
    alternativas: [
      {
        nome: 'Forma 1: Notação octal de 4 dígitos (0755)',
        comandos: ['chmod 0755 /srv/escola/docs'],
      },
      {
        nome: 'Forma 2: Notação simbólica explícita (u=rwx,go=rx)',
        comandos: ['chmod u=rwx,go=rx /srv/escola/docs'],
      },
      {
        nome: 'Forma 3: cd no diretório pai e permissão relativa',
        comandos: ['cd /srv/escola', 'chmod 755 docs'],
      },
    ],
  },
  {
    id: 'esc-med-1',
    modalidadeId: 'escola',
    descricao: 'Adição de sediane ao grupo professores (usermod -aG professores sediane)',
    alternativas: [
      {
        nome: 'Forma 1: Flags separadas (-a -G)',
        comandos: ['usermod -a -G professores sediane'],
      },
      {
        nome: 'Forma 2: Ordem invertida (-G professores -a)',
        comandos: ['usermod -G professores -a sediane'],
      },
      {
        nome: 'Forma 3: Adição através de gpasswd (-a)',
        comandos: ['gpasswd -a sediane professores'],
      },
    ],
  },
  {
    id: 'esc-med-2',
    modalidadeId: 'escola',
    descricao: 'Adição de ana ao grupo alunos (usermod -aG alunos ana)',
    alternativas: [
      {
        nome: 'Forma 1: Flags separadas (-a -G)',
        comandos: ['usermod -a -G alunos ana'],
      },
      {
        nome: 'Forma 2: Ordem invertida (-G alunos -a)',
        comandos: ['usermod -G alunos -a ana'],
      },
      {
        nome: 'Forma 3: Adição através de gpasswd (-a)',
        comandos: ['gpasswd -a ana alunos'],
      },
    ],
  },
  {
    id: 'esc-med-4',
    modalidadeId: 'escola',
    descricao: 'Posse e permissão em docs (chown -R sediane:professores + chmod 770 /srv/escola/docs)',
    alternativas: [
      {
        nome: 'Forma 1: chown para usuário e chgrp para o grupo separadamente',
        comandos: [
          'chown -R sediane /srv/escola/docs',
          'chgrp -R professores /srv/escola/docs',
          'chmod 770 /srv/escola/docs',
        ],
      },
      {
        nome: 'Forma 2: cd em /srv/escola e execução com caminhos locais',
        comandos: [
          'cd /srv/escola',
          'chown -R sediane:professores docs',
          'chmod 770 docs',
        ],
      },
      {
        nome: 'Forma 3: Separador de ponto (.professores) e octal 0770',
        comandos: [
          'chown -R sediane.professores /srv/escola/docs',
          'chmod 0770 /srv/escola/docs',
        ],
      },
    ],
  },
  {
    id: 'esc-med-5',
    modalidadeId: 'escola',
    descricao: 'Sticky Bit 1777 no mural público (chmod 1777 /srv/escola/publico)',
    alternativas: [
      {
        nome: 'Forma 1: Notação simbólica com +t e permissões plenas',
        comandos: ['chmod +t,u=rwx,go=rwx /srv/escola/publico'],
      },
      {
        nome: 'Forma 2: Notação octal de 4 dígitos (01777)',
        comandos: ['chmod 01777 /srv/escola/publico'],
      },
      {
        nome: 'Forma 3: cd em /srv/escola e chmod 1777 relativo',
        comandos: ['cd /srv/escola', 'chmod 1777 publico'],
      },
    ],
  },
  {
    id: 'esc-med-6',
    modalidadeId: 'escola',
    descricao: 'Cópia de regras.txt para ana (cp /srv/escola/docs/regras.txt /home/ana/ + chown ana:alunos)',
    alternativas: [
      {
        nome: 'Forma 1: Leitura e redirecionamento de fluxo com cat',
        comandos: [
          'cat /srv/escola/docs/regras.txt > /home/ana/regras.txt',
          'chown ana:alunos /home/ana/regras.txt',
        ],
      },
      {
        nome: 'Forma 2: cp com preservação de atributos e chown',
        comandos: [
          'cp -p /srv/escola/docs/regras.txt /home/ana/regras.txt',
          'chown ana:alunos /home/ana/regras.txt',
        ],
      },
      {
        nome: 'Forma 3: cd na home de destino e cópia para ponto local (.)',
        comandos: [
          'cd /home/ana',
          'cp /srv/escola/docs/regras.txt .',
          'chown ana:alunos regras.txt',
        ],
      },
    ],
  },
  {
    id: 'esc-dif-3',
    modalidadeId: 'escola',
    descricao: 'Link simbólico do portal web (ln -s /var/www/html /srv/escola/portal-web)',
    alternativas: [
      {
        nome: 'Forma 1: Flag longa oficial (--symbolic)',
        comandos: ['ln --symbolic /var/www/html /srv/escola/portal-web'],
      },
      {
        nome: 'Forma 2: cd em /srv/escola e criação com nome relativo',
        comandos: ['cd /srv/escola', 'ln -s /var/www/html portal-web'],
      },
      {
        nome: 'Forma 3: Criação forçada com -sf',
        comandos: ['ln -sf /var/www/html /srv/escola/portal-web'],
      },
    ],
  },
  {
    id: 'esc-dif-6',
    modalidadeId: 'escola',
    descricao: 'Backup em tar.gz da pasta docs (tar -czf /srv/escola/backup_docs.tar.gz /srv/escola/docs)',
    alternativas: [
      {
        nome: 'Forma 1: Ordem de opções alternada (-zcf)',
        comandos: ['tar -zcf /srv/escola/backup_docs.tar.gz /srv/escola/docs'],
      },
      {
        nome: 'Forma 2: Flag verbosa adicionada (-czvf)',
        comandos: ['tar -czvf /srv/escola/backup_docs.tar.gz /srv/escola/docs'],
      },
      {
        nome: 'Forma 3: cd em /srv/escola e geração com caminho relativo',
        comandos: ['cd /srv/escola', 'tar -czf backup_docs.tar.gz /srv/escola/docs'],
      },
    ],
  },
  {
    id: 'esc-dif-8',
    modalidadeId: 'escola',
    descricao: 'Criação do robô portalbot com nologin (useradd -m -s /usr/sbin/nologin portalbot)',
    alternativas: [
      {
        nome: 'Forma 1: Inversão das flags (-s antes de -m)',
        comandos: ['useradd -s /usr/sbin/nologin -m portalbot'],
      },
      {
        nome: 'Forma 2: Opções longas padrão (--create-home --shell)',
        comandos: ['useradd --create-home --shell /usr/sbin/nologin portalbot'],
      },
      {
        nome: 'Forma 3: Nome do usuário intercalado',
        comandos: ['useradd -m portalbot -s /usr/sbin/nologin'],
      },
    ],
  },
];

const todasListas = [
  ...desafiosBasico,
  ...desafiosMedio,
  ...desafiosAvancado,
  ...desafiosEssentials,
  ...desafiosLPIC1,
  ...desafiosEscola,
];

describe('Validação de Formas Alternativas (Mínimo 3 formas fora o exemplo oficial)', () => {
  it('todos os casos alternativos referenciam desafios existentes no banco', () => {
    for (const caso of CASOS_ALTERNATIVOS) {
      const d = todasListas.find((item) => item.id === caso.id);
      expect(d, `Desafio com ID ${caso.id} não foi encontrado`).toBeDefined();
      expect(caso.alternativas.length).toBeGreaterThanOrEqual(3);
    }
  });

  for (const caso of CASOS_ALTERNATIVOS) {
    const desafio = todasListas.find((item) => item.id === caso.id) as Desafio;
    const modalidade = modalidades.find((m) => m.id === caso.modalidadeId) as ModalidadeSimulado;

    describe(`[${caso.id}] ${caso.descricao}`, () => {
      for (const alt of caso.alternativas) {
        it(`${alt.nome} deve validar e passar`, async () => {
          const { passou, saida } = await rodarSolucao(desafio, modalidade, alt.comandos);
          if (!passou) {
            console.error(`FALHA NA FORMA ALTERNATIVA [${caso.id}] ${alt.nome}:`, {
              comandos: alt.comandos,
              saida,
            });
          }
          expect(passou).toBe(true);
        });
      }
    });
  }
});
