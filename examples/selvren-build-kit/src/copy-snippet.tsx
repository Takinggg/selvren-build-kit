import { useState, type ReactElement } from "react";

export function CopySnippet(props: { readonly code: string; readonly label: string }): ReactElement {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const onCopy = (): void => {
    void copyText(props.code).then((result) => {
      setStatus(result);
    });
  };

  const label = status === "copied" ? "Copié" : status === "failed" ? "Copie impossible" : "Copier";

  return (
    <div className="kit-code-panel">
      <div className="kit-code-toolbar">
        <span>{props.label}</span>
        <button type="button" className="kit-button" onClick={onCopy}>
          {label}
        </button>
      </div>
      <pre className="kit-code">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

async function copyText(text: string): Promise<"copied" | "failed"> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
