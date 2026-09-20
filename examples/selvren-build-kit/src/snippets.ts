export const CHAT_SNIPPET = `import { AgentChat } from "@selvren/react";
import { createSessionAgentTransport } from "@selvren/sdk/browser";
import "@selvren/react/styles.css";

<AgentChat
  conversationKey={conversationKey}
  transport={createSessionAgentTransport({
    baseUrl: apiOrigin,
    agentId,
    getAccessToken: () => getToken(),
    revision: "published",
  })}
/>`;

export const SOURCES_SNIPPET = `import { AnswerSources, safeHref } from "@selvren/react";

<AnswerSources heading="Sources" citations={answer.citations} />
// safeHref(url) keeps http(s) without userinfo; other URLs are not links.`;

export const ERROR_SNIPPET = `import { AgentError, isRetryableAgentError } from "@selvren/react";

<AgentError
  error={error}
  errorLabel="La requête a échoué."
  retryLabel="Réessayer"
  retryable={isRetryableAgentError(error)}
  onRetry={retry}
/>`;
