/**
 * Browser-safe public agent transport. Mints a visitor session on first query
 * and holds the secret in closure memory only. Does not import the service
 * client, service tokens, Node, or tenant headers.
 */
import {
  type AgentAnswer,
  type AgentCitation,
  type AgentQueryRequest,
  type AgentTransport,
} from "./agent-transport.js";
import {
  abortedError,
  boundedRequestId,
  httpError,
  invalidRequest,
  isSelvrenIntegrationError,
  malformedResponse,
  SelvrenIntegrationError,
} from "./errors.js";
import {
  encodeSegment,
  parsePublicReleaseId,
  parseUuid,
  PUBLIC_SESSION_TOKEN,
} from "./ids.js";
import { assertIntegrationOrigin } from "./origin.js";
import { isRecord, parseLanguage, snapshotQuestion } from "./parse.js";
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
  type ComposedAbort,
} from "./http-core.js";

const OPTION_KEYS = new Set(["baseUrl", "releaseId", "language", "fetch"]);
const MAX_PUBLIC_SOURCES = 200;
const MAX_TURNS_REMAINING = 20;
const MAX_LABEL = 200;
const MAX_EXCERPT = 2_000;
const MAX_LOCATION = 200;
/** Date vs expires_at beyond this window is treated as unknown, not as extra TTL. */
const MAX_TRUSTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_IN_FLIGHT = "A new conversation cannot start while a public agent query is in flight.";
const FETCH_NOT_FUNCTION = "fetch must be a function when provided.";

export interface PublicAgentTransportOptions {
  readonly baseUrl: string;
  readonly releaseId: string;
  readonly language?: "fr" | "en" | undefined;
  readonly fetch?: IntegrationFetch | undefined;
}

export type PublicAgentSessionStatus =
  | "idle"
  | "ready"
  | "querying"
  | "exhausted"
  | "expired"
  | "unavailable"
  | "denied";

export interface PublicAgentSessionState {
  readonly status: PublicAgentSessionStatus;
  readonly turnsRemaining: number | null;
  readonly expiresAt: string | null;
  readonly canStartNewConversation: boolean;
}

export interface PublicAgentTransport extends AgentTransport {
  sessionState(): PublicAgentSessionState;
  startNewConversation(): void;
}

interface MintedSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly turnsRemaining: number;
  readonly deadlineMono: number | undefined;
}

type PublicTerminal = "exhausted" | "expired" | "unavailable" | "denied";

interface PublicRuntime {
  readonly origin: string;
  readonly releaseId: string;
  readonly language: "fr" | "en" | undefined;
  readonly fetch: IntegrationFetch;
  epoch: number;
  session: MintedSession | null;
  mintInFlight: Promise<MintedSession> | null;
  terminal: PublicTerminal | null;
  inFlightQueries: number;
}

/**
 * Visitor transport for a published public release. Requires public releases
 * enabled and an approved `prl_` id. No Clerk session, service token, or
 * tenant header. The session secret is not written to storage, URL, logs, or
 * errors; it is sent only as Authorization to fetch.
 */
export function createPublicAgentTransport(options: PublicAgentTransportOptions): PublicAgentTransport {
  const runtime = createRuntime(options);
  return {
    query: (request) => publicAgentQuery(runtime, request),
    sessionState: () => snapshotSessionState(runtime),
    startNewConversation: () => {
      startNewConversation(runtime);
    },
  };
}

function createRuntime(options: PublicAgentTransportOptions): PublicRuntime {
  if (!isRecord(options)) throw invalidRequest("createPublicAgentTransport options are required.");
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      throw invalidRequest("public transport does not accept tenant, credentials, headers, or private agent fields.");
    }
  }
  return {
    origin: assertIntegrationOrigin(options.baseUrl),
    releaseId: parsePublicReleaseId(options.releaseId),
    language: options.language === undefined ? undefined : parseLanguage(options.language),
    fetch: resolveFetch(options.fetch),
    epoch: 0,
    session: null,
    mintInFlight: null,
    terminal: null,
    inFlightQueries: 0,
  };
}

function startNewConversation(runtime: PublicRuntime): void {
  if (runtime.inFlightQueries > 0) throw invalidRequest(RESET_IN_FLIGHT);
  runtime.epoch += 1;
  runtime.session = null;
  runtime.mintInFlight = null;
  runtime.terminal = null;
}

function snapshotSessionState(runtime: PublicRuntime): PublicAgentSessionState {
  const canStartNewConversation = runtime.inFlightQueries === 0;
  const turnsRemaining = runtime.session?.turnsRemaining ?? null;
  const expiresAt = runtime.session?.expiresAt ?? null;
  if (runtime.terminal !== null) {
    return { status: runtime.terminal, turnsRemaining, expiresAt, canStartNewConversation };
  }
  if (runtime.inFlightQueries > 0) {
    return { status: "querying", turnsRemaining, expiresAt, canStartNewConversation };
  }
  if (runtime.session !== null) {
    return { status: "ready", turnsRemaining, expiresAt, canStartNewConversation };
  }
  return { status: "idle", turnsRemaining: null, expiresAt: null, canStartNewConversation };
}

async function publicAgentQuery(runtime: PublicRuntime, request: AgentQueryRequest): Promise<AgentAnswer> {
  const snapshot = snapshotPublicQuery(request, runtime.language);
  const composed = composeAbort(JSON_TIMEOUT_MS, request.signal);
  runtime.inFlightQueries += 1;
  try {
    if (signalAborted(composed.signal)) throw abortedError();
    if (runtime.terminal !== null) throw terminalError(runtime.terminal);
    const session = await ensureSession(runtime, composed.signal);
    if (signalAborted(composed.signal)) throw abortedError();
    const terminal = currentTerminal(runtime);
    if (terminal !== null) throw terminalError(terminal);
    assertSessionLive(runtime, session);
    return await dispatchPublicQuery(runtime, session, snapshot, composed);
  } catch (error: unknown) {
    throw finalizePublicError(runtime, error, composed);
  } finally {
    runtime.inFlightQueries -= 1;
    composed.cleanup();
  }
}

function snapshotPublicQuery(
  request: AgentQueryRequest,
  language: "fr" | "en" | undefined,
): Record<string, unknown> {
  if (!isRecord(request)) throw invalidRequest("agent query request is required.");
  const body: Record<string, unknown> = {
    client_request_id: parseUuid(request.clientRequestId, "clientRequestId"),
    question: snapshotQuestion(request.question),
  };
  if (language !== undefined) body.language = language;
  return body;
}

async function ensureSession(runtime: PublicRuntime, signal: AbortSignal): Promise<MintedSession> {
  if (runtime.terminal !== null) throw terminalError(runtime.terminal);
  if (runtime.session !== null) return runtime.session;
  if (runtime.mintInFlight === null) beginMint(runtime);
  if (runtime.mintInFlight === null) throw abortedError();
  return awaitWithAbort(runtime.mintInFlight, signal);
}

function beginMint(runtime: PublicRuntime): void {
  const mintEpoch = runtime.epoch;
  const pending = mintSession(runtime).then(
    (session) => {
      if (runtime.mintInFlight === pending) runtime.mintInFlight = null;
      if (runtime.epoch !== mintEpoch) return session;
      runtime.session = session;
      if (session.turnsRemaining === 0) runtime.terminal = "exhausted";
      else if (isTrustedExpired(session)) runtime.terminal = "expired";
      return session;
    },
    (error: unknown) => {
      if (runtime.mintInFlight === pending) runtime.mintInFlight = null;
      if (runtime.epoch === mintEpoch) markTerminalFrom(runtime, error);
      throw error instanceof Error ? error : abortedError();
    },
  );
  runtime.mintInFlight = pending;
}

async function mintSession(runtime: PublicRuntime): Promise<MintedSession> {
  const composed = composeAbort(JSON_TIMEOUT_MS, undefined);
  const url = joinUrl(runtime.origin, `/v1/public/agents/${encodeSegment(runtime.releaseId)}/sessions`);
  try {
    const response = await runtime.fetch(url, {
      method: "POST",
      headers: jsonHeaders(undefined),
      body: "{}",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: composed.signal,
    });
    const exchange = await completeJsonResponse(response, composed.signal, false);
    return parseMintedSession(exchange.body, response.headers.get("Date"));
  } catch (error: unknown) {
    throw mapTransportError(error, composed, "json");
  } finally {
    composed.cleanup();
  }
}

async function dispatchPublicQuery(
  runtime: PublicRuntime,
  session: MintedSession,
  snapshot: Record<string, unknown>,
  composed: ComposedAbort,
): Promise<AgentAnswer> {
  const url = joinUrl(runtime.origin, `/v1/public/agents/${encodeSegment(runtime.releaseId)}/query`);
  assertTokenNotInUrl(url, session.token);
  const response = await runtime.fetch(url, {
    method: "POST",
    headers: jsonHeaders(session.token),
    body: JSON.stringify(snapshot),
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
    signal: composed.signal,
  });
  const exchange = await completeJsonResponse(response, composed.signal, false);
  const parsed = parsePublicAgentAnswer(exchange.body);
  rememberTurns(runtime, parsed.turnsRemaining);
  return parsed.answer;
}

function jsonHeaders(token: string | undefined): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function assertSessionLive(runtime: PublicRuntime, session: MintedSession): void {
  if (session.turnsRemaining === 0) {
    runtime.terminal = "exhausted";
    throw terminalError("exhausted");
  }
  if (isTrustedExpired(session)) {
    runtime.terminal = "expired";
    throw terminalError("expired");
  }
}

function isTrustedExpired(session: MintedSession): boolean {
  return session.deadlineMono !== undefined && session.deadlineMono <= performance.now();
}

function rememberTurns(runtime: PublicRuntime, turnsRemaining: number): void {
  const current = runtime.session?.turnsRemaining;
  const effective = current === undefined ? turnsRemaining : Math.min(current, turnsRemaining);
  if (runtime.session !== null) {
    runtime.session = { ...runtime.session, turnsRemaining: effective };
  }
  if (effective === 0 && runtime.terminal === null) runtime.terminal = "exhausted";
}

function finalizePublicError(runtime: PublicRuntime, error: unknown, composed: ComposedAbort): Error {
  const mapped = mapTransportError(error, composed, "json");
  markTerminalFrom(runtime, mapped);
  return mapped;
}

function markTerminalFrom(runtime: PublicRuntime, error: unknown): void {
  if (!isSelvrenIntegrationError(error)) return;
  if (error.code === "PUBLIC_AGENT_DENIED") runtime.terminal = "denied";
  if (error.code === "PUBLIC_AGENT_UNAVAILABLE" && runtime.terminal === null) {
    runtime.terminal = "unavailable";
  }
}

function currentTerminal(runtime: PublicRuntime): PublicTerminal | null {
  return runtime.terminal;
}

function terminalError(kind: PublicTerminal): SelvrenIntegrationError {
  if (kind === "denied") return httpError(403, "PUBLIC_AGENT_DENIED", undefined);
  return httpError(404, "PUBLIC_AGENT_UNAVAILABLE", undefined);
}

function parseMintedSession(body: unknown, dateHeader: string | null): MintedSession {
  const record = requireRecord(body);
  const token = record.session_token;
  if (typeof token !== "string" || !PUBLIC_SESSION_TOKEN.test(token)) malformed();
  const expiry = parseExpiresAt(record.expires_at);
  const turnsRemaining = parseTurnsRemaining(record.turns_remaining);
  return {
    token,
    expiresAt: expiry.expiresAt,
    turnsRemaining,
    deadlineMono: trustedDeadlineMono(expiry.expiresAtMs, dateHeader),
  };
}

function parsePublicAgentAnswer(body: unknown): { answer: AgentAnswer; turnsRemaining: number } {
  const record = requireRecord(body);
  const requestId = requestIdOf(record);
  const text = record.answer;
  if (typeof text !== "string") malformed(requestId);
  const mode = record.mode;
  if (mode !== "generated" && mode !== "extractive") malformed(requestId);
  const outcome = record.outcome;
  if (outcome !== "answered" && outcome !== "insufficient_evidence") malformed(requestId);
  const citations = parsePublicSources(record.sources, requestId);
  const turnsRemaining = parseTurnsRemaining(record.turns_remaining, requestId);
  return {
    turnsRemaining,
    answer: { requestId, text, outcome, citations },
  };
}

function parsePublicSources(value: unknown, requestId: string): AgentCitation[] {
  if (!Array.isArray(value) || value.length > MAX_PUBLIC_SOURCES) malformed(requestId);
  const citations: AgentCitation[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!isRecord(item)) malformed(requestId);
    const index = item.index;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 1 || seen.has(index)) {
      malformed(requestId);
    }
    seen.add(index);
    const label = parsePublicText(item.label, MAX_LABEL, false, requestId);
    const excerpt = parsePublicText(item.excerpt, MAX_EXCERPT, true, requestId);
    citations.push({
      id: String(index),
      documentName: label,
      excerpt,
      location: optionalLocation(item.location, requestId),
    });
  }
  return citations;
}

function optionalLocation(value: unknown, requestId: string): string | null {
  if (value === undefined || value === null) return null;
  const location = parsePublicText(value, MAX_LOCATION, true, requestId);
  return location === "" ? null : location;
}

function parsePublicText(
  value: unknown,
  maxCodePoints: number,
  allowEmpty: boolean,
  requestId: string,
): string {
  if (typeof value !== "string") malformed(requestId);
  const length = codePointLength(value);
  if (length > maxCodePoints || (!allowEmpty && length === 0)) malformed(requestId);
  return value;
}

function codePointLength(value: string): number {
  // The wire contract counts Unicode code points, not grapheme clusters.
  return Array.from(value).length;
}

function parseTurnsRemaining(value: unknown, requestId?: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_TURNS_REMAINING) {
    malformed(requestId);
  }
  return value;
}

function parseExpiresAt(value: unknown): { expiresAt: string; expiresAtMs: number } {
  if (typeof value !== "string" || value.length < 10 || value.length > 64) malformed();
  const expiresAtMs = Date.parse(value);
  if (!Number.isFinite(expiresAtMs)) malformed();
  return { expiresAt: value, expiresAtMs };
}

function trustedDeadlineMono(expiresAtMs: number, dateHeader: string | null): number | undefined {
  const serverNowMs = parseHttpDate(dateHeader);
  if (serverNowMs === undefined) return undefined;
  const ttlMs = expiresAtMs - serverNowMs;
  if (!Number.isFinite(ttlMs) || Math.abs(ttlMs) > MAX_TRUSTED_TTL_MS) return undefined;
  return performance.now() + ttlMs;
}

function parseHttpDate(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 10 || trimmed.length > 64) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : undefined;
}

function requestIdOf(record: Record<string, unknown>): string {
  const value = boundedRequestId(record.request_id);
  if (value === undefined) malformed();
  return value;
}

function resolveFetch(value: unknown): IntegrationFetch {
  if (value === undefined) return (input, init) => globalThis.fetch(input, init);
  if (typeof value !== "function") throw invalidRequest(FETCH_NOT_FUNCTION);
  return value as IntegrationFetch;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) malformed();
  return value;
}

function malformed(requestId?: string): never {
  throw malformedResponse(requestId);
}
