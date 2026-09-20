# Selvren Build Kit

Galerie **exécutable** (React + Vite) pour `@selvren/react` et `@selvren/sdk`, plus un script serveur `queryAgent`. Version des paquets **0.1.0**, licence MIT. Sources disponibles sur GitHub ; **paquets non publiés sur npm** (`private: true`).

La galerie est un outil développeur dans le style neutre des composants Selvren, pas une vitrine marketing.

## Lancer la galerie (mode démonstration, sans `.env`)

Depuis la **racine de cet export** (workspace Bun, pas seulement ce dossier) :

```sh
bun install
bun run dev
```

`bun run dev` (racine) construit SDK puis React, puis lance Vite. `bun run build` (racine) compile SDK, React, puis cet exemple. Écoute **http://localhost:15783** (`host: localhost`, `strictPort`). N’utilisez pas `127.0.0.1` pour Clerk : l’origine autorisée doit matcher exactement. Le mode **Démonstration** n’appelle pas l’API, n’instancie pas Clerk et n’a besoin d’aucune variable d’environnement.

Scripts de **ce** dossier : `dev`, `build`, `typecheck`. Le `tsconfig.json` de l’exemple est autonome (n’étend pas le tsconfig racine) et pointe vers les `src/` SDK/React. En revanche **`@selvren/sdk` et `@selvren/react` étendent `../../tsconfig.base.json` à la racine de l’export** : ce fichier est requis pour compiler les bibliothèques.

Dans cet export, les dépendances de la galerie sont `workspace:*` (voir `package.json`), pas `file:`.

## Ce dossier n’est pas installable tout seul

Ne copiez pas seulement `modules/selvren-sdk`, `modules/selvren-react` et `examples/selvren-build-kit` en espérant un `bun install` ici. Sans le `package.json` workspace et le `tsconfig.base.json` racine :

- `workspace:*` ne se résout pas ;
- `tsc` des deux paquets échoue (`extends ../../tsconfig.base.json`) ;
- Vite attend encore `dist/` via les `exports` des paquets.

Utilisez la racine de **cet** export, ou installez des archives `npm pack` dans une application hôte (section suivante).

Scripts racine utiles : `build:kit`, `build:gallery`, `dev:gallery` (Vite seul, si `dist/` existe déjà), `check`.

## Mode session authentifiée (optionnel, appels réels)

Copiez `.env.example` vers `.env` (jamais de secret de service) :

- `VITE_CLERK_PUBLISHABLE_KEY` — clé **publishable** (`pk_test_` / `pk_live_`) de **la même instance Clerk** que l’API Selvren
- `VITE_SELVREN_API_ORIGIN` — origine HTTPS de l’API (HTTP seulement en loopback)
- `VITE_SELVREN_AGENT_ID` — `agt_` + 32 hex minuscules, agent **publié**

Puis redémarrez Vite et choisissez **Session authentifiée**. Clerk n’est monté que dans ce mode, et seulement si la configuration publique est valide. Une configuration invalide affiche un statut clair : **aucune réponse fictive** n’est substituée.

Contraintes (à configurer hors de ce dépôt) :

- Ajouter `http://localhost:15783` aux origines autorisées de **cette** instance Clerk.
- L’API Selvren doit accepter les requêtes navigateur depuis cette origine pour la route d’agent en session (sinon l’échec réseau est réel).
- Les grants / licences d’agent sont **côté serveur**. Ce kit n’accorde rien automatiquement.
- Pas de `selvren_int_*`, `selvren_private_*`, ni clé secrète Clerk (`sk_*`) dans `VITE_*`. Pas de champ `end_user_ref` ni de jeton collé dans l’UI.

`conversationKey` = organisation Clerk + utilisateur + agent + révision. Déconnexion ou changement d’organisation remplace la clé et efface le transcript **local**.

Ce mode n’est **pas** un accès public anonyme. L’accès anonyme n’est **pas implémenté dans cet export**.

## Transcript local et historique serveur

`AgentChat` mémorise les messages dans l’état React. Ce n’est **pas** un fil privé persistant par utilisateur. Les fils serveur (`private-threads`) sont un autre contrat. Recharger la page perd la conversation affichée.

## Installation depuis des archives locales

Depuis la **racine de cet export**, après construction des paquets :

```sh
bun run build:kit
npm pack --workspace @selvren/sdk
npm pack --workspace @selvren/react
```

Archives produites (noms npm, depuis le répertoire courant de `npm pack`) :

- `selvren-sdk-0.1.0.tgz`
- `selvren-react-0.1.0.tgz`

Dans le répertoire de l’application hôte où vous avez copié ces fichiers :

```sh
npm install ./selvren-sdk-0.1.0.tgz ./selvren-react-0.1.0.tgz
```

Une application hôte hors workspace peut aussi pointer `file:` vers `modules/selvren-sdk` et `modules/selvren-react` **une fois `dist/` construit**. Ce n’est pas ce que déclare **cette** galerie (`workspace:*`).

Les imports publics uniquement : `@selvren/sdk`, `@selvren/sdk/browser`, `@selvren/react`, `@selvren/react/styles.css`. Pas de fichiers `src/` du monorepo, pas de `@aquachat/*`.

## Composant réutilisable et script serveur

- `src/internal-agent-chat.tsx` — `useAuth` / `getToken` de `@clerk/react` (l’hôte doit monter `ClerkProvider`)
- `src/conversation-key.ts` — sujet vérifié + agent + révision
- `scripts/query-agent.ts` — `SelvrenIntegrationClient` côté serveur

Variables du script (secrets hors dépôt) : `SELVREN_API_URL`, `SELVREN_INTEGRATION_TENANT`, `SELVREN_INTEGRATION_TOKEN` (`selvren_int_*`), `SELVREN_AGENT_ID`, optionnels `SELVREN_QUESTION` et `SELVREN_CLIENT_REQUEST_ID`.

Depuis la **racine de cet export**, après construction du SDK (`bun run build:kit` ou `cd modules/selvren-sdk && bun run build`) :

```sh
bun examples/selvren-build-kit/scripts/query-agent.ts
```

Depuis **ce dossier**, une fois le workspace racine installé et `@selvren/sdk` résolu :

```sh
bun scripts/query-agent.ts
```

## Routes actuelles

| Usage | Méthode | Chemin | Auth |
| --- | --- | --- | --- |
| Agent publié (intégration machine) | `POST` | `/v1/enterprise/agents/:agentId/query` | `Authorization: Bearer selvren_int_*` + `X-Selvren-Integration-Tenant` |
| Agent publié ou brouillon (dashboard, session vérifiée) | `POST` | `/v1/enterprise/agents/:agentId/query` | `Authorization: Bearer <jeton Clerk>` ; pas de cookies, pas de tenant client |

Pas de flux mot à mot. Un credential **lié à un agent** est limité à cet agent.

## Vérifications

Depuis la **racine de cet export** : `bun run check` puis `bun run build`.

Depuis **ce dossier**, après construction des paquets et `bun install` à la racine :

```sh
bun run typecheck
bun run build
```

## Hors périmètre

- Publication npm (non autorisée ici)
- Accès anonyme / landing publique (non implémenté dans cet export)
- Streaming de tokens
- Faux pourcentages d’import ou sources métier inventées
