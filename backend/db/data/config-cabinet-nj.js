// backend/db/data/config-cabinet-nj.js
// ============================================================================
//  Configuration métier du tenant « cabinet NJ ».
//  GÉNÉRÉ par `npm run config:export` — régénérez-le plutôt que de l'éditer.
//
//  Appliqué par db/lib/seed-config.lib.js :
//    • en CLI   : npm run db:config
//    • en HTTP  : GET /api/admin/setup?token=…&seed_config=1
//
//  L'UPSERT s'appuie sur les clés métier (tenants.slug, puis (tenant_id, code)
//  pour les journaux et les rubriques) : rejouable sans créer de doublon et
//  sans consommer les séquences de la base cible.
//
//  Ne contient AUCUN utilisateur ni mot de passe — voir tools/export-config.js.
// ============================================================================
module.exports = {
  genere_le: "2026-08-06T08:38:22.677Z",

  tenant: { "slug": "cabinet-nj", "nom": "cabinet NJ", "logo_url": null, "devise": "FCFA", "exercice_debut": null, "exercice_fin": null, "caissier_nom": "Astadjam", "directeur_nom": "NGAN Jean", "actif": true, "sigle": "", "forme_juridique": "", "adresse": "", "registre_commerce": "", "boite_postale": "", "nui": "", "activite": "", "dirigeant_nom": "NGAN Jean" },

  journaux: [
    { "code": "CS1", "nom": "Caisse Principale", "type": "caisse", "devise": "FCFA", "ordre": 1, "actif": true },
    { "code": "OM1", "nom": "Orange Money", "type": "om", "devise": "FCFA", "ordre": 2, "actif": true },
    { "code": "MM1", "nom": "MTN Mobile Money", "type": "momo", "devise": "FCFA", "ordre": 3, "actif": true },
    { "code": "BQ1", "nom": "Compte Banque", "type": "banque", "devise": "FCFA", "ordre": 4, "actif": true },
    { "code": "CP1", "nom": "Carte Prépayée", "type": "carte_prepayee", "devise": "FCFA", "ordre": 5, "actif": true }
  ],

  rubriques: [
    { "code": "ABQ", "intitule": "APPROV BANQUE", "type": "entree", "est_virement_interne": false, "actif": true, "ordre": 1, "code_comptable": "" },
    { "code": "ACH", "intitule": "APPROV CHINOIS", "type": "entree", "est_virement_interne": false, "actif": true, "ordre": 2, "code_comptable": "" },
    { "code": "ACA", "intitule": "APPROV CAISSE", "type": "entree", "est_virement_interne": false, "actif": true, "ordre": 3, "code_comptable": "" },
    { "code": "ANJ", "intitule": "APPROV NJ", "type": "entree", "est_virement_interne": false, "actif": true, "ordre": 4, "code_comptable": "" },
    { "code": "AFO", "intitule": "APPROV FORMATION", "type": "entree", "est_virement_interne": false, "actif": true, "ordre": 5, "code_comptable": "" },
    { "code": "VCOM", "intitule": "VIREMENT CAISSE OM", "type": "entree", "est_virement_interne": true, "actif": true, "ordre": 6, "code_comptable": "" },
    { "code": "VOMC", "intitule": "VIREMENT OM CAISSE", "type": "entree", "est_virement_interne": true, "actif": true, "ordre": 7, "code_comptable": "" },
    { "code": "1", "intitule": "ACHAT MATERIEL DE BUREAU", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 1, "code_comptable": "6015" },
    { "code": "2", "intitule": "ACHAT JOURNAUX HEBDOMADAIRE", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 2, "code_comptable": "6181" },
    { "code": "3", "intitule": "FACTURE ENEO ET CAMWATER", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 3, "code_comptable": "6053" },
    { "code": "4", "intitule": "FACTURE INTERNET", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 4, "code_comptable": "6282" },
    { "code": "5", "intitule": "FRAIS IMPRESSIONS", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 5, "code_comptable": "6252" },
    { "code": "6", "intitule": "FRAIS DE TRANSPORT DIVERS", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 6, "code_comptable": "6251" },
    { "code": "7", "intitule": "FRAIS D ENTRETIEN BUREAU", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 7, "code_comptable": "6135" },
    { "code": "8", "intitule": "FRAIS D INDEMNITES DE TRANSPORT", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 8, "code_comptable": "6611" },
    { "code": "9", "intitule": "FRAIS CNPS", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 9, "code_comptable": "6641" },
    { "code": "10", "intitule": "IMPREVUS", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 10, "code_comptable": "6599" },
    { "code": "11", "intitule": "FRAIS IMPOTS", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 11, "code_comptable": "6441" },
    { "code": "12", "intitule": "FRAIS OM", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 12, "code_comptable": "6285" },
    { "code": "13", "intitule": "FRAIS MOMO", "type": "depense", "est_virement_interne": false, "actif": true, "ordre": 13, "code_comptable": "6285" },
    { "code": "SCOM", "intitule": "SORTIE CAISSE VERS OM", "type": "depense", "est_virement_interne": true, "actif": true, "ordre": 14, "code_comptable": "" },
    { "code": "SOMC", "intitule": "SORTIE OM VERS CAISSE", "type": "depense", "est_virement_interne": true, "actif": true, "ordre": 15, "code_comptable": "" }
  ],
};
