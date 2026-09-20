export { SelvrenIntegrationClient } from "./client.js";
export { assertIntegrationOrigin } from "./origin.js";
export { PRIVATE_THREAD_STREAM_TIMEOUT_MS } from "./stream.js";
export { TENANT_HEADER } from "./transport.js";
export { assertServerRuntime, isBrowserDocumentRuntime } from "./runtime.js";

export type {
  AgentQueryInput,
  AgentQueryResult,
  DocumentImportInput,
  DocumentImportResult,
  EnterpriseDocument,
  IntegrationFetch,
  IntegrationRequestOptions,
  PrivateAnswer,
  PrivateCitation,
  PrivateQueryInput,
  PrivateThreadDetail,
  PrivateThreadMessage,
  PrivateThreadPage,
  PrivateThreadSendInput,
  SelvrenIntegrationClientOptions,
  ThreadCreateInput,
  ThreadCreateResult,
  ThreadListInput,
  ThreadSendResult,
  ThreadSummary,
  TokenProvider,
} from "./types.js";

export {
  CLIENT_CODES,
  isRetryableAgentError,
  isSelvrenIntegrationError,
  SelvrenIntegrationError,
  shouldReuseClientRequestId,
} from "./errors.js";
export type { SelvrenRetryGuidance } from "./errors.js";

export type { AgentAnswer, AgentCitation, AgentQueryRequest, AgentTransport } from "./agent-transport.js";
export { agentAnswerFromPrivateQuery, createAgentTransport } from "./agent-transport.js";
export type {
  AgentRevision,
  SessionAccessTokenProvider,
  SessionAgentTransportOptions,
} from "./session-agent-transport.js";
export { createSessionAgentTransport } from "./session-agent-transport.js";
export type {
  PublicAgentSessionState,
  PublicAgentSessionStatus,
  PublicAgentTransport,
  PublicAgentTransportOptions,
} from "./public-agent-transport.js";
export { createPublicAgentTransport } from "./public-agent-transport.js";
export { safeHref } from "./safe-href.js";
