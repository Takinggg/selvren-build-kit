import type { ReactElement } from "react";
import { safeHref } from "./safe-url.js";
import type { AgentCitation } from "./types.js";

export interface AnswerSourcesProps {
  readonly citations: readonly AgentCitation[];
  readonly heading: string;
}

export function AnswerSources({ citations, heading }: AnswerSourcesProps): ReactElement | null {
  if (citations.length === 0) return null;
  return (
    <section className="selvren-answer-sources" aria-label={heading}>
      <h3 className="selvren-answer-sources__heading">{heading}</h3>
      <ol className="selvren-answer-sources__list">
        {citations.map((citation) => (
          <li key={citation.id} className="selvren-answer-sources__item">
            <SourceItem citation={citation} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function SourceItem({ citation }: { readonly citation: AgentCitation }): ReactElement {
  const href = safeHref(citation.url);
  return (
    <div className="selvren-answer-sources__body">
      <p className="selvren-answer-sources__name">
        {href === undefined ? (
          citation.documentName
        ) : (
          <a href={href} rel="noopener noreferrer" target="_blank">
            {citation.documentName}
          </a>
        )}
      </p>
      <blockquote className="selvren-answer-sources__excerpt">{citation.excerpt}</blockquote>
      {citation.location === null ? null : (
        <p className="selvren-answer-sources__location">{citation.location}</p>
      )}
    </div>
  );
}
