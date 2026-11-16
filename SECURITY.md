# Politique de sécurité

Freenary manipule des données bancaires : la sécurité y est prise au sérieux, même pour un outil personnel.

## Signaler une vulnérabilité

**N'ouvre pas d'*issue* publique** pour une faille. Utilise le signalement privé de GitHub :
[Security › Report a vulnerability](https://github.com/tmcrn/freenary/security/advisories/new).

Décris le problème, comment le reproduire et son impact possible. Une réponse est donnée dès que possible ; la correction est publiée dans une nouvelle version, avec une mention dans [CHANGELOG.md](CHANGELOG.md).

## Données sensibles : ce qu'il ne faut jamais publier

Dans une *issue*, une *pull request*, une capture d'écran ou un message de commit, ne mets jamais :

- le contenu du dossier `data/` (base SQLite, clé `enablebanking.pem`, `enablebanking.json`, `access.json`, certificats) ;
- des IBAN, soldes, libellés de mouvements ou noms de proches ;
- un *Application ID* ou une clé privée Enable Banking.

Pour illustrer un problème, utilise les **données de démonstration** (`npm run reset-demo`).
Si un secret a fuité, **révoque-le immédiatement** : régénère l'application Enable Banking et change le mot de passe d'accès téléphone.

## Serveur MCP (Claude)

Le serveur `mcp/server.js` est facultatif. Il tourne en local, ouvre la base en **lecture seule** et n'utilise pas le réseau, mais **ce qu'il renvoie à Claude fait partie de la conversation** et est donc traité par Anthropic. Ne le branche qu'à un client en qui tu as confiance, et considère que les libellés de mouvements (noms de proches, commerces) y sont visibles.

## Modèle de menace

Freenary est conçu pour tourner **sur ta propre machine**, pour un seul utilisateur.

- Par défaut, le serveur n'écoute que sur `127.0.0.1`.
- L'accès depuis le réseau est désactivé tant que tu ne l'actives pas. Une fois activé, il exige un mot de passe, passe en HTTPS et reste limité à ton réseau local. Ne l'expose pas sur Internet.
- Le certificat HTTPS est auto-signé : c'est volontaire, et il n'authentifie le serveur qu'une fois installé sur ton appareil.

Hors périmètre : un attaquant ayant déjà un accès physique ou distant à ta session, ou la compromission de l'API d'Enable Banking ou de ta banque.
