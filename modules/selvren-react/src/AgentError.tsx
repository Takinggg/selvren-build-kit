import type { ReactElement } from "react";
import { errorDisplayText, isRetryableAgentError } from "./retry.js";

export interface AgentErrorProps {
  readonly error: unknown;
  readonly errorLabel: string;
  readonly retryLabel: string;
  readonly onRetry?: (() => void) | undefined;
  readonly retryable?: boolean | undefined;
}

export function AgentError({
  error,
  errorLabel,
  retryLabel,
  onRetry,
  retryable,
}: AgentErrorProps): ReactElement {
  const canRetry = (retryable ?? isRetryableAgentError(error)) && onRetry !== undefined;
  return (
    <div className="selvren-agent-error" role="alert">
      <p className="selvren-agent-error__message">{errorDisplayText(error, errorLabel)}</p>
      {canRetry ? (
        <button type="button" className="selvren-agent-error__retry" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
