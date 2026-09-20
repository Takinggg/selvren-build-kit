/**
 * Browser-safe entry: types, AgentTransport, session transport, typed errors, safe hrefs.
 * Does not import the service client, service transport, or Node. Session HTTP uses
 * http-core, not parseToken. Service tokens are rejected.
 * Identity is verified upstream from the Clerk session access token.
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
export { safeHref } from "./safe-href.js";
