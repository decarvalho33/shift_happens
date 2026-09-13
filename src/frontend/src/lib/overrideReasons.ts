import type { OverrideReason } from '../types';

export const MIN_OVERRIDE_JUSTIFICATION_LENGTH = 20;

export interface OverrideReasonDefinition {
  value: OverrideReason;
  label: string;
  guidance: string;
  placeholder: string;
}

/**
 * Catálogo único dos motivos de divergência. Os códigos permanecem estáveis
 * para manter compatibilidade com a API e com decisões já salvas.
 */
export const overrideReasonDefinitions: readonly OverrideReasonDefinition[] = [
  {
    value: 'NOVA_EVIDENCIA',
    label: 'Fato ou documento novo',
    guidance: 'Informe o fato ou documento, a data, a página ou origem e como isso muda a decisão.',
    placeholder: 'Ex.: novo extrato, página 3, confirma pagamento e altera o risco do caso.',
  },
  {
    value: 'ESTRATEGIA_PROCESSUAL',
    label: 'Fundamento jurídico ou estratégia processual',
    guidance: 'Informe a tese, o precedente, o prazo ou o ato processual e o impacto esperado.',
    placeholder: 'Ex.: precedente aplicável ao caso favorece a defesa e reduz o risco de perda.',
  },
  {
    value: 'INFORMACAO_NAO_CONSIDERADA',
    label: 'Dado relevante não considerado',
    guidance: 'Identifique o dado, a fonte e como ele altera a análise apresentada pela política.',
    placeholder: 'Ex.: valor já pago no comprovante, página 2, reduz a exposição financeira.',
  },
  {
    value: 'POLITICA_INADEQUADA',
    label: 'Exceção à regra da política',
    guidance: 'Indique a regra, faixa ou critério da política e por que ele não se aplica ao caso.',
    placeholder: 'Ex.: a faixa prevista não considera esta exceção contratual documentada.',
  },
  {
    value: 'OUTRO',
    label: 'Outro motivo verificável',
    guidance: 'Descreva o fato verificável, a fonte disponível e o impacto sobre a decisão.',
    placeholder: 'Descreva o motivo, onde ele pode ser verificado e como muda a decisão.',
  },
] as const;

export function isOverrideReason(value: unknown): value is OverrideReason {
  return (
    typeof value === 'string' &&
    overrideReasonDefinitions.some((definition) => definition.value === value)
  );
}

export function getOverrideReasonDefinition(
  value: OverrideReason | '' | null | undefined,
): OverrideReasonDefinition | undefined {
  return overrideReasonDefinitions.find((definition) => definition.value === value);
}

function normalizedLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

const legacyLabelCodes: Record<string, OverrideReason> = {
  'nova evidencia': 'NOVA_EVIDENCIA',
  'estrategia processual': 'ESTRATEGIA_PROCESSUAL',
  'informacao nao considerada': 'INFORMACAO_NAO_CONSIDERADA',
  'politica inadequada': 'POLITICA_INADEQUADA',
  'politica inadequada ao caso': 'POLITICA_INADEQUADA',
  outro: 'OUTRO',
};

export function overrideReasonLabel(value: string | null | undefined): string {
  if (!value?.trim()) return 'Motivo não informado';
  const directDefinition = getOverrideReasonDefinition(isOverrideReason(value) ? value : undefined);
  if (directDefinition) return directDefinition.label;
  const normalized = normalizedLabel(value);
  const currentDefinition = overrideReasonDefinitions.find(
    (definition) => normalizedLabel(definition.label) === normalized,
  );
  if (currentDefinition) return currentDefinition.label;
  const legacyCode = legacyLabelCodes[normalized];
  return legacyCode ? getOverrideReasonDefinition(legacyCode)!.label : value;
}

export function isMeaningfulOverrideJustification(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length >= MIN_OVERRIDE_JUSTIFICATION_LENGTH && /[\p{L}\p{N}]/u.test(normalized);
}
