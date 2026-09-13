import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { answerCopilot } from './copilot.ts';
import { HttpError } from './errors.ts';
import type { AnswerGenerator } from './model.ts';

const MAX_BODY_BYTES = 64 * 1024;

export interface AppOptions {
  generate: AnswerGenerator;
  model: string;
  configured: boolean;
  allowedOrigins: Set<string>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function cors(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): boolean {
  const origin = request.headers.origin?.replace(/\/$/, '');
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    json(response, 403, { code: 'ORIGIN_NOT_ALLOWED', message: 'Origem não autorizada.' });
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Vary', 'Origin');
  return true;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição excede 64 KB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'O corpo não contém JSON válido.');
  }
}

export function createApp(options: AppOptions) {
  return createServer(async (request, response) => {
    try {
      if (!cors(request, response, options.allowedOrigins)) return;
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
        response.end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, {
          status: 'ok', service: 'enter-policy-copilot',
          openaiConfigured: options.configured, model: options.model,
        });
        return;
      }
      const audience = url.pathname === '/api/copilot/lawyer'
        ? 'LAWYER' : url.pathname === '/api/copilot/admin' ? 'ADMIN' : null;
      if (!audience) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
      if (request.method !== 'POST')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST para consultar o copiloto.');
      const result = await answerCopilot(audience, await readJson(request), options.generate, options.model);
      json(response, 200, result);
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error('Erro não tratado no backend do copiloto:', error);
      json(response, known ? error.status : 500, {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'O backend não concluiu a consulta.',
      });
    }
  });
}
