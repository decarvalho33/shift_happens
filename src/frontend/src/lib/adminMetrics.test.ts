import { describe, expect, it } from 'vitest';
import type { AdminDecisionRow } from '../types';
import {
  createOverrideReasons,
  deriveAdminMetrics,
  emptyAdminFilters,
  filterAdminRows,
  type AdminFilters,
} from './adminMetrics';

const row = (overrides: Partial<AdminDecisionRow> = {}): AdminDecisionRow => ({
  id: '1',
  case_id: 'case-1',
  case_number: '0001',
  plaintiff: 'Pessoa',
  lawyer_name: 'Advogada',
  firm_name: 'Escritório A',
  uf: 'SP',
  recommendation: 'ACORDO',
  decision: 'ACORDO',
  adherent: true,
  suggested_value: 1000,
  realized_value: 800,
  status: 'ACEITA',
  created_at: '2026-09-10T12:00:00.000Z',
  confidence_score: 0.9,
  confidence_band: 'Alta',
  completeness_band: 'Alta',
  follow_probability: 0.8,
  decision_minutes: 10,
  lawyer_profile_label: 'Analítico',
  ...overrides,
});

describe('admin metrics', () => {
  it('calculates adherence, negotiation and quality metrics', () => {
    const metrics = deriveAdminMetrics([
      row(),
      row({
        id: '2',
        adherent: false,
        decision: 'DEFESA',
        status: 'RECUSADA',
        realized_value: null,
        confidence_score: 0.85,
        follow_probability: 0.6,
        decision_minutes: 30,
        justification: '',
      }),
    ]);

    expect(metrics.adherenceRate).toBe(0.5);
    expect(metrics.overrideRate).toBe(0.5);
    expect(metrics.overridesWithoutJustification).toBe(1);
    expect(metrics.highConfidenceOverrides).toBe(1);
    expect(metrics.acceptanceRate).toBe(0.5);
    expect(metrics.averageClosedValue).toBe(800);
    expect(metrics.observedNegotiationDifference).toBe(200);
    expect(metrics.averageDiscountRate).toBe(0.2);
    expect(metrics.averageAdherentMinutes).toBe(10);
    expect(metrics.averageOverrideMinutes).toBe(30);
  });

  it('applies categorical and rolling-period filters', () => {
    const filters: AdminFilters = {
      ...emptyAdminFilters,
      period: '30',
      firm: 'Escritório A',
      confidence: 'Alta',
    };
    const result = filterAdminRows(
      [
        row(),
        row({ id: '2', created_at: '2026-07-01T12:00:00.000Z' }),
        row({ id: '3', firm_name: 'Escritório B' }),
      ],
      filters,
    );

    expect(result.map((item) => item.id)).toEqual(['1']);
  });

  it('groups an override code and its human label as the same reason', () => {
    const result = createOverrideReasons([
      row({ id: '1', adherent: false, override_reason_label: 'NOVA_EVIDENCIA' }),
      row({ id: '2', adherent: false, override_reason_label: 'Fato ou documento novo' }),
      row({ id: '3', adherent: false, override_reason_label: 'Nova evidência' }),
      row({ id: '4', adherent: false, override_reason_label: null }),
    ]);

    expect(result).toEqual([
      { label: 'Fato ou documento novo', value: 3, percentage: 3 / 4 },
      { label: 'Sem motivo classificado', value: 1, percentage: 1 / 4 },
    ]);
  });
});
