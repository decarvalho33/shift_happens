import { describe, expect, it } from 'vitest';
import type {
  AdminDashboard,
  AdminDecisionRow,
  CaseDetail,
  DecisionRecord,
  NegotiationRecord,
  RecommendationResponse,
} from '../types';
import {
  DeterministicPolicyCopilot,
  PolicyCopilotInputError,
  parseAdminWhatIfScenario,
  parseLawyerWhatIfScenario,
  respondWithPolicyCopilot,
} from './policyCopilot';
import type { AdminCopilotRequest, LawyerCopilotRequest } from './policyCopilot.types';

const caseDetail: CaseDetail = {
  case_id: 'case-1',
  case_number: '0001234-56.2026.8.26.0001',
  plaintiff: 'Pessoa Autora',
  city: 'Campinas',
  uf: 'SP',
  claim_value: 20_000,
  status: 'EM_NEGOCIACAO',
  risk_level: 'ALTO',
  recommendation: 'ACORDO',
  updated_at: '2026-09-10T12:00:00.000Z',
  lawyer_name: 'Advogada Responsável',
  firm_name: 'Escritório Teste',
  assigned_to_me: true,
  subject: 'Empréstimo não reconhecido',
  summary: 'A parte autora contesta a contratação.',
  received_at: '2026-09-01T12:00:00.000Z',
  documents: [
    {
      id: 'doc-contract',
      name: 'Contrato digital',
      category: 'Contrato',
      status: 'PRESENTE',
      page_count: 4,
    },
  ],
};

const recommendation: RecommendationResponse = {
  case_id: 'case-1',
  recommendation: 'ACORDO',
  loss_probability: 0.72,
  expected_condemnation: 12_600,
  expected_defense_cost: 9_072,
  settlement: { opening: 4_500, target: 6_000, ceiling: 7_500 },
  reasons: ['Formalização incompleta.', 'Comprovação de crédito inconclusiva.'],
  documents: caseDetail.documents,
  evidence: [
    {
      id: 'evidence-1',
      kind: 'RISCO',
      title: 'Assinatura sem validação independente',
      description: 'O contrato não contém validação independente da assinatura.',
      source: {
        document_id: 'doc-contract',
        document_name: 'Contrato digital',
        page: 2,
        origin: 'Autos do processo',
        excerpt: 'Assinatura eletrônica sem certificado independente.',
      },
    },
  ],
  contradictions: [
    {
      id: 'contradiction-1',
      title: 'Titularidade da conta',
      description: 'A alegação diverge da consulta bancária.',
      allegation: {
        text: 'A parte afirma não possuir a conta.',
        source: {
          document_id: 'doc-petition',
          document_name: 'Petição inicial',
          page: 3,
          origin: 'Autos do processo',
        },
      },
      documentary_fact: {
        text: 'A consulta atribui a conta à parte.',
        source: {
          document_id: 'doc-bacen',
          document_name: 'Consulta BACEN',
          page: 1,
          origin: 'Subsídio bancário',
        },
      },
    },
  ],
  missing_evidence: ['Vídeo de prova de vida.'],
  next_best_evidence: {
    title: 'Solicitar prova de vida',
    description: 'Obter o vídeo vinculado à contratação.',
    simulation: {
      hypothesis: 'A prova mudaria a recomendação.',
      outcome: 'DEFESA',
    },
  },
  policy_version: 'policy-v1',
  model_version: 'model-v1',
  generated_at: '2026-09-10T12:00:00.000Z',
  demo_data: true,
};

const decision: DecisionRecord = {
  id: 'decision-1',
  case_id: 'case-1',
  recommendation: 'ACORDO',
  decision: 'ACORDO',
  is_override: false,
  policy_version: 'policy-v1',
  created_at: '2026-09-10T13:00:00.000Z',
};

const negotiation: NegotiationRecord = {
  id: 'negotiation-1',
  case_id: 'case-1',
  proposal_value: 5_500,
  status: 'PENDENTE',
  updated_at: '2026-09-10T14:00:00.000Z',
};

const adminRow: AdminDecisionRow = {
  id: 'admin-row-1',
  case_id: 'case-1',
  case_number: caseDetail.case_number,
  plaintiff: caseDetail.plaintiff,
  lawyer_name: caseDetail.lawyer_name,
  firm_name: caseDetail.firm_name,
  uf: 'SP',
  recommendation: 'ACORDO',
  decision: 'ACORDO',
  adherent: true,
  suggested_value: 6_000,
  realized_value: 5_500,
  status: 'ACEITA',
  created_at: '2026-09-10T13:00:00.000Z',
};

const divergentRow: AdminDecisionRow = {
  ...adminRow,
  id: 'admin-row-2',
  case_id: 'case-2',
  case_number: '0002234-56.2026.8.26.0002',
  plaintiff: 'Outra Pessoa',
  firm_name: 'Escritório com desvio',
  lawyer_profile_label: 'Perfil independente',
  recommendation: 'DEFESA',
  decision: 'ACORDO',
  adherent: false,
  suggested_value: 4_000,
  realized_value: null,
  status: 'PENDENTE',
  confidence_score: 0.9,
  completeness_band: 'Baixa',
  override_reason_label: 'Estratégia processual',
  justification: '',
};

const secondDivergentRow: AdminDecisionRow = {
  ...divergentRow,
  id: 'admin-row-3',
  case_id: 'case-3',
  case_number: '0003234-56.2026.8.26.0003',
  plaintiff: 'Terceira Pessoa',
  override_reason_label: 'Nova evidência',
  confidence_score: 0.7,
  completeness_band: 'Alta',
};

const sampleRows = [adminRow, divergentRow, secondDivergentRow];

const dashboard: AdminDashboard = {
  demo_data: true,
  period: '60 mil decisões simuladas',
  updated_at: '2026-09-10T15:00:00.000Z',
  metrics: {
    decisions: 60_000,
    adherence_rate: 0.6,
    overrides: 24_000,
    settlements: 18_000,
    agreement_proposals: 30_000,
    acceptance_rate: 0.6,
    average_closed_value: 4_500,
    average_offered_value: 5_000,
    rejected: 8_000,
    counteroffers: 4_000,
    baseline_cost: 120_000_000,
    projected_cost: 96_000_000,
    estimated_savings: 24_000_000,
    estimated_savings_rate: 0.2,
  },
  distribution: [],
  evolution: [],
  override_reasons: [],
  effectiveness_outcomes: [],
  effectiveness_savings_flow: [],
  effectiveness_timeline: [],
  historical_simulation: {
    sample_size: 60_000,
    acceptance_assumption: 0.6,
    baseline_cost: 120_000_000,
    projected_cost: 96_000_000,
    estimated_savings: 24_000_000,
    description: 'Cenário histórico simulado.',
  },
  decisions: [adminRow],
};

function lawyerRequest(overrides: Partial<LawyerCopilotRequest> = {}): LawyerCopilotRequest {
  return {
    audience: 'LAWYER',
    question: 'Por que a política recomenda acordo?',
    context: { caseDetail, recommendation, decision, negotiation },
    ...overrides,
  };
}

function adminRequest(overrides: Partial<AdminCopilotRequest> = {}): AdminCopilotRequest {
  return {
    audience: 'ADMIN',
    question: 'Qual é a visão geral?',
    context: {
      dashboard,
      rows: dashboard.decisions,
      rowScope: { description: 'todos os registros visíveis', filters: {} },
    },
    ...overrides,
  };
}

describe('deterministic policy copilot', () => {
  it('answers a lawyer only from the supplied recommendation and emits page-level citations', () => {
    const response = respondWithPolicyCopilot(lawyerRequest());

    expect(response).toMatchObject({
      audience: 'LAWYER',
      intent: 'RECOMMENDATION',
      mode: 'FACTUAL',
      status: 'ANSWERED',
    });
    expect(response.facts.find((item) => item.key === 'loss_probability')?.value).toBe(0.72);
    expect(response.citations[0]).toEqual({
      marker: '[1]',
      documentId: 'doc-contract',
      documentName: 'Contrato digital',
      page: 2,
      origin: 'Autos do processo',
      excerpt: 'Assinatura eletrônica sem certificado independente.',
      claims: ['Assinatura sem validação independente'],
    });
    expect(response.answer).toContain('[1]');
    expect(JSON.stringify(response)).not.toContain('A prova mudaria a recomendação.');
    expect(response.limitations).toContain(
      'A hipótese de próxima evidência foi excluída dos fatos porque o próprio contrato a identifica como simulação.',
    );
  });

  it('adds both sides of a contradiction to evidence citations', () => {
    const response = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Quais documentos, provas e contradições existem?' }),
    );

    expect(response.intent).toBe('EVIDENCE');
    expect(response.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          documentName: 'Petição inicial',
          page: 3,
          origin: 'Autos do processo',
        }),
        expect.objectContaining({
          documentName: 'Consulta BACEN',
          page: 1,
          origin: 'Subsídio bancário',
        }),
      ]),
    );
  });

  it('answers natural document and contradiction questions from matching case material', () => {
    const contract = respondWithPolicyCopilot(lawyerRequest({ question: 'O que diz o contrato?' }));
    const contradiction = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Qual é a contradição sobre a titularidade da conta?' }),
    );
    const page = respondWithPolicyCopilot(lawyerRequest({ question: 'O que consta na página 2?' }));

    expect(contract).toMatchObject({ intent: 'EVIDENCE', status: 'ANSWERED' });
    expect(contract.answer).toContain('O contrato não contém validação independente');
    expect(contract.citations.map((item) => item.documentName)).toEqual(['Contrato digital']);
    expect(contradiction.answer).toContain('alegação: A parte afirma não possuir a conta');
    expect(contradiction.answer).toContain('fato documental: A consulta atribui a conta à parte');
    expect(contradiction.citations.map((item) => item.documentName)).toEqual([
      'Petição inicial',
      'Consulta BACEN',
    ]);
    expect(page.intent).toBe('EVIDENCE');
    expect(page.citations[0]).toMatchObject({ documentName: 'Contrato digital', page: 2 });
  });

  it('reads an available document page and reports when its specific origin is absent', () => {
    const documentWithPage = {
      ...caseDetail.documents[0]!,
      demo_pages: [
        {
          page: 1,
          title: 'Contrato digital',
          paragraphs: ['A contratação foi registrada em 10 de setembro.'],
          fields: [{ label: 'Canal', value: 'Aplicativo' }],
        },
      ],
    };
    const response = respondWithPolicyCopilot(
      lawyerRequest({
        question: 'O que diz o contrato digital na página 1?',
        context: {
          caseDetail: { ...caseDetail, documents: [documentWithPage] },
          recommendation: {
            ...recommendation,
            documents: [documentWithPage],
            evidence: [],
            contradictions: [],
          },
          decision,
          negotiation,
        },
      }),
    );

    expect(response).toMatchObject({ intent: 'EVIDENCE', status: 'ANSWERED' });
    expect(response.answer).toContain('A contratação foi registrada em 10 de setembro');
    expect(response.answer).toContain('Canal: Aplicativo');
    expect(response.citations[0]).toMatchObject({
      documentName: 'Contrato digital',
      page: 1,
      origin: 'Origem específica não informada nos dados do caso',
    });
  });

  it('answers the three decision points with only their relevant document sources', () => {
    const response = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Quais são os 3 pontos antes de decidir?' }),
    );

    expect(response.intent).toBe('DECISION_POINTS');
    expect(response.facts.map((item) => item.label)).toEqual([
      'A favor de acordo',
      'A favor de defesa',
      'Pode mudar a decisão',
    ]);
    expect(response.citations.map((item) => item.documentName)).toEqual([
      'Contrato digital',
      'Consulta BACEN',
    ]);
    expect(response.citations.map((item) => item.documentName)).not.toContain('Petição inicial');

    const defense = respondWithPolicyCopilot(
      lawyerRequest({ question: 'O que favorece a defesa?' }),
    );
    expect(defense.intent).toBe('DEFENSE_FACTORS');
    expect(defense.citations.map((item) => item.documentName)).toEqual(['Consulta BACEN']);
  });

  it('returns case summary, next action, missing evidence and agreement range without inventing facts', () => {
    const summary = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Resuma os fatos do caso.' }),
    );
    const naturalSummary = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Quais são os principais fatos?' }),
    );
    const nextAction = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Qual é a próxima ação?' }),
    );
    const missing = respondWithPolicyCopilot(lawyerRequest({ question: 'O que falta confirmar?' }));
    const range = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Qual é a faixa, abertura e teto?' }),
    );
    const risk = respondWithPolicyCopilot(lawyerRequest({ question: 'Explique o risco.' }));
    const suggestedValue = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Qual é o valor sugerido?' }),
    );

    expect(summary).toMatchObject({ intent: 'CASE_SUMMARY', citations: [] });
    expect(naturalSummary).toMatchObject({ intent: 'CASE_SUMMARY', citations: [] });
    expect(summary.facts.find((item) => item.key === 'claim_value')?.value).toBe(20_000);
    expect(nextAction).toMatchObject({ intent: 'NEXT_ACTION' });
    expect(nextAction.answer).toContain('Atualizar a negociação');
    expect(missing).toMatchObject({ intent: 'MISSING_EVIDENCE', citations: [] });
    expect(JSON.stringify(missing)).not.toContain('A prova mudaria a recomendação.');
    expect(range).toMatchObject({ intent: 'SETTLEMENT_RANGE', citations: [] });
    expect(range.facts.find((item) => item.key === 'settlement_ceiling')?.value).toBe(7_500);
    expect(risk).toMatchObject({ intent: 'RECOMMENDATION' });
    expect(risk.facts.find((item) => item.key === 'loss_probability')?.value).toBe(0.72);
    expect(risk.facts.find((item) => item.key === 'expected_defense_cost')?.value).toBe(9_072);
    expect(suggestedValue).toMatchObject({ intent: 'SETTLEMENT_RANGE' });
    expect(suggestedValue.facts.find((item) => item.key === 'settlement_target')?.value).toBe(
      6_000,
    );
  });

  it('blocks a case that is not assigned to the lawyer before producing any answer', () => {
    const otherCase = { ...caseDetail, assigned_to_me: false };

    expect(() =>
      respondWithPolicyCopilot(
        lawyerRequest({
          context: { caseDetail: otherCase, recommendation, decision, negotiation },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PolicyCopilotInputError>>({ code: 'CASE_NOT_ASSIGNED' }),
    );
  });

  it('rejects mixed case context', () => {
    expect(() =>
      respondWithPolicyCopilot(
        lawyerRequest({
          context: {
            caseDetail,
            recommendation,
            decision: { ...decision, case_id: 'another-case' },
            negotiation,
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PolicyCopilotInputError>>({ code: 'CONTEXT_MISMATCH' }),
    );
  });

  it('returns unavailable instead of inventing a version comparison or defense result', () => {
    const response = respondWithPolicyCopilot(
      lawyerRequest({ question: 'A versão nova melhorou o resultado da defesa?' }),
    );

    expect(response.status).toBe('UNAVAILABLE');
    expect(response.facts).toEqual([]);
    expect(response.answer).toContain('não contém versões comparáveis');
  });

  it('labels lawyer what-if output as simulation and exposes every derived formula', () => {
    const response = respondWithPolicyCopilot(
      lawyerRequest({
        question: 'E se a proposta fosse diferente?',
        scenario: { type: 'PROPOSAL_VALUE', proposalValue: 7_000 },
      }),
    );

    expect(response).toMatchObject({
      intent: 'WHAT_IF',
      mode: 'SIMULATION',
      status: 'ANSWERED',
      label: 'SIMULAÇÃO',
    });
    expect(response.title).toContain('SIMULAÇÃO');
    expect(response.facts.find((item) => item.key === 'range_position')?.value).toBe(
      'dentro da faixa',
    );
    expect(response.calculations.find((item) => item.key === 'delta_to_target')).toMatchObject({
      formula: 'proposta simulada − alvo da política',
      result: 1_000,
    });
    expect(response.assumptions.join(' ')).toContain('Não foi estimada probabilidade de aceite');
  });

  it('does not infer an unstructured what-if value from free text', () => {
    const response = respondWithPolicyCopilot(
      lawyerRequest({ question: 'E se o valor passasse de 30 para 35?' }),
    );

    expect(response).toMatchObject({ intent: 'WHAT_IF', status: 'UNAVAILABLE' });
    expect(response.answer).toContain('cenário estruturado');
    expect(response.calculations).toEqual([]);
  });

  it('parses only an explicit BRL proposal into a lawyer scenario', () => {
    expect(parseLawyerWhatIfScenario('E se a proposta fosse R$ 6.000,50?')).toEqual({
      type: 'PROPOSAL_VALUE',
      proposalValue: 6_000.5,
    });
    expect(parseLawyerWhatIfScenario('E se o limite mudasse de 30 para 35?')).toBeNull();
    expect(parseLawyerWhatIfScenario('Proposta de R$ 6.5')).toBeNull();
    expect(parseLawyerWhatIfScenario('A proposta registrada foi R$ 6.000?')).toBeNull();

    const factualProposal = respondWithPolicyCopilot(
      lawyerRequest({ question: 'A proposta registrada foi R$ 5.500?' }),
    );
    expect(factualProposal).toMatchObject({ intent: 'NEGOTIATION', mode: 'FACTUAL' });

    const response = respondWithPolicyCopilot(
      lawyerRequest({ question: 'Simule uma proposta de R$ 6.000.' }),
    );
    expect(response).toMatchObject({ intent: 'WHAT_IF', mode: 'SIMULATION' });
    expect(response.facts.find((item) => item.key === 'simulated_proposal')?.value).toBe(6_000);
  });

  it('uses aggregate dashboard KPIs without recomputing them from the detailed row sample', () => {
    const response = respondWithPolicyCopilot(
      adminRequest({ question: 'Qual a aderência e quantos overrides existem?' }),
    );

    expect(response).toMatchObject({ audience: 'ADMIN', intent: 'ADHERENCE', status: 'ANSWERED' });
    expect(response.facts.find((item) => item.key === 'decisions')?.value).toBe(60_000);
    expect(response.facts.find((item) => item.key === 'overrides')?.value).toBe(24_000);
    expect(response.basis[0]).toMatchObject({
      source: 'DASHBOARD_METRICS',
      recordCount: 60_000,
    });
    expect(response.limitations[0]).toContain(
      'o recorte “todos os registros visíveis” contém 1 linha',
    );
  });

  it('ranks segment divergence from the supplied row scope and always reports its N', () => {
    const response = respondWithPolicyCopilot(
      adminRequest({
        question: 'Qual escritório mais diverge?',
        context: {
          dashboard,
          rows: sampleRows,
          rowScope: {
            description: 'SP e RJ nos últimos 90 dias',
            filters: { uf: 'SP,RJ', period: 90 },
          },
        },
      }),
    );

    expect(response).toMatchObject({ intent: 'SEGMENTS', status: 'ANSWERED' });
    expect(response.answer).toContain('N=3');
    expect(response.answer).toContain('Escritório com desvio');
    expect(response.facts.find((item) => item.key === 'segment_override_rate')?.value).toBe(1);
    expect(response.basis).toEqual([
      expect.objectContaining({
        source: 'ADMIN_DECISION_ROW',
        description: expect.stringContaining('uf=SP,RJ, period=90'),
        recordCount: 3,
      }),
    ]);
  });

  it('derives override reasons and review priorities from the current administrative rows', () => {
    const context = {
      dashboard,
      rows: sampleRows,
      rowScope: { description: 'amostra operacional', filters: {} },
    };
    const reasons = respondWithPolicyCopilot(
      adminRequest({ question: 'Quais os motivos de divergência?', context }),
    );
    const review = respondWithPolicyCopilot(
      adminRequest({ question: 'O que devo priorizar para revisão?', context }),
    );

    expect(reasons.intent).toBe('OVERRIDE_REASONS');
    expect(reasons.answer).toContain('N=3');
    expect(reasons.facts.map((item) => item.label)).toEqual([
      'Fato ou documento novo',
      'Fundamento jurídico ou estratégia processual',
    ]);
    expect(review.intent).toBe('REVIEW');
    expect(review.facts.find((item) => item.key === 'overrides_without_justification')?.value).toBe(
      2,
    );
    expect(review.facts.find((item) => item.key === 'high_confidence_overrides')?.value).toBe(1);
    expect(review.limitations.join(' ')).toContain('não mede mérito jurídico');

    const normalizedReasons = respondWithPolicyCopilot(
      adminRequest({
        question: 'Quais os motivos de divergência?',
        context: {
          dashboard,
          rows: [
            divergentRow,
            { ...secondDivergentRow, override_reason_label: 'ESTRATEGIA_PROCESSUAL' },
          ],
          rowScope: { description: 'motivos mistos', filters: {} },
        },
      }),
    );
    expect(normalizedReasons.facts).toEqual([
      expect.objectContaining({
        label: 'Fundamento jurídico ou estratégia processual',
        value: 2,
      }),
    ]);
  });

  it('reports unavailable for adherence trend and missing policy/model metadata', () => {
    const trend = respondWithPolicyCopilot(
      adminRequest({ question: 'A aderência caiu desde o período anterior?' }),
    );
    const metadata = respondWithPolicyCopilot(
      adminRequest({ question: 'Qual versão da política e do modelo está em uso?' }),
    );

    expect(trend).toMatchObject({ intent: 'TREND', status: 'UNAVAILABLE' });
    expect(trend.answer).toContain('não contém uma série histórica de aderência');
    expect(metadata).toMatchObject({ intent: 'POLICY_METADATA', status: 'UNAVAILABLE' });
    expect(metadata.answer).toContain('não contêm versão');
  });

  it('collects optional policy/model versions from rows without comparing performance', () => {
    const versionedRow = {
      ...adminRow,
      policy_version: 'policy-v2',
      model_version: 'model-v3',
    };
    const response = respondWithPolicyCopilot(
      adminRequest({
        question: 'Qual versão da política e do modelo está em uso?',
        context: {
          dashboard,
          rows: [versionedRow],
          rowScope: { description: 'linha versionada', filters: {} },
        },
      }),
    );

    expect(response).toMatchObject({ intent: 'POLICY_METADATA', status: 'ANSWERED' });
    expect(response.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'policy_versions', value: 'policy-v2' }),
        expect.objectContaining({ key: 'model_versions', value: 'model-v3' }),
      ]),
    );
    expect(response.limitations.join(' ')).toContain('não há dados para comparar desempenho');

    const aggregate = respondWithPolicyCopilot(
      adminRequest({
        question: 'Qual é a aderência?',
        context: {
          dashboard,
          rows: [versionedRow],
          rowScope: { description: 'linha versionada', filters: {} },
        },
      }),
    );
    expect(aggregate.provenance.policyVersion).toBeUndefined();
    expect(aggregate.provenance.modelVersion).toBeUndefined();
  });

  it('answers a selected administrative case from its AdminDecisionRow', () => {
    const response = respondWithPolicyCopilot(
      adminRequest({
        question: 'Mostre este processo.',
        context: {
          dashboard,
          rows: dashboard.decisions,
          rowScope: { description: 'todos os registros visíveis', filters: {} },
          selectedRow: adminRow,
        },
      }),
    );

    expect(response.intent).toBe('DECISION');
    expect(response.facts.find((item) => item.key === 'realized_value')).toMatchObject({
      value: 5_500,
      source: 'ADMIN_DECISION_ROW',
    });
    expect(response.basis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'ADMIN_DECISION_ROW', recordCount: 1 }),
      ]),
    );
  });

  it('compares lawyers and routes the “funcionando pior” prompt to the detailed slice', () => {
    const rows = [
      adminRow,
      { ...divergentRow, lawyer_name: 'Advogada com desvio' },
      { ...secondDivergentRow, lawyer_name: 'Advogada com desvio' },
    ];
    const context = {
      dashboard,
      rows,
      rowScope: { description: 'recorte operacional', filters: { period: 90 } },
    };
    const lawyerComparison = respondWithPolicyCopilot(
      adminRequest({ question: 'Qual advogado mais diverge?', context }),
    );
    const worstSegment = respondWithPolicyCopilot(
      adminRequest({ question: 'Onde a política está funcionando pior?', context }),
    );

    expect(lawyerComparison).toMatchObject({ intent: 'SEGMENTS', status: 'ANSWERED' });
    expect(lawyerComparison.answer).toContain('Advogada com desvio');
    expect(lawyerComparison.answer).toContain('N=3');
    expect(worstSegment).toMatchObject({ intent: 'SEGMENTS', status: 'ANSWERED' });
    expect(worstSegment.title).toBe('Divergência por escritório');
    expect(worstSegment.limitations.join(' ')).toContain('não mede resultado financeiro');
  });

  it('compares identified policy versions and refuses a one-version comparison', () => {
    const comparableRows = [
      { ...adminRow, policy_version: 'policy-v1', model_version: 'model-v1' },
      {
        ...divergentRow,
        policy_version: 'policy-v2',
        model_version: 'model-v2',
      },
    ];
    const compared = respondWithPolicyCopilot(
      adminRequest({
        question: 'Compare as versões da política e diga qual funciona pior.',
        context: {
          dashboard,
          rows: comparableRows,
          rowScope: { description: 'duas versões', filters: {} },
        },
      }),
    );
    const insufficient = respondWithPolicyCopilot(
      adminRequest({
        question: 'Qual versão da política funciona pior?',
        context: {
          dashboard,
          rows: [comparableRows[0]!],
          rowScope: { description: 'uma versão', filters: {} },
        },
      }),
    );

    expect(compared).toMatchObject({ intent: 'SEGMENTS', status: 'ANSWERED' });
    expect(compared.answer).toContain('policy-v2');
    expect(compared.provenance.policyVersion).toBe('policy-v1, policy-v2');
    expect(insufficient).toMatchObject({ intent: 'SEGMENTS', status: 'UNAVAILABLE' });
    expect(insufficient.answer).toContain('ao menos duas versões');
    expect(insufficient.basis[0]).toMatchObject({ source: 'ADMIN_DECISION_ROW', recordCount: 1 });
    expect(insufficient.provenance.policyVersion).toBe('policy-v1');
  });

  it('derives an administrative acceptance scenario from aggregate metrics and labels it simulation', () => {
    const response = respondWithPolicyCopilot(
      adminRequest({
        question: 'Simule uma nova taxa de aceite.',
        scenario: { type: 'ACCEPTANCE_RATE', acceptanceRate: 0.75 },
      }),
    );

    expect(response).toMatchObject({
      intent: 'WHAT_IF',
      mode: 'SIMULATION',
      label: 'SIMULAÇÃO',
      status: 'ANSWERED',
    });
    expect(
      response.calculations.find((item) => item.key === 'projected_accepted_settlements'),
    ).toMatchObject({ result: 22_500 });
    expect(response.calculations.find((item) => item.key === 'projected_savings')).toMatchObject({
      result: 30_000_000,
    });
    expect(response.assumptions).toContain(
      'A simulação é uma extrapolação aritmética e não demonstra causalidade.',
    );
  });

  it('reports agreement outcomes, suggested versus realized value and financial impact', () => {
    const outcomes = respondWithPolicyCopilot(
      adminRequest({ question: 'Quantos acordos foram propostos, aceitos e recusados?' }),
    );
    const values = respondWithPolicyCopilot(
      adminRequest({ question: 'Compare valor sugerido x realizado.' }),
    );
    const impact = respondWithPolicyCopilot(
      adminRequest({ question: 'Qual é o impacto financeiro da política?' }),
    );

    expect(outcomes.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'settlements', value: 18_000 }),
        expect.objectContaining({ key: 'rejected', value: 8_000 }),
        expect.objectContaining({ key: 'counteroffers', value: 4_000 }),
      ]),
    );
    expect(values).toMatchObject({ intent: 'EFFECTIVENESS', title: 'Valor sugerido x realizado' });
    expect(values.facts.find((item) => item.key === 'average_offered_value')?.value).toBe(5_000);
    expect(values.facts.find((item) => item.key === 'average_closed_value')?.value).toBe(4_500);
    expect(impact).toMatchObject({ intent: 'EFFECTIVENESS', title: 'Impacto financeiro' });
    expect(impact.facts.find((item) => item.key === 'estimated_savings')?.value).toBe(24_000_000);
  });

  it('parses explicit admin rates but never treats a policy-limit change as acceptance or adherence', () => {
    expect(parseAdminWhatIfScenario('Simule a taxa de aceitação em 65%.')).toEqual({
      type: 'ACCEPTANCE_RATE',
      acceptanceRate: 0.65,
    });
    expect(parseAdminWhatIfScenario('E se a aderência fosse para 70%?')).toEqual({
      type: 'ADHERENCE_RATE',
      adherenceRate: 0.7,
    });
    expect(parseAdminWhatIfScenario('E se o limite de acordo mudasse de 30 → 35?')).toBeNull();
    expect(
      respondWithPolicyCopilot(
        adminRequest({
          question: 'O que aconteceria se aumentássemos o limite de acordo de 30% para 35%?',
        }),
      ).status,
    ).toBe('UNAVAILABLE');
    expect(parseAdminWhatIfScenario('Taxa de aceite de 60% para 65%')).toBeNull();
    expect(parseAdminWhatIfScenario('A taxa atual de aceite é 65%?')).toBeNull();

    expect(
      respondWithPolicyCopilot(adminRequest({ question: 'A taxa atual de aceite é 65%?' })).mode,
    ).toBe('FACTUAL');

    const parsed = respondWithPolicyCopilot(
      adminRequest({ question: 'Simule a taxa de aceite em 65%.' }),
    );
    const unsupported = respondWithPolicyCopilot(
      adminRequest({ question: 'E se o limite de acordo mudasse de 30 → 35?' }),
    );
    expect(parsed).toMatchObject({ intent: 'WHAT_IF', mode: 'SIMULATION', status: 'ANSWERED' });
    expect(parsed.facts.find((item) => item.key === 'simulated_acceptance_rate')?.value).toBe(0.65);
    expect(unsupported).toMatchObject({ intent: 'WHAT_IF', status: 'UNAVAILABLE' });
    expect(unsupported.calculations).toEqual([]);
  });

  it('validates scenario rates and exposes the async provider boundary', async () => {
    expect(() =>
      respondWithPolicyCopilot(
        adminRequest({
          scenario: { type: 'ADHERENCE_RATE', adherenceRate: 1.2 },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<PolicyCopilotInputError>>({ code: 'INVALID_SCENARIO' }),
    );

    const provider = new DeterministicPolicyCopilot();
    await expect(provider.respond(adminRequest())).resolves.toMatchObject({
      audience: 'ADMIN',
      status: 'ANSWERED',
      provenance: { engine: 'deterministic-policy-copilot', version: '1.0.0' },
    });
  });
});
