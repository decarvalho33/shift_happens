import type {
  AdminDashboard,
  AdminDecisionRow,
  CaseDetail,
  CaseSummary,
  DecisionRecord,
  LawyerDecisionInput,
  NegotiationInput,
  NegotiationRecord,
  NegotiationStatus,
  OverrideInput,
  Recommendation,
  RecommendationResponse,
} from '../types';
import {
  isMeaningfulOverrideJustification,
  isOverrideReason,
  MIN_OVERRIDE_JUSTIFICATION_LENGTH,
  overrideReasonLabel,
} from '../lib/overrideReasons';
import {
  demoAdminDashboard,
  demoCases,
  demoDecisions,
  demoNegotiations,
  demoRecommendations,
  DEMO_GENERATED_AT,
} from '../mocks/behavioralFixtures';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const isMockMode = apiBaseUrl.length === 0;
export const DATA_CHANGED_EVENT = 'policy:data-changed';
export const DEMO_STORAGE_KEY = 'policy:demo-data:v1';
const MOCK_DELAY_MS = 100;
const recommendations: Recommendation[] = ['ACORDO', 'DEFESA', 'REVISAR'];
const negotiationStatuses: NegotiationStatus[] = [
  'PENDENTE',
  'ACEITA',
  'RECUSADA',
  'CONTRAPROPOSTA',
];

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface DemoState {
  schema_version: 1;
  decisions: Record<string, DecisionRecord>;
  negotiations: Record<string, NegotiationRecord>;
  updated_at: string;
}

function emptyState(): DemoState {
  return { schema_version: 1, decisions: {}, negotiations: {}, updated_at: DEMO_GENERATED_AT };
}

let memoryState = emptyState();
const clone = <T>(value: T): T => structuredClone(value);
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const knownCase = (caseId: string) => demoCases.some((item) => item.case_id === caseId);

function validStoredDecision(value: unknown, caseId: string): value is DecisionRecord {
  return (
    isObject(value) &&
    value.case_id === caseId &&
    knownCase(caseId) &&
    typeof value.id === 'string' &&
    recommendations.includes(value.decision as Recommendation) &&
    recommendations.includes(value.recommendation as Recommendation) &&
    typeof value.is_override === 'boolean' &&
    typeof value.policy_version === 'string' &&
    isDate(value.created_at) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.justification === undefined || typeof value.justification === 'string') &&
    (value.reason === undefined || isOverrideReason(value.reason))
  );
}

function validStoredNegotiation(value: unknown, caseId: string): value is NegotiationRecord {
  return (
    isObject(value) &&
    value.case_id === caseId &&
    knownCase(caseId) &&
    typeof value.id === 'string' &&
    negotiationStatuses.includes(value.status as NegotiationStatus) &&
    positiveNumber(value.proposal_value) &&
    isDate(value.updated_at) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.counterproposal_value === undefined || positiveNumber(value.counterproposal_value)) &&
    (value.final_value === undefined || positiveNumber(value.final_value)) &&
    (value.status !== 'ACEITA' || positiveNumber(value.final_value)) &&
    (value.status !== 'CONTRAPROPOSTA' || positiveNumber(value.counterproposal_value))
  );
}

function readState(): DemoState {
  if (typeof window === 'undefined') return clone(memoryState);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
  } catch {
    throw new ApiError(
      'O armazenamento local está indisponível. Permita o armazenamento deste site para usar a demonstração.',
      503,
    );
  }
  if (!raw) return emptyState();
  try {
    const state: unknown = JSON.parse(raw);
    if (
      !isObject(state) ||
      state.schema_version !== 1 ||
      !isObject(state.decisions) ||
      !isObject(state.negotiations) ||
      !isDate(state.updated_at)
    )
      throw new Error('Invalid state');
    if (
      !Object.entries(state.decisions).every(([id, record]) => validStoredDecision(record, id)) ||
      !Object.entries(state.negotiations).every(([id, record]) =>
        validStoredNegotiation(record, id),
      )
    )
      throw new Error('Invalid records');
    return clone(state as unknown as DemoState);
  } catch {
    throw new ApiError(
      'Os registros locais da demonstração estão inválidos. Use “Restaurar demonstração” para recuperar o cenário inicial.',
      409,
    );
  }
}

function writeState(state: DemoState): void {
  if (typeof window === 'undefined') {
    memoryState = clone(state);
    return;
  }
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new ApiError(
      'Não foi possível salvar o registro neste navegador. Verifique o espaço e a permissão de armazenamento e tente novamente.',
      503,
    );
  }
}

function dataChanged(action: string, caseId?: string): void {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent(DATA_CHANGED_EVENT, {
        detail: { action, case_id: caseId, demo_data: isMockMode },
      }),
    );
}

if (typeof window !== 'undefined' && isMockMode)
  window.addEventListener('storage', (event) => {
    if (event.key === DEMO_STORAGE_KEY || event.key === null) dataChanged('storage');
  });

/** All future HTTP integration lives here; components never need fetch. */
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const responseText = await response.text();
    let payload: unknown;
    try {
      payload = responseText ? JSON.parse(responseText) : undefined;
    } catch {
      throw new ApiError(
        'A API retornou uma resposta inválida. Era esperado um documento JSON.',
        response.status,
      );
    }
    if (!response.ok) {
      const message =
        isObject(payload) && typeof payload.message === 'string'
          ? payload.message
          : isObject(payload) && typeof payload.detail === 'string'
            ? payload.detail
            : `A API não concluiu a operação (HTTP ${response.status}).`;
      throw new ApiError(message, response.status);
    }
    if (payload === undefined && method === 'GET')
      throw new ApiError('A API retornou uma resposta vazia para esta consulta.', 502);
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError('O sistema demorou para responder. Tente novamente.', 408);
    throw new ApiError(
      'Não foi possível carregar os dados agora. Confira sua conexão e tente novamente.',
      503,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function caseIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new ApiError('Informe um identificador de caso válido.', 400);
  return value.trim();
}

function requireCase(caseId: string): CaseDetail {
  const result = demoCases.find((item) => item.case_id === caseId);
  if (!result)
    throw new ApiError(
      `O caso “${caseId}” não foi encontrado. Volte à lista e selecione um caso disponível.`,
      404,
    );
  return result;
}

function decisionFrom(state: DemoState, caseId: string): DecisionRecord | null {
  return state.decisions[caseId] ?? demoDecisions.find((item) => item.case_id === caseId) ?? null;
}

function negotiationFrom(state: DemoState, caseId: string): NegotiationRecord | null {
  return (
    state.negotiations[caseId] ?? demoNegotiations.find((item) => item.case_id === caseId) ?? null
  );
}

function withLocalState(caseDetail: CaseDetail, state: DemoState): CaseDetail {
  const result = clone(caseDetail);
  const decision = decisionFrom(state, result.case_id);
  const negotiation = negotiationFrom(state, result.case_id);
  if (decision) {
    result.status =
      decision.decision === 'ACORDO'
        ? negotiation
          ? negotiation.status === 'ACEITA' || negotiation.status === 'RECUSADA'
            ? 'CONCLUIDO'
            : 'EM_NEGOCIACAO'
          : 'DECISAO_REGISTRADA'
        : 'DECISAO_REGISTRADA';
    result.updated_at = [result.updated_at, decision.created_at, negotiation?.updated_at ?? '']
      .sort()
      .at(-1)!;
  }
  return result;
}

function summaryFrom(detail: CaseDetail): CaseSummary {
  return {
    case_id: detail.case_id,
    case_number: detail.case_number,
    plaintiff: detail.plaintiff,
    city: detail.city,
    uf: detail.uf,
    claim_value: detail.claim_value,
    status: detail.status,
    risk_level: detail.risk_level,
    recommendation: detail.recommendation,
    updated_at: detail.updated_at,
    lawyer_name: detail.lawyer_name,
    firm_name: detail.firm_name,
    assigned_to_me: detail.assigned_to_me,
    lawyer_profile_label: detail.lawyer_profile_label,
    lawyer_profile_description: detail.lawyer_profile_description,
    office_cluster: detail.office_cluster,
    adherence_base: detail.adherence_base,
  };
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError(`${label} deve ser um texto.`, 400);
  return value.trim() || undefined;
}

function normalizeDecision(input: LawyerDecisionInput): LawyerDecisionInput {
  if (!input || !recommendations.includes(input.decision))
    throw new ApiError('Selecione uma decisão válida: acordo, defesa ou revisar.', 400);
  const notes = optionalText(input.notes, 'A observação');
  return {
    case_id: caseIdFrom(input.case_id),
    decision: input.decision,
    ...(notes ? { notes } : {}),
  };
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeNegotiation(input: NegotiationInput): NegotiationInput {
  if (!input || !negotiationStatuses.includes(input.status))
    throw new ApiError('Selecione uma situação válida para a negociação.', 400);
  if (!positiveNumber(input.proposal_value))
    throw new ApiError('Informe um valor de proposta maior que zero.', 400);
  if (input.counterproposal_value !== undefined && !positiveNumber(input.counterproposal_value))
    throw new ApiError('O valor da contraproposta deve ser maior que zero.', 400);
  if (input.final_value !== undefined && !positiveNumber(input.final_value))
    throw new ApiError('O valor final deve ser maior que zero.', 400);
  if (input.status === 'CONTRAPROPOSTA' && !positiveNumber(input.counterproposal_value))
    throw new ApiError('Informe o valor da contraproposta recebida.', 400);
  if (input.status === 'ACEITA' && !positiveNumber(input.final_value))
    throw new ApiError('Informe o valor final do acordo aceito.', 400);
  const notes = optionalText(input.notes, 'A observação');
  return {
    case_id: caseIdFrom(input.case_id),
    proposal_value: input.proposal_value,
    status: input.status,
    ...(input.counterproposal_value === undefined
      ? {}
      : { counterproposal_value: input.counterproposal_value }),
    ...(input.final_value === undefined ? {} : { final_value: input.final_value }),
    ...(notes ? { notes } : {}),
  };
}

export async function getCases(): Promise<CaseSummary[]> {
  if (!isMockMode) return request<CaseSummary[]>('GET', '/cases');
  await delay();
  const state = readState();
  return demoCases.map((item) => summaryFrom(withLocalState(item, state)));
}

export async function getCase(id: string): Promise<CaseDetail> {
  const caseId = caseIdFrom(id);
  if (!isMockMode) return request<CaseDetail>('GET', `/cases/${encodeURIComponent(caseId)}`);
  await delay();
  return withLocalState(requireCase(caseId), readState());
}

export async function getRecommendation(id: string): Promise<RecommendationResponse> {
  const caseId = caseIdFrom(id);
  if (!isMockMode)
    return request<RecommendationResponse>(
      'GET',
      `/cases/${encodeURIComponent(caseId)}/recommendation`,
    );
  await delay();
  requireCase(caseId);
  return clone(demoRecommendations[caseId]);
}

export async function getDecision(id: string): Promise<DecisionRecord | null> {
  const caseId = caseIdFrom(id);
  if (!isMockMode)
    return request<DecisionRecord | null>('GET', `/cases/${encodeURIComponent(caseId)}/decision`);
  await delay();
  requireCase(caseId);
  return clone(decisionFrom(readState(), caseId));
}

export async function getNegotiation(id: string): Promise<NegotiationRecord | null> {
  const caseId = caseIdFrom(id);
  if (!isMockMode)
    return request<NegotiationRecord | null>(
      'GET',
      `/cases/${encodeURIComponent(caseId)}/negotiation`,
    );
  await delay();
  requireCase(caseId);
  return clone(negotiationFrom(readState(), caseId));
}

function saveDecision(
  input: LawyerDecisionInput,
  override?: Pick<OverrideInput, 'reason' | 'justification'>,
): DecisionRecord {
  requireCase(input.case_id);
  const recommendation = demoRecommendations[input.case_id];
  const isOverride = input.decision !== recommendation.recommendation;
  if (isOverride && !override)
    throw new ApiError(
      'Para divergir da recomendação, registre o motivo e a justificativa na opção de divergência.',
      400,
    );
  if (!isOverride && override)
    throw new ApiError(
      'A decisão coincide com a recomendação. Use a confirmação da recomendação.',
      400,
    );
  const state = readState();
  const record: DecisionRecord = {
    id: `decisao-${crypto.randomUUID()}`,
    case_id: input.case_id,
    recommendation: recommendation.recommendation,
    decision: input.decision,
    is_override: isOverride,
    ...(isOverride
      ? { simulated_override_reason: override?.reason?.toLocaleLowerCase('pt-BR') }
      : {}),
    simulated_decision_explanation: isOverride
      ? `Divergencia registrada em um caso com confianca ${recommendation.confidence_band?.toLocaleLowerCase('pt-BR') ?? 'indefinida'}.`
      : 'Decisao aderente registrada, preservando a recomendacao original.',
    follow_probability:
      recommendation.confidence_score == null
        ? undefined
        : Number((0.35 + recommendation.confidence_score * 0.5).toFixed(4)),
    decision_minutes:
      (recommendation.subsidy_count ?? 0) * 8 +
      (recommendation.confidence_band === 'Baixa'
        ? 28
        : recommendation.confidence_band === 'Media'
          ? 16
          : 8),
    ...(input.notes ? { notes: input.notes } : {}),
    ...override,
    policy_version: recommendation.policy_version,
    created_at: new Date().toISOString(),
  };
  state.decisions[input.case_id] = record;
  state.updated_at = record.created_at;
  writeState(state);
  dataChanged('decision', input.case_id);
  return clone(record);
}

export async function submitLawyerDecision(input: LawyerDecisionInput): Promise<DecisionRecord> {
  const normalized = normalizeDecision(input);
  if (!isMockMode) {
    const record = await request<DecisionRecord>(
      'POST',
      `/cases/${encodeURIComponent(normalized.case_id)}/decision`,
      normalized,
    );
    dataChanged('decision', normalized.case_id);
    return record;
  }
  await delay();
  return saveDecision(normalized);
}

export async function submitOverride(input: OverrideInput): Promise<DecisionRecord> {
  const normalized = normalizeDecision(input);
  if (!isOverrideReason(input.reason))
    throw new ApiError('Selecione um motivo válido para a divergência.', 400);
  const justification = optionalText(input.justification, 'A justificativa');
  if (!justification)
    throw new ApiError('Explique a justificativa para divergir da recomendação.', 400);
  if (!isMeaningfulOverrideJustification(justification))
    throw new ApiError(
      `Explique a justificativa com pelo menos ${MIN_OVERRIDE_JUSTIFICATION_LENGTH} caracteres e inclua um fato verificável.`,
      400,
    );
  const override = { reason: input.reason, justification };
  if (!isMockMode) {
    const record = await request<DecisionRecord>(
      'POST',
      `/cases/${encodeURIComponent(normalized.case_id)}/override`,
      { ...normalized, ...override },
    );
    dataChanged('decision', normalized.case_id);
    return record;
  }
  await delay();
  return saveDecision(normalized, override);
}

export async function submitNegotiation(input: NegotiationInput): Promise<NegotiationRecord> {
  const normalized = normalizeNegotiation(input);
  if (!isMockMode) {
    const record = await request<NegotiationRecord>(
      'POST',
      `/cases/${encodeURIComponent(normalized.case_id)}/negotiation`,
      normalized,
    );
    dataChanged('negotiation', normalized.case_id);
    return record;
  }
  await delay();
  requireCase(normalized.case_id);
  const state = readState();
  if (decisionFrom(state, normalized.case_id)?.decision !== 'ACORDO')
    throw new ApiError(
      'Registre uma decisão de acordo para este caso antes de salvar a negociação.',
      409,
    );
  const record: NegotiationRecord = {
    ...normalized,
    id:
      state.negotiations[normalized.case_id]?.id ??
      demoNegotiations.find((item) => item.case_id === normalized.case_id)?.id ??
      `negociacao-${crypto.randomUUID()}`,
    updated_at: new Date().toISOString(),
  };
  state.negotiations[normalized.case_id] = record;
  state.updated_at = record.updated_at;
  writeState(state);
  dataChanged('negotiation', normalized.case_id);
  return clone(record);
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  if (!isMockMode) return request<AdminDashboard>('GET', '/admin/dashboard');
  await delay();
  const state = readState();
  const dashboard = clone(demoAdminDashboard);
  const rows = new Map(dashboard.decisions.map((row) => [row.case_id, row]));
  const localCaseIds = new Set([
    ...Object.keys(state.decisions),
    ...Object.keys(state.negotiations),
  ]);
  for (const caseId of localCaseIds) {
    const caseDetail = requireCase(caseId);
    const recommendation = demoRecommendations[caseId];
    const decision = decisionFrom(state, caseId);
    if (!decision) continue;
    const negotiation = decision.decision === 'ACORDO' ? negotiationFrom(state, caseId) : null;
    const row: AdminDecisionRow = {
      id: decision.id,
      case_id: caseId,
      case_number: caseDetail.case_number,
      policy_version: recommendation.policy_version,
      model_version: recommendation.model_version,
      plaintiff: caseDetail.plaintiff,
      lawyer_name: caseDetail.lawyer_name,
      firm_name: caseDetail.firm_name,
      uf: caseDetail.uf,
      recommendation: decision.recommendation,
      decision: decision.decision,
      adherent: !decision.is_override,
      suggested_value: recommendation.settlement?.target ?? null,
      realized_value: negotiation?.status === 'ACEITA' ? (negotiation.final_value ?? null) : null,
      status: negotiation?.status ?? 'DECISAO_REGISTRADA',
      created_at: decision.created_at,
      is_local: true,
      lawyer_profile_label: caseDetail.lawyer_profile_label,
      lawyer_profile_description: caseDetail.lawyer_profile_description,
      confidence_score: recommendation.confidence_score ?? null,
      confidence_band: recommendation.confidence_band ?? null,
      subsidy_count: recommendation.subsidy_count ?? null,
      critical_subsidy_count: recommendation.critical_subsidy_count ?? null,
      completeness_band: recommendation.completeness_band ?? null,
      follow_probability: decision.follow_probability ?? null,
      decision_minutes: decision.decision_minutes ?? null,
      decision_explanation: decision.simulated_decision_explanation,
      override_reason_label: decision.reason ? overrideReasonLabel(decision.reason) : null,
      ...(decision.justification ? { justification: decision.justification } : {}),
    };
    rows.set(caseId, row);
  }
  dashboard.decisions = [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  dashboard.updated_at = state.updated_at;
  // The table reflects saved demo records. Aggregate financial KPIs and historical simulation stay fixed.
  return dashboard;
}

export async function resetDemoData(): Promise<void> {
  if (!isMockMode)
    throw new ApiError('A restauração está disponível apenas no modo de demonstração.', 403);
  await delay();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {
      throw new ApiError(
        'Não foi possível restaurar os registros locais. Verifique a permissão de armazenamento do navegador.',
        503,
      );
    }
  }
  memoryState = emptyState();
  dataChanged('reset');
}
