// NJ BUSINESS — Administration : utilisateurs par module (066, super_admin).
//
// Répartition des comptes de chaque client entre ses modules, comptes sans
// module, ÉCARTS (personnes qui ont des droits dans un module sans y être
// rattachées — elles les perdraient), et bascule du contrôle :
//   observer  → rien n'est refusé, on vérifie ;
//   appliquer → chacun n'entre que dans les modules auxquels il est rattaché.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { nomModule } from '@/components/UtilisateursModule';
import '@/styles/utilisateurs-module.css';

const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function RepartitionUtilisateurs() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [q, setQ] = useState('');
  const [tout, setTout] = useState(false);
  const charger = useCallback(async () => {
    const r = await api.get('/plateforme/utilisateurs-modules');
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const changerMode = async (mode) => {
    const message = mode === 'appliquer'
      ? `Appliquer le contrôle par module ?\n\nChaque personne n'entrera plus que dans les modules auxquels elle est rattachée.${d.ecarts.length ? `\n\n⚠ ${d.ecarts.length} personne(s) perdraient un accès (voir « Écarts »).` : ''}`
      : 'Revenir en observation ?\n\nPlus aucun accès ne sera refusé à cause du rattachement aux modules.';
    if (!window.confirm(message)) return;
    setEnCours(true);
    const r = await api.put('/plateforme/utilisateurs-modules/mode', { mode });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    setD(r);
    toast(mode === 'appliquer' ? 'Contrôle par module appliqué.' : 'Contrôle par module en observation.', 'success');
  };
  const relancer = async () => {
    setEnCours(true);
    const r = await api.post('/plateforme/utilisateurs-modules/reprise', {});
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    setD(r.rapport);
    toast(`Reprise : ${r.reprise.affectations.length} compte(s) rattaché(s), ${r.reprise.sans_module.length} sans module.`, 'success', 7000);
  };

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!d) return <div className="loading-msg">Chargement…</div>;
  const applique = d.mode === 'appliquer';
  const sansModule = d.clients.reduce((n, c) => n + c.a_affecter, 0);
  // Clients à regarder d'abord : ceux qui ont des comptes sans module ou des écarts.
  const avecEcart = new Set(d.ecarts.map((e) => e.tenant_id));
  const recherche = q.trim().toLowerCase();
  const filtres = d.clients
    .filter((c) => !recherche || c.nom.toLowerCase().includes(recherche))
    .sort((a, b) => (Number(avecEcart.has(b.id)) + Number(b.a_affecter > 0)) - (Number(avecEcart.has(a.id)) + Number(a.a_affecter > 0)) || a.nom.localeCompare(b.nom));
  const LIMITE = 15;
  const affiches = tout || recherche ? filtres : filtres.slice(0, LIMITE);

  return (
    <div className="um-admin">
      <div className={'um-mode' + (applique ? ' applique' : '')}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <b>{applique ? 'Contrôle appliqué' : 'Contrôle en observation'}</b>
          <span>{applique
            ? 'Chaque personne n\'entre que dans les modules auxquels elle est rattachée.'
            : 'Rien n\'est encore refusé. Vérifiez la répartition et les écarts, puis appliquez le contrôle.'}</span>
          {d.reprise && <span className="um-sous">Reprise des comptes existants faite le {dateHeure(d.reprise.le)} : {d.reprise.rattaches} rattaché(s) sur {d.reprise.comptes}.</span>}
        </div>
        <div className="um-mode-actions">
          {sansModule > 0 && <button type="button" className="um-btn" onClick={relancer} disabled={enCours} title="Rattache, d'après leurs droits, les comptes qui n'ont encore aucun module">Reprendre les comptes sans module</button>}
          <button type="button" className={applique ? 'um-btn um-retirer' : 'btn-add'} onClick={() => changerMode(applique ? 'observer' : 'appliquer')} disabled={enCours}>
            {applique ? 'Revenir en observation' : 'Appliquer le contrôle'}
          </button>
        </div>
      </div>

      {d.ecarts.length > 0 && (
        <div className="um-ecarts" role="region" aria-label="Écarts">
          <b>⚠ Écarts ({d.ecarts.length}) : ces personnes ont des droits dans un module sans y être rattachées.</b>
          <span className="um-sous">{applique ? 'Elles n\'y ont plus accès.' : 'Elles le perdraient en appliquant le contrôle.'} Rattachez-les depuis l'écran Utilisateurs du module, ou laissez tel quel si c'est voulu.</span>
          <ul>
            {d.ecarts.slice(0, 50).map((e) => (
              <li key={e.user_id}><b>{e.username}</b> · {e.client} — {e.modules.map(nomModule).join(', ')}</li>
            ))}
          </ul>
        </div>
      )}

      <input type="search" className="um-recherche" placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Rechercher un client" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th><th style={{ textAlign: 'right' }}>Comptes</th>
              {d.modules.map((m) => <th key={m.code} style={{ textAlign: 'right' }}>{m.nom}</th>)}
              <th style={{ textAlign: 'right' }}>Sans module</th>
            </tr>
          </thead>
          <tbody>
            {affiches.length === 0 && <tr><td colSpan={d.modules.length + 3} style={{ color: 'var(--text-muted)' }}>Aucun client.</td></tr>}
            {affiches.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.nom}{avecEcart.has(c.id) && <span className="um-module um-module-vide" style={{ marginLeft: 6 }}>écart</span>}</td>
                <td style={{ textAlign: 'right' }}>{c.comptes}</td>
                {d.modules.map((m) => <td key={m.code} style={{ textAlign: 'right' }}>{c.modules[m.code] || '—'}</td>)}
                <td style={{ textAlign: 'right' }}>{c.a_affecter ? <span className="um-module um-module-vide">{c.a_affecter}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!tout && !recherche && filtres.length > LIMITE && (
        <button type="button" className="um-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setTout(true)}>Afficher les {filtres.length} clients</button>
      )}
    </div>
  );
}
