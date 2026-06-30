import { Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";

// Context providers, layouts and route guards stay eager: they form the shell that
// renders on (nearly) every navigation, so the Suspense fallback below only covers
// the lazily-loaded page content — never the chrome (sidebar, providers).
import { AuthProvider } from "@/contexts/AuthContext";
import { RecentItemsProvider } from "@/contexts/RecentItemsContext";
import { SuperAdminProvider } from "@/contexts/SuperAdminContext";
import { PortalProvider } from "@/contexts/PortalContext";
import { ClientPortalProvider } from "@/contexts/ClientPortalContext";
import { TranslationProvider } from "@/contexts/TranslationContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import TenantHostGuard from "@/components/TenantHostGuard";
import AppLayout from "@/components/layout/AppLayout";
import SuperAdminLayout from "@/components/layout/SuperAdminLayout";
import PortalLayout from "@/components/layout/PortalLayout";
import ClientPortalLayout from "@/components/layout/ClientPortalLayout";
import { lazyRoute } from "@/lib/lazy-route";

// Route pages are lazy-loaded so each page (and its heavy deps: pdfjs, tesseract,
// spreadsheet parsers, recharts, tiptap) splits into its own chunk and is only
// fetched when its route is first visited — keeping it off the initial bundle.
const Login = lazyRoute(() => import("@/pages/Login"));
const SuperAdminLogin = lazyRoute(() => import("@/pages/SuperAdminLogin"));
const SuperAdminDashboard = lazyRoute(() => import("@/pages/superadmin/SuperAdminDashboard"));
const SuperAdminOrganizations = lazyRoute(() => import("@/pages/superadmin/SuperAdminOrganizations"));
const SuperAdminUsers = lazyRoute(() => import("@/pages/superadmin/SuperAdminUsers"));
const SuperAdminPlans = lazyRoute(() => import("@/pages/superadmin/SuperAdminPlans"));
const SuperAdminErrors = lazyRoute(() => import("@/pages/superadmin/SuperAdminErrors"));
const SuperAdminCvBackfill = lazyRoute(() => import("@/pages/superadmin/SuperAdminCvBackfill"));
const Dashboard = lazyRoute(() => import("@/pages/Dashboard"));
const NotFound = lazyRoute(() => import("./pages/NotFound"));
const SettingsPage = lazyRoute(() => import("@/pages/Settings"));
const Planning = lazyRoute(() => import("@/pages/Planning"));
const Companies = lazyRoute(() => import("@/pages/Companies"));
const CompanyNew = lazyRoute(() => import("@/pages/CompanyNew"));
const CompanyDetail = lazyRoute(() => import("@/pages/CompanyDetail"));
const CompanyEdit = lazyRoute(() => import("@/pages/CompanyEdit"));
const Candidates = lazyRoute(() => import("@/pages/Candidates"));
const DuplicateCandidates = lazyRoute(() => import("@/pages/DuplicateCandidates"));
const CandidateNew = lazyRoute(() => import("@/pages/CandidateNew"));
const CandidateDetail = lazyRoute(() => import("@/pages/CandidateDetail"));
const Employees = lazyRoute(() => import("@/pages/Employees"));
const EmployeeNew = lazyRoute(() => import("@/pages/EmployeeNew"));
const EmployeeDetail = lazyRoute(() => import("@/pages/EmployeeDetail"));
const Housing = lazyRoute(() => import("@/pages/Housing"));
const PropertyDetail = lazyRoute(() => import("@/pages/PropertyDetail"));
const Vacancies = lazyRoute(() => import("@/pages/Vacancies"));
const VacancyNew = lazyRoute(() => import("@/pages/VacancyNew"));
const VacancyDetail = lazyRoute(() => import("@/pages/VacancyDetail"));
const VacancyEdit = lazyRoute(() => import("@/pages/VacancyEdit"));
const Timesheets = lazyRoute(() => import("@/pages/Timesheets"));
const Transport = lazyRoute(() => import("@/pages/Transport"));
const VehicleNew = lazyRoute(() => import("@/pages/VehicleNew"));
const VehicleDetail = lazyRoute(() => import("@/pages/VehicleDetail"));
const VehicleEdit = lazyRoute(() => import("@/pages/VehicleEdit"));
const Vacaturebank = lazyRoute(() => import("@/pages/Vacaturebank"));
const KandidatenZoeken = lazyRoute(() => import("@/pages/KandidatenZoeken"));
const Communications = lazyRoute(() => import("@/pages/Communications"));
const KnowledgeBasePage = lazyRoute(() => import("@/pages/KnowledgeBase"));
const WhatsAppPage = lazyRoute(() => import("@/pages/WhatsApp"));
const ExactOnlinePage = lazyRoute(() => import("@/pages/ExactOnline"));
const OmzetPage = lazyRoute(() => import("@/pages/Omzet"));
const Onboarding = lazyRoute(() => import("@/pages/Onboarding"));
const CvTool = lazyRoute(() => import("@/pages/CvTool"));
const RecruiterWorkbench = lazyRoute(() => import("@/pages/RecruiterWorkbench"));
const Tasks = lazyRoute(() => import("@/pages/Tasks"));
const BulkCampaigns = lazyRoute(() => import("@/pages/BulkCampaigns"));
const BulkCampaignDetail = lazyRoute(() => import("@/pages/BulkCampaignDetail"));
const ImportData = lazyRoute(() => import("@/pages/ImportData"));
const CarerixImport = lazyRoute(() => import("@/pages/CarerixImport"));
const Installeren = lazyRoute(() => import("@/pages/Installeren"));
const ContractSign = lazyRoute(() => import("@/pages/ContractSign"));
const CandidateProfile = lazyRoute(() => import("@/pages/CandidateProfile"));
const PublicCandidateSignup = lazyRoute(() => import("@/pages/PublicCandidateSignup"));
const Register = lazyRoute(() => import("@/pages/Register"));
const PortalActivate = lazyRoute(() => import("@/pages/PortalActivate"));
const FuelCardAnalysis = lazyRoute(() => import("@/pages/FuelCardAnalysis"));
const FiscalMileageAnalysis = lazyRoute(() => import("@/pages/FiscalMileageAnalysis"));
const InvoicesPage = lazyRoute(() => import("@/pages/Invoices"));
const PlacementsPage = lazyRoute(() => import("@/pages/Placements"));
const PlacementDetail = lazyRoute(() => import("@/pages/PlacementDetail"));
const MatchPipeline = lazyRoute(() => import("@/pages/MatchPipeline"));
const MatchResponse = lazyRoute(() => import("@/pages/MatchResponse"));
const UitstroomAnalyse = lazyRoute(() => import("@/pages/UitstroomAnalyse"));
const Contacts = lazyRoute(() => import("@/pages/Contacts"));
const ContactDetail = lazyRoute(() => import("@/pages/ContactDetail"));
const Dashboards = lazyRoute(() => import("@/pages/Dashboards"));
const Email = lazyRoute(() => import("@/pages/Email"));
const Agenda = lazyRoute(() => import("@/pages/Agenda"));
const EmailTemplates = lazyRoute(() => import("@/pages/EmailTemplates"));
const Talentpools = lazyRoute(() => import("@/pages/Talentpools"));
const TalentpoolDetail = lazyRoute(() => import("@/pages/TalentpoolDetail"));
const PortalLogin = lazyRoute(() => import("@/pages/portal/PortalLogin"));
const PortalDashboard = lazyRoute(() => import("@/pages/portal/PortalDashboard"));
const PortalTimesheets = lazyRoute(() => import("@/pages/portal/PortalTimesheets"));
const PortalDocuments = lazyRoute(() => import("@/pages/portal/PortalDocuments"));
const PortalJobMarket = lazyRoute(() => import("@/pages/portal/PortalJobMarket"));
const PortalProfile = lazyRoute(() => import("@/pages/portal/PortalProfile"));
const PortalSickReport = lazyRoute(() => import("@/pages/portal/PortalSickReport"));
const PortalHousing = lazyRoute(() => import("@/pages/portal/PortalHousing"));
const PortalVehicle = lazyRoute(() => import("@/pages/portal/PortalVehicle"));
const PortalLoyalty = lazyRoute(() => import("@/pages/portal/PortalLoyalty"));
const PortalPayslips = lazyRoute(() => import("@/pages/portal/PortalPayslips"));
const PortalAnnualStatements = lazyRoute(() => import("@/pages/portal/PortalAnnualStatements"));
const PortalHourLetters = lazyRoute(() => import("@/pages/portal/PortalHourLetters"));
const PortalPlacements = lazyRoute(() => import("@/pages/portal/PortalPlacements"));
const ClientPortalActivate = lazyRoute(() => import("@/pages/ClientPortalActivate"));
const ClientPortalLogin = lazyRoute(() => import("@/pages/clientportal/ClientPortalLogin"));
const ClientPortalDashboard = lazyRoute(() => import("@/pages/clientportal/ClientPortalDashboard"));
const ClientPortalTimesheets = lazyRoute(() => import("@/pages/clientportal/ClientPortalTimesheets"));
const ClientPortalPlacements = lazyRoute(() => import("@/pages/clientportal/ClientPortalPlacements"));

const queryClient = new QueryClient();

const CandidateEditRedirect = () => {
  const { id } = useParams();
  return <Navigate to={id ? `/kandidaten/${id}?tab=profiel` : "/kandidaten"} replace />;
};

// Shown while a route's chunk is being fetched. Centered so it reads as a page
// loading state rather than a layout shift.
const PageFallback = () => (
  <div className="flex h-screen w-full items-center justify-center text-sm text-muted-foreground">
    Laden…
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* Superadmin routes */}
              <Route path="/superadmin/login" element={
                <SuperAdminProvider><SuperAdminLogin /></SuperAdminProvider>
              } />
              <Route path="/superadmin" element={
                <SuperAdminProvider><SuperAdminLayout /></SuperAdminProvider>
              }>
                <Route index element={<SuperAdminDashboard />} />
                <Route path="organisaties" element={<SuperAdminOrganizations />} />
                <Route path="gebruikers" element={<SuperAdminUsers />} />
                <Route path="abonnementen" element={<SuperAdminPlans />} />
                <Route path="cv-backfill" element={<SuperAdminCvBackfill />} />
                <Route path="errors" element={<SuperAdminErrors />} />
              </Route>

              {/* Normal app routes */}
              <Route path="/login" element={
                <AuthProvider><Login /></AuthProvider>
              } />
              <Route path="/registreren" element={<Register />} />
              <Route element={
                <AuthProvider>
                  <ProtectedRoute>
                    <RecentItemsProvider>
                      <TenantHostGuard>
                        <AppLayout />
                      </TenantHostGuard>
                    </RecentItemsProvider>
                  </ProtectedRoute>
                </AuthProvider>
              }>
                <Route path="/" element={<Dashboard />} />
                <Route path="/workbench" element={<RecruiterWorkbench />} />
                <Route path="/taken" element={<Tasks />} />
                <Route path="/opdrachtgevers" element={<Companies />} />
                <Route path="/opdrachtgevers/new" element={<CompanyNew />} />
                <Route path="/opdrachtgevers/:id" element={<CompanyDetail />} />
                <Route path="/opdrachtgevers/:id/bewerken" element={<CompanyEdit />} />
                <Route path="/kandidaten" element={<Candidates />} />
                <Route path="/kandidaten/new" element={<CandidateNew />} />
                <Route path="/kandidaten/duplicaten" element={<DuplicateCandidates />} />
                <Route path="/kandidaten/:id" element={<CandidateDetail />} />
                <Route path="/kandidaten/:id/bewerken" element={<CandidateEditRedirect />} />
                <Route path="/medewerkers" element={<Navigate to="/kandidaten?tab=in-dienst" replace />} />
                <Route path="/medewerkers/new" element={<EmployeeNew />} />
                <Route path="/medewerkers/:id" element={<EmployeeDetail />} />
                <Route path="/contacten" element={<Contacts />} />
                <Route path="/contacten/:id" element={<ContactDetail />} />
                <Route path="/talentpools" element={<Talentpools />} />
                <Route path="/talentpools/:id" element={<TalentpoolDetail />} />
                <Route path="/huisvesting" element={<Housing />} />
                <Route path="/huisvesting/:id" element={<PropertyDetail />} />
                <Route path="/vacatures" element={<Vacancies />} />
                <Route path="/vacatures/new" element={<VacancyNew />} />
                <Route path="/vacatures/:id" element={<VacancyDetail />} />
                <Route path="/vacatures/:id/bewerken" element={<VacancyEdit />} />
                <Route path="/match-pipeline" element={<MatchPipeline />} />
                <Route path="/planning" element={<Planning />} />
                <Route path="/plaatsingen" element={<PlacementsPage />} />
                <Route path="/plaatsingen/:id" element={<PlacementDetail />} />
                <Route path="/uren" element={<Timesheets />} />
                <Route path="/facturatie" element={<InvoicesPage />} />
                <Route path="/uitstroom-analyse" element={<UitstroomAnalyse />} />
                <Route path="/transport" element={<Transport />} />
                <Route path="/transport/new" element={<VehicleNew />} />
                <Route path="/transport/:id" element={<VehicleDetail />} />
                <Route path="/transport/:id/bewerken" element={<VehicleEdit />} />
                <Route path="/tankpas-analyse" element={<FuelCardAnalysis />} />
                <Route path="/kilometeranalyse" element={<FiscalMileageAnalysis />} />
                <Route path="/vacaturebank" element={<Vacaturebank />} />
                <Route path="/kandidaten-zoeken" element={<KandidatenZoeken />} />
                <Route path="/communicatie" element={<Communications />} />
                <Route path="/email" element={<Email />} />
                <Route path="/email/templates" element={<EmailTemplates />} />
                <Route path="/agenda" element={<Agenda />} />
                <Route path="/whatsapp" element={<WhatsAppPage />} />
                <Route path="/bulk-campaigns" element={<BulkCampaigns />} />
                <Route path="/bulk-campaigns/:id" element={<BulkCampaignDetail />} />
                <Route path="/kennisbank" element={<KnowledgeBasePage />} />
                <Route path="/exact-online" element={<ExactOnlinePage />} />
                <Route path="/omzet" element={<OmzetPage />} />
                <Route path="/cv-tool/:candidateId" element={<CvTool />} />
                <Route path="/importeren" element={<ImportData />} />
                <Route path="/carerix-import" element={<CarerixImport />} />
                <Route path="/dashboards" element={<Dashboards />} />
                <Route path="/instellingen" element={<SettingsPage />} />
              </Route>
              {/* Public routes */}
              <Route path="/onboarding/:token" element={<Onboarding />} />
              <Route path="/contract/sign/:token" element={<ContractSign />} />
              <Route path="/match-response/:token" element={<MatchResponse />} />
              <Route path="/match/reageer/:token" element={<MatchResponse />} />
              <Route path="/profiel/:token" element={<CandidateProfile />} />
              <Route path="/solliciteren/:slug" element={<PublicCandidateSignup />} />
              <Route path="/portaal/activeren/:token" element={<TranslationProvider enableRuntimeTranslation={false}><PortalActivate /></TranslationProvider>} />
              <Route path="/portaal/login" element={<TranslationProvider enableRuntimeTranslation={false}><PortalLogin /></TranslationProvider>} />
              {/* Client portal (opdrachtgever) public routes */}
              <Route path="/klantportaal/activeren/:token" element={<TranslationProvider enableRuntimeTranslation={false}><ClientPortalActivate /></TranslationProvider>} />
              <Route path="/klantportaal/login" element={<TranslationProvider enableRuntimeTranslation={false}><ClientPortalLogin /></TranslationProvider>} />
              {/* Portal (medewerker) routes */}
              <Route path="/portaal" element={
                <PortalProvider><PortalLayout /></PortalProvider>
              }>
                <Route index element={<PortalDashboard />} />
                <Route path="uren" element={<PortalTimesheets />} />
                <Route path="plaatsingen" element={<PortalPlacements />} />
                <Route path="documenten" element={<PortalDocuments />} />
                <Route path="vacatures" element={<PortalJobMarket />} />
                <Route path="profiel" element={<PortalProfile />} />
                <Route path="ziekmelding" element={<PortalSickReport />} />
                <Route path="huisvesting" element={<PortalHousing />} />
                <Route path="voertuig" element={<PortalVehicle />} />
                <Route path="punten" element={<PortalLoyalty />} />
                <Route path="loonstroken" element={<PortalPayslips />} />
                <Route path="jaaropgaven" element={<PortalAnnualStatements />} />
                <Route path="urenbrieven" element={<PortalHourLetters />} />
              </Route>
              {/* Client portal (opdrachtgever) protected routes */}
              <Route path="/klantportaal" element={
                <ClientPortalProvider><ClientPortalLayout /></ClientPortalProvider>
              }>
                <Route index element={<ClientPortalDashboard />} />
                <Route path="uren" element={<ClientPortalTimesheets />} />
                <Route path="plaatsingen" element={<ClientPortalPlacements />} />
              </Route>
              <Route path="/installeren" element={<Installeren />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
