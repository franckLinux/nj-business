// Page publique ouverte par le QR code d'un bon de commande. Sans session : elle confirme
// l'authenticité et l'état du bon, sans aucun prix. Le fichier reçu peut être comparé
// localement (empreinte calculée dans le navigateur, le fichier n'est envoyé nulle part).
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import '@/styles/verification.css';

const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
const ETATS = {
  authentique: ['Bon de commande authentique', 'Ce bon a bien été émis et il est en vigueur.', 'ok'],
  annule: ['Bon de commande annulé', 'Ce bon a été émis puis annulé par l\'acheteur : il ne doit plus être exécuté.', 'ko'],
  remplace: ['Bon de commande remplacé', 'Ce bon a été remplacé par une version révisée : seule la nouvelle version est valable.', 'alerte'],
  inconnu: ['Bon de commande non reconnu', 'Aucun bon de commande émis ne correspond à ce lien. Le document présenté n\'est pas authentique ou le lien est incomplet.', 'ko'],
};

export default function VerificationBcPage({ jeton }) {
  const [v, setV] = useState(null);
  const [erreur, setErreur] = useState('');
  const [comparaison, setComparaison] = useState(null);
  useEffect(() => {
    document.title = 'Vérification d\'un bon de commande — NJ BUSINESS';
    api.get(`/verification/bc/${encodeURIComponent(jeton)}`).then((r) => {
      if (r?.error) setErreur(r.error); else setV(r);
    });
  }, [jeton]);

  const comparer = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
      setComparaison({ nom: f.name, identique: hex === v.pdf_sha256 });
    } catch { setComparaison({ nom: f.name, erreur: true }); }
  };

  const [titre, texte, ton] = v ? ETATS[v.etat] || ETATS.inconnu : [];
  return (
    <div className="njv-page">
      <div className="njv-carte">
        <div className="njv-marque">NJ BUSINESS · vérification de document</div>
        {!v && !erreur && <p className="njv-texte">Vérification en cours…</p>}
        {erreur && <><h1 className="njv-titre">Vérification indisponible</h1><p className="njv-texte">{erreur} Réessayez dans quelques instants.</p></>}
        {v && (
          <>
            <div className={`njv-etat njv-${ton}`} role="status">
              <span className="njv-icone" aria-hidden="true">{ton === 'ok' ? '✓' : ton === 'alerte' ? '!' : '✕'}</span>
              <div><h1 className="njv-titre">{titre}</h1><p className="njv-texte">{texte}</p></div>
            </div>
            {v.etat !== 'inconnu' && (
              <>
                <dl className="njv-infos">
                  <div><dt>Numéro</dt><dd>{v.numero}</dd></div>
                  <div><dt>Émis par</dt><dd>{v.societe}{v.societe_nui ? <span>NUI {v.societe_nui}</span> : null}</dd></div>
                  <div><dt>Fournisseur</dt><dd>{v.fournisseur}</dd></div>
                  <div><dt>Date d'émission</dt><dd>{dateFr(v.date_emission)}</dd></div>
                  {v.date_annulation && <div><dt>{v.etat === 'annule' ? 'Annulé le' : 'Remplacé le'}</dt><dd>{dateFr(v.date_annulation)}</dd></div>}
                  {v.remplace_par && <div><dt>Version en vigueur</dt><dd>{v.remplace_par}</dd></div>}
                </dl>
                <div className="njv-compare">
                  <h2>Comparer le PDF reçu</h2>
                  <p>Choisissez le fichier PDF qui vous a été transmis : son empreinte est calculée sur votre appareil et comparée à celle du document émis. Le fichier n'est pas envoyé.</p>
                  <label className="njv-bouton">Choisir le PDF<input type="file" accept="application/pdf,.pdf" onChange={comparer} hidden /></label>
                  {comparaison && (
                    <p className={`njv-resultat ${comparaison.identique ? 'njv-ok' : 'njv-ko'}`}>
                      {comparaison.erreur ? 'Lecture du fichier impossible sur cet appareil.'
                        : comparaison.identique ? `« ${comparaison.nom} » est identique au document émis.`
                          : `« ${comparaison.nom} » est différent du document émis (modifié, ou autre version).`}
                    </p>
                  )}
                  <p className="njv-sha">Empreinte SHA-256 du document émis :<br /><code>{v.pdf_sha256}</code></p>
                </div>
              </>
            )}
          </>
        )}
        <p className="njv-pied">Cette page ne montre ni les prix ni le détail de la commande. Pour toute question, contactez l'émetteur du bon.</p>
      </div>
    </div>
  );
}
