import { abortedError, invalidRequest } from "./errors.js";
import {
  assertNoRedirect,
  assertTokenNotInUrl,
  awaitWithAbort,
  completeJsonResponse,
  composeAbort,
  joinUrl,
  mapTransportError,
  signalAborted,
  type ComposedAbort,
  type JsonExchange,
} from "./http-core.js";
import { parseToken } from "./service-token.js";
import type { IntegrationFetch, IntegrationRequestOptions, TokenProvider } from "./types.js";

export {
  JSON_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  STREAM_TIMEOUT_MS,
  JSON_MAX_BYTES,
  PREHEADER_MAX_BYTES,
  composeAbort,
  awaitWithAbort,
  signalAborted,
  isAbortError,
  joinUrl,
  assertNoRedirect,
  assertTokenNotInUrl,
  readBoundedText,
  completeJsonResponse,
  mapTransportError,
  readWithAbort,
  cancelReader,
  cancelBody,
} from "./http-core.js";
export type { ComposedAbort, JsonExchange } from "./http-core.js";

export const TENANT_HEADER = "X-Selvren-Integration-Tenant";

export interface TransportContext {
  readonly origin: string;
  readonly tenantId: string;
  readonly tokenProvider: TokenProvider;
  readonly fetch: IntegrationFetch;
}

export interface JsonRequestInput {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly bodyText?: string | undefined;
  readonly accept?: string | undefined;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
  readonly empty: boolean;
}

export interface StreamRequestInput {
  readonly path: string;
  readonly bodyText: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export function optionalSignal(signal: AbortSignal | undefined): { readonly signal?: AbortSignal | undefined } {
  if (signal === undefined) return {};
  return { signal };
}

export async function resolveToken(provider: TokenProvider, signal: AbortSignal): Promise<string> {
  if (signalAborted(signal)) throw abortedError();
  const token = await awaitWithAbort(Promise.resolve().then(provider), signal);
  if (signalAborted(signal)) throw abortedError();
  return parseToken(typeof token === "string" ? token.trim() : "");
}

export function integrationHeaders(
  token: string,
  tenantId: string,
  extra: Readonly<Record<string, string>>,
): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set(TENANT_HEADER, tenantId);
  for (const [name, value] of Object.entries(extra)) {
    if (name.toLowerCase() === "authorization") continue;
    if (name.toLowerCase() === "x-tenant-id") continue;
    if (name.toLowerCase() === "tenant-id") continue;
    headers.set(name, value);
  }
  return headers;
}

export async function jsonRequest(ctx: TransportContext, input: JsonRequestInput): Promise<JsonExchange> {
  const composed = composeAbort(input.timeoutMs, input.signal);
  try {
    const token = await resolveToken(ctx.tokenProvider, composed.signal);
    const extra: Record<string, string> = {
      Accept: input.accept ?? "application/json",
    };
    if (input.bodyText !== undefined) extra["Content-Type"] = "application/json";
    extra["x-client-request-id"] = crypto.randomUUID();
    const init: RequestInit = {
      method: input.method,
      headers: integrationHeaders(token, ctx.tenantId, extra),
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: composed.signal,
    };
    if (input.bodyText !== undefined) init.body = input.bodyText;
    const url = joinUrl(ctx.origin, input.path);
    assertTokenNotInUrl(url, token);
    const response = await ctx.fetch(url, init);
    return await completeJsonResponse(response, composed.signal, input.empty);
  } catch (error: unknown) {
    throw mapTransportError(error, composed, "json");
  } finally {
    composed.cleanup();
  }
}

export async function openStreamResponse(
  ctx: TransportContext,
  input: StreamRequestInput,
): Promise<{ response: Response; composed: ComposedAbort }> {
  const composed = composeAbort(input.timeoutMs, input.signal);
  try {
    const token = await resolveToken(ctx.tokenProvider, composed.signal);
    const url = joinUrl(ctx.origin, input.path);
    assertTokenNotInUrl(url, token);
    const response = await ctx.fetch(url, {
      method: "POST",
      headers: integrationHeaders(token, ctx.tenantId, {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "x-client-request-id": crypto.randomUUID(),
      }),
      body: input.bodyText,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: composed.signal,
    });
    assertNoRedirect(response);
    return { response, composed };
  } catch (error: unknown) {
    composed.cleanup();
    throw mapTransportError(error, composed, "stream");
  }
}

export function timeoutOf(options: IntegrationRequestOptions | undefined, fallback: number): number {
  const value = options?.timeoutMs;
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1 || value > 300_000) {
    throw invalidRequest("timeoutMs must be a finite duration in milliseconds.");
  }
  return value;
}
