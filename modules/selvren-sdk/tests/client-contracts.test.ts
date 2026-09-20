import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentAnswerFromPrivateQuery,
  SelvrenIntegrationError,
  shouldReuseClientRequestId,
  type IntegrationFetch,
} from "../src/index.js";
import { safeHref } from "../src/safe-href.js";
import {
  AGENT_ANSWER,
  ANSWER,
  CLIENT,
  clientOf,
  DOC,
  jsonBody,
  jsonResponse,
  MESSAGE,
  REQUEST,
  SPACE_A,
  SPACE_B,
  THREAD,
} from "./helpers.js";

function fetchOf(response: Response): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(() => Promise.resolve(response.clone()));
}

function delayedFetch(delayMs: number, payload: unknown): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>((_input: string, init: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(jsonResponse(payload));
      }, delayMs);
      const abort = (): void => {
        clearTimeout(timer);
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
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("idempotence and no blind retry", () => {
  it("snapshots client_request_id before the token await", async () => {
    let resolveToken: (value: string) => void = () => undefined;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const fetch = fetchOf(jsonResponse(ANSWER));
    const input = {
      space_ids: [SPACE_A],
      question: "Combien ?",
      client_request_id: REQUEST,
      language: "fr" as const,
    };
    const pending = clientOf(fetch, { token }).query(input);
    input.space_ids[0] = SPACE_B;
    input.question = "Changed";
    input.client_request_id = "33333333-3333-4333-8333-333333333333";
    resolveToken(`selvren_int_${"A".repeat(32)}`);
    await pending;
    expect(jsonBody(fetch.mock.calls[0]?.[1])).toEqual({
      space_ids: [SPACE_A],
      question: "Combien ?",
      client_request_id: REQUEST,
      language: "fr",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps import UUID unchanged and omits spoof fields", async () => {
    const fetch = fetchOf(jsonResponse({ request_id: "u", document: DOC, replayed: false }, 201));
    const importInput = {
      client_document_id: CLIENT,
      name: "note.txt",
      media_type: "text/plain" as const,
      text: "hello",
    };
    const pending = clientOf(fetch).importDocument(SPACE_A, importInput);
    (importInput as { client_document_id: string }).client_document_id = "33333333-3333-4333-8333-333333333333";
    await pending;
    const body = jsonBody(fetch.mock.calls[0]?.[1]) as Record<string, unknown>;
    expect(body.client_document_id).toBe(CLIENT);
    expect(body.actor).toBeUndefined();
    expect(body.end_user_ref).toBeUndefined();
  });

  it("does not retry a 500 mutation", async () => {
    const fetch = fetchOf(jsonResponse({ request_id: "e", error: { code: "INTERNAL_ERROR", message: "secret" } }, 500));
    await expect(
      clientOf(fetch).importDocument(SPACE_A, {
        client_document_id: CLIENT,
        name: "n.txt",
        media_type: "text/plain",
        text: "x",
      }),
    ).rejects.toMatchObject({ status: 500, retryGuidance: "read-then-decide" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

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

describe("AbortSignal", () => {
  it("surfaces REQUEST_ABORTED for an in-flight fetch without a second fetch", async () => {
    const { fetch, started } = inFlightFetch();
    const ac = new AbortController();
    const pending = clientOf(fetch).query(
      { space_ids: [SPACE_A], question: "Q", client_request_id: REQUEST },
      { signal: ac.signal },
    );
    await started;
    expect(fetch).toHaveBeenCalledTimes(1);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when the caller signal is already aborted", async () => {
    const fetch = delayedFetch(5_000, ANSWER);
    const ac = new AbortController();
    ac.abort();
    await expect(
      clientOf(fetch).query(
        { space_ids: [SPACE_A], question: "Q", client_request_id: REQUEST },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(0);
  });
});

describe("idempotence guidance", () => {
  it("reuses the caller UUID on ambiguous network errors and not after terminal message failure", () => {
    const timeout = new SelvrenIntegrationError(504, "REQUEST_TIMEOUT", "t", { retryGuidance: "read-then-decide" });
    const failed = new SelvrenIntegrationError(409, "ENTERPRISE_MESSAGE_FAILED", "m", {
      retryGuidance: "new-idempotency",
    });
    const denied = new SelvrenIntegrationError(403, "ENTERPRISE_ACCESS_DENIED", "d", { retryGuidance: "none" });
    const aborted = new SelvrenIntegrationError(0, "REQUEST_ABORTED", "The request was aborted.", {
      retryGuidance: "none",
    });
    expect(shouldReuseClientRequestId(timeout)).toBe(true);
    expect(shouldReuseClientRequestId(failed)).toBe(false);
    expect(shouldReuseClientRequestId(denied)).toBe(false);
    expect(shouldReuseClientRequestId(new TypeError("network"))).toBe(true);
    expect(shouldReuseClientRequestId(aborted)).toBe(true);
  });
});

describe("agent answer mapping and safe href", () => {
  it("maps a private query envelope without inventing success text", () => {
    const mapped = agentAnswerFromPrivateQuery(ANSWER as never);
    expect(mapped.text).toBe("Deux boulons.");
    expect(mapped.outcome).toBe("answered");
    expect(mapped.citations[0]?.url).toBe("https://files.example.test/note.txt");
    expect(mapped.revisionChanged).toBeUndefined();
  });

  it("maps optional revision_changed onto AgentAnswer.revisionChanged", () => {
    expect(agentAnswerFromPrivateQuery(AGENT_ANSWER as never).revisionChanged).toBeUndefined();
    expect(
      agentAnswerFromPrivateQuery({ ...AGENT_ANSWER, revision_changed: true } as never).revisionChanged,
    ).toBe(true);
    expect(
      agentAnswerFromPrivateQuery({ ...AGENT_ANSWER, revision_changed: false } as never).revisionChanged,
    ).toBe(false);
  });

  it("drops javascript and userinfo URLs", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,hi")).toBeUndefined();
    expect(safeHref("https://user:pass@evil.example/")).toBeUndefined();
    expect(safeHref("https://files.example.test/a")).toBe("https://files.example.test/a");
  });

  it("rejects a send whose message id does not match the caller UUID", async () => {
    const fetch = fetchOf(
      jsonResponse({
        request_id: "s",
        replayed: false,
        message: {
          id: "33333333-3333-4333-8333-333333333333",
          question: "Combien ?",
          language: "fr",
          expert_ids: [],
          created_at: "2026-09-13T00:00:00.000Z",
          answer: ANSWER,
          sources_changed: false,
          status: "complete",
          failure_code: null,
        },
      }),
    );
    await expect(
      clientOf(fetch).sendMessage([SPACE_A], THREAD, {
        client_message_id: MESSAGE,
        expected_revision: 1,
        question: "Combien ?",
        language: "fr",
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});
