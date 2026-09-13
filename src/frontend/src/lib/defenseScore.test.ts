import { describe, expect, it } from 'vitest';
import { defenseScore } from './defenseScore';

describe('defenseScore', () => {
  it('converts the loss probability into the chance of winning, in points from 0 to 100', () => {
    expect(defenseScore(0)).toBe(100);
    expect(defenseScore(1)).toBe(0);
    expect(defenseScore(0.5)).toBe(50);
    expect(defenseScore(0.23)).toBe(77);
    expect(defenseScore(0.72)).toBe(28);
  });

  it('rounds half up, matching the Python risk model', () => {
    expect(defenseScore(0.005)).toBe(100);
    expect(defenseScore(0.995)).toBe(1);
    expect(defenseScore(0.0913)).toBe(91);
  });

  it('returns null when the probability is missing or outside 0 to 1', () => {
    expect(defenseScore(null)).toBeNull();
    expect(defenseScore(undefined)).toBeNull();
    expect(defenseScore(Number.NaN)).toBeNull();
    expect(defenseScore(-0.1)).toBeNull();
    expect(defenseScore(1.2)).toBeNull();
  });
});
