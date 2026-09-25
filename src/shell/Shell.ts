import { RegistroDeComandos } from './RegistroDeComandos';
import { Interpretador } from './Interpretador';
import { Cd, Ls, Pwd, Tree } from './comandos/Navegacao';
import { Mkdir, Rmdir } from './comandos/Diretorios';
import { Cat, Cp, Echo, Editor, Ln, Mv, Printf, Stat, Touch } from './comandos/Arquivos';
import { Apt, AptCache, AptGet, Dpkg } from './comandos/Pacotes';
import { Df, Free, Lsblk, LsbRelease, Service, Systemctl, Which } from './comandos/Sistema';
import { Cowsay, Curl, Git, Htop, Mysql, Neofetch, Nginx, Openssl, Python3 } from './comandos/Programas';
import { Cut, Grep, Head, Sort, Tail, Wc } from './comandos/Texto';
import { Rm } from './comandos/Exclusao';
import { Chgrp, Chmod, Chown, Getfacl, Setfacl, Umask } from './comandos/Acesso';
import { Adduser, Deluser, Getent, Groups, Id, Passwd, Useradd, Userdel, Usermod, Whoami } from './comandos/Usuarios';
import { Delgroup, Gpasswd, Groupadd, Groupdel, Groupmod } from './comandos/Grupos';
import { Exit, Su, Sudo } from './comandos/Privilegios';
import { Ajuda, Clear, Date_, History, Hostname, Man, Uname, Who } from './comandos/Utilitarios';
import { Alias, Bash, Env, Export, Read, Set_, Shift, Sleep, Source, Test, Type, Unalias, Unset, Verdadeiro } from './comandos/Embutidos';
import { Bg, Fg, Jobs, Kill, Killall, Nohup, Ps, Top, Uptime, Wait } from './comandos/Processos';
import { Awk, Sed, Tee, Tr, Uniq, Xargs } from './comandos/TextoAvancado';
import { Du, Find } from './comandos/Busca';
import { Gzip, Rsync, Tar, Unzip, Zip } from './comandos/Compactacao';

/** Monta o registro com todos os comandos e devolve um interpretador novo (um por terminal). */
export class Shell {
  private static registro: RegistroDeComandos | null = null;

  public static criarInterpretador(): Interpretador {
    return new Interpretador(Shell.obterRegistro());
  }

  public static obterRegistro(): RegistroDeComandos {
    if (Shell.registro === null) {
      const registro: RegistroDeComandos = new RegistroDeComandos();
      registro.registrar(
        new Pwd(), new Cd(), new Ls(), new Tree(),
        new Mkdir(), new Rmdir(),
        new Touch(), new Cat(), new Echo(), new Cp(), new Mv(), new Stat(), new Ln(), new Printf(),
        new Apt(), new AptGet(), new AptCache(), new Dpkg(),
        new Systemctl(), new Service(), new Which(), new LsbRelease(), new Df(), new Free(), new Lsblk(),
        new Htop(), new Neofetch(), new Cowsay(), new Git(), new Curl(), new Nginx(), new Mysql(), new Python3(), new Openssl(),
        new Editor('nano'), new Editor('vim'), new Editor('vi'),
        new Head(), new Tail(), new Wc(), new Grep(), new Sort(), new Cut(),
        new Rm(),
        new Chmod(), new Chown(), new Chgrp(), new Umask(), new Setfacl(), new Getfacl(),
        new Whoami(), new Id(), new Groups(), new Useradd(), new Adduser('adduser'), new Adduser('addgroup'),
        new Userdel(), new Deluser(), new Usermod(), new Passwd(), new Getent(),
        new Groupadd(), new Groupdel(), new Groupmod(), new Gpasswd(), new Delgroup(),
        new Sudo(), new Su(), new Exit('exit'), new Exit('logout'),
        new Clear(), new History(), new Hostname(), new Date_(), new Uname(), new Who(),
        new Ajuda(registro), new Man(registro),
        new Export(), new Unset(), new Set_(), new Env('env'), new Env('printenv'), new Alias(), new Unalias(),
        new Source('source'), new Source('.'), new Read(), new Test('test'), new Test('['), new Test('[['),
        new Verdadeiro('true'), new Verdadeiro('false'), new Verdadeiro(':'), new Shift(), new Type(),
        new Bash('bash'), new Bash('sh'), new Sleep(),
        new Ps(), new Top(), new Kill(), new Killall('killall'), new Killall('pkill'), new Killall('pgrep'),
        new Jobs(), new Fg(), new Bg(), new Wait(), new Nohup(), new Uptime(),
        new Tee(), new Xargs(), new Uniq(), new Tr(), new Sed(), new Awk(), new Find(), new Du(),
        new Tar(), new Gzip('gzip'), new Gzip('gunzip'), new Gzip('zcat'), new Zip(), new Unzip(), new Rsync(),
      );
      Shell.registro = registro;
    }
    return Shell.registro;
  }
}
