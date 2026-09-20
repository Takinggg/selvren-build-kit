import { afterEach, describe, expect, it, vi } from "vitest";
import { SelvrenIntegrationClient, SelvrenIntegrationError, type IntegrationFetch } from "../src/index.js";
import { assertIntegrationOrigin } from "../src/origin.js";
import { TENANT_HEADER } from "../src/transport.js";
import {
  clientOf,
  DOC,
  headersOf,
  jsonResponse,
  ORIGIN,
  REQUEST,
  SPACE_A,
  TENANT,
  TOKEN,
} from "./helpers.js";

function fetchOf(response: Response): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(() => Promise.resolve(response.clone()));
}

afterEach(() => {
  vi.restoreAllMocks();
  const globalRecord = globalThis as { window?: unknown };
  delete globalRecord.window;
});

describe("origin restrictions", () => {
  it("accepts HTTPS and loopback HTTP and rejects userinfo, query, hash, path and cleartext WAN", () => {
    expect(assertIntegrationOrigin("https://api.example.test")).toBe("https://api.example.test");
    expect(assertIntegrationOrigin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(assertIntegrationOrigin("http://localhost")).toBe("http://localhost");
    expect(assertIntegrationOrigin("http://[::1]")).toBe("http://[::1]");
    expect(() => assertIntegrationOrigin("http://example.com")).toThrow(SelvrenIntegrationError);
    expect(() => assertIntegrationOrigin("https://user:pass@api.example.test")).toThrow(/origin/i);
    expect(() => assertIntegrationOrigin("https://api.example.test?token=secret")).toThrow(SelvrenIntegrationError);
    expect(() => assertIntegrationOrigin("https://api.example.test#selvren_int_abc")).toThrow(SelvrenIntegrationError);
    expect(() => assertIntegrationOrigin("https://api.example.test/v1")).toThrow(SelvrenIntegrationError);
  });
});

describe("browser construction", () => {
  it("rejects the credential client when a document window exists", () => {
    (globalThis as { window?: { document: object } }).window = { document: {} };
    expect(
      () =>
        new SelvrenIntegrationClient({
          baseUrl: ORIGIN,
          tenantId: TENANT,
          tokenProvider: () => TOKEN,
          fetch: fetchOf(jsonResponse({ request_id: "n", documents: [] })),
        }),
    ).toThrow(/server-only|BROWSER_FORBIDDEN/i);
  });

  it("rejects extra authority fields including end_user_ref", () => {
    expect(
      () =>
        new SelvrenIntegrationClient({
          baseUrl: ORIGIN,
          tenantId: TENANT,
          tokenProvider: () => TOKEN,
          fetch: fetchOf(jsonResponse({ request_id: "n", documents: [] })),
          end_user_ref: "visitor-1",
        } as never),
    ).toThrow(/actor|admin|authority/i);
  });
});

describe("headers, token placement, redirects", () => {
  it("sends Bearer and tenant header, never the token in the URL or x-tenant-id", async () => {
    const fetch = fetchOf(jsonResponse({ request_id: "l", documents: [DOC] }));
    await clientOf(fetch).listDocuments(SPACE_A);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toBe(`${ORIGIN}/v1/enterprise/spaces/${SPACE_A}/documents`);
    expect(url).not.toContain(TOKEN);
    expect(url).not.toMatch(/selvren_int_/);
    const headers = headersOf(fetch.mock.calls[0]?.[1]);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get(TENANT_HEADER.toLowerCase())).toBe(TENANT);
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(headers.get("tenant-id")).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("omit");
  });

  it("does not send a non-integration token", async () => {
    const fetch = fetchOf(jsonResponse({ request_id: "l", documents: [] }));
    await expect(clientOf(fetch, { token: "selvren_private_not_integration" }).listDocuments(SPACE_A)).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks redirects without following or retrying", async () => {
    const fetch = fetchOf(new Response(null, { status: 302, headers: { location: `https://evil.example/?t=${TOKEN}` } }));
    await expect(
      clientOf(fetch).query({ space_ids: [SPACE_A], question: "Q", client_request_id: REQUEST }),
    ).rejects.toMatchObject({ code: "REDIRECT_BLOCKED", retryGuidance: "none" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
});

describe("typed errors without leaking server text", () => {
  it("maps HTTP failures to static messages and does not retry", async () => {
    const fetch = fetchOf(
      jsonResponse({ request_id: "e", error: { code: "ENTERPRISE_ACCESS_DENIED", message: "token=selvren_int_leak" } }, 403),
    );
    const error = await clientOf(fetch)
      .query({ space_ids: [SPACE_A], question: "Q", client_request_id: REQUEST })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SelvrenIntegrationError);
    if (!(error instanceof SelvrenIntegrationError)) throw new Error("expected typed error");
    expect(error.code).toBe("ENTERPRISE_ACCESS_DENIED");
    expect(error.status).toBe(403);
    expect(error.retryGuidance).toBe("none");
    expect(error.message).toBe("Access was denied.");
    expect(error.message).not.toContain("selvren_int");
    expect(error.message).not.toContain(TOKEN);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
