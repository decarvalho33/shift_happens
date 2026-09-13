import type {
  AdminDecisionRow,
  CaseDocument,
  Contradiction,
  Evidence,
  SourceReference,
} from '../types';
import type {
  AdminCopilotRequest,
  AdminWhatIfScenario,
  CopilotBasis,
  CopilotCalculation,
  CopilotCitation,
  CopilotFact,
  CopilotFactSource,
  LawyerCopilotRequest,
  LawyerWhatIfScenario,
  PolicyCopilotInputErrorCode,
  PolicyCopilotProvider,
  PolicyCopilotRequest,
  PolicyCopilotResponse,
  ResolvedCopilotIntent,
} from './policyCopilot.types';
import { overrideReasonLabel } from './overrideReasons';

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});
const percentage = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const count = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

const money = (value: number) => currency.format(value);
const percent = (value: number) => percentage.format(value);
const amount = (value: number) => count.format(value);

function hasWhatIfCue(question: string) {
  const normalized = normalize(question);
  return (
    normalized.includes('e se') ||
    normalized.includes('o que aconteceria se') ||
    normalized.includes('o que ocorreria se') ||
    /\bse\s+(?:aument|reduz|alter|mud|fosse|ficasse|passasse)/.test(normalized) ||
    normalized.includes('simul') ||
    normalized.includes('cenario') ||
    normalized.includes('what if') ||
    normalized.includes('→') ||
    normalized.includes('->')
  );
}

function parsePtBrNumber(value: string) {
  const normalized = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Conservative parser for an explicit proposal scenario. It intentionally
 * requires both the word “proposta” and a BRL amount.
 */
export function parseLawyerWhatIfScenario(question: string): LawyerWhatIfScenario | null {
  const normalized = normalize(question);
  if (!hasWhatIfCue(question) || !normalized.includes('proposta')) return null;
  const match = question.match(/R\$\s*([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)(?![0-9]|[.,][0-9])/i);
  if (!match?.[1]) return null;
  const proposalValue = parsePtBrNumber(match[1]);
  return proposalValue !== null && proposalValue > 0
    ? { type: 'PROPOSAL_VALUE', proposalValue }
    : null;
}

/**
 * Conservative parser for explicit percentage scenarios. Generic numeric
 * changes, policy limits and arrows are deliberately ignored.
 */
export function parseAdminWhatIfScenario(question: string): AdminWhatIfScenario | null {
  const normalized = normalize(question);
  if (!hasWhatIfCue(question)) return null;
  const acceptance = /taxa\s+de\s+(?:aceite|aceitacao)/.test(normalized);
  const adherence = normalized.includes('aderencia');
  if (acceptance === adherence) return null;
  const matches = [...question.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*%/g)];
  if (matches.length !== 1 || !matches[0]?.[1]) return null;
  const rawRate = Number(matches[0][1].replace(',', '.'));
  if (!Number.isFinite(rawRate) || rawRate < 0 || rawRate > 100) return null;
  return acceptance
    ? { type: 'ACCEPTANCE_RATE', acceptanceRate: rawRate / 100 }
    : { type: 'ADHERENCE_RATE', adherenceRate: rawRate / 100 };
}

export class PolicyCopilotInputError extends Error {
  readonly code: PolicyCopilotInputErrorCode;

  constructor(code: PolicyCopilotInputErrorCode, message: string) {
    super(message);
    this.name = 'PolicyCopilotInputError';
    this.code = code;
  }
}

function fact(
  key: string,
  label: string,
  value: CopilotFact['value'],
  formattedValue: string,
  source: CopilotFactSource,
): CopilotFact {
  return { key, label, value, formattedValue, source };
}

function basis(source: CopilotFactSource, description: string, recordCount?: number): CopilotBasis {
  return { source, description, ...(recordCount === undefined ? {} : { recordCount }) };
}

function sourceKey(source: SourceReference) {
  return `${source.document_id}\u0000${source.page}\u0000${source.origin}`;
}

function validSource(source: SourceReference) {
  return (
    source.document_id.trim().length > 0 &&
    source.document_name.trim().length > 0 &&
    Number.isInteger(source.page) &&
    source.page > 0 &&
    source.origin.trim().length > 0
  );
}

type CitationEntry = { source: SourceReference; claim: string };

function buildCitations(sources: CitationEntry[]) {
  const grouped = new Map<string, { source: SourceReference; claims: string[] }>();
  for (const item of sources) {
    if (!validSource(item.source)) continue;
    const key = sourceKey(item.source);
    const current = grouped.get(key) ?? { source: item.source, claims: [] };
    if (!current.claims.includes(item.claim)) current.claims.push(item.claim);
    grouped.set(key, current);
  }

  return [...grouped.values()].slice(0, 8).map<CopilotCitation>((item, index) => ({
    marker: `[${index + 1}]`,
    documentId: item.source.document_id,
    documentName: item.source.document_name,
    page: item.source.page,
    origin: item.source.origin,
    ...(item.source.excerpt ? { excerpt: item.source.excerpt } : {}),
    claims: item.claims,
  }));
}

function evidenceCitationEntries(request: LawyerCopilotRequest, includeContradictions: boolean) {
  const sources: CitationEntry[] = request.context.recommendation.evidence.map((item) => ({
    source: item.source,
    claim: item.title,
  }));
  if (includeContradictions) {
    for (const item of request.context.recommendation.contradictions) {
      sources.push(
        { source: item.allegation.source, claim: `${item.title}: alegação` },
        { source: item.documentary_fact.source, claim: `${item.title}: fato documental` },
      );
    }
  }
  return sources;
}

const evidenceQueryStopWords = new Set([
  'alegacao',
  'alegacoes',
  'contradicao',
  'contradicoes',
  'consta',
  'conteudo',
  'documental',
  'documento',
  'documentos',
  'evidencia',
  'evidencias',
  'existe',
  'existem',
  'explique',
  'fato',
  'fonte',
  'fontes',
  'informacao',
  'lacunas',
  'mostre',
  'pagina',
  'processo',
  'prova',
  'provas',
  'quais',
  'sobre',
]);

function evidenceQueryTerms(question: string) {
  return normalize(question)
    .split(/[^a-z0-9]+/)
    .filter(
      (term) =>
        term.length >= 4 &&
        !evidenceQueryStopWords.has(term) &&
        !['como', 'este', 'esta', 'isso', 'pelo', 'pela', 'para', 'qual', 'quando'].includes(term),
    );
}

function requestedDocumentPage(question: string) {
  const match = normalize(question).match(/pagina\s*(?:n[ºo]\s*)?(\d+)/);
  if (!match?.[1]) return null;
  const page = Number(match[1]);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function containsTerms(terms: string[], values: Array<string | undefined>) {
  if (!terms.length) return true;
  const searchable = normalize(values.filter(Boolean).join(' '));
  return terms.every((term) => searchable.includes(term));
}

function sourceMatchesPage(source: SourceReference, page: number | null) {
  return page === null || source.page === page;
}

type EvidenceSelection = {
  evidence: Evidence[];
  contradictions: Contradiction[];
  documents: CaseDocument[];
  documentPassages: Array<{
    document: CaseDocument;
    page: number;
    text: string;
    source: SourceReference;
  }>;
  focused: boolean;
};

function selectEvidenceForQuestion(request: LawyerCopilotRequest): EvidenceSelection {
  const { recommendation } = request.context;
  const terms = evidenceQueryTerms(request.question);
  const page = requestedDocumentPage(request.question);
  const focused = terms.length > 0 || page !== null;
  const evidence = recommendation.evidence.filter(
    (item) =>
      sourceMatchesPage(item.source, page) &&
      containsTerms(terms, [
        item.title,
        item.description,
        item.source.document_name,
        item.source.origin,
        item.source.excerpt,
      ]),
  );
  const contradictions = recommendation.contradictions.filter(
    (item) =>
      (page === null ||
        sourceMatchesPage(item.allegation.source, page) ||
        sourceMatchesPage(item.documentary_fact.source, page)) &&
      containsTerms(terms, [
        item.title,
        item.description,
        item.allegation.text,
        item.allegation.source.document_name,
        item.allegation.source.origin,
        item.documentary_fact.text,
        item.documentary_fact.source.document_name,
        item.documentary_fact.source.origin,
      ]),
  );
  const documents = recommendation.documents.filter(
    (document) =>
      (page === null || page <= document.page_count) &&
      containsTerms(terms, [document.name, document.category, document.description]),
  );
  const knownSources = [
    ...recommendation.evidence.map((item) => item.source),
    ...recommendation.contradictions.flatMap((item) => [
      item.allegation.source,
      item.documentary_fact.source,
    ]),
  ];
  const documentPassages = documents.flatMap((document) => {
    const pages =
      page === null
        ? (document.demo_pages?.slice(0, 1) ?? [])
        : (document.demo_pages?.filter((item) => item.page === page) ?? []);
    return pages.map((documentPage) => {
      const text = [
        documentPage.title,
        ...documentPage.paragraphs,
        ...(documentPage.fields?.map((field) => `${field.label}: ${field.value}`) ?? []),
      ]
        .join(' ')
        .trim();
      const knownSource =
        knownSources.find(
          (source) => source.document_id === document.id && source.page === documentPage.page,
        ) ?? knownSources.find((source) => source.document_id === document.id);
      return {
        document,
        page: documentPage.page,
        text,
        source: {
          document_id: document.id,
          document_name: document.name,
          page: documentPage.page,
          origin: knownSource?.origin ?? 'Origem específica não informada nos dados do caso',
          excerpt: text.slice(0, 280),
        },
      };
    });
  });
  return {
    evidence: evidence.slice(0, focused ? 5 : 3),
    contradictions: contradictions.slice(0, focused ? 3 : 2),
    documents: documents.slice(0, focused ? 5 : 3),
    documentPassages: documentPassages.slice(0, focused ? 3 : 1),
    focused,
  };
}

function questionTargetsKnownCaseMaterial(request: LawyerCopilotRequest) {
  if (requestedDocumentPage(request.question) !== null) return true;
  const question = normalize(request.question);
  const { recommendation } = request.context;
  const labels = [
    ...recommendation.documents.flatMap((item) => [item.name, item.category]),
    ...recommendation.evidence.flatMap((item) => [item.title, item.source.document_name]),
    ...recommendation.contradictions.flatMap((item) => [
      item.title,
      item.allegation.source.document_name,
      item.documentary_fact.source.document_name,
    ]),
  ];
  return labels.some((label) =>
    normalize(label)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 4)
      .some((term) => question.includes(term)),
  );
}

function asksDocumentContent(question: string) {
  const normalized = normalize(question);
  return ['diz', 'consta', 'conteudo', 'pagina', 'trecho', 'campo', 'assinatura'].some((token) =>
    normalized.includes(token),
  );
}

type DecisionPoint = {
  kind: 'AGREEMENT' | 'DEFENSE' | 'CHANGE';
  title: string;
  detail?: string;
  source?: SourceReference;
};

function decisionPoints(request: LawyerCopilotRequest): DecisionPoint[] {
  const { recommendation } = request.context;
  const risk = recommendation.evidence.find((item) => item.kind === 'RISCO');
  const allegation = recommendation.evidence.find((item) => item.kind === 'ALEGACAO');
  const favorable = recommendation.evidence.find((item) => item.kind === 'FAVORAVEL');
  const contradiction = recommendation.contradictions[0];
  const agreement: DecisionPoint = risk
    ? { kind: 'AGREEMENT', title: risk.title, detail: risk.description, source: risk.source }
    : contradiction
      ? {
          kind: 'AGREEMENT',
          title: contradiction.allegation.text,
          source: contradiction.allegation.source,
        }
      : allegation
        ? {
            kind: 'AGREEMENT',
            title: allegation.title,
            detail: allegation.description,
            source: allegation.source,
          }
        : { kind: 'AGREEMENT', title: 'Nenhum ponto identificado nos dados disponíveis.' };
  const defense: DecisionPoint = contradiction
    ? {
        kind: 'DEFENSE',
        title: contradiction.documentary_fact.text,
        source: contradiction.documentary_fact.source,
      }
    : favorable
      ? {
          kind: 'DEFENSE',
          title: favorable.title,
          detail: favorable.description,
          source: favorable.source,
        }
      : { kind: 'DEFENSE', title: 'Nenhum ponto identificado nos dados disponíveis.' };
  const nextEvidence = recommendation.next_best_evidence;
  const change: DecisionPoint = nextEvidence
    ? { kind: 'CHANGE', title: nextEvidence.title, detail: nextEvidence.description }
    : recommendation.missing_evidence[0]
      ? { kind: 'CHANGE', title: recommendation.missing_evidence[0] }
      : contradiction
        ? { kind: 'CHANGE', title: contradiction.description }
        : { kind: 'CHANGE', title: 'Nenhum ponto identificado nos dados disponíveis.' };
  return [agreement, defense, change];
}

function pointCitationEntries(points: DecisionPoint[]) {
  return points.flatMap<CitationEntry>((point) =>
    point.source ? [{ source: point.source, claim: point.title }] : [],
  );
}

function citationSuffix(citations: CopilotCitation[]) {
  if (!citations.length) return '';
  return ` Fontes documentais: ${citations.map((item) => item.marker).join(', ')}.`;
}

function factualLawyerBasis(request: LawyerCopilotRequest): CopilotBasis[] {
  const result = [
    basis('CASE_DETAIL', `Processo ${request.context.caseDetail.case_number}.`, 1),
    basis(
      'RECOMMENDATION',
      `Recomendação ${request.context.recommendation.policy_version} produzida pelo modelo ${request.context.recommendation.model_version}.`,
      1,
    ),
  ];
  if (request.context.decision) result.push(basis('DECISION', 'Última decisão registrada.', 1));
  if (request.context.negotiation)
    result.push(basis('NEGOTIATION', 'Última negociação registrada.', 1));
  return result;
}

function lawyerLimitations(
  request: LawyerCopilotRequest,
  citations: CopilotCitation[],
  citationExpected: boolean,
) {
  const result: string[] = [];
  if (citationExpected && !citations.length) {
    result.push(
      'O contexto recebido não contém referência documental válida com documento, página e origem.',
    );
  }
  if (request.context.recommendation.next_best_evidence?.simulation) {
    result.push(
      'A hipótese de próxima evidência foi excluída dos fatos porque o próprio contrato a identifica como simulação.',
    );
  }
  return result;
}

function validateLawyerContext(request: LawyerCopilotRequest) {
  const { caseDetail, recommendation, decision, negotiation } = request.context;
  if (!caseDetail.assigned_to_me) {
    throw new PolicyCopilotInputError(
      'CASE_NOT_ASSIGNED',
      'O copiloto não pode responder sobre um processo que não está atribuído ao advogado atual.',
    );
  }
  const ids = [recommendation.case_id, decision?.case_id, negotiation?.case_id].filter(
    (value): value is string => value !== undefined,
  );
  if (ids.some((value) => value !== caseDetail.case_id)) {
    throw new PolicyCopilotInputError(
      'CONTEXT_MISMATCH',
      'Os dados recebidos pertencem a processos diferentes.',
    );
  }
  if (!Number.isFinite(caseDetail.claim_value) || caseDetail.claim_value <= 0) {
    throw new PolicyCopilotInputError('CONTEXT_MISMATCH', 'O valor da causa recebido é inválido.');
  }
  const settlement = recommendation.settlement;
  if (
    settlement &&
    (!Number.isFinite(settlement.opening) ||
      !Number.isFinite(settlement.target) ||
      !Number.isFinite(settlement.ceiling) ||
      settlement.opening <= 0 ||
      settlement.opening > settlement.target ||
      settlement.target > settlement.ceiling)
  ) {
    throw new PolicyCopilotInputError(
      'CONTEXT_MISMATCH',
      'A faixa de acordo recebida é inconsistente.',
    );
  }
}

function mentionsVersion(question: string) {
  return /\bvers(?:ao|oes)\b/.test(normalize(question));
}

function asksVersionComparison(question: string) {
  const normalized = normalize(question);
  return (
    mentionsVersion(question) &&
    ['compar', 'melhor', 'pior', 'mudou', 'diferenca'].some((token) => normalized.includes(token))
  );
}

function asksDefenseOutcome(question: string) {
  const normalized = normalize(question);
  return (
    normalized.includes('defesa') &&
    ['resultado', 'desfecho', 'ganhou', 'perdeu', 'procedente'].some((token) =>
      normalized.includes(token),
    )
  );
}

function looksLikeWhatIf(question: string) {
  return hasWhatIfCue(question);
}

function lawyerIntent(request: LawyerCopilotRequest): ResolvedCopilotIntent {
  if (request.scenario || request.intent === 'WHAT_IF' || looksLikeWhatIf(request.question))
    return 'WHAT_IF';
  if (request.intent && request.intent !== 'AUTO') return request.intent;
  const question = normalize(request.question);
  if (question.includes('3 pontos') || question.includes('tres pontos')) return 'DECISION_POINTS';
  if (question.includes('favorece') && question.includes('defesa') && question.includes('acordo'))
    return 'DECISION_POINTS';
  if (question.includes('favorece') && question.includes('defesa')) return 'DEFENSE_FACTORS';
  if (question.includes('favorece') && question.includes('acordo')) return 'AGREEMENT_FACTORS';
  if (
    [
      'falta confirmar',
      'falta conferir',
      'ponto a confirmar',
      'evidencia faltante',
      'o que falta',
    ].some((token) => question.includes(token))
  )
    return 'MISSING_EVIDENCE';
  if (
    ['proxima acao', 'proximo passo', 'o que faco agora', 'o que fazer agora'].some((token) =>
      question.includes(token),
    )
  )
    return 'NEXT_ACTION';
  if (
    ['faixa', 'abertura', 'teto', 'valor sugerido', 'valor recomendado'].some((token) =>
      question.includes(token),
    )
  )
    return 'SETTLEMENT_RANGE';
  if (
    [
      'resumo',
      'resuma',
      'sobre este caso',
      'fatos do caso',
      'principais fatos',
      'fatos principais',
      'o que aconteceu',
      'dados do processo',
    ].some((token) => question.includes(token))
  )
    return 'CASE_SUMMARY';
  if (
    /\brisco\b/.test(question) ||
    question.includes('probabilidade de perda') ||
    question.includes('fatores')
  )
    return 'RECOMMENDATION';
  if (
    ['evidencia', 'documento', 'prova', 'fonte', 'contradicao', 'lacuna', 'pagina'].some((token) =>
      question.includes(token),
    ) ||
    questionTargetsKnownCaseMaterial(request)
  )
    return 'EVIDENCE';
  if (
    ['proposta', 'negociacao', 'contraproposta', 'valor', 'alvo'].some((token) =>
      question.includes(token),
    )
  )
    return 'NEGOTIATION';
  if (
    [
      'recomendacao',
      'recomenda',
      'por que',
      'decidir',
      'risco de perda',
      'probabilidade de perda',
      'fatores',
    ].some((token) => question.includes(token))
  )
    return 'RECOMMENDATION';
  return 'STATUS';
}

function unavailableLawyer(
  request: LawyerCopilotRequest,
  intent: ResolvedCopilotIntent,
  reason: string,
): PolicyCopilotResponse {
  return {
    audience: 'LAWYER',
    intent,
    mode: 'FACTUAL',
    status: 'UNAVAILABLE',
    title: 'Informação indisponível',
    answer: reason,
    facts: [],
    basis: factualLawyerBasis(request),
    citations: [],
    calculations: [],
    assumptions: [],
    limitations: [reason],
    provenance: {
      engine: 'deterministic-policy-copilot',
      version: '1.0.0',
      dataMode: request.context.recommendation.demo_data ? 'DEMONSTRATION' : 'OPERATIONAL',
      contextRef: `case:${request.context.caseDetail.case_id}`,
      policyVersion: request.context.recommendation.policy_version,
      modelVersion: request.context.recommendation.model_version,
      dataUpdatedAt: request.context.recommendation.generated_at,
    },
  };
}

function simulateLawyer(
  request: LawyerCopilotRequest,
  scenario: LawyerWhatIfScenario,
): PolicyCopilotResponse {
  const proposed = scenario.proposalValue;
  if (!Number.isFinite(proposed) || proposed <= 0) {
    throw new PolicyCopilotInputError(
      'INVALID_SCENARIO',
      'O valor simulado da proposta deve ser maior que zero.',
    );
  }
  const { caseDetail, recommendation } = request.context;
  const range = recommendation.settlement;
  const facts: CopilotFact[] = [
    fact('simulated_proposal', 'Proposta simulada', proposed, money(proposed), 'DERIVED'),
    fact(
      'claim_share',
      'Parcela do valor da causa',
      proposed / caseDetail.claim_value,
      percent(proposed / caseDetail.claim_value),
      'DERIVED',
    ),
  ];
  const calculations: CopilotCalculation[] = [
    {
      key: 'claim_share',
      label: 'Parcela do valor da causa',
      formula: 'proposta simulada ÷ valor da causa',
      inputs: [
        { label: 'Proposta simulada', value: proposed },
        { label: 'Valor da causa', value: caseDetail.claim_value },
      ],
      result: proposed / caseDetail.claim_value,
      formattedResult: percent(proposed / caseDetail.claim_value),
    },
  ];
  let position = 'sem faixa de acordo disponível para comparação';
  if (range) {
    const deltaToTarget = proposed - range.target;
    const ceilingHeadroom = range.ceiling - proposed;
    position =
      proposed < range.opening
        ? 'abaixo da abertura'
        : proposed > range.ceiling
          ? 'acima do teto'
          : proposed === range.target
            ? 'no alvo'
            : 'dentro da faixa';
    facts.push(
      fact('range_position', 'Posição na faixa', position, position, 'DERIVED'),
      fact(
        'delta_to_target',
        'Diferença para o alvo',
        deltaToTarget,
        money(deltaToTarget),
        'DERIVED',
      ),
      fact(
        'ceiling_headroom',
        'Distância até o teto',
        ceilingHeadroom,
        money(ceilingHeadroom),
        'DERIVED',
      ),
    );
    calculations.push(
      {
        key: 'delta_to_target',
        label: 'Diferença para o alvo',
        formula: 'proposta simulada − alvo da política',
        inputs: [
          { label: 'Proposta simulada', value: proposed },
          { label: 'Alvo', value: range.target },
        ],
        result: deltaToTarget,
        formattedResult: money(deltaToTarget),
      },
      {
        key: 'ceiling_headroom',
        label: 'Distância até o teto',
        formula: 'teto da política − proposta simulada',
        inputs: [
          { label: 'Teto', value: range.ceiling },
          { label: 'Proposta simulada', value: proposed },
        ],
        result: ceilingHeadroom,
        formattedResult: money(ceilingHeadroom),
      },
    );
  }
  if (recommendation.expected_defense_cost !== null) {
    const difference = recommendation.expected_defense_cost - proposed;
    facts.push(
      fact(
        'difference_to_defense_cost',
        'Diferença para o custo esperado da defesa',
        difference,
        money(difference),
        'DERIVED',
      ),
    );
    calculations.push({
      key: 'difference_to_defense_cost',
      label: 'Diferença para o custo esperado da defesa',
      formula: 'custo esperado da defesa − proposta simulada',
      inputs: [
        { label: 'Custo esperado da defesa', value: recommendation.expected_defense_cost },
        { label: 'Proposta simulada', value: proposed },
      ],
      result: difference,
      formattedResult: money(difference),
    });
  }
  const citations: CopilotCitation[] = [];
  return {
    audience: 'LAWYER',
    intent: 'WHAT_IF',
    mode: 'SIMULATION',
    status: 'ANSWERED',
    label: 'SIMULAÇÃO',
    title: 'SIMULAÇÃO de valor de proposta',
    answer: `SIMULAÇÃO: uma proposta de ${money(proposed)} ficaria ${position}. O cálculo apenas compara os números recebidos e não prevê aceite nem altera a recomendação.${citationSuffix(citations)}`,
    facts,
    basis: [
      ...factualLawyerBasis(request),
      basis('DERIVED', 'Cálculos aritméticos sobre os valores fornecidos.'),
    ],
    citations,
    calculations,
    assumptions: [
      'O valor da causa e os parâmetros da recomendação permanecem constantes.',
      'Não foi estimada probabilidade de aceite porque esse dado não existe no contexto do caso.',
    ],
    limitations: lawyerLimitations(request, citations, false),
    provenance: {
      engine: 'deterministic-policy-copilot',
      version: '1.0.0',
      dataMode: recommendation.demo_data ? 'DEMONSTRATION' : 'OPERATIONAL',
      contextRef: `case:${caseDetail.case_id}`,
      policyVersion: recommendation.policy_version,
      modelVersion: recommendation.model_version,
      dataUpdatedAt: recommendation.generated_at,
    },
  };
}

function nextLawyerAction(request: LawyerCopilotRequest) {
  const { recommendation, decision, negotiation } = request.context;
  if (!decision) {
    return recommendation.recommendation === 'REVISAR' && recommendation.missing_evidence.length
      ? 'Conferir a evidência pendente e então seguir a revisão ou registrar uma divergência.'
      : 'Revisar os pontos do caso e então seguir a recomendação ou registrar uma divergência.';
  }
  if (decision.decision !== 'ACORDO')
    return 'Consultar a decisão registrada; não há negociação ativa.';
  if (!negotiation) return 'Registrar a proposta de acordo.';
  if (negotiation.status === 'PENDENTE' || negotiation.status === 'CONTRAPROPOSTA')
    return 'Atualizar a negociação e registrar o retorno da outra parte.';
  return 'Consultar o resultado já registrado.';
}

function answerLawyer(request: LawyerCopilotRequest): PolicyCopilotResponse {
  validateLawyerContext(request);
  const intent = lawyerIntent(request);
  const comparesVersions = asksVersionComparison(request.question);
  const requestsDefenseOutcome = asksDefenseOutcome(request.question);
  if (comparesVersions || requestsDefenseOutcome) {
    return unavailableLawyer(
      request,
      intent,
      comparesVersions && requestsDefenseOutcome
        ? 'O contexto fornecido não contém versões comparáveis nem resultado judicial da defesa.'
        : comparesVersions
          ? 'O contexto fornecido não contém versões comparáveis da política ou do modelo.'
          : 'O contexto fornecido não contém resultado judicial da defesa.',
    );
  }
  if (intent === 'WHAT_IF') {
    const parsedScenario = request.scenario ?? parseLawyerWhatIfScenario(request.question);
    if (!parsedScenario) {
      return unavailableLawyer(
        request,
        intent,
        'A simulação precisa de um cenário estruturado ou de uma proposta explícita em reais; os demais números não serão inferidos da pergunta.',
      );
    }
    return simulateLawyer(request, parsedScenario);
  }

  const { caseDetail, recommendation, decision, negotiation } = request.context;
  const facts: CopilotFact[] = [];
  let title: string;
  let answer: string;
  let citationEntries: CitationEntry[] = [];
  let citationExpected = false;

  if (intent === 'CASE_SUMMARY') {
    title = 'Resumo do processo';
    facts.push(
      fact(
        'case_number',
        'Processo',
        caseDetail.case_number,
        caseDetail.case_number,
        'CASE_DETAIL',
      ),
      fact('subject', 'Assunto', caseDetail.subject, caseDetail.subject, 'CASE_DETAIL'),
      fact(
        'claim_value',
        'Valor da causa',
        caseDetail.claim_value,
        money(caseDetail.claim_value),
        'CASE_DETAIL',
      ),
      fact(
        'risk_level',
        'Nível de risco',
        caseDetail.risk_level,
        caseDetail.risk_level,
        'CASE_DETAIL',
      ),
    );
    answer = `${caseDetail.summary} O valor da causa é ${money(caseDetail.claim_value)}, com risco ${caseDetail.risk_level}.`;
  } else if (intent === 'RECOMMENDATION') {
    title = 'Leitura da recomendação';
    facts.push(
      fact(
        'recommendation',
        'Recomendação',
        recommendation.recommendation,
        recommendation.recommendation,
        'RECOMMENDATION',
      ),
      fact(
        'loss_probability',
        'Risco estimado de perda',
        recommendation.loss_probability,
        recommendation.loss_probability === null
          ? 'Não calculado'
          : percent(recommendation.loss_probability),
        'RECOMMENDATION',
      ),
      fact(
        'risk_level',
        'Nível de risco',
        caseDetail.risk_level,
        caseDetail.risk_level,
        'CASE_DETAIL',
      ),
    );
    if (recommendation.expected_condemnation !== null) {
      facts.push(
        fact(
          'expected_condemnation',
          'Condenação esperada',
          recommendation.expected_condemnation,
          money(recommendation.expected_condemnation),
          'RECOMMENDATION',
        ),
      );
    }
    if (recommendation.expected_defense_cost !== null) {
      facts.push(
        fact(
          'expected_defense_cost',
          'Custo esperado da defesa',
          recommendation.expected_defense_cost,
          money(recommendation.expected_defense_cost),
          'RECOMMENDATION',
        ),
      );
    }
    if (recommendation.settlement) {
      facts.push(
        fact(
          'settlement_target',
          'Alvo da política',
          recommendation.settlement.target,
          money(recommendation.settlement.target),
          'RECOMMENDATION',
        ),
      );
    }
    citationEntries = evidenceCitationEntries(request, false);
    citationExpected = true;
    const reasons = recommendation.reasons.slice(0, 3).join('; ');
    answer = `A política recomenda ${recommendation.recommendation}${reasons ? ` pelos motivos registrados: ${reasons}` : ''}.`;
  } else if (intent === 'EVIDENCE') {
    title = 'Evidências e lacunas';
    const selected = selectEvidenceForQuestion(request);
    if (
      selected.focused &&
      !selected.evidence.length &&
      !selected.contradictions.length &&
      !selected.documents.length &&
      !selected.documentPassages.length
    ) {
      return unavailableLawyer(
        request,
        intent,
        'Não encontrei, no contexto permitido deste caso, documento ou evidência correspondente aos termos informados.',
      );
    }
    if (
      selected.focused &&
      asksDocumentContent(request.question) &&
      !selected.evidence.length &&
      !selected.contradictions.length &&
      !selected.documentPassages.length
    ) {
      return unavailableLawyer(
        request,
        intent,
        'O documento foi localizado, mas o contexto recebido não contém o conteúdo da página nem uma evidência vinculada para responder com segurança.',
      );
    }
    facts.push(
      fact(
        'evidence_count',
        selected.focused ? 'Evidências localizadas' : 'Evidências registradas',
        selected.evidence.length,
        amount(selected.evidence.length),
        'RECOMMENDATION',
      ),
      fact(
        'contradiction_count',
        selected.focused ? 'Contradições localizadas' : 'Contradições registradas',
        selected.contradictions.length,
        amount(selected.contradictions.length),
        'RECOMMENDATION',
      ),
    );
    selected.evidence.forEach((item, index) => {
      facts.push(
        fact(
          `evidence_${index + 1}`,
          item.title,
          item.description,
          item.description,
          'RECOMMENDATION',
        ),
      );
      citationEntries.push({ source: item.source, claim: item.title });
    });
    selected.contradictions.forEach((item, index) => {
      facts.push(
        fact(
          `contradiction_${index + 1}_allegation`,
          `Alegação — ${item.title}`,
          item.allegation.text,
          item.allegation.text,
          'RECOMMENDATION',
        ),
        fact(
          `contradiction_${index + 1}_documentary_fact`,
          `Fato documental — ${item.title}`,
          item.documentary_fact.text,
          item.documentary_fact.text,
          'RECOMMENDATION',
        ),
      );
      citationEntries.push(
        { source: item.allegation.source, claim: `${item.title}: alegação` },
        { source: item.documentary_fact.source, claim: `${item.title}: fato documental` },
      );
    });
    selected.documents.forEach((document, index) => {
      facts.push(
        fact(
          `document_${index + 1}`,
          'Documento localizado',
          document.name,
          `${document.name} · ${document.status} · ${amount(document.page_count)} ${document.page_count === 1 ? 'página' : 'páginas'}`,
          'RECOMMENDATION',
        ),
      );
    });
    selected.documentPassages.forEach((passage, index) => {
      facts.push(
        fact(
          `document_passage_${index + 1}`,
          `${passage.document.name} · página ${passage.page}`,
          passage.text,
          passage.text,
          'RECOMMENDATION',
        ),
      );
      citationEntries.push({
        source: passage.source,
        claim: `Conteúdo de ${passage.document.name}, página ${passage.page}`,
      });
    });
    citationExpected = true;
    const answerParts = [
      selected.evidence.length
        ? `Evidências: ${selected.evidence.map((item) => `${item.title}: ${item.description}`).join('; ')}.`
        : '',
      ...selected.contradictions.map(
        (item) =>
          `${item.title} — alegação: ${item.allegation.text}; fato documental: ${item.documentary_fact.text}.`,
      ),
      ...selected.documentPassages.map(
        (passage) => `${passage.document.name}, página ${passage.page}: ${passage.text}.`,
      ),
      selected.documents.length &&
      !selected.evidence.length &&
      !selected.contradictions.length &&
      !selected.documentPassages.length
        ? `Documentos localizados: ${selected.documents.map((item) => item.name).join(', ')}.`
        : '',
      !selected.focused && recommendation.missing_evidence.length
        ? `Lacunas: ${recommendation.missing_evidence.slice(0, 2).join('; ')}.`
        : '',
    ].filter(Boolean);
    answer = answerParts.join(' ') || 'Não há evidências ou contradições registradas.';
  } else if (
    intent === 'DECISION_POINTS' ||
    intent === 'AGREEMENT_FACTORS' ||
    intent === 'DEFENSE_FACTORS'
  ) {
    const points = decisionPoints(request);
    const selected =
      intent === 'AGREEMENT_FACTORS'
        ? points.filter((item) => item.kind === 'AGREEMENT')
        : intent === 'DEFENSE_FACTORS'
          ? points.filter((item) => item.kind === 'DEFENSE')
          : points;
    title =
      intent === 'AGREEMENT_FACTORS'
        ? 'Ponto a favor de acordo'
        : intent === 'DEFENSE_FACTORS'
          ? 'Ponto a favor de defesa'
          : 'Três pontos antes de decidir';
    const labels = {
      AGREEMENT: 'A favor de acordo',
      DEFENSE: 'A favor de defesa',
      CHANGE: 'Pode mudar a decisão',
    } as const;
    for (const point of selected) {
      facts.push(
        fact(
          `decision_point_${point.kind.toLocaleLowerCase('pt-BR')}`,
          labels[point.kind],
          point.title,
          point.title,
          'RECOMMENDATION',
        ),
      );
    }
    citationEntries = pointCitationEntries(selected);
    citationExpected = selected.some((item) => item.source !== undefined);
    answer = selected.map((item) => `${labels[item.kind]}: ${item.title}.`).join(' ');
  } else if (intent === 'MISSING_EVIDENCE') {
    title = 'Pontos ainda não confirmados';
    recommendation.missing_evidence.forEach((item, index) => {
      facts.push(
        fact(`missing_evidence_${index + 1}`, `Lacuna ${index + 1}`, item, item, 'RECOMMENDATION'),
      );
    });
    if (recommendation.next_best_evidence) {
      facts.push(
        fact(
          'next_best_evidence',
          'Próxima evidência sugerida',
          recommendation.next_best_evidence.title,
          recommendation.next_best_evidence.title,
          'RECOMMENDATION',
        ),
      );
    }
    answer = recommendation.missing_evidence.length
      ? `Falta confirmar: ${recommendation.missing_evidence.join('; ')}.`
      : 'A recomendação recebida não registra lacunas documentais.';
  } else if (intent === 'NEXT_ACTION') {
    title = 'Próxima ação';
    const action = nextLawyerAction(request);
    facts.push(fact('next_action', 'Próxima ação', action, action, 'DERIVED'));
    answer = action;
  } else if (intent === 'SETTLEMENT_RANGE') {
    if (!recommendation.settlement) {
      return unavailableLawyer(
        request,
        intent,
        'A recomendação recebida não contém faixa de acordo.',
      );
    }
    title = 'Faixa de acordo';
    facts.push(
      fact(
        'settlement_opening',
        'Abertura',
        recommendation.settlement.opening,
        money(recommendation.settlement.opening),
        'RECOMMENDATION',
      ),
      fact(
        'settlement_target',
        'Alvo',
        recommendation.settlement.target,
        money(recommendation.settlement.target),
        'RECOMMENDATION',
      ),
      fact(
        'settlement_ceiling',
        'Teto',
        recommendation.settlement.ceiling,
        money(recommendation.settlement.ceiling),
        'RECOMMENDATION',
      ),
    );
    answer = `A faixa fornecida pela política vai de ${money(recommendation.settlement.opening)} a ${money(recommendation.settlement.ceiling)}, com alvo de ${money(recommendation.settlement.target)}.`;
  } else if (intent === 'NEGOTIATION') {
    title = 'Situação da negociação';
    if (recommendation.settlement) {
      facts.push(
        fact(
          'settlement_target',
          'Alvo',
          recommendation.settlement.target,
          money(recommendation.settlement.target),
          'RECOMMENDATION',
        ),
      );
    }
    if (negotiation) {
      facts.push(
        fact(
          'proposal_value',
          'Proposta registrada',
          negotiation.proposal_value,
          money(negotiation.proposal_value),
          'NEGOTIATION',
        ),
        fact(
          'negotiation_status',
          'Resultado',
          negotiation.status,
          negotiation.status,
          'NEGOTIATION',
        ),
      );
    }
    answer = negotiation
      ? `A proposta registrada é ${money(negotiation.proposal_value)} e o resultado atual é ${negotiation.status}.`
      : 'Ainda não há negociação registrada para este processo.';
  } else {
    title = 'Estado atual do processo';
    facts.push(
      fact(
        'case_status',
        'Estado do processo',
        caseDetail.status,
        caseDetail.status,
        'CASE_DETAIL',
      ),
      fact(
        'recommendation',
        'Recomendação',
        recommendation.recommendation,
        recommendation.recommendation,
        'RECOMMENDATION',
      ),
      fact(
        'decision',
        'Decisão registrada',
        decision?.decision ?? null,
        decision?.decision ?? 'Ainda não registrada',
        'DECISION',
      ),
      fact(
        'negotiation_status',
        'Resultado da negociação',
        negotiation?.status ?? null,
        negotiation?.status ?? 'Sem negociação',
        'NEGOTIATION',
      ),
    );
    answer = `O processo está em ${caseDetail.status}; a recomendação é ${recommendation.recommendation} e a decisão ${decision ? `registrada é ${decision.decision}` : 'ainda não foi registrada'}.`;
  }

  const citations = buildCitations(citationEntries);
  answer += citationSuffix(citations);
  return {
    audience: 'LAWYER',
    intent,
    mode: 'FACTUAL',
    status: 'ANSWERED',
    title,
    answer,
    facts,
    basis: factualLawyerBasis(request),
    citations,
    calculations: [],
    assumptions: [],
    limitations: lawyerLimitations(request, citations, citationExpected),
    provenance: {
      engine: 'deterministic-policy-copilot',
      version: '1.0.0',
      dataMode: recommendation.demo_data ? 'DEMONSTRATION' : 'OPERATIONAL',
      contextRef: `case:${caseDetail.case_id}`,
      policyVersion: recommendation.policy_version,
      modelVersion: recommendation.model_version,
      dataUpdatedAt: recommendation.generated_at,
    },
  };
}

function adminIntent(request: AdminCopilotRequest): ResolvedCopilotIntent {
  if (request.scenario || request.intent === 'WHAT_IF' || looksLikeWhatIf(request.question))
    return 'WHAT_IF';
  if (request.intent && request.intent !== 'AUTO') return request.intent;
  const question = normalize(request.question);
  if (asksVersionComparison(request.question)) return 'SEGMENTS';
  if (
    (mentionsVersion(request.question) &&
      ['politica', 'modelo'].some((token) => question.includes(token))) ||
    question.includes('qual modelo') ||
    question.includes('modelo usado') ||
    question.includes('politica vigente')
  )
    return 'POLICY_METADATA';
  if (
    question.includes('aderencia') &&
    ['caiu', 'subiu', 'evolucao', 'tendencia', 'historico', 'antes'].some((token) =>
      question.includes(token),
    )
  )
    return 'TREND';
  if (
    ['motivo', 'razao', 'causa'].some((token) => question.includes(token)) &&
    ['override', 'divergencia', 'desvio'].some((token) => question.includes(token))
  )
    return 'OVERRIDE_REASONS';
  if (
    ['revisar', 'revisao', 'priorizar', 'prioridade', 'atencao'].some((token) =>
      question.includes(token),
    )
  )
    return 'REVIEW';
  if (
    [
      'escritorio',
      'firma',
      'advogad',
      'profissional',
      'uf',
      'estado',
      'perfil',
      'segmento',
      'mais diverge',
    ].some((token) => question.includes(token)) ||
    (['funciona', 'funcionando'].some((token) => question.includes(token)) &&
      ['melhor', 'pior', 'onde'].some((token) => question.includes(token)))
  )
    return 'SEGMENTS';
  if (['aderencia', 'override', 'divergencia', 'desvio'].some((token) => question.includes(token)))
    return 'ADHERENCE';
  if (
    [
      'efetividade',
      'economia',
      'aceite',
      'aceit',
      'aceitacao',
      'proposta',
      'propost',
      'recus',
      'contrapropost',
      'acordos',
      'custo',
      'valor sugerido',
      'valor ofertado',
      'valor realizado',
      'valor fechado',
      'impacto financeiro',
    ].some((token) => question.includes(token))
  )
    return 'EFFECTIVENESS';
  if (
    request.context.selectedRow ||
    ['este processo', 'este caso'].some((token) => question.includes(token))
  )
    return 'DECISION';
  return 'OVERVIEW';
}

function formattedFilters(request: AdminCopilotRequest) {
  const entries = Object.entries(request.context.rowScope.filters).filter(
    ([, value]) => value !== '' && value !== null && value !== false,
  );
  return entries.length
    ? entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
    : 'sem filtros ativos';
}

function adminBasis(
  request: AdminCopilotRequest,
  options: { includeMetrics?: boolean; includeSelectedRow?: boolean; includeRows?: boolean } = {},
): CopilotBasis[] {
  const { dashboard, selectedRow, rows, rowScope } = request.context;
  const result: CopilotBasis[] = [];
  if (options.includeMetrics !== false) {
    result.push(
      basis(
        'DASHBOARD_METRICS',
        `KPIs agregados do período “${dashboard.period}”.`,
        dashboard.metrics.decisions,
      ),
    );
  }
  if (options.includeRows) {
    result.push(
      basis(
        'ADMIN_DECISION_ROW',
        `Recorte “${rowScope.description}” no período “${dashboard.period}” (${formattedFilters(request)}).`,
        rows.length,
      ),
    );
  }
  if (options.includeSelectedRow && selectedRow) {
    result.push(
      basis(
        'ADMIN_DECISION_ROW',
        `Linha detalhada do processo ${selectedRow.case_number} no período “${dashboard.period}”.`,
        1,
      ),
    );
  }
  return result;
}

function adminScopeLimitations(request: AdminCopilotRequest) {
  const { dashboard, rows, rowScope } = request.context;
  if (rows.length === dashboard.metrics.decisions) return [];
  const rowLabel = rows.length === 1 ? 'linha' : 'linhas';
  return [
    `Os KPIs agregados cobrem ${amount(dashboard.metrics.decisions)} decisões; o recorte “${rowScope.description}” contém ${amount(rows.length)} ${rowLabel} e não foi usado para recomputar os KPIs.`,
  ];
}

function validateAdminContext(request: AdminCopilotRequest) {
  const { selectedRow, rows } = request.context;
  if (
    selectedRow &&
    !rows.some((row) => row.id === selectedRow.id && row.case_id === selectedRow.case_id)
  ) {
    throw new PolicyCopilotInputError(
      'CONTEXT_MISMATCH',
      'A decisão selecionada não pertence ao recorte administrativo fornecido.',
    );
  }
}

type SegmentDimension = 'FIRM' | 'LAWYER' | 'UF' | 'PROFILE' | 'POLICY_VERSION' | 'MODEL_VERSION';

function segmentDimension(question: string): SegmentDimension {
  const normalized = normalize(question);
  if (mentionsVersion(question) && normalized.includes('politica')) return 'POLICY_VERSION';
  if (mentionsVersion(question) && normalized.includes('modelo')) return 'MODEL_VERSION';
  if (normalized.includes('uf') || normalized.includes('estado')) return 'UF';
  if (normalized.includes('perfil')) return 'PROFILE';
  if (normalized.includes('advogad') || normalized.includes('profissional')) return 'LAWYER';
  return 'FIRM';
}

function segmentLabel(row: AdminDecisionRow, dimension: SegmentDimension) {
  if (dimension === 'POLICY_VERSION') return row.policy_version || 'Versão não informada';
  if (dimension === 'MODEL_VERSION') return row.model_version || 'Versão não informada';
  if (dimension === 'UF') return row.uf || 'UF não informada';
  if (dimension === 'PROFILE') return row.lawyer_profile_label || 'Perfil não informado';
  if (dimension === 'LAWYER') return row.lawyer_name || 'Advogado não informado';
  return row.firm_name || 'Escritório não informado';
}

function summarizeSegments(rows: AdminDecisionRow[], dimension: SegmentDimension) {
  const groups = new Map<string, { decisions: number; overrides: number }>();
  for (const row of rows) {
    const label = segmentLabel(row, dimension);
    const current = groups.get(label) ?? { decisions: 0, overrides: 0 };
    current.decisions += 1;
    if (!row.adherent) current.overrides += 1;
    groups.set(label, current);
  }
  return [...groups.entries()]
    .map(([label, values]) => ({
      label,
      ...values,
      overrideRate: values.decisions > 0 ? values.overrides / values.decisions : 0,
    }))
    .sort(
      (left, right) =>
        right.overrideRate - left.overrideRate ||
        right.overrides - left.overrides ||
        right.decisions - left.decisions ||
        left.label.localeCompare(right.label, 'pt-BR'),
    );
}

function summarizeRowOverrideReasons(rows: AdminDecisionRow[]) {
  const reasons = new Map<string, number>();
  for (const row of rows) {
    if (row.adherent || !row.override_reason_label?.trim()) continue;
    const rawLabel = row.override_reason_label.trim();
    const label = overrideReasonLabel(rawLabel);
    reasons.set(label, (reasons.get(label) ?? 0) + 1);
  }
  return [...reasons.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort(
      (left, right) => right.value - left.value || left.label.localeCompare(right.label, 'pt-BR'),
    );
}

function normalizedText(value: string | null | undefined) {
  return normalize(value ?? '');
}

function reviewSignals(rows: AdminDecisionRow[]) {
  return {
    overridesWithoutJustification: rows.filter((row) => !row.adherent && !row.justification?.trim())
      .length,
    highConfidenceOverrides: rows.filter(
      (row) => !row.adherent && row.confidence_score != null && row.confidence_score >= 0.8,
    ).length,
    lowCompleteness: rows.filter((row) => normalizedText(row.completeness_band) === 'baixa').length,
  };
}

type VersionedAdminRow = AdminDecisionRow & {
  policy_version?: string;
  model_version?: string;
};

function adminVersions(rows: AdminDecisionRow[]) {
  const policyVersions = new Set<string>();
  const modelVersions = new Set<string>();
  for (const row of rows as VersionedAdminRow[]) {
    if (row.policy_version?.trim()) policyVersions.add(row.policy_version.trim());
    if (row.model_version?.trim()) modelVersions.add(row.model_version.trim());
  }
  return { policyVersions: [...policyVersions].sort(), modelVersions: [...modelVersions].sort() };
}

function adminProvenance(request: AdminCopilotRequest, includeRowVersions = false) {
  const rows = includeRowVersions
    ? request.context.selectedRow
      ? [request.context.selectedRow]
      : request.context.rows
    : [];
  const versions = adminVersions(rows);
  return {
    engine: 'deterministic-policy-copilot' as const,
    version: '1.0.0' as const,
    dataMode: request.context.dashboard.demo_data
      ? ('DEMONSTRATION' as const)
      : ('OPERATIONAL' as const),
    period: request.context.dashboard.period,
    ...(versions.policyVersions.length
      ? { policyVersion: versions.policyVersions.join(', ') }
      : {}),
    ...(versions.modelVersions.length ? { modelVersion: versions.modelVersions.join(', ') } : {}),
    dataUpdatedAt: request.context.dashboard.updated_at,
    dashboardUpdatedAt: request.context.dashboard.updated_at,
  };
}

function unavailableAdmin(
  request: AdminCopilotRequest,
  intent: ResolvedCopilotIntent,
  reason: string,
  scope: { includeMetrics?: boolean; includeRows?: boolean; includeSelectedRow?: boolean } = {},
): PolicyCopilotResponse {
  return {
    audience: 'ADMIN',
    intent,
    mode: 'FACTUAL',
    status: 'UNAVAILABLE',
    title: 'Informação indisponível',
    answer: reason,
    facts: [],
    basis: adminBasis(request, scope),
    citations: [],
    calculations: [],
    assumptions: [],
    limitations: [reason, ...adminScopeLimitations(request)],
    provenance: adminProvenance(request, Boolean(scope.includeRows || scope.includeSelectedRow)),
  };
}

function validateRate(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new PolicyCopilotInputError('INVALID_SCENARIO', `${label} deve estar entre 0 e 1.`);
  }
}

function simulateAdmin(
  request: AdminCopilotRequest,
  scenario: AdminWhatIfScenario,
): PolicyCopilotResponse {
  const metrics = request.context.dashboard.metrics;
  const facts: CopilotFact[] = [];
  const calculations: CopilotCalculation[] = [];
  const assumptions: string[] = [];
  let answer: string;

  if (scenario.type === 'ACCEPTANCE_RATE') {
    validateRate(scenario.acceptanceRate, 'A taxa de aceitação simulada');
    if (metrics.settlements <= 0 || metrics.agreement_proposals <= 0) {
      return unavailableAdmin(
        request,
        'WHAT_IF',
        'Não há acordos aceitos e propostas suficientes para derivar esta simulação.',
      );
    }
    const projectedAccepted = metrics.agreement_proposals * scenario.acceptanceRate;
    const savingsPerSettlement = metrics.estimated_savings / metrics.settlements;
    const projectedSavings = projectedAccepted * savingsPerSettlement;
    const projectedCost = Math.max(0, metrics.baseline_cost - projectedSavings);
    facts.push(
      fact(
        'simulated_acceptance_rate',
        'Taxa de aceitação simulada',
        scenario.acceptanceRate,
        percent(scenario.acceptanceRate),
        'DERIVED',
      ),
      fact(
        'projected_accepted_settlements',
        'Acordos aceitos projetados',
        projectedAccepted,
        amount(projectedAccepted),
        'DERIVED',
      ),
      fact(
        'projected_savings',
        'Economia estimada simulada',
        projectedSavings,
        money(projectedSavings),
        'DERIVED',
      ),
      fact(
        'projected_cost',
        'Custo projetado simulado',
        projectedCost,
        money(projectedCost),
        'DERIVED',
      ),
    );
    calculations.push(
      {
        key: 'projected_accepted_settlements',
        label: 'Acordos aceitos projetados',
        formula: 'propostas de acordo × taxa de aceitação simulada',
        inputs: [
          { label: 'Propostas de acordo', value: metrics.agreement_proposals },
          { label: 'Taxa simulada', value: scenario.acceptanceRate },
        ],
        result: projectedAccepted,
        formattedResult: amount(projectedAccepted),
      },
      {
        key: 'projected_savings',
        label: 'Economia estimada simulada',
        formula: 'acordos aceitos projetados × economia estimada atual por acordo aceito',
        inputs: [
          { label: 'Acordos aceitos projetados', value: projectedAccepted },
          { label: 'Economia estimada atual por acordo aceito', value: savingsPerSettlement },
        ],
        result: projectedSavings,
        formattedResult: money(projectedSavings),
      },
      {
        key: 'projected_cost',
        label: 'Custo projetado simulado',
        formula: 'custo-base − economia estimada simulada',
        inputs: [
          { label: 'Custo-base', value: metrics.baseline_cost },
          { label: 'Economia estimada simulada', value: projectedSavings },
        ],
        result: projectedCost,
        formattedResult: money(projectedCost),
      },
    );
    assumptions.push(
      'O número de propostas e o custo-base permanecem constantes.',
      'A economia estimada por acordo aceito permanece igual à observada nos KPIs fornecidos.',
      'A simulação é uma extrapolação aritmética e não demonstra causalidade.',
    );
    answer = `SIMULAÇÃO: com taxa de aceitação de ${percent(scenario.acceptanceRate)}, as ${amount(metrics.agreement_proposals)} propostas resultariam em ${amount(projectedAccepted)} acordos aceitos e economia estimada de ${money(projectedSavings)}.`;
  } else {
    validateRate(scenario.adherenceRate, 'A taxa de aderência simulada');
    const adherent = metrics.decisions * scenario.adherenceRate;
    const overrides = metrics.decisions - adherent;
    facts.push(
      fact(
        'simulated_adherence_rate',
        'Taxa de aderência simulada',
        scenario.adherenceRate,
        percent(scenario.adherenceRate),
        'DERIVED',
      ),
      fact(
        'projected_adherent',
        'Decisões aderentes projetadas',
        adherent,
        amount(adherent),
        'DERIVED',
      ),
      fact(
        'projected_overrides',
        'Divergências projetadas',
        overrides,
        amount(overrides),
        'DERIVED',
      ),
    );
    calculations.push(
      {
        key: 'projected_adherent',
        label: 'Decisões aderentes projetadas',
        formula: 'decisões × taxa de aderência simulada',
        inputs: [
          { label: 'Decisões', value: metrics.decisions },
          { label: 'Taxa simulada', value: scenario.adherenceRate },
        ],
        result: adherent,
        formattedResult: amount(adherent),
      },
      {
        key: 'projected_overrides',
        label: 'Divergências projetadas',
        formula: 'decisões − decisões aderentes projetadas',
        inputs: [
          { label: 'Decisões', value: metrics.decisions },
          { label: 'Decisões aderentes projetadas', value: adherent },
        ],
        result: overrides,
        formattedResult: amount(overrides),
      },
    );
    assumptions.push(
      'O volume total de decisões permanece constante.',
      'Nenhum efeito financeiro foi estimado porque o contexto não relaciona aderência e economia de forma causal.',
    );
    answer = `SIMULAÇÃO: com aderência de ${percent(scenario.adherenceRate)}, o volume atual corresponderia a ${amount(adherent)} decisões aderentes e ${amount(overrides)} divergências.`;
  }

  return {
    audience: 'ADMIN',
    intent: 'WHAT_IF',
    mode: 'SIMULATION',
    status: 'ANSWERED',
    label: 'SIMULAÇÃO',
    title: 'SIMULAÇÃO administrativa',
    answer,
    facts,
    basis: [
      ...adminBasis(request),
      basis('DERIVED', 'Cálculos aritméticos sobre os KPIs agregados fornecidos.'),
    ],
    citations: [],
    calculations,
    assumptions,
    limitations: adminScopeLimitations(request),
    provenance: adminProvenance(request),
  };
}

function answerAdmin(request: AdminCopilotRequest): PolicyCopilotResponse {
  validateAdminContext(request);
  const intent = adminIntent(request);
  if (asksDefenseOutcome(request.question)) {
    return unavailableAdmin(
      request,
      intent,
      'O dashboard fornecido não contém resultado judicial da defesa.',
    );
  }
  if (intent === 'TREND') {
    return unavailableAdmin(
      request,
      intent,
      'O dashboard fornecido não contém uma série histórica de aderência comparável; não é possível afirmar que ela caiu ou subiu.',
    );
  }
  if (intent === 'WHAT_IF') {
    const parsedScenario = request.scenario ?? parseAdminWhatIfScenario(request.question);
    if (!parsedScenario) {
      return unavailableAdmin(
        request,
        intent,
        'A simulação precisa de um cenário estruturado ou de uma taxa explícita de aceitação/aderência; limites e demais variações numéricas não serão inferidos.',
      );
    }
    return simulateAdmin(request, parsedScenario);
  }

  const { dashboard, selectedRow, rows, rowScope } = request.context;
  const metrics = dashboard.metrics;
  const facts: CopilotFact[] = [];
  const extraBasis: CopilotBasis[] = [];
  const extraLimitations: string[] = [];
  let title: string;
  let answer: string;
  let includeMetrics = true;
  let includeSelectedRow = false;
  let includeRows = false;

  if (intent === 'DECISION') {
    if (!selectedRow) {
      return unavailableAdmin(
        request,
        intent,
        'Selecione uma linha administrativa para consultar uma decisão específica.',
      );
    }
    includeMetrics = false;
    includeSelectedRow = true;
    title = `Decisão do processo ${selectedRow.case_number}`;
    facts.push(
      fact(
        'case_number',
        'Processo',
        selectedRow.case_number,
        selectedRow.case_number,
        'ADMIN_DECISION_ROW',
      ),
      fact(
        'recommendation',
        'Recomendação',
        selectedRow.recommendation,
        selectedRow.recommendation,
        'ADMIN_DECISION_ROW',
      ),
      fact('decision', 'Decisão', selectedRow.decision, selectedRow.decision, 'ADMIN_DECISION_ROW'),
      fact(
        'adherent',
        'Aderência',
        selectedRow.adherent,
        selectedRow.adherent ? 'Aderente' : 'Divergência',
        'ADMIN_DECISION_ROW',
      ),
      fact('status', 'Resultado', selectedRow.status, selectedRow.status, 'ADMIN_DECISION_ROW'),
    );
    if (selectedRow.suggested_value !== null) {
      facts.push(
        fact(
          'suggested_value',
          'Valor sugerido',
          selectedRow.suggested_value,
          money(selectedRow.suggested_value),
          'ADMIN_DECISION_ROW',
        ),
      );
    }
    if (selectedRow.realized_value !== null) {
      facts.push(
        fact(
          'realized_value',
          'Valor realizado',
          selectedRow.realized_value,
          money(selectedRow.realized_value),
          'ADMIN_DECISION_ROW',
        ),
      );
    }
    answer = `${selectedRow.plaintiff}: recomendação ${selectedRow.recommendation}, decisão ${selectedRow.decision}, ${selectedRow.adherent ? 'aderente à política' : 'com divergência registrada'} e resultado ${selectedRow.status}.`;
  } else if (intent === 'SEGMENTS') {
    if (!rows.length) {
      return unavailableAdmin(
        request,
        intent,
        `O recorte “${rowScope.description}” não contém linhas para comparar segmentos.`,
        { includeMetrics: false, includeRows: true },
      );
    }
    includeMetrics = false;
    includeRows = true;
    const dimension = segmentDimension(request.question);
    const segments = summarizeSegments(rows, dimension);
    if (
      (dimension === 'POLICY_VERSION' || dimension === 'MODEL_VERSION') &&
      segments.filter((segment) => segment.label !== 'Versão não informada').length < 2
    ) {
      return unavailableAdmin(
        request,
        intent,
        `O recorte não contém ao menos duas versões identificadas ${dimension === 'POLICY_VERSION' ? 'da política' : 'do modelo'} para comparação.`,
        { includeMetrics: false, includeRows: true },
      );
    }
    const normalizedQuestion = normalize(request.question);
    const wantsBest = normalizedQuestion.includes('melhor') && !normalizedQuestion.includes('pior');
    const selected = wantsBest ? segments[segments.length - 1]! : segments[0]!;
    const dimensionLabel =
      dimension === 'UF'
        ? 'UF'
        : dimension === 'PROFILE'
          ? 'perfil'
          : dimension === 'LAWYER'
            ? 'advogado'
            : dimension === 'POLICY_VERSION'
              ? 'versão da política'
              : dimension === 'MODEL_VERSION'
                ? 'versão do modelo'
                : 'escritório';
    title = `Divergência por ${dimensionLabel}`;
    facts.push(
      fact('segment', dimensionLabel, selected.label, selected.label, 'ADMIN_DECISION_ROW'),
      fact(
        'segment_decisions',
        'Decisões no segmento',
        selected.decisions,
        amount(selected.decisions),
        'ADMIN_DECISION_ROW',
      ),
      fact(
        'segment_overrides',
        'Divergências no segmento',
        selected.overrides,
        amount(selected.overrides),
        'ADMIN_DECISION_ROW',
      ),
      fact(
        'segment_override_rate',
        'Taxa de divergência no segmento',
        selected.overrideRate,
        percent(selected.overrideRate),
        'DERIVED',
      ),
    );
    extraLimitations.push(
      'A comparação usa a taxa de divergência como indicador operacional; ela não mede resultado financeiro ou judicial por segmento.',
    );
    answer = segments.every((segment) => segment.overrides === 0)
      ? `No recorte “${rowScope.description}” (N=${amount(rows.length)}), não há divergências registradas; por isso não é possível apontar um segmento com desempenho ${wantsBest ? 'melhor' : 'pior'} por esse indicador.`
      : segments.every((segment) => segment.overrideRate === selected.overrideRate)
        ? `No recorte “${rowScope.description}” (N=${amount(rows.length)}), todos os segmentos comparados têm a mesma taxa de divergência (${percent(selected.overrideRate)}); não há um segmento isolado com desempenho ${wantsBest ? 'melhor' : 'pior'} por esse indicador.`
        : `No recorte “${rowScope.description}” (N=${amount(rows.length)}), ${selected.label} tem a ${wantsBest ? 'menor' : 'maior'} taxa de divergência na dimensão “${dimensionLabel}”: ${percent(selected.overrideRate)} (${amount(selected.overrides)} de ${amount(selected.decisions)} decisões).`;
  } else if (intent === 'OVERRIDE_REASONS') {
    const rowReasons = summarizeRowOverrideReasons(rows);
    if (rowReasons.length) {
      includeMetrics = false;
      includeRows = true;
      title = 'Motivos de divergência no recorte';
      rowReasons.slice(0, 5).forEach((item, index) => {
        facts.push(
          fact(
            `override_reason_${index + 1}`,
            item.label,
            item.value,
            amount(item.value),
            'ADMIN_DECISION_ROW',
          ),
        );
      });
      answer = `No recorte “${rowScope.description}” (N=${amount(rows.length)}), o motivo mais frequente é “${rowReasons[0]!.label}”, com ${amount(rowReasons[0]!.value)} registros.`;
    } else if (dashboard.override_reasons.length) {
      const sorted = [...dashboard.override_reasons].sort(
        (left, right) => right.value - left.value || left.label.localeCompare(right.label, 'pt-BR'),
      );
      const aggregateN = sorted.reduce((total, item) => total + item.value, 0);
      title = 'Motivos agregados de divergência';
      sorted.slice(0, 5).forEach((item, index) => {
        facts.push(
          fact(
            `override_reason_${index + 1}`,
            item.label,
            item.value,
            amount(item.value),
            'DASHBOARD_METRICS',
          ),
        );
      });
      extraBasis.push(
        basis(
          'DASHBOARD_METRICS',
          'Distribuição agregada de motivos fornecida pelo dashboard.',
          aggregateN,
        ),
      );
      extraLimitations.push(
        `As linhas do recorte “${rowScope.description}” não possuem motivos classificados; foi usada a distribuição agregada do dashboard, fora do recorte.`,
      );
      answer = `Na distribuição agregada disponível (N=${amount(aggregateN)}), o motivo mais frequente é “${sorted[0]!.label}”, com ${amount(sorted[0]!.value)} registros.`;
    } else {
      return unavailableAdmin(
        request,
        intent,
        'Não há motivos de divergência classificados nas linhas nem no agregado do dashboard.',
        { includeRows: true },
      );
    }
  } else if (intent === 'REVIEW') {
    if (!rows.length) {
      return unavailableAdmin(
        request,
        intent,
        `O recorte “${rowScope.description}” não contém linhas para priorizar uma revisão.`,
        { includeMetrics: false, includeRows: true },
      );
    }
    includeMetrics = false;
    includeRows = true;
    title = 'Prioridade de revisão do recorte';
    const signals = reviewSignals(rows);
    facts.push(
      fact(
        'overrides_without_justification',
        'Divergências sem justificativa',
        signals.overridesWithoutJustification,
        amount(signals.overridesWithoutJustification),
        'ADMIN_DECISION_ROW',
      ),
      fact(
        'high_confidence_overrides',
        'Divergências com alta confiança',
        signals.highConfidenceOverrides,
        amount(signals.highConfidenceOverrides),
        'ADMIN_DECISION_ROW',
      ),
      fact(
        'low_completeness',
        'Casos com baixa completude',
        signals.lowCompleteness,
        amount(signals.lowCompleteness),
        'ADMIN_DECISION_ROW',
      ),
    );
    const priorities = [
      signals.overridesWithoutJustification
        ? `${amount(signals.overridesWithoutJustification)} divergências sem justificativa`
        : null,
      signals.highConfidenceOverrides
        ? `${amount(signals.highConfidenceOverrides)} divergências com confiança de pelo menos 80%`
        : null,
      signals.lowCompleteness
        ? `${amount(signals.lowCompleteness)} casos com baixa completude documental`
        : null,
    ].filter((value): value is string => value !== null);
    answer = priorities.length
      ? `No recorte “${rowScope.description}” (N=${amount(rows.length)}), priorize a revisão de ${priorities.join('; ')}.`
      : `No recorte “${rowScope.description}” (N=${amount(rows.length)}), os sinais determinísticos disponíveis não apontam uma prioridade de revisão.`;
    extraLimitations.push(
      'A priorização usa apenas justificativa, confiança e completude presentes nas linhas; ela não mede mérito jurídico.',
    );
  } else if (intent === 'POLICY_METADATA') {
    const versionRows = selectedRow ? [selectedRow] : rows;
    const versions = adminVersions(versionRows);
    if (!versions.policyVersions.length && !versions.modelVersions.length) {
      return unavailableAdmin(
        request,
        intent,
        'As linhas administrativas fornecidas não contêm versão da política nem do modelo.',
        {
          includeMetrics: false,
          includeRows: !selectedRow,
          includeSelectedRow: selectedRow !== undefined,
        },
      );
    }
    includeMetrics = false;
    includeRows = !selectedRow;
    includeSelectedRow = selectedRow !== undefined;
    title = 'Versões registradas nas linhas administrativas';
    if (versions.policyVersions.length) {
      const value = versions.policyVersions.join(', ');
      facts.push(
        fact('policy_versions', 'Versões da política', value, value, 'ADMIN_DECISION_ROW'),
      );
    }
    if (versions.modelVersions.length) {
      const value = versions.modelVersions.join(', ');
      facts.push(fact('model_versions', 'Versões do modelo', value, value, 'ADMIN_DECISION_ROW'));
    }
    answer = `Versões presentes nas ${amount(versionRows.length)} linhas consultadas: política ${versions.policyVersions.join(', ') || 'não informada'}; modelo ${versions.modelVersions.join(', ') || 'não informado'}.`;
    extraLimitations.push(
      'A resposta lista identificadores presentes; não há dados para comparar desempenho entre versões.',
    );
  } else if (intent === 'ADHERENCE') {
    title = 'Aderência à política';
    facts.push(
      fact(
        'decisions',
        'Decisões',
        metrics.decisions,
        amount(metrics.decisions),
        'DASHBOARD_METRICS',
      ),
      fact(
        'adherence_rate',
        'Taxa de aderência',
        metrics.adherence_rate,
        percent(metrics.adherence_rate),
        'DASHBOARD_METRICS',
      ),
      fact(
        'overrides',
        'Divergências',
        metrics.overrides,
        amount(metrics.overrides),
        'DASHBOARD_METRICS',
      ),
    );
    answer = `Nos KPIs agregados de ${amount(metrics.decisions)} decisões, a aderência é ${percent(metrics.adherence_rate)} e há ${amount(metrics.overrides)} divergências.`;
  } else if (intent === 'EFFECTIVENESS') {
    const effectivenessQuestion = normalize(request.question);
    const asksValues = [
      'valor sugerido',
      'valor ofertado',
      'valor realizado',
      'valor fechado',
      'sugerido x realizado',
      'ofertado x fechado',
    ].some((token) => effectivenessQuestion.includes(token));
    const asksFinancialImpact = ['economia', 'custo', 'impacto financeiro'].some((token) =>
      effectivenessQuestion.includes(token),
    );
    if (asksValues) {
      title = 'Valor sugerido x realizado';
      facts.push(
        fact(
          'average_offered_value',
          'Valor médio sugerido',
          metrics.average_offered_value,
          money(metrics.average_offered_value),
          'DASHBOARD_METRICS',
        ),
        fact(
          'average_closed_value',
          'Valor médio realizado',
          metrics.average_closed_value,
          money(metrics.average_closed_value),
          'DASHBOARD_METRICS',
        ),
      );
      answer = `Nos KPIs agregados, o valor médio sugerido é ${money(metrics.average_offered_value)} e o valor médio realizado nos acordos fechados é ${money(metrics.average_closed_value)}.`;
    } else if (asksFinancialImpact) {
      title = 'Impacto financeiro';
      facts.push(
        fact(
          'baseline_cost',
          'Custo de referência',
          metrics.baseline_cost,
          money(metrics.baseline_cost),
          'DASHBOARD_METRICS',
        ),
        fact(
          'projected_cost',
          'Custo projetado',
          metrics.projected_cost,
          money(metrics.projected_cost),
          'DASHBOARD_METRICS',
        ),
        fact(
          'estimated_savings',
          'Economia estimada',
          metrics.estimated_savings,
          money(metrics.estimated_savings),
          'DASHBOARD_METRICS',
        ),
        fact(
          'estimated_savings_rate',
          'Taxa de economia estimada',
          metrics.estimated_savings_rate,
          percent(metrics.estimated_savings_rate),
          'DASHBOARD_METRICS',
        ),
      );
      answer = `No período “${dashboard.period}”, o custo de referência é ${money(metrics.baseline_cost)}, o custo projetado é ${money(metrics.projected_cost)} e a economia estimada é ${money(metrics.estimated_savings)} (${percent(metrics.estimated_savings_rate)}).`;
    } else {
      title = 'Resultado dos acordos';
      facts.push(
        fact(
          'agreement_proposals',
          'Propostas de acordo',
          metrics.agreement_proposals,
          amount(metrics.agreement_proposals),
          'DASHBOARD_METRICS',
        ),
        fact(
          'settlements',
          'Acordos aceitos',
          metrics.settlements,
          amount(metrics.settlements),
          'DASHBOARD_METRICS',
        ),
        fact(
          'rejected',
          'Propostas recusadas',
          metrics.rejected,
          amount(metrics.rejected),
          'DASHBOARD_METRICS',
        ),
        fact(
          'counteroffers',
          'Contrapropostas',
          metrics.counteroffers,
          amount(metrics.counteroffers),
          'DASHBOARD_METRICS',
        ),
        fact(
          'acceptance_rate',
          'Taxa de aceitação',
          metrics.acceptance_rate,
          percent(metrics.acceptance_rate),
          'DASHBOARD_METRICS',
        ),
      );
      answer = `Os KPIs agregados registram ${amount(metrics.agreement_proposals)} propostas, ${amount(metrics.settlements)} acordos aceitos, ${amount(metrics.rejected)} recusas, ${amount(metrics.counteroffers)} contrapropostas e taxa de aceitação de ${percent(metrics.acceptance_rate)}.`;
    }
  } else {
    title = 'Visão geral da política';
    facts.push(
      fact(
        'decisions',
        'Decisões',
        metrics.decisions,
        amount(metrics.decisions),
        'DASHBOARD_METRICS',
      ),
      fact(
        'adherence_rate',
        'Taxa de aderência',
        metrics.adherence_rate,
        percent(metrics.adherence_rate),
        'DASHBOARD_METRICS',
      ),
      fact(
        'acceptance_rate',
        'Taxa de aceitação',
        metrics.acceptance_rate,
        percent(metrics.acceptance_rate),
        'DASHBOARD_METRICS',
      ),
      fact(
        'estimated_savings',
        'Economia estimada',
        metrics.estimated_savings,
        money(metrics.estimated_savings),
        'DASHBOARD_METRICS',
      ),
    );
    answer = `O período “${dashboard.period}” reúne ${amount(metrics.decisions)} decisões, aderência de ${percent(metrics.adherence_rate)}, aceitação de ${percent(metrics.acceptance_rate)} e economia estimada de ${money(metrics.estimated_savings)}.`;
  }

  return {
    audience: 'ADMIN',
    intent,
    mode: 'FACTUAL',
    status: 'ANSWERED',
    title,
    answer,
    facts,
    basis: [
      ...adminBasis(request, { includeMetrics, includeSelectedRow, includeRows }),
      ...extraBasis,
    ],
    citations: [],
    calculations: [],
    assumptions: [],
    limitations: [...adminScopeLimitations(request), ...extraLimitations],
    provenance: adminProvenance(request, includeRows || includeSelectedRow),
  };
}

/** Pure deterministic implementation. It performs no I/O and reads only request context. */
export function respondWithPolicyCopilot(request: PolicyCopilotRequest): PolicyCopilotResponse {
  return request.audience === 'LAWYER' ? answerLawyer(request) : answerAdmin(request);
}

export class DeterministicPolicyCopilot implements PolicyCopilotProvider {
  async respond(request: PolicyCopilotRequest): Promise<PolicyCopilotResponse> {
    return respondWithPolicyCopilot(request);
  }
}

export const deterministicPolicyCopilot: PolicyCopilotProvider = new DeterministicPolicyCopilot();

export type {
  AdminCopilotContext,
  AdminCopilotIntent,
  AdminCopilotRequest,
  AdminWhatIfScenario,
  CopilotBasis,
  CopilotCalculation,
  CopilotCitation,
  CopilotFact,
  CopilotMode,
  CopilotProvenance,
  CopilotStatus,
  LawyerCopilotContext,
  LawyerCopilotIntent,
  LawyerCopilotRequest,
  LawyerWhatIfScenario,
  PolicyCopilotInputErrorCode,
  PolicyCopilotProvider,
  PolicyCopilotRequest,
  PolicyCopilotResponse,
  ResolvedCopilotIntent,
} from './policyCopilot.types';
