# @selvren/sdk

Client TypeScript pour l’API d’intégration Selvren (documents, question documentaire, fils, **requête d’agent**). Version **0.1.0**, paquet `private`, licence MIT. **Pas publié sur npm** : le nom n’est pas une réservation de registre.

Les sources du kit sont publiées sous licence MIT dans [selvren-build-kit](https://github.com/Takinggg/selvren-build-kit). Le paquet npm n’est pas encore publié ; installez une archive locale ou une dépendance `file:` après construction.

## Dépendances d’exécution

Aucune dépendance d’exécution externe. Le client utilise `fetch` (fourni ou global). Pas de paquet `@aquachat`.

## Deux points d’entrée

| Import | Contenu | Où l’utiliser |
| --- | --- | --- |
| `@selvren/sdk` | `SelvrenIntegrationClient` + types | Processus **serveur** uniquement |
| `@selvren/sdk/browser` | `createSessionAgentTransport`, `createPublicAgentTransport`, `AgentTransport`, erreurs typées, `safeHref` | UI / bundler de **première partie**. **Aucun `selvren_int_*`, aucun client secret.** Le graphe d’entrée n’importe pas le client de service ni `parseToken` ; le HTTP partagé est dans `http-core`. |

Construire `SelvrenIntegrationClient` dans un document navigateur lève `BROWSER_FORBIDDEN`. Ne jamais placer `selvren_int_*` ni `selvren_private_*` dans `VITE_*`, `NEXT_PUBLIC_*` ou un bundle public. Un `end_user_ref` fourni par le navigateur n’est pas une authentification.

## Origine, jetons, redirections

- `baseUrl` : origine HTTPS, ou HTTP seulement sur `127.0.0.1` / `localhost` / `[::1]`. Userinfo, query, hash et chemin sont refusés.
- Client d’intégration : `Authorization: Bearer selvren_int_*` via `tokenProvider`. Jamais dans l’URL ni dans un log. En-tête `X-Selvren-Integration-Tenant` : indice de routage ; le serveur vérifie le jeton.
- Transport de session (navigateur, dashboard) : `getAccessToken` doit renvoyer un jeton d’accès **Clerk**. Les préfixes `selvren_int_` et `selvren_private_` sont refusés. Pas d’en-tête tenant, `credentials: "omit"` (pas de cookies).
- `redirect: "manual"`. Un 3xx est une erreur ; les identifiants ne sont pas renvoyés.
- `AbortSignal` et délais : pas de relance automatique. L’attente du jeton (service ou session) s’arrête dès que le signal composé expire ou est annulé ; aucun `fetch` n’est lancé après cet arrêt.

Les UUID d’idempotence appartiennent à l’appelant. Après un échec de transport ambigu (timeout, abort en vol, réseau), rejouer **le même** UUID. Après `ENTERPRISE_MESSAGE_FAILED`, en émettre un **nouveau**.

## `queryAgent` (serveur)

```
POST /v1/enterprise/agents/:agentId/query
```

`agentId` : `agt_` + 32 hex minuscules. Corps :

```json
{
  "client_request_id": "123e4567-e89b-4d3a-a456-426614174000",
  "revision": "published",
  "question": "Quels équipements sont requis ?",
  "document_ids": ["doc-1"],
  "language": "fr"
}
```

`document_ids` et `language` sont optionnels. Le client d’intégration envoie **toujours** `revision: "published"`. Un service ne peut pas interroger un brouillon.

La réponse est l’enveloppe `PrivateAnswer` existante plus :

- `agent_id` (doit égaler l’id demandé)
- `agent_revision_id` (`agr_` + 32 hex)
- `agent_revision_number` (entier ≥ 1)
- `revision_changed` (booléen optionnel ; absent sur un backend plus ancien). `true` : une publication concurrente a eu lieu après la génération payée ; la réponse reste celle du cliché original identifié par `agent_revision_id` / `agent_revision_number`. Une nouvelle requête (nouveau UUID) utilise la nouvelle révision. Une révocation / dépublication reste refusée.

Une liaison d’agent **retire définitivement l’accès générique** au credential. Il peut être dissocié puis réaffecté explicitement à un autre agent ; cette réaffectation ne restaure jamais les routes génériques. Les méthodes génériques (`query`, documents, fils) restent sur le client pour les credentials d’espace, mais **le serveur les refuse** pour un credential lié à un agent.

## Transport de session (navigateur, première partie)

```ts
import { createSessionAgentTransport } from "@selvren/sdk/browser";

const transport = createSessionAgentTransport({
  baseUrl: "https://api.example.test",
  agentId: "agt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  getAccessToken: () => getToken(), // Clerk useAuth().getToken
  revision: "published", // ou "draft" pour tester dans le dashboard
});
```

Ce n’est **pas** un accès public anonyme. L’API vérifie l’identité de session. Le client ne fabrique pas d’`end_user_ref` et n’accepte pas une chaîne utilisateur comme preuve. Utilisez **la même instance Clerk** que l’API Selvren. L’agent doit être publié ; les droits (licence, grants) sont accordés **côté serveur**. Ce paquet n’émet pas de licence.

## Transport public (navigateur, visiteurs)

Les routes publiques (`POST /v1/public/agents/:releaseId/sessions` et `/query`) sont **éteintes par défaut** dans la configuration serveur. Elles requièrent l’activation côté API **et** une diffusion `prl_` **explicitement approuvée** dans le studio. Le service hébergé sur `https://api.selvren.com` est activé ; son parcours API/SDK a été exercé le 21 septembre 2026 avec réponse sourcée, rejeu sans nouvelle consommation et retrait effectif. Choisissez les documents et autorisez l’origine HTTPS exacte de votre site avant l’intégration. Ce paquet n’est **pas publié sur npm**.

Les visiteurs n’ont **pas de compte**. Le navigateur pose `Origin` tout seul ; le SDK ne le forge pas. Le secret de session (`pss_`) n’est pas écrit dans `localStorage`, un cookie, l’URL, un journal ou un message d’erreur. Il est transmis uniquement comme `Authorization: Bearer` au `fetch` (global ou fourni par l’hôte) ; un `fetch` personnalisé est de confiance et reçoit cet en-tête. `credentials: "omit"`. Pas de jeton de service, pas d’en-tête tenant, pas de documents/espaces/instructions choisis par le visiteur.

Les plafonds (TTL de session, tours, débits) sont des **limites techniques de déploiement**, pas une offre d’abonnement.

```ts
import { AgentChat } from "@selvren/react";
import { createPublicAgentTransport } from "@selvren/sdk/browser";
import "@selvren/react/styles.css";

const releaseId = "prl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // release publique publiée et approuvée
let conversationGeneration = 0; // Dans React, portez cette valeur dans un état qui déclenche un rendu.
const transport = createPublicAgentTransport({
  baseUrl: "https://api.example.test",
  releaseId,
  language: "fr",
});

<AgentChat conversationKey={`public:${releaseId}:${conversationGeneration}`} transport={transport} />
```

La session est créée au **premier** `query`. Pour reprendre la même requête après une erreur de transport, un timeout, un abort ou `PUBLIC_AGENT_BUSY`, conservez la même session et le même UUID. `PUBLIC_AGENT_CONFLICT` exige une **nouvelle question** et un nouvel UUID (pas de relance automatique). `PUBLIC_AGENT_DENIED` / `PUBLIC_AGENT_UNAVAILABLE`, session expirée ou quota de tours épuisé sont **terminaux** : le SDK ne recrée pas une session tout seul (un même UUID dans une nouvelle session pourrait débiter deux fois). `PUBLIC_AGENT_UNAVAILABLE` couvre aussi un tour **terminé en échec** : dans ce SDK, cela **termine la conversation**. `turnsRemaining` est la dernière valeur **acquittée avec succès** ; un tour démarré puis échoué peut en consommer davantage, les plafonds du serveur font foi. Pour une nouvelle conversation, appeler `startNewConversation()` seulement hors vol, **émettre un nouvel UUID**, puis changer `conversationKey` :

```ts
if (transport.sessionState().canStartNewConversation) {
  transport.startNewConversation();
  conversationGeneration += 1;
}
```

`sessionState()` expose le statut, `turnsRemaining` et `expiresAt` **sans** le secret. `AgentTransport.query` reste inchangé.

## AgentTransport (contrat UI)

```ts
query({ question, clientRequestId, signal }) => Promise<AgentAnswer>
```

Pas de flux mot à mot. `createAgentTransport` reste disponible pour un hôte qui injecte sa propre requête authentifiée.

## Installation locale

```sh
cd modules/selvren-sdk && bun run build && npm pack
```

Archive : `selvren-sdk-0.1.0.tgz`. Dans l’application hôte : `npm install ./selvren-sdk-0.1.0.tgz`. Dans cet export, la galerie déclare `workspace:*` via le `package.json` racine (construire `dist/` avant Vite). Une application hors de ce workspace utilise l’archive ou une dépendance `file:` vers ce dossier, une fois `dist/` présent.

`files` publie `dist/` et `LICENSE` (plus README, inclus par npm). Construire avant d’empaqueter.

## Construction

```sh
tsc -p tsconfig.build.json
tsc -p tsconfig.browser.json
```

`tsconfig.browser.json` typechecke l’entrée `browser` avec les bibliothèques DOM/ES et `types: []` (pas de types Node ambiants). Les tests unitaires du paquet sont dans `tests/`.
