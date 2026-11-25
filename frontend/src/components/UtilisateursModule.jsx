// NJ BUSINESS — Utilisateurs d'un module (migration 066, lot C).
//
// Briques partagées par NJ CAISSE PRO (Configuration → Utilisateurs) et
// NJ COMMERCIAL (Utilisateurs et rôles) : chaque module affiche SES acteurs,
// rattache un compte existant, lui donne un profil propre au module, ou le
// retire (jamais de suppression : son historique reste intact).
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { api } from '@/lib/api';
import '@/styles/utilisateurs-module.css';

const NOMS_MODULES = { caisse: 'NJ FINANCE', commercial: 'NJ COMMERCIAL', comptabilite: 'NJ COMPTABILITÉ' };
export const nomModule = (code) => NOMS_MODULES[code] || code;
const dateHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Jamais');

/**
 * Données du module : membres, autres comptes du client, résumé, profils.
 * `indisponible` : système non installé ou module non activé (l'écran garde
 * alors son affichage d'avant, sans filtre).
 */
export function useUtilisateursModule(code, actif = true) {
  const [data, setData] = useState(null);
  const [indisponible, setIndisponible] = useState(false);
  const [erreur, setErreur] = useState('');
  const recharger = useCallback(async () => {
    if (!actif) { setIndisponible(true); return; }
    const r = await api.get(`/modules/${code}/utilisateurs`);
    if (r?.error) {
      if (/introuvable|activé|pas encore disponible/i.test(r.error)) setIndisponible(true);
      else setErreur(r.error);
      return;
    }
    setErreur(''); setIndisponible(false); setData(r);
  }, [code, actif]);
  useEffect(() => { recharger(); }, [recharger]);
  return { data, indisponible, erreur, recharger, setData };
}

/** Résumé du module + information sur le mode du contrôle d'accès. */
export function BandeauModule({ data }) {
  if (!data) return null;
  const r = data.resume;
  return (
    <div className="um-bandeau">
      <div className="um-chiffres" role="list" aria-label={`Utilisateurs de ${data.module.nom}`}>
        <span role="listitem" className="um-chiffre"><b>{r.membres}</b> utilisateur{r.membres > 1 ? 's' : ''}</span>
        <span role="listitem" className="um-chiffre um-ok"><b>{r.actifs}</b> actif{r.actifs > 1 ? 's' : ''}</span>
        <span role="listitem" className="um-chiffre um-off"><b>{r.desactives}</b> désactivé{r.desactives > 1 ? 's' : ''}</span>
        {r.a_affecter > 0 && <span role="listitem" className="um-chiffre um-alerte"><b>{r.a_affecter}</b> compte{r.a_affecter > 1 ? 's' : ''} sans module</span>}
      </div>
      {data.mode !== 'appliquer' && (
        <p className="um-note">Contrôle par module en <b>observation</b> : la liste montre qui travaille dans {data.module.nom}, mais les accès ne sont pas encore restreints. Le cabinet l'activera après vérification.</p>
      )}
    </div>
  );
}

/** Profil propre au module (sélecteur compact). */
export function ProfilModule({ u, data, code, onChange, desactive }) {
  const toast = useToast();
  const [enCours, setEnCours] = useState(false);
  const changer = async (e) => {
    const v = e.target.value;
    setEnCours(true);
    const r = await api.put(`/modules/${code}/utilisateurs/${u.id}`, { role_id: v ? Number(v) : null });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    toast(`Profil ${nomModule(code)} de ${u.username} enregistré.`, 'success');
    onChange?.(r);
  };
  return (
    <select className="um-select" value={u.profil_module?.id || ''} onChange={changer} disabled={desactive || enCours}
      aria-label={`Profil ${nomModule(code)} de ${u.username}`}>
      <option value="">Selon le compte{u.profil_compte ? ` (${u.profil_compte})` : ''}</option>
      {data.profils.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
    </select>
  );
}

/** Fenêtre de retrait d'un module (motif obligatoire). */
export function RetraitModule({ cible, code, onFermer, onFait }) {
  const toast = useToast();
  const [motif, setMotif] = useState('');
  const [enCours, setEnCours] = useState(false);
  const retirer = async (e) => {
    e.preventDefault();
    setEnCours(true);
    const r = await api.delete(`/modules/${code}/utilisateurs/${cible.id}`, { motif });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    toast(`${cible.username} ne fait plus partie de ${nomModule(code)}.`, 'success');
    onFait?.(r);
  };
  return (
    <div className="modal-overlay" style={{ display: 'flex' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !enCours) onFermer(); }}>
      <form className="modal-box um-modale" onSubmit={retirer} role="dialog" aria-modal="true" aria-labelledby="um-retrait-titre">
        <div className="modal-head">
          <h3 id="um-retrait-titre">Retirer {cible.username} de {nomModule(code)}</h3>
          <button type="button" className="modal-close" onClick={onFermer} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">
          <p className="um-texte">La personne n'aura plus accès à {nomModule(code)}. Son compte, ses autres modules et tout ce qu'elle a déjà saisi restent intacts ; vous pourrez la rattacher à nouveau plus tard.</p>
          <label className="um-label" htmlFor="um-motif">Motif <span className="req">*</span></label>
          <textarea id="um-motif" className="um-textarea" value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={500} rows={3}
            placeholder="Ex : changement de poste, fin de mission" required autoFocus />
        </div>
        <div className="modal-foot" style={{ gap: 10 }}>
          <button type="button" className="btn-ghost" onClick={onFermer} disabled={enCours}>Annuler</button>
          <button type="submit" className="btn-danger" disabled={enCours || motif.trim().length < 3}>{enCours ? 'Retrait…' : 'Retirer du module'}</button>
        </div>
      </form>
    </div>
  );
}

/** Comptes du client qui ne font pas partie du module : rattachement en un clic. */
export function ComptesHorsModule({ data, code, peutGerer, onChange }) {
  const toast = useToast();
  const [ajout, setAjout] = useState(null);       // compte à rattacher
  const [profil, setProfil] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [ouvert, setOuvert] = useState(data.resume.a_affecter > 0);
  if (!data.autres.length) return null;
  const rattacher = async () => {
    setEnCours(true);
    const r = await api.post(`/modules/${code}/utilisateurs`, { user_id: ajout.id, role_id: profil ? Number(profil) : null });
    setEnCours(false);
    if (r?.error) { toast(r.error, 'error', 7000); return; }
    toast(`${ajout.username} fait désormais partie de ${nomModule(code)}.`, 'success');
    setAjout(null); setProfil('');
    onChange?.(r);
  };
  return (
    <section className="um-autres">
      <button type="button" className="um-autres-titre" aria-expanded={ouvert} onClick={() => setOuvert(!ouvert)}>
        <span>Autres comptes de l'entreprise ({data.autres.length})</span>
        {data.resume.a_affecter > 0 && <span className="um-pastille-alerte">{data.resume.a_affecter} sans module</span>}
        <span className="um-chevron" aria-hidden="true">{ouvert ? '▴' : '▾'}</span>
      </button>
      {ouvert && (
        <>
          <p className="um-texte">Ces comptes n'ont pas accès à {nomModule(code)}. Rattachez ceux qui doivent y travailler.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Modules</th><th>Dernière connexion</th>{peutGerer && <th aria-label="Action" />}</tr></thead>
              <tbody>
                {data.autres.map((u) => (
                  <tr key={u.id} style={!u.compte_actif ? { opacity: 0.55 } : undefined}>
                    <td><b style={{ fontSize: 13 }}>{u.username}</b>{u.email && <span className="um-sous">{u.email}</span>}</td>
                    <td style={{ fontSize: 12.5 }}>{u.role_libelle}{u.profil_compte && <span className="um-sous">{u.profil_compte}</span>}</td>
                    <td>
                      {u.modules.length
                        ? u.modules.map((m) => <span key={m} className="um-module">{nomModule(m)}</span>)
                        : <span className="um-module um-module-vide">Aucun — à affecter</span>}
                      {u.retire && <span className="um-sous">Retiré : {u.motif}</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dateHeure(u.derniere_connexion)}</td>
                    {peutGerer && (
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="um-btn" onClick={() => { setAjout(u); setProfil(''); }} disabled={!u.compte_actif}
                          title={u.compte_actif ? '' : 'Compte désactivé'}>+ Ajouter à {nomModule(code)}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ajout && (
        <div className="modal-overlay" style={{ display: 'flex' }} onMouseDown={(e) => { if (e.target === e.currentTarget && !enCours) setAjout(null); }}>
          <div className="modal-box um-modale" role="dialog" aria-modal="true" aria-labelledby="um-ajout-titre">
            <div className="modal-head">
              <h3 id="um-ajout-titre">Ajouter {ajout.username} à {nomModule(code)}</h3>
              <button type="button" className="modal-close" onClick={() => setAjout(null)} aria-label="Fermer">✕</button>
            </div>
            <div className="modal-body">
              <label className="um-label" htmlFor="um-profil">Profil dans {nomModule(code)}</label>
              <select id="um-profil" className="um-select um-select-large" value={profil} onChange={(e) => setProfil(e.target.value)}>
                <option value="">Selon le compte ({ajout.role_libelle}{ajout.profil_compte ? ` · ${ajout.profil_compte}` : ''})</option>
                {data.profils.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
              <p className="um-texte" style={{ marginTop: 10 }}>Le profil fixe ce que la personne peut faire dans {nomModule(code)} ; ses autres modules ne changent pas.</p>
            </div>
            <div className="modal-foot" style={{ gap: 10 }}>
              <button type="button" className="btn-ghost" onClick={() => setAjout(null)} disabled={enCours}>Annuler</button>
              <button type="button" className="btn-add" onClick={rattacher} disabled={enCours}>{enCours ? 'Ajout…' : 'Ajouter au module'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Le droit de gérer les membres (le serveur contrôle de toute façon). */
export const usePeutGererModule = () => {
  const { can } = useApp();
  return can('users.edit');
};
