import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountMachine } from "../testkit";
import type { TerminalWindow } from "../terminalWindow";

let win: TerminalWindow;
beforeAll(async () => {
  win = await mountMachine();
});
afterAll(() => {
  win.destroy();
  document.body.innerHTML = "";
});

const run = (command: string) => win.execute({ command });
const lines = async (command: string, status = 0) => {
  const result = await run(command);
  expect(result.status).toBe(status);
  return result.output === "" ? [] : result.output.split("\n");
};

// Covers SPEC-028 CA-02, CA-04, CA-05, CA-09, CA-10 for the network commands (RN-05, RN-07). ping belongs to SPEC-029.
describe("ip, ifconfig and nslookup (CA-10)", () => {
  it("ip shows the addresses of the machine, the same as hostname -I", async () => {
    const [address] = await lines("hostname -I");
    const output = (await lines("ip a")).join("\n");
    expect(output).toContain(`inet ${address}/24`);
    expect(output).toContain("1: lo: <LOOPBACK,UP,LOWER_UP>");
    expect(output).toContain("2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP>");
    expect(await lines("ip addr")).toEqual(await lines("ip address show"));
    const brief = await lines("ip -br a");
    expect(brief[0]).toMatch(/^lo\s+UNKNOWN\s+127\.0\.0\.1\/8$/);
    expect(brief[1]).toMatch(new RegExp(`^eth0\\s+UP\\s+${address!.replace(/\./g, "\\.")}/24$`));
    expect((await lines("ip a show eth0")).join("\n")).not.toContain("lo:");
    expect((await run("ip a show eth9")).status).toBe(1);
  });

  it("ip shows the routes and the links, and refuses what it does not know", async () => {
    const [address] = await lines("hostname -I");
    expect(await lines("ip route")).toEqual([
      `default via 192.168.0.1 dev eth0 proto dhcp src ${address} metric 100`,
      `192.168.0.0/24 dev eth0 proto kernel scope link src ${address} metric 100`,
    ]);
    expect((await lines("ip -br link"))[1]).toContain("52:54:00:12:34:56");
    expect((await lines("ip link"))[0]).toContain("mtu 65536");
    expect((await run("ip foo")).status).toBe(1);
    expect((await run("ip")).status).toBe(255);
    expect((await run("ip -z a")).status).toBe(1);
  });

  it("ifconfig shows the interfaces in the format of net-tools", async () => {
    const [address] = await lines("hostname -I");
    const all = (await lines("ifconfig")).join("\n");
    expect(all).toContain(`inet ${address}  netmask 255.255.255.0`);
    expect(all).toContain("lo: flags=73<UP,LOOPBACK,RUNNING>");
    expect((await lines("ifconfig lo")).join("\n")).not.toContain("eth0");
    expect((await run("ifconfig eth9")).status).toBe(1);
  });

  it("nslookup answers for the known names and says NXDOMAIN for the others", async () => {
    expect((await lines("nslookup google.com")).join("\n")).toContain("Address: 142.250.80.46");
    expect((await lines("nslookup localhost")).join("\n")).toContain("Address: 127.0.0.1");
    expect((await lines("nslookup")).join("\n")).toContain("127.0.0.53#53");
    const missing = await run("nslookup zzz.invalid");
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("NXDOMAIN");
  });
});

describe("ssh", () => {
  it("shows its version, and sends the connections to the tabs of the terminal", async () => {
    expect((await lines("ssh -V"))[0]).toContain("OpenSSH_9.6");
    expect((await run("ssh")).status).toBe(255);
    const connect = await run("ssh ana@servidor");
    expect(connect.status).toBe(255);
    expect(connect.output).toContain("abas do terminal");
  });
});

describe("services in the network commands: ss and wget", () => {
  it("ss lists the sockets of the active services, with numbers, names and the process", async () => {
    const before = (await lines("ss -tuln")).join("\n");
    expect(before).toMatch(/^Netid\s+State\s+Recv-Q\s+Send-Q\s+Local Address:Port\s+Peer Address:Port/);
    expect(before).toContain("127.0.0.53%lo:53");
    expect(before).not.toContain("0.0.0.0:80");
    await run("apt install -y nginx");
    await run("systemctl start nginx");
    const after = (await lines("ss -tln")).join("\n");
    expect(after).toContain("0.0.0.0:80");
    expect(after).toContain("[::]:80");
    expect(after).not.toContain("Netid");
    expect((await lines("ss -tl")).join("\n")).toContain("0.0.0.0:http");
    expect((await lines("ss -tlnp")).join("\n")).toMatch(/users:\(\("nginx",pid=\d+,fd=3\)\)/);
    expect((await lines("ss -H -tln")).join("\n")).not.toContain("State");
    expect(await lines("ss")).toHaveLength(1);
    await run("systemctl stop nginx");
    expect((await lines("ss -tln")).join("\n")).not.toContain("0.0.0.0:80");
  });

  it("wget fails when nobody listens, downloads from nginx and from the fixed names", async () => {
    await run("mkdir -p /tmp/w && cd /tmp/w");
    expect((await lines("wget -V"))[0]).toBe("GNU Wget 1.21.4 construído em linux-gnu.");
    const refused = await run("wget http://localhost");
    expect(refused.status).toBe(4);
    expect(refused.output).toContain("Conexão recusada");
    await run("systemctl start nginx");
    const ok = await run("wget http://localhost");
    expect(ok.status).toBe(0);
    expect(ok.output).toContain("200 OK");
    expect(ok.output).toContain("“index.html” salvo");
    expect((await lines("cat index.html")).join("\n")).toContain("Welcome to nginx!");
    expect(await lines("wget -q -O - http://ubuntu.com")).toEqual(["<html><head><title>ubuntu.com</title></head></html>"]);
    expect(await lines("wget -q -O pagina.html http://ubuntu.com/sobre/")).toEqual([]);
    expect((await lines("cat pagina.html"))[0]).toContain("ubuntu.com");
    expect(await lines("wget -q http://ubuntu.com/arquivo.txt && ls arquivo.txt")).toEqual(["arquivo.txt"]);
    expect((await run("wget -q http://zzz.invalid")).status).toBe(4);
    expect((await run("wget")).status).toBe(1);
    expect((await run("wget -q -O /nada/x.html http://ubuntu.com")).status).toBe(3);
    await run("cd /root");
  });
});

describe("ufw (RN-05, CA-09)", () => {
  it("is off at first, takes rules as root and keeps them in /etc/ufw", async () => {
    expect(await lines("ufw status")).toEqual(["Status: inativo"]);
    expect((await lines("ufw enable"))[0]).toBe("O firewall está ativo e habilitado na inicialização do sistema");
    expect(await lines("ufw allow 22/tcp")).toEqual(["Regra adicionada"]);
    expect(await lines("ufw allow http")).toEqual(["Regra adicionada"]);
    expect(await lines("ufw allow 22/tcp")).toEqual(["Pulando a adição de uma regra que já existe"]);
    await run("ufw deny 3306");
    const status = (await lines("ufw status")).join("\n");
    expect(status).toContain("Status: ativo");
    expect(status).toMatch(/22\/tcp\s+ALLOW\s+Anywhere/);
    expect(status).toMatch(/80\/tcp\s+ALLOW\s+Anywhere/);
    expect(status).toMatch(/3306\s+DENY\s+Anywhere/);
    expect((await lines("ufw status numbered")).join("\n")).toContain("[ 1] 22/tcp");
    expect((await lines("cat /etc/ufw/ufw.conf"))[0]).toBe("ENABLED=yes");
    expect((await lines("cat /etc/ufw/user.rules")).join("\n")).toContain("allow 22/tcp");
  });

  it("deletes rules, changes the default policy and turns off", async () => {
    expect(await lines("ufw delete allow 22/tcp")).toEqual(["Regra excluída"]);
    expect(await lines("ufw delete allow 22/tcp")).toEqual(["Não foi possível excluir uma regra inexistente"]);
    expect((await lines("ufw default allow incoming"))[0]).toBe("A política de entrada padrão foi alterada para 'allow'");
    expect((await lines("ufw default deny outgoing"))[0]).toBe("A política de saída padrão foi alterada para 'deny'");
    expect((await lines("ufw status verbose")).join("\n")).toContain("Padrão: allow (entrada), deny (saída)");
    expect((await lines("ufw disable"))[0]).toBe("O firewall está parado e desabilitado na inicialização do sistema");
    expect(await lines("ufw status")).toEqual(["Status: inativo"]);
    expect((await run("ufw allow foo")).status).toBe(1);
    expect((await run("ufw default maybe")).status).toBe(1);
    expect((await run("ufw")).status).toBe(1);
    expect((await run("ufw dance")).status).toBe(1);
  });

  it("refuses a user that is not root", async () => {
    await run("useradd -m ana");
    await win.execute({ command: "passwd ana", answers: ["123", "123"] });
    const result = await win.execute({ command: "ufw status", terminal: 2, login: { user: "ana", password: "123" } });
    expect(result.status).toBe(1);
    expect(result.output).toContain("ERRO: Você precisa ser root");
  });

  it("keeps the state when the machine is serialized and restored (CA-15)", async () => {
    await run("ufw enable");
    await run("ufw allow 8080/tcp");
    win.reset(win.snapshot());
    expect((await lines("ufw status")).join("\n")).toMatch(/8080\/tcp\s+ALLOW\s+Anywhere/);
    expect((await lines("which ufw"))[0]).toBe("/usr/sbin/ufw");
  });
});
