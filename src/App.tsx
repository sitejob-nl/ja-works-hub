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
import ShellPage from "@/components/ShellPage";
import SettingsPage from "@/pages/Settings";
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
import {
  Calendar, MessageSquare, BookOpen,
} from "lucide-react";

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
            <Route element={
              <AuthProvider>
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              </AuthProvider>
            }>
              <Route path="/" element={<Dashboard />} />
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
              <Route path="/planning" element={<ShellPage title="Planning" subtitle="Plan en beheer de inzet van medewerkers" icon={Calendar} />} />
              <Route path="/uren" element={<Timesheets />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/transport/:id" element={<VehicleDetail />} />
              <Route path="/vacaturebank" element={<Vacaturebank />} />
              <Route path="/communicatie" element={<ShellPage title="Communicatie" subtitle="Berichten en communicatiehistorie" icon={MessageSquare} />} />
              <Route path="/kennisbank" element={<ShellPage title="Kennisbank" subtitle="Interne kennisbank en documentatie" icon={BookOpen} />} />
              <Route path="/instellingen" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
