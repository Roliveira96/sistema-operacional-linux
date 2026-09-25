export type CodigoDeErro = 'ENOENT' | 'EACCES' | 'ENOTDIR' | 'EEXIST' | 'EISDIR' | 'ENOTEMPTY' | 'EPERM' | 'EINVAL';

/** Erro do "kernel": carrega o código e a mensagem que o Ubuntu em pt_BR mostraria. */
export class ErroDeSistema extends Error {
  private static readonly MENSAGENS: Record<CodigoDeErro, string> = {
    ENOENT: 'Arquivo ou diretório inexistente',
    EACCES: 'Permissão negada',
    ENOTDIR: 'Não é um diretório',
    EEXIST: 'Arquivo existe',
    EISDIR: 'É um diretório',
    ENOTEMPTY: 'Diretório não vazio',
    EPERM: 'Operação não permitida',
    EINVAL: 'Argumento inválido',
  };

  public readonly codigo: CodigoDeErro;

  constructor(codigo: CodigoDeErro) {
    super(ErroDeSistema.MENSAGENS[codigo]);
    this.codigo = codigo;
  }
}
