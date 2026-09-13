import { deterministicPolicyCopilot } from '../lib/policyCopilot';
import type {
  AdminCopilotRequest,
  CopilotAudience,
  CopilotBasis,
  CopilotCalculation,
  CopilotCitation,
  CopilotFact,
  CopilotFactSource,
  PolicyCopilotProvider,
  PolicyCopilotRequest,
  PolicyCopilotResponse,
} from '../lib/policyCopilot.types';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_QUESTION_LENGTH = 4_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RemoteCopilotPayload = {
  question: string;
  context_ref: string;
  intent?: string;
  case_id?: string;
  scope?: { filters: Record<string, string | number | boolean> };
  scenario?:
    | { type: 'PROPOSAL_VALUE'; proposalValue: number }
    | { type: 'ACCEPTANCE_RATE'; acceptanceRate: number }
    | { type: 'ADHERENCE_RATE'; adherenceRate: number };
};

export type PolicyCopilotServiceErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

export class PolicyCopilotServiceError extends Error {
  readonly code: PolicyCopilotServiceErrorCode;
  readonly status: number | null;

  constructor(code: PolicyCopilotServiceErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'PolicyCopilotServiceError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

const lawyerSources = new Set<CopilotFactSource>([
  'CASE_DETAIL',
  'RECOMMENDATION',
  'DECISION',
  'NEGOTIATION',
  'DERIVED',
]);
const adminSources = new Set<CopilotFactSource>([
  'DASHBOARD_METRICS',
  'ADMIN_DECISION_ROW',
  'DERIVED',
]);

function isAllowedSource(value: unknown, audience: CopilotAudience): value is CopilotFactSource {
  return (
    typeof value === 'string' &&
    (audience === 'LAWYER'
      ? lawyerSources.has(value as CopilotFactSource)
      : adminSources.has(value as CopilotFactSource))
  );
}

function isFact(value: unknown, audience: CopilotAudience): value is CopilotFact {
  if (!isObject(value)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    (value.value === null ||
      typeof value.value === 'string' ||
      typeof value.value === 'number' ||
      typeof value.value === 'boolean') &&
    typeof value.formattedValue === 'string' &&
    isAllowedSource(value.source, audience)
  );
}

function isBasis(value: unknown, audience: CopilotAudience): value is CopilotBasis {
  if (!isObject(value)) return false;
  return (
    isAllowedSource(value.source, audience) &&
    typeof value.description === 'string' &&
    (value.recordCount === undefined ||
      (typeof value.recordCount === 'number' &&
        Number.isFinite(value.recordCount) &&
        value.recordCount >= 0))
  );
}

function isCitation(value: unknown): value is CopilotCitation {
  if (!isObject(value)) return false;
  return (
    typeof value.marker === 'string' &&
    typeof value.documentId === 'string' &&
    typeof value.documentName === 'string' &&
    typeof value.page === 'number' &&
    Number.isInteger(value.page) &&
    value.page > 0 &&
    typeof value.origin === 'string' &&
    isOptionalString(value.excerpt) &&
    isStringArray(value.claims)
  );
}

function isCalculation(value: unknown): value is CopilotCalculation {
  if (!isObject(value) || !Array.isArray(value.inputs)) return false;
  return (
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.formula === 'string' &&
    value.inputs.every(
      (input) =>
        isObject(input) &&
        typeof input.label === 'string' &&
        typeof input.value === 'number' &&
        Number.isFinite(input.value),
    ) &&
    typeof value.result === 'number' &&
    Number.isFinite(value.result) &&
    typeof value.formattedResult === 'string'
  );
}

const lawyerIntents = new Set([
  'CASE_SUMMARY',
  'RECOMMENDATION',
  'EVIDENCE',
  'DECISION_POINTS',
  'AGREEMENT_FACTORS',
  'DEFENSE_FACTORS',
  'MISSING_EVIDENCE',
  'NEXT_ACTION',
  'SETTLEMENT_RANGE',
  'NEGOTIATION',
  'STATUS',
  'WHAT_IF',
]);
const adminIntents = new Set([
  'OVERVIEW',
  'ADHERENCE',
  'EFFECTIVENESS',
  'DECISION',
  'SEGMENTS',
  'OVERRIDE_REASONS',
  'REVIEW',
  'TREND',
  'POLICY_METADATA',
  'WHAT_IF',
]);

/**
 * Runtime guard for the remote boundary. It protects the UI from malformed JSON;
 * authorization and grounding remain server responsibilities.
 */
export function isPolicyCopilotResponse(
  value: unknown,
  expectedAudience: CopilotAudience,
): value is PolicyCopilotResponse {
  if (!isObject(value) || value.audience !== expectedAudience) return false;
  const validIntent =
    typeof value.intent === 'string' &&
    (expectedAudience === 'LAWYER'
      ? lawyerIntents.has(value.intent)
      : adminIntents.has(value.intent));
  const provenance = value.provenance;
  const modeIsValid =
    (value.mode === 'SIMULATION' && value.label === 'SIMULAÇÃO') ||
    (value.mode === 'FACTUAL' && value.label === undefined);
  const statusPayloadIsValid =
    value.status === 'UNAVAILABLE'
      ? Array.isArray(value.facts) &&
        value.facts.length === 0 &&
        Array.isArray(value.calculations) &&
        value.calculations.length === 0 &&
        Array.isArray(value.assumptions) &&
        value.assumptions.length === 0 &&
        Array.isArray(value.limitations) &&
        value.limitations.length > 0
      : value.status === 'ANSWERED';
  const simulationPayloadIsValid =
    value.mode !== 'SIMULATION' ||
    (value.status === 'ANSWERED' &&
      Array.isArray(value.calculations) &&
      value.calculations.length > 0 &&
      Array.isArray(value.assumptions) &&
      value.assumptions.length > 0);
  return (
    validIntent &&
    (value.mode === 'FACTUAL' || value.mode === 'SIMULATION') &&
    (value.status === 'ANSWERED' || value.status === 'UNAVAILABLE') &&
    modeIsValid &&
    statusPayloadIsValid &&
    simulationPayloadIsValid &&
    typeof value.title === 'string' &&
    typeof value.answer === 'string' &&
    Array.isArray(value.facts) &&
    value.facts.every((item) => isFact(item, expectedAudience)) &&
    Array.isArray(value.basis) &&
    value.basis.length > 0 &&
    value.basis.every((item) => isBasis(item, expectedAudience)) &&
    value.basis.some(
      (item) => isObject(item) && typeof item.recordCount === 'number' && item.recordCount >= 0,
    ) &&
    Array.isArray(value.citations) &&
    value.citations.every(isCitation) &&
    (expectedAudience === 'LAWYER' || value.citations.length === 0) &&
    Array.isArray(value.calculations) &&
    value.calculations.every(isCalculation) &&
    isStringArray(value.assumptions) &&
    isStringArray(value.limitations) &&
    isObject(provenance) &&
    provenance.engine === 'remote-policy-copilot' &&
    typeof provenance.version === 'string' &&
    (provenance.dataMode === 'DEMONSTRATION' || provenance.dataMode === 'OPERATIONAL') &&
    isOptionalString(provenance.contextRef) &&
    isOptionalString(provenance.period) &&
    isOptionalString(provenance.policyVersion) &&
    isOptionalString(provenance.modelVersion) &&
    isOptionalString(provenance.dataUpdatedAt) &&
    isOptionalString(provenance.dashboardUpdatedAt) &&
    typeof provenance.policyVersion === 'string' &&
    provenance.policyVersion.trim().length > 0 &&
    typeof provenance.modelVersion === 'string' &&
    provenance.modelVersion.trim().length > 0 &&
    (typeof provenance.dataUpdatedAt === 'string' ||
      typeof provenance.dashboardUpdatedAt === 'string') &&
    (expectedAudience !== 'ADMIN' ||
      (typeof provenance.period === 'string' && provenance.period.trim().length > 0))
  );
}

function normalizedQuestion(question: unknown): string {
  if (typeof question !== 'string' || !question.trim()) {
    throw new PolicyCopilotServiceError(
      'INVALID_REQUEST',
      'Escreva uma pergunta para consultar o Copiloto da Política.',
    );
  }
  const normalized = question.trim();
  if (normalized.length > MAX_QUESTION_LENGTH) {
    throw new PolicyCopilotServiceError(
      'INVALID_REQUEST',
      `A pergunta deve ter no máximo ${MAX_QUESTION_LENGTH} caracteres.`,
    );
  }
  return normalized;
}

function normalizedScenario(request: PolicyCopilotRequest): RemoteCopilotPayload['scenario'] {
  const scenario = request.scenario;
  if (!scenario) return undefined;

  if (request.audience === 'LAWYER') {
    if (
      scenario.type !== 'PROPOSAL_VALUE' ||
      !Number.isFinite(scenario.proposalValue) ||
      scenario.proposalValue <= 0
    ) {
      throw new PolicyCopilotServiceError('INVALID_REQUEST', 'A simulação informada é inválida.');
    }
    return { type: 'PROPOSAL_VALUE', proposalValue: scenario.proposalValue };
  }

  if (
    scenario.type === 'ACCEPTANCE_RATE' &&
    Number.isFinite(scenario.acceptanceRate) &&
    scenario.acceptanceRate >= 0 &&
    scenario.acceptanceRate <= 1
  ) {
    return { type: 'ACCEPTANCE_RATE', acceptanceRate: scenario.acceptanceRate };
  }
  if (
    scenario.type === 'ADHERENCE_RATE' &&
    Number.isFinite(scenario.adherenceRate) &&
    scenario.adherenceRate >= 0 &&
    scenario.adherenceRate <= 1
  ) {
    return { type: 'ADHERENCE_RATE', adherenceRate: scenario.adherenceRate };
  }
  throw new PolicyCopilotServiceError('INVALID_REQUEST', 'A simulação informada é inválida.');
}

function sanitizedFilters(
  filters: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) continue;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) result[key] = normalized.slice(0, 200);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

function shortContextHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function remotePayload(request: PolicyCopilotRequest): RemoteCopilotPayload {
  const question = normalizedQuestion(request.question);
  if (
    request.intent &&
    request.intent !== 'AUTO' &&
    !(request.audience === 'LAWYER'
      ? lawyerIntents.has(request.intent)
      : adminIntents.has(request.intent))
  ) {
    throw new PolicyCopilotServiceError('INVALID_REQUEST', 'A intenção informada é inválida.');
  }
  const caseId =
    request.audience === 'LAWYER'
      ? request.context.caseDetail.case_id
      : (request as AdminCopilotRequest).context.selectedRow?.case_id;
  if (request.audience === 'LAWYER' && (!caseId || !caseId.trim())) {
    throw new PolicyCopilotServiceError('INVALID_REQUEST', 'Informe um processo válido.');
  }
  const scenario = normalizedScenario(request);
  const scope =
    request.audience === 'ADMIN'
      ? {
          filters: sanitizedFilters(request.context.rowScope.filters),
        }
      : undefined;
  const contextRef =
    request.audience === 'LAWYER'
      ? `case:${caseId}`
      : `scope:${shortContextHash(
          JSON.stringify({
            caseId: caseId ?? null,
            filters: Object.entries(scope?.filters ?? {}).sort(),
          }),
        )}`;
  return {
    question,
    context_ref: contextRef,
    ...(request.intent && request.intent !== 'AUTO' ? { intent: request.intent } : {}),
    ...(caseId ? { case_id: caseId.trim() } : {}),
    ...(scope && Object.keys(scope.filters).length ? { scope } : {}),
    ...(scenario ? { scenario } : {}),
  };
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isObject(payload)) return fallback;
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload.detail === 'string' && payload.detail.trim()) return payload.detail;
  return fallback;
}

export interface HttpPolicyCopilotOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class HttpPolicyCopilotProvider implements PolicyCopilotProvider {
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, options: HttpPolicyCopilotOptions = {}) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (!normalizedBaseUrl) {
      throw new PolicyCopilotServiceError(
        'INVALID_CONFIGURATION',
        'Configure uma URL válida para o serviço remoto do copiloto.',
      );
    }
    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new PolicyCopilotServiceError(
        'INVALID_CONFIGURATION',
        'Configure um tempo limite válido para o serviço remoto do copiloto.',
      );
    }
    this.baseUrl = normalizedBaseUrl;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async respond(request: PolicyCopilotRequest): Promise<PolicyCopilotResponse> {
    const audience = request.audience;
    const endpoint = audience === 'LAWYER' ? 'lawyer' : 'admin';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const requestPayload = remotePayload(request);
      const response = await this.fetch(`${this.baseUrl}/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      const text = await response.text();
      let payload: unknown;
      try {
        payload = text ? JSON.parse(text) : undefined;
      } catch {
        throw new PolicyCopilotServiceError(
          'INVALID_RESPONSE',
          'O serviço do copiloto retornou uma resposta que não é JSON.',
          response.status,
        );
      }
      if (!response.ok) {
        throw new PolicyCopilotServiceError(
          'HTTP_ERROR',
          errorMessage(
            payload,
            `O serviço do copiloto não concluiu a consulta (HTTP ${response.status}).`,
          ),
          response.status,
        );
      }
      if (!isPolicyCopilotResponse(payload, audience)) {
        throw new PolicyCopilotServiceError(
          'INVALID_RESPONSE',
          'O serviço do copiloto retornou dados incompletos ou incompatíveis com o perfil atual.',
          response.status,
        );
      }
      const expectedIntent = request.scenario
        ? 'WHAT_IF'
        : request.intent && request.intent !== 'AUTO'
          ? request.intent
          : null;
      if (expectedIntent && payload.intent !== expectedIntent) {
        throw new PolicyCopilotServiceError(
          'INVALID_RESPONSE',
          'O serviço do copiloto respondeu a uma intenção diferente da consulta enviada.',
          response.status,
        );
      }
      if (payload.provenance.contextRef !== requestPayload.context_ref) {
        throw new PolicyCopilotServiceError(
          'INVALID_RESPONSE',
          'O serviço do copiloto retornou uma resposta vinculada a outro contexto.',
          response.status,
        );
      }
      if (request.audience === 'LAWYER') {
        const documents = new Map(
          request.context.recommendation.documents.map((document) => [document.id, document]),
        );
        const hasInvalidCitation = payload.citations.some((citation) => {
          const document = documents.get(citation.documentId);
          return (
            !document ||
            document.status === 'AUSENTE' ||
            citation.page > document.page_count ||
            citation.documentName !== document.name
          );
        });
        if (hasInvalidCitation) {
          throw new PolicyCopilotServiceError(
            'INVALID_RESPONSE',
            'O serviço do copiloto citou um documento fora do contexto permitido deste processo.',
            response.status,
          );
        }
      }
      return payload;
    } catch (error) {
      if (error instanceof PolicyCopilotServiceError) throw error;
      if (controller.signal.aborted) {
        throw new PolicyCopilotServiceError(
          'TIMEOUT',
          'O serviço do copiloto demorou para responder. Tente novamente.',
        );
      }
      throw new PolicyCopilotServiceError(
        'NETWORK_ERROR',
        'Não foi possível consultar o serviço do copiloto agora. Tente novamente.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const configuredApiUrl =
  import.meta.env.MODE === 'test' ? '' : (import.meta.env.VITE_COPILOT_API_URL ?? '').trim();

/** Empty URL keeps the fully grounded deterministic demonstration provider. */
export function createPolicyCopilotProvider(
  apiUrl: string = configuredApiUrl,
): PolicyCopilotProvider {
  return apiUrl.trim() ? new HttpPolicyCopilotProvider(apiUrl) : deterministicPolicyCopilot;
}

export const policyCopilotProvider = createPolicyCopilotProvider();
