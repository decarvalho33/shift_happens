import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Clock3,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { getCases, getDecision, getNegotiation, getRecommendation } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { Badge, ErrorState, LoadingState } from '../components/ui';
import { money } from '../lib/format';
import { getLawyerCaseState, getViewedCaseIds, type LawyerCaseState } from '../lib/caseProgress';
import {
  lawyerCaseBucket,
  needsLawyerAction,
  nextLawyerAction,
  prioritizeLawyerCase,
  sortPrioritizedCases,
  type LawyerCaseBucket,
  type LawyerCaseWorkflow,
  type PrioritizedLawyerCase,
} from '../lib/lawyerExperience';
import type { CaseSummary } from '../types';

type ListMode = LawyerCaseBucket;
type CaseWithWorkflow = CaseSummary & LawyerCaseWorkflow;

const modeConfig: Record<
  ListMode,
  { title: string; listTitle: string; path: string; emptyTitle: string; emptyCopy: string }
> = {
  analysis: {
    title: 'Para analisar',
    listTitle: 'Casos aguardando sua análise',
    path: '/minha-fila',
    emptyTitle: 'Nenhum processo para analisar',
    emptyCopy: 'Novos casos aparecerão aqui quando exigirem sua análise.',
  },
  progress: {
    title: 'Em andamento',
    listTitle: 'Casos com próxima ação pendente',
    path: '/em-andamento',
    emptyTitle: 'Nenhum processo em andamento',
    emptyCopy: 'Casos com proposta ou negociação pendente aparecerão aqui.',
  },
  finished: {
    title: 'Finalizados',
    listTitle: 'Histórico de casos finalizados',
    path: '/finalizados',
    emptyTitle: 'Nenhum processo finalizado',
    emptyCopy: 'Defesas, revisões e negociações encerradas aparecerão aqui.',
  },
};

const statePresentation: Record<LawyerCaseState, string> = {
  NOVO: 'Novo',
  VISUALIZADO: 'Visualizado',
  DECISAO_REGISTRADA: 'Decisão registrada',
  EM_NEGOCIACAO: 'Em negociação',
  CONCLUIDO: 'Concluído',
};

function sameLocalDay(value: string, reference = new Date()): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  return date.toLocaleDateString('pt-BR') === reference.toLocaleDateString('pt-BR');
}

export default function CasesPage({ mode = 'analysis' }: { mode?: ListMode }) {
  const loader = useCallback(async () => {
    const cases = await getCases();
    return Promise.all(
      cases.map(async (item): Promise<CaseWithWorkflow> => {
        const [decision, negotiation, recommendationDetail] = await Promise.all([
          getDecision(item.case_id),
          getNegotiation(item.case_id),
          getRecommendation(item.case_id),
        ]);
        return { ...item, decision, negotiation, recommendationDetail };
      }),
    );
  }, []);
  const { data: cases, loading, error, reload } = useAsync(loader);
  const [query, setQuery] = useState('');
  const [uf, setUf] = useState('all');
  const [recommendation, setRecommendation] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const isAnalysis = mode === 'analysis';
  const isActiveMode = mode !== 'finished';
  const config = modeConfig[mode];
  const viewedCaseIds = getViewedCaseIds();
  const source = useMemo(() => (cases || []).filter((item) => item.assigned_to_me), [cases]);
  const caseStates = new Map(
    source.map((item) => [
      item.case_id,
      getLawyerCaseState(item.case_id, item.status, viewedCaseIds),
    ]),
  );
  const available = useMemo(
    () => source.filter((item) => lawyerCaseBucket(item) === mode),
    [mode, source],
  );
  const orderedCases: (CaseWithWorkflow | PrioritizedLawyerCase)[] = isActiveMode
    ? sortPrioritizedCases(
        available.map((item) => prioritizeLawyerCase(item, caseStates.get(item.case_id) ?? 'NOVO')),
      )
    : available;
  const filtered = orderedCases.filter(
    (item) =>
      (uf === 'all' || item.uf === uf) &&
      (recommendation === 'all' || item.recommendation === recommendation) &&
      `${item.plaintiff} ${item.case_number} ${item.city} ${item.uf}`
        .toLocaleLowerCase('pt-BR')
        .includes(query.toLocaleLowerCase('pt-BR')),
  );
  const nextCase = filtered[0];
  const newCount = available.filter((item) => caseStates.get(item.case_id) === 'NOVO').length;
  const viewedCount = available.filter(
    (item) => caseStates.get(item.case_id) === 'VISUALIZADO',
  ).length;
  const activeNegotiations = source.filter(
    (item) =>
      item.negotiation?.status === 'PENDENTE' || item.negotiation?.status === 'CONTRAPROPOSTA',
  ).length;
  const completedToday = source.filter(
    (item) =>
      (item.negotiation?.status === 'ACEITA' || item.negotiation?.status === 'RECUSADA') &&
      sameLocalDay(item.negotiation.updated_at),
  ).length;
  const recordedDecisions = source.filter((item) => item.decision);
  const personalAdherence = recordedDecisions.length
    ? Math.round(
        (recordedDecisions.filter((item) => !item.decision?.is_override).length /
          recordedDecisions.length) *
          100,
      )
    : null;

  if (loading && !cases) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  function clearFilters() {
    setUf('all');
    setRecommendation('all');
    setQuery('');
  }

  return (
    <div className={`cases-page page-enter case-list-${mode}`}>
      <div className="page-header lawyer-list-header">
        <div>
          <div className="eyebrow">
            <span className="accent-square" />
            MESA DO ADVOGADO
          </div>
          <h1 className="page-title">{config.title}</h1>
        </div>
        <div className="header-meta">
          <Badge value="DEMO" />
          <span>Banco Unicamp · Consignado</span>
        </div>
      </div>

      {isActiveMode && nextCase && (
        <section className="queue-focus" aria-labelledby="queue-focus-title">
          <span className="queue-focus-icon" aria-hidden="true">
            <Clock3 size={24} />
          </span>
          <div className="queue-focus-copy">
            <span className="queue-focus-label">
              {isAnalysis ? 'FILA PRIORIZADA' : 'PRÓXIMA AÇÃO'}
            </span>
            <h2 id="queue-focus-title">Comece por {nextCase.plaintiff}</h2>
            {'priorityReasons' in nextCase && (
              <div className="queue-priority-reasons" aria-label="Motivos da prioridade">
                {nextCase.priorityReasons.slice(0, 3).map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
            )}
          </div>
          <div className="queue-focus-case">
            <span>{'priorityLabel' in nextCase ? nextCase.priorityLabel : 'Próxima ação'}</span>
            <strong>
              {nextLawyerAction(nextCase, caseStates.get(nextCase.case_id) ?? 'NOVO')}
            </strong>
            <small>
              {nextCase.case_number} · {money(nextCase.claim_value, true)}
            </small>
          </div>
          <Link
            className="button accent queue-focus-button"
            to={`/processos/${nextCase.case_id}`}
            state={{
              caseList: config.path,
              ...(nextLawyerAction(nextCase, caseStates.get(nextCase.case_id) ?? 'NOVO') ===
              'Pedir evidência'
                ? { focusAction: 'missing-evidence' }
                : {}),
            }}
            aria-label={`Próxima ação: ${nextLawyerAction(nextCase, caseStates.get(nextCase.case_id) ?? 'NOVO')} no processo de ${nextCase.plaintiff}`}
          >
            {nextLawyerAction(nextCase, caseStates.get(nextCase.case_id) ?? 'NOVO')}
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </section>
      )}

      {isAnalysis && (
        <section className="lawyer-productivity" aria-labelledby="productivity-title">
          <h2 id="productivity-title">Minha produtividade</h2>
          <div>
            <span>Pendentes</span>
            <strong>{available.length}</strong>
          </div>
          <div>
            <span>Em negociação</span>
            <strong>{activeNegotiations}</strong>
          </div>
          <div>
            <span>Concluídos hoje</span>
            <strong>{completedToday}</strong>
          </div>
          <div>
            <span>Aderência pessoal</span>
            <strong>{personalAdherence === null ? '—' : `${personalAdherence}%`}</strong>
          </div>
          <p>
            {newCount} {newCount === 1 ? 'não visto' : 'não vistos'} · {viewedCount}{' '}
            {viewedCount === 1 ? 'análise iniciada' : 'análises iniciadas'}
          </p>
        </section>
      )}

      <section className="panel case-list-panel">
        <div className="case-list-heading">
          <div>
            <h2>{config.listTitle}</h2>
          </div>
          <span className="table-count">
            {available.length} {available.length === 1 ? 'processo' : 'processos'}
          </span>
        </div>
        <div className="table-toolbar">
          <label className="search-input">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por autor, processo ou UF"
              aria-label="Buscar processos"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Limpar busca">
                ×
              </button>
            )}
          </label>
          <button
            className={`button secondary ${showFilters ? 'is-selected' : ''}`}
            aria-expanded={showFilters}
            onClick={() => setShowFilters((value) => !value)}
          >
            <SlidersHorizontal size={17} />
            Filtros
            {(uf !== 'all' || recommendation !== 'all') && <span className="active-filter-dot" />}
          </button>
        </div>
        {showFilters && (
          <div className="filter-row">
            <label className="field">
              UF
              <select className="select" value={uf} onChange={(event) => setUf(event.target.value)}>
                <option value="all">Todas as UFs</option>
                {[...new Set(available.map((item) => item.uf))].sort().map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Recomendação
              <select
                className="select"
                value={recommendation}
                onChange={(event) => setRecommendation(event.target.value)}
              >
                <option value="all">Todas as recomendações</option>
                <option value="ACORDO">Acordo</option>
                <option value="DEFESA">Defesa</option>
                <option value="REVISAR">Revisar</option>
              </select>
            </label>
            <button className="button ghost" onClick={clearFilters}>
              Limpar filtros
            </button>
          </div>
        )}
        <div className="table-scroll">
          <table className="cases-table">
            <thead>
              <tr>
                <th>Processo / Autor</th>
                <th>Valor da causa</th>
                <th>Risco</th>
                <th>Recomendação</th>
                <th>Situação</th>
                <th>
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const state = caseStates.get(item.case_id) ?? 'NOVO';
                const nextAction = nextLawyerAction(item, state);
                return (
                  <tr
                    key={item.case_id}
                    className={needsLawyerAction(item) ? 'case-needs-action' : undefined}
                  >
                    <td>
                      <Link
                        className="case-person"
                        to={`/processos/${item.case_id}`}
                        state={{ caseList: config.path }}
                      >
                        {item.plaintiff}
                        <ArrowUpRight size={15} />
                      </Link>
                      <span className="case-number">{item.case_number}</span>
                      <span className="case-city">
                        {item.city} <span>·</span> {item.uf}
                      </span>
                      {isActiveMode && 'priorityReasons' in item && (
                        <div className="case-priority-summary">
                          <strong>{item.priorityLabel}</strong>
                          <span>{item.priorityReasons.slice(0, 2).join(' · ')}</span>
                        </div>
                      )}
                    </td>
                    <td className="money-cell">
                      <span className="mobile-cell-label">Valor da causa</span>
                      {money(item.claim_value, true)}
                    </td>
                    <td>
                      <span className="mobile-cell-label">Risco</span>
                      <Badge value={item.risk_level} />
                    </td>
                    <td>
                      <span className="mobile-cell-label">Recomendação</span>
                      <Badge value={item.recommendation} />
                    </td>
                    <td>
                      <span className="mobile-cell-label">Situação</span>
                      <span className={`case-status status-${state.toLowerCase()}`}>
                        <span />
                        {statePresentation[state]}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="open-case"
                        to={`/processos/${item.case_id}`}
                        state={{
                          caseList: config.path,
                          ...(nextAction === 'Pedir evidência'
                            ? { focusAction: 'missing-evidence' }
                            : {}),
                        }}
                        aria-label={`${nextAction}: processo de ${item.plaintiff}`}
                      >
                        {nextAction}
                        <ArrowRight size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className={`empty-state ${available.length === 0 ? 'queue-complete' : ''}`}>
            {available.length === 0 ? <CheckCheck size={34} /> : <Search size={28} />}
            <h3>{available.length === 0 ? config.emptyTitle : 'Nenhum processo encontrado'}</h3>
            <p>
              {available.length === 0
                ? config.emptyCopy
                : 'Experimente outro nome ou ajuste os filtros.'}
            </p>
            {available.length > 0 && (
              <button className="button secondary" onClick={clearFilters}>
                Limpar filtros
              </button>
            )}
          </div>
        )}
        <div className="table-footer">
          <span>
            {filtered.length} de {available.length} processos
          </span>
          <span>
            <CheckCheck size={14} /> Cada ação fica registrada
          </span>
        </div>
      </section>
    </div>
  );
}
