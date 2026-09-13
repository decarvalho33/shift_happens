import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileSearch,
  MapPin,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getCase, getCases, getDecision, getNegotiation, getRecommendation } from '../services/api';
import type {
  CaseDocument,
  CaseSummary,
  DecisionRecord,
  NegotiationRecord,
  RecommendationResponse,
  SourceReference,
} from '../types';
import { useAsync } from '../hooks/useAsync';
import { money, percent, shortDate } from '../lib/format';
import { defenseScore } from '../lib/defenseScore';
import { SUBSIDY_KEYS, subsidiesFromDocuments } from '../lib/riskModel';
import { markCaseAsViewed } from '../lib/caseProgress';
import { buildDecisionPoints } from '../lib/lawyerExperience';
import { Badge, ErrorState, LoadingState, Notice, Provenance } from '../components/ui';
import { DocumentsPanel, DocumentViewer, EvidencePanel } from '../components/Evidence';
import { DecisionActions, NegotiationPanel } from '../components/DecisionActions';
import PolicyCopilot from '../components/PolicyCopilot';
import { parseLawyerWhatIfScenario } from '../lib/policyCopilot';
import { policyCopilotProvider } from '../services/policyCopilot';
import '../styles/workspace.css';

function RecommendationCard({
  data,
  claimValue,
  actions,
  onViewSource,
}: {
  data: RecommendationResponse;
  claimValue: number;
  actions: ReactNode;
  onViewSource: (source: SourceReference) => void;
}) {
  const review = data.recommendation === 'REVISAR';
  const decisionPoints = buildDecisionPoints(data);
  const [showDecisionBasis, setShowDecisionBasis] = useState(false);
  const attentionPoint = decisionPoints.find((point) => point.id === 'change');
  const score = defenseScore(data.loss_probability);
  const subsidyCount = subsidiesFromDocuments(data.documents).size;
  return (
    <div className={`recommendation-card recommendation-${data.recommendation.toLowerCase()}`}>
      <div className="recommendation-primary-row">
        <div className="recommendation-identity">
          <div className="recommendation-eyebrow">
            <span>
              <Sparkles size={15} />
              RECOMENDAÇÃO DA POLÍTICA
            </span>
            <span className="rec-status-dot" />
          </div>
          <div className="recommendation-title">
            <h2>{data.recommendation}</h2>
            {review ? (
              <FileSearch size={32} />
            ) : data.recommendation === 'DEFESA' ? (
              <ShieldCheck size={32} />
            ) : (
              <Scale size={32} />
            )}
          </div>
          <p className="recommendation-subtitle">
            {review
              ? 'Revise os pontos pendentes antes de definir a estratégia.'
              : data.recommendation === 'DEFESA'
                ? 'Prosseguir com a defesa judicial, sem acordo neste momento.'
                : 'Buscar acordo dentro dos valores indicados pela política.'}
          </p>
        </div>
        <div className="recommendation-key-facts">
          <div className="defense-score-fact">
            <span>Score de defesa</span>
            {score === null ? (
              <strong>Não calculado</strong>
            ) : (
              <>
                <strong className="defense-score-value">
                  {score}
                  <small>/100</small>
                </strong>
                <div
                  className="defense-score-meter"
                  role="meter"
                  aria-label="Score de defesa"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={score}
                  aria-valuetext={`${score} de 100: 0 indica fechar acordo e 100 indica defender`}
                >
                  <i style={{ width: `${score}%` }} />
                </div>
                <small className="defense-score-scale" aria-hidden="true">
                  <em>Acordo</em>
                  <em>Defesa</em>
                </small>
                <small className="defense-score-risk">
                  Risco estimado de perda {percent(data.loss_probability)}
                </small>
                <small className="defense-score-risk">
                  Calculado com {subsidyCount} de {SUBSIDY_KEYS.length} subsídios da planilha
                </small>
              </>
            )}
          </div>
          <div>
            <span>Valor da causa</span>
            <strong>{money(claimValue)}</strong>
          </div>
          <div className="recommended-value">
            <span>Valor sugerido</span>
            <strong>{data.settlement ? money(data.settlement.target) : 'Não se aplica'}</strong>
            {data.settlement && (
              <small>
                Faixa {money(data.settlement.opening)}–{money(data.settlement.ceiling)}
              </small>
            )}
          </div>
        </div>
        <div id="decision-actions">{actions}</div>
      </div>

      <div className="decision-basis-glance">
        <div>
          <span>Motivo principal</span>
          <strong>{data.reasons[0] || 'Confira as evidências antes de decidir.'}</strong>
        </div>
        {attentionPoint && !attentionPoint.empty && (
          <div className="decision-attention-glance">
            <span>Ponto de atenção</span>
            <strong>{attentionPoint.title}</strong>
          </div>
        )}
        <button
          type="button"
          className="decision-basis-toggle"
          aria-expanded={showDecisionBasis}
          aria-controls="decision-basis-details"
          onClick={() => setShowDecisionBasis((current) => !current)}
        >
          {showDecisionBasis ? 'Ocultar análise' : 'Ver análise completa'}
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>

      {showDecisionBasis && (
        <div className="decision-brief-grid" id="decision-basis-details">
          <section className="recommendation-rationale" aria-labelledby="reasons-heading">
            <h3 id="reasons-heading">
              {data.recommendation === 'DEFESA'
                ? 'Fundamentos para a defesa'
                : data.recommendation === 'ACORDO'
                  ? 'Por que buscar acordo'
                  : 'Por que revisar antes de decidir'}
            </h3>
            {data.reasons.slice(0, 3).map((reason) => (
              <p key={reason}>
                <Check size={16} />
                <span>{reason}</span>
              </p>
            ))}
          </section>
          <section className="decision-points" aria-labelledby="decision-points-heading">
            <h3 id="decision-points-heading">3 pontos antes de decidir</h3>
            <div className="decision-points-list">
              {decisionPoints.map((point) => (
                <article className={`decision-point point-${point.id}`} key={point.id}>
                  <div>
                    <span>{point.label}</span>
                    <small>{point.context}</small>
                  </div>
                  <strong>{point.title}</strong>
                  {point.detail && <p>{point.detail}</p>}
                  {point.source ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onViewSource(point.source!)}
                        aria-label={`Abrir fonte de ${point.label}: ${point.source.document_name}, página ${point.source.page}`}
                      >
                        {point.source.document_name} · página {point.source.page}
                      </button>
                      <small className="decision-point-origin">{point.source.origin}</small>
                    </>
                  ) : (
                    <small className="decision-point-no-source">
                      {point.empty
                        ? 'Sem informação adicional no caso'
                        : 'Fonte ainda não disponível'}
                    </small>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function nextActionCopy(
  recommendation: RecommendationResponse,
  decision: DecisionRecord | null,
  negotiation: NegotiationRecord | null,
) {
  if (!decision)
    return recommendation.recommendation === 'REVISAR'
      ? 'Confira o ponto pendente. Depois, siga a recomendação de revisão ou divirja.'
      : 'Confira o motivo principal e escolha Seguir recomendação ou Divergir.';
  if (decision.decision === 'ACORDO' && !negotiation) {
    return 'Decisão salva. Registre agora a proposta de acordo.';
  }
  if (
    decision.decision === 'ACORDO' &&
    negotiation &&
    (negotiation.status === 'PENDENTE' || negotiation.status === 'CONTRAPROPOSTA')
  ) {
    return 'Atualize o resultado da negociação para concluir o caso.';
  }
  if (decision.decision === 'ACORDO')
    return 'Caso concluído. O resultado da negociação foi registrado.';
  return 'Decisão registrada. Este caso não exige outra ação agora.';
}

export default function WorkspacePage() {
  const { caseId = '' } = useParams();
  const location = useLocation();
  const listLabels = {
    '/minha-fila': 'Para analisar',
    '/em-andamento': 'Em andamento',
    '/finalizados': 'Finalizados',
  } as const;
  const requestedList =
    location.state?.caseList === '/processos' ? '/finalizados' : location.state?.caseList;
  const returnTo =
    typeof requestedList === 'string' && requestedList in listLabels
      ? (requestedList as keyof typeof listLabels)
      : '/minha-fila';
  const returnLabel = listLabels[returnTo];
  const [copilotCaseChoice, setCopilotCaseChoice] = useState({ routeCaseId: caseId, caseId });
  const copilotCaseId =
    copilotCaseChoice.routeCaseId === caseId ? copilotCaseChoice.caseId : caseId;
  const loader = useCallback(async () => {
    const [caseDetail, recommendation, decision, negotiation, cases] = await Promise.all([
      getCase(caseId),
      getRecommendation(caseId),
      getDecision(caseId),
      getNegotiation(caseId),
      getCases(),
    ]);
    return { caseDetail, recommendation, decision, negotiation, cases };
  }, [caseId]);
  const { data, loading, error, reload } = useAsync(loader);
  const [viewer, setViewer] = useState<{ document: CaseDocument; page: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'evidences' | 'documents' | 'details'>(
    location.state?.focusAction === 'missing-evidence' ? 'evidences' : 'summary',
  );
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success');
  useEffect(() => {
    const resetFeedback = (event: Event) => {
      if ((event as CustomEvent).detail?.action === 'reset') {
        setMessage('');
        setViewer(null);
      }
    };
    window.addEventListener('policy:data-changed', resetFeedback);
    return () => window.removeEventListener('policy:data-changed', resetFeedback);
  }, []);
  useEffect(() => {
    if (data?.caseDetail.case_id) markCaseAsViewed(data.caseDetail.case_id);
  }, [data?.caseDetail.case_id]);
  if (loading && !data) return <LoadingState />;
  if (error)
    return (
      <>
        <Link className="back-link" to={returnTo}>
          <ArrowLeft size={14} />
          Voltar para {returnLabel.toLocaleLowerCase('pt-BR')}
        </Link>
        <ErrorState message={error} onRetry={reload} />
      </>
    );
  if (!data) return null;
  const { caseDetail, recommendation, decision, negotiation, cases } = data;
  const lawyerCases = cases.filter((item) => item.assigned_to_me);
  const activeCopilotCaseId = lawyerCases.some((item) => item.case_id === copilotCaseId)
    ? copilotCaseId
    : caseDetail.case_id;
  const activeCopilotCase =
    lawyerCases.find((item) => item.case_id === activeCopilotCaseId) ?? caseDetail;
  const copilotSuggestions = [
    'Por que esta recomendação foi indicada?',
    'Quais são os 3 pontos mais importantes?',
    'O que favorece a defesa?',
    'O que ainda preciso confirmar?',
  ];
  function viewSource(source: SourceReference) {
    const document = recommendation.documents.find((item) => item.id === source.document_id);
    if (document && document.status !== 'AUSENTE') setViewer({ document, page: source.page });
    else {
      setMessageTone('warning');
      setMessage('O documento desta fonte ainda não está disponível no acervo.');
    }
  }
  async function viewCopilotSource(source: SourceReference) {
    if (activeCopilotCaseId === caseDetail.case_id) {
      viewSource(source);
      return;
    }
    try {
      const selectedRecommendation = await getRecommendation(activeCopilotCaseId);
      const document = selectedRecommendation.documents.find(
        (item) => item.id === source.document_id,
      );
      if (document && document.status !== 'AUSENTE') setViewer({ document, page: source.page });
      else {
        setMessageTone('warning');
        setMessage('O documento desta fonte ainda não está disponível no acervo.');
      }
    } catch {
      setMessageTone('warning');
      setMessage('Não foi possível abrir a fonte do caso selecionado.');
    }
  }
  function saved(text: string) {
    setMessageTone('success');
    setMessage(text);
    reload();
  }
  return (
    <div className="workspace-page page-enter" key={caseId}>
      <header className="workspace-header">
        <div className="workspace-topline">
          <Link className="back-link" to={returnTo}>
            <ArrowLeft size={14} />
            {returnLabel}
          </Link>
          <span className="workspace-case-reference">{caseDetail.case_number}</span>
          <div className="workspace-header-badges">
            <Badge value={caseDetail.status} />
          </div>
        </div>
        <div className="workspace-title-row">
          <div>
            <div className="eyebrow">Análise do processo</div>
            <h1>{caseDetail.plaintiff}</h1>
            <div className="workspace-meta">
              <span>
                <MapPin size={12} />
                {caseDetail.city} / {caseDetail.uf}
              </span>
              <span className="meta-separator" />
              <span>
                Valor da causa <strong>{money(caseDetail.claim_value)}</strong>
              </span>
              <span className="meta-separator" />
              <Badge value={caseDetail.risk_level} />
            </div>
          </div>
        </div>
      </header>
      {message && (
        <div className="workspace-feedback">
          <Notice tone={messageTone}>{message}</Notice>
          <button
            className="icon-button"
            onClick={() => setMessage('')}
            aria-label="Dispensar mensagem"
          >
            ×
          </button>
        </div>
      )}
      <section className="workspace-next-action" aria-label="Próxima ação">
        <span>PRÓXIMA AÇÃO</span>
        <strong>{nextActionCopy(recommendation, decision, negotiation)}</strong>
      </section>
      <nav className="workspace-content-tabs" aria-label="Conteúdo do processo" role="tablist">
        <button
          id="workspace-tab-summary"
          role="tab"
          aria-selected={activeTab === 'summary'}
          aria-controls="workspace-panel-summary"
          className={activeTab === 'summary' ? 'active' : ''}
          onClick={() => setActiveTab('summary')}
        >
          Resumo
        </button>
        <button
          id="workspace-tab-evidences"
          role="tab"
          aria-selected={activeTab === 'evidences'}
          aria-controls="workspace-panel-evidences"
          className={activeTab === 'evidences' ? 'active' : ''}
          onClick={() => setActiveTab('evidences')}
        >
          Evidências
          <span className="workspace-tab-count">{recommendation.evidence.length}</span>
        </button>
        <button
          id="workspace-tab-documents"
          role="tab"
          aria-selected={activeTab === 'documents'}
          aria-controls="workspace-panel-documents"
          className={activeTab === 'documents' ? 'active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          Documentos
          <span className="workspace-tab-count">{recommendation.documents.length}</span>
        </button>
        <button
          id="workspace-tab-details"
          role="tab"
          aria-selected={activeTab === 'details'}
          aria-controls="workspace-panel-details"
          className={activeTab === 'details' ? 'active' : ''}
          onClick={() => setActiveTab('details')}
        >
          Detalhes
        </button>
      </nav>
      <section
        className={`workspace-tab-content workspace-view-${activeTab}`}
        id={`workspace-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`workspace-tab-${activeTab}`}
      >
        {activeTab === 'summary' && (
          <div className="workspace-decision-overview">
            <aside className="workspace-recommendation" aria-label="Recomendação e decisão">
              <section className="panel decision-panel">
                <RecommendationCard
                  data={recommendation}
                  claimValue={caseDetail.claim_value}
                  onViewSource={viewSource}
                  actions={
                    <DecisionActions
                      key={`${caseId}-${decision?.id || 'pending'}`}
                      recommendation={recommendation}
                      decision={decision}
                      negotiation={negotiation}
                      onSaved={saved}
                    />
                  }
                />
              </section>
              {decision?.decision === 'ACORDO' && (
                <div id="negotiation-panel">
                  <NegotiationPanel
                    key={caseId}
                    recommendation={recommendation}
                    negotiation={negotiation}
                    onSaved={saved}
                  />
                </div>
              )}
            </aside>
          </div>
        )}
        {activeTab === 'evidences' && (
          <EvidencePanel key={caseId} recommendation={recommendation} onViewSource={viewSource} />
        )}
        {activeTab === 'documents' && (
          <DocumentsPanel
            documents={recommendation.documents}
            onOpen={(document, page = 1) => setViewer({ document, page })}
          />
        )}
        {activeTab === 'details' && (
          <section className="panel case-details-panel">
            <div className="panel-heading">
              <h2>Detalhes do processo</h2>
              {recommendation.demo_data && <Badge value="DEMO" />}
            </div>
            <div className="case-details-body">
              <div className="case-summary-detail">
                <span>Assunto</span>
                <h3>{caseDetail.subject}</h3>
                <p>{caseDetail.summary}</p>
              </div>
              <dl className="cost-summary">
                {recommendation.expected_condemnation !== null && (
                  <div>
                    <dt>Condenação esperada</dt>
                    <dd>{money(recommendation.expected_condemnation)}</dd>
                  </div>
                )}
                {recommendation.expected_defense_cost !== null && (
                  <div>
                    <dt>Custo esperado da defesa</dt>
                    <dd>{money(recommendation.expected_defense_cost)}</dd>
                  </div>
                )}
                {recommendation.confidence_score !== undefined && (
                  <div>
                    <dt>Confianca da recomendacao</dt>
                    <dd>{percent(recommendation.confidence_score)}</dd>
                  </div>
                )}
                {recommendation.subsidy_count !== undefined && (
                  <div>
                    <dt>Subsidios considerados</dt>
                    <dd>
                      {recommendation.subsidy_count}
                      {recommendation.critical_subsidy_count !== undefined
                        ? ` (${recommendation.critical_subsidy_count} criticos)`
                        : ''}
                    </dd>
                  </div>
                )}
                {recommendation.completeness_band && (
                  <div>
                    <dt>Completude documental</dt>
                    <dd>{recommendation.completeness_band}</dd>
                  </div>
                )}
                {caseDetail.lawyer_profile_label && (
                  <div>
                    <dt>Perfil sintetico</dt>
                    <dd>{caseDetail.lawyer_profile_label}</dd>
                  </div>
                )}
              </dl>
              <div className="recommendation-provenance">
                <Provenance
                  policy={recommendation.policy_version}
                  model={recommendation.model_version}
                />
              </div>
              {caseDetail.lawyer_profile_description && (
                <div className="decision-authority">
                  <ShieldCheck size={16} />
                  <p>
                    Perfil comportamental da demo:{' '}
                    <strong>{caseDetail.lawyer_profile_label}</strong>.{' '}
                    {caseDetail.lawyer_profile_description}
                  </p>
                </div>
              )}
              <div className="decision-authority">
                <ShieldCheck size={16} />
                <p>
                  A política orienta. <strong>O advogado decide.</strong>
                </p>
              </div>
              <span className="details-updated">
                Análise recebida em {shortDate(recommendation.generated_at)}
              </span>
            </div>
          </section>
        )}
      </section>
      {viewer && (
        <DocumentViewer
          key={`${viewer.document.id}-${viewer.page}`}
          document={viewer.document}
          initialPage={viewer.page}
          onClose={() => setViewer(null)}
        />
      )}
      <PolicyCopilot
        title="Copiloto deste caso"
        contextLabel={`${activeCopilotCase.case_number} · ${activeCopilotCase.plaintiff}`}
        sessionKey={`${caseDetail.case_id}:${decision?.id ?? 'sem-decisao'}:${negotiation?.updated_at ?? 'sem-negociacao'}`}
        contextSelectorLabel="Caso analisado pelo copiloto"
        selectedContext={activeCopilotCaseId}
        contextOptions={lawyerCases.map((item: CaseSummary) => ({
          value: item.case_id,
          label: `${item.case_number} — ${item.plaintiff}`,
          description: `${item.city}/${item.uf} · ${item.recommendation}`,
        }))}
        onContextChange={(value) => setCopilotCaseChoice({ routeCaseId: caseId, caseId: value })}
        suggestions={copilotSuggestions}
        notice="O copiloto explica os dados disponíveis; a decisão continua sendo sua. Cada pergunta é analisada de forma independente."
        onAsk={async (question) => {
          const selectedContext =
            activeCopilotCaseId === caseDetail.case_id
              ? { caseDetail, recommendation, decision, negotiation }
              : await Promise.all([
                  getCase(activeCopilotCaseId),
                  getRecommendation(activeCopilotCaseId),
                  getDecision(activeCopilotCaseId),
                  getNegotiation(activeCopilotCaseId),
                ]).then(
                  ([
                    selectedCaseDetail,
                    selectedRecommendation,
                    selectedDecision,
                    selectedNegotiation,
                  ]) => ({
                    caseDetail: selectedCaseDetail,
                    recommendation: selectedRecommendation,
                    decision: selectedDecision,
                    negotiation: selectedNegotiation,
                  }),
                );
          const scenario = parseLawyerWhatIfScenario(question);
          return policyCopilotProvider.respond({
            audience: 'LAWYER',
            question,
            context: selectedContext,
            ...(scenario ? { scenario } : {}),
          });
        }}
        onOpenCitation={(citation) =>
          void viewCopilotSource({
            document_id: citation.documentId,
            document_name: citation.documentName,
            page: citation.page,
            origin: citation.origin,
            ...(citation.excerpt ? { excerpt: citation.excerpt } : {}),
          })
        }
      />
    </div>
  );
}
