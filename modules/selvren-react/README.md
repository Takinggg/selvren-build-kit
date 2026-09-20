# @selvren/react

Composants React accessibles pour un chat d’agent Selvren : `AgentChat`, `AnswerSources`, `AgentError`. Version **0.1.0**, paquet `private`, licence MIT. **Pas publié sur npm** : le nom n’est pas une réservation de registre.

Le monorepo Selvren reste privé. Installez une archive locale ou une dépendance `file:` tant que le paquet n’est pas publié. Dans cet export, la galerie déclare `workspace:*` via le workspace Bun racine ; construisez `dist/` avant Vite.

## Dépendances d’exécution

Pair : `react` ≥ 18. Pas d’autre runtime. Pas de paquet `@aquachat`. Les styles se chargent explicitement :

```ts
import "@selvren/react/styles.css";
```

Le CSS est préfixé `.selvren-` (pas de sélecteur global `html`/`body`). Personnalisation par variables :

`--selvren-fg`, `--selvren-bg`, `--selvren-border`, `--selvren-link`, `--selvren-button-fg`, `--selvren-button-bg`, `--selvren-input-bg`, `--selvren-error-border`, `--selvren-accent`, `--selvren-radius`, `--selvren-space`, `--selvren-font`, `--selvren-source-bg`.

Le composant reçoit un `transport` et une `conversationKey` **stable**, jamais un jeton. L’authentification se fait par la session vérifiée (dashboard Clerk) ou par votre serveur. Aucun flux mot à mot n’est simulé : l’interface attend la réponse finale.

`conversationKey` isole l’état **local** (messages, erreurs, requête en cours, brouillon) par **sujet authentifié + agent + révision**. Ce n’est pas une autorité : l’API vérifie la session. Ce transcript n’est **pas** l’historique serveur des fils privés (`private-threads`) : un rechargement de page l’efface. Un changement de clé abandonne la requête précédente et efface l’historique affiché. Changer seulement l’objet `transport` ne réinitialise pas la conversation.

Les identifiants de ligne (`message.id`) sont locaux (`user|assistant` + `clientRequestId`). `answer.requestId` reste sur le champ `requestId` ; l’idempotence HTTP n’est pas modifiée.

```ts
import { AgentChat } from "@selvren/react";
import { createSessionAgentTransport } from "@selvren/sdk/browser";
import { useAuth } from "@clerk/react";
import "@selvren/react/styles.css";

const { getToken, userId, orgId } = useAuth();
const revision = "published";
const conversationKey = `${orgId ?? "user"}:${userId}:${agentId}:${revision}`;

<AgentChat
  conversationKey={conversationKey}
  transport={createSessionAgentTransport({
    baseUrl: apiOrigin,
    agentId,
    getAccessToken: () => getToken(),
    revision,
  })}
/>
```

`useAgentChat` n’est pas exporté par l’entrée publique. S’il est réutilisé en interne, il exige la même `conversationKey`.

Les sources s’affichent en texte. Seuls les liens `http:` / `https:` sans userinfo sont cliquables (`safeHref`). Pas de HTML arbitraire.

En cas d’échec réseau ambigu ou d’abandon en vol, « Réessayer » reprend le **même** UUID de requête. Après un échec terminal d’idempotence, un nouvel UUID est émis. Annuler ou démonter abandonne la requête en cours sans inventer de succès.

## Installation locale

```sh
cd modules/selvren-react && bun run build && npm pack
```

Archive : `selvren-react-0.1.0.tgz`. `files` publie `dist/`, `css/` et `LICENSE`. Construire avant d’empaqueter.
