import { describe, expect, it } from 'vitest';
import type { CaseDocument } from '../types';
import { demoCases, demoRecommendations } from '../mocks/fixtures';
import { defenseScore } from './defenseScore';
import {
  estimateLossProbability,
  lossProbabilityForCase,
  riskLogOdds,
  subsidiesFromDocuments,
} from './riskModel';

const document = (overrides: Partial<CaseDocument>): CaseDocument => ({
  id: 'doc',
  name: 'Documento',
  category: 'Categoria',
  status: 'PRESENTE',
  page_count: 1,
  ...overrides,
});

describe('riskModel', () => {
  it('reproduces the Python risk model for reference cases', () => {
    const lowRisk = estimateLossProbability({
      uf: 'SP',
      subSubject: 'GENERICO',
      subsidies: ['contrato', 'extrato'],
    });
    const highRisk = estimateLossProbability({
      uf: 'AM',
      subSubject: 'GOLPE',
      subsidies: ['comprovante', 'demonstrativo', 'laudo'],
    });
    expect(lowRisk).toBeCloseTo(0.09129809659336219, 12);
    expect(highRisk).toBeCloseTo(0.9766200039000208, 12);
    expect(defenseScore(lowRisk)).toBe(91);
    expect(defenseScore(highRisk)).toBe(2);
  });

  it('counts a subsidy when its document was provided, even if inconclusive', () => {
    const subsidies = subsidiesFromDocuments([
      document({ subsidy: 'contrato', status: 'PRESENTE' }),
      document({ subsidy: 'extrato', status: 'INCONCLUSIVO' }),
      document({ subsidy: 'dossie', status: 'AUSENTE' }),
      document({ status: 'PRESENTE' }),
      document({ subsidy: 'contrato', status: 'PRESENTE' }),
    ]);
    expect([...subsidies].sort()).toEqual(['contrato', 'extrato']);
  });

  it('uses the average UF for RR and rejects unknown UFs or cases without sub-subject', () => {
    const base = { subSubject: 'GENERICO' as const, subsidies: [] };
    expect(riskLogOdds({ ...base, uf: 'RR' })).toBeCloseTo(3.79735625985465, 12);
    expect(riskLogOdds({ ...base, uf: 'XX' })).toBeNull();
    expect(lossProbabilityForCase({ uf: 'SP', documents: [] })).toBeNull();
  });

  it('computes every demo loss probability from the case documents instead of fixed values', () => {
    for (const caseDetail of demoCases) {
      const expected = lossProbabilityForCase(caseDetail);
      expect(expected).not.toBeNull();
      expect(demoRecommendations[caseDetail.case_id].loss_probability).toBe(expected);
    }
    expect(demoRecommendations['caso-anexo-02'].loss_probability).toBeCloseTo(
      0.9766200039000208,
      12,
    );
  });
});
