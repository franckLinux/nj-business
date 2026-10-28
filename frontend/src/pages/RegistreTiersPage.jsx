import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';
import { exporterExcel, STYLE_BOUTON_EXPORT } from '@/lib/export';

// Registre des clients / fournisseurs (migrations 043-044) — menu Contrôle
// comptable. Référentiel des tiers : le contrôle compare le nom saisi à celui
// du registre ; à la saisie de caisse, le tiers choisi apporte son NUI, son
// téléphone et son compte tiers (401… / 411…).
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--text-muted)', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 13, background: 'white' };
const cardStyle = { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 };
const TYPES = { fournisseur: 'Fournisseur', client: 'Client', mixte: 'Client et fournisseur' };
const VIDE = { type: 'fournisseur', nui: '', nom: '', rccm: '', telephone: '', email: '', adresse: '', notes: '', compte_tiers: '', verifie: false };
// Proposition de compte tiers : collectif (401 fournisseur, 411 client) + 6 lettres du nom.
const proposerCompte = (type, nom) => {
  const racine = type === 'client' ? '411' : '401';
  const lettres = String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/\b(SARL|SA|SAS|ETS|ETABLISSEMENTS?|STE|SOCIETE|LE|LA|LES|DE|DU|DES|ET)\b/g, ' ').replace(/[^A-Z0-9]/g, '');
  return lettres ? `${racine}${lettres.slice(0, 6)}` : racine;
};
const dateFr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

export default function RegistreTiersPage() {
  const { can, devise, entite } = useApp();
  const toast = useToast();
  const peutGerer = can('controle.saisir');
  const [f, setF] = useState({ q: '', type: '', actifs: '1' });
  const [liste, setListe] = useState(null);
  const [erreur, setErreur] = useState('');
  const [fiche, setFiche] = useState(null);   // { id?, ...champs }
  const [saving, setSaving] = useState(false);

  const charger = useCallback(async () => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== ''));
    const r = await api.get(`/registre-tiers?${qs}`);
    if (r.error) { setErreur(r.error); return; }
    setErreur(''); setListe(r);
  }, [f]);
  useEffect(() => { const t = setTimeout(charger, 250); return () => clearTimeout(t); }, [charger]);

  const maj = (k) => (e) => setFiche({ ...fiche, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const enregistrer = async () => {
    setSaving(true);
    const corps = { type: fiche.type, nui: fiche.nui, nom: fiche.nom, rccm: fiche.rccm, telephone: fiche.telephone,
      email: fiche.email, adresse: fiche.adresse, notes: fiche.notes, compte_tiers: fiche.compte_tiers || '', verifie: fiche.verifie };
    const r = fiche.id ? await api.put(`/registre-tiers/${fiche.id}`, corps) : await api.post('/registre-tiers', corps);
    setSaving(false);
    if (r.error) { toast(r.error, 'error', 7000); return; }
    toast(r.message || 'Fiche enregistrée ✓', 'success');
    setFiche(null); charger();
  };
  const basculer = async (t, champ) => {
    if (champ === 'actif' && t.actif && !window.confirm(`Retirer ${t.nom} des tiers actifs ? Sa fiche et son historique sont conservés.`)) return;
    const r = await api.put(`/registre-tiers/${t.id}`, { [champ]: !t[champ] });
    if (r.error) { toast(r.error, 'error', 6000); return; }
    toast(r.message, 'success'); charger();
  };
  const importer = async () => {
    if (!window.confirm('Reprendre dans le registre les tiers (NUI + nom) déjà présents sur les pièces de caisse ?\nIls seront créés « non vérifiés ».')) return;
    const r = await api.post('/registre-tiers/import-pieces', {});
    if (r.error) { toast(r.error, 'error', 6000); return; }
    toast(r.message, 'success', 6000); charger();
  };
  const exporter = () => exporterExcel('Registre_clients_fournisseurs',
    ['Type', 'NUI', 'Nom', 'Compte tiers', 'RCCM', 'Téléphone', 'E-mail', 'Adresse', 'Vérifié', 'Vérifié par', 'Vérifié le', 'Actif', 'Pièces', 'Total sorties', 'Total entrées', 'Dernière pièce', 'Notes'],
    liste.map((t) => [t.type_libelle, t.nui, t.nom, t.compte_tiers || '', t.rccm, t.telephone, t.email, t.adresse, t.verifie ? 'oui' : 'non', t.verifie_par_nom || '',
      dateFr(t.verifie_le), t.actif ? 'oui' : 'non', t.nb_pieces, t.total_sorties, t.total_entrees, dateFr(t.derniere_piece), t.notes]),
    [entite?.nom || '', 'Registre bénéficiaires Payés/Encaissés']);

  const nbVerifies = (liste || []).filter((t) => t.verifie).length;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Registre bénéficiaires Payés/Encaissés</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            Référence des tiers : un NUI et un compte tiers correspondent à un seul tiers. À la saisie, la caisse reprend le NUI, le téléphone et le compte tiers.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Link to="/controle/pieces" style={{ ...STYLE_BOUTON_EXPORT, borderColor: '#cbd5e1', color: '#334155', textDecoration: 'none' }}>📄 Rapport</Link>
          {liste?.length > 0 && can('rapport.export') && <button style={STYLE_BOUTON_EXPORT} onClick={exporter}>📊 Excel</button>}
          {peutGerer && <button style={{ ...STYLE_BOUTON_EXPORT, borderColor: '#cbd5e1', color: '#334155' }} onClick={importer}>⤵ Reprendre des pièces</button>}
          {peutGerer && <button className="btn-add" onClick={() => setFiche({ ...VIDE })}>+ Nouveau tiers</button>}
        </div>
      </div>

      <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
        <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Recherche</label>
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Nom, NUI ou RCCM" style={inputStyle} /></div>
        <div><label style={labelStyle}>Type</label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={inputStyle}>
            <option value="">Tous</option><option value="fournisseur">Fournisseurs</option><option value="client">Clients</option>
          </select></div>
        <div><label style={labelStyle}>Affichage</label>
          <select value={f.actifs} onChange={(e) => setF({ ...f, actifs: e.target.value })} style={inputStyle}>
            <option value="1">Tiers actifs</option><option value="0">Tous (y compris retirés)</option>
          </select></div>
      </div>

      {fiche && (
        <div style={{ ...cardStyle, borderColor: '#bfdbfe', background: '#f8fbff' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{fiche.id ? `Fiche de ${fiche.nom}` : 'Nouveau tiers'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div><label style={labelStyle}>Type</label>
              <select value={fiche.type} onChange={maj('type')} style={inputStyle}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label style={labelStyle}>Nom / raison sociale *</label><input value={fiche.nom} onChange={maj('nom')} style={inputStyle} /></div>
            <div><label style={labelStyle}>NUI</label><input value={fiche.nui} onChange={maj('nui')} placeholder="Ex. M050000123456P" style={{ ...inputStyle, fontFamily: 'monospace' }} /></div>
            <div><label style={labelStyle}>Compte tiers</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={fiche.compte_tiers || ''} onChange={maj('compte_tiers')} placeholder={fiche.type === 'client' ? 'Ex. 411DUPONT' : 'Ex. 401ACME'}
                  style={{ ...inputStyle, fontFamily: 'monospace', textTransform: 'uppercase' }} maxLength={17} />
                <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px', whiteSpace: 'nowrap' }} title="Proposer un compte à partir du type et du nom"
                  onClick={() => setFiche({ ...fiche, compte_tiers: proposerCompte(fiche.type, fiche.nom) })}>Proposer</button>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>Classe 4, rattaché à un collectif du plan (401, 411…). Vide : collectif par défaut.</div></div>
            <div><label style={labelStyle}>RCCM</label><input value={fiche.rccm} onChange={maj('rccm')} placeholder="Ex. RC/YAO/2024/B/123" style={inputStyle} /></div>
            <div><label style={labelStyle}>Téléphone</label><input value={fiche.telephone} onChange={maj('telephone')} style={inputStyle} /></div>
            <div><label style={labelStyle}>E-mail</label><input value={fiche.email} onChange={maj('email')} style={inputStyle} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Adresse</label><input value={fiche.adresse} onChange={maj('adresse')} style={inputStyle} /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Notes</label><textarea rows={2} value={fiche.notes} onChange={maj('notes')} style={{ ...inputStyle, resize: 'vertical' }} /></div>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '10px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={Boolean(fiche.verifie)} onChange={maj('verifie')} style={{ appearance: 'auto' }} />
            Identité vérifiée sur pièce (attestation de conformité fiscale, facture, RCCM…)
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-add" disabled={saving} onClick={enregistrer}>💾 Enregistrer</button>
            <button className="btn-ghost" onClick={() => setFiche(null)}>Annuler</button>
          </div>
        </div>
      )}

      {erreur && <div className="alert-err">{erreur}</div>}
      {!liste && !erreur && <div className="loading-msg">Chargement…</div>}
      {liste && (
        <>
          <div style={{ fontSize: 13, marginBottom: 8 }}><b>{liste.length}</b> tiers · {nbVerifies} vérifié(s)</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Nom</th><th>Type</th><th>NUI</th><th>Compte tiers</th><th>RCCM / contact</th><th style={{ textAlign: 'right' }}>Pièces</th>
                <th style={{ textAlign: 'right' }}>Payé</th><th style={{ textAlign: 'right' }}>Encaissé</th><th>Vérification</th>{peutGerer && <th />}
              </tr></thead>
              <tbody>
                {liste.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    Aucun tiers au registre.{peutGerer && ' Créez-en un, ou reprenez ceux déjà présents sur les pièces de caisse.'}
                  </td></tr>
                )}
                {liste.map((t) => (
                  <tr key={t.id} style={t.actif ? undefined : { opacity: .55 }}>
                    <td style={{ fontWeight: 600 }}>{t.nom}{!t.actif && <span style={{ fontSize: 11, fontWeight: 400 }}> (retiré)</span>}
                      {t.notes && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>{t.notes}</div>}</td>
                    <td style={{ fontSize: 12 }}>{t.type_libelle}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{t.nui || <span style={{ color: '#b45309' }}>—</span>}
                      {!t.nui_format_ok && <div style={{ fontSize: 10, color: '#b45309', fontFamily: 'inherit' }}>format inhabituel</div>}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{t.compte_tiers || <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }} title="Collectif par défaut">{t.type === 'client' ? '411' : '401'} <i>(collectif)</i></span>}</td>
                    <td style={{ fontSize: 12 }}>{t.rccm}{t.telephone && <div>{t.telephone}</div>}{t.email && <div>{t.email}</div>}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{t.nb_pieces}{t.derniere_piece && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>dern. {dateFr(t.derniere_piece)}</div>}</td>
                    <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }}>{t.total_sorties ? fmt(t.total_sorties, devise) : ''}</td>
                    <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap' }}>{t.total_entrees ? fmt(t.total_entrees, devise) : ''}</td>
                    <td style={{ fontSize: 12 }}>
                      {t.verifie
                        ? <span style={{ color: '#166534', fontWeight: 600 }} title={`Vérifié par ${t.verifie_par_nom || '?'} le ${dateFr(t.verifie_le)}`}>✓ Vérifié</span>
                        : <span style={{ color: '#b45309' }}>À vérifier</span>}
                    </td>
                    {peutGerer && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setFiche({ ...t })}>✎</button>{' '}
                        {!t.verifie && t.actif && <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => basculer(t, 'verifie')}>✓ Vérifier</button>}{' '}
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => basculer(t, 'actif')}>{t.actif ? 'Retirer' : 'Réactiver'}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
