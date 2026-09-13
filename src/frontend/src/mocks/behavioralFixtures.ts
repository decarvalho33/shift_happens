import type {
  AdminDashboard,
  AdminDecisionRow,
  CaseDetail,
  DecisionRecord,
  RecommendationResponse,
} from '../types';
import { overrideReasonLabel } from '../lib/overrideReasons';
import { historicalFirmAdherence, historicalLawyerAdherence } from './syntheticAdherenceAggregates';
import {
  DEMO_GENERATED_AT,
  DEMO_MODEL_VERSION,
  DEMO_POLICY_VERSION,
  demoCases as baseCases,
  demoDecisions as baseDecisions,
  demoNegotiations,
  demoRecommendations as baseRecommendations,
} from './fixtures';

type BehaviorMeta = {
  lawyer_name: string;
  firm_name: string;
  assigned_to_me: boolean;
  lawyer_profile_label: string;
  lawyer_profile_description: string;
  office_cluster: string;
  adherence_base: number;
  confidence_score: number;
  confidence_band: string;
  subsidy_count: number;
  critical_subsidy_count: number;
  completeness_band: string;
  decision_explanation: string;
  follow_probability?: number;
  decision_minutes?: number;
};

const behaviorByCaseId: Record<string, BehaviorMeta> = {
  'caso-anexo-01': {
    lawyer_name: 'Marina Azevedo',
    firm_name: 'Prado Tavares',
    assigned_to_me: true,
    lawyer_profile_label: 'Guardia da politica',
    lawyer_profile_description: 'Segue a politica de forma disciplinada e diverge pouco.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.91,
    confidence_score: 0.91,
    confidence_band: 'Alta',
    subsidy_count: 7,
    critical_subsidy_count: 5,
    completeness_band: 'Alta',
    decision_explanation:
      'Contrato, crédito em conta de mesma titularidade, identificação e histórico de parcelas sustentam a defesa.',
  },
  'caso-anexo-02': {
    lawyer_name: 'Marina Azevedo',
    firm_name: 'Prado Tavares',
    assigned_to_me: true,
    lawyer_profile_label: 'Guardia da politica',
    lawyer_profile_description: 'Segue a politica de forma disciplinada e diverge pouco.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.91,
    confidence_score: 0.56,
    confidence_band: 'Baixa',
    subsidy_count: 4,
    critical_subsidy_count: 2,
    completeness_band: 'Baixa',
    decision_explanation:
      'A ausência de contrato, aceite, extrato de destino e vídeo de liveness eleva o risco e favorece acordo.',
  },
  'caso-1': {
    lawyer_name: 'Marina Azevedo',
    firm_name: 'Prado Tavares',
    assigned_to_me: true,
    lawyer_profile_label: 'Guardia da politica',
    lawyer_profile_description: 'Segue a politica de forma disciplinada e diverge pouco.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.91,
    confidence_score: 0.88,
    confidence_band: 'Alta',
    subsidy_count: 5,
    critical_subsidy_count: 3,
    completeness_band: 'Alta',
    decision_explanation:
      'Documentacao critica robusta e biometria simulada forte favorecem manutencao da defesa.',
  },
  'caso-2': {
    lawyer_name: 'Marina Azevedo',
    firm_name: 'Prado Tavares',
    assigned_to_me: true,
    lawyer_profile_label: 'Guardia da politica',
    lawyer_profile_description: 'Segue a politica de forma disciplinada e diverge pouco.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.91,
    confidence_score: 0.59,
    confidence_band: 'Baixa',
    subsidy_count: 4,
    critical_subsidy_count: 2,
    completeness_band: 'Media',
    decision_explanation:
      'Atribuicao BACEN ajuda, mas a ausencia de comprovacao independente e de liveness reduz a confianca e empurra para acordo.',
  },
  'caso-3': {
    lawyer_name: 'Marina Azevedo',
    firm_name: 'Prado Tavares',
    assigned_to_me: true,
    lawyer_profile_label: 'Guardia da politica',
    lawyer_profile_description: 'Segue a politica de forma disciplinada e diverge pouco.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.91,
    confidence_score: 0.46,
    confidence_band: 'Baixa',
    subsidy_count: 2,
    critical_subsidy_count: 0,
    completeness_band: 'Baixa',
    decision_explanation:
      'Faltam contrato integral e prova de liberacao com titularidade; a recomendacao correta e revisao.',
  },
  'caso-4': {
    lawyer_name: 'Gustavo Ribeiro',
    firm_name: 'Costa Ribeiro',
    assigned_to_me: false,
    lawyer_profile_label: 'Orientado a meta',
    lawyer_profile_description: 'Busca throughput e tende a seguir o fluxo padrao da politica.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.9,
    confidence_score: 0.81,
    confidence_band: 'Media',
    subsidy_count: 6,
    critical_subsidy_count: 3,
    completeness_band: 'Alta',
    decision_explanation:
      'Seguiu a politica porque o caso tinha documentacao forte, credito identificado e baixa necessidade de override.',
    follow_probability: 0.78,
    decision_minutes: 49,
  },
  'caso-5': {
    lawyer_name: 'Bianca Prado',
    firm_name: 'Silva Moura',
    assigned_to_me: true,
    lawyer_profile_label: 'Pragmatica negociadora',
    lawyer_profile_description: 'Tem vies negociador e aceita acordo com mais facilidade.',
    office_cluster: 'desempenho medio',
    adherence_base: 0.83,
    confidence_score: 0.61,
    confidence_band: 'Baixa',
    subsidy_count: 4,
    critical_subsidy_count: 2,
    completeness_band: 'Media',
    decision_explanation:
      'A trilha documental incompleta e a baixa confianca sustentam o acordo dentro da faixa recomendada.',
    follow_probability: 0.72,
    decision_minutes: 64,
  },
  'caso-6': {
    lawyer_name: 'Eduardo Bastos',
    firm_name: 'Almeida Rocha',
    assigned_to_me: false,
    lawyer_profile_label: 'Fechador de acordo',
    lawyer_profile_description: 'Tem apetite alto por acordo e busca encerrar casos cedo.',
    office_cluster: 'alto desempenho',
    adherence_base: 0.88,
    confidence_score: 0.58,
    confidence_band: 'Baixa',
    subsidy_count: 4,
    critical_subsidy_count: 1,
    completeness_band: 'Media',
    decision_explanation:
      'A falta de gravacao integral e de comprovacao independente favoreceu acordo rapido e aceite no mesmo fluxo.',
    follow_probability: 0.69,
    decision_minutes: 58,
  },
  'caso-7': {
    lawyer_name: 'Fernanda Lima',
    firm_name: 'Nogueira Bastos',
    assigned_to_me: false,
    lawyer_profile_label: 'Independente',
    lawyer_profile_description: 'Tem alta autonomia e diverge mais da recomendacao automatica.',
    office_cluster: 'autonomia alta',
    adherence_base: 0.63,
    confidence_score: 0.55,
    confidence_band: 'Baixa',
    subsidy_count: 5,
    critical_subsidy_count: 3,
    completeness_band: 'Alta',
    decision_explanation:
      'O valor alto da causa e a prova de credito foram registrados como justificativa para defender, mesmo contra a recomendacao.',
    follow_probability: 0.41,
    decision_minutes: 92,
  },
  'caso-8': {
    lawyer_name: 'Rafael Moura',
    firm_name: 'Duarte Fontes',
    assigned_to_me: false,
    lawyer_profile_label: 'Cauteloso com baixa confianca',
    lawyer_profile_description:
      'Confia no modelo quando a confianca e alta, mas revisa casos cinzentos.',
    office_cluster: 'autonomia alta',
    adherence_base: 0.66,
    confidence_score: 0.46,
    confidence_band: 'Baixa',
    subsidy_count: 3,
    critical_subsidy_count: 1,
    completeness_band: 'Media',
    decision_explanation:
      'Com contrato parcial e titularidade inconclusiva, o caminho seguro foi manter revisao humana.',
    follow_probability: 0.76,
    decision_minutes: 71,
  },
};

export { DEMO_GENERATED_AT, DEMO_MODEL_VERSION, DEMO_POLICY_VERSION, demoNegotiations };

export const demoCases: CaseDetail[] = baseCases.map((item) => {
  const meta = behaviorByCaseId[item.case_id];
  return {
    ...item,
    lawyer_name: meta.lawyer_name,
    firm_name: meta.firm_name,
    assigned_to_me: meta.assigned_to_me,
    lawyer_profile_label: meta.lawyer_profile_label,
    lawyer_profile_description: meta.lawyer_profile_description,
    office_cluster: meta.office_cluster,
    adherence_base: meta.adherence_base,
  };
});

export const demoRecommendations: Record<string, RecommendationResponse> = Object.fromEntries(
  Object.entries(baseRecommendations).map(([caseId, value]) => {
    const meta = behaviorByCaseId[caseId];
    return [
      caseId,
      {
        ...value,
        policy_version: DEMO_POLICY_VERSION,
        model_version: DEMO_MODEL_VERSION,
        generated_at: DEMO_GENERATED_AT,
        confidence_score: meta.confidence_score,
        confidence_band: meta.confidence_band,
        subsidy_count: meta.subsidy_count,
        critical_subsidy_count: meta.critical_subsidy_count,
        completeness_band: meta.completeness_band,
      } satisfies RecommendationResponse,
    ];
  }),
);

export const demoDecisions: DecisionRecord[] = baseDecisions.map((item) => {
  const meta = behaviorByCaseId[item.case_id];
  const overrideCode = item.case_id === 'caso-7' ? 'caso_caro_exigiu_postura_propria' : undefined;
  return {
    ...item,
    follow_probability: meta.follow_probability,
    decision_minutes: meta.decision_minutes,
    simulated_decision_explanation: meta.decision_explanation,
    ...(overrideCode ? { simulated_override_reason: overrideCode } : {}),
  };
});

const demoAdminRows: AdminDecisionRow[] = demoDecisions.map((decision) => {
  const caseDetail = demoCases.find((item) => item.case_id === decision.case_id)!;
  const negotiation = demoNegotiations.find((item) => item.case_id === decision.case_id);
  const recommendation = demoRecommendations[decision.case_id];
  return {
    id: decision.id,
    case_id: decision.case_id,
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
    is_local: false,
    justification: decision.justification,
    confidence_score: recommendation.confidence_score ?? null,
    confidence_band: recommendation.confidence_band ?? null,
    subsidy_count: recommendation.subsidy_count ?? null,
    critical_subsidy_count: recommendation.critical_subsidy_count ?? null,
    completeness_band: recommendation.completeness_band ?? null,
    follow_probability: decision.follow_probability ?? null,
    decision_minutes: decision.decision_minutes ?? null,
    decision_explanation: decision.simulated_decision_explanation,
    override_reason_label: decision.reason ? overrideReasonLabel(decision.reason) : null,
  };
});

const historicalOverrideReasons = [
  { label: 'Baixa confiança do modelo', value: 12820 },
  { label: 'Caso de alto valor exigiu avaliação própria', value: 5192 },
  { label: 'Avaliação jurídica individual', value: 3631 },
  { label: 'Perfil mais negociador do advogado', value: 2185 },
  { label: 'Estratégia do escritório', value: 1003 },
  { label: 'Informação nova na análise', value: 963 },
  { label: 'Estratégia autônoma do advogado', value: 355 },
] as const;

const historicalOverrideTotal = historicalOverrideReasons.reduce(
  (total, reason) => total + reason.value,
  0,
);

export const demoAdminDashboard: AdminDashboard = {
  demo_data: true,
  period: 'Base sintetica de 60.000 decisoes simuladas',
  updated_at: DEMO_GENERATED_AT,
  metrics: {
    decisions: 60000,
    adherence_rate: 0.5642,
    overrides: historicalOverrideTotal,
    settlements: 18372,
    agreement_proposals: 31700,
    acceptance_rate: 0.5793,
    average_closed_value: 4380,
    average_offered_value: 5210,
    rejected: 8127,
    counteroffers: 5205,
    baseline_cost: 118400000,
    projected_cost: 95260000,
    estimated_savings: 23140000,
    estimated_savings_rate: 0.1954,
    firm_count: 6,
    lawyer_count: 36,
  },
  distribution: [
    { label: 'Acordo', value: 31700, percentage: 0.5283 },
    { label: 'Defesa', value: 22400, percentage: 0.3733 },
    { label: 'Revisar', value: 5900, percentage: 0.0983 },
  ],
  evolution: [
    { label: 'Abr', agreement: 4020, defense: 3040 },
    { label: 'Mai', agreement: 4540, defense: 3360 },
    { label: 'Jun', agreement: 4920, defense: 3490 },
    { label: 'Jul', agreement: 5480, defense: 3810 },
    { label: 'Ago', agreement: 6120, defense: 4320 },
    { label: 'Set', agreement: 6620, defense: 4380 },
  ],
  override_reasons: historicalOverrideReasons.map((reason) => ({
    ...reason,
    percentage: reason.value / historicalOverrideTotal,
  })),
  effectiveness_outcomes: [
    { label: 'Acordos aceitos', value: 18372, percentage: 0.5793 },
    { label: 'Recusas', value: 8127, percentage: 0.2564 },
    { label: 'Contrapropostas', value: 5205, percentage: 0.1642 },
  ],
  effectiveness_savings_flow: [
    { label: 'Custo sem politica', value: 118400000 },
    { label: 'Economia estimada', value: 23140000 },
    { label: 'Custo com politica', value: 95260000 },
  ],
  effectiveness_timeline: [
    { label: 'Abr', savings: 2860000, acceptance_rate: 0.54 },
    { label: 'Mai', savings: 3340000, acceptance_rate: 0.55 },
    { label: 'Jun', savings: 3610000, acceptance_rate: 0.57 },
    { label: 'Jul', savings: 3920000, acceptance_rate: 0.58 },
    { label: 'Ago', savings: 4580000, acceptance_rate: 0.6 },
    { label: 'Set', savings: 5150000, acceptance_rate: 0.61 },
  ],
  firm_adherence: historicalFirmAdherence,
  lawyer_adherence: historicalLawyerAdherence,
  historical_simulation: {
    sample_size: 60000,
    acceptance_assumption: 0.5793,
    baseline_cost: 118400000,
    projected_cost: 95260000,
    estimated_savings: 23140000,
    description:
      'SIMULACAO HISTORICA independente: aderencia, aceite e economia foram calibrados sobre a base sintetica. O principal indicador e a economia estimada frente ao cenario-base de judicializacao.',
  },
  decisions: demoAdminRows,
};
