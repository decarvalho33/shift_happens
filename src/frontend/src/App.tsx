import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ArrowLeft, FileSearch } from 'lucide-react';
import type { Role } from './types';
import { SessionProvider } from './hooks/useSession';
import { useSession } from './hooks/session';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import CasesPage from './pages/CasesPage';
import WorkspacePage from './pages/WorkspacePage';
import AdminPage from './pages/AdminPage';

function RequireRole({ role }: { role: Role }) {
  const session = useSession();
  if (!session.role) return <Navigate to="/" replace />;
  if (session.role !== role)
    return (
      <Navigate to={session.role === 'ADVOGADO' ? '/minha-fila' : '/admin/overview'} replace />
    );
  return <Outlet />;
}
function NotFound() {
  const { role } = useSession();
  return (
    <div className="empty-state" style={{ minHeight: '100dvh' }}>
      <FileSearch size={36} />
      <h1>Página não encontrada</h1>
      <p>O endereço pode ter mudado. Volte à sua mesa de trabalho para continuar.</p>
      <Link
        className="button primary"
        to={
          role === 'ADVOGADO' ? '/minha-fila' : role === 'ADMINISTRATIVO' ? '/admin/overview' : '/'
        }
      >
        <ArrowLeft size={15} />
        Voltar ao início
      </Link>
    </div>
  );
}
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route element={<RequireRole role="ADVOGADO" />}>
        <Route element={<AppShell />}>
          <Route path="/minha-fila" element={<CasesPage mode="analysis" />} />
          <Route path="/em-andamento" element={<CasesPage mode="progress" />} />
          <Route path="/finalizados" element={<CasesPage mode="finished" />} />
          <Route path="/processos" element={<Navigate to="/finalizados" replace />} />
          <Route path="/processos/:caseId" element={<WorkspacePage />} />
        </Route>
      </Route>
      <Route element={<RequireRole role="ADMINISTRATIVO" />}>
        <Route element={<AppShell />}>
          <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
          <Route path="/admin/:section" element={<AdminPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </BrowserRouter>
  );
}
