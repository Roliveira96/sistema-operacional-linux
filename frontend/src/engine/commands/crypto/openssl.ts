import type { EngineCommand, EngineContext } from "../types";
import { dgst, enc, passwd, rand, refuseNetwork } from "./openssl-basic";
import { req, verify, x509 } from "./openssl-certs";
import { genpkey, genrsa, pkeyCommand, pkeyutl, rsaCommand } from "./openssl-keys";

// The openssl command of the engine: the real work of the subcommands, the version of the one that already existed (SPEC-031).

type Subcommand = (args: string[], context: EngineContext) => Promise<number> | number;

const SUBCOMMANDS: Record<string, Subcommand> = {
  rand, dgst, enc, passwd, genrsa, genpkey, rsa: rsaCommand, pkey: pkeyCommand, pkeyutl, req, x509, verify,
  s_client: refuseNetwork("s_client"),
  s_server: refuseNetwork("s_server"),
  speed: refuseNetwork("speed"),
};

export function createOpenssl(original: EngineCommand): EngineCommand {
  return {
    nome: original.nome,
    resumo: "ferramentas de criptografia: hashes, cifras, chaves, certificados",
    embutido: original.embutido,
    ajuda: {
      uso: "openssl SUBCOMANDO [opções]",
      descricao: "Caixa de ferramentas de criptografia. No simulador funcionam: version, rand, dgst, enc, passwd, genrsa, genpkey, rsa, pkey, pkeyutl, req, x509 e verify. Tudo roda de verdade, com os mesmos formatos do Ubuntu.",
      h: "ajuda",
      opcoes: [
        ["version", "mostra a versão instalada"],
        ["dgst -sha256 ARQ", "calcula o resumo (hash) de um arquivo"],
        ["enc -aes-256-cbc -pbkdf2 -in A -out B", "cifra (ou decifra, com -d) um arquivo com senha"],
        ["genrsa -out chave.pem 2048", "gera uma chave privada RSA"],
        ["req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -subj /CN=aula", "gera um certificado autoassinado"],
        ["verify -CAfile ca.pem cert.pem", "confere se o certificado foi assinado pela CA"],
      ],
      exemplos: [
        ["openssl rand -hex 16", "16 bytes aleatórios, em hexadecimal"],
        ["openssl dgst -sha256 arquivo.txt", "resumo SHA-256 do arquivo"],
      ],
    },
    executar: async (args, context) => {
      const [name, ...rest] = args;
      if (name === undefined || name === "version") return original.executar(args, context);
      const run = SUBCOMMANDS[name];
      if (!run) {
        context.falhar(`Invalid command '${name}'; type "help" for a list.`);
        return 1;
      }
      return run(rest, context);
    },
  };
}
