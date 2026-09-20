import { useId, useState, type ReactElement, type SyntheticEvent } from "react";
import { AgentError } from "./AgentError.js";
import { AnswerSources } from "./AnswerSources.js";
import { mergeLabels } from "./labels.js";
import { isRetryableAgentError } from "./retry.js";
import type { AgentChatLabels, AgentTransport, ChatMessage } from "./types.js";
import { parseConversationKey, useAgentChat } from "./useAgentChat.js";

export interface AgentChatProps {
  readonly conversationKey: string;
  readonly transport: AgentTransport;
  readonly className?: string | undefined;
  readonly labels?: Partial<AgentChatLabels> | undefined;
}

export function AgentChat(props: AgentChatProps): ReactElement {
  const conversationKey = parseConversationKey(props.conversationKey);
  return <AgentChatSession key={conversationKey} {...props} conversationKey={conversationKey} />;
}

function AgentChatSession({
  conversationKey,
  transport,
  className,
  labels,
}: AgentChatProps): ReactElement {
  const merged = mergeLabels(labels);
  const titleId = useId();
  const inputId = useId();
  const chat = useAgentChat({ transport, conversationKey });
  const [draft, setDraft] = useState("");
  const loading = chat.status === "loading";
  const classNames = className === undefined ? "selvren-agent-chat" : `selvren-agent-chat ${className}`;

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const question = draft;
    setDraft("");
    chat.send(question);
  };

  return (
    <section className={classNames} aria-labelledby={titleId}>
      <h2 id={titleId} className="selvren-agent-chat__title">
        {merged.landmark}
      </h2>
      <div
        className="selvren-agent-chat__log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading}
      >
        {chat.messages.length === 0 && !loading ? (
          <p className="selvren-agent-chat__empty">{merged.empty}</p>
        ) : (
          <ul className="selvren-agent-chat__messages">
            {chat.messages.map((message) => (
              <MessageItem key={message.id} message={message} labels={merged} />
            ))}
          </ul>
        )}
        {loading ? (
          <p className="selvren-agent-chat__loading" data-selvren-loading="true">
            {merged.loading}
          </p>
        ) : null}
      </div>
      {chat.status === "error" && chat.error !== null ? (
        <AgentError
          error={chat.error}
          errorLabel={merged.error}
          retryLabel={merged.retry}
          retryable={isRetryableAgentError(chat.error)}
          onRetry={chat.retry}
        />
      ) : null}
      <form className="selvren-agent-chat__form" onSubmit={onSubmit}>
        <label className="selvren-agent-chat__field" htmlFor={inputId}>
          <span className="selvren-agent-chat__label">{merged.input}</span>
          <textarea
            id={inputId}
            className="selvren-agent-chat__input"
            name="question"
            rows={3}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            disabled={loading}
          />
        </label>
        <div className="selvren-agent-chat__actions">
          <button type="submit" className="selvren-agent-chat__submit" disabled={loading}>
            {merged.submit}
          </button>
          <button type="button" className="selvren-agent-chat__cancel" onClick={chat.cancel} disabled={!loading}>
            {merged.cancel}
          </button>
        </div>
      </form>
    </section>
  );
}

function MessageItem({
  message,
  labels,
}: {
  readonly message: ChatMessage;
  readonly labels: AgentChatLabels;
}): ReactElement {
  if (message.role === "user") {
    return (
      <li className="selvren-agent-chat__message selvren-agent-chat__message--user" data-selvren-role="user">
        <p className="selvren-agent-chat__author">{labels.user}</p>
        <p className="selvren-agent-chat__text">{message.text}</p>
      </li>
    );
  }
  return (
    <li className="selvren-agent-chat__message selvren-agent-chat__message--assistant" data-selvren-role="assistant">
      <p className="selvren-agent-chat__author">{labels.assistant}</p>
      <p className="selvren-agent-chat__text">{message.text}</p>
      <AnswerSources citations={message.citations} heading={labels.sources} />
    </li>
  );
}
