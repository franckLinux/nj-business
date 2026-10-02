#!/usr/bin/env node
// backend/tools/diag-permissions.js — diagnostic en lecture seule.
//
//     npm run perm:diag                 → tous les utilisateurs (hors super_admin)
//     npm run perm:diag -- caissiere1   → un seul utilisateur (username)
//
// Pour chaque personne : sa BASE (profil métier ou rôle système), ses
// exceptions individuelles (grant/deny), puis si elle a réellement les
// permissions ciblées, et sinon POURQUOI (plafond du client, exception…).
// Ne modifie rien.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sequelize, User, UserPermission, RolePermission, TenantPermission } = require('../src/models');
const { getEffectivePermissions, getBasePermissions } = require('../src/services/permission.service');

const CIBLES = ['journal.ran', 'plan_comptable.edit', 'plan_comptable.delete'];

(async () => {
  const filtre = process.argv[2];
  const where = filtre ? { username: filtre } : {};
  const users = await User.findAll({ where, attributes: ['id', 'username', 'role', 'tenant_id', 'custom_role_id'], raw: true });
  const [manquantes] = await sequelize.query(
    `SELECT c FROM unnest(ARRAY[:codes]) c WHERE c NOT IN (SELECT code FROM permissions)`,
    { replacements: { codes: CIBLES } }
  );
  if (manquantes.length) {
    console.log(`⚠ Absentes du catalogue : ${manquantes.map((r) => r.c).join(', ')} → lancez « npm run db:migrate ».\n`);
  }

  for (const u of users) {
    if (u.role === 'super_admin') continue;
    const ex = await UserPermission.findAll({ where: { user_id: u.id }, attributes: ['permission_code', 'effet'], raw: true });
    const denies = new Set(ex.filter((e) => e.effet === 'deny').map((e) => e.permission_code));
    const base = await getBasePermissions(u.id);
    const perProfil = u.custom_role_id ? await RolePermission.count({ where: { role_id: u.custom_role_id } }) : 0;
    const plafond = u.tenant_id
      ? (await TenantPermission.findAll({ where: { tenant_id: u.tenant_id }, attributes: ['permission_code'], raw: true })).map((r) => r.permission_code)
      : [];
    const niveau = (perProfil ? `profil métier #${u.custom_role_id} (${perProfil})` : `rôle système « ${u.role} »`)
      + (ex.length ? ` + ${ex.length} exception(s) individuelle(s)` : '');
    const eff = await getEffectivePermissions({ tenantId: u.tenant_id, userId: u.id, role: u.role }) || [];

    console.log(`\n■ ${u.username} [${u.role}] — droits décidés par : ${niveau}`);
    console.log(`  Plafond client : ${plafond.length ? plafond.length + ' permission(s)' : 'aucun (pas de restriction)'}`);
    for (const code of CIBLES) {
      if (eff.includes(code)) { console.log(`  ✓ ${code}`); continue; }
      let raison;
      if (plafond.length && !plafond.includes(code)) raison = 'bloquée par le plafond du client (Clients → 🔐 Permissions)';
      else if (denies.has(code)) raison = 'retirée par une exception individuelle (Utilisateurs → 🔐)';
      else if (perProfil) raison = 'absente du profil métier (Configuration → Rôles)';
      else raison = `absente du rôle système ${u.role}` + (base.includes(code) ? ' (?!)' : '');
      console.log(`  ✗ ${code} — ${raison}`);
    }
  }
  await sequelize.close();
})().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
