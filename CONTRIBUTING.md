# Contribuer au Build Kit

Utiliser Node 24.18.0 et Bun 1.3.3. Depuis la racine :

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun audit
```

Le mode démonstration fonctionne sans compte ni variable d’environnement. Pour vérifier un changement d’interface, utiliser `bun run dev` puis tester au clavier et sur une largeur mobile.

Une pull request doit expliquer le problème, le comportement obtenu et les vérifications effectuées. Préserver la séparation entre jetons de service côté serveur et session authentifiée côté navigateur. Ne jamais inclure de secret, document client ou fichier `.env` dans une contribution.

Les changements sont distribués sous la licence MIT de ce dépôt. La publication de paquets npm fait l’objet d’une étape distincte.
