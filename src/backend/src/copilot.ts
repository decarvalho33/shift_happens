import {
  DEMO_POLICY_VERSION,
  demoAdminDashboard,
  demoCases,
  demoDecisions,
  demoNegotiations,
  demoRecommendations,
} from '../../frontend/src/mocks/behavioralFixtures.ts';
import type {
  AdminDecisionRow,
  CaseDetail,
  RecommendationResponse,
  SourceReference,
} from '../../frontend/src/types/index.ts';
import type {
  CopilotBasis,
  CopilotCalculation,
  CopilotCitation,
  CopilotFact,
  PolicyCopilotResponse,
  ResolvedCopilotIntent,
} from '../../frontend/src/lib/policyCopilot.types.ts';
import { HttpError } from './errors.ts';
import type { AnswerGenerator, ModelInput } from './model.ts';

type Audience = 'LAWYER' | 'ADMIN';
type Scalar = string | number | boolean;
type Scenario =
  | { type: 'PROPOSAL_VALUE'; proposalValue: number }
  | { type: 'ACCEPTANCE_RATE'; acceptanceRate: number }
  | { type: 'ADHERENCE_RATE'; adherenceRate: number };

interface RemotePayload {
  question: string;
  context_ref: string;
  intent?: string;
  case_id?: string;
  scope?: { filters: Record<string, Scalar> };
  scenario?: Scenario;
}

interface CitationCandidate {
  source: SourceReference;
  claim: string;
}

interface PreparedRequest {
  payload: RemotePayload;
  intent: ResolvedCopilotIntent;
  mode: 'FACTUAL' | 'SIMULATION';
  context: unknown;
  facts: CopilotFact[];
  basis: CopilotBasis[];
  calculations: CopilotCalculation[];
  assumptions: string[];
  citationCandidates: CitationCandidate[];
  provenance: PolicyCopilotResponse['provenance'];
}

const lawyerIntents = new Set([
  'CASE_SUMMARY', 'RECOMMENDATION', 'EVIDENCE', 'DECISION_POINTS', 'AGREEMENT_FACTORS',
  'DEFENSE_FACTORS', 'MISSING_EVIDENCE', 'NEXT_ACTION', 'SETTLEMENT_RANGE', 'NEGOTIATION',
  'STATUS', 'WHAT_IF',
]);
const adminIntents = new Set([
  'OVERVIEW', 'ADHERENCE', 'EFFECTIVENESS', 'DECISION', 'SEGMENTS', 'OVERRIDE_REASONS',
  'REVIEW', 'TREND', 'POLICY_METADATA', 'WHAT_IF',
]);

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percentage = new Intl.NumberFormat('pt-BR', {
  style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseScenario(value: unknown, audience: Audience): Scenario | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || typeof value.type !== 'string')
    throw new HttpError(400, 'INVALID_SCENARIO', 'A simulação informada é inválida.');
  if (
    audience === 'LAWYER' && value.type === 'PROPOSAL_VALUE' &&
    typeof value.proposalValue === 'number' && Number.isFinite(value.proposalValue) && value.proposalValue > 0
  ) return { type: 'PROPOSAL_VALUE', proposalValue: value.proposalValue };
  if (
    audience === 'ADMIN' && value.type === 'ACCEPTANCE_RATE' &&
    typeof value.acceptanceRate === 'number' && value.acceptanceRate >= 0 && value.acceptanceRate <= 1
  ) return { type: 'ACCEPTANCE_RATE', acceptanceRate: value.acceptanceRate };
  if (
    audience === 'ADMIN' && value.type === 'ADHERENCE_RATE' &&
    typeof value.adherenceRate === 'number' && value.adherenceRate >= 0 && value.adherenceRate <= 1
  ) return { type: 'ADHERENCE_RATE', adherenceRate: value.adherenceRate };
  throw new HttpError(400, 'INVALID_SCENARIO', 'A simulação informada é inválida para este perfil.');
}

function parsePayload(value: unknown, audience: Audience): RemotePayload {
  if (!isObject(value)) throw new HttpError(400, 'INVALID_REQUEST', 'Envie um objeto JSON válido.');
  const question = typeof value.question === 'string' ? value.question.trim() : '';
  if (!question) throw new HttpError(400, 'INVALID_QUESTION', 'Escreva uma pergunta para o copiloto.');
  if (question.length > 4_000)
    throw new HttpError(400, 'INVALID_QUESTION', 'A pergunta deve ter no máximo 4.000 caracteres.');
  const contextRef = typeof value.context_ref === 'string' ? value.context_ref.trim() : '';
  if (!contextRef) throw new HttpError(400, 'INVALID_CONTEXT', 'O contexto da consulta não foi informado.');
  const intent = typeof value.intent === 'string' ? value.intent : undefined;
  const allowed = audience === 'LAWYER' ? lawyerIntents : adminIntents;
  if (intent && !allowed.has(intent))
    throw new HttpError(400, 'INVALID_INTENT', 'A intenção não é válida para este perfil.');
  const caseId = typeof value.case_id === 'string' ? value.case_id.trim() : undefined;
  if (audience === 'LAWYER' && !caseId)
    throw new HttpError(400, 'INVALID_CASE', 'Informe o processo desta consulta.');
  if (audience === 'LAWYER' && contextRef !== `case:${caseId}`)
    throw new HttpError(400, 'CONTEXT_MISMATCH', 'O processo e o contexto não coincidem.');
  if (audience === 'ADMIN' && !/^scope:[a-f0-9]{8}$/.test(contextRef))
    throw new HttpError(400, 'INVALID_CONTEXT', 'O recorte administrativo é inválido.');
  const scenario = parseScenario(value.scenario, audience);
  if (intent === 'WHAT_IF' && !scenario)
    throw new HttpError(400, 'INVALID_SCENARIO', 'A simulação precisa de uma hipótese válida.');

  const filters: Record<string, Scalar> = {};
  if (isObject(value.scope) && isObject(value.scope.filters)) {
    for (const [key, filterValue] of Object.entries(value.scope.filters)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) continue;
      if (['string', 'number', 'boolean'].includes(typeof filterValue))
        filters[key] = filterValue as Scalar;
    }
  }
  return {
    question, context_ref: contextRef,
    ...(intent ? { intent } : {}), ...(caseId ? { case_id: caseId } : {}),
    ...(Object.keys(filters).length ? { scope: { filters } } : {}),
    ...(scenario ? { scenario } : {}),
  };
}

function lawyerIntent(payload: RemotePayload): ResolvedCopilotIntent {
  if (payload.scenario) return 'WHAT_IF';
  if (payload.intent) return payload.intent as ResolvedCopilotIntent;
  const q = normalize(payload.question);
  if (q.includes('3 pontos') || q.includes('tres pontos')) return 'DECISION_POINTS';
  if (q.includes('favorece') && q.includes('defesa') && q.includes('acordo')) return 'DECISION_POINTS';
  if (q.includes('favorece') && q.includes('defesa')) return 'DEFENSE_FACTORS';
  if (q.includes('favorece') && q.includes('acordo')) return 'AGREEMENT_FACTORS';
  if (/falta|pendente|ausente|lacuna/.test(q)) return 'MISSING_EVIDENCE';
  if (/proxim[oa] (acao|passo)|o que (faco|fazer) agora/.test(q)) return 'NEXT_ACTION';
  if (/faixa|abertura|teto|valor (sugerido|recomendado)/.test(q)) return 'SETTLEMENT_RANGE';
  if (/resum|fatos|o que aconteceu|dados do processo/.test(q)) return 'CASE_SUMMARY';
  if (/evidencia|documento|prova|fonte|contradicao|pagina/.test(q)) return 'EVIDENCE';
  if (/proposta|negociacao|contraproposta|valor|alvo/.test(q)) return 'NEGOTIATION';
  if (/status|situacao|andamento/.test(q)) return 'STATUS';
  return 'RECOMMENDATION';
}

function adminIntent(payload: RemotePayload): ResolvedCopilotIntent {
  if (payload.scenario) return 'WHAT_IF';
  if (payload.intent) return payload.intent as ResolvedCopilotIntent;
  const q = normalize(payload.question);
  if (/versao|modelo usado|politica vigente/.test(q)) return 'POLICY_METADATA';
  if (/aderencia/.test(q) && /caiu|subiu|evolucao|tendencia|historico/.test(q)) return 'TREND';
  if (/motivo|razao|causa/.test(q) && /override|divergencia|desvio/.test(q)) return 'OVERRIDE_REASONS';
  if (/revisar|revisao|priorizar|prioridade|atencao/.test(q)) return 'REVIEW';
  if (/escritorio|firma|advogad|uf|estado|perfil|segmento|mais diverge/.test(q)) return 'SEGMENTS';
  if (/aderencia|override|divergencia|desvio/.test(q)) return 'ADHERENCE';
  if (/efetividade|economia|aceite|proposta|recus|contrapropost|acordo|custo|valor/.test(q)) return 'EFFECTIVENESS';
  if (payload.case_id || /este processo|este caso/.test(q)) return 'DECISION';
  return 'OVERVIEW';
}

function fact(
  key: string, label: string, value: CopilotFact['value'], formattedValue: string,
  source: CopilotFact['source'],
): CopilotFact { return { key, label, value, formattedValue, source }; }

function lawyerFacts(caseDetail: CaseDetail, recommendation: RecommendationResponse): CopilotFact[] {
  return [
    fact('case_number', 'Processo', caseDetail.case_number, caseDetail.case_number, 'CASE_DETAIL'),
    fact('claim_value', 'Valor da causa', caseDetail.claim_value, currency.format(caseDetail.claim_value), 'CASE_DETAIL'),
    fact('recommendation', 'Recomendação', recommendation.recommendation, recommendation.recommendation, 'RECOMMENDATION'),
    fact('loss_probability', 'Risco de perda', recommendation.loss_probability,
      recommendation.loss_probability === null ? 'Não calculado' : percentage.format(recommendation.loss_probability),
      'RECOMMENDATION'),
  ];
}

function buildCitationCandidates(recommendation: RecommendationResponse): CitationCandidate[] {
  const documents = new Map(recommendation.documents.map((document) => [document.id, document]));
  const candidates: CitationCandidate[] = recommendation.evidence.map((item) => ({
    source: item.source, claim: item.title,
  }));
  for (const item of recommendation.contradictions) {
    candidates.push(
      { source: item.allegation.source, claim: `${item.title}: alegação` },
      { source: item.documentary_fact.source, claim: `${item.title}: fato documental` },
    );
  }
  const seen = new Set<string>();
  return candidates.filter(({ source }) => {
    const document = documents.get(source.document_id);
    const key = `${source.document_id}:${source.page}:${source.origin}`;
    if (seen.has(key) || !document || document.status === 'AUSENTE' ||
      document.name !== source.document_name || source.page < 1 || source.page > document.page_count) return false;
    seen.add(key);
    return true;
  });
}

function lawyerCalculation(scenario: Scenario | undefined, caseDetail: CaseDetail, recommendation: RecommendationResponse) {
  if (!scenario || scenario.type !== 'PROPOSAL_VALUE') return { calculations: [], assumptions: [] };
  const assumptions = [
    'A proposta informada é uma hipótese, não um valor oferecido ou aceito.',
    'A recomendação e os demais dados permanecem constantes na simulação.',
  ];
  if (recommendation.settlement) {
    const result = scenario.proposalValue - recommendation.settlement.target;
    return { calculations: [{
      key: 'proposal_vs_target', label: 'Diferença para o valor-alvo',
      formula: 'proposta simulada - valor-alvo',
      inputs: [
        { label: 'Proposta simulada', value: scenario.proposalValue },
        { label: 'Valor-alvo', value: recommendation.settlement.target },
      ], result, formattedResult: currency.format(result),
    }], assumptions } satisfies { calculations: CopilotCalculation[]; assumptions: string[] };
  }
  const result = scenario.proposalValue / caseDetail.claim_value;
  return { calculations: [{
    key: 'proposal_share_of_claim', label: 'Proposta sobre o valor da causa',
    formula: 'proposta simulada ÷ valor da causa',
    inputs: [
      { label: 'Proposta simulada', value: scenario.proposalValue },
      { label: 'Valor da causa', value: caseDetail.claim_value },
    ], result, formattedResult: percentage.format(result),
  }], assumptions } satisfies { calculations: CopilotCalculation[]; assumptions: string[] };
}

function matchesFilters(row: AdminDecisionRow, filters: Record<string, Scalar>): boolean {
  const values: Record<string, string | undefined> = {
    firm: row.firm_name, lawyer: row.lawyer_name, uf: row.uf, recommendation: row.recommendation,
    confidence: row.confidence_band ?? undefined, completeness: row.completeness_band ?? undefined,
  };
  for (const [key, rowValue] of Object.entries(values)) {
    const filter = filters[key];
    if (typeof filter === 'string' && filter && filter !== rowValue) return false;
  }
  const days = Number(filters.period);
  if (Number.isFinite(days) && days > 0) {
    const end = Date.parse(demoAdminDashboard.updated_at);
    const created = Date.parse(row.created_at);
    if (Number.isFinite(end) && Number.isFinite(created) && created < end - days * 86_400_000) return false;
  }
  return true;
}

function adminCalculation(scenario: Scenario | undefined) {
  if (!scenario) return { calculations: [], assumptions: [] };
  const isAcceptance = scenario.type === 'ACCEPTANCE_RATE';
  if (!isAcceptance && scenario.type !== 'ADHERENCE_RATE') return { calculations: [], assumptions: [] };
  const base = isAcceptance ? demoAdminDashboard.metrics.agreement_proposals : demoAdminDashboard.metrics.decisions;
  const rate = isAcceptance ? scenario.acceptanceRate : scenario.adherenceRate;
  const result = base * rate;
  return {
    calculations: [{
      key: isAcceptance ? 'accepted_proposals_simulated' : 'adherent_decisions_simulated',
      label: isAcceptance ? 'Propostas aceitas na hipótese' : 'Decisões aderentes na hipótese',
      formula: isAcceptance ? 'propostas de acordo × taxa de aceite simulada' : 'decisões × taxa de aderência simulada',
      inputs: [{ label: isAcceptance ? 'Propostas de acordo' : 'Decisões', value: base }, { label: 'Taxa simulada', value: rate }],
      result, formattedResult: number.format(result),
    }],
    assumptions: ['A taxa é uma hipótese e não altera os dados registrados.', 'O volume-base permanece constante.'],
  } satisfies { calculations: CopilotCalculation[]; assumptions: string[] };
}

function prepareLawyer(payload: RemotePayload, model: string): PreparedRequest {
  const caseDetail = demoCases.find((item) => item.case_id === payload.case_id);
  if (!caseDetail) throw new HttpError(404, 'CASE_NOT_FOUND', 'O processo informado não foi encontrado.');
  if (!caseDetail.assigned_to_me)
    throw new HttpError(403, 'CASE_NOT_ASSIGNED', 'Este processo não está atribuído ao perfil atual.');
  const recommendation = demoRecommendations[caseDetail.case_id];
  const decision = demoDecisions.find((item) => item.case_id === caseDetail.case_id) ?? null;
  const negotiation = demoNegotiations.find((item) => item.case_id === caseDetail.case_id) ?? null;
  const { calculations, assumptions } = lawyerCalculation(payload.scenario, caseDetail, recommendation);
  return {
    payload, intent: lawyerIntent(payload), mode: payload.scenario ? 'SIMULATION' : 'FACTUAL',
    context: {
      case: {
        id: caseDetail.case_id, number: caseDetail.case_number, plaintiff: caseDetail.plaintiff,
        city: caseDetail.city, uf: caseDetail.uf, claimValue: caseDetail.claim_value,
        status: caseDetail.status, subject: caseDetail.subject, summary: caseDetail.summary,
      },
      recommendation: {
        decision: recommendation.recommendation, lossProbability: recommendation.loss_probability,
        expectedCondemnation: recommendation.expected_condemnation,
        expectedDefenseCost: recommendation.expected_defense_cost, settlement: recommendation.settlement,
        reasons: recommendation.reasons,
        evidence: recommendation.evidence.map(({ kind, title, description }) => ({ kind, title, description })),
        contradictions: recommendation.contradictions.map(({ title, description, allegation, documentary_fact }) => ({
          title, description, allegation: allegation.text, documentaryFact: documentary_fact.text,
        })),
        missingEvidence: recommendation.missing_evidence, nextBestEvidence: recommendation.next_best_evidence,
        confidence: recommendation.confidence_score, confidenceBand: recommendation.confidence_band,
        completenessBand: recommendation.completeness_band,
      },
      documents: recommendation.documents.map(({ id, name, category, status, page_count, description }) => ({
        id, name, category, status, pageCount: page_count, description,
      })),
      recordedDecision: decision, negotiation,
    },
    facts: lawyerFacts(caseDetail, recommendation),
    basis: [
      { source: 'CASE_DETAIL', description: `Processo ${caseDetail.case_number}`, recordCount: 1 },
      { source: 'RECOMMENDATION', description: 'Recomendação e evidências do caso', recordCount: 1 },
    ],
    calculations, assumptions, citationCandidates: buildCitationCandidates(recommendation),
    provenance: {
      engine: 'remote-policy-copilot', version: 'openai-backend-v1.0',
      dataMode: recommendation.demo_data ? 'DEMONSTRATION' : 'OPERATIONAL', contextRef: payload.context_ref,
      policyVersion: recommendation.policy_version, modelVersion: model, dataUpdatedAt: recommendation.generated_at,
    },
  };
}

function prepareAdmin(payload: RemotePayload, model: string): PreparedRequest {
  const filters = payload.scope?.filters ?? {};
  const rows = demoAdminDashboard.decisions.filter((row) => matchesFilters(row, filters));
  const selectedRow = payload.case_id
    ? demoAdminDashboard.decisions.find((row) => row.case_id === payload.case_id) ?? null : null;
  const { calculations, assumptions } = adminCalculation(payload.scenario);
  const metrics = demoAdminDashboard.metrics;
  return {
    payload, intent: adminIntent(payload), mode: payload.scenario ? 'SIMULATION' : 'FACTUAL',
    context: {
      period: demoAdminDashboard.period, filters, metrics,
      distribution: demoAdminDashboard.distribution, evolution: demoAdminDashboard.evolution,
      overrideReasons: demoAdminDashboard.override_reasons,
      effectivenessOutcomes: demoAdminDashboard.effectiveness_outcomes,
      detailedRows: rows, selectedRow,
    },
    facts: [
      fact('decisions', 'Decisões', metrics.decisions, number.format(metrics.decisions), 'DASHBOARD_METRICS'),
      fact('adherence_rate', 'Aderência', metrics.adherence_rate, percentage.format(metrics.adherence_rate), 'DASHBOARD_METRICS'),
      fact('acceptance_rate', 'Taxa de aceite', metrics.acceptance_rate, percentage.format(metrics.acceptance_rate), 'DASHBOARD_METRICS'),
      fact('scoped_rows', 'Registros no recorte', rows.length, number.format(rows.length), 'ADMIN_DECISION_ROW'),
    ],
    basis: [
      { source: 'DASHBOARD_METRICS', description: demoAdminDashboard.period, recordCount: metrics.decisions },
      { source: 'ADMIN_DECISION_ROW', description: 'Registros detalhados após os filtros', recordCount: rows.length },
    ],
    calculations, assumptions, citationCandidates: [],
    provenance: {
      engine: 'remote-policy-copilot', version: 'openai-backend-v1.0',
      dataMode: demoAdminDashboard.demo_data ? 'DEMONSTRATION' : 'OPERATIONAL',
      contextRef: payload.context_ref, period: demoAdminDashboard.period,
      policyVersion: DEMO_POLICY_VERSION, modelVersion: model,
      dashboardUpdatedAt: demoAdminDashboard.updated_at,
    },
  };
}

function buildCitations(indexes: number[], candidates: CitationCandidate[]): CopilotCitation[] {
  return indexes.map((index) => candidates[index - 1]).filter((candidate): candidate is CitationCandidate => Boolean(candidate))
    .map(({ source, claim }, index) => ({
      marker: `[${index + 1}]`, documentId: source.document_id, documentName: source.document_name,
      page: source.page, origin: source.origin, ...(source.excerpt ? { excerpt: source.excerpt } : {}), claims: [claim],
    }));
}

export async function answerCopilot(
  audience: Audience, rawPayload: unknown, generate: AnswerGenerator, model: string,
): Promise<PolicyCopilotResponse> {
  const payload = parsePayload(rawPayload, audience);
  const prepared = audience === 'LAWYER' ? prepareLawyer(payload, model) : prepareAdmin(payload, model);
  const modelInput: ModelInput = {
    audience, intent: prepared.intent, question: payload.question, mode: prepared.mode,
    context: prepared.context, calculations: prepared.calculations,
    citationCandidates: prepared.citationCandidates.map(({ source, claim }, index) => ({
      index: index + 1, documentId: source.document_id, documentName: source.document_name,
      page: source.page, origin: source.origin, excerpt: source.excerpt, claim,
    })),
  };
  const generated = await generate(modelInput);
  const status = generated.available ? 'ANSWERED' : 'UNAVAILABLE';
  const limitations = [...new Set([
    ...generated.limitations,
    'Conteúdo gerado por IA sobre dados demonstrativos; revise as fontes antes de decidir.',
  ].filter(Boolean))];
  return {
    audience, intent: prepared.intent, mode: prepared.mode,
    ...(prepared.mode === 'SIMULATION' ? { label: 'SIMULAÇÃO' as const } : {}),
    status, title: generated.title, answer: generated.answer,
    facts: status === 'ANSWERED' ? prepared.facts : [], basis: prepared.basis,
    citations: status === 'ANSWERED' && audience === 'LAWYER'
      ? buildCitations(generated.citationIndexes, prepared.citationCandidates) : [],
    calculations: status === 'ANSWERED' ? prepared.calculations : [],
    assumptions: status === 'ANSWERED' ? prepared.assumptions : [],
    limitations, provenance: prepared.provenance,
  };
}
