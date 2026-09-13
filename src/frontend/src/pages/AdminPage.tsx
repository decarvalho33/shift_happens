import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  Building2,
  CheckCheck,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Database,
  Filter,
  GitBranch,
  Handshake,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge, ErrorState, LoadingState } from '../components/ui';
import PolicyCopilot from '../components/PolicyCopilot';
import {
  createEffectivenessTimeline,
  createOutcomeDistribution,
  createOverrideReasons,
  deriveAdminMetrics,
  emptyAdminFilters,
  filterAdminRows,
  hasActiveAdminFilters,
  type AdminFilters,
  type AdminPeriod,
} from '../lib/adminMetrics';
import { money, percent, shortDate } from '../lib/format';
import { getAdminDashboard } from '../services/api';
import { parseAdminWhatIfScenario } from '../lib/policyCopilot';
import { policyCopilotProvider } from '../services/policyCopilot';
import type { AdminDashboard, AdminDecisionRow } from '../types';
import '../styles/admin.css';
import '../styles/admin-dark.css';

type AdminSection = 'overview' | 'adherence' | 'effectiveness' | 'decisions';
type Metric = { label: string; value: string; hint: string; icon: LucideIcon; accent?: boolean };
type TableFilters = {
  search: string;
  lawyer: string;
  firm: string;
  uf: string;
  recommendation: string;
  adherence: string;
};

const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
const percentagePoints = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'always',
  }).format(value * 100);
const normalize = (value: string) =>
  value
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const humanizeToken = (value: string) =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLocaleLowerCase('pt-BR'))
    .join(' ');
const emptyFilters: TableFilters = {
  search: '',
  lawyer: '',
  firm: '',
  uf: '',
  recommendation: '',
  adherence: '',
};
const sectionCopy: Record<AdminSection, { title: string; description: string }> = {
  overview: {
    title: 'Visão geral',
    description: 'Uma leitura clara das decisões, da aderência e dos resultados da política.',
  },
  adherence: {
    title: 'Aderência à política',
    description: 'Compare aderência, justificativas e resultados por advogado e escritório.',
  },
  effectiveness: {
    title: 'Efetividade da política',
    description: 'Meça economia, conversão e resultados das negociações.',
  },
  decisions: {
    title: 'Decisões registradas',
    description: 'Recomendação, decisão e resultado com rastreabilidade por caso.',
  },
};
const adminCopilotContexts: AdminSection[] = [
  'overview',
  'adherence',
  'effectiveness',
  'decisions',
];

function DemoLabel({ simulation = false }: { simulation?: boolean }) {
  return (
    <span className={`admin-data-label${simulation ? ' is-simulation' : ''}`}>
      <Database size={12} aria-hidden="true" />
      {simulation ? 'SIMULAÇÃO' : 'DADOS DEMONSTRATIVOS'}
    </span>
  );
}

function MetricGrid({ items }: { items: Metric[] }) {
  return (
    <div className={`admin-metrics admin-metrics-${items.length}`}>
      {items.map(({ label, value, hint, icon: Icon, accent }) => (
        <article className={`admin-metric${accent ? ' admin-metric-accent' : ''}`} key={label}>
          <div className="admin-metric-top">
            <span>{label}</span>
            <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
          </div>
          <strong className="admin-metric-value">{value}</strong>
          <span className="admin-metric-hint">{hint}</span>
        </article>
      ))}
    </div>
  );
}

function ViewSwitcher({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="admin-view-switcher" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          className={`admin-view-button${value === option.id ? ' is-active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function useQueryView<T extends string>(defaultView: T, allowedViews: readonly T[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryView = searchParams.get('view') as T | null;
  const activeView = queryView && allowedViews.includes(queryView) ? queryView : defaultView;
  const setActiveView = (nextView: T) => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === defaultView) nextParams.delete('view');
    else nextParams.set('view', nextView);
    setSearchParams(nextParams, { replace: true });
  };
  return [activeView, setActiveView] as const;
}

const filterQueryKeys: (keyof AdminFilters)[] = [
  'period',
  'firm',
  'lawyer',
  'uf',
  'recommendation',
  'confidence',
  'completeness',
];

function readAdminFilters(searchParams: URLSearchParams): AdminFilters {
  const periodValue = searchParams.get('period');
  const period: AdminPeriod =
    periodValue === '30' || periodValue === '90' || periodValue === '180' ? periodValue : 'all';
  const recommendation = searchParams.get('recommendation');
  return {
    period,
    firm: searchParams.get('firm') ?? '',
    lawyer: searchParams.get('lawyer') ?? '',
    uf: searchParams.get('uf') ?? '',
    recommendation:
      recommendation === 'ACORDO' || recommendation === 'DEFESA' || recommendation === 'REVISAR'
        ? recommendation
        : '',
    confidence: searchParams.get('confidence') ?? '',
    completeness: searchParams.get('completeness') ?? '',
  };
}

function GlobalFilters({
  rows,
  filters,
  onChange,
  onClear,
}: {
  rows: AdminDecisionRow[];
  filters: AdminFilters;
  onChange: (filters: AdminFilters) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const options = useMemo(
    () => ({
      firms: [...new Set(rows.map((row) => row.firm_name))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
      lawyers: [...new Set(rows.map((row) => row.lawyer_name))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
      states: [...new Set(rows.map((row) => row.uf))].sort(),
      confidence: [
        ...new Set(rows.flatMap((row) => (row.confidence_band ? [row.confidence_band] : []))),
      ],
      completeness: [
        ...new Set(rows.flatMap((row) => (row.completeness_band ? [row.completeness_band] : []))),
      ],
    }),
    [rows],
  );
  const active = hasActiveAdminFilters(filters);
  const selectedFilters = filterQueryKeys.filter((key) =>
    key === 'period' ? filters.period !== 'all' : Boolean(filters[key]),
  );
  const labels: Record<keyof AdminFilters, string> = {
    period: `Últimos ${filters.period} dias`,
    firm: filters.firm,
    lawyer: filters.lawyer,
    uf: filters.uf,
    recommendation: filters.recommendation,
    confidence: `Confiança: ${filters.confidence}`,
    completeness: `Completude: ${filters.completeness}`,
  };
  const update = (key: keyof AdminFilters, value: string) =>
    onChange({ ...filters, [key]: value } as AdminFilters);

  return (
    <section
      className={`admin-global-filters${expanded ? ' is-expanded' : ''}`}
      aria-label="Filtros globais"
    >
      <div className="admin-filter-summary">
        <div>
          <Filter size={16} aria-hidden="true" />
          <strong>Filtros da análise</strong>
          <span>{active ? `${selectedFilters.length} aplicados` : 'Toda a base'}</span>
        </div>
        <button
          className="admin-filter-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Ocultar filtros' : 'Refinar análise'}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="admin-global-filter-grid">
        <label>
          <span>Período</span>
          <select value={filters.period} onChange={(event) => update('period', event.target.value)}>
            <option value="all">Todo o período</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="180">Últimos 180 dias</option>
          </select>
        </label>
        <label>
          <span>Escritório</span>
          <select
            aria-label="Escritório global"
            value={filters.firm}
            onChange={(event) => update('firm', event.target.value)}
          >
            <option value="">Todos</option>
            {options.firms.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Advogado</span>
          <select
            aria-label="Advogado global"
            value={filters.lawyer}
            onChange={(event) => update('lawyer', event.target.value)}
          >
            <option value="">Todos</option>
            {options.lawyers.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>UF</span>
          <select
            aria-label="UF global"
            value={filters.uf}
            onChange={(event) => update('uf', event.target.value)}
          >
            <option value="">Todas</option>
            {options.states.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Recomendação</span>
          <select
            aria-label="Recomendação global"
            value={filters.recommendation}
            onChange={(event) => update('recommendation', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="ACORDO">Acordo</option>
            <option value="DEFESA">Defesa</option>
            <option value="REVISAR">Revisar</option>
          </select>
        </label>
        <label>
          <span>Confiança</span>
          <select
            value={filters.confidence}
            onChange={(event) => update('confidence', event.target.value)}
          >
            <option value="">Todas</option>
            {options.confidence.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Completude</span>
          <select
            value={filters.completeness}
            onChange={(event) => update('completeness', event.target.value)}
          >
            <option value="">Todas</option>
            {options.completeness.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {active && (
        <div className="admin-filter-chips">
          {selectedFilters.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => update(key, emptyAdminFilters[key])}
              aria-label={`Remover filtro ${labels[key]}`}
            >
              {labels[key]} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button className="is-clear" type="button" onClick={onClear}>
            Limpar filtros
          </button>
        </div>
      )}
    </section>
  );
}

function SnapshotNote({
  updatedAt,
  aggregateCount,
  detailedCount,
}: {
  updatedAt: string;
  aggregateCount: number;
  detailedCount: number;
}) {
  return (
    <div className="admin-snapshot-note" role="note" aria-label="Escopo dos dados administrativos">
      <Info size={15} aria-hidden="true" />
      <p>
        Os indicadores gerais usam <strong>{count(aggregateCount)} decisões simuladas</strong>. As
        análises por processo usam <strong>{count(detailedCount)} registros rastreáveis</strong>{' '}
        nesta demonstração; decisões salvas pelo advogado aparecem como{' '}
        <strong>“Nesta demo”</strong>.
      </p>
      <span>Atualizado {shortDate(updatedAt)}</span>
    </div>
  );
}

function OverrideReasons({
  data,
  aggregateScope,
  overrideTotal,
}: {
  data: AdminDashboard['override_reasons'];
  aggregateScope: boolean;
  overrideTotal: number;
}) {
  const classifiedTotal = data
    .filter((item) => item.label !== 'Sem motivo classificado')
    .reduce((total, item) => total + item.value, 0);
  const coverage = overrideTotal ? classifiedTotal / overrideTotal : 0;

  return (
    <section className="panel admin-panel" aria-labelledby="override-heading">
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">PARETO DE DIVERGÊNCIAS</span>
          <h2 id="override-heading">Motivos que concentram os desvios</h2>
        </div>
        <GitBranch size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        Participação de cada motivo e percentual acumulado no recorte atual.
      </p>
      {data.length ? (
        <>
          <div className="admin-reason-summary" role="note">
            <strong>
              {count(classifiedTotal)}{' '}
              {classifiedTotal === 1
                ? 'justificativa classificada'
                : 'justificativas classificadas'}
            </strong>
            <span>
              {aggregateScope
                ? `${percent(coverage)} das divergências · classificações históricas da base sintética de 60.000 decisões`
                : `${percent(coverage)} das divergências do recorte detalhado possuem motivo informado`}
            </span>
          </div>
          <div className="admin-reasons">
            {data.map((item, index) => {
              const cumulative = data
                .slice(0, index + 1)
                .reduce((total, current) => total + current.percentage, 0);
              return (
                <div className="admin-reason" key={item.label}>
                  <div>
                    <span>{item.label}</span>
                    <strong>
                      {percent(item.percentage)} <small>({count(item.value)})</small>
                    </strong>
                  </div>
                  <div className="admin-reason-track" aria-hidden="true">
                    <span
                      style={{ width: `${Math.min(1, Math.max(0, item.percentage)) * 100}%` }}
                    />
                  </div>
                  <small className="admin-reason-cumulative">{percent(cumulative)} acumulado</small>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="admin-chart-empty">Nenhum motivo registrado.</p>
      )}
    </section>
  );
}

type LawyerSummary = {
  name: string;
  firmName: string;
  decisions: number;
  adherenceRate: number;
  agreementRate: number;
  highConfidenceRate: number;
  completeDocumentationRate: number;
  avgDecisionMinutes: number | null;
  avgFollowProbability: number | null;
};

type FirmSummary = {
  name: string;
  decisions: number;
  adherenceRate: number;
  avgDecisionMinutes: number | null;
  avgFollowProbability: number | null;
  lawyerCount: number;
};

const average = (total: number, countValue: number) => (countValue ? total / countValue : 0);

function scopedFinancials(data: AdminDashboard, rows: AdminDecisionRow[]) {
  const totalExposure = data.decisions.reduce(
    (total, row) => total + Math.max(0, row.suggested_value ?? 0),
    0,
  );
  const selectedExposure = rows.reduce(
    (total, row) => total + Math.max(0, row.suggested_value ?? 0),
    0,
  );
  const share =
    rows.length === data.decisions.length
      ? 1
      : totalExposure > 0
        ? selectedExposure / totalExposure
        : data.decisions.length
          ? rows.length / data.decisions.length
          : 0;
  return {
    baselineCost: data.metrics.baseline_cost * share,
    projectedCost: data.metrics.projected_cost * share,
    estimatedSavings: data.metrics.estimated_savings * share,
    savingsRate: data.metrics.estimated_savings_rate,
    proportionallyAllocated: share !== 1,
  };
}

function summarizeLawyers(rows: AdminDecisionRow[]): LawyerSummary[] {
  const lawyers = new Map<
    string,
    {
      name: string;
      firmName: string;
      decisions: number;
      adherent: number;
      agreements: number;
      highConfidence: number;
      completeDocumentation: number;
      decisionMinutesTotal: number;
      decisionMinutesCount: number;
      followProbabilityTotal: number;
      followProbabilityCount: number;
    }
  >();

  for (const row of rows) {
    const key = `${row.lawyer_name}::${row.firm_name}`;
    const current = lawyers.get(key) ?? {
      name: row.lawyer_name,
      firmName: row.firm_name,
      decisions: 0,
      adherent: 0,
      agreements: 0,
      highConfidence: 0,
      completeDocumentation: 0,
      decisionMinutesTotal: 0,
      decisionMinutesCount: 0,
      followProbabilityTotal: 0,
      followProbabilityCount: 0,
    };

    current.decisions += 1;
    current.adherent += row.adherent ? 1 : 0;
    current.agreements += row.decision === 'ACORDO' ? 1 : 0;
    current.highConfidence += (row.confidence_score ?? 0) >= 0.8 ? 1 : 0;
    current.completeDocumentation += normalize(row.completeness_band ?? '') === 'alta' ? 1 : 0;
    if (row.decision_minutes != null) {
      current.decisionMinutesTotal += row.decision_minutes;
      current.decisionMinutesCount += 1;
    }
    if (row.follow_probability != null) {
      current.followProbabilityTotal += row.follow_probability;
      current.followProbabilityCount += 1;
    }
    lawyers.set(key, current);
  }

  return [...lawyers.values()]
    .map((lawyer) => ({
      name: lawyer.name,
      firmName: lawyer.firmName,
      decisions: lawyer.decisions,
      adherenceRate: average(lawyer.adherent, lawyer.decisions),
      agreementRate: average(lawyer.agreements, lawyer.decisions),
      highConfidenceRate: average(lawyer.highConfidence, lawyer.decisions),
      completeDocumentationRate: average(lawyer.completeDocumentation, lawyer.decisions),
      avgDecisionMinutes: lawyer.decisionMinutesCount
        ? average(lawyer.decisionMinutesTotal, lawyer.decisionMinutesCount)
        : null,
      avgFollowProbability: lawyer.followProbabilityCount
        ? average(lawyer.followProbabilityTotal, lawyer.followProbabilityCount)
        : null,
    }))
    .sort(
      (left, right) => right.adherenceRate - left.adherenceRate || right.decisions - left.decisions,
    );
}

function summarizeFirms(rows: AdminDecisionRow[]): FirmSummary[] {
  const firms = new Map<
    string,
    {
      name: string;
      decisions: number;
      adherent: number;
      decisionMinutesTotal: number;
      decisionMinutesCount: number;
      followProbabilityTotal: number;
      followProbabilityCount: number;
      lawyers: Set<string>;
    }
  >();

  for (const row of rows) {
    const current = firms.get(row.firm_name) ?? {
      name: row.firm_name,
      decisions: 0,
      adherent: 0,
      decisionMinutesTotal: 0,
      decisionMinutesCount: 0,
      followProbabilityTotal: 0,
      followProbabilityCount: 0,
      lawyers: new Set<string>(),
    };

    current.decisions += 1;
    current.adherent += row.adherent ? 1 : 0;
    if (row.decision_minutes != null) {
      current.decisionMinutesTotal += row.decision_minutes;
      current.decisionMinutesCount += 1;
    }
    if (row.follow_probability != null) {
      current.followProbabilityTotal += row.follow_probability;
      current.followProbabilityCount += 1;
    }
    current.lawyers.add(row.lawyer_name);
    firms.set(row.firm_name, current);
  }

  return [...firms.values()]
    .map((firm) => ({
      name: firm.name,
      decisions: firm.decisions,
      adherenceRate: average(firm.adherent, firm.decisions),
      avgDecisionMinutes: firm.decisionMinutesCount
        ? average(firm.decisionMinutesTotal, firm.decisionMinutesCount)
        : null,
      avgFollowProbability: firm.followProbabilityCount
        ? average(firm.followProbabilityTotal, firm.followProbabilityCount)
        : null,
      lawyerCount: firm.lawyers.size,
    }))
    .sort(
      (left, right) => right.adherenceRate - left.adherenceRate || right.decisions - left.decisions,
    );
}

function aggregateLawyerSummaries(
  data: NonNullable<AdminDashboard['lawyer_adherence']>,
): LawyerSummary[] {
  return data.map((lawyer) => ({
    name: lawyer.name,
    firmName: lawyer.firm_name,
    decisions: lawyer.decisions,
    adherenceRate: lawyer.adherence_rate,
    agreementRate: lawyer.agreement_rate,
    highConfidenceRate: lawyer.high_confidence_rate,
    completeDocumentationRate: lawyer.complete_documentation_rate,
    avgDecisionMinutes: lawyer.avg_decision_minutes,
    avgFollowProbability: lawyer.avg_follow_probability,
  }));
}

function aggregateFirmSummaries(
  data: NonNullable<AdminDashboard['firm_adherence']>,
): FirmSummary[] {
  return data.map((firm) => ({
    name: firm.name,
    decisions: firm.decisions,
    adherenceRate: firm.adherence_rate,
    avgDecisionMinutes: firm.avg_decision_minutes,
    avgFollowProbability: firm.avg_follow_probability,
    lawyerCount: firm.lawyer_count,
  }));
}

function adherenceSignal(rate: number, baseline: number) {
  if (rate >= baseline + 0.08) return { label: 'Acima da média', tone: 'is-positive' };
  if (rate <= baseline - 0.08) return { label: 'Requer atenção', tone: 'is-warning' };
  return { label: 'Próximo da média', tone: 'is-neutral' };
}

function AdherenceHighlights({ decisions, overrides }: { decisions: number; overrides: number }) {
  const adherenceRate = decisions ? (decisions - overrides) / decisions : 0;
  const overrideRate = decisions ? overrides / decisions : 0;
  const items = [
    {
      label: 'Decisões aderentes',
      value: decisions - overrides,
      rate: adherenceRate,
      tone: 'is-adherent',
    },
    {
      label: 'Divergências',
      value: overrides,
      rate: overrideRate,
      tone: 'is-override',
    },
  ];

  return (
    <div className="admin-adherence-volume">
      {items.map((item) => (
        <div key={item.label}>
          <header>
            <span>{item.label}</span>
            <strong>{count(item.value)}</strong>
            <b>{percent(item.rate)}</b>
          </header>
          <div aria-hidden="true">
            <i className={item.tone} style={{ width: `${item.rate * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AdherenceHighlightsPanel({
  decisions,
  overrides,
}: {
  decisions: number;
  overrides: number;
}) {
  return (
    <section
      className="panel admin-panel admin-adherence-panel admin-adherence-panel-overview"
      aria-labelledby="adherence-highlights-heading"
    >
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">VOLUME DA POLÍTICA</span>
          <h2 id="adherence-highlights-heading">Quantidade de aderência</h2>
        </div>
        <ShieldCheck size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        Comparação direta entre decisões que seguiram a recomendação e divergências registradas.
      </p>
      <AdherenceHighlights decisions={decisions} overrides={overrides} />
    </section>
  );
}

function LawyerBehaviorPanel({
  summaries,
  overallAdherence,
  aggregateScope,
}: {
  summaries: LawyerSummary[];
  overallAdherence: number;
  aggregateScope: boolean;
}) {
  const [order, setOrder] = useState<'risk' | 'volume' | 'adherence'>('adherence');
  const [query, setQuery] = useState('');
  const totalDecisions = summaries.reduce((total, lawyer) => total + lawyer.decisions, 0);
  const lawyers = summaries
    .filter((lawyer) => normalize(`${lawyer.name} ${lawyer.firmName}`).includes(normalize(query)))
    .sort((left, right) => {
      if (order === 'volume') return right.decisions - left.decisions;
      if (order === 'adherence') return right.adherenceRate - left.adherenceRate;
      return left.adherenceRate - right.adherenceRate || right.decisions - left.decisions;
    });
  return (
    <section
      className="panel admin-panel admin-adherence-panel admin-lawyer-panel"
      aria-labelledby="lawyer-behavior-heading"
    >
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">COMPORTAMENTO MENSURÁVEL</span>
          <h2 id="lawyer-behavior-heading">Indicadores por advogado</h2>
        </div>
        <Users size={21} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        {aggregateScope
          ? `Base agregada completa: ${count(summaries.length)} ${summaries.length === 1 ? 'advogado' : 'advogados'} e ${count(totalDecisions)} ${totalDecisions === 1 ? 'decisão' : 'decisões'}, sem corte por quantidade.`
          : `Recorte filtrado: ${count(summaries.length)} ${summaries.length === 1 ? 'advogado' : 'advogados'} e ${count(totalDecisions)} ${totalDecisions === 1 ? 'registro rastreável' : 'registros rastreáveis'}.`}{' '}
        A amostra de cada advogado permanece visível.
      </p>
      <div className="admin-analysis-toolbar">
        <label className="admin-inline-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar advogado ou escritório"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Ordenar por</span>
          <select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}>
            <option value="risk">Maior desvio</option>
            <option value="volume">Maior volume</option>
            <option value="adherence">Maior aderência</option>
          </select>
        </label>
      </div>
      <div className="admin-ranking-list">
        {lawyers.map((lawyer) => {
          const delta = lawyer.adherenceRate - overallAdherence;
          const indicators = [
            { label: 'Aderência observada', value: lawyer.adherenceRate },
            { label: 'Propensão estimada', value: lawyer.avgFollowProbability },
            { label: 'Decisões em acordo', value: lawyer.agreementRate },
            { label: 'Casos de alta confiança', value: lawyer.highConfidenceRate },
          ];
          return (
            <article className="admin-lawyer-row" key={`${lawyer.name}-${lawyer.firmName}`}>
              <div className="admin-lawyer-heading">
                <div>
                  <strong>{lawyer.name}</strong>
                  <span>{lawyer.firmName}</span>
                </div>
                <div>
                  <strong>{count(lawyer.decisions)}</strong>
                  <span>
                    {aggregateScope
                      ? lawyer.decisions === 1
                        ? 'decisão na base'
                        : 'decisões na base'
                      : lawyer.decisions === 1
                        ? 'registro rastreável'
                        : 'registros rastreáveis'}
                  </span>
                </div>
                <div>
                  <strong className={delta < -0.08 ? 'is-critical' : ''}>
                    {delta >= 0 ? '+' : ''}
                    {(delta * 100).toFixed(1)} p.p.
                  </strong>
                  <span>vs. média</span>
                </div>
              </div>
              <div className="admin-lawyer-indicators">
                {indicators.map((indicator) => (
                  <div key={indicator.label}>
                    <span>{indicator.label}</span>
                    <strong>
                      {indicator.value == null ? 'Indisponível' : percent(indicator.value)}
                    </strong>
                    <i aria-hidden="true">
                      <b style={{ width: `${(indicator.value ?? 0) * 100}%` }} />
                    </i>
                  </div>
                ))}
              </div>
              <footer>
                <span>{percent(lawyer.completeDocumentationRate)} com documentação completa</span>
                {lawyer.avgDecisionMinutes != null && (
                  <span>{count(Math.round(lawyer.avgDecisionMinutes))} min em média</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
      {!lawyers.length && <p className="admin-chart-empty">Nenhum advogado encontrado.</p>}
    </section>
  );
}

function FirmComparisonPanel({
  summaries,
  overallAdherence,
  aggregateScope,
}: {
  summaries: FirmSummary[];
  overallAdherence: number;
  aggregateScope: boolean;
}) {
  const [order, setOrder] = useState<'risk' | 'volume' | 'adherence'>('adherence');
  const [query, setQuery] = useState('');
  const totalDecisions = summaries.reduce((total, firm) => total + firm.decisions, 0);
  const firms = summaries
    .filter((firm) => normalize(firm.name).includes(normalize(query)))
    .sort((left, right) => {
      if (order === 'volume') return right.decisions - left.decisions;
      if (order === 'adherence') return right.adherenceRate - left.adherenceRate;
      return left.adherenceRate - right.adherenceRate || right.decisions - left.decisions;
    });
  return (
    <section
      className="panel admin-panel admin-adherence-panel admin-adherence-panel-firms"
      aria-labelledby="firm-comparison-heading"
    >
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">COMPARAÇÃO OPERACIONAL</span>
          <h2 id="firm-comparison-heading">Escritórios que mais aderiram</h2>
        </div>
        <GitBranch size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        {aggregateScope
          ? `Base agregada completa: ${count(summaries.length)} ${summaries.length === 1 ? 'escritório' : 'escritórios'} e ${count(totalDecisions)} ${totalDecisions === 1 ? 'decisão' : 'decisões'}, sem corte por quantidade.`
          : `Recorte filtrado: ${count(summaries.length)} ${summaries.length === 1 ? 'escritório' : 'escritórios'} e ${count(totalDecisions)} ${totalDecisions === 1 ? 'registro rastreável' : 'registros rastreáveis'}.`}{' '}
        O ranking mostra o volume e a quantidade de advogados avaliados.
      </p>
      <div className="admin-analysis-toolbar">
        <label className="admin-inline-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar escritório"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Ordenar por</span>
          <select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}>
            <option value="risk">Maior desvio</option>
            <option value="volume">Maior volume</option>
            <option value="adherence">Maior aderência</option>
          </select>
        </label>
      </div>
      <div className="admin-ranking-list">
        {firms.map((firm) => {
          const signal = adherenceSignal(firm.adherenceRate, overallAdherence);
          const delta = firm.adherenceRate - overallAdherence;
          return (
            <article className="admin-ranking-row" key={firm.name}>
              <div className="admin-ranking-copy">
                <strong>{firm.name}</strong>
                <span>{count(firm.lawyerCount)} advogados avaliados</span>
              </div>
              <div className="admin-ranking-visual">
                <div className="admin-ranking-values">
                  <strong className="admin-ranking-rate">{percent(firm.adherenceRate)}</strong>
                  <span
                    className={`admin-ranking-delta${delta < -0.08 ? ' is-critical' : delta > 0.08 ? ' is-positive' : ''}`}
                  >
                    {percentagePoints(delta)} p.p. vs. média
                  </span>
                  <small className="admin-ranking-sample">
                    {count(firm.decisions)}{' '}
                    {aggregateScope
                      ? firm.decisions === 1
                        ? 'decisão na base'
                        : 'decisões na base'
                      : firm.decisions === 1
                        ? 'registro rastreável'
                        : 'registros rastreáveis'}
                  </small>
                  <span className={`admin-firm-signal ${signal.tone}`}>{signal.label}</span>
                </div>
                <div className="admin-ranking-scale" aria-hidden="true">
                  <span>Aderência do escritório</span>
                  <span style={{ left: `${overallAdherence * 100}%` }}>
                    Média geral · {percent(overallAdherence)}
                  </span>
                </div>
                <div
                  className="admin-ranking-track"
                  role="meter"
                  aria-label={`Aderência ${percent(firm.adherenceRate)}. Média geral ${percent(overallAdherence)}.`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Number((firm.adherenceRate * 100).toFixed(1))}
                >
                  <i style={{ left: `${overallAdherence * 100}%` }} />
                  <span style={{ width: `${firm.adherenceRate * 100}%` }} />
                </div>
                <div className="admin-ranking-meta">
                  {firm.avgDecisionMinutes != null && (
                    <span>
                      <small>Tempo médio</small>
                      <strong>{count(Math.round(firm.avgDecisionMinutes))} min</strong>
                    </span>
                  )}
                  {firm.avgFollowProbability != null && (
                    <span>
                      <small>Propensão estimada</small>
                      <strong>{percent(firm.avgFollowProbability)}</strong>
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!firms.length && <p className="admin-chart-empty">Nenhum escritório encontrado.</p>}
    </section>
  );
}

function EffectivenessOutcomeChart({ data }: { data: AdminDashboard['effectiveness_outcomes'] }) {
  return (
    <section className="panel admin-panel" aria-labelledby="effectiveness-outcomes-heading">
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">RESULTADO DAS NEGOCIACOES</span>
          <h2 id="effectiveness-outcomes-heading">Como as propostas terminaram</h2>
        </div>
        <Handshake size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        Composicao das tentativas de acordo no cenario de demonstracao.
      </p>
      <div
        className="admin-distribution"
        role="img"
        aria-label={data
          .map((item) => `${item.label}: ${count(item.value)}, ${percent(item.percentage)}`)
          .join('. ')}
      >
        <div className="admin-distribution-total" aria-hidden="true">
          {data.map((item, index) => (
            <span
              key={item.label}
              className={`admin-chart-tone-${index % 3}`}
              style={{ flexGrow: Math.max(0, item.percentage) }}
            />
          ))}
        </div>
        <div className="admin-distribution-rows" aria-hidden="true">
          {data.map((item, index) => (
            <div className="admin-distribution-row" key={item.label}>
              <span className={`admin-chart-dot admin-chart-tone-${index % 3}`} />
              <span className="admin-distribution-name">{item.label}</span>
              <strong>{count(item.value)}</strong>
              <span className="admin-distribution-percent">{percent(item.percentage)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SavingsFlowChart({ data }: { data: AdminDashboard['effectiveness_savings_flow'] }) {
  const maximum = Math.max(1, ...data.map((item) => item.value));
  return (
    <section className="panel admin-panel" aria-labelledby="savings-flow-heading">
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">WATERFALL FINANCEIRO</span>
          <h2 id="savings-flow-heading">Do custo-base ao custo projetado</h2>
        </div>
        <CircleDollarSign size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        Comparação entre custo-base, economia estimada e custo projetado com a política.
      </p>
      <div
        className="admin-waterfall"
        role="img"
        aria-label={data.map((item) => `${item.label}: ${money(item.value)}`).join('. ')}
      >
        {data.map((item, index) => (
          <div className={`admin-waterfall-item is-${index}`} key={item.label}>
            <strong>{money(item.value, true)}</strong>
            <div className="admin-waterfall-column" aria-hidden="true">
              <span
                className={`admin-chart-tone-${index % 3}`}
                style={{ height: `${Math.max(8, (item.value / maximum) * 100)}%` }}
              />
            </div>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EffectivenessTimeline({ data }: { data: AdminDashboard['effectiveness_timeline'] }) {
  const maximum = Math.max(1, ...data.map((item) => item.savings));
  return (
    <section className="panel admin-panel" aria-labelledby="effectiveness-timeline-heading">
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">TRAJETORIA DA EFETIVIDADE</span>
          <h2 id="effectiveness-timeline-heading">Economia e aceitacao por mes</h2>
        </div>
        <Activity size={19} aria-hidden="true" />
      </div>
      <p className="admin-panel-description">
        A economia acumulada cresce junto da taxa de aceitacao ao longo do periodo.
      </p>
      <div className="admin-effectiveness-timeline" aria-hidden="true">
        {data.map((item) => (
          <div className="admin-effectiveness-period" key={item.label}>
            <div className="admin-effectiveness-bar-wrap">
              <span>{money(item.savings, true)}</span>
              <div
                className="admin-effectiveness-bar"
                style={{ height: `${(item.savings / maximum) * 100}%` }}
              />
            </div>
            <strong>{percent(item.acceptance_rate)}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LocalLabel() {
  return (
    <span className="admin-local-label">
      <span aria-hidden="true" />
      Nesta demo
    </span>
  );
}

function DecisionTable({ rows }: { rows: AdminDecisionRow[] }) {
  const [filters, setFilters] = useState<TableFilters>(emptyFilters);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'oldest' | 'value' | 'critical'>('recent');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const options = useMemo(
    () => ({
      lawyers: [...new Set(rows.map((row) => row.lawyer_name))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
      firms: [...new Set(rows.map((row) => row.firm_name))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
      states: [...new Set(rows.map((row) => row.uf))].sort(),
    }),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      const query = normalize(filters.search.trim());
      return (
        (!query ||
          normalize(
            [row.case_number, row.plaintiff, row.lawyer_name, row.firm_name, row.uf].join(' '),
          ).includes(query)) &&
        (!filters.lawyer || row.lawyer_name === filters.lawyer) &&
        (!filters.firm || row.firm_name === filters.firm) &&
        (!filters.uf || row.uf === filters.uf) &&
        (!filters.recommendation || row.recommendation === filters.recommendation) &&
        (!filters.adherence || (filters.adherence === 'adherent' ? row.adherent : !row.adherent))
      );
    });
    return filtered.sort((left, right) => {
      if (sort === 'oldest') return left.created_at.localeCompare(right.created_at);
      if (sort === 'value') return (right.realized_value ?? 0) - (left.realized_value ?? 0);
      if (sort === 'critical') {
        const risk = (row: AdminDecisionRow) =>
          (!row.adherent ? 3 : 0) +
          (!row.adherent && !row.justification?.trim() ? 3 : 0) +
          ((row.confidence_score ?? 0) >= 0.8 ? 1 : 0) +
          ((row.completeness_band ?? '').toLocaleLowerCase('pt-BR') === 'baixa' ? 2 : 0);
        return risk(right) - risk(left);
      }
      return right.created_at.localeCompare(left.created_at);
    });
  }, [rows, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visiblePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  const updateFilter = (name: keyof TableFilters, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
    setExpandedId(null);
  };
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <section className="panel admin-decisions-panel" aria-labelledby="decisions-heading">
      <div className="admin-table-heading">
        <div>
          <span className="admin-section-kicker">DECISÃO A DECISÃO</span>
          <h2 id="decisions-heading">Registro da operação</h2>
          <p>Explore cada processo e acompanhe a decisão registrada.</p>
        </div>
        <span className="admin-record-count" aria-live="polite">
          {count(filteredRows.length)}{' '}
          {filteredRows.length === 1 ? 'registro rastreável' : 'registros rastreáveis'}
          {hasFilters && ` de ${count(rows.length)}`}
        </span>
      </div>
      <div className="admin-table-filters">
        <label className="field admin-search-field">
          <span>Buscar processo ou pessoa</span>
          <div className="admin-search-input">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Nº do processo, parte, advogado…"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </div>
        </label>
        <label className="field">
          <span>Advogado</span>
          <select
            className="select"
            value={filters.lawyer}
            onChange={(event) => updateFilter('lawyer', event.target.value)}
          >
            <option value="">Todos os advogados</option>
            {options.lawyers.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Escritório</span>
          <select
            className="select"
            value={filters.firm}
            onChange={(event) => updateFilter('firm', event.target.value)}
          >
            <option value="">Todos os escritórios</option>
            {options.firms.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>UF</span>
          <select
            className="select"
            value={filters.uf}
            onChange={(event) => updateFilter('uf', event.target.value)}
          >
            <option value="">Todas</option>
            {options.states.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Recomendação</span>
          <select
            className="select"
            value={filters.recommendation}
            onChange={(event) => updateFilter('recommendation', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="ACORDO">Acordo</option>
            <option value="DEFESA">Defesa</option>
            <option value="REVISAR">Revisar</option>
          </select>
        </label>
        <label className="field">
          <span>Aderência</span>
          <select
            className="select"
            value={filters.adherence}
            onChange={(event) => updateFilter('adherence', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="adherent">Aderente</option>
            <option value="override">Divergência</option>
          </select>
        </label>
        <label className="field">
          <span>Ordenar</span>
          <select
            className="select"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              setPage(1);
              setExpandedId(null);
            }}
          >
            <option value="recent">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
            <option value="value">Maior valor realizado</option>
            <option value="critical">Casos críticos</option>
          </select>
        </label>
      </div>
      {hasFilters && (
        <div className="admin-active-filters">
          <SlidersHorizontal size={13} aria-hidden="true" />
          <span>Filtros aplicados</span>
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            Limpar filtros <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      {filteredRows.length ? (
        <div
          className="admin-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Tabela de decisões. Role horizontalmente para ver todas as colunas."
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Processo</th>
                <th scope="col">Advogado e escritório</th>
                <th scope="col">Recomendação</th>
                <th scope="col">Decisão</th>
                <th scope="col">Aderência</th>
                <th scope="col" className="admin-number-cell">
                  Sugerido
                </th>
                <th scope="col" className="admin-number-cell">
                  Realizado
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <Fragment key={row.id}>
                  <tr className={expandedId === row.id ? 'is-expanded' : undefined}>
                    <td>
                      <button
                        className="admin-case-button"
                        type="button"
                        aria-expanded={expandedId === row.id}
                        aria-controls={`admin-record-${row.id}`}
                        onClick={() =>
                          setExpandedId((current) => (current === row.id ? null : row.id))
                        }
                      >
                        {row.case_number}
                        <ChevronDown size={13} aria-hidden="true" />
                      </button>
                      <span className="admin-cell-secondary">
                        {row.plaintiff} <span className="admin-cell-state">{row.uf}</span>
                      </span>
                      {row.is_local && <LocalLabel />}
                    </td>
                    <td>
                      <span className="admin-cell-primary">{row.lawyer_name}</span>
                      <span className="admin-cell-secondary">{row.firm_name}</span>
                    </td>
                    <td>
                      <Badge value={row.recommendation} />
                    </td>
                    <td>
                      <Badge value={row.decision} />
                    </td>
                    <td>
                      <span
                        className={`admin-adherence${row.adherent ? ' is-adherent' : ' is-override'}`}
                      >
                        {row.adherent ? (
                          <CheckCheck size={14} aria-hidden="true" />
                        ) : (
                          <GitBranch size={14} aria-hidden="true" />
                        )}
                        {row.adherent ? 'Aderente' : 'Divergência'}
                      </span>
                    </td>
                    <td className="admin-number-cell">{money(row.suggested_value)}</td>
                    <td className="admin-number-cell">{money(row.realized_value)}</td>
                    <td>
                      <Badge value={row.status} />
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr className="admin-detail-row" id={`admin-record-${row.id}`}>
                      <td colSpan={8}>
                        <div className="admin-record-detail">
                          <div>
                            <span className="admin-section-kicker">CONTEXTO DO REGISTRO</span>
                            <p>
                              {row.justification ||
                                row.decision_explanation ||
                                (row.adherent
                                  ? 'A decisão registrada acompanha a recomendação da política.'
                                  : 'Não há justificativa disponível neste registro.')}
                            </p>
                          </div>
                          <dl>
                            {row.confidence_band && (
                              <div>
                                <dt>Confianca</dt>
                                <dd>
                                  {row.confidence_band}
                                  {row.confidence_score != null
                                    ? ` (${percent(row.confidence_score)})`
                                    : ''}
                                </dd>
                              </div>
                            )}
                            {row.completeness_band && (
                              <div>
                                <dt>Completude</dt>
                                <dd>
                                  {row.completeness_band}
                                  {row.subsidy_count != null
                                    ? ` · ${row.subsidy_count} subsidios`
                                    : ''}
                                </dd>
                              </div>
                            )}
                            {row.override_reason_label && (
                              <div>
                                <dt>Motivo da divergência</dt>
                                <dd>{humanizeToken(row.override_reason_label)}</dd>
                              </div>
                            )}
                            {row.follow_probability != null && (
                              <div>
                                <dt>Probabilidade de seguir</dt>
                                <dd>{percent(row.follow_probability)}</dd>
                              </div>
                            )}
                            {row.decision_minutes != null && (
                              <div>
                                <dt>Tempo de decisao</dt>
                                <dd>{count(row.decision_minutes)} min</dd>
                              </div>
                            )}
                            <div>
                              <dt>Registrado em</dt>
                              <dd>{shortDate(row.created_at)}</dd>
                            </div>
                            <div>
                              <dt>Origem</dt>
                              <dd>
                                {row.is_local
                                  ? 'Registro feito nesta demo'
                                  : 'Cenário de demonstração'}
                              </dd>
                            </div>
                          </dl>
                          <button
                            type="button"
                            className="button ghost admin-detail-close"
                            aria-label="Fechar contexto do registro"
                            onClick={() => setExpandedId(null)}
                          >
                            <X size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state admin-table-empty">
          <Search size={27} strokeWidth={1.4} aria-hidden="true" />
          <h3>{hasFilters ? 'Nenhum registro encontrado' : 'Nenhuma decisão registrada'}</h3>
          <p>
            {hasFilters
              ? 'Ajuste os filtros ou tente buscar por outro processo, advogado ou escritório.'
              : 'As decisões registradas pelo advogado aparecerão aqui.'}
          </p>
          {hasFilters && (
            <button
              className="button secondary"
              type="button"
              onClick={() => setFilters(emptyFilters)}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
      <div className="admin-table-footer">
        <div>
          <Info size={14} aria-hidden="true" />
          <span>Valores e status refletem cada registro. Um traço indica dado indisponível.</span>
        </div>
        {filteredRows.length > pageSize && (
          <nav className="admin-pagination" aria-label="Paginação de decisões">
            <button
              type="button"
              disabled={visiblePage === 1}
              onClick={() => setPage(visiblePage - 1)}
            >
              Anterior
            </button>
            <span>
              Página {visiblePage} de {totalPages}
            </span>
            <button
              type="button"
              disabled={visiblePage === totalPages}
              onClick={() => setPage(visiblePage + 1)}
            >
              Próxima
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}

function Decisions({ rows }: { rows: AdminDecisionRow[] }) {
  type DecisionView = 'table' | 'critical';
  const [activeView, setActiveView] = useQueryView<DecisionView>('table', ['table', 'critical']);
  return (
    <>
      <ViewSwitcher
        label="Visualizações das decisões"
        options={[
          { id: 'table', label: 'Tabela' },
          { id: 'critical', label: 'Prioridades' },
        ]}
        value={activeView}
        onChange={(id) => setActiveView(id as DecisionView)}
      />
      <div className="admin-view-stage">
        {activeView === 'table' && <DecisionTable rows={rows} />}
        {activeView === 'critical' && <CriticalDecisions rows={rows} />}
      </div>
    </>
  );
}

function Overview({
  data,
  rows,
  aggregateScope,
}: {
  data: AdminDashboard;
  rows: AdminDecisionRow[];
  aggregateScope: boolean;
}) {
  type OverviewView = 'adherence' | 'firms' | 'savings';
  const metrics = deriveAdminMetrics(rows);
  const financials = scopedFinancials(data, rows);
  const decisions = aggregateScope ? data.metrics.decisions : metrics.decisions;
  const adherenceRate = aggregateScope ? data.metrics.adherence_rate : metrics.adherenceRate;
  const overrides = aggregateScope ? data.metrics.overrides : metrics.overrides;
  const overrideRate = decisions > 0 ? overrides / decisions : 0;
  const usesAggregateFirms = aggregateScope && Boolean(data.firm_adherence?.length);
  const firmSummaries = usesAggregateFirms
    ? aggregateFirmSummaries(data.firm_adherence!)
    : summarizeFirms(rows);
  const [activeView, setActiveView] = useQueryView<OverviewView>('adherence', [
    'adherence',
    'firms',
    'savings',
  ]);
  return (
    <>
      <MetricGrid
        items={[
          {
            label: aggregateScope ? 'Decisões na base agregada' : 'Registros no recorte detalhado',
            value: count(decisions),
            hint: aggregateScope
              ? `${count(rows.length)} registros rastreáveis disponíveis`
              : `${percent(metrics.highConfidenceRate)} com alta confiança`,
            icon: Users,
          },
          {
            label: 'Aderência geral',
            value: percent(adherenceRate),
            hint: aggregateScope
              ? 'Indicador da base sintética completa'
              : `${percent(metrics.completeRate)} com documentação completa`,
            icon: ShieldCheck,
            accent: true,
          },
          {
            label: 'Taxa de divergência',
            value: percent(overrideRate),
            hint: `${count(overrides)} decisões fora da recomendação`,
            icon: GitBranch,
          },
          {
            label: 'Economia estimada',
            value: money(financials.estimatedSavings, true),
            hint: financials.proportionallyAllocated
              ? 'Estimativa proporcional à exposição filtrada'
              : 'Frente ao cenário-base de judicialização',
            icon: CircleDollarSign,
          },
        ]}
      />
      <ViewSwitcher
        label="Visualizações da visão geral"
        options={[
          { id: 'adherence', label: 'Quantidade de aderência' },
          { id: 'firms', label: 'Escritórios' },
          { id: 'savings', label: 'Economia' },
        ]}
        value={activeView}
        onChange={(id) => setActiveView(id as OverviewView)}
      />
      <div className="admin-view-stage">
        {activeView === 'adherence' && (
          <AdherenceHighlightsPanel decisions={decisions} overrides={overrides} />
        )}
        {activeView === 'firms' && (
          <FirmComparisonPanel
            summaries={firmSummaries}
            overallAdherence={adherenceRate}
            aggregateScope={usesAggregateFirms}
          />
        )}
        {activeView === 'savings' && (
          <SavingsFlowChart
            data={[
              { label: 'Custo sem política', value: financials.baselineCost },
              { label: 'Economia estimada', value: financials.estimatedSavings },
              { label: 'Custo com política', value: financials.projectedCost },
            ]}
          />
        )}
      </div>
      <AttentionPanel rows={rows} />
    </>
  );
}
function Adherence({
  data,
  rows,
  aggregateScope,
}: {
  data: AdminDashboard;
  rows: AdminDecisionRow[];
  aggregateScope: boolean;
}) {
  type AdherenceView = 'firms' | 'lawyers' | 'overrides';
  const target = 0.7;
  const detailedMetrics = deriveAdminMetrics(rows);
  const reasonData = aggregateScope ? data.override_reasons : createOverrideReasons(rows);
  const classifiedReasons = reasonData
    .filter((item) => item.label !== 'Sem motivo classificado')
    .reduce((total, item) => total + item.value, 0);
  const detailedFirmCount = new Set(rows.map((row) => row.firm_name)).size;
  const detailedLawyerCount = new Set(rows.map((row) => `${row.lawyer_name}::${row.firm_name}`))
    .size;
  const usesAggregateFirms = aggregateScope && Boolean(data.firm_adherence?.length);
  const usesAggregateLawyers = aggregateScope && Boolean(data.lawyer_adherence?.length);
  const firmSummaries = usesAggregateFirms
    ? aggregateFirmSummaries(data.firm_adherence!)
    : summarizeFirms(rows);
  const lawyerSummaries = usesAggregateLawyers
    ? aggregateLawyerSummaries(data.lawyer_adherence!)
    : summarizeLawyers(rows);
  const hasAggregateFirmCount =
    usesAggregateFirms || (aggregateScope && data.metrics.firm_count != null);
  const hasAggregateLawyerCount =
    usesAggregateLawyers || (aggregateScope && data.metrics.lawyer_count != null);
  const firmCount = usesAggregateFirms
    ? firmSummaries.length
    : aggregateScope
      ? (data.metrics.firm_count ?? detailedFirmCount)
      : detailedFirmCount;
  const lawyerCount = usesAggregateLawyers
    ? lawyerSummaries.length
    : aggregateScope
      ? (data.metrics.lawyer_count ?? detailedLawyerCount)
      : detailedLawyerCount;
  const metrics = aggregateScope
    ? {
        decisions: data.metrics.decisions,
        adherenceRate: data.metrics.adherence_rate,
        overrides: data.metrics.overrides,
        overrideRate: data.metrics.overrides / data.metrics.decisions,
        justificationCoverage: data.metrics.overrides
          ? classifiedReasons / data.metrics.overrides
          : 0,
      }
    : detailedMetrics;
  const [activeView, setActiveView] = useQueryView<AdherenceView>('overrides', [
    'overrides',
    'firms',
    'lawyers',
  ]);
  return (
    <>
      <MetricGrid
        items={[
          {
            label: 'Aderência geral',
            value: percent(metrics.adherenceRate),
            hint: `${count(metrics.decisions)} ${metrics.decisions === 1 ? 'decisão' : 'decisões'} no recorte`,
            icon: ShieldCheck,
            accent: true,
          },
          {
            label: 'Divergências registradas',
            value: count(metrics.overrides),
            hint: `${percent(metrics.overrideRate)} das decisões`,
            icon: GitBranch,
          },
          {
            label: aggregateScope ? 'Justificativas classificadas' : 'Justificativas informadas',
            value: count(classifiedReasons),
            hint: aggregateScope
              ? `${reasonData.length} motivos históricos no recorte`
              : `${percent(metrics.justificationCoverage)} de cobertura`,
            icon: AlertTriangle,
          },
          {
            label: 'Total de escritórios',
            value: count(firmCount),
            hint: hasAggregateFirmCount ? 'Na base agregada' : 'No recorte rastreável',
            icon: Building2,
          },
          {
            label: 'Total de advogados',
            value: count(lawyerCount),
            hint: hasAggregateLawyerCount ? 'Na base agregada' : 'No recorte rastreável',
            icon: Users,
          },
          {
            label: 'Diferença para a meta',
            value: `${metrics.adherenceRate - target >= 0 ? '+' : ''}${((metrics.adherenceRate - target) * 100).toFixed(1)} p.p.`,
            hint: `Meta operacional de ${percent(target)}`,
            icon: Target,
          },
        ]}
      />
      <ViewSwitcher
        label="Visualizações da aderência"
        options={[
          { id: 'overrides', label: 'Justificativas' },
          { id: 'firms', label: 'Escritórios' },
          { id: 'lawyers', label: 'Advogados' },
        ]}
        value={activeView}
        onChange={(id) => setActiveView(id as AdherenceView)}
      />
      <div className="admin-view-stage">
        {activeView === 'firms' && (
          <FirmComparisonPanel
            summaries={firmSummaries}
            overallAdherence={metrics.adherenceRate}
            aggregateScope={usesAggregateFirms}
          />
        )}
        {activeView === 'lawyers' && (
          <LawyerBehaviorPanel
            summaries={lawyerSummaries}
            overallAdherence={metrics.adherenceRate}
            aggregateScope={usesAggregateLawyers}
          />
        )}
        {activeView === 'overrides' && (
          <OverrideReasons
            data={reasonData}
            aggregateScope={aggregateScope}
            overrideTotal={metrics.overrides}
          />
        )}
      </div>
      <div className="admin-end-link">
        <span>
          {aggregateScope
            ? usesAggregateFirms && usesAggregateLawyers
              ? 'KPIs, justificativas e comparações por advogado e escritório usam a base agregada completa, sem corte por quantidade.'
              : 'KPIs e justificativas usam as 60.000 decisões; comparações sem agregado disponível usam os registros rastreáveis.'
            : 'Com filtros ativos, os resultados usam somente os registros rastreáveis do recorte.'}
        </span>
        <Link className="admin-text-link" to="/admin/decisions">
          Explorar decisões <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}

function AttentionPanel({ rows }: { rows: AdminDecisionRow[] }) {
  const metrics = deriveAdminMetrics(rows);
  const lowestFirm = summarizeFirms(rows).sort(
    (left, right) => left.adherenceRate - right.adherenceRate,
  )[0];
  const items = [
    metrics.overridesWithoutJustification > 0
      ? {
          title: `${count(metrics.overridesWithoutJustification)} divergências sem justificativa`,
          detail: 'Registros que exigem complementação para manter a trilha de auditoria.',
          tone: 'critical',
        }
      : null,
    metrics.highConfidenceOverrides > 0
      ? {
          title: `${count(metrics.highConfidenceOverrides)} divergências de alta confiança`,
          detail: 'Casos em que a recomendação tinha confiança igual ou superior a 80%.',
          tone: 'warning',
        }
      : null,
    lowestFirm
      ? {
          title: `${lowestFirm.name} requer atenção`,
          detail: `${percent(lowestFirm.adherenceRate)} de aderência em ${count(lowestFirm.decisions)} decisões.`,
          tone: 'neutral',
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item != null);

  return (
    <section className="admin-attention" aria-labelledby="attention-heading">
      <div className="admin-attention-heading">
        <div>
          <span className="admin-section-kicker">PRIORIZAÇÃO</span>
          <h2 id="attention-heading">Pontos de atenção</h2>
        </div>
        <span>{items.length} sinais</span>
      </div>
      <div className="admin-attention-grid">
        {items.map((item) => (
          <article className={`is-${item.tone}`} key={item.title}>
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CriticalDecisions({ rows }: { rows: AdminDecisionRow[] }) {
  const critical = rows
    .filter(
      (row) =>
        (!row.adherent && (!row.justification?.trim() || (row.confidence_score ?? 0) >= 0.8)) ||
        (row.completeness_band ?? '').toLocaleLowerCase('pt-BR') === 'baixa' ||
        (row.suggested_value != null &&
          row.realized_value != null &&
          Math.abs(row.realized_value - row.suggested_value) / Math.max(1, row.suggested_value) >=
            0.25),
    )
    .slice(0, 5);
  return (
    <section className="panel admin-panel" aria-labelledby="critical-decisions-heading">
      <div className="admin-panel-heading">
        <div>
          <span className="admin-section-kicker">TRIAGEM</span>
          <h2 id="critical-decisions-heading">Casos que pedem revisão</h2>
        </div>
        <AlertTriangle size={19} aria-hidden="true" />
      </div>
      <div className="admin-critical-list">
        {critical.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.case_number}</strong>
              <span>
                {row.lawyer_name} · {row.firm_name}
              </span>
            </div>
            <span>{!row.adherent ? 'Divergência' : 'Qualidade documental'}</span>
          </article>
        ))}
      </div>
      {!critical.length && (
        <p className="admin-chart-empty">Nenhum caso crítico no recorte atual.</p>
      )}
    </section>
  );
}

function Effectiveness({
  data,
  rows,
  aggregateScope,
}: {
  data: AdminDashboard;
  rows: AdminDecisionRow[];
  aggregateScope: boolean;
}) {
  type EffectivenessView = 'savings' | 'outcomes' | 'timeline';
  const metrics = deriveAdminMetrics(rows);
  const financials = scopedFinancials(data, rows);
  const [activeView, setActiveView] = useQueryView<EffectivenessView>('savings', [
    'savings',
    'outcomes',
    'timeline',
  ]);
  const accepted = aggregateScope ? data.metrics.settlements : metrics.accepted;
  const proposals = aggregateScope ? data.metrics.agreement_proposals : metrics.proposals;
  const acceptanceRate = aggregateScope ? data.metrics.acceptance_rate : metrics.acceptanceRate;
  const averageDiscountRate = aggregateScope
    ? data.metrics.average_offered_value > 0
      ? (data.metrics.average_offered_value - data.metrics.average_closed_value) /
        data.metrics.average_offered_value
      : 0
    : (metrics.averageDiscountRate ?? 0);
  const savingsPerAgreement = accepted ? financials.estimatedSavings / accepted : 0;
  const outcomes = aggregateScope ? data.effectiveness_outcomes : createOutcomeDistribution(rows);
  const timeline = aggregateScope ? data.effectiveness_timeline : createEffectivenessTimeline(rows);
  const savingsFlow = [
    { label: 'Custo sem política', value: financials.baselineCost },
    { label: 'Economia estimada', value: financials.estimatedSavings },
    { label: 'Custo com política', value: financials.projectedCost },
  ];
  return (
    <>
      <div className="admin-subsection-heading">
        <div>
          <span className="admin-section-kicker">RESULTADOS DA OPERAÇÃO</span>
          <h2>Da proposta à economia</h2>
        </div>
        <DemoLabel />
      </div>
      <MetricGrid
        items={[
          {
            label: 'Economia estimada',
            value: money(financials.estimatedSavings, true),
            hint: financials.proportionallyAllocated
              ? 'Rateio pela exposição de valores sugeridos'
              : 'Redução frente ao cenário-base',
            icon: CircleDollarSign,
            accent: true,
          },
          {
            label: 'Redução de custo',
            value: percent(financials.savingsRate),
            hint: 'Percentual economizado com a política',
            icon: ArrowDownLeft,
          },
          {
            label: 'Taxa de aceitação',
            value: percent(acceptanceRate),
            hint: `${count(accepted)} de ${count(proposals)} propostas`,
            icon: Handshake,
          },
          {
            label: 'Economia média por acordo',
            value: money(savingsPerAgreement, true),
            hint: `${percent(averageDiscountRate)} de desconto médio observado`,
            icon: CircleDollarSign,
          },
        ]}
      />
      <div className="admin-operational-summary">
        <Activity size={18} aria-hidden="true" />
        <span>
          A economia permanece estimativa; ROI não é calculado sem custo operacional real.
        </span>
        <strong>{money(financials.estimatedSavings, true)}</strong>
        <span className="admin-operational-scope">Cenário demonstrativo</span>
      </div>
      <ViewSwitcher
        label="Visualizações da efetividade"
        options={[
          { id: 'savings', label: 'Economia' },
          { id: 'outcomes', label: 'Resultados' },
          { id: 'timeline', label: 'Trajetória' },
        ]}
        value={activeView}
        onChange={(id) => setActiveView(id as EffectivenessView)}
      />
      <div className="admin-view-stage admin-effectiveness-stage">
        {activeView === 'savings' && <SavingsFlowChart data={savingsFlow} />}
        {activeView === 'outcomes' && <EffectivenessOutcomeChart data={outcomes} />}
        {activeView === 'timeline' && <EffectivenessTimeline data={timeline} />}
      </div>
      <div className="admin-end-link">
        <span>Os resultados individuais continuam disponiveis no registro da operacao.</span>
        <Link className="admin-text-link" to="/admin/decisions">
          Explorar decisoes <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </>
  );
}
export default function AdminPage() {
  const { section: sectionParam } = useParams<{ section?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const section: AdminSection =
    sectionParam && Object.hasOwn(sectionCopy, sectionParam)
      ? (sectionParam as AdminSection)
      : 'overview';
  const [copilotChoice, setCopilotChoice] = useState({
    pageSection: section,
    contextSection: section,
  });
  const copilotSection =
    copilotChoice.pageSection === section ? copilotChoice.contextSection : section;
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const filters = useMemo(() => readAdminFilters(searchParams), [searchParams]);
  const filteredRows = useMemo(
    () => (data ? filterAdminRows(data.decisions, filters) : []),
    [data, filters],
  );
  const updateFilters = useCallback(
    (nextFilters: AdminFilters) => {
      const nextParams = new URLSearchParams(searchParams);
      filterQueryKeys.forEach((key) => {
        const value = nextFilters[key];
        if (!value || (key === 'period' && value === 'all')) nextParams.delete(key);
        else nextParams.set(key, value);
      });
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const clearFilters = useCallback(() => updateFilters(emptyAdminFilters), [updateFilters]);
  const loadData = useCallback(() => {
    const version = ++requestVersion.current;
    return getAdminDashboard()
      .then((result) => {
        if (version === requestVersion.current) setData(result);
      })
      .catch((cause: unknown) => {
        if (version === requestVersion.current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar os dados da operação.',
          );
      })
      .finally(() => {
        if (version === requestVersion.current) setRefreshing(false);
      });
  }, []);
  const reload = useCallback(() => {
    setRefreshing(true);
    setError(null);
    return loadData();
  }, [loadData]);

  useEffect(() => {
    void loadData();
    const onDataChanged = () => {
      void reload();
    };
    window.addEventListener('policy:data-changed', onDataChanged);
    return () => {
      requestVersion.current += 1;
      window.removeEventListener('policy:data-changed', onDataChanged);
    };
  }, [loadData, reload]);

  return (
    <div className="admin-page" aria-busy={refreshing}>
      <header className="page-header admin-page-header">
        <div>
          <div className="admin-heading-eyebrow">
            <span className="eyebrow">POLICY INTELLIGENCE</span>
            <DemoLabel />
          </div>
          <h1 className="page-title">{sectionCopy[section].title}</h1>
          <p className="page-description">{sectionCopy[section].description}</p>
        </div>
        <div className="admin-header-actions">
          {data && (
            <span className="admin-period">
              <Clock3 size={14} aria-hidden="true" />
              {data.period}
            </span>
          )}
          <button
            type="button"
            className="button secondary admin-refresh"
            disabled={refreshing}
            onClick={() => {
              void reload();
            }}
          >
            <RefreshCw
              size={15}
              className={refreshing ? 'admin-spinning' : undefined}
              aria-hidden="true"
            />
            {refreshing ? 'Atualizando' : 'Atualizar'}
          </button>
        </div>
      </header>
      {!data && refreshing ? (
        <LoadingState />
      ) : !data && error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data ? (
        <>
          {error && (
            <div className="admin-refresh-error" role="alert">
              <Info size={16} aria-hidden="true" />
              <span>{error} Os últimos dados carregados continuam visíveis.</span>
              <button
                type="button"
                onClick={() => {
                  void reload();
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          <SnapshotNote
            updatedAt={data.updated_at}
            aggregateCount={data.metrics.decisions}
            detailedCount={data.decisions.length}
          />
          <GlobalFilters
            rows={data.decisions}
            filters={filters}
            onChange={updateFilters}
            onClear={clearFilters}
          />
          <div className="admin-scope-line" aria-live="polite">
            <span>
              {count(filteredRows.length)}{' '}
              {filteredRows.length === 1 ? 'registro rastreável' : 'registros rastreáveis'} no
              recorte atual
              {!hasActiveAdminFilters(filters) &&
                ` · indicadores gerais: ${count(data.metrics.decisions)} decisões simuladas`}
            </span>
            {hasActiveAdminFilters(filters) && <strong>Filtros globais ativos</strong>}
          </div>
          {section === 'overview' && (
            <Overview
              data={data}
              rows={filteredRows}
              aggregateScope={!hasActiveAdminFilters(filters)}
            />
          )}
          {section === 'adherence' && (
            <Adherence
              data={data}
              rows={filteredRows}
              aggregateScope={!hasActiveAdminFilters(filters)}
            />
          )}
          {section === 'effectiveness' && (
            <Effectiveness
              data={data}
              rows={filteredRows}
              aggregateScope={!hasActiveAdminFilters(filters)}
            />
          )}
          {section === 'decisions' && <Decisions rows={filteredRows} />}
          <PolicyCopilot
            title="Copiloto da política"
            contextLabel={`${sectionCopy[copilotSection].title} · ${count(filteredRows.length)} ${filteredRows.length === 1 ? 'decisão' : 'decisões'} no recorte detalhado`}
            sessionKey={`${section}:${data.updated_at}:${JSON.stringify(filters)}`}
            contextSelectorLabel="Dashboard ou aba analisada"
            selectedContext={copilotSection}
            contextOptions={adminCopilotContexts.map((item) => ({
              value: item,
              label: sectionCopy[item].title,
              description: sectionCopy[item].description,
            }))}
            onContextChange={(value) =>
              setCopilotChoice({
                pageSection: section,
                contextSection: value as AdminSection,
              })
            }
            suggestions={[
              'Por que a aderência caiu?',
              'Onde a política está funcionando pior?',
              'Qual escritório mais diverge?',
              'O que devemos revisar na próxima versão?',
              'SIMULAÇÃO: e se a taxa de aceite fosse 65%?',
            ]}
            notice="Comparações usam o recorte atual; KPIs e simulações usam a base agregada indicada. Cada pergunta é independente."
            onAsk={(question) => {
              const scenario = parseAdminWhatIfScenario(question);
              return policyCopilotProvider.respond({
                audience: 'ADMIN',
                question,
                context: {
                  dashboard: data,
                  rows: filteredRows,
                  rowScope: {
                    description: hasActiveAdminFilters(filters)
                      ? `Filtros ativos em ${sectionCopy[copilotSection].title}`
                      : `Amostra detalhada em ${sectionCopy[copilotSection].title}`,
                    filters: { ...filters, section: copilotSection },
                  },
                },
                ...(scenario ? { scenario } : {}),
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
