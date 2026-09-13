import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import type { AnswerGenerator } from '../src/model.ts';

const generate: AnswerGenerator = async (input) => ({
  available: true,
  title: input.mode === 'SIMULATION' ? 'Simulação calculada' : 'Resposta fundamentada',
  answer: 'Resposta de teste baseada somente no contexto recebido.',
  limitations: [],
  citationIndexes: input.audience === 'LAWYER' ? [1] : [],
});

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createApp({
    generate, model: 'modelo-de-teste', configured: true,
    allowedOrigins: new Set(['http://localhost:5173']),
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address();
  assert(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { app.close(); await once(app, 'close'); }
}

test('expõe health check sem revelar a chave', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok', service: 'enter-policy-copilot', openaiConfigured: true, model: 'modelo-de-teste',
    });
  });
});

test('responde ao advogado com contrato remoto e fonte válida', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/copilot/lawyer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Quais evidências sustentam a recomendação?',
        context_ref: 'case:caso-1', case_id: 'caso-1',
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.audience, 'LAWYER');
    assert.equal(body.intent, 'EVIDENCE');
    assert.equal(body.provenance.engine, 'remote-policy-copilot');
    assert.equal(body.provenance.contextRef, 'case:caso-1');
    assert.equal(body.citations.length, 1);
  });
});

test('calcula simulação administrativa sem delegar a conta ao modelo', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/copilot/admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'SIMULAÇÃO: e se a taxa de aceite fosse 65%?',
        context_ref: 'scope:1234abcd',
        scenario: { type: 'ACCEPTANCE_RATE', acceptanceRate: 0.65 },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.intent, 'WHAT_IF');
    assert.equal(body.mode, 'SIMULATION');
    assert.equal(body.label, 'SIMULAÇÃO');
    assert.equal(body.calculations[0].result, 20605);
    assert(body.assumptions.length > 0);
  });
});

test('rejeita contexto de outro processo', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/copilot/lawyer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Resuma.', context_ref: 'case:caso-2', case_id: 'caso-1' }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, 'CONTEXT_MISMATCH');
  });
});
