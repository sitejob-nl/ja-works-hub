import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { setObservabilityUser } from '@/lib/observability';
import AppSidebar from './AppSidebar';
import TopBar from './TopBar';
import RecentItemsBar from './RecentItemsBar';

const AppLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile } = useAuth();

  // Eén mountpunt voor de Sentry user-context (AppLayout rendert eenmaal voor de
  // ingelogde shell; AuthProvider zit meerdere keren in de routeboom). Alleen id +
  // organization_id, nooit PII. Bij user→null (uitloggen) wist dit de context.
  useEffect(() => {
    setObservabilityUser(user?.id, profile?.organization_id);
  }, [user?.id, profile?.organization_id]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar: hidden on mobile, shown via overlay when open */}
      <div className={`
        fixed inset-y-0 left-0 z-50 md:static md:z-auto
        transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <AppSidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <TopBar onMenuClick={() => setSidebarOpen(v => !v)} />
        <RecentItemsBar />
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto overflow-x-hidden">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
