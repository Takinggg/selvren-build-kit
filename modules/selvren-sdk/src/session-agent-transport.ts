import {
  agentAnswerFromPrivateQuery,
  type AgentAnswer,
  type AgentQueryRequest,
  type AgentTransport,
} from "./agent-transport.js";
import { abortedError, CLIENT_CODES, invalidRequest, localError } from "./errors.js";
import { encodeSegment, parseAgentId, parseUuid } from "./ids.js";
import { assertIntegrationOrigin } from "./origin.js";
import { parseAgentAnswer, snapshotQuestion } from "./parse.js";
import type { IntegrationFetch } from "./types.js";
import {
  assertTokenNotInUrl,
  awaitWithAbort,
  completeJsonResponse,
  composeAbort,
  JSON_TIMEOUT_MS,
  joinUrl,
  mapTransportError,
  signalAborted,
} from "./http-core.js";

const SESSION_OPTION_KEYS = new Set(["baseUrl", "agentId", "getAccessToken", "revision", "fetch"]);
const SESSION_TOKEN_MESSAGE =
  "Session transport requires a Clerk access token. Service tokens (selvren_int_ / selvren_private_) are rejected.";

export type SessionAccessTokenProvider = () => string | null | Promise<string | null>;

export type AgentRevision = "published" | "draft";

export interface SessionAgentTransportOptions {
  readonly baseUrl: string;
  readonly agentId: string;
  readonly getAccessToken: SessionAccessTokenProvider;
  readonly revision?: AgentRevision | undefined;
  readonly fetch?: IntegrationFetch | undefined;
}

interface SessionContext {
  readonly origin: string;
  readonly agentId: string;
  readonly revision: AgentRevision;
  readonly getAccessToken: SessionAccessTokenProvider;
  readonly fetch: IntegrationFetch;
}

/**
 * First-party dashboard / verified-user transport.
 * Forwards a Clerk session access token. Does not mint identity, accept
 * end_user_ref, or treat a user string as authentication.
 */
export function createSessionAgentTransport(options: SessionAgentTransportOptions): AgentTransport {
  if (!isRecord(options)) throw invalidRequest("createSessionAgentTransport options are required.");
  for (const key of Object.keys(options)) {
    if (!SESSION_OPTION_KEYS.has(key)) {
      throw invalidRequest("session transport does not accept tenant, actor, admin, or other authority fields.");
    }
  }
  if (typeof options.getAccessToken !== "function") {
    throw invalidRequest("getAccessToken is required.");
  }
  const fetchImpl: IntegrationFetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const ctx: SessionContext = {
    origin: assertIntegrationOrigin(options.baseUrl),
    agentId: parseAgentId(options.agentId),
    revision: parseSessionRevision(options.revision),
    getAccessToken: options.getAccessToken,
    fetch: fetchImpl,
  };
  return {
    query: (request) => sessionAgentQuery(ctx, request),
  };
}

function parseSessionRevision(value: unknown): AgentRevision {
  if (value === undefined) return "published";
  if (value === "published" || value === "draft") return value;
  throw invalidRequest("revision must be published or draft.");
}

async function sessionAgentQuery(ctx: SessionContext, request: AgentQueryRequest): Promise<AgentAnswer> {
  const snapshot = snapshotSessionQuery(request, ctx.revision);
  const composed = composeAbort(JSON_TIMEOUT_MS, request.signal);
  try {
    const token = await resolveSessionAccessToken(ctx.getAccessToken, composed.signal);
    const url = joinUrl(ctx.origin, `/v1/enterprise/agents/${encodeSegment(ctx.agentId)}/query`);
    assertTokenNotInUrl(url, token);
    const response = await ctx.fetch(url, {
      method: "POST",
      headers: sessionHeaders(token),
      body: JSON.stringify(snapshot),
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: composed.signal,
    });
    const exchange = await completeJsonResponse(response, composed.signal, false);
    return agentAnswerFromPrivateQuery(parseAgentAnswer(exchange.body, ctx.agentId));
  } catch (error: unknown) {
    throw mapTransportError(error, composed, "json");
  } finally {
    composed.cleanup();
  }
}

function snapshotSessionQuery(request: AgentQueryRequest, revision: AgentRevision): Record<string, unknown> {
  if (!isRecord(request)) throw invalidRequest("agent query request is required.");
  return {
    client_request_id: parseUuid(request.clientRequestId, "clientRequestId"),
    revision,
    question: snapshotQuestion(request.question),
  };
}

async function resolveSessionAccessToken(
  provider: SessionAccessTokenProvider,
  signal: AbortSignal,
): Promise<string> {
  if (signalAborted(signal)) throw abortedError();
  const token = await awaitWithAbort(Promise.resolve().then(provider), signal);
  if (signalAborted(signal)) throw abortedError();
  return parseSessionAccessToken(token);
}

function parseSessionAccessToken(value: unknown): string {
  if (typeof value !== "string") {
    throw localError(CLIENT_CODES.INVALID_TOKEN, SESSION_TOKEN_MESSAGE);
  }
  const token = value.trim();
  if (token.length < 16 || token.length > 8192) {
    throw localError(CLIENT_CODES.INVALID_TOKEN, SESSION_TOKEN_MESSAGE);
  }
  if (token.startsWith("selvren_int_") || token.startsWith("selvren_private_")) {
    throw localError(CLIENT_CODES.INVALID_TOKEN, SESSION_TOKEN_MESSAGE);
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length < 1)) {
    throw localError(CLIENT_CODES.INVALID_TOKEN, SESSION_TOKEN_MESSAGE);
  }
  return token;
}

function sessionHeaders(token: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
