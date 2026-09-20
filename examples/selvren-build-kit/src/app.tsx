import { useState, type ReactElement } from "react";
import { ChatSection } from "./sections/chat-section.js";
import { SourcesSection } from "./sections/sources-section.js";
import { StatesSection } from "./sections/states-section.js";

export function App(): ReactElement {
  const [mode, setMode] = useState<"fixture" | "live">("fixture");

  return (
    <div className="kit-page">
      <header className="kit-header">
        <h1>Selvren Build Kit</h1>
        <p>
          Galerie de développement pour <code>@selvren/react</code> et <code>@selvren/sdk</code>. Les aperçus importent
          les vrais composants. Le mode démonstration n’appelle pas l’API. Le mode authentifié, optionnel, utilise une
          session Clerk de la même instance que l’API Selvren.
        </p>
      </header>
      <nav className="kit-nav" aria-label="Exemples">
        <a href="#chat">Chat d’agent</a>
        <a href="#sources">Sources</a>
        <a href="#etats">États et erreurs</a>
        <a href="#installer">Installation</a>
      </nav>
      <div className="kit-mode" role="group" aria-label="Mode de la galerie">
        <button
          type="button"
          className="kit-button"
          aria-pressed={mode === "fixture"}
          onClick={() => {
            setMode("fixture");
          }}
        >
          Démonstration
        </button>
        <button
          type="button"
          className="kit-button"
          aria-pressed={mode === "live"}
          onClick={() => {
            setMode("live");
          }}
        >
          Session authentifiée
        </button>
      </div>
      <ChatSection mode={mode} />
      <SourcesSection />
      <StatesSection />
      <InstallSection />
    </div>
  );
}

function InstallSection(): ReactElement {
  return (
    <article className="kit-docs" id="installer">
      <h2>Installation</h2>
      <p>
        Les noms <code>@selvren/sdk</code> et <code>@selvren/react</code> ne sont pas publiés sur npm. Dans cet export
        source, les dépendances sont <code>workspace:*</code>. Pour une application hôte, installez une archive locale
        après <code>bun run build</code> puis <code>npm pack</code> dans chaque paquet. Ce monorepo reste privé ; le
        kit est préparé sous licence MIT. Voir le README de ce dossier.
      </p>
      <p>
        Runtime : <code>@selvren/react</code> a React (≥ 18) en pair. <code>@selvren/sdk</code> n’a pas de dépendance
        d’exécution externe (il utilise <code>fetch</code>). Aucune dépendance <code>@aquachat</code>. Ne placez jamais{" "}
        <code>selvren_int_*</code> ni une clé secrète Clerk dans <code>VITE_*</code>.
      </p>
    </article>
  );
}
