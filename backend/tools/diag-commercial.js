#!/usr/bin/env node
// backend/tools/diag-commercial.js
// ============================================================================
//  Pourquoi un client ne voit-il pas NJ COMMERCIAL ?
//
//      node tools/diag-commercial.js                 → tous les clients
//      node tools/diag-commercial.js ets-kamga       → un client (slug)
//
//  Lecture seule. Vérifie, dans l'ordre où l'interface les applique :
//    0. le serveur : migrations 050 à 053 jouées, adresse de vérification ;
//    1. le catalogue : module « commercial » opérationnel ;
//    2. le client : module activé (Plateforme › client › Modules) ;
//    3. le plafond du client : contient des permissions com.* (ou pas de plafond) ;
//    4. chaque utilisateur : au moins une permission com.* effective
//       (rôle, profil métier, exceptions, plafond) → le module lui apparaît.
// ============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const { getEffectivePermissions } = require('../src/services/permission.service');

const slug = process.argv.slice(2).find((a) => !a.startsWith('--')) || null;
const ok = (c, oui, non) => console.log(`   ${c ? '✅' : '❌'} ${c ? oui : non}`);

(async () => {
  console.log('\n── 0. Serveur ──────────────────────────────────────────');
  const { rows: mig } = await query(
    "SELECT version FROM schema_migrations WHERE version ~ '^05[0-3]' ORDER BY version").catch(() => ({ rows: null }));
  if (mig) {
    for (const v of ['050', '051', '052', '053']) ok(mig.some((m) => m.version.startsWith(v)), `migration ${v} jouée`, `migration ${v} NON jouée → node db/migrate.js`);
  } else console.log('   (table des migrations illisible : vérifiez avec « node db/migrate.js --status »)');
  const verif = process.env.VERIFICATION_URL || String(process.env.APP_URL || '').split(',')[0].trim();
  ok(Boolean(verif), `adresse de vérification des bons : ${verif}`, 'APP_URL / VERIFICATION_URL vide : les bons ne pourront pas être émis');

  console.log('\n── 1. Catalogue ────────────────────────────────────────');
  const { rows: cat } = await query("SELECT statut FROM modules WHERE code = 'commercial'").catch(() => ({ rows: [] }));
  ok(cat[0]?.statut === 'operationnel', 'NJ COMMERCIAL opérationnel', `NJ COMMERCIAL ${cat[0] ? `au statut « ${cat[0].statut} »` : 'absent du catalogue'} → jouer la migration 050`);
  console.log(`   Contrôle des modules : MODULES_CONTROLE=${process.env.MODULES_CONTROLE || 'observer (défaut)'}`);

  console.log('\n── 2-4. Clients ────────────────────────────────────────');
  const { rows: tenants } = await query(
    `SELECT t.id, t.slug, t.nom, COALESCE(tm.actif, false) AS actif,
            (SELECT COUNT(*)::int FROM tenant_permissions tp WHERE tp.tenant_id = t.id) AS plafond,
            (SELECT COUNT(*)::int FROM tenant_permissions tp JOIN permissions p ON p.code = tp.permission_code
              WHERE tp.tenant_id = t.id AND p.module = 'commercial') AS plafond_com
       FROM tenants t LEFT JOIN tenant_modules tm ON tm.tenant_id = t.id AND tm.module_code = 'commercial'
      ${slug ? 'WHERE t.slug = $1' : ''} ORDER BY t.nom`, slug ? [slug] : []);
  if (!tenants.length) console.log(`   Aucun client${slug ? ` « ${slug} »` : ''}.`);
  for (const t of tenants) {
    console.log(`\n   ▸ ${t.nom} (${t.slug})`);
    ok(t.actif, 'module activé pour ce client', 'module NON activé → Plateforme › ce client › onglet Modules › activer NJ COMMERCIAL');
    if (!t.plafond) console.log('   ✅ pas de plafond de permissions (tout le catalogue est ouvert)');
    else ok(t.plafond_com > 0, `plafond : ${t.plafond_com} permission(s) com.*`, 'plafond SANS permission com.* → migration 053, ou cocher les fonctions achats dans les permissions du client');
    const { rows: users } = await query(
      `SELECT u.id, u.username, u.role, u.actif, r.nom AS profil FROM users u LEFT JOIN roles r ON r.id = u.custom_role_id
        WHERE u.tenant_id = $1 ORDER BY u.actif DESC, u.username`, [t.id]);
    for (const u of users) {
      const perms = (await getEffectivePermissions({ tenantId: t.id, userId: u.id, role: u.role })) || [];
      const com = perms.filter((p) => p.startsWith('com.')).length;
      const voit = t.actif && com > 0 && u.actif;
      console.log(`      ${voit ? '✅' : '·'} ${u.username.padEnd(22)} ${u.role.padEnd(14)} ${(u.profil || '—').padEnd(30)} ${com} droit(s) com.*${u.actif ? '' : ' (compte inactif)'}`);
    }
  }
  console.log('\n   ✅ = voit NJ COMMERCIAL sur son accueil. Après une correction, la personne se reconnecte (ou bouton Rafraîchir).\n');
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
