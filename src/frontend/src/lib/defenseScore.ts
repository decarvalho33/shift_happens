/**
 * Converte a probabilidade de perda (0 a 1) no score de defesa (0 a 100).
 *
 * 0 = fechar acordo; 100 = pode defender. O score é a chance de o banco ganhar, em pontos:
 * score = arredondar(100 × (1 − probabilidade de perda)).
 * Probabilidade ausente ou fora de 0 a 1 devolve null, exibido como "Não calculado".
 */
export function defenseScore(lossProbability: number | null | undefined): number | null {
  if (lossProbability == null || !Number.isFinite(lossProbability)) return null;
  if (lossProbability < 0 || lossProbability > 1) return null;
  return Math.floor(100 * (1 - lossProbability) + 0.5);
}
