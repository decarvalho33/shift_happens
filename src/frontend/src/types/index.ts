export type Role = 'ADVOGADO' | 'ADMINISTRATIVO';
export type Recommendation = 'ACORDO' | 'DEFESA' | 'REVISAR';
export type RiskLevel = 'ALTO' | 'MEDIO' | 'BAIXO';
/** Sub-assunto da planilha de processos. */
export type SubSubject = 'GOLPE' | 'GENERICO';
/** Os seis subsídios registrados na planilha de processos. */
export type SubsidyKey =
  'contrato' | 'extrato' | 'comprovante' | 'dossie' | 'demonstrativo' | 'laudo';
export type CaseStatus =
  'AGUARDANDO_DECISAO' | 'EM_NEGOCIACAO' | 'DECISAO_REGISTRADA' | 'CONCLUIDO';
export type DocumentStatus = 'PRESENTE' | 'AUSENTE' | 'INCONCLUSIVO';
export type NegotiationStatus = 'PENDENTE' | 'ACEITA' | 'RECUSADA' | 'CONTRAPROPOSTA';
export type OverrideReason =
  | 'NOVA_EVIDENCIA'
  | 'ESTRATEGIA_PROCESSUAL'
  | 'INFORMACAO_NAO_CONSIDERADA'
  | 'POLITICA_INADEQUADA'
  | 'OUTRO';

export interface SourceReference {
  document_id: string;
  document_name: string;
  page: number;
  excerpt?: string;
  origin: string;
}
export interface DocumentPage {
  page: number;
  title: string;
  paragraphs: string[];
  fields?: { label: string; value: string }[];
}
export interface CaseDocument {
  id: string;
  name: string;
  category: string;
  /** Subsídio da planilha que este documento representa; ausente em peças que não são subsídio. */
  subsidy?: SubsidyKey;
  status: DocumentStatus;
  page_count: number;
  url?: string;
  demo_pages?: DocumentPage[];
  description?: string;
}
export interface Evidence {
  id: string;
  kind: 'FAVORAVEL' | 'RISCO' | 'ALEGACAO';
  title: string;
  description: string;
  source: SourceReference;
}
export interface Contradiction {
  id: string;
  title: string;
  description: string;
  allegation: { text: string; source: SourceReference };
  documentary_fact: { text: string; source: SourceReference };
}
export interface SettlementRange {
  opening: number;
  target: number;
  ceiling: number;
}
export interface NextBestEvidence {
  title: string;
  description: string;
  simulation?: { hypothesis: string; outcome: string };
}
export interface CaseSummary {
  case_id: string;
  case_number: string;
  plaintiff: string;
  city: string;
  uf: string;
  claim_value: number;
  status: CaseStatus;
  risk_level: RiskLevel;
  recommendation: Recommendation;
  updated_at: string;
  lawyer_name: string;
  firm_name: string;
  assigned_to_me: boolean;
  lawyer_profile_label?: string;
  lawyer_profile_description?: string;
  office_cluster?: string;
  adherence_base?: number;
}
export interface CaseDetail extends CaseSummary {
  subject: string;
  sub_subject?: SubSubject;
  summary: string;
  received_at: string;
  documents: CaseDocument[];
}
export interface RecommendationResponse {
  case_id: string;
  recommendation: Recommendation;
  loss_probability: number | null;
  expected_condemnation: number | null;
  expected_defense_cost: number | null;
  settlement: SettlementRange | null;
  reasons: string[];
  documents: CaseDocument[];
  evidence: Evidence[];
  contradictions: Contradiction[];
  missing_evidence: string[];
  next_best_evidence: NextBestEvidence | null;
  policy_version: string;
  model_version: string;
  generated_at: string;
  demo_data: boolean;
  confidence_score?: number;
  confidence_band?: string;
  subsidy_count?: number;
  critical_subsidy_count?: number;
  completeness_band?: string;
}
export interface LawyerDecisionInput {
  case_id: string;
  decision: Recommendation;
  notes?: string;
}
export interface OverrideInput extends LawyerDecisionInput {
  reason: OverrideReason;
  justification: string;
}
export interface DecisionRecord {
  id: string;
  case_id: string;
  recommendation: Recommendation;
  decision: Recommendation;
  is_override: boolean;
  reason?: OverrideReason;
  justification?: string;
  notes?: string;
  policy_version: string;
  created_at: string;
  simulated_override_reason?: string;
  simulated_decision_explanation?: string;
  follow_probability?: number;
  decision_minutes?: number;
}
export interface NegotiationInput {
  case_id: string;
  proposal_value: number;
  status: NegotiationStatus;
  counterproposal_value?: number;
  final_value?: number;
  notes?: string;
}
export interface NegotiationRecord extends NegotiationInput {
  id: string;
  updated_at: string;
}
export interface AdminDecisionRow {
  id: string;
  case_id: string;
  case_number: string;
  policy_version?: string;
  model_version?: string;
  plaintiff: string;
  lawyer_name: string;
  firm_name: string;
  uf: string;
  recommendation: Recommendation;
  decision: Recommendation;
  adherent: boolean;
  suggested_value: number | null;
  realized_value: number | null;
  status: NegotiationStatus | 'DECISAO_REGISTRADA';
  created_at: string;
  is_local?: boolean;
  justification?: string;
  lawyer_profile_label?: string;
  lawyer_profile_description?: string;
  confidence_score?: number | null;
  confidence_band?: string | null;
  subsidy_count?: number | null;
  critical_subsidy_count?: number | null;
  completeness_band?: string | null;
  follow_probability?: number | null;
  decision_minutes?: number | null;
  decision_explanation?: string;
  override_reason_label?: string | null;
}
export interface AdminFirmAdherenceSummary {
  name: string;
  decisions: number;
  adherence_rate: number;
  avg_decision_minutes: number | null;
  avg_follow_probability: number | null;
  lawyer_count: number;
}
export interface AdminLawyerAdherenceSummary {
  name: string;
  firm_name: string;
  decisions: number;
  adherence_rate: number;
  agreement_rate: number;
  high_confidence_rate: number;
  complete_documentation_rate: number;
  avg_decision_minutes: number | null;
  avg_follow_probability: number | null;
}
export interface AdminDashboard {
  demo_data: boolean;
  period: string;
  updated_at: string;
  metrics: {
    decisions: number;
    adherence_rate: number;
    overrides: number;
    settlements: number;
    agreement_proposals: number;
    acceptance_rate: number;
    average_closed_value: number;
    average_offered_value: number;
    rejected: number;
    counteroffers: number;
    baseline_cost: number;
    projected_cost: number;
    estimated_savings: number;
    estimated_savings_rate: number;
    firm_count?: number;
    lawyer_count?: number;
  };
  distribution: { label: string; value: number; percentage: number }[];
  evolution: { label: string; agreement: number; defense: number }[];
  override_reasons: { label: string; value: number; percentage: number }[];
  effectiveness_outcomes: { label: string; value: number; percentage: number }[];
  effectiveness_savings_flow: { label: string; value: number }[];
  effectiveness_timeline: {
    label: string;
    savings: number;
    acceptance_rate: number;
  }[];
  firm_adherence?: AdminFirmAdherenceSummary[];
  lawyer_adherence?: AdminLawyerAdherenceSummary[];
  historical_simulation: {
    sample_size: number;
    acceptance_assumption: number;
    baseline_cost: number;
    projected_cost: number;
    estimated_savings: number;
    description: string;
  };
  decisions: AdminDecisionRow[];
}
