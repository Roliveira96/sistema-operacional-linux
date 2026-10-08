// User-facing interface text (Portuguese, per ARCHITECTURE.md section 4.4).
// Components read every visible string from here.
export const messages = {
  app: {
    name: "Linux na Prática",
    tagline: "Plataforma de ensino e avaliação de Sistemas Operacionais — UTFPR Guarapuava",
  },
  theme: {
    switchToDark: "Ativar tema escuro",
    switchToLight: "Ativar tema claro",
  },
  health: {
    title: "Estado da plataforma",
    loading: "Verificando os serviços…",
    retry: "Verificar novamente",
    version: "Versão",
    checkedAt: "Verificado em",
    status: {
      HEALTHY: "Operacional",
      DEGRADED: "Operando com limitações",
      UNHEALTHY: "Indisponível",
    },
    components: {
      postgres: "Banco de dados",
      minio: "Armazenamento de arquivos",
      smtp: "Envio de e-mail",
    } as Record<string, string>,
    latency: (ms: number) => `${ms} ms`,
    networkError: "Não foi possível contatar o servidor. Verifique sua conexão.",
    unexpectedError: "Ocorreu um erro inesperado.",
  },
} as const;
