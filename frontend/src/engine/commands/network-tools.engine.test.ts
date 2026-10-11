import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
  win.setInstant(true);
  await win.execute({ command: "cd /tmp/lab" });
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string) => win.execute({ command });

// Covers SPEC-033 CA-01: the five commands exist and show a help that starts by Uso.
describe("the help of the network commands (CA-01)", () => {
  it.each(["ping", "traceroute", "netstat", "dig", "scp"])("%s --help shows the usage", async (name) => {
    const result = await run(`${name} --help`);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Uso: " + name);
  });
});

// Covers SPEC-033 CA-02, CA-03 (RN-02): ping.
describe("ping", () => {
  it("sends the packets asked for and summarises them", async () => {
    const result = await run("ping -c 3 -i 0.01 localhost");
    expect(result.status).toBe(0);
    expect(result.output).toContain("PING localhost (127.0.0.1) 56(84) bytes of data.");
    expect(result.output).toContain("64 bytes from 127.0.0.1: icmp_seq=3 ttl=64");
    expect(result.output).toContain("3 packets transmitted, 3 received, 0% packet loss");
    expect(result.output).toMatch(/rtt min\/avg\/max\/mdev = [\d.]+\/[\d.]+\/[\d.]+\/[\d.]+ ms/);
  });

  it("gives the same times every time and only the summary with -q", async () => {
    const first = (await run("ping -c 2 -i 0.01 google.com")).output;
    expect((await run("ping -c 2 -i 0.01 google.com")).output).toBe(first);
    expect(first).toContain("ttl=117");
    const quiet = (await run("ping -q -c 2 -i 0.01 google.com")).output;
    expect(quiet).not.toContain("icmp_seq=1 ttl");
    expect(quiet).toContain("2 packets transmitted, 2 received");
  });

  it("refuses a name it cannot resolve and gives up on an address nobody answers", async () => {
    const unknown = await run("ping -c 1 nao-existe.invalid");
    expect(unknown.status).toBe(2);
    expect(unknown.output).toContain("Nome ou serviço desconhecido");
    const lost = await run("ping -c 2 -i 0.01 10.9.9.9");
    expect(lost.status).toBe(1);
    expect(lost.output).toContain("100% packet loss");
    expect(lost.output).toContain("Destination Host Unreachable");
    expect((await run("ping")).status).toBe(2);
    expect((await run("ping -c 0 localhost")).status).toBe(2);
  });

  it("stops in a pipe after 4 packets, and runs until it is killed in the background", async () => {
    const piped = await run("ping -i 0.01 localhost | grep -c icmp_seq");
    expect(piped.output.trim()).toBe("4");
    await run("ping -i 0.2 localhost > /dev/null &");
    expect((await run("pgrep ping")).status).toBe(0);
    await run("pkill ping");
    expect((await run("pgrep ping")).status).toBe(1);
  });
});

// Covers SPEC-033 CA-04 (RN-03): traceroute.
describe("traceroute", () => {
  it("shows 4 hops to the internet, the last one the destination", async () => {
    const result = await run("traceroute google.com");
    expect(result.status).toBe(0);
    expect(result.output).toContain("traceroute to google.com (142.250.80.46), 30 hops max, 60 byte packets");
    const hops = result.output.split("\n").slice(1);
    expect(hops).toHaveLength(4);
    expect(hops[3]).toContain("google.com (142.250.80.46)");
  });

  it("shows only the addresses with -n, cuts the hops with -m and refuses what it does not know", async () => {
    expect((await run("traceroute -n 8.8.8.8")).output).not.toContain("_gateway");
    expect((await run("traceroute -m 2 google.com")).output.split("\n")).toHaveLength(3);
    expect((await run("traceroute localhost | wc -l")).output.trim()).toBe("2");
    expect((await run("traceroute nao-existe.invalid")).status).toBe(2);
    expect((await run("traceroute -m 0 localhost")).status).toBe(2);
    expect((await run("traceroute")).status).toBe(2);
  });
});

// Covers SPEC-033 CA-05 (RN-04): netstat.
describe("netstat", () => {
  it("lists the port of ssh while the service runs and not when it is stopped", async () => {
    await run("sudo systemctl start ssh");
    const on = await run("netstat -tln");
    expect(on.status).toBe(0);
    expect(on.output).toContain("Active Internet connections (only servers)");
    expect(on.output).toMatch(/tcp\s+0\s+0 0\.0\.0\.0:22\s+0\.0\.0\.0:\*\s+LISTEN/);
    await run("sudo systemctl stop ssh");
    expect((await run("netstat -tln")).output).not.toContain(":22 ");
    await run("sudo systemctl start ssh");
  });

  it("names the services, shows the process with -p, only UDP with -u and the routes with -r", async () => {
    expect((await run("netstat -tl")).output).toContain("0.0.0.0:ssh");
    expect((await run("netstat -tlnp")).output).toContain("/sshd");
    const udp = (await run("netstat -uln")).output;
    expect(udp).toContain("udp");
    expect(udp).not.toContain("tcp");
    const routes = (await run("netstat -r")).output;
    expect(routes).toContain("Kernel IP routing table");
    expect(routes).toMatch(/0\.0\.0\.0\s+192\.168\.0\.1\s+0\.0\.0\.0\s+UG/);
    expect((await run("netstat")).output).toContain("w/o servers");
    expect((await run("netstat -z")).status).toBe(1);
  });
});

// Covers SPEC-033 CA-06 (RN-05): dig.
describe("dig", () => {
  it("answers the address of a known name, in the long and in the short form", async () => {
    const long = await run("dig google.com");
    expect(long.status).toBe(0);
    expect(long.output).toContain("status: NOERROR");
    expect(long.output).toContain(";; ANSWER SECTION:");
    expect(long.output).toMatch(/google\.com\.\s+300\s+IN\s+A\s+142\.250\.80\.46/);
    expect((await run("dig +short google.com")).output.trim()).toBe("142.250.80.46");
    expect((await run("dig @8.8.8.8 ubuntu.com")).output).toContain("SERVER: 8.8.8.8#53(8.8.8.8)");
  });

  it("says NXDOMAIN for an unknown name, no answer for the other types, and the usage with no name", async () => {
    const unknown = await run("dig nao-existe.invalid");
    expect(unknown.status).toBe(0);
    expect(unknown.output).toContain("status: NXDOMAIN");
    expect(unknown.output).not.toContain("ANSWER SECTION");
    expect((await run("dig +short nao-existe.invalid")).output).toBe("");
    expect((await run("dig google.com MX")).output).not.toContain("ANSWER SECTION");
    expect((await run("dig")).status).toBe(1);
    expect((await run("dig -z google.com")).status).toBe(1);
  });
});

// Covers SPEC-033 CA-07 (RN-06): scp.
describe("scp", () => {
  it("copies a file to the machine itself while ssh runs, and shows the progress", async () => {
    await run("sudo systemctl start ssh");
    await run("echo conteudo > origem.txt");
    const result = await run("scp origem.txt localhost:/tmp/copia.txt");
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/origem\.txt\s+100%\s+9/);
    expect((await run("cat /tmp/copia.txt")).output).toBe("conteudo");
    expect((await run("scp -q origem.txt localhost:/tmp/outra.txt")).output).toBe("");
  });

  it("brings a file back and copies a folder only with -r", async () => {
    await run("mkdir -p pasta-scp && echo x > pasta-scp/a.txt");
    const refused = await run("scp pasta-scp localhost:/tmp/");
    expect(refused.status).toBe(1);
    expect(refused.output).toContain("not a regular file");
    expect((await run("scp -r pasta-scp localhost:/tmp/")).status).toBe(0);
    expect((await run("cat /tmp/pasta-scp/a.txt")).output).toBe("x");
    expect((await run("scp localhost:/tmp/copia.txt trazido.txt")).status).toBe(0);
    expect((await run("cat trazido.txt")).output).toBe("conteudo");
  });

  it("refuses an unknown machine, one it cannot reach, a stopped ssh, a missing file and a missing target", async () => {
    expect((await run("scp origem.txt nao-existe.invalid:/tmp/")).output).toContain("Could not resolve hostname");
    expect((await run("scp origem.txt google.com:/tmp/")).status).toBe(255);
    expect((await run("scp nada.txt localhost:/tmp/")).output).toContain("No such file or directory");
    expect((await run("scp origem.txt localhost:/nao/existe/x")).status).toBe(1);
    expect((await run("scp origem.txt")).status).toBe(1);
    await run("sudo systemctl stop ssh");
    const refused = await run("scp origem.txt localhost:/tmp/");
    expect(refused.status).toBe(255);
    expect(refused.output).toContain("Connection refused");
    await run("sudo systemctl start ssh");
  });
});
