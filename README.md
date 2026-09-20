# Selvren Build Kit

SDK TypeScript et composants React pour intégrer les agents Selvren dans vos applications. Ce dépôt contient `@selvren/sdk`, `@selvren/react` et une galerie exécutable, sous licence MIT.

Version initiale **0.1.0** : les sources sont disponibles sur GitHub ; les paquets ne sont pas encore publiés sur npm. `"private": true` évite une publication npm accidentelle. La galerie fonctionne sans compte en mode démonstration. L’accès connecté nécessite une API Selvren joignable, les fonctionnalités agents activées et les permissions correspondantes.

## Démarrage

Avec **Node 24.18.0** et **Bun 1.3.3** :

```sh
git clone https://github.com/Takinggg/selvren-build-kit.git
cd selvren-build-kit
bun install --frozen-lockfile
bun run dev
```

`dev` compile le SDK, puis React, puis lance Vite. Galerie : **http://localhost:15783** (`host: localhost`, `strictPort`). N’utilisez pas `127.0.0.1` pour Clerk : l’origine autorisée doit correspondre exactement.

Sans fichier `.env`, la galerie s’ouvre en **Démonstration** : aucun appel API, Clerk n’est pas monté, aucune variable d’environnement n’est requise.

## Construire et vérifier

```sh
bun run check
bun run build
```

- `check` — types du SDK (y compris l’entrée `browser`) et de React, puis les tests unitaires **existants** (SDK en Node, React en DOM / happy-dom).
- `build` — SDK, puis React, puis la galerie (`tsc --noEmit` + Vite).

Le moteur déclaré du SDK est Node `>=24.15 <25`. Vite résout les paquets via leurs `exports` (`dist/`) : reconstruire le kit après une modification des sources SDK/React.

## Démonstration vs session Clerk

| Mode | Comportement dans **cet** export |
| --- | --- |
| **Démonstration** (défaut) | Transport fictif dans la galerie. Pas de réseau, pas de Clerk, pas de secret. |
| **Session authentifiée** | Monte `ClerkProvider` seulement si `.env` est valide. Appels **réels** vers l’API. Une config invalide affiche un statut d’erreur ; **aucune** réponse de démo n’est substituée. |

Variables (copier `examples/selvren-build-kit/.env.example` vers `.env` dans ce même dossier d’exemple) :

- `VITE_CLERK_PUBLISHABLE_KEY` — clé **publishable** (`pk_test_` / `pk_live_`) de **la même instance Clerk** que l’API Selvren
- `VITE_SELVREN_API_ORIGIN` — origine HTTPS (HTTP seulement en loopback)
- `VITE_SELVREN_AGENT_ID` — `agt_` + 32 hex minuscules, agent **publié**

Pas de `selvren_int_*`, `selvren_private_*`, ni `sk_*` dans `VITE_*`. Pas de `end_user_ref` ni de jeton collé dans l’UI.

## Backend, auth, limites

Le mode session **dépend d’un backend Selvren joignable** et d’une configuration hors de ce dépôt :

- Ajouter `http://localhost:15783` aux origines Clerk de **cette** instance.
- L’API doit accepter les requêtes navigateur depuis cette origine pour la route d’agent en session. Un backend absent ou un CORS refusé produit un **échec réel**.
- Les grants / licences d’agent sont **côté serveur**. Ce kit n’accorde rien.
- Session navigateur : `Authorization: Bearer <jeton Clerk>` ; pas de cookies, pas d’en-tête tenant client.
- Script serveur `examples/selvren-build-kit/scripts/query-agent.ts` : `selvren_int_*` + `X-Selvren-Integration-Tenant`. Un credential **lié à un agent** est limité à cet agent.

## Transcript local

`AgentChat` mémorise les messages dans l’état React. Ce n’est **pas** un fil serveur (`private-threads`). Recharger la page perd la conversation affichée. `conversationKey` = organisation Clerk + utilisateur + agent + révision ; un changement de clé efface le transcript local.

## Accès public anonyme

Le SDK fournit aussi `createPublicAgentTransport`, compatible avec `AgentChat`, pour une diffusion approuvée explicitement dans le studio. Ce transport est en aperçu : le backend public reste en qualification et désactivé par défaut. Sa présence dans ce dépôt ne signifie pas que ce service est déjà activé. Voir les [conditions et exemples du transport public](modules/selvren-sdk/README.md#transport-public-navigateur-visiteurs). La galerie conserve ses modes démonstration et session authentifiée.

## Ce workspace

Trois chemins seulement :

- `modules/selvren-sdk`
- `modules/selvren-react`
- `examples/selvren-build-kit`

SDK et React **étendent** `../../tsconfig.base.json` (ce fichier racine). La galerie a son propre `tsconfig.json` (chemins vers les `src/` SDK/React pour l’éditeur) et déclare `@selvren/sdk` / `@selvren/react` en `workspace:*`.

Copier uniquement les trois dossiers, sans cette racine (`package.json` workspace + `tsconfig.base.json`), **ne suffit pas** : les bibliothèques ne typecheckent pas, et `workspace:*` ne se résout pas.

## Archives locales (application hôte)

Après `bun run build` (ou au moins `bun run build:kit`) :

```sh
npm pack --workspace @selvren/sdk
npm pack --workspace @selvren/react
```

Archives attendues : `selvren-sdk-0.1.0.tgz`, `selvren-react-0.1.0.tgz`. Dans l’application hôte :

```sh
npm install ./selvren-sdk-0.1.0.tgz ./selvren-react-0.1.0.tgz
```

Imports publics : `@selvren/sdk`, `@selvren/sdk/browser`, `@selvren/react`, `@selvren/react/styles.css`. Pas de `@aquachat/*`.

## Script serveur

Depuis la racine, après construction du SDK, variables hors dépôt (`SELVREN_API_URL`, `SELVREN_INTEGRATION_TENANT`, `SELVREN_INTEGRATION_TOKEN`, `SELVREN_AGENT_ID`) :

```sh
bun examples/selvren-build-kit/scripts/query-agent.ts
```

## Hors périmètre (dans cet export)

- Publication npm
- Hébergement d’une landing publique et activation du backend anonyme
- Streaming de tokens
- Faux pourcentages d’import ou sources métier inventées

## Licence

MIT pour les sources **de cet export** (voir `LICENSE` à la racine et dans chaque paquet). Les dépendances (React, Clerk, Vite, Vitest, etc.) restent sous **leurs** licences ; ce texte n’atteste pas ces licences.
