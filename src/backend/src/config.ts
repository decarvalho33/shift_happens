import 'dotenv/config';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: positiveInteger(process.env.PORT, 8787),
  apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
  model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
  openAITimeoutMs: positiveInteger(process.env.OPENAI_TIMEOUT_MS, 12_000),
  allowedOrigins: new Set(
    (process.env.COPILOT_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  ),
};
