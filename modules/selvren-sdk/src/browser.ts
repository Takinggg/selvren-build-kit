/**
 * Browser-safe entry: types, AgentTransport, session and public transports,
 * typed errors, safe hrefs. Does not import the service client, service
 * transport, or Node. HTTP uses http-core, not parseToken. Service tokens
 * are rejected. Public visitors mint an opaque session; Clerk is not required.
 */
export type { SelvrenRetryGuidance } from "./errors.js";
export {
  CLIENT_CODES,
  isRetryableAgentError,
  isSelvrenIntegrationError,
  SelvrenIntegrationError,
  shouldReuseClientRequestId,
} from "./errors.js";
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
