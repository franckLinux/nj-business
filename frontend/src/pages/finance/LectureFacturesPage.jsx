// NJ FINANCE — lot F7 (migration 082) : import et lecture automatique des factures fournisseurs.
// On dépose un PDF ou une photo ; le serveur lit la pièce (texte du PDF, ou OCR
// en français), une à la fois, sans rien envoyer à l'extérieur. La personne vérifie
// ensuite chaque champ proposé sur l'écran de saisie : aucune facture n'est créée
// sans cette vérification.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import { ouvrirFichier, lireFichier } from '@/components/commercial/achats';
import { Erreur, fmtCompta } from '@/pages/comptabilite/commun';

const TAILLE_MAX = 7 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const STATUTS = {
  en_cours: ['Lecture en cours', 'bleu'], a_verifier: ['À vérifier', 'orange'], echec: ['Illisible', 'rouge-plein'],
  utilisee: ['Facture créée', 'vert'], abandonnee: ['Abandonnée', 'gris'],
};
const MOTEURS = { texte_pdf: 'Texte du PDF', ocr_image: 'Photo lue (OCR)', ocr_pdf: 'PDF scanné lu (OCR)' };
const FILTRES = [['', 'Toutes'], ['a_verifier', 'À vérifier'], ['en_cours', 'En cours'], ['echec', 'Illisibles'], ['utilisee', 'Facture créée'], ['abandonnee', 'Abandonnées']];
const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export default function LectureFacturesPage() {
  const { can } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [filtre, setFiltre] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState([]);       // fichiers en cours d'envoi
  const [survol, setSurvol] = useState(false);
  const entree = useRef(null);

  const charger = useCallback(async () => {
    const r = await api.get(`/finance/achats/extractions${filtre ? `?statut=${filtre}` : ''}`);
    if (r?.error) { setErreur(r.error); return; }
    setErreur(''); setD(r);
  }, [filtre]);
  useEffect(() => { charger(); }, [charger]);
  // Tant qu'une pièce est en lecture, la liste se rafraîchit toute seule.
  useEffect(() => {
    if (!d?.compte?.en_cours) return undefined;
    const t = setInterval(charger, 2000);
    return () => clearInterval(t);
  }, [d?.compte?.en_cours, charger]);

  const deposer = async (fichiers) => {
    const liste = [...fichiers];
    for (const f of liste) {
      if (!TYPES.includes(f.type)) { toast(`${f.name} : PDF, JPEG, PNG ou WebP seulement.`, 'error'); continue; }
      if (f.size > TAILLE_MAX) { toast(`${f.name} : 7 Mo au plus.`, 'error'); continue; }
      setEnvoi((x) => [...x, f.name]);
      const data = await lireFichier(f).catch((e) => ({ error: e.message }));
      const r = data?.error ? data : await api.post('/finance/achats/extractions', { nom_fichier: f.name, data_base64: data });
      setEnvoi((x) => x.filter((n) => n !== f.name));
      if (r?.error) {
        toast(`${f.name} : ${r.error}`, 'error');
        if (r.doublon) navigate(`/finance/achats/${r.doublon.origine}/${r.doublon.id}`);
        continue;
      }
      toast(r.deja_deposee ? `${f.name} : pièce déjà déposée, reprise telle quelle.` : `${f.name} déposé : lecture en cours.`, 'success');
    }
    if (entree.current) entree.current.value = '';
    charger();
  };
  const abandonner = async (e) => {
    const r = await api.post(`/finance/achats/extractions/${e.id}/abandonner`);
    if (r?.error) { toast(r.error, 'error'); return; }
    toast('Lecture abandonnée.', 'success'); charger();
  };

  return (
    <div className="cm-page fin-page">
      <div className="cm-entete">
        <div>
          <h2>Import et lecture automatique</h2>
          <p>Déposez la facture d'un fournisseur (PDF ou photo). Elle est lue sur le serveur de l'application, sans être envoyée ailleurs :
            fournisseur (par son NIU), référence, dates, montants et lignes sont proposés. Vous vérifiez chaque champ avant d'enregistrer la facture.</p>
        </div>
      </div>

      <label
        className={`fin-depot${survol ? ' survol' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => { e.preventDefault(); setSurvol(false); deposer(e.dataTransfer.files); }}
      >
        <input ref={entree} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => deposer(e.target.files)} />
        <span className="fin-depot-icone" aria-hidden="true">📄</span>
        <b>Glissez les factures ici, ou cliquez pour les choisir</b>
        <span className="cm-sous">PDF, JPEG, PNG ou WebP · 7 Mo au plus par fichier · une photo nette, à plat, bien éclairée se lit mieux</span>
        {envoi.length > 0 && <span className="fin-depot-envoi">Envoi : {envoi.join(', ')}…</span>}
      </label>

      {d && (
        <div className="fin-onglets" role="tablist">
          {FILTRES.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={filtre === k} className={filtre === k ? 'actif' : ''} onClick={() => setFiltre(k)}>
              {l}{k && d.compte[k] ? ` (${d.compte[k]})` : ''}
            </button>
          ))}
        </div>
      )}
      <Erreur message={erreur} />
      {d && (d.lignes.length === 0 ? (
        <div className="fin-vide"><div className="fin-vide-icone" aria-hidden="true">🗂️</div><h3>Aucune pièce</h3>
          <p>{filtre ? 'Aucune pièce dans ce filtre.' : 'Les factures déposées apparaîtront ici, avec ce qui a été lu.'}</p></div>
      ) : (
        <div className="cm-table-wrap">
          <table className="cm-table fin-table">
            <thead><tr><th>Pièce</th><th>Fournisseur lu</th><th>Référence lue</th><th className="fin-num">TTC lu</th><th>Lecture</th><th>Statut</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {d.lignes.map((e) => {
                const [libelle, ton] = STATUTS[e.statut];
                return (
                  <tr key={e.id}>
                    <td><button type="button" className="cm-lien" onClick={() => ouvrirFichier(api, `/finance/achats/extractions/${e.id}/fichier`, e.fichier_nom, e.mime, toast)}>{e.fichier_nom}</button>
                      <div className="cm-sous">{quand(e.cree_le)}{e.cree_par_nom ? ` · ${e.cree_par_nom}` : ''}</div></td>
                    <td>{e.fournisseur || <span className="cm-sous">non reconnu</span>}</td>
                    <td className="fin-mono">{e.reference || '—'}</td>
                    <td className="fin-num">{e.total_ttc ? fmtCompta(e.total_ttc) : '—'}</td>
                    <td>{MOTEURS[e.moteur] || '—'}
                      {e.confiance_ocr !== null && e.confiance_ocr !== undefined && <div className="cm-sous">netteté {Math.round(e.confiance_ocr)} %</div>}
                      {e.duree_ms ? <div className="cm-sous">{(e.duree_ms / 1000).toFixed(1)} s</div> : null}</td>
                    <td><span className={`fin-pastille fin-pastille-${ton}`}>{libelle}</span>
                      {e.message && <div className="cm-sous">{e.message}</div>}</td>
                    <td className="fin-actions-ligne">
                      {e.statut === 'a_verifier' && can('finance.achats.saisir') && (
                        <Link className="cm-btn cm-primaire cm-petit" to={`/finance/achats/nouvelle?extraction=${e.id}`}>Vérifier et saisir</Link>)}
                      {e.statut === 'echec' && can('finance.achats.saisir') && (
                        <Link className="cm-btn cm-secondaire cm-petit" to="/finance/achats/nouvelle">Saisir à la main</Link>)}
                      {e.statut === 'utilisee' && e.facture_id && (
                        <Link className="cm-btn cm-secondaire cm-petit" to={`/finance/achats/fin/${e.facture_id}`}>{e.facture_numero || 'Brouillon'}</Link>)}
                      {['a_verifier', 'echec'].includes(e.statut) && (
                        <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => abandonner(e)}>Abandonner</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
