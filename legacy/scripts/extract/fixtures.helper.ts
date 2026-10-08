// Small hand-built machine states for unit tests.
import type { MaquinaJson, NoJson } from '../../src/linux/Serializador';

export function dir(nome: string, filhos: NoJson[] = [], permissoes = '755', dono = 0, grupo = 0): NoJson {
  return { nome, tipo: 'diretorio', dono, grupo, permissoes, modificadoEm: '2026-01-01T00:00:00.000Z', filhos };
}

export function file(nome: string, conteudo: string, permissoes = '644', dono = 0, grupo = 0): NoJson {
  return { nome, tipo: 'arquivo', dono, grupo, permissoes, modificadoEm: '2026-01-01T00:00:00.000Z', conteudo };
}

export function link(nome: string, alvo: string): NoJson {
  return { nome, tipo: 'link', dono: 0, grupo: 0, permissoes: '777', modificadoEm: '2026-01-01T00:00:00.000Z', alvo };
}

export function machine(raizFilhos: NoJson[]): MaquinaJson {
  return {
    formato: 'exame-so/maquina',
    versao: 1,
    hostname: 'test',
    contas: {
      usuarios: [
        { nome: 'root', uid: 0, gid: 0, comentario: 'root', home: '/root', shell: '/bin/bash', senha: 'x', bloqueado: false },
        { nome: 'ana', uid: 1001, gid: 1001, comentario: 'Ana', home: '/home/ana', shell: '/bin/sh', senha: null, bloqueado: true },
      ],
      grupos: [
        { nome: 'root', gid: 0, membros: [] },
        { nome: 'ana', gid: 1001, membros: [] },
        { nome: 'dev', gid: 2000, membros: ['ana'] },
      ],
    },
    raiz: dir('', raizFilhos),
  };
}

export const sample: MaquinaJson = machine([
  dir('home', [dir('ana', [file('notas.txt', 'Linux é demais\n', '640', 1001, 2000), dir('vazia')], '750', 1001, 1001)]),
  dir('srv', [dir('uploads', [], '1777')]),
  dir('etc', [
    dir('systemd', [dir('system', [dir('multi-user.target.wants', [link('nginx.service', '/usr/lib/systemd/system/nginx.service')])])]),
  ]),
  dir('run', [dir('systemd', [dir('ativos', [file('nginx', '')])])]),
  dir('var', [
    dir('lib', [
      dir('dpkg', [file('status', 'Package: htop\nStatus: install ok installed\n\nPackage: vim\nStatus: deinstall ok config-files\n')]),
      dir('apt', [dir('lists', [file('br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease', '')])]),
    ]),
  ]),
  link('atalho', '/home/ana'),
]);
