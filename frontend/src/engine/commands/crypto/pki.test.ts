import { constants, createPrivateKey, createPublicKey, createSign, createVerify, publicEncrypt, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bigFromBytes, bytesFromBig, pemDecode, utf8 } from "./bytes";
import { digest } from "./hashing";
import {
  children,
  ed25519Sign,
  ed25519Verify,
  generateEd25519,
  generateRsa,
  int,
  oid,
  oidValue,
  parse,
  parsePrivateKey,
  parsePublicKey,
  privatePem,
  publicOf,
  publicPem,
  rsaDecryptOaep,
  rsaDecryptV15,
  rsaEncryptOaep,
  rsaEncryptV15,
  rsaSign,
  rsaSignDigest,
  rsaVerify,
  rsaVerifyDigest,
  seq,
  time,
  utf8String,
} from "./pki";

// Covers SPEC-031 RN-01: the keys and signatures are the real ones, and the Node library agrees with them.
describe("DER", () => {
  it("encodes integers, identifiers, strings and times as the standard says", () => {
    expect(Array.from(int(0))).toEqual([2, 1, 0]);
    expect(Array.from(int(128))).toEqual([2, 2, 0, 128]);
    expect(Array.from(int(65537))).toEqual([2, 3, 1, 0, 1]);
    expect(Array.from(oid("1.2.840.113549.1.1.11"))).toEqual([6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 11]);
    expect(oidValue(parse(oid("2.5.4.3")))).toBe("2.5.4.3");
    expect(oidValue(parse(oid("1.3.101.112")))).toBe("1.3.101.112");
    expect(Array.from(utf8String("oi"))).toEqual([12, 2, 111, 105]);
    expect(new TextDecoder().decode(time(new Date(Date.UTC(2026, 9, 10, 12, 30, 5))).slice(2))).toBe("261010123005Z");
    expect(new TextDecoder().decode(time(new Date(Date.UTC(2051, 0, 2, 3, 4, 5))).slice(2))).toBe("20510102030405Z");
  });

  it("uses long forms for the lengths over 127 and reads them back", () => {
    const big = seq(utf8String("x".repeat(300)));
    expect(big[1]).toBe(0x82);
    expect(parse(big).content.length).toBe(304);
    expect(children(parse(seq(int(1), int(2)))).map((node) => Number(bigFromBytes(node.content)))).toEqual([1, 2]);
    expect(() => parse(Uint8Array.of(0x30, 5, 1))).toThrow();
  });
});

describe("RSA keys and signatures", () => {
  it("a generated key writes PKCS#8 that Node reads, and reading it back gives the same key", async () => {
    const rsa = await generateRsa(2048);
    const pem = privatePem({ type: "rsa", rsa });
    expect(pem.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
    expect(createPrivateKey(pem).asymmetricKeyType).toBe("rsa");
    const back = await parsePrivateKey(pem);
    expect(back?.type === "rsa" && back.rsa.n === rsa.n && back.rsa.d === rsa.d).toBe(true);
    const publicText = publicPem(publicOf({ type: "rsa", rsa }));
    expect(publicText.startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);
    expect(createPublicKey(publicText).asymmetricKeyType).toBe("rsa");
    expect((await parsePublicKey(publicText))?.type).toBe("rsa");
    expect((await parsePublicKey(pem))?.type).toBe("rsa");
  });

  it("reads the PKCS#1 form that Node writes", async () => {
    const rsa = await generateRsa(1024);
    const pkcs1 = createPrivateKey(privatePem({ type: "rsa", rsa })).export({ type: "pkcs1", format: "pem" }) as string;
    expect(pkcs1.startsWith("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    const back = await parsePrivateKey(pkcs1);
    expect(back?.type === "rsa" && back.rsa.n === rsa.n).toBe(true);
    const publicPkcs1 = createPublicKey(pkcs1).export({ type: "pkcs1", format: "pem" }) as string;
    expect((await parsePublicKey(publicPkcs1))?.type).toBe("rsa");
    expect(await parsePrivateKey("lixo")).toBeNull();
    expect(await parsePublicKey("lixo")).toBeNull();
    expect(await parsePrivateKey("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n")).toBeNull();
  });

  it("signs in a way Node verifies, and verifies what Node signs, for each digest", async () => {
    const rsa = await generateRsa(2048);
    const nodeKey = createPrivateKey(privatePem({ type: "rsa", rsa }));
    const message = utf8("mensagem de aula");
    for (const [hash, nodeName] of [["sha1", "SHA1"], ["sha256", "SHA256"], ["sha384", "SHA384"], ["sha512", "SHA512"]] as const) {
      const mine = await rsaSign(rsa, hash, message);
      const verifier = createVerify(nodeName);
      verifier.update(message);
      expect(verifier.verify(nodeKey, mine)).toBe(true);
      const signer = createSign(nodeName);
      signer.update(message);
      const theirs = new Uint8Array(signer.sign(nodeKey));
      expect(await rsaVerify(rsa, hash, message, theirs)).toBe(true);
      expect(await rsaVerify(rsa, hash, utf8("outra"), theirs)).toBe(false);
    }
    const digestOnly = rsaSignDigest(rsa, "sha256", await digest("sha256", message));
    expect(rsaVerifyDigest(rsa, "sha256", await digest("sha256", message), digestOnly)).toBe(true);
    expect(rsaVerifyDigest(rsa, "sha256", await digest("sha256", message), digestOnly.slice(1))).toBe(false);
  });

  it("encrypts with PKCS#1 v1.5 and OAEP and decrypts them, and decrypts what Node encrypts", async () => {
    const rsa = await generateRsa(2048);
    const nodePublic = createPublicKey(publicPem(publicOf({ type: "rsa", rsa })));
    const message = utf8("segredo da aula");
    const v15 = rsaEncryptV15(rsa, message)!;
    expect(v15).toHaveLength(256);
    expect(Array.from(rsaDecryptV15(rsa, v15)!)).toEqual(Array.from(message));
    expect(rsaDecryptV15(rsa, v15.slice(1))).toBeNull();
    const theirs = new Uint8Array(publicEncrypt({ key: nodePublic, padding: constants.RSA_PKCS1_PADDING }, message));
    expect(Array.from(rsaDecryptV15(rsa, theirs)!)).toEqual(Array.from(message));
    expect(rsaEncryptV15(rsa, new Uint8Array(250))).toBeNull();
    const oaep = (await rsaEncryptOaep(rsa, "sha256", message))!;
    expect(Array.from((await rsaDecryptOaep(rsa, "sha256", oaep))!)).toEqual(Array.from(message));
    expect(await rsaDecryptOaep(rsa, "sha1", oaep)).toBeNull();
    expect(await rsaEncryptOaep(rsa, "md5", message)).toBeNull();
    expect(bytesFromBig(300n)).toEqual(Uint8Array.of(1, 44));
    expect(pemDecode(publicPem(publicOf({ type: "rsa", rsa })))?.label).toBe("PUBLIC KEY");
  });
});

describe("Ed25519", () => {
  it("generates a key Node reads, and signs and verifies in both directions", async () => {
    const key = await generateEd25519();
    expect(key?.type).toBe("ed25519");
    if (key?.type !== "ed25519") return;
    const pem = privatePem(key);
    expect(createPrivateKey(pem).asymmetricKeyType).toBe("ed25519");
    const back = await parsePrivateKey(pem);
    expect(back?.type === "ed25519" && Array.from(back.pub).join() === Array.from(key.pub).join()).toBe(true);
    const publicText = publicPem(publicOf(key));
    expect(createPublicKey(publicText).asymmetricKeyType).toBe("ed25519");
    const parsed = await parsePublicKey(publicText);
    expect(parsed?.type).toBe("ed25519");
    const message = utf8("assinar");
    const mine = await ed25519Sign(key, message);
    expect(nodeVerify(null, message, createPublicKey(publicText), mine)).toBe(true);
    const theirs = new Uint8Array(nodeSign(null, message, createPrivateKey(pem)));
    expect(await ed25519Verify(key.pub, message, theirs)).toBe(true);
    expect(await ed25519Verify(key.pub, utf8("outra"), theirs)).toBe(false);
  });
});
