import { afterEach, describe, expect, it, vi } from "vitest";
import * as browser from "../src/browser.js";
import type { IntegrationFetch } from "../src/index.js";
import { TENANT_HEADER } from "../src/transport.js";
import {
  AGENT,
  AGENT_ANSWER,
  AGENT_OTHER,
  jsonBody,
  jsonResponse,
  ORIGIN,
  REQUEST,
  SESSION_JWT,
  TOKEN,
} from "./helpers.js";

function fetchOf(response: Response): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(() => Promise.resolve(response.clone()));
}

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function inFlightFetch(): {
  fetch: ReturnType<typeof vi.fn<IntegrationFetch>>;
  started: Promise<void>;
} {
  let notifyStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const fetch = vi.fn<IntegrationFetch>((_input: string, init: RequestInit) => {
    notifyStarted();
    return new Promise<Response>((_resolve, reject) => {
      const abort = (): void => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      const signal = init.signal;
      if (signal === undefined || signal === null) return;
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  });
  return { fetch, started };
}

afterEach(() => {
  vi.restoreAllMocks();
  const globalRecord = globalThis as { window?: unknown };
  delete globalRecord.window;
});

describe("createSessionAgentTransport", () => {
  it("forwards the Clerk access token without tenant, cookies, or claimed user authority", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    const answer = await transport.query({ question: "Combien ?", clientRequestId: REQUEST });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ORIGIN}/v1/enterprise/agents/${AGENT}/query`);
    const headers = headersOf(fetch.mock.calls[0]?.[1]);
    expect(headers.get("authorization")).toBe(`Bearer ${SESSION_JWT}`);
    expect(headers.get(TENANT_HEADER.toLowerCase())).toBeNull();
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("omit");
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    const body = jsonBody(fetch.mock.calls[0]?.[1]) as Record<string, unknown>;
    expect(body).toEqual({
      client_request_id: REQUEST,
      revision: "published",
      question: "Combien ?",
    });
    expect(body.end_user_ref).toBeUndefined();
    expect(body.actor).toBeUndefined();
    expect(answer.text).toBe("Deux boulons.");
    expect(answer.requestId).toBe("q-1");
    expect(answer.revisionChanged).toBeUndefined();
  });

  it("maps revision_changed onto AgentAnswer.revisionChanged", async () => {
    const fetch = fetchOf(jsonResponse({ ...AGENT_ANSWER, revision_changed: true }));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    const answer = await transport.query({ question: "Combien ?", clientRequestId: REQUEST });
    expect(answer.revisionChanged).toBe(true);
    expect(answer.text).toBe("Deux boulons.");
  });

  it("snapshots the question and clientRequestId before awaiting the access token", async () => {
    let resolveToken: (value: string) => void = () => undefined;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => token,
      fetch,
    });
    const request = { question: "Combien ?", clientRequestId: REQUEST };
    const pending = transport.query(request);
    request.question = "Changed";
    request.clientRequestId = "33333333-3333-4333-8333-333333333333";
    resolveToken(SESSION_JWT);
    await pending;
    expect(jsonBody(fetch.mock.calls[0]?.[1])).toEqual({
      client_request_id: REQUEST,
      revision: "published",
      question: "Combien ?",
    });
  });

  it("sends a draft revision only when the constructor requested it", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      revision: "draft",
      fetch,
    });
    await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(jsonBody(fetch.mock.calls[0]?.[1])).toMatchObject({ revision: "draft" });
  });

  it("rejects service tokens before fetch and does not treat a user string as authentication", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const service = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => TOKEN,
      fetch,
    });
    await expect(service.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    const privateToken = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => `selvren_private_${"B".repeat(32)}`,
      fetch,
    });
    await expect(privateToken.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    const userString = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => "user_abc",
      fetch,
    });
    await expect(userString.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("rejects an invalid agent id at construction without fetching", () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    expect(() =>
      browser.createSessionAgentTransport({
        baseUrl: ORIGIN,
        agentId: "agt_NOTHEX",
        getAccessToken: () => SESSION_JWT,
        fetch,
      }),
    ).toThrow(/agt_/);
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("rejects tenant, actor, admin, and end_user_ref options", () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    expect(() =>
      browser.createSessionAgentTransport({
        baseUrl: ORIGIN,
        agentId: AGENT,
        getAccessToken: () => SESSION_JWT,
        fetch,
        end_user_ref: "visitor-1",
      } as never),
    ).toThrow(/tenant|actor|admin|authority/i);
    expect(() =>
      browser.createSessionAgentTransport({
        baseUrl: ORIGIN,
        agentId: AGENT,
        getAccessToken: () => SESSION_JWT,
        fetch,
        tenantId: "company_example",
      } as never),
    ).toThrow(/tenant|actor|admin|authority/i);
  });

  it("is constructible in a document window and still rejects a mismatched agent_id", async () => {
    (globalThis as { window?: { document: object } }).window = { document: {} };
    const fetch = fetchOf(jsonResponse({ ...AGENT_ANSWER, agent_id: AGENT_OTHER }));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("blocks redirects without following", async () => {
    const fetch = fetchOf(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "REDIRECT_BLOCKED",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("aborts an in-flight session query without a second fetch", async () => {
    const { fetch, started } = inFlightFetch();
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    const ac = new AbortController();
    const pending = transport.query({ question: "Q", clientRequestId: REQUEST, signal: ac.signal });
    await started;
    expect(fetch).toHaveBeenCalledTimes(1);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when the session query signal is already aborted", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => SESSION_JWT,
      fetch,
    });
    const ac = new AbortController();
    ac.abort();
    await expect(
      transport.query({ question: "Q", clientRequestId: REQUEST, signal: ac.signal }),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(0);
  });
});
