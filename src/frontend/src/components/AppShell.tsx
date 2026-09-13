import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BriefcaseBusiness,
  Building2,
  ChartNoAxesCombined,
  ChevronRight,
  CircleCheckBig,
  CircleHelp,
  Clock3,
  FileCheck2,
  Files,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  RotateCcw,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useSession } from '../hooks/session';
import { initials } from '../lib/format';
import { demoCases } from '../mocks/behavioralFixtures';
import { isMockMode, resetDemoData } from '../services/api';
import { Badge, Brand, Button, Modal, Notice } from './ui';

const demoLawyer = isMockMode ? demoCases.find((item) => item.assigned_to_me) : undefined;

export default function AppShell() {
  const { role, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetStatus, setResetStatus] = useState<'idle' | 'pending' | 'success'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);
  useEffect(() => {
    if (!navigator.userAgent.includes('jsdom')) window.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);
  const admin = role === 'ADMINISTRATIVO';
  const profileName = admin ? 'Equipe do banco' : (demoLawyer?.lawyer_name ?? 'Perfil do advogado');
  const closeHelp = () => {
    if (resetStatus === 'pending') return;
    setHelpOpen(false);
    setConfirmReset(false);
    setResetStatus('idle');
    setResetError(null);
  };
  const restoreDemo = async () => {
    if (!isMockMode || !confirmReset || resetStatus === 'pending') return;
    setResetStatus('pending');
    setResetError(null);
    try {
      await resetDemoData();
      setResetStatus('success');
      setConfirmReset(false);
    } catch (cause) {
      setResetError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível restaurar a demonstração. Tente novamente.',
      );
      setResetStatus('idle');
    }
  };
  const links = admin
    ? [
        { to: '/admin/overview', label: 'Visão geral', icon: LayoutDashboard },
        { to: '/admin/adherence', label: 'Aderência', icon: ShieldCheck },
        { to: '/admin/effectiveness', label: 'Efetividade', icon: ChartNoAxesCombined },
        { to: '/admin/decisions', label: 'Decisões', icon: FileCheck2 },
      ]
    : [
        { to: '/minha-fila', label: 'Para analisar', icon: ListFilter },
        { to: '/em-andamento', label: 'Em andamento', icon: Clock3 },
        { to: '/finalizados', label: 'Finalizados', icon: CircleCheckBig },
      ];
  const adminFilterParams = new URLSearchParams(location.search);
  adminFilterParams.delete('view');
  const adminFilterSearch = adminFilterParams.toString();
  const workspace = location.pathname.startsWith('/processos/');
  const workspaceParent = ['/minha-fila', '/em-andamento', '/finalizados'].includes(
    location.state?.caseList,
  )
    ? location.state.caseList
    : '/minha-fila';
  const currentLabel = workspace
    ? 'Análise do processo'
    : links.find((link) => link.to === location.pathname)?.label || 'Processos';
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar navegação"
        />
      )}
      <aside className={`app-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X size={19} />
          </button>
        </div>
        <div className="organization">
          <span className="organization-icon">
            <Building2 size={18} />
          </span>
          <div>
            <strong>Banco Unicamp</strong>
            <span>Jurídico contencioso</span>
          </div>
          <span className="organization-dot" />
        </div>
        <div className="nav-section-label">{admin ? 'GESTÃO DA POLÍTICA' : 'ÁREA DO ADVOGADO'}</div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={admin && adminFilterSearch ? `${to}?${adminFilterSearch}` : to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-item ${isActive || (workspace && to === workspaceParent) ? 'active' : ''}`
              }
              end
            >
              <Icon size={18} />
              <span>{label}</span>
              <ChevronRight size={14} className="nav-chevron" />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-demo">
            <span className="demo-indicator" />
            <strong>Ambiente de demonstração</strong>
            <p>
              Decisões com contexto.
              <br />
              Evidências com origem.
            </p>
            <span className="sidebar-version">HACKATHON ENTER × UNICAMP</span>
          </div>
          <button className="nav-item help-link" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} />
            Guia da experiência
            <ChevronRight size={14} className="nav-chevron" />
          </button>
          <div className="sidebar-profile">
            <span className="avatar">{admin ? 'BU' : initials(profileName)}</span>
            <div>
              <strong title={profileName}>{profileName}</strong>
              <span>{admin ? 'Administrativo' : (demoLawyer?.firm_name ?? 'Advogado')}</span>
            </div>
            <button
              className="icon-button logout-button"
              aria-label="Sair da demonstração"
              title="Sair"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-only"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <span>{admin ? 'Policy intelligence' : 'Mesa do advogado'}</span>
            <ChevronRight size={13} />
            <strong>{currentLabel}</strong>
          </div>
          <div className="topbar-actions">
            <button className="topbar-help" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={17} aria-hidden="true" />
              Como usar
            </button>
            <div className="topbar-context">
              <span className="topbar-status">
                <span />
                Sistema demonstrativo
              </span>
              <span className="topbar-separator" />
              <button className="topbar-policy" onClick={() => setPolicyOpen(true)}>
                <Scale size={16} />
                Política de acordos
              </button>
            </div>
          </div>
        </header>
        <main id="main-content" className={`main-content ${workspace ? 'main-workspace' : ''}`}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            enter policy <span className="footer-dot">·</span> Inteligência para decisões jurídicas
          </span>
          <span>Protótipo independente · Enter × Unicamp</span>
        </footer>
      </div>
      <Modal
        open={helpOpen}
        onClose={closeHelp}
        title="Uma decisão bem fundamentada"
        description="Explore a experiência demonstrativa em três etapas."
      >
        <div className="modal-body guide-steps">
          <div>
            <Files size={20} />
            <section>
              <h3>Conheça as evidências</h3>
              <p>Abra um processo e consulte as fontes de cada fato, alegação e contradição.</p>
            </section>
          </div>
          <div>
            <Scale size={20} />
            <section>
              <h3>Registre sua decisão</h3>
              <p>
                Siga a recomendação ou justifique uma divergência. Em acordos, registre proposta e
                resultado.
              </p>
            </section>
          </div>
          <div>
            <BriefcaseBusiness size={20} />
            <section>
              <h3>Acompanhe o resultado</h3>
              <p>
                Entre como administrativo para consultar os registros desta demo. Os indicadores de
                exemplo estão identificados.
              </p>
            </section>
          </div>
        </div>
        {isMockMode && (
          <section
            className="modal-body"
            aria-labelledby="demo-reset-heading"
            aria-busy={resetStatus === 'pending'}
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <h3 id="demo-reset-heading" style={{ fontSize: 14, fontWeight: 550 }}>
              Recomeçar a experiência
            </h3>
            <p
              style={{
                fontSize: 12,
                lineHeight: 1.7,
                color: 'var(--muted)',
                marginTop: 7,
                marginBottom: 16,
              }}
            >
              Restaure o cenário inicial para experimentar outras decisões e negociações.
            </p>
            {resetStatus === 'success' ? (
              <div role="status">
                <Notice tone="success">
                  Demonstração restaurada. Os processos voltaram ao cenário inicial.
                </Notice>
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={confirmReset || resetStatus === 'pending'}
                  aria-expanded={confirmReset}
                  aria-controls="demo-reset-confirmation"
                  onClick={() => {
                    setConfirmReset(true);
                    setResetError(null);
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  Restaurar demonstração
                </Button>
                {confirmReset && (
                  <div id="demo-reset-confirmation" style={{ marginTop: 16 }}>
                    <Notice tone="warning">
                      Apenas as decisões e negociações locais desta demonstração serão removidas
                      deste navegador. Os dados de exemplo serão preservados.
                    </Notice>
                    {resetError && (
                      <p
                        className="field-error"
                        role="alert"
                        style={{ marginTop: 12, fontSize: 12 }}
                      >
                        {resetError}
                      </p>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        flexWrap: 'wrap',
                        gap: 10,
                        marginTop: 16,
                      }}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={resetStatus === 'pending'}
                        onClick={() => {
                          setConfirmReset(false);
                          setResetError(null);
                        }}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        loading={resetStatus === 'pending'}
                        onClick={() => {
                          void restoreDemo();
                        }}
                      >
                        {resetStatus === 'pending' ? 'Restaurando…' : 'Confirmar restauração'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </Modal>
      <Modal
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        title="Política de acordos vigente"
        description="Os mesmos critérios orientam todas as recomendações apresentadas aos advogados."
      >
        <div className="modal-body policy-rules">
          <article>
            <Badge value="ACORDO" />
            <div>
              <h3>Buscar composição</h3>
              <p>Quando o risco e as evidências favorecem uma solução dentro da faixa aprovada.</p>
            </div>
          </article>
          <article>
            <Badge value="DEFESA" />
            <div>
              <h3>Prosseguir com a defesa</h3>
              <p>
                Quando a prova documental sustenta a tese e o acordo não é a melhor opção agora.
              </p>
            </div>
          </article>
          <article>
            <Badge value="REVISAR" />
            <div>
              <h3>Confirmar antes de decidir</h3>
              <p>Quando faltam documentos ou há contradições que exigem análise humana.</p>
            </div>
          </article>
          <Notice tone="warning">
            A política orienta a decisão. Toda divergência exige motivo e justificativa e fica
            disponível para monitoramento administrativo.
          </Notice>
        </div>
      </Modal>
    </div>
  );
}
