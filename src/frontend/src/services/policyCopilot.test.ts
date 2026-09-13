// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { deterministicPolicyCopilot } from '../lib/policyCopilot';
import type { LawyerCopilotRequest, PolicyCopilotResponse } from '../lib/policyCopilot.types';
import { demoCases, demoRecommendations } from '../mocks/behavioralFixtures';
import {
  createPolicyCopilotProvider,
  HttpPolicyCopilotProvider,
  PolicyCopilotServiceError,
} from './policyCopilot';

function lawyerRequest(): LawyerCopilotRequest {
  const caseDetail = demoCases.find((item) => item.assigned_to_me)!;
  return {
    audience: 'LAWYER',
    question: '  Qual é a fonte desta evidência?  ',
    intent: 'EVIDENCE',
    context: {
      caseDetail,
      recommendation: demoRecommendations[caseDetail.case_id],
      decision: null,
      negotiation: null,
    },
  };
}

function remoteResponse(audience: 'LAWYER' | 'ADMIN', contextRef: string): PolicyCopilotResponse {
  return {
    audience,
    intent: audience === 'LAWYER' ? 'EVIDENCE' : 'OVERVIEW',
    mode: 'FACTUAL',
    status: 'ANSWERED',
    title: 'Resposta fundamentada',
    answer: 'Resposta do serviço remoto.',
    facts: [],
    basis: [
      {
        source: audience === 'LAWYER' ? 'CASE_DETAIL' : 'DASHBOARD_METRICS',
        description: audience === 'LAWYER' ? 'Processo autorizado.' : 'Operação autorizada.',
        recordCount: audience === 'LAWYER' ? 1 : 60_000,
      },
    ],
    citations: [],
    calculations: [],
    assumptions: [],
    limitations: [],
    provenance: {
      engine: 'remote-policy-copilot',
      version: '2026-09-12',
      dataMode: 'OPERATIONAL',
      contextRef,
      ...(audience === 'ADMIN' ? { period: 'Últimos 90 dias' } : {}),
      policyVersion: 'policy-v1',
      modelVersion: 'model-v1',
      dataUpdatedAt: '2026-09-12T12:00:00.000Z',
    },
  };
}

function remoteSimulationResponse(contextRef: string): PolicyCopilotResponse {
  return {
    ...remoteResponse('ADMIN', contextRef),
    intent: 'WHAT_IF',
    mode: 'SIMULATION',
    label: 'SIMULAÇÃO',
    calculations: [
      {
        key: 'accepted',
        label: 'Acordos aceitos projetados',
        formula: 'propostas × taxa simulada',
        inputs: [
          { label: 'Propostas', value: 100 },
          { label: 'Taxa simulada', value: 0.65 },
        ],
        result: 65,
        formattedResult: '65',
      },
    ],
    assumptions: ['O volume de propostas permanece constante.'],
  };
}

describe('policy copilot service boundary', () => {
  it('uses the deterministic provider only when no remote URL is configured', () => {
    expect(createPolicyCopilotProvider('')).toBe(deterministicPolicyCopilot);
    expect(createPolicyCopilotProvider('   ')).toBe(deterministicPolicyCopilot);
    expect(createPolicyCopilotProvider('/api/copilot')).toBeInstanceOf(HttpPolicyCopilotProvider);
  });

  it('sends only the permitted identifiers to the lawyer endpoint', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            remoteResponse('LAWYER', JSON.parse(String(init?.body)).context_ref as string),
          ),
          {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    const provider = new HttpPolicyCopilotProvider('/api/copilot/', { fetch });
    const request = lawyerRequest();

    await expect(provider.respond(request)).resolves.toMatchObject({ audience: 'LAWYER' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe('/api/copilot/lawyer');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(body).toEqual({
      question: 'Qual é a fonte desta evidência?',
      context_ref: `case:${request.context.caseDetail.case_id}`,
      intent: 'EVIDENCE',
      case_id: request.context.caseDetail.case_id,
    });
    expect(String(init?.body)).not.toContain(request.context.caseDetail.plaintiff);
    expect(body).not.toHaveProperty('context');
    expect(String(init?.body)).not.toContain('audience');
  });

  it('uses the admin endpoint and serializes a scenario without its local context', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            remoteSimulationResponse(JSON.parse(String(init?.body)).context_ref as string),
          ),
          { status: 200 },
        ),
      ),
    );
    const provider = new HttpPolicyCopilotProvider('/api/copilot', { fetch });

    await provider.respond({
      audience: 'ADMIN',
      question: 'Qual seria o impacto?',
      intent: 'WHAT_IF',
      context: {
        dashboard: {} as never,
        rows: [],
        rowScope: {
          description: 'Operação filtrada',
          filters: { period: '90', firm: 'Silva Moura', ignored: null },
        },
      },
      scenario: { type: 'ACCEPTANCE_RATE', acceptanceRate: 0.65 },
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/copilot/admin');
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'Qual seria o impacto?',
      context_ref: expect.stringMatching(/^scope:[0-9a-f]{8}$/),
      intent: 'WHAT_IF',
      scope: { filters: { period: '90', firm: 'Silva Moura' } },
      scenario: { type: 'ACCEPTANCE_RATE', acceptanceRate: 0.65 },
    });
  });

  it('rejects malformed or cross-profile responses without a local fallback', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            remoteResponse('ADMIN', JSON.parse(String(init?.body)).context_ref as string),
          ),
          { status: 200 },
        ),
      ),
    );
    const provider = new HttpPolicyCopilotProvider('/api/copilot', { fetch });

    await expect(provider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({ code: 'INVALID_RESPONSE' });
  });

  it('rejects sources from another profile and simulations without an explicit label', async () => {
    const wrongSourceBase = remoteResponse('LAWYER', 'placeholder');
    const wrongSource = {
      ...wrongSourceBase,
      facts: [
        {
          key: 'decisions',
          label: 'Decisões',
          value: 10,
          formattedValue: '10',
          source: 'DASHBOARD_METRICS',
        },
      ],
    };
    const fetchWrongSource = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...wrongSource,
            provenance: {
              ...wrongSource.provenance,
              contextRef: JSON.parse(String(init?.body)).context_ref as string,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const sourceProvider = new HttpPolicyCopilotProvider('/api/copilot', {
      fetch: fetchWrongSource,
    });
    await expect(sourceProvider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({ code: 'INVALID_RESPONSE' });

    const fetchWithoutBasis = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...remoteResponse(
              'LAWYER',
              JSON.parse(String(init?.body)).context_ref as string,
            ),
            basis: [],
          }),
          { status: 200 },
        ),
      ),
    );
    const ungroundedProvider = new HttpPolicyCopilotProvider('/api/copilot', {
      fetch: fetchWithoutBasis,
    });
    await expect(ungroundedProvider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({ code: 'INVALID_RESPONSE' });

    const unlabeledSimulation = {
      ...remoteResponse('ADMIN', 'placeholder'),
      intent: 'WHAT_IF',
      mode: 'SIMULATION',
    };
    const fetchSimulation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...unlabeledSimulation,
            provenance: {
              ...unlabeledSimulation.provenance,
              contextRef: JSON.parse(String(init?.body)).context_ref as string,
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const simulationProvider = new HttpPolicyCopilotProvider('/api/copilot', {
      fetch: fetchSimulation,
    });
    await expect(
      simulationProvider.respond({
        audience: 'ADMIN',
        question: 'Simule a taxa de aceite em 65%.',
        context: {
          dashboard: {} as never,
          rows: [],
          rowScope: { description: 'recorte', filters: {} },
        },
      }),
    ).rejects.toMatchObject<Partial<PolicyCopilotServiceError>>({ code: 'INVALID_RESPONSE' });
  });

  it('rejects a valid-looking response bound to another case', async () => {
    const fetch = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(remoteResponse('LAWYER', 'case:outro-processo')), {
          status: 200,
        }),
      ),
    );
    const provider = new HttpPolicyCopilotProvider('/api/copilot', { fetch });

    await expect(provider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({
      code: 'INVALID_RESPONSE',
      message: 'O serviço do copiloto retornou uma resposta vinculada a outro contexto.',
    });
  });

  it('rejects a citation to a document outside the lawyer case', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const response = remoteResponse(
        'LAWYER',
        JSON.parse(String(init?.body)).context_ref as string,
      );
      response.citations = [
        {
          marker: '[1]',
          documentId: 'documento-de-outro-caso',
          documentName: 'Documento externo',
          page: 1,
          origin: 'Outro processo',
          claims: ['Alegação externa'],
        },
      ];
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    const provider = new HttpPolicyCopilotProvider('/api/copilot', { fetch });

    await expect(provider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({
      code: 'INVALID_RESPONSE',
      message:
        'O serviço do copiloto citou um documento fora do contexto permitido deste processo.',
    });
  });

  it('surfaces remote HTTP errors instead of consulting the deterministic provider', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Sessão sem autorização.' }), { status: 403 }),
      ),
    );
    const provider = new HttpPolicyCopilotProvider('/api/copilot', { fetch });

    await expect(provider.respond(lawyerRequest())).rejects.toMatchObject<
      Partial<PolicyCopilotServiceError>
    >({ code: 'HTTP_ERROR', status: 403, message: 'Sessão sem autorização.' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
