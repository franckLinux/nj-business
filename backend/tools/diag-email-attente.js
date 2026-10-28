#!/usr/bin/env node
// backend/tools/diag-email-attente.js
// ============================================================================
//  Pourquoi l'e-mail « Dépense en attente » ne part-il pas ?
//
//      node tools/diag-email-attente.js                  → tous les clients
//      node tools/diag-email-attente.js ets-kamga        → un client (slug)
//      node tools/diag-email-attente.js ets-kamga --test moi@exemple.cm
//                                                         → + envoi d'un e-mail d'essai
//
//  Lecture seule (aucune écriture en base). Affiche :
//    1. la configuration SMTP du .env (sans le mot de passe) et un test de connexion ;
//    2. par client : l'e-mail de l'Entité, puis chaque personne habilitée à
//       valider (journal.validate) avec son e-mail de fiche et son canal ;
//    3. les 5 derniers envois tracés (action EMAIL_ATTENTE du journal d'audit).
// ============================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../src/config/database');
const { verifierSmtp, sendMouvementAttenteAlert } = require('../src/services/email.service');
const { usersAvecPermission } = require('../src/services/permission.service');

const args = process.argv.slice(2);
const iTest = args.indexOf('--test');
const adresseTest = iTest >= 0 ? args[iTest + 1] : null;
const slug = args.find((a, i) => !a.startsWith('--') && i !== iTest + 1) || null;

(async () => {
  console.log('\n── 1. SMTP ─────────────────────────────────────────────');
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_FROM']) {
    console.log(`   ${k.padEnd(12)} = ${process.env[k] || '(vide)'}`);
  }
  console.log(`   SMTP_PASS    = ${process.env.SMTP_PASS ? '(renseigné)' : '(vide)'}`);
  const smtp = await verifierSmtp();
  console.log(smtp.ok ? '   ✅ Connexion SMTP OK' : `   ❌ Connexion SMTP impossible : ${smtp.reason}`);

  console.log('\n── 2. Destinataires par client ─────────────────────────');
  const { rows: tenants } = await query(
    `SELECT id, slug, nom, email FROM tenants ${slug ? 'WHERE slug=$1' : ''} ORDER BY nom`, slug ? [slug] : []);
  if (!tenants.length) console.log(`   Aucun client${slug ? ` « ${slug} »` : ''}.`);
  for (const t of tenants) {
    const vals = await usersAvecPermission(t.id, 'journal.validate');
    const adresses = new Set();
    console.log(`\n   ${t.nom} (${t.slug})`);
    console.log(`     E-mail Entité : ${t.email || '— (vide)'}`);
    if (t.email) adresses.add(t.email.trim().toLowerCase());
    if (!vals.length) console.log('     ⚠ Personne n\'a la permission journal.validate (rôle, profil métier ou plafond).');
    for (const u of vals) {
      const canal = u.canal_notif || 'email';
      const recoit = !['aucun', 'plateforme'].includes(canal) && u.email;
      if (recoit) adresses.add(u.email.trim().toLowerCase());
      console.log(`     • ${u.username.padEnd(20)} ${u.role.padEnd(12)} e-mail=${u.email || '—'}  canal=${canal}`
        + (recoit ? '' : '  → ne reçoit pas d\'e-mail'));
    }
    console.log(adresses.size ? `     ➜ L'alerte partira à : ${[...adresses].join(', ')}`
      : '     ❌ AUCUNE adresse : renseignez l\'e-mail de l\'Entité ou celui du directeur (Configuration → Utilisateurs).');
    const { rows: traces } = await query(
      `SELECT created_at, nouvelle_valeur FROM audit_log WHERE tenant_id=$1 AND action='EMAIL_ATTENTE'
       ORDER BY created_at DESC LIMIT 5`, [t.id]).catch(() => ({ rows: [] }));
    for (const r of traces) {
      const v = r.nouvelle_valeur || {};
      const det = (v.details || []).map((d) => `${d.dest}:${d.ok ? 'OK' : (d.raison || 'échec')}`).join(' ; ');
      console.log(`     ↳ ${new Date(r.created_at).toLocaleString('fr-FR')} — ${v.envoyes || 0} envoyé(s) ${det}`);
    }
  }

  if (adresseTest) {
    console.log(`\n── 3. E-mail d'essai à ${adresseTest} ──`);
    const r = await sendMouvementAttenteAlert({
      dirEmail: adresseTest, dirNom: 'Test', tenantNom: tenants[0]?.nom || 'Test', caissierNom: 'diagnostic',
      motif: 'semaine_non_validee', semaine: 1, mois: 'Janvier', annee: new Date().getFullYear(),
      rubriqueCode: 'TEST', intitule: 'E-mail d\'essai (diagnostic)', beneficiaire: '—', sortie: 1000, mouvementId: 0,
    });
    console.log(r.sent ? '   ✅ Envoyé — vérifiez la boîte (et les indésirables).' : `   ❌ Échec : ${r.reason}`);
  }
  process.exit(0);
})().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
