import { AnswerSources, safeHref } from "@selvren/react";
import type { ReactElement } from "react";
import { CopySnippet } from "../copy-snippet.js";
import { DEMO_CITATIONS } from "../fixture-transport.js";
import { SOURCES_SNIPPET } from "../snippets.js";

const BLOCKED_URL = "javascript:alert(1)";

export function SourcesSection(): ReactElement {
  const safeDemo = safeHref(DEMO_CITATIONS[0]?.url);
  const blocked = safeHref(BLOCKED_URL);

  return (
    <article className="kit-entry" id="sources">
      <div>
        <h2>Sources</h2>
        <p>
          <code>AnswerSources</code> affiche nom, extrait et localisation en texte. Seuls les liens{" "}
          <code>http</code>/<code>https</code> sans identifiants dans l’URL deviennent cliquables (
          <code>safeHref</code>).
        </p>
        <CopySnippet label="Exemple AnswerSources" code={SOURCES_SNIPPET} />
      </div>
      <div>
        <AnswerSources heading="Sources" citations={DEMO_CITATIONS} />
        <p className="kit-caption">
          URL conservée : {safeDemo ?? "aucune"}. URL rejetée (<code>{BLOCKED_URL}</code>) :{" "}
          {blocked === undefined ? "non cliquable" : blocked}.
        </p>
      </div>
    </article>
  );
}
