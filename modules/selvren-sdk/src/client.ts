import { invalidRequest } from "./errors.js";
import {
  encodeSegment,
  parseAgentId,
  parseDocumentId,
  parseSpaceId,
  parseTenantId,
  parseThreadId,
} from "./ids.js";
import { assertIntegrationOrigin } from "./origin.js";
import {
  parseAgentAnswer,
  parseAnswer,
  parseDocumentList,
  parseImportResult,
  parseSendResult,
  parseThreadCreate,
  parseThreadDetail,
  parseThreadPage,
  snapshotAgentQuery,
  snapshotImport,
  snapshotQuery,
  snapshotSend,
  snapshotThreadCreate,
  snapshotThreadList,
} from "./parse.js";
import { assertServerRuntime } from "./runtime.js";
import { readMessageStream } from "./stream.js";
import {
  JSON_TIMEOUT_MS,
  jsonRequest,
  optionalSignal,
  READ_TIMEOUT_MS,
  STREAM_TIMEOUT_MS,
  timeoutOf,
  type TransportContext,
} from "./transport.js";
import type {
  DocumentImportInput,
  DocumentImportResult,
  EnterpriseDocument,
  IntegrationFetch,
  IntegrationRequestOptions,
  AgentQueryInput,
  AgentQueryResult,
  PrivateAnswer,
  PrivateQueryInput,
  PrivateThreadDetail,
  PrivateThreadPage,
  PrivateThreadSendInput,
  SelvrenIntegrationClientOptions,
  ThreadCreateInput,
  ThreadCreateResult,
  ThreadListInput,
  ThreadSendResult,
} from "./types.js";

const OPTION_KEYS = new Set(["baseUrl", "tenantId", "tokenProvider", "fetch"]);
const THREADS = "/v1/enterprise/private-threads";
const SPACES = "/v1/enterprise/spaces";

/**
 * Server-side fetch client for the private enterprise routes.
 * Rejects construction in a browser. Never places the token in a URL or log.
 * Does not retry mutations or streams.
 */
export class SelvrenIntegrationClient {
  readonly #ctx: TransportContext;

  constructor(options: SelvrenIntegrationClientOptions) {
    assertServerRuntime();
    if (!isRecord(options)) throw invalidRequest("constructor options are required.");
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) {
        throw invalidRequest("constructor does not accept actor, admin, or other authority fields.");
      }
    }
    const fetchImpl: IntegrationFetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#ctx = {
      origin: assertIntegrationOrigin(options.baseUrl),
      tenantId: parseTenantId(options.tenantId),
      tokenProvider: options.tokenProvider,
      fetch: fetchImpl,
    };
  }

  async listDocuments(spaceId: string, options?: IntegrationRequestOptions): Promise<EnterpriseDocument[]> {
    const id = parseSpaceId(spaceId);
    const result = await jsonRequest(this.#ctx, {
      method: "GET",
      path: `${SPACES}/${encodeSegment(id)}/documents`,
      timeoutMs: timeoutOf(options, READ_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseDocumentList(result.body);
  }

  async importDocument(
    spaceId: string,
    input: DocumentImportInput,
    options?: IntegrationRequestOptions,
  ): Promise<DocumentImportResult> {
    const id = parseSpaceId(spaceId);
    const bodyText = JSON.stringify(snapshotImport(input));
    const result = await jsonRequest(this.#ctx, {
      method: "POST",
      path: `${SPACES}/${encodeSegment(id)}/documents`,
      bodyText,
      timeoutMs: timeoutOf(options, JSON_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseImportResult(result.body);
  }

  async deleteDocument(spaceId: string, documentId: string, options?: IntegrationRequestOptions): Promise<void> {
    const space = parseSpaceId(spaceId);
    const document = parseDocumentId(documentId);
    await jsonRequest(this.#ctx, {
      method: "DELETE",
      path: `${SPACES}/${encodeSegment(space)}/documents/${encodeSegment(document)}`,
      timeoutMs: timeoutOf(options, READ_TIMEOUT_MS),
      empty: true,
      ...optionalSignal(options?.signal),
    });
  }

  async query(input: PrivateQueryInput, options?: IntegrationRequestOptions): Promise<PrivateAnswer> {
    const snapshot = snapshotQuery(input);
    const result = await jsonRequest(this.#ctx, {
      method: "POST",
      path: `${SPACES}/query`,
      bodyText: JSON.stringify(snapshot.body),
      timeoutMs: timeoutOf(options, JSON_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseAnswer(result.body, snapshot.spaceIds);
  }

  /**
   * POST /v1/enterprise/agents/:agentId/query for a published agent.
   * Agent-bound credentials are permanently limited to that agent; the server
   * denies the generic document/query/thread methods for those credentials.
   * Draft revisions are not available to service tokens.
   */
  async queryAgent(
    agentId: string,
    input: AgentQueryInput,
    options?: IntegrationRequestOptions,
  ): Promise<AgentQueryResult> {
    const id = parseAgentId(agentId);
    const snapshot = snapshotAgentQuery(input);
    const result = await jsonRequest(this.#ctx, {
      method: "POST",
      path: `/v1/enterprise/agents/${encodeSegment(id)}/query`,
      bodyText: JSON.stringify(snapshot),
      timeoutMs: timeoutOf(options, JSON_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseAgentAnswer(result.body, id);
  }

  async listThreads(
    spaceIds: readonly string[],
    input?: ThreadListInput,
    options?: IntegrationRequestOptions,
  ): Promise<PrivateThreadPage> {
    const snapshot = snapshotThreadList(spaceIds, input);
    const result = await jsonRequest(this.#ctx, {
      method: "GET",
      path: `${THREADS}?${snapshot.query}`,
      timeoutMs: timeoutOf(options, READ_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseThreadPage(result.body, snapshot.selection);
  }

  async createThread(
    spaceIds: readonly string[],
    input: ThreadCreateInput,
    options?: IntegrationRequestOptions,
  ): Promise<ThreadCreateResult> {
    const snapshot = snapshotThreadCreate(spaceIds, input);
    const result = await jsonRequest(this.#ctx, {
      method: "POST",
      path: THREADS,
      bodyText: JSON.stringify(snapshot.body),
      timeoutMs: timeoutOf(options, JSON_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseThreadCreate(result.body, snapshot.spaceIds);
  }

  async readThread(
    spaceIds: readonly string[],
    threadId: string,
    options?: IntegrationRequestOptions,
  ): Promise<PrivateThreadDetail> {
    const snapshot = snapshotThreadList(spaceIds, undefined);
    const id = parseThreadId(threadId);
    const result = await jsonRequest(this.#ctx, {
      method: "GET",
      path: `${THREADS}/${encodeSegment(id)}?${snapshot.query}`,
      timeoutMs: timeoutOf(options, READ_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseThreadDetail(result.body, snapshot.selection, id);
  }

  async deleteThread(spaceIds: readonly string[], threadId: string, options?: IntegrationRequestOptions): Promise<void> {
    const snapshot = snapshotThreadList(spaceIds, undefined);
    const id = parseThreadId(threadId);
    await jsonRequest(this.#ctx, {
      method: "DELETE",
      path: `${THREADS}/${encodeSegment(id)}?${snapshot.query}`,
      timeoutMs: timeoutOf(options, READ_TIMEOUT_MS),
      empty: true,
      ...optionalSignal(options?.signal),
    });
  }

  async sendMessage(
    spaceIds: readonly string[],
    threadId: string,
    input: PrivateThreadSendInput,
    options?: IntegrationRequestOptions,
  ): Promise<ThreadSendResult> {
    const id = parseThreadId(threadId);
    const snapshot = snapshotSend(spaceIds, input);
    const result = await jsonRequest(this.#ctx, {
      method: "POST",
      path: `${THREADS}/${encodeSegment(id)}/messages`,
      bodyText: JSON.stringify(snapshot.body),
      timeoutMs: timeoutOf(options, STREAM_TIMEOUT_MS),
      empty: false,
      ...optionalSignal(options?.signal),
    });
    return parseSendResult(result.body, snapshot.spaceIds, snapshot.clientMessageId);
  }

  /**
   * Same send body as JSON, over SSE. Expects one `accepted` event then one
   * `final` (full receipt) or `error`. Does not stream model tokens.
   */
  async sendMessageStream(
    spaceIds: readonly string[],
    threadId: string,
    input: PrivateThreadSendInput,
    options?: IntegrationRequestOptions,
  ): Promise<ThreadSendResult> {
    const id = parseThreadId(threadId);
    const snapshot = snapshotSend(spaceIds, input);
    const bodyText = JSON.stringify(snapshot.body);
    return readMessageStream(this.#ctx, {
      path: `${THREADS}/${encodeSegment(id)}/messages/stream`,
      bodyText,
      threadId: id,
      clientMessageId: snapshot.clientMessageId,
      spaceIds: snapshot.spaceIds,
      timeoutMs: timeoutOf(options, STREAM_TIMEOUT_MS),
      ...optionalSignal(options?.signal),
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
