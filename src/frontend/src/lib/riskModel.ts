import type { CaseDetail, CaseDocument, SubSubject, SubsidyKey } from '../types';

/**
 * Taxa de risco: regressão logística treinada nas 59,720 sentenças da planilha
 * Hackaton_Enter_Base_Candidatos.xlsx (src/modelo/taxa_de_risco/treinar.py, treinado em 2026-09-12T21:11:16).
 *
 * P(perda) = 1 / (1 + e^(−soma)), com soma = intercepto + pesos dos subsídios juntados
 * + peso do golpe + efeito da UF. Ao retreinar, copie os números de
 * src/modelo/taxa_de_risco/resultados/modelo.json.
 */
export const RISK_MODEL = {
  version: 'taxa-de-risco-logistica-2026-09-12',
  intercept: 3.79735625985465,
  subsidies: {
    contrato: -3.0801598199549383,
    extrato: -2.9968253901656383,
    comprovante: -1.2708959693724236,
    dossie: 0.03629446745321955,
    demonstrativo: -0.5202834062906081,
    laudo: -0.03954898693269461,
  } satisfies Record<SubsidyKey, number>,
  golpe: 1.0215374231303873,
  ufEffects: {
    AC: -0.20649994146461845,
    AL: 0.015768782991467188,
    AM: 0.7440515250017524,
    AP: 0.8255298418817584,
    BA: 0.15084559910250783,
    CE: -0.0817403476535222,
    DF: 0.16556625648504897,
    ES: 0.201311392589504,
    GO: 0.3054086934642245,
    MA: -0.45833424035491965,
    MG: 0.017149461954267312,
    MS: -0.2949878060186284,
    MT: -0.2856871007065005,
    PA: -0.10420842022288077,
    PB: -0.09547532756259114,
    PE: 0.04608221821088736,
    PI: -0.41681624896074154,
    PR: -0.30574832189526235,
    RJ: 0.2930054107883566,
    RN: -0.2523850456071351,
    RO: -0.26917497630244847,
    RS: 0.37723194293350526,
    SC: -0.09884077422262885,
    SE: -0.012029621019057033,
    SP: -0.018258211524935643,
    TO: -0.2417647418874095,
  } as Record<string, number>,
};

export const SUBSIDY_KEYS: readonly SubsidyKey[] = [
  'contrato',
  'extrato',
  'comprovante',
  'dossie',
  'demonstrativo',
  'laudo',
];

export const SUBSIDY_LABELS: Record<SubsidyKey, string> = {
  contrato: 'Contrato',
  extrato: 'Extrato',
  comprovante: 'Comprovante de crédito',
  dossie: 'Dossiê',
  demonstrativo: 'Demonstrativo da dívida',
  laudo: 'Laudo referenciado',
};

// RR não aparece na base de treino e usa efeito zero, o da UF média.
const BRAZILIAN_UFS = new Set([...Object.keys(RISK_MODEL.ufEffects), 'RR']);

export interface RiskInput {
  uf: string;
  subSubject: SubSubject;
  subsidies: Iterable<SubsidyKey>;
}

/** Como na planilha, o subsídio conta quando foi fornecido, mesmo que o documento esteja inconclusivo. */
export function subsidiesFromDocuments(documents: readonly CaseDocument[]): Set<SubsidyKey> {
  const juntados = new Set<SubsidyKey>();
  for (const document of documents) {
    if (document.subsidy && document.status !== 'AUSENTE') juntados.add(document.subsidy);
  }
  return juntados;
}

export function riskLogOdds(input: RiskInput): number | null {
  const uf = input.uf.trim().toUpperCase();
  if (!BRAZILIAN_UFS.has(uf)) return null;
  let soma = RISK_MODEL.intercept + (RISK_MODEL.ufEffects[uf] ?? 0);
  if (input.subSubject === 'GOLPE') soma += RISK_MODEL.golpe;
  for (const subsidy of new Set(input.subsidies)) soma += RISK_MODEL.subsidies[subsidy];
  return soma;
}

export function estimateLossProbability(input: RiskInput): number | null {
  const logOdds = riskLogOdds(input);
  return logOdds === null ? null : 1 / (1 + Math.exp(-logOdds));
}

/** Sem sub-assunto ou com UF inválida, não há como calcular: devolve null. */
export function lossProbabilityForCase(
  caseDetail: Pick<CaseDetail, 'uf' | 'sub_subject' | 'documents'>,
): number | null {
  if (!caseDetail.sub_subject) return null;
  return estimateLossProbability({
    uf: caseDetail.uf,
    subSubject: caseDetail.sub_subject,
    subsidies: subsidiesFromDocuments(caseDetail.documents),
  });
}
