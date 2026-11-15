import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';

// Synchronisation du modèle vers les clients existants (réforme du plan, étape 7).
// Jamais automatique : choix des clients → aperçu → choix des changements →
// confirmation → résultat. Le serveur recalcule l'aperçu au moment d'appliquer
// et travaille dans une transaction par client.
const TYPES = {
  ajout:         { label: 'Ajout',        fg: '#15803d' },
  modification:  { label: 'Modification', fg: '#c2410c' },
  archivage:     { label: 'Archivage',    fg: '#475569' },
  desactivation: { label: 'Désactivation', fg: '#b45309' },
  reactivation:  { label: 'Réactivation', fg: '#0369a1' },
  lier:          { label: 'Rattachement', fg: '#7c3aed' },
};
const fmt = (v) => (v ? Object.entries(v).map(([k, x]) => `${k} : ${x ?? '—'}`).join(' · ') : '—');
const dateFr = (d) => (d ? new Date(d).toLocaleString('fr-FR') : 'jamais');

function ApercuClient({ client, versionId, onApplique }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState('');
  const [coches, setCoches] = useState(new Set());
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);

  const charger = useCallback(async () => {
    setData(null); setErreur(''); setResultat(null);
    const r = await api.get(`/plan-modele/synchro/${client.id}/apercu${versionId ? `?version=${versionId}` : ''}`);
    if (r.error) { setErreur(r.error); return; }
    setData(r);
    // Par défaut : tout ce qui n'est pas un conflit est coché.
    setCoches(new Set(r.changements.filter((c) => !c.conflit).map((c) => c.cle)));
  }, [client.id, versionId]);
  useEffect(() => { charger(); }, [charger]);

  const basculer = (cle) => setCoches((s) => { const n = new Set(s); if (n.has(cle)) n.delete(cle); else n.add(cle); return n; });

  const appliquer = async () => {
    const nbConflits = data.changements.filter((c) => c.conflit && coches.has(c.cle)).length;
    const msg = data.initialisation
      ? `Initialiser le plan comptable de « ${client.nom} » avec la version ${data.version.code} ?`
      : `Appliquer ${coches.size} changement(s) au plan de « ${client.nom} » (version ${data.version.code}) ?`
        + (nbConflits ? `\n\n⚠ ${nbConflits} conflit(s) coché(s) : la version du client sera remplacée.` : '')
        + '\n\nAucun compte ne sera supprimé et aucune écriture ne sera modifiée.';
    if (!window.confirm(msg)) return;
    setEnCours(true);
    const r = await api.post(`/plan-modele/synchro/${client.id}/appliquer`, { version_id: data.version.id, cles: [...coches] });
    setEnCours(false);
    if (r.error) { setErreur(r.error); toast(r.error, 'error'); return; }
    setResultat(r);
    toast(`${client.nom} : synchronisation effectuée.`, 'success');
    onApplique();
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, marginBottom: 14, background: 'white', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong>{client.nom}</strong>
        {data && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {data.client.version_code || 'aucune version'} → <strong>{data.version.code}</strong>
            {!data.initialisation && ` · ${data.resume.total} changement(s), dont ${data.resume.conflits} conflit(s)`}
          </span>
        )}
      </div>
      <div style={{ padding: 14 }}>
        {erreur && <div className="alert-err">{erreur}</div>}
        {!data && !erreur && <div className="loading-msg">Calcul de l'aperçu…</div>}
        {resultat && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, fontSize: 13 }}>
            ✅ {resultat.initialisation
              ? `Plan initialisé : ${resultat.comptes} comptes (version ${resultat.version}).`
              : `${resultat.appliques} changement(s) appliqué(s), ${resultat.ignores} laissé(s) de côté. Version du client : ${resultat.version_cible}.`}
            {resultat.cles_obsoletes?.length > 0 && <div style={{ color: '#b45309' }}>{resultat.cles_obsoletes.length} changement(s) n'étaient plus d'actualité et ont été ignorés.</div>}
          </div>
        )}
        {data && !resultat && data.initialisation && (
          <p style={{ fontSize: 13, margin: 0 }}>Ce client n'a pas encore de plan propre : il sera <strong>initialisé</strong> à partir de la version {data.version.code}.</p>
        )}
        {data && !resultat && !data.initialisation && data.changements.length === 0 && (
          <p style={{ fontSize: 13, margin: 0, color: 'var(--text-muted)' }}>Plan déjà aligné sur cette version : rien à appliquer.</p>
        )}
        {data && !resultat && data.changements.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 34 }} /><th style={{ width: 80 }}>Compte</th><th style={{ width: 110 }}>Changement</th><th>Actuellement chez le client</th><th>Après synchronisation</th></tr></thead>
              <tbody>
                {data.changements.map((c) => (
                  <tr key={c.cle} style={{ background: c.conflit ? '#fffbeb' : undefined }}>
                    <td><input type="checkbox" checked={coches.has(c.cle)} onChange={() => basculer(c.cle)} /></td>
                    <td><code style={{ fontWeight: 700 }}>{c.compte}</code></td>
                    <td>
                      <span style={{ color: TYPES[c.type]?.fg, fontWeight: 700, fontSize: 12 }}>{TYPES[c.type]?.label || c.type}</span>
                      {c.conflit && <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309' }}>⚠ CONFLIT</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmt(c.avant)}</td>
                    <td style={{ fontSize: 12 }}>
                      {fmt(c.apres)}
                      {c.motif && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>{c.motif}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !resultat && (data.initialisation || data.changements.length > 0) && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn-secondary" onClick={charger} disabled={enCours}>↻ Recalculer</button>
            <button className="btn-add" onClick={appliquer} disabled={enCours || (!data.initialisation && coches.size === 0)}>
              {data.initialisation ? 'Initialiser le plan' : `Appliquer ${coches.size} changement(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PlanSynchroPanel({ onChange }) {
  const [donnees, setDonnees] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [selection, setSelection] = useState(new Set());
  const [apercus, setApercus] = useState([]);
  const [erreur, setErreur] = useState('');

  const charger = useCallback(async () => {
    const [c, h] = await Promise.all([api.get('/plan-modele/synchro/clients'), api.get('/plan-modele/synchro/historique')]);
    if (c.error) { setErreur(c.error); return; }
    setDonnees(c);
    setHistorique(Array.isArray(h) ? h : []);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  if (erreur) return <div className="alert-err">{erreur}</div>;
  if (!donnees) return <div className="loading-msg">Chargement des clients…</div>;

  const { clients, version_publiee: v } = donnees;
  const basculer = (id) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutCocher = () => setSelection(new Set(clients.filter((c) => !c.a_jour).map((c) => c.id)));

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
        Version publiée : <strong>{v.code} — {v.libelle}</strong>. Sélectionnez un ou plusieurs clients puis prévisualisez :
        rien n'est appliqué sans votre confirmation, et chaque client est traité séparément.
      </p>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th style={{ width: 34 }} /><th>Client</th><th>Version du plan</th><th>Comptes ajoutés par le client</th><th>Comptes personnalisés</th><th>Dernière synchronisation</th><th>Dernière modification</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ opacity: c.actif ? 1 : 0.6 }}>
                <td><input type="checkbox" checked={selection.has(c.id)} disabled={c.hors_synchro} onChange={() => basculer(c.id)} /></td>
                <td>{c.nom}{!c.actif && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}> (inactif)</span>}</td>
                <td>
                  {/* 060 : un client SYCEBNL (association / ONG) ne suit pas le modèle SYSCOHADA. */}
                  {c.hors_synchro
                    ? <span style={{ fontSize: 11, fontWeight: 700, background: '#ecfdf5', color: '#047857', padding: '2px 8px', borderRadius: 10 }} title="Association / ONG : plan SYCEBNL, hors synchronisation SYSCOHADA">SYCEBNL</span>
                    : <>
                      {c.plan_initialise_le ? <code>{c.version_code}</code> : <span style={{ color: '#b45309' }}>non initialisé</span>}
                      {c.a_jour ? <span style={{ marginLeft: 6, color: '#15803d', fontSize: 11, fontWeight: 700 }}>à jour</span>
                        : <span style={{ marginLeft: 6, color: '#c2410c', fontSize: 11, fontWeight: 700 }}>en retard</span>}
                    </>}
                </td>
                <td>{c.nb_comptes_client}</td>
                <td>{c.nb_personnalises}</td>
                <td style={{ fontSize: 12 }}>{dateFr(c.plan_derniere_synchro)}</td>
                <td style={{ fontSize: 12 }}>{dateFr(c.plan_derniere_modif)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className="btn-secondary" onClick={toutCocher}>Cocher les clients en retard</button>
        <button className="btn-add" disabled={selection.size === 0}
          onClick={() => setApercus(clients.filter((c) => selection.has(c.id)))}>
          Prévisualiser ({selection.size})
        </button>
      </div>

      {apercus.map((c) => <ApercuClient key={c.id} client={c} versionId={v.id} onApplique={() => { charger(); onChange?.(); }} />)}

      <h3 style={{ fontSize: 15, margin: '24px 0 8px' }}>Historique des synchronisations</h3>
      {historique.length === 0 ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Aucune synchronisation pour l'instant.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Client</th><th>Versions</th><th>Par</th><th>Appliqués</th><th>Détail</th></tr></thead>
            <tbody>
              {historique.map((h) => (
                <tr key={h.id}>
                  <td style={{ fontSize: 12 }}>{dateFr(h.created_at)}</td>
                  <td>{h.client}</td>
                  <td style={{ fontSize: 12 }}>{h.version_source || '—'} → {h.version_cible}</td>
                  <td>{h.username || '—'}</td>
                  <td>{h.nb_appliques} / {h.nb_proposes}{h.nb_conflits ? ` (${h.nb_conflits} conflit(s) forcé(s))` : ''}</td>
                  <td style={{ fontSize: 11 }}>
                    {h.resume?.initialisation ? `Initialisation (${h.resume.comptes} comptes)`
                      : (h.details || []).map((d) => `${d.compte} ${TYPES[d.type]?.label.toLowerCase() || d.type}`).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
