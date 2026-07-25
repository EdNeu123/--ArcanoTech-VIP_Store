import { describe, expect, it } from "vitest";
import {
  buildRequestCanonical,
  buildResponseCanonical,
  hmacHex,
  safeEqual,
  sha256Hex,
  signRequest,
  signResponse,
} from "../hmac";

describe("sha256Hex", () => {
  it("bate com o hash conhecido de string vazia", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("é sensível a qualquer byte do corpo", () => {
    const a = sha256Hex('{"a":1}');
    const b = sha256Hex('{"a":2}');
    expect(a).not.toBe(b);
  });
});

describe("canonical strings", () => {
  it("monta o canonical de request na ordem correta", () => {
    const canonical = buildRequestCanonical("POST", "/api/x", "1720000000", "nonce-1", "deadbeef");
    expect(canonical).toBe("POST\n/api/x\n1720000000\nnonce-1\ndeadbeef");
  });

  it("monta o canonical de response na ordem correta", () => {
    const canonical = buildResponseCanonical("1720000000", "nonce-1", 200, "deadbeef");
    expect(canonical).toBe("1720000000\nnonce-1\n200\ndeadbeef");
  });
});

describe("signRequest / verificação simétrica", () => {
  const secret = "segredo-de-teste";

  it("a mesma requisição gera sempre a mesma assinatura", () => {
    const params = {
      secret,
      method: "POST",
      path: "/api/v1/minecraft/fulfillments/claim",
      timestamp: "1720000000",
      nonce: "abc-123",
      rawBody: JSON.stringify({ server_id: "arcanotech", limit: 20 }),
    };
    expect(signRequest(params)).toBe(signRequest(params));
  });

  it("qualquer mudança no corpo muda a assinatura (detecta adulteração)", () => {
    const base = {
      secret,
      method: "POST",
      path: "/api/v1/minecraft/fulfillments/claim",
      timestamp: "1720000000",
      nonce: "abc-123",
    };
    const sig1 = signRequest({ ...base, rawBody: '{"limit":20}' });
    const sig2 = signRequest({ ...base, rawBody: '{"limit":21}' });
    expect(sig1).not.toBe(sig2);
  });

  it("mudar o path invalida a assinatura (protege contra reuso em outra rota)", () => {
    const base = {
      secret,
      method: "POST",
      timestamp: "1720000000",
      nonce: "abc-123",
      rawBody: "{}",
    };
    const sigClaim = signRequest({ ...base, path: "/api/v1/minecraft/fulfillments/claim" });
    const sigComplete = signRequest({
      ...base,
      path: "/api/v1/minecraft/fulfillments/some-id/complete",
    });
    expect(sigClaim).not.toBe(sigComplete);
  });

  it("secret errado nunca bate com o esperado", () => {
    const params = {
      method: "POST",
      path: "/api/v1/minecraft/fulfillments/claim",
      timestamp: "1720000000",
      nonce: "abc-123",
      rawBody: "{}",
    };
    const sigA = signRequest({ ...params, secret: "segredo-A" });
    const sigB = signRequest({ ...params, secret: "segredo-B" });
    expect(sigA).not.toBe(sigB);
  });
});

describe("signResponse", () => {
  it("amarra a resposta ao mesmo nonce da requisição", () => {
    const secret = "segredo";
    const sig = signResponse({
      secret,
      timestamp: "1720000100",
      nonce: "abc-123",
      statusCode: 200,
      rawBody: '{"ok":true}',
    });
    const recomputed = hmacHex(
      secret,
      buildResponseCanonical("1720000100", "abc-123", 200, sha256Hex('{"ok":true}'))
    );
    expect(sig).toBe(recomputed);
  });

  it("status code diferente gera assinatura diferente", () => {
    const params = {
      secret: "segredo",
      timestamp: "1720000100",
      nonce: "abc-123",
      rawBody: '{"ok":true}',
    };
    const sig200 = signResponse({ ...params, statusCode: 200 });
    const sig409 = signResponse({ ...params, statusCode: 409 });
    expect(sig200).not.toBe(sig409);
  });
});

describe("safeEqual", () => {
  it("compara strings iguais como verdadeiro", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("compara strings diferentes (mesmo tamanho) como falso", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("compara strings de tamanhos diferentes como falso, sem lançar erro", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });
});
