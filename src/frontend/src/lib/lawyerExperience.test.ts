import { describe, expect, it } from 'vitest';
import type {
  CaseSummary,
  DecisionRecord,
  NegotiationRecord,
  RecommendationResponse,
  SourceReference,
} from '../types';
import {
  buildDecisionPoints,
  lawyerCaseBucket,
  needsLawyerAction,
  nextLawyerAction,
  prioritizeLawyerCase,
  sortPrioritizedCases,
  type LawyerCaseWorkflow,
} from './lawyerExperience';

const source: SourceReference = {
  document_id: 'doc-1',
  document_name: 'Contrato',
  page: 2,
  origin: 'Dossiê do caso',
};

function recommendation(overrides: Partial<RecommendationResponse> = {}): RecommendationResponse {
  return {
    case_id: 'case-1',
    recommendation: 'DEFESA',
    loss_probability: 0.2,
    expected_condemnation: 5_000,
    expected_defense_cost: 1_000,
    settlement: null,
    reasons: ['Contrato disponível.'],
    documents: [],
    evidence: [],
    contradictions: [],
    missing_evidence: [],
    next_best_evidence: null,
    policy_version: 'policy-1',
    model_version: 'model-1',
    generated_at: '2026-09-12T12:00:00.000Z',
    demo_data: true,
    ...overrides,
  };
}

function caseItem(
  overrides: Partial<CaseSummary & LawyerCaseWorkflow> = {},
): CaseSummary & LawyerCaseWorkflow {
  return {
    case_id: 'case-1',
    case_number: '0000001-00.2026.8.00.0001',
    plaintiff: 'Pessoa Exemplo',
    city: 'Campinas',
    uf: 'SP',
    claim_value: 10_000,
    status: 'AGUARDANDO_DECISAO',
    risk_level: 'BAIXO',
    recommendation: 'DEFESA',
    updated_at: '2026-09-12T12:00:00.000Z',
    lawyer_name: 'Advogada Exemplo',
    firm_name: 'Escritório Exemplo',
    assigned_to_me: true,
    decision: null,
    negotiation: null,
    recommendationDetail: recommendation(),
    ...overrides,
  };
}

const agreementDecision: DecisionRecord = {
  id: 'decision-1',
  case_id: 'case-1',
  recommendation: 'ACORDO',
  decision: 'ACORDO',
  is_override: false,
  policy_version: 'policy-1',
  created_at: '2026-09-12T12:00:00.000Z',
};

function negotiationRecord(status: NegotiationRecord['status']): NegotiationRecord {
  return {
    id: 'negotiation-1',
    case_id: 'case-1',
    proposal_value: 4_000,
    status,
    updated_at: '2026-09-12T12:00:00.000Z',
  };
}

describe('lawyer experience helpers', () => {
  it('ranks operational urgency and impact without inventing a deadline', () => {
    const lowRisk = prioritizeLawyerCase(caseItem(), 'NOVO');
    const highRiskAgreement = prioritizeLawyerCase(
      caseItem({
        case_id: 'case-2',
        case_number: '0000002-00.2026.8.00.0001',
        claim_value: 25_000,
        risk_level: 'ALTO',
        recommendation: 'ACORDO',
        recommendationDetail: recommendation({
          case_id: 'case-2',
          recommendation: 'ACORDO',
          missing_evidence: ['Extrato', 'Aceite', 'Prova de vida'],
        }),
      }),
      'NOVO',
    );

    expect(sortPrioritizedCases([lowRisk, highRiskAgreement])[0].case_id).toBe('case-2');
    expect(highRiskAgreement.priorityReasons.slice(0, 3)).toEqual([
      'Risco alto',
      '3 pontos a confirmar',
      'Acordo recomendado',
    ]);
    expect(highRiskAgreement.priorityReasons.join(' ')).not.toMatch(/prazo/i);
  });

  it('maps every real workflow state to its next operational action', () => {
    const newCase = caseItem();
    expect(needsLawyerAction(newCase)).toBe(true);
    expect(nextLawyerAction(newCase, 'NOVO')).toBe('Analisar agora');
    expect(nextLawyerAction(newCase, 'VISUALIZADO')).toBe('Continuar análise');

    const review = caseItem({
      recommendation: 'REVISAR',
      recommendationDetail: recommendation({
        recommendation: 'REVISAR',
        missing_evidence: ['Contrato completo'],
      }),
    });
    expect(nextLawyerAction(review, 'VISUALIZADO')).toBe('Pedir evidência');

    const decidedAgreement = caseItem({
      status: 'DECISAO_REGISTRADA',
      recommendation: 'ACORDO',
      decision: agreementDecision,
    });
    expect(needsLawyerAction(decidedAgreement)).toBe(true);
    expect(nextLawyerAction(decidedAgreement, 'DECISAO_REGISTRADA')).toBe('Registrar proposta');

    const negotiating = caseItem({
      status: 'EM_NEGOCIACAO',
      recommendation: 'ACORDO',
      decision: agreementDecision,
      negotiation: negotiationRecord('CONTRAPROPOSTA'),
    });
    expect(nextLawyerAction(negotiating, 'EM_NEGOCIACAO')).toBe('Continuar negociação');
    expect(needsLawyerAction(negotiating)).toBe(true);

    const concluded = { ...negotiating, negotiation: negotiationRecord('ACEITA') };
    expect(nextLawyerAction(concluded, 'CONCLUIDO')).toBe('Ver processo');
    expect(needsLawyerAction(concluded)).toBe(false);
  });

  it('separates cases into analysis, progress and finished without duplicates', () => {
    const analysis = caseItem();
    const agreementWithoutProposal = caseItem({
      status: 'DECISAO_REGISTRADA',
      recommendation: 'ACORDO',
      decision: agreementDecision,
    });
    const pendingNegotiation = caseItem({
      status: 'EM_NEGOCIACAO',
      recommendation: 'ACORDO',
      decision: agreementDecision,
      negotiation: negotiationRecord('PENDENTE'),
    });
    const defenseDecision = caseItem({
      status: 'DECISAO_REGISTRADA',
      decision: { ...agreementDecision, recommendation: 'DEFESA', decision: 'DEFESA' },
    });
    const reviewDecision = caseItem({
      status: 'DECISAO_REGISTRADA',
      decision: { ...agreementDecision, recommendation: 'REVISAR', decision: 'REVISAR' },
    });
    const acceptedAgreement = {
      ...pendingNegotiation,
      status: 'CONCLUIDO' as const,
      negotiation: negotiationRecord('ACEITA'),
    };

    expect(lawyerCaseBucket(analysis)).toBe('analysis');
    expect(lawyerCaseBucket(agreementWithoutProposal)).toBe('progress');
    expect(lawyerCaseBucket(pendingNegotiation)).toBe('progress');
    expect(lawyerCaseBucket(defenseDecision)).toBe('finished');
    expect(lawyerCaseBucket(reviewDecision)).toBe('finished');
    expect(lawyerCaseBucket(acceptedAgreement)).toBe('finished');
  });

  it('builds the three decision points only from case content and preserves sources', () => {
    const riskTitle = 'Prova de vida ausente';
    const riskDescription = 'O documento não contém validação de liveness.';
    const defenseTitle = 'Crédito identificado';
    const defenseDescription = 'O extrato registra o crédito.';
    const nextTitle = 'Obter extrato independente';
    const nextDescription = 'Confirmar recebimento na conta do titular.';
    const simulationText = 'Texto ilustrativo que não pode virar fato.';
    const data = recommendation({
      evidence: [
        {
          id: 'risk',
          kind: 'RISCO',
          title: riskTitle,
          description: riskDescription,
          source,
        },
        {
          id: 'favorable',
          kind: 'FAVORAVEL',
          title: defenseTitle,
          description: defenseDescription,
          source,
        },
      ],
      next_best_evidence: {
        title: nextTitle,
        description: nextDescription,
        simulation: { hypothesis: simulationText, outcome: simulationText },
      },
    });

    const points = buildDecisionPoints(data);
    expect(points.map((point) => point.label)).toEqual([
      'A favor de acordo',
      'A favor de defesa',
      'Pode mudar a decisão',
    ]);
    expect(points[0]).toMatchObject({ title: riskTitle, detail: riskDescription, source });
    expect(points[1]).toMatchObject({ title: defenseTitle, detail: defenseDescription, source });
    expect(points[2]).toMatchObject({ title: nextTitle, detail: nextDescription });
    expect(JSON.stringify(points)).not.toContain(simulationText);
  });
});
