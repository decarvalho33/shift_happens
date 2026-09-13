import { describe, expect, it } from 'vitest';
import {
  getOverrideReasonDefinition,
  isMeaningfulOverrideJustification,
  isOverrideReason,
  MIN_OVERRIDE_JUSTIFICATION_LENGTH,
  overrideReasonDefinitions,
  overrideReasonLabel,
} from './overrideReasons';

describe('override reason catalog', () => {
  it('keeps the five API codes unique and exposes clearer operational labels', () => {
    expect(overrideReasonDefinitions.map((item) => item.value)).toEqual([
      'NOVA_EVIDENCIA',
      'ESTRATEGIA_PROCESSUAL',
      'INFORMACAO_NAO_CONSIDERADA',
      'POLITICA_INADEQUADA',
      'OUTRO',
    ]);
    expect(new Set(overrideReasonDefinitions.map((item) => item.value)).size).toBe(5);
    expect(getOverrideReasonDefinition('NOVA_EVIDENCIA')).toMatchObject({
      label: 'Fato ou documento novo',
    });
    expect(getOverrideReasonDefinition('POLITICA_INADEQUADA')?.guidance).toContain('regra');
  });

  it('normalizes stored codes without changing an already human-readable label', () => {
    expect(isOverrideReason('ESTRATEGIA_PROCESSUAL')).toBe(true);
    expect(isOverrideReason('MOTIVO_INEXISTENTE')).toBe(false);
    expect(overrideReasonLabel('ESTRATEGIA_PROCESSUAL')).toBe(
      'Fundamento jurídico ou estratégia processual',
    );
    expect(overrideReasonLabel('Estratégia processual')).toBe(
      'Fundamento jurídico ou estratégia processual',
    );
    expect(overrideReasonLabel('Classificação histórica')).toBe('Classificação histórica');
    expect(overrideReasonLabel(null)).toBe('Motivo não informado');
  });

  it('requires a meaningful justification with at least 20 characters', () => {
    expect(MIN_OVERRIDE_JUSTIFICATION_LENGTH).toBe(20);
    expect(isMeaningfulOverrideJustification('')).toBe(false);
    expect(isMeaningfulOverrideJustification('....................')).toBe(false);
    expect(isMeaningfulOverrideJustification('Documento novo.')).toBe(false);
    expect(isMeaningfulOverrideJustification('Extrato da página 3 confirma o pagamento.')).toBe(
      true,
    );
  });
});
