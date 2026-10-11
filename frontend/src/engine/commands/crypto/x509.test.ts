import { createPublicKey, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateEd25519, generateRsa, privatePem, publicOf, publicPem, type PrivateKey } from "./pki";
import { certificatePem, checkSignature, colonHex, createRequest, dateText, findExtension, issueCertificate, nameText, parseCertificate, parseRequest, parseSubject, requestPem } from "./x509";
import { OID } from "./pki";

// Covers SPEC-031 CA-08: the certificates are real, and Node reads, checks and fingerprints them like OpenSSL would.
const subject = (text: string) => parseSubject(text)!;

describe("subjects", () => {
  it("reads the -subj form and refuses what is not it", () => {
    expect(parseSubject("/C=BR/ST=PR/O=UTFPR/CN=aula.local")!.map((attribute) => attribute.value)).toEqual(["BR", "PR", "UTFPR", "aula.local"]);
    expect(parseSubject("/CN=a=b")![0]!.value).toBe("a=b");
    expect(parseSubject("/emailAddress=a@b.c")![0]!.value).toBe("a@b.c");
    expect(parseSubject("CN=sem barra")).toBeNull();
    expect(parseSubject("/XX=valor")).toBeNull();
  });
});

describe("self-signed certificates", () => {
  it("are read by Node, which finds the subject, the dates, the key and a valid signature", async () => {
    const rsa = await generateRsa(2048);
    const key: PrivateKey = { type: "rsa", rsa };
    const now = new Date(Date.UTC(2026, 9, 10, 12, 0, 0));
    const derBytes = await issueCertificate({ subject: subject("/C=BR/O=UTFPR/CN=aula.local"), subjectKey: publicOf(key), signer: key, issuerName: null, issuerKeyId: null, days: 365, hash: "sha256", isCa: true, now });
    const pem = certificatePem(derBytes);
    const node = new X509Certificate(pem);
    expect(node.subject.split("\n")).toEqual(["C=BR", "O=UTFPR", "CN=aula.local"]);
    expect(node.issuer).toBe(node.subject);
    expect(new Date(node.validFrom).toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(new Date(node.validTo).toISOString()).toBe("2027-10-10T12:00:00.000Z");
    expect(node.ca).toBe(true);
    expect(node.verify(createPublicKey(publicPem(publicOf(key))))).toBe(true);
    expect(node.fingerprint).toBe(colonHex(new Uint8Array(await crypto.subtle.digest("SHA-1", derBytes as BufferSource))));
    const mine = parseCertificate(pem)!;
    expect(mine.version).toBe(3);
    expect(nameText(mine.subjectNode)).toBe("C = BR, O = UTFPR, CN = aula.local");
    expect(nameText(mine.issuerNode)).toBe("C = BR, O = UTFPR, CN = aula.local");
    expect(mine.notBefore.toISOString()).toBe("2026-10-10T12:00:00.000Z");
    expect(mine.signatureLabel).toBe("sha256WithRSAEncryption");
    expect(mine.publicKey?.type).toBe("rsa");
    expect(findExtension(mine, OID.basicConstraints)?.critical).toBe(true);
    expect(await checkSignature(mine.tbs, mine.signatureOid, mine.signature, mine.publicKey)).toBe(true);
    expect(await checkSignature(new Uint8Array(mine.tbs.length), mine.signatureOid, mine.signature, mine.publicKey)).toBe(false);
    expect(dateText(mine.notBefore)).toBe("Oct 10 12:00:00 2026 GMT");
    expect(parseCertificate("lixo")).toBeNull();
    expect(parseCertificate("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n")).toBeNull();
  });

  it("an Ed25519 certificate is read by Node and its signature checks", async () => {
    const key = (await generateEd25519())!;
    const derBytes = await issueCertificate({ subject: subject("/CN=ed"), subjectKey: publicOf(key), signer: key, issuerName: null, issuerKeyId: null, days: 30, hash: "sha256", isCa: false });
    const node = new X509Certificate(certificatePem(derBytes));
    expect(node.verify(createPublicKey(publicPem(publicOf(key))))).toBe(true);
    const mine = parseCertificate(certificatePem(derBytes))!;
    expect(mine.signatureLabel).toBe("ED25519");
    expect(await checkSignature(mine.tbs, mine.signatureOid, mine.signature, mine.publicKey)).toBe(true);
    expect(await checkSignature(mine.tbs, mine.signatureOid, mine.signature, { type: "rsa", n: 3n, e: 3n })).toBe(false);
    expect(await checkSignature(mine.tbs, mine.signatureOid, mine.signature, null)).toBe(false);
  });
});

describe("requests and authorities (CA-08)", () => {
  it("a request signed by the owner is signed again by an authority, and the chain checks out", async () => {
    const caKey: PrivateKey = { type: "rsa", rsa: await generateRsa(2048) };
    const userKey: PrivateKey = { type: "rsa", rsa: await generateRsa(2048) };
    const caDer = await issueCertificate({ subject: subject("/O=UTFPR/CN=Autoridade"), subjectKey: publicOf(caKey), signer: caKey, issuerName: null, issuerKeyId: null, days: 3650, hash: "sha256", isCa: true });
    const ca = parseCertificate(certificatePem(caDer))!;
    const csrText = requestPem(await createRequest(subject("/C=BR/CN=servidor.local"), userKey, "sha256"));
    expect(csrText.startsWith("-----BEGIN CERTIFICATE REQUEST-----")).toBe(true);
    const csr = parseRequest(csrText)!;
    expect(nameText(csr.subjectNode)).toBe("C = BR, CN = servidor.local");
    expect(await checkSignature(csr.info, csr.signatureOid, csr.signature, csr.publicKey)).toBe(true);
    const keyId = findExtension(ca, OID.subjectKeyId)!.value.slice(2);
    const issuedDer = await issueCertificate({
      subject: subject("/C=BR/CN=servidor.local"),
      subjectKey: csr.publicKey!,
      signer: caKey,
      issuerName: ca.issuerNode.bytes,
      issuerKeyId: keyId,
      days: 90,
      hash: "sha256",
      isCa: false,
    });
    const issued = new X509Certificate(certificatePem(issuedDer));
    expect(issued.checkIssued(new X509Certificate(certificatePem(caDer)))).toBe(true);
    expect(issued.verify(createPublicKey(publicPem(publicOf(caKey))))).toBe(true);
    expect(issued.verify(createPublicKey(publicPem(publicOf(userKey))))).toBe(false);
    expect(issued.ca).toBe(false);
    expect(parseRequest("lixo")).toBeNull();
    expect(privatePem(caKey)).toContain("BEGIN PRIVATE KEY");
  });

  it("uses the other digests when asked", async () => {
    const key: PrivateKey = { type: "rsa", rsa: await generateRsa(1024) };
    for (const hash of ["sha1", "sha384", "sha512"] as const) {
      const derBytes = await issueCertificate({ subject: subject("/CN=h"), subjectKey: publicOf(key), signer: key, issuerName: null, issuerKeyId: null, days: 1, hash, isCa: false });
      expect(new X509Certificate(certificatePem(derBytes)).verify(createPublicKey(publicPem(publicOf(key))))).toBe(true);
    }
  });
});
