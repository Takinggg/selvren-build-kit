import { SelvrenIntegrationClient, type IntegrationFetch } from "../src/index.js";

export const SPACE_A = `corp_${"a".repeat(32)}`;
export const SPACE_B = `corp_${"b".repeat(32)}`;
export const THREAD = `pth_${"c".repeat(32)}`;
export const AGENT = `agt_${"d".repeat(32)}`;
export const AGENT_OTHER = `agt_${"e".repeat(32)}`;
export const AGENT_REVISION = `agr_${"f".repeat(32)}`;
export const TOKEN = `selvren_int_${"A".repeat(32)}`;
// Unsigned synthetic transport fixture; never accepted as a real Clerk session.
export const SESSION_JWT = [
  JSON.stringify({ alg: "none" }),
  JSON.stringify({ sub: "synthetic-sdk-fixture" }),
].map(value => Buffer.from(value, "utf8").toString("base64url")).concat("unsigned-test").join(".");
export const TENANT = "company_example";
export const DOC_ID = "doc-1";
export const CLIENT = "11111111-1111-4111-8111-111111111111";
export const MESSAGE = "22222222-2222-4222-8222-222222222222";
export const REQUEST = "123e4567-e89b-4d3a-a456-426614174000";
export const CREATED = "2026-09-13T00:00:00.000Z";
export const ORIGIN = "https://api.staging.example.invalid";

export const DOC = {
  id: DOC_ID,
  version: "v1",
  name: "note.txt",
  media_type: "text/plain",
  size_bytes: 12,
  state: "ready",
  phase: "ready",
  progress: { kind: "indeterminate" },
  error: null,
  actions: { retry: false, delete: true, query: true },
  created_at: CREATED,
  updated_at: CREATED,
  pending_conflicts: 0,
};

export const ANSWER = {
  request_id: "q-1",
  answer: "Deux boulons.",
  answer_mode: "generated",
  outcome: "answered",
  expert: null,
  citations: [
    {
      id: "c1",
      source_kind: "enterprise",
      expert_id: null,
      document_id: "doc-1",
      document_name: "note.txt",
      document_version: "v1",
      chunk_id: "ch1",
      excerpt: "Deux boulons.",
      location: null,
      space_id: SPACE_A,
      url: "https://files.example.test/note.txt",
    },
  ],
  conflicts: [],
  claims: [
    { id: "cl1", text: "Deux boulons.", kind: "fact", citation_ids: ["c1"], quote: "Deux boulons." },
  ],
  missing: [],
  verification: { method: "grounded-claims-v2", claims: 1, inferences: 0, checks: ["quotes"] },
};

export const AGENT_ANSWER = {
  ...ANSWER,
  agent_id: AGENT,
  agent_revision_id: AGENT_REVISION,
  agent_revision_number: 3,
};

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function clientOf(
  fetch: IntegrationFetch,
  options: { tenantId?: string; token?: string | Promise<string>; baseUrl?: string } = {},
): SelvrenIntegrationClient {
  const token = options.token ?? TOKEN;
  return new SelvrenIntegrationClient({
    baseUrl: options.baseUrl ?? ORIGIN,
    tenantId: options.tenantId ?? TENANT,
    tokenProvider: () => token,
    fetch,
  });
}

export function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

export function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("expected JSON string body");
  }
  return JSON.parse(body) as unknown;
}
