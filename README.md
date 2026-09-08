# OVS MCP

Serveur [Model Context Protocol](https://modelcontextprotocol.io/) non officiel pour [Official Vegan Shop](https://www.officialveganshop.com/). Ajoutez ce dépôt à Codex, Claude Code ou tout client MCP compatible, connectez votre compte OVS, puis recherchez des produits et préparez votre panier en langage naturel.

Projet indépendant, sans affiliation avec Official Vegan Shop.

## Installation dans un client MCP

Prérequis : Node.js 22.12 ou plus récent.

Utilisez directement le dépôt GitHub, sans clone local :

```json
{
  "mcpServers": {
    "ovs": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:ncleton/ovs-mcp",
        "ovs-mcp"
      ]
    }
  }
}
```

Cette configuration utilise le transport MCP `stdio`, commun aux clients de bureau. Redémarrez le client après l’ajout.

## Connexion

Demandez simplement :

> Connecte mon compte Official Vegan Shop.

Le client appelle `connect_ovs` et affiche un lien de connexion local sécurisé. Saisissez vos identifiants sur cette page, puis revenez dans le client.

Vous n’avez pas encore de compte ? Cette même page propose le lien officiel de création de compte OVS.

- Le mot de passe ne passe jamais dans la conversation ni dans le protocole MCP.
- Le mot de passe n’est jamais enregistré.
- Seuls les cookies nécessaires à la session sont conservés localement dans un fichier privé (`0600`).
- Les outils ne renvoient ni profil client, ni email, ni adresse.

Exemples de demandes :

> Cherche du seitan disponible et montre-moi les cinq meilleurs résultats.

> Ajoute deux unités du premier produit au panier.

> Montre-moi le panier OVS.

Toute modification du panier est prévisualisée et exige une confirmation liée à l’état exact du panier.
La recherche retourne `id`, `productAttributeId` et
`productCustomizationId`. Ces trois identifiants désignent ensemble la ligne
exacte ; le serveur refuse une mutation qui omet la variante ou la
personnalisation au lieu de supposer silencieusement la valeur `0`.

## Outils MCP

| Outil | Fonction |
|---|---|
| `connect_ovs` | Vérifie la connexion ou fournit le lien de connexion sécurisé |
| `search_products` | Recherche le catalogue OVS en direct |
| `get_cart` | Lit le panier sans exposer les données du compte |
| `add_to_cart` | Prévisualise, confirme et ajoute un produit |
| `remove_from_cart` | Prévisualise, confirme et retire un produit |

## CLI

```bash
npx -y --package=github:ncleton/ovs-mcp ovs connect
npx -y --package=github:ncleton/ovs-mcp ovs search "seitan"
npx -y --package=github:ncleton/ovs-mcp ovs cart
npx -y --package=github:ncleton/ovs-mcp ovs add 17170 --attribute 0 --customization 0
```

La commande `add` ou `remove` sans `--confirm` ne modifie rien : elle retourne
l’état attendu et une empreinte du panier. Pour appliquer ensuite exactement
cette prévisualisation, répétez la commande avec `--confirm` et
`--cart-fingerprint <empreinte-retournée>`. Si le panier a changé entre les
deux appels, la commande échoue et exige une nouvelle prévisualisation.

Une écriture dont la relecture devient impossible ou incohérente échoue avec
un objet structuré contenant `cart_may_be_partially_modified=true`, les
identifiants exacts de la cible, `requested_units` et `applied_units`.
`applied_units` vaut `null` tant qu’une relecture indépendante ne permet pas de
prouver le nombre réellement appliqué. Le connecteur ne répète jamais
automatiquement une écriture ambiguë.

## Développement

```bash
npm ci
npm run verify
```

Le serveur HTTP optionnel n’écoute que sur la boucle locale :

```bash
npm run compile
node dist/index.js --transport http
```

## Sécurité et confidentialité

Le dépôt ne contient aucun compte, identifiant, cookie, panier ou fixture personnelle. Le contrôle de confidentialité analyse aussi le paquet distribuable avant publication. Consultez [SECURITY.md](SECURITY.md) pour signaler un problème sans publier de secret.

Les fixtures de test sont exclusivement synthétiques, à l’exception de
l’enveloppe vide publique et expurgée du mini-panier. Le contrat observé et les
limites de chaque preuve sont documentés dans
`skills/ovs-mcp/references/observed-contract.md`.

Licence MIT.
