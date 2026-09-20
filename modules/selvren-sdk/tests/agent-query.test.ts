import { afterEach, describe, expect, it, vi } from "vitest";
import { SelvrenIntegrationClient, SelvrenIntegrationError, type IntegrationFetch } from "../src/index.js";
import { TENANT_HEADER } from "../src/transport.js";
import {
  AGENT,
  AGENT_ANSWER,
  AGENT_OTHER,
  clientOf,
  headersOf,
  jsonBody,
  jsonResponse,
  ORIGIN,
  REQUEST,
  TENANT,
  TOKEN,
} from "./helpers.js";

function fetchOf(response: Response): ReturnType<typeof vi.fn<IntegrationFetch>> {
  return vi.fn<IntegrationFetch>(() => Promise.resolve(response.clone()));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queryAgent", () => {
  it("POSTs the published agent body after snapshotting fields before the token await", async () => {
    let resolveToken: (value: string) => void = () => undefined;
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const input = {
      client_request_id: REQUEST,
      question: "Combien ?",
      language: "fr" as const,
      document_ids: ["doc-1"],
    };
    const pending = clientOf(fetch, { token }).queryAgent(AGENT, input);
    input.question = "Changed";
    input.client_request_id = "33333333-3333-4333-8333-333333333333";
    input.document_ids[0] = "doc-other";
    resolveToken(TOKEN);
    const result = await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ORIGIN}/v1/enterprise/agents/${AGENT}/query`);
    expect(jsonBody(fetch.mock.calls[0]?.[1])).toEqual({
      client_request_id: REQUEST,
      revision: "published",
      question: "Combien ?",
      language: "fr",
      document_ids: ["doc-1"],
    });
    const headers = headersOf(fetch.mock.calls[0]?.[1]);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get(TENANT_HEADER.toLowerCase())).toBe(TENANT);
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("omit");
    expect(result.agent_id).toBe(AGENT);
    expect(result.agent_revision_id).toBe(AGENT_ANSWER.agent_revision_id);
    expect(result.agent_revision_number).toBe(3);
    expect(result.revision_changed).toBeUndefined();
    expect(result.answer).toBe("Deux boulons.");
  });

  it("rejects an invalid agent id and a draft revision before awaiting the token", async () => {
    let tokenCalls = 0;
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    const client = new SelvrenIntegrationClient({
      baseUrl: ORIGIN,
      tenantId: TENANT,
      tokenProvider: () => {
        tokenCalls += 1;
        return TOKEN;
      },
      fetch,
    });
    await expect(
      client.queryAgent("agt_not-hex", { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      client.queryAgent(AGENT, {
        client_request_id: REQUEST,
        question: "Q",
        revision: "draft",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(tokenCalls).toBe(0);
  });

  it("rejects malformed agent envelopes and a mismatched agent_id", async () => {
    const mismatched = fetchOf(jsonResponse({ ...AGENT_ANSWER, agent_id: AGENT_OTHER }));
    await expect(
      clientOf(mismatched).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", status: 502 });
    expect(mismatched).toHaveBeenCalledTimes(1);

    const missingRevision = fetchOf(
      jsonResponse({ ...AGENT_ANSWER, agent_revision_id: undefined, agent_revision_number: undefined }),
    );
    await expect(
      clientOf(missingRevision).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });

    const zeroRevision = fetchOf(jsonResponse({ ...AGENT_ANSWER, agent_revision_number: 0 }));
    await expect(
      clientOf(zeroRevision).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });

    const badRevisionId = fetchOf(jsonResponse({ ...AGENT_ANSWER, agent_revision_id: `agr_${"G".repeat(32)}` }));
    await expect(
      clientOf(badRevisionId).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("parses optional revision_changed as a boolean and rejects a string", async () => {
    const changed = await clientOf(fetchOf(jsonResponse({ ...AGENT_ANSWER, revision_changed: true }))).queryAgent(
      AGENT,
      { client_request_id: REQUEST, question: "Q" },
    );
    expect(changed.revision_changed).toBe(true);
    expect(changed.agent_revision_id).toBe(AGENT_ANSWER.agent_revision_id);
    expect(changed.agent_revision_number).toBe(3);

    const unchanged = await clientOf(fetchOf(jsonResponse({ ...AGENT_ANSWER, revision_changed: false }))).queryAgent(
      AGENT,
      { client_request_id: REQUEST, question: "Q" },
    );
    expect(unchanged.revision_changed).toBe(false);

    const absent = await clientOf(fetchOf(jsonResponse(AGENT_ANSWER))).queryAgent(AGENT, {
      client_request_id: REQUEST,
      question: "Q",
    });
    expect(absent.revision_changed).toBeUndefined();

    await expect(
      clientOf(fetchOf(jsonResponse({ ...AGENT_ANSWER, revision_changed: "true" }))).queryAgent(AGENT, {
        client_request_id: REQUEST,
        question: "Q",
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("blocks redirects without following", async () => {
    const fetch = fetchOf(new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    await expect(
      clientOf(fetch).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" }),
    ).rejects.toMatchObject({ code: "REDIRECT_BLOCKED", retryGuidance: "none" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("does not put the token in the URL and omits end_user_ref", async () => {
    const fetch = fetchOf(jsonResponse(AGENT_ANSWER));
    await clientOf(fetch).queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" });
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).not.toContain(TOKEN);
    expect(url).not.toMatch(/selvren_int_/);
    const body = jsonBody(fetch.mock.calls[0]?.[1]) as Record<string, unknown>;
    expect(body.end_user_ref).toBeUndefined();
    expect(body.actor).toBeUndefined();
    expect(body.space_ids).toBeUndefined();
    expect(body.revision).toBe("published");
  });

  it("maps HTTP denial without leaking server text", async () => {
    const fetch = fetchOf(
      jsonResponse({ request_id: "e", error: { code: "ENTERPRISE_ACCESS_DENIED", message: "token=selvren_int_leak" } }, 403),
    );
    const error = await clientOf(fetch)
      .queryAgent(AGENT, { client_request_id: REQUEST, question: "Q" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SelvrenIntegrationError);
    if (!(error instanceof SelvrenIntegrationError)) throw new Error("expected typed error");
    expect(error.message).toBe("Access was denied.");
    expect(error.message).not.toContain("selvren_int");
  });
});
