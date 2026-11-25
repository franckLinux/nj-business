import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import JournalPage from '@/pages/JournalPage';
import AttentePage from '@/pages/AttentePage';
import JournauxRecapPage from '@/pages/JournauxRecapPage';
import BudgetPage from '@/pages/BudgetPage';
import PrevisionsPage from '@/pages/PrevisionsPage';
import AppelFondsPage from '@/pages/AppelFondsPage';
import SuiviActivitesPage from '@/pages/SuiviActivitesPage';
import ProjetsPage from '@/pages/ProjetsPage';
import ProjetPage from '@/pages/ProjetPage';
import ProjetsAControlerPage from '@/pages/ProjetsAControlerPage';
import ProjetsBilanPage from '@/pages/ProjetsBilanPage';
import CompteEmploiPage from '@/pages/CompteEmploiPage';
import ConfigPage from '@/pages/ConfigPage';
import PasserelleTab from '@/components/config/PasserelleTab';
import ControlePage from '@/pages/ControlePage';
import RegistreTiersPage from '@/pages/RegistreTiersPage';
import ArretsInventairesPage from '@/pages/ArretsInventairesPage';
import EcartsCaissePage from '@/pages/EcartsCaissePage';
import TenantsPage from '@/pages/TenantsPage';
import PermissionsPage from '@/pages/PermissionsPage';
import PlanModelePage from '@/pages/PlanModelePage';
import ValidationDirectePage from '@/pages/ValidationDirectePage';
import PlateformePage from '@/pages/PlateformePage';
import ProspectsPage from '@/pages/ProspectsPage';
import MyNjBusinessPage from '@/pages/MyNjBusinessPage';
import ActivationPage from '@/pages/ActivationPage';
import DemandeDemoPage from '@/pages/DemandeDemoPage';
import ReinitialisationPage from '@/pages/ReinitialisationPage';
import PwaBootstrap from '@/components/PwaBootstrap';
import OfflineIndicator from '@/components/OfflineIndicator';
import { PAGE_PERMS, peut, peutGererProspects, voitConfiguration } from '@/lib/acces';
import AccueilPage from '@/pages/AccueilPage';
import EntreprisePage from '@/pages/EntreprisePage';
import CommercialLayout, { peutUn, DROITS_DEMANDES, DROITS_AUTORISATIONS, DROITS_BONS, DROITS_HISTORIQUE, DROITS_CONSULTATIONS, DROITS_FRAIS } from '@/components/commercial/CommercialLayout';
import DemandesPage from '@/pages/commercial/DemandesPage';
import DemandeFormPage from '@/pages/commercial/DemandeFormPage';
import DemandePage from '@/pages/commercial/DemandePage';
import BonsPage from '@/pages/commercial/BonsPage';
import BonFormPage from '@/pages/commercial/BonFormPage';
import BonPage from '@/pages/commercial/BonPage';
import TableauBordPage from '@/pages/commercial/TableauBordPage';
import DocumentsPage from '@/pages/commercial/DocumentsPage';
import HistoriquePage from '@/pages/commercial/HistoriquePage';
import ConfigurationPage from '@/pages/commercial/ConfigurationPage';
import StockEtatPage from '@/pages/commercial/StockEtatPage';
import StockDocsPage from '@/pages/commercial/StockDocsPage';
import StockDocFormPage from '@/pages/commercial/StockDocFormPage';
import StockDocPage from '@/pages/commercial/StockDocPage';
import { StockMouvementsPage, StockValorisationPage } from '@/pages/commercial/StockMouvementsPage';
import { DROITS_STOCK, DROITS_SAISIE } from '@/components/commercial/stock';
import { ReceptionsPage, ReceptionFormPage, ReceptionPage } from '@/pages/commercial/ReceptionsPages';
import { RetoursFournPage, RetourFournFormPage, RetourFournPage } from '@/pages/commercial/RetoursFournPages';
import { FacturesFournPage, FactureFournFormPage, FactureFournPage, ValidationAchatsPage } from '@/pages/commercial/FacturesFournPages';
import { DevisListePage, DevisFormPage, DevisPage, CommandesClientsPage, CommandeClientPage, LivraisonsPage, LivraisonFormPage, LivraisonPage,
  ValidationVentesPage, DROITS_VENTES, DROITS_VALIDATION_VENTES } from '@/pages/commercial/VentesPages';
// Lot 5 : qui voit les documents d'achat.
const DROITS_RECEPTIONS = ['com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.saisir', 'com.retours_fourn.valider',
  'com.bc.preparer', 'com.bc.emettre', 'com.da.voir_tout', 'com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.stock.journal'];
const DROITS_FACTURES = ['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler'];
import VerificationBcPage from '@/pages/VerificationBcPage';
import ComptabiliteLayout, { DROITS_COMPTA } from '@/components/comptabilite/ComptabiliteLayout';
import EcrituresPage from '@/pages/comptabilite/EcrituresPage';
import { BalancePage, GrandLivrePage } from '@/pages/comptabilite/EtatsComptablesPages';
import ParametragePage from '@/pages/comptabilite/ParametragePage';
import EcrituresCaissePage from '@/pages/comptabilite/EcrituresCaissePage';
import { EtatTiersPage, TiersFichePage, TiersListePage } from '@/pages/finance/TiersPages';
import OffreFournisseurPage from '@/pages/OffreFournisseurPage';
import { ConsultationsPage, ConsultationFormPage, ConsultationPage, ComparatifPage } from '@/pages/commercial/ConsultationsPages';
import { FraisListePage, FraisFormPage, FraisPage } from '@/pages/commercial/FraisPages';
import { consommerEntree, moduleActif, routeApresConnexion, systemeInstalle, utiliseAccueil } from '@/lib/modules';

// Toutes les pages listées dans MIGRATION.md sont désormais portées.
export default function App() {
  const { isAuthenticated } = useApp();
  // Lien d'activation d'une démo : page publique, prioritaire sur la session.
  const activation = window.location.pathname.match(/^\/activation\/([A-Za-z0-9_-]+)\/?$/);
  if (activation) return <ActivationPage token={activation[1]} />;
  // Page publique de demande de démonstration (lien à diffuser).
  if (/^\/demande-demo\/?$/.test(window.location.pathname)) return <DemandeDemoPage />;
  // Lien « mot de passe oublié » reçu par e-mail (C9).
  const reinit = window.location.pathname.match(/^\/reinitialisation\/([A-Za-z0-9_-]+)\/?$/);
  if (reinit) return <ReinitialisationPage token={reinit[1]} />;
  // QR code d'un bon de commande : vérification publique, sans session.
  const verif = window.location.pathname.match(/^\/verifier\/([A-Za-z0-9_-]+)\/?$/);
  if (verif) return <VerificationBcPage jeton={verif[1]} />;
  // 063 : lien personnel d'un fournisseur consulté (demande de proforma) : réponse sans compte.
  const offre = window.location.pathname.match(/^\/offre\/([A-Za-z0-9_-]+)\/?$/);
  if (offre) return <OffreFournisseurPage jeton={offre[1]} />;

  return (
    <>
      <PwaBootstrap />
      <OfflineIndicator />
      {isAuthenticated ? <AuthenticatedApp /> : <LoginPage />}
    </>
  );
}

// Garde de route : une URL tapée ou un ancien favori vers un écran non
// autorisé ramène au tableau de bord au lieu d'afficher une erreur 403.
// Tant que la liste des permissions n'est pas chargée, on n'affiche rien.
function Autorise({ code, ok, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  const permis = ok !== undefined ? ok : peut(can, code);
  return permis ? children : <Navigate to="/" replace />;
}

// NJ BUSINESS (048) — garde côté interface du module NJ CAISSE PRO.
// Un utilisateur de client dont la caisse n'est pas activée est ramené à
// l'accueil (le serveur refuse de toute façon : 403 MODULE_INACTIF).
// Système de modules absent côté serveur : aucun effet (comportement d'avant).
function GardeCaisse({ children }) {
  const { user } = useApp();
  if (utiliseAccueil(user) && systemeInstalle(user) && !moduleActif(user, 'caisse')) {
    return <Navigate to="/accueil" replace />;
  }
  return children;
}

// 064 — configuration de l'entreprise : aucun module requis, seulement le droit
// de la consulter (le serveur contrôle de toute façon chaque appel).
function GardeEntreprise({ children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  if (!can('entreprise.view')) return <Navigate to={utiliseAccueil(user) ? '/accueil' : '/'} replace />;
  return children;
}

// NJ COMMERCIAL (050) — même principe que GardeCaisse ; le cabinet passe (le
// serveur répond 403 MODULE_INACTIF si le module n'est pas activé chez le client).
function GardeCommercial({ children }) {
  const { user } = useApp();
  if (utiliseAccueil(user) && systemeInstalle(user) && !moduleActif(user, 'commercial')) {
    return <Navigate to="/accueil" replace />;
  }
  return children;
}

// NJ COMPTABILITÉ (076) : module à part, relié à NJ FINANCE.
function GardeComptabilite({ children }) {
  const { user } = useApp();
  if (utiliseAccueil(user) && systemeInstalle(user) && !moduleActif(user, 'comptabilite')) {
    return <Navigate to="/accueil" replace />;
  }
  return children;
}
function AutoriseCompta({ codes, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  return codes.some((c) => can(c)) ? children : <Navigate to="/comptabilite" replace />;
}
function EntreeComptabilite() {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  if (can('compta.ecritures.voir')) return <Navigate to="/comptabilite/ecritures" replace />;
  if (DROITS_COMPTA.some((c) => can(c))) return <Navigate to="/comptabilite/parametrage" replace />;
  return <div className="cm-page"><div className="cm-note">Aucun droit dans NJ COMPTABILITÉ : demandez l'accès à votre directeur.</div></div>;
}

// Entrée du module (lot 1) : le tableau de bord pour qui le voit, sinon ses
// expressions de besoin, sinon la mise en route du paramétrage.
function EntreeCommercial() {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  if (can('com.tableau_bord.voir')) return <Navigate to="/commercial/tableau-bord" replace />;
  if (can('com.da.creer') || can('com.da.voir_tout')) return <Navigate to="/commercial/demandes" replace />;
  if (can('com.ventes.devis') || can('com.ventes.valider')) return <Navigate to="/commercial/devis" replace />;
  if (can('com.stock.voir')) return <Navigate to="/commercial/stock" replace />;
  if (can('com.ventes.preparer') || can('com.ventes.livrer')) return <Navigate to="/commercial/livraisons" replace />;
  if (can('com.receptions.saisir')) return <Navigate to="/commercial/receptions" replace />;
  if (can('com.factures_fourn.saisir') || can('com.factures_fourn.voir')) return <Navigate to="/commercial/factures-fournisseurs" replace />;
  if (can('com.stock.valider')) return <Navigate to="/commercial/stock/validation" replace />;
  const saisie = [['com.stock.entree', 'entrees'], ['com.stock.sortie', 'sorties'], ['com.stock.transfert', 'transferts'], ['com.stock.inventaire', 'inventaires']].find(([c]) => can(c));
  if (saisie) return <Navigate to={`/commercial/stock/${saisie[1]}`} replace />;
  if (can('com.stock.journal')) return <Navigate to="/commercial/stock/mouvements" replace />;
  if (can('com.stock.valorisation')) return <Navigate to="/commercial/stock/valorisation" replace />;
  if (can('com.ventes.voir') || can('com.ventes.commandes')) return <Navigate to="/commercial/commandes-clients" replace />;
  return <Navigate to="/commercial/configuration/mise-en-route" replace />;
}

// Garde d'un écran du module : une permission parmi plusieurs suffit.
// Anciennes adresses de configuration (/commercial/articles…) → onglet correspondant.
function RedirectionConfig({ onglet }) {
  const { search } = useLocation();
  return <Navigate to={`/commercial/configuration/${onglet}${search}`} replace />;
}

function AutoriseCm({ codes, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  return peutUn(can, codes) ? children : <Navigate to="/commercial" replace />;
}

function AuthenticatedApp() {
  const { user, can, activeTenantId } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Juste après la connexion (une seule fois) : accueil NJ BUSINESS pour toute
  // personne d'un client, même avec un seul module (lot E, décision n° 4).
  useEffect(() => {
    if (!consommerEntree()) return;
    const dest = routeApresConnexion(user);
    if (dest && dest !== location.pathname) navigate(dest, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Module désactivé pendant la session : retour à l'accueil avec un message.
  useEffect(() => {
    // 066 / lot E : module désactivé (MODULE_INACTIF) ou accès retiré à la personne (MODULE_NON_AUTORISE).
    const surModuleInactif = (e) => {
      if (!utiliseAccueil(user)) return;
      const raison = e?.detail?.code === 'MODULE_NON_AUTORISE' ? 'module-non-autorise' : 'module-inactif';
      navigate('/accueil', { replace: true, state: { raison, module: e?.detail?.module || null } });
    };
    window.addEventListener('module-inactif', surModuleInactif);
    return () => window.removeEventListener('module-inactif', surModuleInactif);
  }, [user, navigate]);

  return (
    <Routes>
      {/* Accueil NJ BUSINESS : hors du menu de la caisse, réservé aux utilisateurs d'un client. */}
      <Route path="accueil" element={utiliseAccueil(user) ? <AccueilPage /> : <Navigate to="/" replace />} />
      {/* 064 : configuration centrale de l'entreprise, hors de tout module (socle NJ BUSINESS). */}
      <Route path="entreprise" element={<GardeEntreprise><EntreprisePage /></GardeEntreprise>} />
      <Route path="comptabilite" element={<GardeComptabilite><ComptabiliteLayout /></GardeComptabilite>}>
        <Route index element={<EntreeComptabilite />} />
        <Route path="ecritures"   element={<AutoriseCompta codes={['compta.ecritures.voir']}><EcrituresPage /></AutoriseCompta>} />
        <Route path="caisse"      element={<AutoriseCompta codes={['compta.ecritures.voir']}><EcrituresCaissePage /></AutoriseCompta>} />
        <Route path="grand-livre" element={<AutoriseCompta codes={['compta.ecritures.voir']}><GrandLivrePage /></AutoriseCompta>} />
        <Route path="balance"     element={<AutoriseCompta codes={['compta.ecritures.voir']}><BalancePage /></AutoriseCompta>} />
        <Route path="parametrage" element={<AutoriseCompta codes={DROITS_COMPTA}><ParametragePage /></AutoriseCompta>} />
        <Route path="*" element={<Navigate to="/comptabilite" replace />} />
      </Route>
      <Route path="commercial" element={<GardeCommercial><CommercialLayout /></GardeCommercial>}>
        <Route index element={<EntreeCommercial />} />
        {/* Configuration : une page à onglets ; les anciennes adresses y mènent. */}
        <Route path="configuration"         element={<ConfigurationPage />} />
        <Route path="configuration/:onglet" element={<ConfigurationPage />} />
        {['mise-en-route', 'societe', 'agences', 'magasins', 'utilisateurs', 'familles', 'unites', 'articles', 'taxes', 'fournisseurs', 'clients'].map((o) => (
          <Route key={o} path={o} element={<RedirectionConfig onglet={o} />} />
        ))}
        <Route path="demandes"              element={<AutoriseCm codes={DROITS_DEMANDES}><DemandesPage key="d" /></AutoriseCm>} />
        <Route path="demandes/nouvelle"     element={<AutoriseCm codes={['com.da.creer']}><DemandeFormPage key="n" /></AutoriseCm>} />
        <Route path="demandes/:id"          element={<AutoriseCm codes={DROITS_DEMANDES}><DemandePage /></AutoriseCm>} />
        <Route path="demandes/:id/modifier" element={<AutoriseCm codes={['com.da.creer']}><DemandeFormPage key="m" /></AutoriseCm>} />
        <Route path="autorisations"         element={<AutoriseCm codes={DROITS_AUTORISATIONS}><DemandesPage key="a" autorisations /></AutoriseCm>} />
        <Route path="bons"                  element={<AutoriseCm codes={DROITS_BONS}><BonsPage /></AutoriseCm>} />
        <Route path="bons/nouveau"          element={<AutoriseCm codes={['com.bc.preparer']}><BonFormPage key="n" /></AutoriseCm>} />
        <Route path="bons/:id"              element={<AutoriseCm codes={DROITS_BONS}><BonPage /></AutoriseCm>} />
        <Route path="bons/:id/modifier"     element={<AutoriseCm codes={['com.bc.preparer']}><BonFormPage key="m" /></AutoriseCm>} />
        <Route path="tableau-bord"          element={<AutoriseCm codes={['com.tableau_bord.voir']}><TableauBordPage /></AutoriseCm>} />
        <Route path="documents"             element={<AutoriseCm codes={DROITS_BONS}><DocumentsPage /></AutoriseCm>} />
        <Route path="historique"            element={<AutoriseCm codes={DROITS_HISTORIQUE}><HistoriquePage /></AutoriseCm>} />
        <Route path="stock"                 element={<AutoriseCm codes={['com.stock.voir']}><StockEtatPage /></AutoriseCm>} />
        <Route path="stock/nouveau"         element={<AutoriseCm codes={DROITS_SAISIE}><StockDocFormPage key="n" /></AutoriseCm>} />
        <Route path="stock/validation"      element={<AutoriseCm codes={['com.stock.valider']}><StockDocsPage key="v" validation /></AutoriseCm>} />
        <Route path="stock/mouvements"      element={<AutoriseCm codes={['com.stock.journal']}><StockMouvementsPage /></AutoriseCm>} />
        <Route path="stock/valorisation"    element={<AutoriseCm codes={['com.stock.valorisation']}><StockValorisationPage /></AutoriseCm>} />
        <Route path="stock/documents/:id"   element={<AutoriseCm codes={DROITS_STOCK}><StockDocPage /></AutoriseCm>} />
        <Route path="stock/documents/:id/modifier" element={<AutoriseCm codes={DROITS_SAISIE}><StockDocFormPage key="m" /></AutoriseCm>} />
        <Route path="stock/:route"          element={<AutoriseCm codes={DROITS_STOCK}><StockDocsPage key="l" /></AutoriseCm>} />
        <Route path="receptions"                   element={<AutoriseCm codes={DROITS_RECEPTIONS}><ReceptionsPage /></AutoriseCm>} />
        <Route path="receptions/nouvelle"          element={<AutoriseCm codes={['com.receptions.saisir']}><ReceptionFormPage key="n" /></AutoriseCm>} />
        <Route path="receptions/:id"               element={<AutoriseCm codes={DROITS_RECEPTIONS}><ReceptionPage /></AutoriseCm>} />
        <Route path="receptions/:id/modifier"      element={<AutoriseCm codes={['com.receptions.saisir']}><ReceptionFormPage key="m" /></AutoriseCm>} />
        <Route path="retours-fournisseurs"         element={<AutoriseCm codes={DROITS_RECEPTIONS}><RetoursFournPage /></AutoriseCm>} />
        <Route path="retours-fournisseurs/nouveau" element={<AutoriseCm codes={['com.retours_fourn.saisir']}><RetourFournFormPage key="n" /></AutoriseCm>} />
        <Route path="retours-fournisseurs/:id"     element={<AutoriseCm codes={DROITS_RECEPTIONS}><RetourFournPage /></AutoriseCm>} />
        <Route path="retours-fournisseurs/:id/modifier" element={<AutoriseCm codes={['com.retours_fourn.saisir']}><RetourFournFormPage key="m" /></AutoriseCm>} />
        <Route path="factures-fournisseurs"        element={<AutoriseCm codes={DROITS_FACTURES}><FacturesFournPage /></AutoriseCm>} />
        <Route path="factures-fournisseurs/nouvelle" element={<AutoriseCm codes={['com.factures_fourn.saisir']}><FactureFournFormPage key="n" /></AutoriseCm>} />
        <Route path="factures-fournisseurs/:id"    element={<AutoriseCm codes={DROITS_FACTURES}><FactureFournPage /></AutoriseCm>} />
        <Route path="factures-fournisseurs/:id/modifier" element={<AutoriseCm codes={['com.factures_fourn.saisir']}><FactureFournFormPage key="m" /></AutoriseCm>} />
        <Route path="consultations"                element={<AutoriseCm codes={DROITS_CONSULTATIONS}><ConsultationsPage /></AutoriseCm>} />
        <Route path="consultations/nouvelle"       element={<AutoriseCm codes={['com.consultations.gerer']}><ConsultationFormPage key="n" /></AutoriseCm>} />
        <Route path="consultations/:id"            element={<AutoriseCm codes={DROITS_CONSULTATIONS}><ConsultationPage /></AutoriseCm>} />
        <Route path="consultations/:id/modifier"   element={<AutoriseCm codes={['com.consultations.gerer']}><ConsultationFormPage key="m" /></AutoriseCm>} />
        <Route path="consultations/:id/comparatif" element={<AutoriseCm codes={DROITS_CONSULTATIONS}><ComparatifPage /></AutoriseCm>} />
        <Route path="frais"                        element={<AutoriseCm codes={DROITS_FRAIS}><FraisListePage /></AutoriseCm>} />
        <Route path="frais/nouveau"                element={<AutoriseCm codes={['com.frais.saisir']}><FraisFormPage key="n" /></AutoriseCm>} />
        <Route path="frais/:id"                    element={<AutoriseCm codes={DROITS_FRAIS}><FraisPage /></AutoriseCm>} />
        <Route path="frais/:id/modifier"           element={<AutoriseCm codes={['com.frais.saisir']}><FraisFormPage key="m" /></AutoriseCm>} />
        <Route path="validation-achats"            element={<AutoriseCm codes={['com.receptions.valider', 'com.retours_fourn.valider', 'com.factures_fourn.valider']}><ValidationAchatsPage /></AutoriseCm>} />
        <Route path="devis"                        element={<AutoriseCm codes={DROITS_VENTES}><DevisListePage /></AutoriseCm>} />
        <Route path="devis/nouveau"                element={<AutoriseCm codes={['com.ventes.devis']}><DevisFormPage key="n" /></AutoriseCm>} />
        <Route path="devis/:id"                    element={<AutoriseCm codes={DROITS_VENTES}><DevisPage /></AutoriseCm>} />
        <Route path="devis/:id/modifier"           element={<AutoriseCm codes={['com.ventes.devis']}><DevisFormPage key="m" /></AutoriseCm>} />
        <Route path="commandes-clients"            element={<AutoriseCm codes={DROITS_VENTES}><CommandesClientsPage /></AutoriseCm>} />
        <Route path="commandes-clients/:id"        element={<AutoriseCm codes={DROITS_VENTES}><CommandeClientPage /></AutoriseCm>} />
        <Route path="livraisons"                   element={<AutoriseCm codes={DROITS_VENTES}><LivraisonsPage /></AutoriseCm>} />
        <Route path="livraisons/nouvelle"          element={<AutoriseCm codes={['com.ventes.preparer']}><LivraisonFormPage key="n" /></AutoriseCm>} />
        <Route path="livraisons/:id"               element={<AutoriseCm codes={DROITS_VENTES}><LivraisonPage /></AutoriseCm>} />
        <Route path="livraisons/:id/modifier"      element={<AutoriseCm codes={['com.ventes.preparer']}><LivraisonFormPage key="m" /></AutoriseCm>} />
        <Route path="validation-ventes"            element={<AutoriseCm codes={DROITS_VALIDATION_VENTES}><ValidationVentesPage /></AutoriseCm>} />
        <Route path="*"            element={<Navigate to="/commercial" replace />} />
      </Route>
      <Route element={<GardeCaisse><Layout /></GardeCaisse>}>
        {/* Accueil du super_admin : l'administration (plateforme, ou configuration
            du client choisi) — jamais directement les données de caisse, qui
            demandent un accès support (voir middleware/tenant.js). */}
        <Route index element={user?.role === 'super_admin'
          ? <Navigate to={activeTenantId ? '/config' : '/plateforme'} replace />
          : user?.role === 'commercial' ? <Navigate to="/mynjbusiness" replace />
          : <DashboardPage />} />
        <Route path="journal/:id"    element={<Autorise code="journal.view"><JournalPage /></Autorise>} />
        <Route path="journaux-recap" element={<Autorise code={PAGE_PERMS['/journaux-recap']}><JournauxRecapPage /></Autorise>} />
        <Route path="budget"         element={<Autorise code={PAGE_PERMS['/budget']}><BudgetPage /></Autorise>} />
        <Route path="previsions"     element={<Autorise code={PAGE_PERMS['/previsions']}><PrevisionsPage /></Autorise>} />
        <Route path="appel-fonds"    element={<Autorise code={PAGE_PERMS['/appel-fonds']}><AppelFondsPage /></Autorise>} />
        <Route path="compte-emploi"  element={<Autorise code={PAGE_PERMS['/compte-emploi']}><CompteEmploiPage /></Autorise>} />
        <Route path="activites"      element={<Autorise code={PAGE_PERMS['/activites']}><SuiviActivitesPage /></Autorise>} />
        {/* Projets des ONG / associations (069) : le serveur décide du périmètre. */}
        <Route path="projets"        element={<ProjetsPage />} />
        <Route path="projets/a-controler" element={<ProjetsAControlerPage />} />
        <Route path="projets/bilan"  element={<ProjetsBilanPage />} />
        <Route path="projets/:id"    element={<ProjetPage />} />
        <Route path="controle/pieces"     element={<Autorise code={PAGE_PERMS['/controle/pieces']}><ControlePage /></Autorise>} />
        <Route path="controle/regularite" element={<Autorise code={PAGE_PERMS['/controle/regularite']}><ControlePage /></Autorise>} />
        <Route path="controle/arretes"    element={<Autorise code={PAGE_PERMS['/controle/arretes']}><ArretsInventairesPage /></Autorise>} />
        <Route path="controle/ecarts"     element={<Autorise code={PAGE_PERMS['/controle/ecarts']}><EcartsCaissePage /></Autorise>} />
        <Route path="controle/registre"   element={<Autorise code={PAGE_PERMS['/controle/registre']}><RegistreTiersPage /></Autorise>} />
        <Route path="controle/passerelle" element={<Autorise code={PAGE_PERMS['/controle/passerelle']}><PasserelleTab /></Autorise>} />
        <Route path="finance/tiers"     element={<Autorise code={PAGE_PERMS['/finance/tiers']}><TiersListePage /></Autorise>} />
        <Route path="finance/tiers/:id" element={<Autorise code={PAGE_PERMS['/finance/tiers']}><TiersFichePage /></Autorise>} />
        <Route path="finance/creances"  element={<Autorise code={PAGE_PERMS['/finance/creances']}><EtatTiersPage key="c" sens="client" /></Autorise>} />
        <Route path="finance/dettes"    element={<Autorise code={PAGE_PERMS['/finance/dettes']}><EtatTiersPage key="f" sens="fournisseur" /></Autorise>} />
        <Route path="config"         element={<Autorise ok={voitConfiguration(user, can)}><ConfigPage /></Autorise>} />
        <Route path="attente"        element={<Autorise code={PAGE_PERMS['/attente']}><AttentePage /></Autorise>} />
        <Route path="tenants"        element={<TenantsPage />} />
        <Route path="permissions"    element={<PermissionsPage />} />
        <Route path="plan-modele"    element={<Autorise ok={user?.role === 'super_admin'}><PlanModelePage /></Autorise>} />
        <Route path="plateforme"     element={<Autorise ok={user?.role === 'super_admin'}><PlateformePage /></Autorise>} />
        <Route path="validation-directe" element={<Autorise ok={user?.role === 'super_admin'}><ValidationDirectePage /></Autorise>} />
        <Route path="mynjbusiness"   element={<Autorise ok={peutGererProspects(user, can)}><MyNjBusinessPage /></Autorise>} />
        <Route path="prospects"      element={<Autorise ok={peutGererProspects(user, can)}><ProspectsPage /></Autorise>} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
