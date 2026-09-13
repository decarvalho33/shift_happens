import type {
  CaseSummary,
  DecisionRecord,
  NegotiationRecord,
  RecommendationResponse,
  SourceReference,
} from '../types';
import type { LawyerCaseState } from './caseProgress';

export type LawyerCaseAction =
  | 'Analisar agora'
  | 'Continuar análise'
  | 'Seguir recomendação'
  | 'Divergir'
  | 'Pedir evidência'
  | 'Registrar proposta'
  | 'Continuar negociação'
  | 'Ver decisão'
  | 'Ver processo';

export type LawyerCaseBucket = 'analysis' | 'progress' | 'finished';

export interface LawyerCaseWorkflow {
  decision: DecisionRecord | null;
  negotiation: NegotiationRecord | null;
  recommendationDetail: RecommendationResponse;
}

export interface PrioritizedLawyerCase extends CaseSummary, LawyerCaseWorkflow {
  priorityScore: number;
  priorityLabel: 'Prioridade alta' | 'Prioridade média' | 'Prioridade regular';
  priorityReasons: string[];
}

export interface DecisionPoint {
  id: 'agreement' | 'defense' | 'change';
  label: 'A favor de acordo' | 'A favor de defesa' | 'Pode mudar a decisão';
  context: 'Risco para a defesa' | 'Alegação da parte' | 'Fato documental' | 'Ponto a confirmar';
  title: string;
  detail?: string;
  source?: SourceReference;
  empty?: boolean;
}

export function needsLawyerAction(item: CaseSummary & LawyerCaseWorkflow): boolean {
  if (!item.decision) return item.status === 'AGUARDANDO_DECISAO';
  if (item.decision.decision !== 'ACORDO') return false;
  if (!item.negotiation) return true;
  return item.negotiation.status === 'PENDENTE' || item.negotiation.status === 'CONTRAPROPOSTA';
}

export function lawyerCaseBucket(item: CaseSummary & LawyerCaseWorkflow): LawyerCaseBucket {
  if (item.status === 'CONCLUIDO') return 'finished';
  if (!item.decision) {
    return item.status === 'AGUARDANDO_DECISAO' ? 'analysis' : 'progress';
  }
  if (item.decision.decision === 'DEFESA' || item.decision.decision === 'REVISAR')
    return 'finished';
  if (item.negotiation?.status === 'ACEITA' || item.negotiation?.status === 'RECUSADA')
    return 'finished';
  return 'progress';
}

export function nextLawyerAction(
  item: CaseSummary & LawyerCaseWorkflow,
  state: LawyerCaseState,
): LawyerCaseAction {
  if (item.decision?.decision === 'ACORDO') {
    if (!item.negotiation) return 'Registrar proposta';
    if (item.negotiation.status === 'PENDENTE' || item.negotiation.status === 'CONTRAPROPOSTA')
      return 'Continuar negociação';
    return 'Ver processo';
  }
  if (item.decision) return 'Ver decisão';
  if (
    state === 'VISUALIZADO' &&
    item.recommendation === 'REVISAR' &&
    item.recommendationDetail.missing_evidence.length > 0
  )
    return 'Pedir evidência';
  return state === 'VISUALIZADO' ? 'Continuar análise' : 'Analisar agora';
}

export function prioritizeLawyerCase(
  item: CaseSummary & LawyerCaseWorkflow,
  state: LawyerCaseState,
): PrioritizedLawyerCase {
  let priorityScore = 0;
  const reasons: { label: string; weight: number }[] = [];

  if (item.decision?.decision === 'ACORDO' && !item.negotiation) {
    priorityScore += 30;
    reasons.push({ label: 'Proposta ainda não registrada', weight: 30 });
  } else if (
    item.negotiation?.status === 'PENDENTE' ||
    item.negotiation?.status === 'CONTRAPROPOSTA'
  ) {
    priorityScore += 25;
    reasons.push({
      label:
        item.negotiation.status === 'CONTRAPROPOSTA'
          ? 'Contraproposta aguardando resposta'
          : 'Negociação aguardando retorno',
      weight: 25,
    });
  }

  if (state === 'VISUALIZADO') {
    priorityScore += 8;
    reasons.push({ label: 'Análise já iniciada', weight: 8 });
  }

  if (item.risk_level === 'ALTO') {
    priorityScore += 30;
    reasons.push({ label: 'Risco alto', weight: 30 });
  } else if (item.risk_level === 'MEDIO') {
    priorityScore += 15;
    reasons.push({ label: 'Risco médio', weight: 15 });
  }

  if (item.recommendation === 'ACORDO') {
    priorityScore += 20;
    reasons.push({ label: 'Acordo recomendado', weight: 20 });
  } else if (item.recommendation === 'REVISAR') {
    priorityScore += 10;
    reasons.push({ label: 'Revisão necessária', weight: 10 });
  }

  const missingCount = item.recommendationDetail.missing_evidence.length;
  if (missingCount > 0) {
    const missingWeight = Math.min(missingCount * 4, 12);
    priorityScore += missingWeight;
    reasons.push({
      label: `${missingCount} ${missingCount === 1 ? 'ponto a confirmar' : 'pontos a confirmar'}`,
      weight: 22,
    });
  }

  const impactWeight = Math.min(Math.floor(item.claim_value / 5_000) * 3, 15);
  priorityScore += impactWeight;
  if (impactWeight >= 12) reasons.push({ label: 'Maior impacto financeiro', weight: impactWeight });

  const priorityLabel =
    priorityScore >= 70
      ? 'Prioridade alta'
      : priorityScore >= 40
        ? 'Prioridade média'
        : 'Prioridade regular';

  return {
    ...item,
    priorityScore,
    priorityLabel,
    priorityReasons: reasons
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'pt-BR'))
      .map((reason) => reason.label),
  };
}

export function sortPrioritizedCases(items: PrioritizedLawyerCase[]): PrioritizedLawyerCase[] {
  return [...items].sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      b.claim_value - a.claim_value ||
      a.case_number.localeCompare(b.case_number, 'pt-BR'),
  );
}

const emptyPoint = (
  id: DecisionPoint['id'],
  label: DecisionPoint['label'],
  context: DecisionPoint['context'],
): DecisionPoint => ({
  id,
  label,
  context,
  title: 'Nenhum ponto identificado nos dados disponíveis.',
  empty: true,
});

export function buildDecisionPoints(data: RecommendationResponse): DecisionPoint[] {
  const riskEvidence = data.evidence.find((evidence) => evidence.kind === 'RISCO');
  const allegationEvidence = data.evidence.find((evidence) => evidence.kind === 'ALEGACAO');
  const favorableEvidence = data.evidence.find((evidence) => evidence.kind === 'FAVORAVEL');
  const contradiction = data.contradictions[0];

  const agreement: DecisionPoint = riskEvidence
    ? {
        id: 'agreement',
        label: 'A favor de acordo',
        context: 'Risco para a defesa',
        title: riskEvidence.title,
        detail: riskEvidence.description,
        source: riskEvidence.source,
      }
    : contradiction
      ? {
          id: 'agreement',
          label: 'A favor de acordo',
          context: 'Alegação da parte',
          title: contradiction.allegation.text,
          source: contradiction.allegation.source,
        }
      : allegationEvidence
        ? {
            id: 'agreement',
            label: 'A favor de acordo',
            context: 'Alegação da parte',
            title: allegationEvidence.title,
            detail: allegationEvidence.description,
            source: allegationEvidence.source,
          }
        : emptyPoint('agreement', 'A favor de acordo', 'Alegação da parte');

  const defense: DecisionPoint = contradiction
    ? {
        id: 'defense',
        label: 'A favor de defesa',
        context: 'Fato documental',
        title: contradiction.documentary_fact.text,
        source: contradiction.documentary_fact.source,
      }
    : favorableEvidence
      ? {
          id: 'defense',
          label: 'A favor de defesa',
          context: 'Fato documental',
          title: favorableEvidence.title,
          detail: favorableEvidence.description,
          source: favorableEvidence.source,
        }
      : emptyPoint('defense', 'A favor de defesa', 'Fato documental');

  const change: DecisionPoint = data.next_best_evidence
    ? {
        id: 'change',
        label: 'Pode mudar a decisão',
        context: 'Ponto a confirmar',
        title: data.next_best_evidence.title,
        detail: data.next_best_evidence.description,
      }
    : data.missing_evidence[0]
      ? {
          id: 'change',
          label: 'Pode mudar a decisão',
          context: 'Ponto a confirmar',
          title: data.missing_evidence[0],
        }
      : contradiction
        ? {
            id: 'change',
            label: 'Pode mudar a decisão',
            context: 'Ponto a confirmar',
            title: contradiction.description,
          }
        : emptyPoint('change', 'Pode mudar a decisão', 'Ponto a confirmar');

  return [agreement, defense, change];
}
