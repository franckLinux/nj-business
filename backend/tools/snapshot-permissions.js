#!/usr/bin/env node
// backend/tools/snapshot-permissions.js — photographie en lecture seule des
// droits EFFECTIFS de chaque utilisateur, pour prouver qu'une migration des
// permissions ne change rien (ou seulement ce qui est voulu).
//
//     node tools/snapshot-permissions.js > avant.json     (avant la 014)
//     ... npm run db:migrate + redémarrage ...
//     node tools/snapshot-permissions.js > apres.json
//     node tools/snapshot-permissions.js --diff avant.json apres.json
const fs = require('fs');
const path = require('path');

const diff = (a, b) => {
  const A = JSON.parse(fs.readFileSync(a, 'utf8'));
  const B = JSON.parse(fs.readFileSync(b, 'utf8'));
  let n = 0;
  for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const x = new Set(A[id]?.permissions || []);
    const y = new Set(B[id]?.permissions || []);
    const perdues = [...x].filter((c) => !y.has(c));
    const gagnees = [...y].filter((c) => !x.has(c));
    if (perdues.length || gagnees.length) {
      n += 1;
      const who = (A[id] || B[id]).username;
      console.log(`■ ${who}`);
      if (perdues.length) console.log(`   − ${perdues.join(', ')}`);
      if (gagnees.length) console.log(`   + ${gagnees.join(', ')}`);
    }
  }
  console.log(n ? `\n${n} utilisateur(s) avec des droits différents.` : '✓ Droits effectifs identiques pour tous les utilisateurs.');
  process.exit(n ? 1 : 0);
};

if (process.argv[2] === '--diff') diff(process.argv[3], process.argv[4]);
else {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { sequelize, User } = require('../src/models');
  const { getEffectivePermissions } = require('../src/services/permission.service');
  (async () => {
    const users = await User.findAll({ attributes: ['id', 'username', 'role', 'tenant_id'], raw: true });
    const out = {};
    for (const u of users) {
      const p = await getEffectivePermissions({ tenantId: u.tenant_id, userId: u.id, role: u.role });
      out[u.id] = { username: u.username, role: u.role, permissions: p === null ? ['*'] : [...p].sort() };
    }
    process.stdout.write(JSON.stringify(out, null, 2));
    await sequelize.close();
  })().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });
}
