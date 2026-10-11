import { arquivosSuites } from "./suites/arquivos";
import { pacotesSuites } from "./suites/pacotes";
import { processosSuites } from "./suites/processos";
import { programasSuites } from "./suites/programas";
import { redeSuites } from "./suites/rede";
import { shellSuites } from "./suites/shell";
import { sistemaSuites } from "./suites/sistema";
import { textoSuites } from "./suites/texto";
import { usuariosSuites } from "./suites/usuarios";
import type { ConformanceSuite } from "./types";

/**
 * The manifest of conformance (SPEC-030): one suite of cases for each command and program of the engine, kept in one file per group (see suites/).
 * Every suite starts from the lab of SPEC-028 in /tmp/lab (see LAB_SETUP), so none depends on another. A new, renamed or removed command or program changes
 * this list in the same commit; a test compares it with the real catalog (RN-07, RN-08).
 */
export const manifest: ConformanceSuite[] = [
  ...arquivosSuites,
  ...textoSuites,
  ...shellSuites,
  ...processosSuites,
  ...redeSuites,
  ...usuariosSuites,
  ...pacotesSuites,
  ...sistemaSuites,
  ...programasSuites,
];
