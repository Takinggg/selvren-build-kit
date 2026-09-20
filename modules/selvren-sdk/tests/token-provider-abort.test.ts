import { afterEach, describe, expect, it, vi } from "vitest";
import * as browser from "../src/browser.js";
import { SelvrenIntegrationError, type IntegrationFetch } from "../src/index.js";
import { JSON_TIMEOUT_MS } from "../src/transport.js";
import {
  AGENT,
  AGENT_ANSWER,
  clientOf,
  jsonResponse,
  ORIGIN,
  REQUEST,
  SESSION_JWT,
} from "./helpers.js";

function fetchOf(response: Response): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(() => Promise.resolve(response.clone()));
}

function neverSettlingToken(): Promise<string> {
  return new Promise(() => undefined);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function withUnhandledRejections(run: (unhandled: unknown[]) => Promise<void>): Promise<void> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run(unhandled);
    await flushMicrotasks();
    expect(unhandled).toEqual([]);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("service tokenProvider abort", () => {
  it("returns REQUEST_ABORTED while a never-settling tokenProvider is pending and does not fetch", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const ac = new AbortController();
    const pending = clientOf(fetch, { token: neverSettlingToken() }).queryAgent(AGENT, {
      client_request_id: REQUEST,
      question: "Q",
    }, { signal: ac.signal });
    await flushMicrotasks();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("returns REQUEST_TIMEOUT using JSON_TIMEOUT_MS while the tokenProvider never settles", async () => {
    vi.useFakeTimers();
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const pending = clientOf(fetch, { token: neverSettlingToken() }).queryAgent(AGENT, {
      client_request_id: REQUEST,
      question: "Q",
    });
    await flushMicrotasks();
    const timedOut = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("ignores a late token resolution after abort and never fetches", async () => {
    let resolveToken: (value: string) => void = () => undefined;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const ac = new AbortController();
    const pending = clientOf(fetch, { token }).queryAgent(AGENT, {
      client_request_id: REQUEST,
      question: "Q",
    }, { signal: ac.signal });
    await flushMicrotasks();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    resolveToken(`selvren_int_${"A".repeat(32)}`);
    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("does not surface an unhandled rejection if the tokenProvider rejects after abort", async () => {
    await withUnhandledRejections(async () => {
      let rejectToken: (reason: unknown) => void = () => undefined;
      const token = new Promise<string>((_resolve, reject) => {
        rejectToken = reject;
      });
      const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
      const ac = new AbortController();
      const pending = clientOf(fetch, { token }).queryAgent(AGENT, {
        client_request_id: REQUEST,
        question: "Q",
      }, { signal: ac.signal });
      await flushMicrotasks();
      ac.abort();
      await expect(pending).rejects.toBeInstanceOf(SelvrenIntegrationError);
      rejectToken(new Error("late tokenProvider rejection"));
      await flushMicrotasks();
      expect(fetch).toHaveBeenCalledTimes(0);
    });
  });
});

describe("session getAccessToken abort", () => {
  it("returns REQUEST_ABORTED while a never-settling getAccessToken is pending and does not fetch", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => neverSettlingToken(),
      fetch,
    });
    const ac = new AbortController();
    const pending = transport.query({
      question: "Q",
      clientRequestId: REQUEST,
      signal: ac.signal,
    });
    await flushMicrotasks();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("returns REQUEST_TIMEOUT using JSON_TIMEOUT_MS while getAccessToken never settles", async () => {
    vi.useFakeTimers();
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const transport = browser.createSessionAgentTransport({
      baseUrl: ORIGIN,
      agentId: AGENT,
      getAccessToken: () => neverSettlingToken(),
      fetch,
    });
    const pending = transport.query({ question: "Q", clientRequestId: REQUEST });
    await flushMicrotasks();
    const timedOut = expect(pending).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(JSON_TIMEOUT_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("ignores a late session token resolution after abort and never fetches", async () => {
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
    const ac = new AbortController();
    const pending = transport.query({
      question: "Q",
      clientRequestId: REQUEST,
      signal: ac.signal,
    });
    await flushMicrotasks();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    resolveToken(SESSION_JWT);
    await flushMicrotasks();
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("does not surface an unhandled rejection if getAccessToken rejects after abort", async () => {
    await withUnhandledRejections(async () => {
      let rejectToken: (reason: unknown) => void = () => undefined;
      const token = new Promise<string>((_resolve, reject) => {
        rejectToken = reject;
      });
      const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
      const transport = browser.createSessionAgentTransport({
        baseUrl: ORIGIN,
        agentId: AGENT,
        getAccessToken: () => token,
        fetch,
      });
      const ac = new AbortController();
      const pending = transport.query({
        question: "Q",
        clientRequestId: REQUEST,
        signal: ac.signal,
      });
      await flushMicrotasks();
      ac.abort();
      await expect(pending).rejects.toBeInstanceOf(SelvrenIntegrationError);
      rejectToken(new Error("late getAccessToken rejection"));
      await flushMicrotasks();
      expect(fetch).toHaveBeenCalledTimes(0);
    });
  });
});
