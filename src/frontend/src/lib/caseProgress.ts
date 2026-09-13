import type { CaseStatus } from '../types';

export type LawyerCaseState =
  'NOVO' | 'VISUALIZADO' | 'DECISAO_REGISTRADA' | 'EM_NEGOCIACAO' | 'CONCLUIDO';

export const CASE_VIEWS_STORAGE_KEY = 'policy:viewed-cases:v1';

let memoryViews = new Set<string>();

function readStoredViews(): Set<string> {
  if (typeof window === 'undefined') return new Set(memoryViews);

  try {
    const raw = window.localStorage.getItem(CASE_VIEWS_STORAGE_KEY);
    if (!raw) return new Set(memoryViews);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
      return new Set(memoryViews);
    }
    memoryViews = new Set(parsed);
  } catch {
    // A memória mantém o indicador útil mesmo quando o armazenamento está indisponível.
  }

  return new Set(memoryViews);
}

function persistViews(views: Set<string>): void {
  memoryViews = new Set(views);
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(CASE_VIEWS_STORAGE_KEY, JSON.stringify([...views]));
  } catch {
    // O acompanhamento visual não deve impedir a navegação do advogado.
  }
}

export function getViewedCaseIds(): Set<string> {
  return readStoredViews();
}

export function markCaseAsViewed(caseId: string): void {
  if (!caseId) return;
  const views = readStoredViews();
  if (views.has(caseId)) return;
  views.add(caseId);
  persistViews(views);
}

export function clearViewedCases(): void {
  memoryViews.clear();
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CASE_VIEWS_STORAGE_KEY);
  } catch {
    // O estado em memória já foi restaurado.
  }
}

export function getLawyerCaseState(
  caseId: string,
  status: CaseStatus,
  viewedCaseIds: ReadonlySet<string>,
): LawyerCaseState {
  if (status === 'AGUARDANDO_DECISAO') {
    return viewedCaseIds.has(caseId) ? 'VISUALIZADO' : 'NOVO';
  }
  return status;
}

if (typeof window !== 'undefined') {
  window.addEventListener('policy:data-changed', (event) => {
    if ((event as CustomEvent).detail?.action === 'reset') clearViewedCases();
  });
}
