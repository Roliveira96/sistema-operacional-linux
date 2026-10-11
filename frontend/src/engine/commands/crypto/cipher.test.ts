import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { utf8 } from "./bytes";
import { aesDecrypt, aesEncrypt, bytesToKey, CIPHERS, pbkdf2 } from "./cipher";

// Covers SPEC-031 CA-04 and CA-05: AES, PBKDF2 and EVP_BytesToKey give what the Node library (and OpenSSL) give.
const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const iv = Uint8Array.from({ length: 16 }, (_, i) => 15 - i);
const message = utf8("aula de criptografia: a mesma entrada com a mesma chave dá sempre a mesma saída");

describe("AES", () => {
  it.each(Object.keys(CIPHERS))("%s encrypts as Node does and decrypts back", async (name) => {
    const cipher = CIPHERS[name]!;
    const theKey = key.slice(0, cipher.keyLength);
    const mine = await aesEncrypt(cipher, theKey, iv, message);
    const node = createCipheriv(name, theKey, iv);
    const theirs = Buffer.concat([node.update(message), node.final()]);
    expect(Buffer.from(mine).toString("hex")).toBe(theirs.toString("hex"));
    expect(Array.from((await aesDecrypt(cipher, theKey, iv, mine))!)).toEqual(Array.from(message));
    const decipher = createDecipheriv(name, theKey, iv);
    expect(Buffer.concat([decipher.update(mine), decipher.final()]).toString()).toBe(new TextDecoder().decode(message));
  });

  it("fails to decrypt with the wrong key (CA-04)", async () => {
    const cipher = CIPHERS["aes-256-cbc"]!;
    const encrypted = await aesEncrypt(cipher, key, iv, message);
    const wrong = key.map((byte) => byte ^ 1);
    let failures = 0;
    for (let attempt = 0; attempt < 5; attempt++) if ((await aesDecrypt(cipher, wrong.map((byte) => byte ^ attempt), iv, encrypted)) === null) failures++;
    expect(failures).toBeGreaterThanOrEqual(4);
  });
});

describe("key derivation", () => {
  it("PBKDF2 gives the Node result for the digests it supports", async () => {
    const salt = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    for (const [hash, nodeName] of [["sha1", "sha1"], ["sha256", "sha256"], ["sha384", "sha384"], ["sha512", "sha512"]] as const) {
      const mine = await pbkdf2(utf8("senha"), salt, 10000, hash, 48);
      expect(Buffer.from(mine!).toString("hex")).toBe(pbkdf2Sync("senha", Buffer.from(salt), 10000, 48, nodeName).toString("hex"));
    }
    expect(await pbkdf2(utf8("senha"), salt, 10, "md5", 16)).toBeNull();
  });

  it("EVP_BytesToKey gives the key and the vector of the old openssl enc", async () => {
    const salt = Uint8Array.of(8, 7, 6, 5, 4, 3, 2, 1);
    const mine = await bytesToKey("md5", utf8("senha"), salt, 48);
    // The definition: D1 = MD5(password + salt), D2 = MD5(D1 + password + salt), D3 = MD5(D2 + password + salt).
    const d1 = createHash("md5").update("senha").update(salt).digest();
    const d2 = createHash("md5").update(d1).update("senha").update(salt).digest();
    const d3 = createHash("md5").update(d2).update("senha").update(salt).digest();
    expect(Buffer.from(mine).toString("hex")).toBe(Buffer.concat([d1, d2, d3]).toString("hex"));
    expect(Array.from(await bytesToKey("sha256", utf8("x"), null, 10))).toHaveLength(10);
  });
});
