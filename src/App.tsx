import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { SuperAdminProvider } from "@/contexts/SuperAdminContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import AppLayout from "@/components/layout/AppLayout";
import SuperAdminLayout from "@/components/layout/SuperAdminLayout";
import Login from "@/pages/Login";
import SuperAdminLogin from "@/pages/SuperAdminLogin";
import SuperAdminDashboard from "@/pages/superadmin/SuperAdminDashboard";
import SuperAdminOrganizations from "@/pages/superadmin/SuperAdminOrganizations";
import SuperAdminUsers from "@/pages/superadmin/SuperAdminUsers";
import SuperAdminPlans from "@/pages/superadmin/SuperAdminPlans";
import SuperAdminErrors from "@/pages/superadmin/SuperAdminErrors";
import Dashboard from "@/pages/Dashboard";
import NotFound from "./pages/NotFound";
import SettingsPage from "@/pages/Settings";
import Planning from "@/pages/Planning";
import Companies from "@/pages/Companies";
import CompanyDetail from "@/pages/CompanyDetail";
import Candidates from "@/pages/Candidates";
import CandidateDetail from "@/pages/CandidateDetail";
import Employees from "@/pages/Employees";
import EmployeeDetail from "@/pages/EmployeeDetail";
import Housing from "@/pages/Housing";
import PropertyDetail from "@/pages/PropertyDetail";
import Vacancies from "@/pages/Vacancies";
import VacancyDetail from "@/pages/VacancyDetail";
import Timesheets from "@/pages/Timesheets";
import Transport from "@/pages/Transport";
import VehicleDetail from "@/pages/VehicleDetail";
import Vacaturebank from "@/pages/Vacaturebank";
import KandidatenZoeken from "@/pages/KandidatenZoeken";
import Communications from "@/pages/Communications";
import KnowledgeBasePage from "@/pages/KnowledgeBase";
import WhatsAppPage from "@/pages/WhatsApp";
import ExactOnlinePage from "@/pages/ExactOnline";
import Onboarding from "@/pages/Onboarding";
import CvTool from "@/pages/CvTool";
import RecruiterWorkbench from "@/pages/RecruiterWorkbench";
import BulkCampaigns from "@/pages/BulkCampaigns";
import BulkCampaignDetail from "@/pages/BulkCampaignDetail";
import ImportData from "@/pages/ImportData";
import Installeren from "@/pages/Installeren";
import ContractSign from "@/pages/ContractSign";
import Register from "@/pages/Register";
import PortalActivate from "@/pages/PortalActivate";
import FuelCardAnalysis from "@/pages/FuelCardAnalysis";
import PortalLogin from "@/pages/portal/PortalLogin";
import PortalDashboard from "@/pages/portal/PortalDashboard";
import PortalLayout from "@/components/layout/PortalLayout";
import { PortalProvider } from "@/contexts/PortalContext";
import PortalTimesheets from "@/pages/portal/PortalTimesheets";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <BrowserRouter>
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
                  <AppLayout />
                </ProtectedRoute>
              </AuthProvider>
            }>
              <Route path="/" element={<Dashboard />} />
              <Route path="/workbench" element={<RecruiterWorkbench />} />
              <Route path="/opdrachtgevers" element={<Companies />} />
              <Route path="/opdrachtgevers/:id" element={<CompanyDetail />} />
              <Route path="/kandidaten" element={<Candidates />} />
              <Route path="/kandidaten/:id" element={<CandidateDetail />} />
              <Route path="/medewerkers" element={<Employees />} />
              <Route path="/medewerkers/:id" element={<EmployeeDetail />} />
              <Route path="/huisvesting" element={<Housing />} />
              <Route path="/huisvesting/:id" element={<PropertyDetail />} />
              <Route path="/vacatures" element={<Vacancies />} />
              <Route path="/vacatures/:id" element={<VacancyDetail />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/uren" element={<Timesheets />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/transport/:id" element={<VehicleDetail />} />
              <Route path="/tankpas-analyse" element={<FuelCardAnalysis />} />
              <Route path="/vacaturebank" element={<Vacaturebank />} />
              <Route path="/kandidaten-zoeken" element={<KandidatenZoeken />} />
              <Route path="/communicatie" element={<Communications />} />
              <Route path="/whatsapp" element={<WhatsAppPage />} />
              <Route path="/bulk-campaigns" element={<BulkCampaigns />} />
              <Route path="/bulk-campaigns/:id" element={<BulkCampaignDetail />} />
              <Route path="/kennisbank" element={<KnowledgeBasePage />} />
              <Route path="/exact-online" element={<ExactOnlinePage />} />
              <Route path="/cv-tool/:candidateId" element={<CvTool />} />
              <Route path="/importeren" element={<ImportData />} />
              <Route path="/instellingen" element={<SettingsPage />} />
            </Route>
            {/* Public routes */}
            <Route path="/onboarding/:token" element={<Onboarding />} />
            <Route path="/contract/sign/:token" element={<ContractSign />} />
            <Route path="/portaal/activeren/:token" element={<PortalActivate />} />
            <Route path="/portaal/login" element={<PortalLogin />} />
            {/* Portal (medewerker) routes */}
            <Route path="/portaal" element={
              <PortalProvider><PortalLayout /></PortalProvider>
            }>
              <Route index element={<PortalDashboard />} />
              <Route path="uren" element={<PortalTimesheets />} />
            </Route>
            <Route path="/installeren" element={<Installeren />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
