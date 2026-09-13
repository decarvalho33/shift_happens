import type {
  AdminDashboard,
  AdminDecisionRow,
  CaseDetail,
  DecisionRecord,
  NegotiationRecord,
  RecommendationResponse,
} from '../types';

export type CopilotAudience = 'LAWYER' | 'ADMIN';
export type CopilotMode = 'FACTUAL' | 'SIMULATION';
export type CopilotStatus = 'ANSWERED' | 'UNAVAILABLE';

export type LawyerCopilotIntent =
  | 'AUTO'
  | 'CASE_SUMMARY'
  | 'RECOMMENDATION'
  | 'EVIDENCE'
  | 'DECISION_POINTS'
  | 'AGREEMENT_FACTORS'
  | 'DEFENSE_FACTORS'
  | 'MISSING_EVIDENCE'
  | 'NEXT_ACTION'
  | 'SETTLEMENT_RANGE'
  | 'NEGOTIATION'
  | 'STATUS'
  | 'WHAT_IF';

export type AdminCopilotIntent =
  | 'AUTO'
  | 'OVERVIEW'
  | 'ADHERENCE'
  | 'EFFECTIVENESS'
  | 'DECISION'
  | 'SEGMENTS'
  | 'OVERRIDE_REASONS'
  | 'REVIEW'
  | 'TREND'
  | 'POLICY_METADATA'
  | 'WHAT_IF';

export type ResolvedCopilotIntent = Exclude<LawyerCopilotIntent | AdminCopilotIntent, 'AUTO'>;

export type CopilotFactSource =
  | 'CASE_DETAIL'
  | 'RECOMMENDATION'
  | 'DECISION'
  | 'NEGOTIATION'
  | 'DASHBOARD_METRICS'
  | 'ADMIN_DECISION_ROW'
  | 'DERIVED';

export interface CopilotFact {
  key: string;
  label: string;
  value: string | number | boolean | null;
  formattedValue: string;
  source: CopilotFactSource;
}

export interface CopilotBasis {
  source: CopilotFactSource;
  description: string;
  recordCount?: number;
}

export interface CopilotCitation {
  marker: string;
  documentId: string;
  documentName: string;
  page: number;
  origin: string;
  excerpt?: string;
  claims: string[];
}

export interface CopilotCalculationInput {
  label: string;
  value: number;
}

export interface CopilotCalculation {
  key: string;
  label: string;
  formula: string;
  inputs: CopilotCalculationInput[];
  result: number;
  formattedResult: string;
}

export interface CopilotProvenance {
  engine: 'deterministic-policy-copilot' | 'remote-policy-copilot';
  version: string;
  dataMode: 'DEMONSTRATION' | 'OPERATIONAL';
  contextRef?: string;
  period?: string;
  policyVersion?: string;
  modelVersion?: string;
  dataUpdatedAt?: string;
  dashboardUpdatedAt?: string;
}

export interface PolicyCopilotResponse {
  audience: CopilotAudience;
  intent: ResolvedCopilotIntent;
  mode: CopilotMode;
  status: CopilotStatus;
  label?: 'SIMULAÇÃO';
  title: string;
  answer: string;
  facts: CopilotFact[];
  basis: CopilotBasis[];
  citations: CopilotCitation[];
  calculations: CopilotCalculation[];
  assumptions: string[];
  limitations: string[];
  provenance: CopilotProvenance;
}

export interface LawyerCopilotContext {
  caseDetail: CaseDetail;
  recommendation: RecommendationResponse;
  decision: DecisionRecord | null;
  negotiation: NegotiationRecord | null;
}

export type LawyerWhatIfScenario = {
  type: 'PROPOSAL_VALUE';
  proposalValue: number;
};

export interface LawyerCopilotRequest {
  audience: 'LAWYER';
  question: string;
  intent?: LawyerCopilotIntent;
  context: LawyerCopilotContext;
  scenario?: LawyerWhatIfScenario;
}

export interface AdminCopilotContext {
  dashboard: AdminDashboard;
  rows: AdminDecisionRow[];
  rowScope: {
    description: string;
    filters: Record<string, string | number | boolean | null>;
  };
  selectedRow?: AdminDecisionRow;
}

export type AdminWhatIfScenario =
  | {
      type: 'ACCEPTANCE_RATE';
      acceptanceRate: number;
    }
  | {
      type: 'ADHERENCE_RATE';
      adherenceRate: number;
    };

export interface AdminCopilotRequest {
  audience: 'ADMIN';
  question: string;
  intent?: AdminCopilotIntent;
  context: AdminCopilotContext;
  scenario?: AdminWhatIfScenario;
}

export type PolicyCopilotRequest = LawyerCopilotRequest | AdminCopilotRequest;

/**
 * Stable async boundary for the local engine and future HTTP/model-backed providers.
 */
export interface PolicyCopilotProvider {
  respond(request: PolicyCopilotRequest): Promise<PolicyCopilotResponse>;
}

export type PolicyCopilotInputErrorCode =
  'CASE_NOT_ASSIGNED' | 'CONTEXT_MISMATCH' | 'INVALID_SCENARIO';
