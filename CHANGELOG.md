# Changelog

Toutes les évolutions notables de Freenary sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.1] - 2026-11-13

### Corrigé

- Connexion depuis le téléphone : Safari envoyait `Origin: null` en validant le formulaire et recevait « Origine invalide ». Cette origine n'est acceptée que si le navigateur confirme que la requête vient de la page elle-même (`Sec-Fetch-Site`). La politique de référent passe à `same-origin`.

## [0.1.0] - 2026-11-13

Première version publique.

### Ajouté

- Tableau de bord, mouvements, prévisions, statistiques et réglages, avec une interface responsive installable sur mobile.
- Connexion aux banques par l'API DSP2 d'Enable Banking, synchronisation automatique toutes les 6 heures et reconnexion à l'expiration du consentement.
- Catégorisation automatique par règles à mots entiers, reclassement par marchand, masquage de mouvements.
- Étagère de livres : dépenses par catégorie.
- Prévisions : mouvements récurrents, abonnements détectés, solde à 90 jours.
- Comptes suivis à la main (livrets, PEA), virements liés qui les mettent à jour automatiquement, import CSV.
- Valorisation d'un PEA à partir de ses parts : valeur liquidative officielle ou estimée en direct via l'ETF répliqué.
- Accès depuis le téléphone : opt-in, mot de passe, HTTPS, certificat installable.
- Données de démonstration pour essayer l'application sans connecter de banque.

### Sécurité

- Serveur limité à `127.0.0.1` par défaut, contrôle de `Host`, `Origin` et `Sec-Fetch-Site`, politique de sécurité de contenu stricte.
- Vérification de l'état OAuth au retour de la banque ; pages d'erreur échappées.
- Accès réseau protégé par mot de passe haché (scrypt), cookie signé et blocage après des essais répétés.
- Les données personnelles (`data/`) et les secrets sont exclus du dépôt.

[0.1.1]: https://github.com/tmcrn/freenary/releases/tag/v0.1.1
[0.1.0]: https://github.com/tmcrn/freenary/releases/tag/v0.1.0
