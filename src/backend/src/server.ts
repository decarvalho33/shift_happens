import { createApp } from './app.ts';
import { config } from './config.ts';
import { createOpenAIAnswerGenerator } from './model.ts';

const app = createApp({
  generate: createOpenAIAnswerGenerator({
    apiKey: config.apiKey, model: config.model, timeoutMs: config.openAITimeoutMs,
  }),
  model: config.model,
  configured: Boolean(config.apiKey),
  allowedOrigins: config.allowedOrigins,
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Backend do copiloto em http://127.0.0.1:${config.port}`);
  console.log(`Modelo OpenAI: ${config.model}`);
  if (!config.apiKey) console.warn('OPENAI_API_KEY não configurada; edite src/backend/.env.');
});

function shutdown() { app.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
