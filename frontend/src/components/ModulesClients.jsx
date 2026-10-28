import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

// NJ BUSINESS (048) — activation des modules par client (super_admin).
// Désactiver ne supprime aucune donnée ; un motif est exigé et tout est tracé.
// L'API refuse d'activer un module « en préparation ».
const dateFr = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '—');

function Interrupteur({ actif, desactive, onBascule, libelle }) {
  return (
    <button type="button" role="switch" aria-checked={actif} aria-label={libelle} title={libelle}
      className="njb-interrupteur" disabled={desactive} onClick={onBascule} />
  );
}

// Fenêtre de confirmation : récapitule le changement, motif obligatoire pour une désactivation.
function Confirmation({ demande, onAnnuler, onValider }) {
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const { client, module, actif } = demande;
  const valider = async () => {
    if (!actif && motif.trim().length < 3) { setErreur('Motif obligatoire pour désactiver un module.'); return; }
    setEnCours(true);
    const r = await onValider(motif.trim());
    setEnCours(false);
    if (r?.error) setErreur(r.error);
  };
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) onAnnuler(); }}>
      <div className="modal-box" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-labelledby="njb-conf-titre">
        <div className="modal-head"><h3 id="njb-conf-titre">{actif ? 'Activer' : 'Désactiver'} un module</h3><button className="modal-close" onClick={onAnnuler} aria-label="Fermer">✕</button></div>
        <div className="modal-body">
          <p style={{ marginTop: 0, fontSize: 14 }}>
            <b>{module.nom}</b> sera <b>{actif ? 'activé' : 'désactivé'}</b> pour <b>{client.nom}</b>.
          </p>
          {!actif && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Les utilisateurs de ce client n'auront plus accès au module dès leur prochaine action. Aucune donnée n'est supprimée :
              tout est retrouvé à la réactivation.
            </p>
          )}
          <label htmlFor="njb-motif" style={{ fontSize: 13, fontWeight: 600 }}>Motif{actif ? ' (facultatif)' : ' (obligatoire)'}</label>
          <textarea id="njb-motif" rows={3} value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={500}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 8, border: '1.5px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13 }} />
          {erreur && <div className="alert-err" style={{ marginTop: 10 }}>{erreur}</div>}
        </div>
        <div className="modal-foot" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-secondary" onClick={onAnnuler}>Annuler</button>
          <button className="btn-add" onClick={valider} disabled={enCours}>{enCours ? 'Enregistrement…' : 'Confirmer'}</button>
        </div>
      </div>
    </div>
  );
}

const useBascule = (apres) => {
  const toast = useToast();
  const [demande, setDemande] = useState(null);
  const valider = async (motif) => {
    const { client, module, actif } = demande;
    const r = await api.put(`/plateforme/clients/${client.id}/modules/${module.code}`, { actif, motif });
    if (r.error) return r;
    setDemande(null);
    toast(`${module.nom} ${actif ? 'activé' : 'désactivé'} pour ${client.nom}.`, 'success');
    apres();
    return r;
  };
  const fenetre = demande && <Confirmation demande={demande} onAnnuler={() => setDemande(null)} onValider={valider} />;
  return { demander: setDemande, fenetre };
};

/** Matrice clients × modules (page Administration plateforme). */
export function ModulesMatrice() {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [q, setQ] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get('/plateforme/modules');
    if (r.error) { setErreur(r.error); return; }
    setData(r); setErreur('');
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const { demander, fenetre } = useBascule(charger);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;
  const s = q.trim().toLowerCase();
  const clients = data.clients.filter((c) => !s || (c.nom || '').toLowerCase().includes(s));
  return (
    <>
      {data.mode === 'observer' && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          Contrôle serveur en mode <b>observation</b> : un module désactivé n'est pas encore refusé, le serveur journalise seulement.
          Passez <code>MODULES_CONTROLE=appliquer</code> après vérification des journaux.
        </div>
      )}
      <input type="search" placeholder="🔍 Client…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrer les clients"
        style={{ padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13, minWidth: 240, marginBottom: 10 }} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              {data.modules.map((m) => (
                <th key={m.code} style={{ textAlign: 'center' }}>
                  {m.nom}
                  {m.statut !== 'operationnel' && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>en préparation</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700 }}>
                  {c.nom}
                  {c.type_compte === 'demo' && <span style={{ marginLeft: 6, background: '#fefce8', color: '#a16207', fontSize: 10, padding: '2px 6px', borderRadius: 10 }}>DÉMO</span>}
                  {!c.actif && <span style={{ marginLeft: 6, color: '#b91c1c', fontSize: 11 }}>suspendu</span>}
                </td>
                {data.modules.map((m) => {
                  const actif = c.modules?.[m.code] === true;
                  const prepa = m.statut !== 'operationnel';
                  return (
                    <td key={m.code} style={{ textAlign: 'center' }}>
                      <Interrupteur actif={actif} desactive={prepa && !actif}
                        libelle={`${m.nom} — ${c.nom} : ${actif ? 'activé' : 'désactivé'}`}
                        onBascule={() => demander({ client: c, module: m, actif: !actif })} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fenetre}
    </>
  );
}

/** Configuration effective d'un client (fiche client, onglet Modules). */
export function ModulesClient({ id }) {
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const charger = useCallback(async () => {
    const r = await api.get(`/plateforme/clients/${id}/modules`);
    if (r.error) { setErreur(r.error); return; }
    setData(r); setErreur('');
  }, [id]);
  useEffect(() => { charger(); }, [charger]);
  const { demander, fenetre } = useBascule(charger);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!data) return <div className="loading-msg">Chargement…</div>;
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
        Modules accessibles aux utilisateurs de ce client. Les droits de chaque personne à l'intérieur d'un module restent gérés par les rôles et permissions.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Module</th><th>État</th><th>Dernier changement</th><th>Motif</th><th style={{ textAlign: 'center' }}>Accès</th></tr></thead>
          <tbody>
            {data.modules.map((m) => {
              const prepa = m.statut !== 'operationnel';
              return (
                <tr key={m.code}>
                  <td><b>{m.nom}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.description}</div></td>
                  <td style={{ fontSize: 12 }}>{prepa ? 'En préparation' : (m.actif ? <span style={{ color: '#15803d', fontWeight: 700 }}>Activé</span> : <span style={{ color: '#b91c1c', fontWeight: 700 }}>Désactivé</span>)}</td>
                  <td style={{ fontSize: 12 }}>{dateFr(m.modifie_le)}<div style={{ color: 'var(--text-muted)' }}>{m.modifie_par || (m.modifie_le ? 'système' : '')}</div></td>
                  <td style={{ fontSize: 12 }}>{m.motif || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <Interrupteur actif={m.actif} desactive={prepa && !m.actif} libelle={`${m.nom} : ${m.actif ? 'activé' : 'désactivé'}`}
                      onBascule={() => demander({ client: data.client, module: m, actif: !m.actif })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {fenetre}
    </>
  );
}
