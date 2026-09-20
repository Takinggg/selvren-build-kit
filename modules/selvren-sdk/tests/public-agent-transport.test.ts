import { afterEach, describe, expect, it, vi } from "vitest";
import * as browser from "../src/browser.js";
import {
  isRetryableAgentError,
  shouldReuseClientRequestId,
  type IntegrationFetch,
} from "../src/index.js";
import { JSON_TIMEOUT_MS } from "../src/http-core.js";
import { TENANT_HEADER } from "../src/transport.js";
import {
  headersOf,
  jsonBody,
  jsonResponse,
  MESSAGE,
  CLIENT,
  ORIGIN,
  PUBLIC_ANSWER,
  PUBLIC_SESSION,
  PUBLIC_TOKEN,
  RELEASE,
  REQUEST,
  TOKEN,
} from "./helpers.js";

type FetchHandler = (input: string, init: RequestInit) => Response | Promise<Response>;

function publicFetch(
  session: Response | FetchHandler,
  query: Response | FetchHandler = jsonResponse(PUBLIC_ANSWER),
): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(async (input: string, init: RequestInit) => {
    if (input.endsWith("/sessions")) {
      return typeof session === "function" ? session(input, init) : session.clone();
    }
    if (input.endsWith("/query")) {
      return typeof query === "function" ? query(input, init) : query.clone();
    }
    throw new Error(`unexpected url ${input}`);
  });
}

function errorBody(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ request_id: "e", error: { code, message: extra.message ?? "server" }, ...extra }, status);
}

function transportOf(fetch: IntegrationFetch, extra: Record<string, unknown> = {}) {
  return browser.createPublicAgentTransport({
    baseUrl: ORIGIN,
    releaseId: RELEASE,
    fetch,
    ...extra,
  });
}

function locallyPastExpiry(ttlMs: number): { expiresAt: string; dateHeader: string } {
  const serverNowMs = Date.now() - 4 * 60 * 60 * 1000;
  const dateHeader = new Date(serverNowMs).toUTCString();
  return {
    expiresAt: new Date(Date.parse(dateHeader) + ttlMs).toISOString(),
    dateHeader,
  };
}

function hangUntilAbort(_input: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
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
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function promiseWithNotify(): { promise: Promise<void>; notify: () => void } {
  let notify = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    notify = resolve;
  });
  return { promise, notify };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const globalRecord = globalThis as { window?: unknown };
  delete globalRecord.window;
});

describe("createPublicAgentTransport", () => {
  it("mints once then queries with Bearer pss, no tenant, cookies, Origin spoof, or private fields", async () => {
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201));
    const transport = transportOf(fetch, { language: "fr" });
    const answer = await transport.query({ question: "Combien ?", clientRequestId: REQUEST });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ORIGIN}/v1/public/agents/${RELEASE}/sessions`);
    expect(String(fetch.mock.calls[1]?.[0])).toBe(`${ORIGIN}/v1/public/agents/${RELEASE}/query`);
    expect(jsonBody(fetch.mock.calls[0]?.[1])).toEqual({});
    expect(jsonBody(fetch.mock.calls[1]?.[1])).toEqual({
      client_request_id: REQUEST,
      question: "Combien ?",
      language: "fr",
    });
    const mintHeaders = headersOf(fetch.mock.calls[0]?.[1]);
    const queryHeaders = headersOf(fetch.mock.calls[1]?.[1]);
    expect(mintHeaders.get("authorization")).toBeNull();
    expect(queryHeaders.get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
    expect(queryHeaders.get(TENANT_HEADER.toLowerCase())).toBeNull();
    expect(queryHeaders.get("x-tenant-id")).toBeNull();
    expect(queryHeaders.get("origin")).toBeNull();
    expect(fetch.mock.calls[1]?.[1]?.credentials).toBe("omit");
    expect(fetch.mock.calls[1]?.[1]?.redirect).toBe("manual");
    expect(String(fetch.mock.calls[1]?.[0])).not.toContain(PUBLIC_TOKEN);
    expect(answer).toEqual({
      requestId: "pub-1",
      text: "Deux boulons.",
      outcome: "answered",
      citations: [{ id: "1", documentName: "note.txt", excerpt: "Deux boulons.", location: "p.1" }],
    });
    expect(answer.citations[0]).not.toHaveProperty("url");
    expect(transport.sessionState()).toMatchObject({
      status: "ready",
      turnsRemaining: 4,
      expiresAt: PUBLIC_SESSION.expires_at,
      canStartNewConversation: true,
    });
  });

  it("maps public sources by index and ignores private document ids and urls", async () => {
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({
        ...PUBLIC_ANSWER,
        sources: [
          {
            index: 2,
            label: "guide.pdf",
            excerpt: " vis ",
            location: "§2",
            document_id: "doc_private",
            url: "https://files.example.test/secret",
          },
        ],
      }),
    );
    const answer = await transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.citations).toEqual([
      { id: "2", documentName: "guide.pdf", excerpt: " vis ", location: "§2" },
    ]);
    expect(JSON.stringify(answer)).not.toContain("doc_private");
    expect(JSON.stringify(answer)).not.toContain("https://files.example.test/secret");
  });

  it("allows empty sources on insufficient_evidence", async () => {
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({
        ...PUBLIC_ANSWER,
        outcome: "insufficient_evidence",
        answer: "Pas assez de sources.",
        sources: [],
        turns_remaining: 3,
      }),
    );
    const answer = await transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.outcome).toBe("insufficient_evidence");
    expect(answer.citations).toEqual([]);
  });

  it("snapshots the question before awaiting mint", async () => {
    let resolveMint: (value: Response) => void = () => undefined;
    const fetch = publicFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveMint = resolve;
        }),
    );
    const transport = transportOf(fetch);
    const request = { question: "Combien ?", clientRequestId: REQUEST };
    const pending = transport.query(request);
    request.question = "Changed";
    request.clientRequestId = MESSAGE;
    resolveMint(jsonResponse(PUBLIC_SESSION, 201));
    await pending;
    expect(jsonBody(fetch.mock.calls[1]?.[1])).toEqual({
      client_request_id: REQUEST,
      question: "Combien ?",
    });
  });

  it("single-flights mint across concurrent queries and keeps one session token", async () => {
    let resolveMint: (value: Response) => void = () => undefined;
    let mintStarted = 0;
    const fetch = publicFetch(() => {
      mintStarted += 1;
      return new Promise<Response>((resolve) => {
        resolveMint = resolve;
      });
    });
    const transport = transportOf(fetch);
    const first = transport.query({ question: "A", clientRequestId: REQUEST });
    const second = transport.query({ question: "B", clientRequestId: MESSAGE });
    await flushMicrotasks();
    expect(mintStarted).toBe(1);
    resolveMint(jsonResponse(PUBLIC_SESSION, 201));
    await Promise.all([first, second]);
    const sessionCalls = fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"));
    const queryCalls = fetch.mock.calls.filter((call) => call[0].endsWith("/query"));
    expect(sessionCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(2);
    expect(headersOf(queryCalls[0]?.[1]).get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
    expect(headersOf(queryCalls[1]?.[1]).get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
  });

  it("does not abort a shared mint when one caller aborts", async () => {
    let resolveMint: (value: Response) => void = () => undefined;
    let notifyMint: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      notifyMint = resolve;
    });
    const fetch = publicFetch(() => {
      notifyMint();
      return new Promise<Response>((resolve) => {
        resolveMint = resolve;
      });
    });
    const transport = transportOf(fetch);
    const ac = new AbortController();
    const aborted = transport.query({ question: "A", clientRequestId: REQUEST, signal: ac.signal });
    const kept = transport.query({ question: "B", clientRequestId: MESSAGE });
    await mintStarted;
    ac.abort();
    await expect(aborted).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    resolveMint(jsonResponse(PUBLIC_SESSION, 201));
    const answer = await kept;
    expect(answer.text).toBe("Deux boulons.");
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
  });

  it("times out mint without reusing the aborted promise for a later query", async () => {
    vi.useFakeTimers();
    let mintCalls = 0;
    let notifyMint: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      notifyMint = resolve;
    });
    const fetch = vi.fn<IntegrationFetch>((input, init) => {
      if (input.endsWith("/sessions")) {
        mintCalls += 1;
        if (mintCalls === 1) {
          notifyMint();
          return hangUntilAbort(input, init);
        }
        return Promise.resolve(jsonResponse(PUBLIC_SESSION, 201));
      }
      return Promise.resolve(jsonResponse(PUBLIC_ANSWER));
    });
    const transport = transportOf(fetch);
    const first = transport.query({ question: "A", clientRequestId: REQUEST });
    await mintStarted;
    const timedOut = expect(first).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS);
    await timedOut;
    await flushMicrotasks();
    vi.useRealTimers();
    const answer = await transport.query({ question: "A", clientRequestId: REQUEST });
    expect(answer.text).toBe("Deux boulons.");
    expect(mintCalls).toBe(2);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
  });

  it("retries the same UUID on the same session after an ambiguous query failure", async () => {
    let queries = 0;
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), () => {
      queries += 1;
      if (queries === 1) return errorBody("UNAVAILABLE", 503);
      return jsonResponse(PUBLIC_ANSWER);
    });
    const transport = transportOf(fetch);
    const first = await transport.query({ question: "Q", clientRequestId: REQUEST }).catch((error: unknown) => error);
    expect(first).toMatchObject({ status: 503, retryGuidance: "read-then-decide" });
    expect(shouldReuseClientRequestId(first)).toBe(true);
    const answer = await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.text).toBe("Deux boulons.");
    const queryCalls = fetch.mock.calls.filter((call) => call[0].endsWith("/query"));
    expect(queryCalls).toHaveLength(2);
    expect(headersOf(queryCalls[0]?.[1]).get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
    expect(headersOf(queryCalls[1]?.[1]).get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(jsonBody(queryCalls[1]?.[1])).toMatchObject({ client_request_id: REQUEST });
  });

  it("retries the same UUID on the same session after a later ambiguous query timeout", async () => {
    let queries = 0;
    let notifyQuery: () => void = () => undefined;
    const queryStarted = new Promise<void>((resolve) => {
      notifyQuery = resolve;
    });
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), (input, init) => {
      queries += 1;
      if (queries === 2) {
        notifyQuery();
        return hangUntilAbort(input, init);
      }
      return jsonResponse(PUBLIC_ANSWER);
    });
    const transport = transportOf(fetch);
    await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(transport.sessionState().status).toBe("ready");

    vi.useFakeTimers();
    const pending = transport.query({ question: "Q", clientRequestId: REQUEST });
    await queryStarted;
    const timedOut = pending.then(
      () => {
        throw new Error("expected public query timeout");
      },
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS);
    const timeout = await timedOut;
    expect(timeout).toMatchObject({
      code: "REQUEST_TIMEOUT",
      retryGuidance: "read-then-decide",
    });
    expect(shouldReuseClientRequestId(timeout)).toBe(true);
    expect(isRetryableAgentError(timeout)).toBe(true);
    expect(String(timeout)).not.toContain(PUBLIC_TOKEN);
    expect(transport.sessionState()).toMatchObject({
      status: "ready",
      canStartNewConversation: true,
    });
    expect(JSON.stringify(transport.sessionState())).not.toContain(PUBLIC_TOKEN);
    vi.useRealTimers();

    const answer = await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.text).toBe("Deux boulons.");
    const sessionCalls = fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"));
    const queryCalls = fetch.mock.calls.filter((call) => call[0].endsWith("/query"));
    expect(sessionCalls).toHaveLength(1);
    expect(queryCalls).toHaveLength(3);
    expect(headersOf(queryCalls[2]?.[1]).get("authorization")).toBe(`Bearer ${PUBLIC_TOKEN}`);
    expect(jsonBody(queryCalls[2]?.[1])).toMatchObject({ client_request_id: REQUEST });
  });

  it("still queries when the browser clock is hours fast if the mint Date header is readable", async () => {
    const expiry = locallyPastExpiry(30 * 60 * 1000);
    const fetch = publicFetch(
      jsonResponse({ ...PUBLIC_SESSION, expires_at: expiry.expiresAt }, 201, { date: expiry.dateHeader }),
    );
    const transport = transportOf(fetch);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).resolves.toMatchObject({
      text: "Deux boulons.",
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
    expect(transport.sessionState()).toMatchObject({
      status: "ready",
      expiresAt: expiry.expiresAt,
    });
  });

  it("still queries when the browser clock is hours fast and the mint Date header is absent or invalid", async () => {
    const expiry = locallyPastExpiry(30 * 60 * 1000);
    const absentFetch = publicFetch(jsonResponse({ ...PUBLIC_SESSION, expires_at: expiry.expiresAt }, 201));
    await expect(transportOf(absentFetch).query({ question: "Q", clientRequestId: REQUEST })).resolves.toMatchObject({
      text: "Deux boulons.",
    });
    expect(absentFetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);

    const invalidDateFetch = publicFetch(
      jsonResponse({ ...PUBLIC_SESSION, expires_at: expiry.expiresAt }, 201, { date: "not-a-date" }),
    );
    const invalidTransport = transportOf(invalidDateFetch);
    await expect(invalidTransport.query({ question: "Q", clientRequestId: REQUEST })).resolves.toMatchObject({
      text: "Deux boulons.",
    });
    expect(invalidDateFetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
    expect(invalidTransport.sessionState()).toMatchObject({
      status: "ready",
      expiresAt: expiry.expiresAt,
    });
  });

  it("latches expired from a trusted relative TTL without reminting", async () => {
    const ttlMs = 60_000;
    const dateHeader = new Date(Date.now()).toUTCString();
    const expiresAt = new Date(Date.parse(dateHeader) + ttlMs).toISOString();
    const fetch = publicFetch(jsonResponse({ ...PUBLIC_SESSION, expires_at: expiresAt }, 201, { date: dateHeader }));
    const transport = transportOf(fetch);
    await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(transport.sessionState().status).toBe("ready");
    const elapsedAt = performance.now() + ttlMs + 1;
    vi.spyOn(performance, "now").mockReturnValue(elapsedAt);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
      retryGuidance: "none",
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
    expect(transport.sessionState().status).toBe("expired");
  });

  it("does not automatically remint after expiry, exhaustion, or revocation", async () => {
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      errorBody("PUBLIC_AGENT_UNAVAILABLE", 404, { message: `token=${PUBLIC_TOKEN}` }),
    );
    const transport = transportOf(fetch);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
      retryGuidance: "none",
    });
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
    expect(transport.sessionState().status).toBe("unavailable");
  });

  it("treats turns_remaining 0 as exhausted until an explicit new conversation", async () => {
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({ ...PUBLIC_ANSWER, turns_remaining: 0 }),
    );
    const transport = transportOf(fetch);
    await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(transport.sessionState().status).toBe("exhausted");
    await expect(transport.query({ question: "Q", clientRequestId: MESSAGE })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    transport.startNewConversation();
    expect(transport.sessionState()).toMatchObject({ status: "idle", canStartNewConversation: true });
    await transport.query({ question: "Q", clientRequestId: MESSAGE });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(2);
  });

  it("keeps remaining turns at the newer count when a stale replay arrives later", async () => {
    const deferred: Array<(value: Response) => void> = [];
    const started = [promiseWithNotify(), promiseWithNotify()];
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), () => {
      const index = deferred.length;
      const pending = new Promise<Response>((resolve) => {
        deferred[index] = resolve;
      });
      started[index]?.notify();
      return pending;
    });
    const transport = transportOf(fetch);
    const olderQuery = transport.query({ question: "older", clientRequestId: REQUEST });
    const newerQuery = transport.query({ question: "newer", clientRequestId: MESSAGE });
    await Promise.all(started.map((item) => item.promise));
    expect(transport.sessionState()).toMatchObject({ status: "querying", turnsRemaining: 5 });
    deferred[1]?.(jsonResponse({ ...PUBLIC_ANSWER, request_id: "newer", turns_remaining: 2 }));
    await expect(newerQuery).resolves.toMatchObject({ requestId: "newer" });
    expect(transport.sessionState().turnsRemaining).toBe(2);
    deferred[0]?.(jsonResponse({ ...PUBLIC_ANSWER, request_id: "older", turns_remaining: 4 }));
    await expect(olderQuery).resolves.toMatchObject({ requestId: "older" });
    expect(transport.sessionState()).toMatchObject({ status: "ready", turnsRemaining: 2 });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
  });

  it("keeps remaining turns at zero and exhausted when a stale replay follows exhaustion", async () => {
    const deferred: Array<(value: Response) => void> = [];
    const started = [promiseWithNotify(), promiseWithNotify()];
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), () => {
      const index = deferred.length;
      const pending = new Promise<Response>((resolve) => {
        deferred[index] = resolve;
      });
      started[index]?.notify();
      return pending;
    });
    const transport = transportOf(fetch);
    const first = transport.query({ question: "A", clientRequestId: REQUEST });
    const second = transport.query({ question: "B", clientRequestId: MESSAGE });
    await Promise.all(started.map((item) => item.promise));
    deferred[0]?.(jsonResponse({ ...PUBLIC_ANSWER, request_id: "zero", turns_remaining: 0 }));
    await expect(first).resolves.toMatchObject({ requestId: "zero" });
    expect(transport.sessionState()).toMatchObject({ status: "exhausted", turnsRemaining: 0 });
    deferred[1]?.(jsonResponse({ ...PUBLIC_ANSWER, request_id: "stale", turns_remaining: 4 }));
    await expect(second).resolves.toMatchObject({ requestId: "stale" });
    expect(transport.sessionState()).toMatchObject({ status: "exhausted", turnsRemaining: 0 });
    await expect(transport.query({ question: "C", clientRequestId: CLIENT })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(transport.sessionState().status).toBe("exhausted");
  });

  it("rejects startNewConversation while a query is in flight", async () => {
    let resolveQuery: (value: Response) => void = () => undefined;
    let notifyQuery: () => void = () => undefined;
    const queryStarted = new Promise<void>((resolve) => {
      notifyQuery = resolve;
    });
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      () =>
        new Promise<Response>((resolve) => {
          resolveQuery = resolve;
          notifyQuery();
        }),
    );
    const transport = transportOf(fetch);
    const pending = transport.query({ question: "Q", clientRequestId: REQUEST });
    await queryStarted;
    expect(transport.sessionState()).toMatchObject({ status: "querying", canStartNewConversation: false });
    expect(() => {
      transport.startNewConversation();
    }).toThrow(/in flight/i);
    resolveQuery(jsonResponse(PUBLIC_ANSWER));
    await expect(pending).resolves.toMatchObject({ text: "Deux boulons." });
    expect(transport.sessionState()).toMatchObject({ status: "ready", canStartNewConversation: true });
    transport.startNewConversation();
    expect(transport.sessionState().status).toBe("idle");
  });

  it("classifies public 409 BUSY as same-UUID retry and CONFLICT as not retryable", async () => {
    const busyFetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), errorBody("PUBLIC_AGENT_BUSY", 409));
    const busy = await transportOf(busyFetch)
      .query({ question: "Q", clientRequestId: REQUEST })
      .catch((error: unknown) => error);
    expect(busy).toMatchObject({
      code: "PUBLIC_AGENT_BUSY",
      status: 409,
      retryGuidance: "replay-same-idempotency",
    });
    expect(isRetryableAgentError(busy)).toBe(true);
    expect(shouldReuseClientRequestId(busy)).toBe(true);
    expect(String(busy)).not.toContain(PUBLIC_TOKEN);

    const conflictFetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), errorBody("PUBLIC_AGENT_CONFLICT", 409));
    const conflict = await transportOf(conflictFetch)
      .query({ question: "Q", clientRequestId: REQUEST })
      .catch((error: unknown) => error);
    expect(conflict).toMatchObject({
      code: "PUBLIC_AGENT_CONFLICT",
      status: 409,
      retryGuidance: "none",
    });
    expect(isRetryableAgentError(conflict)).toBe(false);
    expect(shouldReuseClientRequestId(conflict)).toBe(false);
  });

  it("does not remint after a mint UNAVAILABLE", async () => {
    const fetch = publicFetch(errorBody("PUBLIC_AGENT_UNAVAILABLE", 404));
    const transport = transportOf(fetch);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
      retryGuidance: "none",
    });
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_UNAVAILABLE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transport.sessionState().status).toBe("unavailable");
  });

  it("treats DENIED as terminal and does not remint", async () => {
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), errorBody("PUBLIC_AGENT_DENIED", 403));
    const transport = transportOf(fetch);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_DENIED",
      retryGuidance: "none",
    });
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "PUBLIC_AGENT_DENIED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(transport.sessionState().status).toBe("denied");
  });

  it("rejects malformed session tokens and expiry without echoing the secret", async () => {
    const badToken = publicFetch(jsonResponse({ ...PUBLIC_SESSION, session_token: `pss_${"x".repeat(12)}` }, 201));
    const tokenError = await transportOf(badToken)
      .query({ question: "Q", clientRequestId: REQUEST })
      .catch((error: unknown) => error);
    expect(tokenError).toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(JSON.stringify(tokenError)).not.toMatch(/pss_/);

    const serviceToken = publicFetch(jsonResponse({ ...PUBLIC_SESSION, session_token: TOKEN }, 201));
    await expect(transportOf(serviceToken).query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
    expect(serviceToken.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(0);

    const badExpiry = publicFetch(jsonResponse({ ...PUBLIC_SESSION, expires_at: "not-a-date" }, 201));
    await expect(transportOf(badExpiry).query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("rejects missing or newline request_id as malformed without retrying query", async () => {
    const missingBody = { ...PUBLIC_ANSWER };
    delete (missingBody as { request_id?: string }).request_id;
    const missingFetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), jsonResponse(missingBody));
    const missing = await transportOf(missingFetch)
      .query({ question: "Q", clientRequestId: REQUEST })
      .catch((error: unknown) => error);
    expect(missing).toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect((missing as { requestId?: string }).requestId).toBeUndefined();
    expect(missingFetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(missingFetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);

    const newlineFetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({ ...PUBLIC_ANSWER, request_id: "a\nb" }),
    );
    const newline = await transportOf(newlineFetch)
      .query({ question: "Q", clientRequestId: REQUEST })
      .catch((error: unknown) => error);
    expect(newline).toMatchObject({ code: "MALFORMED_RESPONSE" });
    expect(String(newline)).not.toContain("a\nb");
    expect(newlineFetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(newlineFetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
  });

  it("rejects malformed public answers including missing source fields", async () => {
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({ ...PUBLIC_ANSWER, sources: [{ index: 1, label: "", excerpt: "x" }] }),
    );
    await expect(transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("accepts a 200-codepoint non-BMP label and an empty excerpt", async () => {
    const label = "😀".repeat(200);
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({
        ...PUBLIC_ANSWER,
        sources: [{ index: 1, label, excerpt: "", location: "" }],
      }),
    );
    const answer = await transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.citations).toEqual([{ id: "1", documentName: label, excerpt: "", location: null }]);
  });

  it("rejects a 201-codepoint non-BMP label", async () => {
    const label = "😀".repeat(201);
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      jsonResponse({ ...PUBLIC_ANSWER, sources: [{ index: 1, label, excerpt: "x" }] }),
    );
    await expect(transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("rejects a non-function custom fetch as invalidRequest", () => {
    let caught: unknown;
    try {
      browser.createPublicAgentTransport({
        baseUrl: ORIGIN,
        releaseId: RELEASE,
        fetch: 1 as unknown as IntegrationFetch,
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "INVALID_REQUEST" });
    expect(String(caught)).toMatch(/fetch must be a function/i);
  });

  it("rejects tenant, credentials, headers, and private agent options", () => {
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201));
    expect(() => transportOf(fetch, { tenantId: "company" })).toThrow(/tenant|credentials|headers|private/i);
    expect(() => transportOf(fetch, { getAccessToken: () => TOKEN })).toThrow(/tenant|credentials|headers|private/i);
    expect(() => transportOf(fetch, { tokenProvider: () => TOKEN })).toThrow(/tenant|credentials|headers|private/i);
    expect(() => transportOf(fetch, { headers: { Authorization: `Bearer ${TOKEN}` } })).toThrow(/tenant|credentials|headers|private/i);
    expect(() => transportOf(fetch, { document_ids: ["doc-1"] })).toThrow(/tenant|credentials|headers|private/i);
    expect(() => transportOf(fetch, { agentId: "agt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).toThrow(
      /tenant|credentials|headers|private/i,
    );
    expect(() =>
      browser.createPublicAgentTransport({
        baseUrl: "http://example.com",
        releaseId: RELEASE,
        fetch,
      }),
    ).toThrow(/origin/i);
    expect(() =>
      browser.createPublicAgentTransport({
        baseUrl: ORIGIN,
        releaseId: "prl_nothex",
        fetch,
      }),
    ).toThrow(/prl_/);
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("is constructible in a document window without a Clerk session", async () => {
    (globalThis as { window?: { document: object } }).window = { document: {} };
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201));
    const transport = transportOf(fetch);
    await expect(transport.query({ question: "Q", clientRequestId: REQUEST })).resolves.toMatchObject({
      text: "Deux boulons.",
    });
  });

  it("does not write storage or put the session token in state or errors", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: () => null, removeItem: vi.fn(), clear: vi.fn() });
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null, removeItem: vi.fn(), clear: vi.fn() });
    const fetch = publicFetch(
      jsonResponse(PUBLIC_SESSION, 201),
      errorBody("PUBLIC_AGENT_UNAVAILABLE", 404, { message: `bearer ${PUBLIC_TOKEN}` }),
    );
    const transport = transportOf(fetch);
    const error = await transport.query({ question: "Q", clientRequestId: REQUEST }).catch((caught: unknown) => caught);
    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(transport.sessionState())).not.toContain(PUBLIC_TOKEN);
    expect(JSON.stringify(transport.sessionState())).not.toContain("pss_");
    expect(String(error)).not.toContain(PUBLIC_TOKEN);
    expect((error as { message?: string }).message).not.toContain("pss_");
  });

  it("does not auto-retry a query after 503", async () => {
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), errorBody("UNAVAILABLE", 503));
    await expect(transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST })).rejects.toMatchObject({
      status: 503,
    });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(1);
  });

  it("does not mint when the caller signal is already aborted", async () => {
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201));
    const ac = new AbortController();
    ac.abort();
    await expect(
      transportOf(fetch).query({ question: "Q", clientRequestId: REQUEST, signal: ac.signal }),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("aborts an in-flight query without reminting and allows a same-UUID retry", async () => {
    let queries = 0;
    let notifyQuery: () => void = () => undefined;
    const queryStarted = new Promise<void>((resolve) => {
      notifyQuery = resolve;
    });
    const fetch = publicFetch(jsonResponse(PUBLIC_SESSION, 201), (input, init) => {
      queries += 1;
      if (queries === 1) {
        notifyQuery();
        return hangUntilAbort(input, init);
      }
      return jsonResponse(PUBLIC_ANSWER);
    });
    const transport = transportOf(fetch);
    const ac = new AbortController();
    const pending = transport.query({ question: "Q", clientRequestId: REQUEST, signal: ac.signal });
    await queryStarted;
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    const answer = await transport.query({ question: "Q", clientRequestId: REQUEST });
    expect(answer.text).toBe("Deux boulons.");
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/sessions"))).toHaveLength(1);
    expect(fetch.mock.calls.filter((call) => call[0].endsWith("/query"))).toHaveLength(2);
  });
});
