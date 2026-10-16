import { printsOnTerminal } from "./output";
import type { EngineCommand, EngineContext } from "./types";

const FOLLOW_MS = 400;

/** The file to follow: the first operand, skipping the options and the values of -n and -c. */
function followedFile(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-n" || arg === "-c") i++;
    else if (arg === "--") return args[i + 1] ?? null;
    else if (arg === "-" || !arg.startsWith("-")) return arg;
  }
  return null;
}

/**
 * tail -f (SPEC-029 CA-01): the tail of the engine takes the file name as the value of -f and ends at once, without following anything. This one
 * shows the end of the file as the original does, and then goes on showing what is written to it until Ctrl+C or a kill. Without -f the original runs as it is.
 */
export function makeTail(original: EngineCommand): EngineCommand {
  return {
    ...original,
    async executar(args: string[], context: EngineContext): Promise<number> {
      const follow = args.some((arg) => arg === "-f" || arg === "--follow");
      if (!follow) return original.executar(args, context);

      const rest = args.filter((arg) => arg !== "-f" && arg !== "--follow");
      const status = await original.executar(rest, context);
      const path = followedFile(rest);
      // In a pipe or a file the engine collects everything before the next command starts, so following would never end (as with yes and watch).
      if (status !== 0 || path === null || path === "-" || !printsOnTerminal(context)) return status;

      const read = (): string | null => {
        try {
          const node = (context as unknown as { tentarLocalizar(path: string): { ehDiretorio(): boolean; ler?(): string } | null }).tentarLocalizar(path);
          return node && !node.ehDiretorio() && node.ler ? node.ler() : null;
        } catch {
          return null;
        }
      };
      let seen = read()?.length ?? 0;
      while (await context.dormir(FOLLOW_MS)) {
        const text = read();
        if (text === null || text.length === seen) continue;
        const news = text.length > seen ? text.slice(seen) : text; // a file that was written again from the start is shown whole
        for (const line of news.replace(/\n$/, "").split("\n")) context.linha(line);
        seen = text.length;
      }
      return 0;
    },
  };
}
