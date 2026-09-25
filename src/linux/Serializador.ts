import { Acl, Arquivo, ArquivoGerado, Binario, Buraco, Compactado, Diretorio, Dispositivo, Link, type No } from './No';
import { Contas, Grupo, Usuario } from './Contas';
import { Maquina } from './Maquina';
import { Permissoes } from './Permissoes';
import { SistemaDeArquivos } from './SistemaDeArquivos';
import { Disco, Particao } from './Discos';

/** Um nó da árvore em JSON. "gerado" = conteúdo calculado das contas (/etc/passwd, /etc/group, /etc/shadow). */
export interface NoJson {
  nome: string;
  tipo: 'diretorio' | 'arquivo' | 'gerado' | 'nulo' | 'link' | 'dispositivo' | 'binario' | 'compactado';
  dono: number;
  grupo: number;
  /** Octal em texto: "755", "644", "1777". */
  permissoes: string;
  modificadoEm: string;
  conteudo?: string;
  filhos?: NoJson[];
  /** Links: para onde apontam. */
  alvo?: string;
  /** Dispositivos: c (caractere) ou b (bloco). */
  letra?: 'c' | 'b';
  /** Binários: tamanho em bytes. */
  bytes?: number;
  /** Compactados: formato (tar, tar.gz, gz, zip). */
  formato?: 'tar' | 'tar.gz' | 'gz' | 'zip';
  /** ACL: [[uid, perms]], [[gid, perms]] e a permissão do grupo dono. */
  acl?: { usuarios: Array<[number, number]>; grupos: Array<[number, number]>; grupoDono: number };
}

export interface UsuarioJson {
  nome: string;
  uid: number;
  gid: number;
  comentario: string;
  home: string;
  shell: string;
  senha: string | null;
  bloqueado: boolean;
}

export interface GrupoJson {
  nome: string;
  gid: number;
  membros: string[];
}

export interface ParticaoJson {
  nome: string;
  tamanhoGb: number;
  fs: 'ext4' | null;
  uuid: string | null;
  formatadaEm?: string | null;
  raiz?: NoJson | null;
}

export interface DiscoJson {
  nome: string;
  tamanhoGb: number;
  detectadoEm: number;
  particoes: ParticaoJson[];
}

export interface MontagemJson {
  dispositivo: string;
  ponto: string;
}

export interface MaquinaJson {
  formato: 'exame-so/maquina';
  versao: 1;
  hostname: string;
  contas: { usuarios: UsuarioJson[]; grupos: GrupoJson[] };
  raiz: NoJson;
  discos?: DiscoJson[];
  montagens?: MontagemJson[];
}

/** Converte a máquina inteira (árvore + contas) de/para JSON. As sessões abertas não são salvas. */
export class Serializador {
  public static paraJson(maquina: Maquina): MaquinaJson {
    const serializarNo = (no: No): NoJson => {
      const original = maquina.discos.originalDe(no);
      return Serializador.noParaJson(original ?? no, serializarNo);
    };

    return {
      formato: 'exame-so/maquina',
      versao: 1,
      hostname: maquina.hostname,
      contas: {
        usuarios: maquina.contas.listarUsuarios().map((u: Usuario) => ({
          nome: u.nome, uid: u.uid, gid: u.gid, comentario: u.comentario, home: u.home, shell: u.shell, senha: u.senha, bloqueado: u.bloqueado,
        })),
        grupos: maquina.contas.listarGrupos().map((g: Grupo) => ({ nome: g.nome, gid: g.gid, membros: g.membros.slice() })),
      },
      raiz: serializarNo(maquina.fs.raiz),
      discos: maquina.discos.listar().map((d: Disco) => ({
        nome: d.nome,
        tamanhoGb: d.tamanhoGb,
        detectadoEm: d.detectadoEm,
        particoes: d.particoes.map((p: Particao) => ({
          nome: p.nome,
          tamanhoGb: p.tamanhoGb,
          fs: p.fs,
          uuid: p.uuid,
          formatadaEm: p.formatadaEm ? p.formatadaEm.toISOString() : null,
          raiz: p.raiz ? Serializador.noParaJson(p.raiz) : null,
        })),
      })),
      montagens: maquina.discos.listarMontagens().map((m) => ({
        dispositivo: m.dispositivo,
        ponto: m.ponto,
      })),
    };
  }

  public static deJson(json: MaquinaJson): Maquina {
    if (json.formato !== 'exame-so/maquina' || json.versao !== 1) {
      throw new Error('Arquivo JSON não é uma máquina do simulador (formato/versão desconhecidos).');
    }
    const contas: Contas = new Contas();
    for (const u of json.contas.usuarios) {
      const usuario: Usuario = new Usuario(u.nome, u.uid, u.gid, u.home, u.shell, u.senha, u.comentario);
      usuario.bloqueado = u.bloqueado;
      contas.adicionarUsuario(usuario);
    }
    for (const g of json.contas.grupos) {
      contas.adicionarGrupo(new Grupo(g.nome, g.gid, g.membros.slice()));
    }
    const maquina: Maquina = new Maquina(new SistemaDeArquivos(new Diretorio('', 0, 0, 0o755)), contas);
    const raiz: Diretorio = maquina.fs.raiz;
    Serializador.aplicarMetadados(raiz, json.raiz);
    for (const filho of json.raiz.filhos ?? []) {
      raiz.adicionar(Serializador.noDeJson(filho, maquina));
    }

    // Restaura discos
    if (json.discos && json.discos.length > 0) {
      for (const dJson of json.discos) {
        const d = new Disco(dJson.nome, dJson.tamanhoGb, dJson.detectadoEm);
        d.particoes = (dJson.particoes ?? []).map((pJson) => {
          const p = new Particao(pJson.nome, pJson.tamanhoGb);
          p.fs = pJson.fs;
          p.uuid = pJson.uuid;
          if (pJson.formatadaEm) p.formatadaEm = new Date(pJson.formatadaEm);
          if (pJson.raiz) {
            p.raiz = Serializador.noDeJson(pJson.raiz, maquina) as Diretorio;
          }
          return p;
        });
        maquina.discos.adicionarDisco(d);
      }
    } else {
      maquina.montarDiscos();
    }

    // Remonta partições salvas
    if (json.montagens) {
      for (const mJson of json.montagens) {
        const p = maquina.discos.particao(mJson.dispositivo);
        if (p) {
          maquina.discos.montar(p, mJson.ponto);
        }
      }
    }

    return maquina;
  }

  private static noParaJson(no: No, transformar?: (n: No) => NoJson): NoJson {
    const fn = transformar ?? ((n: No) => Serializador.noParaJson(n, transformar));
    const base = {
      nome: no.nome,
      dono: no.dono,
      grupo: no.grupo,
      permissoes: Permissoes.paraOctal(no.modo),
      modificadoEm: no.modificadoEm.toISOString(),
      ...(no.acl !== null ? { acl: { usuarios: Array.from(no.acl.usuarios), grupos: Array.from(no.acl.grupos), grupoDono: no.acl.grupoDono } } : {}),
    };
    if (no instanceof Diretorio) {
      return { ...base, tipo: 'diretorio', filhos: no.nomesOrdenados().map((n: string) => fn(no.obter(n) as No)) };
    }
    if (no instanceof ArquivoGerado) return { ...base, tipo: 'gerado' };
    if (no instanceof Binario) return { ...base, tipo: 'binario', bytes: no.bytes };
    if (no instanceof Compactado) return { ...base, tipo: 'compactado', formato: no.formato, conteudo: no.dados };
    if (no instanceof Buraco) return { ...base, tipo: 'nulo' };
    if (no instanceof Dispositivo) return { ...base, tipo: 'dispositivo', letra: no.letra };
    if (no instanceof Link) return { ...base, tipo: 'link', alvo: no.alvo };
    return { ...base, tipo: 'arquivo', conteudo: (no as Arquivo).ler() };
  }

  private static noDeJson(json: NoJson, maquina: Maquina): No {
    const modo: number = parseInt(json.permissoes, 8);
    let no: No;
    switch (json.tipo) {
      case 'diretorio': {
        const dir: Diretorio = new Diretorio(json.nome, json.dono, json.grupo, modo);
        for (const filho of json.filhos ?? []) dir.adicionar(Serializador.noDeJson(filho, maquina));
        no = dir;
        break;
      }
      case 'gerado':
        no = maquina.criarArquivoGerado(json.nome) ?? new Arquivo(json.nome, json.dono, json.grupo, modo);
        break;
      case 'nulo':
        no = new Buraco(json.nome, json.dono, json.grupo, modo);
        break;
      case 'dispositivo':
        no = new Dispositivo(json.nome, json.letra ?? 'c', json.dono, json.grupo, modo);
        break;
      case 'compactado':
        no = new Compactado(json.nome, json.formato ?? 'gz', json.conteudo ?? '', json.dono, json.grupo, modo);
        break;
      case 'binario':
        no = new Binario(json.nome, json.bytes ?? 0, json.dono, json.grupo, modo);
        break;
      case 'link':
        no = new Link(json.nome, json.alvo ?? '/', json.dono, json.grupo);
        break;
      default:
        no = new Arquivo(json.nome, json.dono, json.grupo, modo, json.conteudo ?? '');
    }
    Serializador.aplicarMetadados(no, json);
    return no;
  }

  private static aplicarMetadados(no: No, json: NoJson): void {
    no.dono = json.dono;
    no.grupo = json.grupo;
    no.modo = parseInt(json.permissoes, 8);
    no.modificadoEm = new Date(json.modificadoEm);
    if (json.acl !== undefined) {
      const acl: Acl = new Acl(json.acl.grupoDono);
      for (const [uid, p] of json.acl.usuarios) acl.usuarios.set(uid, p);
      for (const [gid, p] of json.acl.grupos) acl.grupos.set(gid, p);
      no.acl = acl;
    }
  }
}
