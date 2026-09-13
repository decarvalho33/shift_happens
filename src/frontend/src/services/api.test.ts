// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  DATA_CHANGED_EVENT,
  DEMO_STORAGE_KEY,
  getAdminDashboard,
  getCase,
  getCases,
  getDecision,
  getNegotiation,
  getRecommendation,
  resetDemoData,
  submitLawyerDecision,
  submitNegotiation,
  submitOverride,
} from './api';
import { lossProbabilityForCase } from '../lib/riskModel';

beforeEach(async () => {
  await resetDemoData();
});

describe('demonstration API', () => {
  it('provides ten cases and evidence whose sources resolve to a preview or attached PDF', async () => {
    const cases = await getCases();
    expect(cases).toHaveLength(10);
    const recommendations = await Promise.all(cases.map((item) => getRecommendation(item.case_id)));
    for (const recommendation of recommendations) {
      expect(recommendation.demo_data).toBe(true);
      expect(recommendation.documents.length).toBeGreaterThan(0);
      expect(recommendation.next_best_evidence?.simulation?.outcome).toContain('SIMULAÇÃO');
      const sources = [
        ...recommendation.evidence.map((item) => item.source),
        ...recommendation.contradictions.flatMap((item) => [
          item.allegation.source,
          item.documentary_fact.source,
        ]),
      ];
      for (const source of sources) {
        const document = recommendation.documents.find((item) => item.id === source.document_id);
        expect(document).toBeDefined();
        expect(document?.name).toBe(source.document_name);
        expect(source.page).toBeGreaterThanOrEqual(1);
        expect(source.page).toBeLessThanOrEqual(document?.page_count ?? 0);
        if (document?.url) {
          expect(document.url).toMatch(/\.pdf$/);
          expect(source.origin).toContain('PDF');
        } else {
          const page = document?.demo_pages?.find((item) => item.page === source.page);
          expect(page).toBeDefined();
          expect(page?.paragraphs).toContain(source.excerpt);
          expect(source.origin).toContain('MOCK');
        }
      }
      for (const document of recommendation.documents) {
        if (document.url) expect(document.page_count).toBeGreaterThan(0);
        else expect(document.page_count).toBe(document.demo_pages?.length ?? 0);
        if (document.status === 'AUSENTE') {
          expect(document.demo_pages).toBeUndefined();
          expect(document.url).toBeUndefined();
        }
      }
    }
    for (const recommendation of recommendations) {
      const caseDetail = await getCase(recommendation.case_id);
      expect(recommendation.loss_probability).toBe(lossProbabilityForCase(caseDetail));
    }
    expect(recommendations.find((item) => item.case_id === 'caso-1')?.loss_probability).toBeCloseTo(
      0.017077,
      5,
    );
    expect(recommendations.find((item) => item.case_id === 'caso-2')).toMatchObject({
      expected_condemnation: 10500,
      expected_defense_cost: 7560,
      settlement: { opening: 4500, target: 5200, ceiling: 6500 },
    });
    expect(recommendations.find((item) => item.case_id === 'caso-3')?.loss_probability).toBeCloseTo(
      0.573806,
      5,
    );

    expect(cases.find((item) => item.case_id === 'caso-anexo-01')).toMatchObject({
      case_number: '0801234-56.2024.8.10.0001',
      plaintiff: 'Maria das Graças Silva Pereira',
      uf: 'MA',
      recommendation: 'DEFESA',
    });
    expect(cases.find((item) => item.case_id === 'caso-anexo-02')).toMatchObject({
      case_number: '0654321-09.2024.8.04.0001',
      plaintiff: 'José Raimundo Oliveira Costa',
      uf: 'AM',
      recommendation: 'ACORDO',
    });
    expect(
      recommendations.find((item) => item.case_id === 'caso-anexo-01')?.documents,
    ).toHaveLength(7);
    expect(
      recommendations.find((item) => item.case_id === 'caso-anexo-02')?.documents,
    ).toHaveLength(4);
  });

  it('returns independent document objects and preserves local decisions and accepted agreements', async () => {
    const detail = await getCase('caso-2');
    detail.documents[0].demo_pages![0].paragraphs[0] = 'changed outside the service';
    expect((await getCase('caso-2')).documents[0].demo_pages![0].paragraphs[0]).toContain(
      'DEMONSTRAÇÃO',
    );
    expect(await getDecision('caso-2')).toBeNull();
    const decision = await submitLawyerDecision({
      case_id: 'caso-2',
      decision: 'ACORDO',
      notes: '  Conferido  ',
    });
    expect((await getCase('caso-2')).status).toBe('DECISAO_REGISTRADA');
    expect(decision.notes).toBe('Conferido');
    await submitNegotiation({
      case_id: 'caso-2',
      proposal_value: 4500,
      status: 'PENDENTE',
    });
    expect((await getCase('caso-2')).status).toBe('EM_NEGOCIACAO');
    const negotiation = await submitNegotiation({
      case_id: 'caso-2',
      proposal_value: 4500,
      status: 'ACEITA',
      final_value: 5200,
    });
    expect((await getCase('caso-2')).status).toBe('CONCLUIDO');
    expect(await getDecision('caso-2')).toEqual(decision);
    expect(await getNegotiation('caso-2')).toEqual(negotiation);
    expect(JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY)!)).toMatchObject({
      decisions: { 'caso-2': decision },
      negotiations: { 'caso-2': negotiation },
    });
    expect((await getRecommendation('caso-2')).recommendation).toBe('ACORDO');
  });

  it('rejects invalid transitions and incomplete values before saving', async () => {
    await expect(submitLawyerDecision({ case_id: 'caso-1', decision: 'ACORDO' })).rejects.toThrow(
      'divergir',
    );
    await expect(
      submitOverride({
        case_id: 'caso-1',
        decision: 'ACORDO',
        reason: 'OUTRO',
        justification: '  ',
      }),
    ).rejects.toThrow('justificativa');
    await expect(
      submitOverride({
        case_id: 'caso-1',
        decision: 'ACORDO',
        reason: 'OUTRO',
        justification: 'Documento novo.',
      }),
    ).rejects.toThrow('20 caracteres');
    await expect(
      submitNegotiation({ case_id: 'caso-1', proposal_value: 3000, status: 'PENDENTE' }),
    ).rejects.toThrow('decisão de acordo');
    await expect(
      submitNegotiation({ case_id: 'caso-2', proposal_value: 4500, status: 'ACEITA' }),
    ).rejects.toThrow('valor final');
    await expect(
      submitNegotiation({ case_id: 'caso-2', proposal_value: 4500, status: 'CONTRAPROPOSTA' }),
    ).rejects.toThrow('contraproposta');
    await expect(
      submitNegotiation({ case_id: 'caso-2', proposal_value: Number.NaN, status: 'PENDENTE' }),
    ).rejects.toThrow('maior que zero');
    await expect(getCase('missing-case')).rejects.toMatchObject({ status: 404 });
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it('updates the local administrative row and emits an event without changing aggregate demo KPIs', async () => {
    const before = await getAdminDashboard();
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener(DATA_CHANGED_EVENT, listener);
    try {
      const decision = await submitOverride({
        case_id: 'caso-2',
        decision: 'DEFESA',
        reason: 'NOVA_EVIDENCIA',
        justification: 'Documento novo apresentado na página 3.',
      });
      const dashboard = await getAdminDashboard();
      expect(dashboard.decisions.filter((item) => item.case_id === 'caso-2')).toHaveLength(1);
      expect(dashboard.decisions.find((item) => item.case_id === 'caso-2')).toMatchObject({
        id: decision.id,
        decision: 'DEFESA',
        recommendation: 'ACORDO',
        adherent: false,
        is_local: true,
        justification: 'Documento novo apresentado na página 3.',
        override_reason_label: 'Fato ou documento novo',
      });
      expect(dashboard.metrics).toEqual(before.metrics);
      expect(dashboard.historical_simulation).toEqual(before.historical_simulation);
      expect(events).toHaveLength(1);
      expect(events[0].detail).toMatchObject({
        action: 'decision',
        case_id: 'caso-2',
        demo_data: true,
      });
      expect((await getCases()).find((item) => item.case_id === 'caso-2')).toMatchObject({
        status: 'DECISAO_REGISTRADA',
        recommendation: 'ACORDO',
      });
    } finally {
      window.removeEventListener(DATA_CHANGED_EVENT, listener);
    }
  });

  it('preserves policy and model traceability in seeded and local administrative rows', async () => {
    const seededRecommendation = await getRecommendation('caso-7');
    const seededDashboard = await getAdminDashboard();
    expect(seededDashboard.decisions.find((item) => item.case_id === 'caso-7')).toMatchObject({
      policy_version: seededRecommendation.policy_version,
      model_version: seededRecommendation.model_version,
    });

    await submitLawyerDecision({ case_id: 'caso-2', decision: 'ACORDO' });
    const localRecommendation = await getRecommendation('caso-2');
    const localDashboard = await getAdminDashboard();
    expect(localDashboard.decisions.find((item) => item.case_id === 'caso-2')).toMatchObject({
      is_local: true,
      policy_version: localRecommendation.policy_version,
      model_version: localRecommendation.model_version,
    });
  });

  it('recovers corrupted storage through reset and restores initial seeded records', async () => {
    window.localStorage.setItem(DEMO_STORAGE_KEY, '{broken');
    await expect(getCases()).rejects.toBeInstanceOf(ApiError);
    await resetDemoData();
    expect(await getDecision('caso-2')).toBeNull();
    expect((await getDecision('caso-7'))?.is_override).toBe(true);
    expect((await getNegotiation('caso-6'))?.final_value).toBe(3800);
    expect((await getCase('caso-6')).status).toBe('CONCLUIDO');
  });
});
