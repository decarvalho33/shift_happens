import type { AdminDecisionRow, Recommendation } from '../types';
import { overrideReasonLabel } from './overrideReasons';

export type AdminPeriod = 'all' | '30' | '90' | '180';

export type AdminFilters = {
  period: AdminPeriod;
  firm: string;
  lawyer: string;
  uf: string;
  recommendation: '' | Recommendation;
  confidence: string;
  completeness: string;
};

export const emptyAdminFilters: AdminFilters = {
  period: 'all',
  firm: '',
  lawyer: '',
  uf: '',
  recommendation: '',
  confidence: '',
  completeness: '',
};

export type AdminDerivedMetrics = {
  decisions: number;
  adherenceRate: number;
  overrides: number;
  overrideRate: number;
  overridesWithoutJustification: number;
  justificationCoverage: number;
  highConfidenceOverrides: number;
  highConfidenceRate: number;
  completeRate: number;
  predictedAdherence: number | null;
  adherenceCalibrationGap: number | null;
  averageAdherentMinutes: number | null;
  averageOverrideMinutes: number | null;
  proposals: number;
  accepted: number;
  rejected: number;
  counteroffers: number;
  acceptanceRate: number;
  rejectionRate: number;
  counterofferRate: number;
  averageOfferedValue: number | null;
  averageClosedValue: number | null;
  averageValueDifference: number | null;
  averageDiscountRate: number | null;
  observedNegotiationDifference: number;
};

const ratio = (value: number, total: number) => (total > 0 ? value / total : 0);

const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const normalizedBand = (value: string | null | undefined) =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

export function hasActiveAdminFilters(filters: AdminFilters) {
  return Object.entries(filters).some(([key, value]) =>
    key === 'period' ? value !== 'all' : Boolean(value),
  );
}

export function filterAdminRows(rows: AdminDecisionRow[], filters: AdminFilters) {
  const validDates = rows
    .map((row) => new Date(row.created_at).getTime())
    .filter((value) => Number.isFinite(value));
  const latestDate = validDates.length ? Math.max(...validDates) : null;
  const periodDays = filters.period === 'all' ? null : Number(filters.period);
  const cutoff =
    latestDate != null && periodDays != null ? latestDate - periodDays * 24 * 60 * 60 * 1000 : null;

  return rows.filter((row) => {
    const createdAt = new Date(row.created_at).getTime();
    return (
      (cutoff == null || (Number.isFinite(createdAt) && createdAt >= cutoff)) &&
      (!filters.firm || row.firm_name === filters.firm) &&
      (!filters.lawyer || row.lawyer_name === filters.lawyer) &&
      (!filters.uf || row.uf === filters.uf) &&
      (!filters.recommendation || row.recommendation === filters.recommendation) &&
      (!filters.confidence || row.confidence_band === filters.confidence) &&
      (!filters.completeness || row.completeness_band === filters.completeness)
    );
  });
}

export function deriveAdminMetrics(rows: AdminDecisionRow[]): AdminDerivedMetrics {
  const decisions = rows.length;
  const adherent = rows.filter((row) => row.adherent).length;
  const overrides = decisions - adherent;
  const overrideRows = rows.filter((row) => !row.adherent);
  const justifiedOverrides = overrideRows.filter((row) => row.justification?.trim()).length;
  const highConfidenceOverrides = overrideRows.filter(
    (row) => row.confidence_score != null && row.confidence_score >= 0.8,
  ).length;
  const confidenceRows = rows.filter((row) => row.confidence_score != null);
  const highConfidenceRows = confidenceRows.filter((row) => row.confidence_score! >= 0.8);
  const completenessRows = rows.filter((row) => row.completeness_band);
  const completeRows = completenessRows.filter(
    (row) => normalizedBand(row.completeness_band) === 'alta',
  );
  const followProbabilities = rows.flatMap((row) =>
    row.follow_probability == null ? [] : [row.follow_probability],
  );
  const predictedAdherence = average(followProbabilities);
  const adherentMinutes = rows.flatMap((row) =>
    row.adherent && row.decision_minutes != null ? [row.decision_minutes] : [],
  );
  const overrideMinutes = rows.flatMap((row) =>
    !row.adherent && row.decision_minutes != null ? [row.decision_minutes] : [],
  );
  const proposalRows = rows.filter((row) => row.suggested_value != null);
  const acceptedRows = proposalRows.filter((row) => row.status === 'ACEITA');
  const rejected = proposalRows.filter((row) => row.status === 'RECUSADA').length;
  const counteroffers = proposalRows.filter((row) => row.status === 'CONTRAPROPOSTA').length;
  const closedValues = acceptedRows.flatMap((row) =>
    row.realized_value == null ? [] : [row.realized_value],
  );
  const offeredValues = proposalRows.map((row) => row.suggested_value!);
  const pairedValues = acceptedRows.flatMap((row) =>
    row.suggested_value == null || row.realized_value == null
      ? []
      : [{ offered: row.suggested_value, closed: row.realized_value }],
  );
  const valueDifferences = pairedValues.map((item) => item.offered - item.closed);
  const pairedOfferedTotal = pairedValues.reduce((total, item) => total + item.offered, 0);
  const observedNegotiationDifference = valueDifferences.reduce((total, value) => total + value, 0);
  const adherenceRate = ratio(adherent, decisions);

  return {
    decisions,
    adherenceRate,
    overrides,
    overrideRate: ratio(overrides, decisions),
    overridesWithoutJustification: overrides - justifiedOverrides,
    justificationCoverage: ratio(justifiedOverrides, overrides),
    highConfidenceOverrides,
    highConfidenceRate: ratio(highConfidenceRows.length, confidenceRows.length),
    completeRate: ratio(completeRows.length, completenessRows.length),
    predictedAdherence,
    adherenceCalibrationGap: predictedAdherence == null ? null : adherenceRate - predictedAdherence,
    averageAdherentMinutes: average(adherentMinutes),
    averageOverrideMinutes: average(overrideMinutes),
    proposals: proposalRows.length,
    accepted: acceptedRows.length,
    rejected,
    counteroffers,
    acceptanceRate: ratio(acceptedRows.length, proposalRows.length),
    rejectionRate: ratio(rejected, proposalRows.length),
    counterofferRate: ratio(counteroffers, proposalRows.length),
    averageOfferedValue: average(offeredValues),
    averageClosedValue: average(closedValues),
    averageValueDifference: average(valueDifferences),
    averageDiscountRate: ratio(observedNegotiationDifference, pairedOfferedTotal),
    observedNegotiationDifference,
  };
}

export function createRecommendationDistribution(rows: AdminDecisionRow[]) {
  const labels: Record<Recommendation, string> = {
    ACORDO: 'Acordo',
    DEFESA: 'Defesa',
    REVISAR: 'Revisar',
  };
  return (Object.keys(labels) as Recommendation[]).map((key) => {
    const value = rows.filter((row) => row.recommendation === key).length;
    return { label: labels[key], value, percentage: ratio(value, rows.length) };
  });
}

export function createOverrideReasons(rows: AdminDecisionRow[]) {
  const reasons = new Map<string, number>();
  for (const row of rows) {
    if (row.adherent) continue;
    const rawLabel = row.override_reason_label?.trim();
    const label = rawLabel ? overrideReasonLabel(rawLabel) : 'Sem motivo classificado';
    reasons.set(label, (reasons.get(label) ?? 0) + 1);
  }
  const total = [...reasons.values()].reduce((sum, value) => sum + value, 0);
  return [...reasons.entries()]
    .map(([label, value]) => ({ label, value, percentage: ratio(value, total) }))
    .sort((left, right) => right.value - left.value);
}

export function createOutcomeDistribution(rows: AdminDecisionRow[]) {
  const metrics = deriveAdminMetrics(rows);
  const outcomes = [
    { label: 'Acordos aceitos', value: metrics.accepted },
    { label: 'Recusas', value: metrics.rejected },
    { label: 'Contrapropostas', value: metrics.counteroffers },
  ];
  const total = outcomes.reduce((sum, item) => sum + item.value, 0);
  return outcomes.map((item) => ({ ...item, percentage: ratio(item.value, total) }));
}

export function createMonthlyEvolution(rows: AdminDecisionRow[]) {
  const months = new Map<string, { date: Date; agreement: number; defense: number }>();
  for (const row of rows) {
    const date = new Date(row.created_at);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const current = months.get(key) ?? { date, agreement: 0, defense: 0 };
    if (row.decision === 'ACORDO') current.agreement += 1;
    if (row.decision === 'DEFESA') current.defense += 1;
    months.set(key, current);
  }
  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-8)
    .map(([, item]) => ({
      label: new Intl.DateTimeFormat('pt-BR', { month: 'short' })
        .format(item.date)
        .replace('.', ''),
      agreement: item.agreement,
      defense: item.defense,
    }));
}

export function createEffectivenessTimeline(rows: AdminDecisionRow[]) {
  const months = new Map<string, { date: Date; rows: AdminDecisionRow[] }>();
  for (const row of rows) {
    const date = new Date(row.created_at);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const current = months.get(key) ?? { date, rows: [] };
    current.rows.push(row);
    months.set(key, current);
  }
  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-8)
    .map(([, item]) => {
      const metrics = deriveAdminMetrics(item.rows);
      return {
        label: new Intl.DateTimeFormat('pt-BR', { month: 'short' })
          .format(item.date)
          .replace('.', ''),
        savings: metrics.observedNegotiationDifference,
        acceptance_rate: metrics.acceptanceRate,
      };
    });
}
