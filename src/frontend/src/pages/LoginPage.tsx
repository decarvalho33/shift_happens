import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  Fingerprint,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/session';
import { Brand } from '../components/ui';
import type { Role } from '../types';

export default function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const enter = (role: Role) => {
    login(role);
    navigate(role === 'ADVOGADO' ? '/minha-fila' : '/admin/overview');
  };
  return (
    <div className="login-page">
      <header className="login-header">
        <Brand />
        <div className="login-header-meta">
          <span className="login-edition">ENTER × UNICAMP</span>
          <span className="pill-neutral">
            <span className="demo-indicator" />
            Ambiente de demonstração
          </span>
        </div>
      </header>
      <main className="login-composition">
        <section className="login-story">
        <div className="login-story-content">
          <div className="eyebrow">
            <span className="accent-square" />
            POLÍTICA DE ACORDOS, COM INTELIGÊNCIA
          </div>
          <h1>
            Entenda o caso.
            <br />
            Confira as provas.
            <br />
            <span>Decida com segurança.</span>
          </h1>
          <p>
            O sistema organiza o que importa e mostra
            <br className="desktop-only" /> qual é o próximo passo.
          </p>
          <div className="login-principles">
            <span>
              <Check size={14} /> 1. Abra o processo
            </span>
            <span>
              <Check size={14} /> 2. Confira as provas
            </span>
            <span>
              <Check size={14} /> 3. Registre sua decisão
            </span>
          </div>
          <div className="login-proof">
            <div className="proof-icon">
              <ShieldCheck size={24} />
            </div>
            <div>
              <strong>O que sustenta uma boa decisão?</strong>
              <p>Os fatos certos. A fonte acessível. A política à vista.</p>
            </div>
            <ArrowUpRight size={23} />
          </div>
        </div>
        </section>
        <section className="login-access">
        <div className="login-access-content">
          <div className="access-icon">
            <Fingerprint size={27} strokeWidth={1.4} />
          </div>
          <div className="eyebrow">ACESSO À DEMONSTRAÇÃO</div>
          <h2>
            Como você quer
            <br /> entrar?
          </h2>
          <p className="login-intro">
            Se você analisa processos e toma decisões, escolha <strong>Advogado</strong>.
          </p>
          <button className="role-card role-lawyer" onClick={() => enter('ADVOGADO')}>
            <span className="role-icon">
              <Scale size={25} strokeWidth={1.6} />
            </span>
            <span className="role-copy">
              <strong>Entrar como Advogado</strong>
              <span>Abra casos, confira provas e registre decisões.</span>
            </span>
            <ArrowRight size={21} />
          </button>
          <button className="role-card" onClick={() => enter('ADMINISTRATIVO')}>
            <span className="role-icon">
              <BriefcaseBusiness size={24} strokeWidth={1.6} />
            </span>
            <span className="role-copy">
              <strong>Entrar como Administrativo</strong>
              <span>Veja indicadores, decisões e resultados.</span>
            </span>
            <ArrowRight size={21} />
          </button>
          <div className="login-note">
            <ShieldCheck size={15} />
            <p>
              Acesso demonstrativo. Os dados são fictícios e os registros desta experiência ficam
              neste navegador.
            </p>
          </div>
        </div>
        </section>
      </main>
      <footer className="login-footer">
        <span>UM NOVO OLHAR PARA O CONTENCIOSO.</span>
        <span>BANCO UNICAMP</span>
        <span>Protótipo para o Hackathon Enter × Unicamp</span>
        <span>2026</span>
      </footer>
    </div>
  );
}
