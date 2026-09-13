// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { SessionProvider } from './hooks/useSession';
import { DEMO_STORAGE_KEY, resetDemoData } from './services/api';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  window.sessionStorage.clear();
  await resetDemoData();
});

afterEach(() => cleanup());

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider>
        <AppRoutes />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function readDisplayedInteger(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (!digits) throw new Error(`Expected an integer, received: ${String(value)}`);
  return Number(digits);
}

async function openLawyerCase(user: User, plaintiff: string) {
  await user.click(screen.getByRole('button', { name: /Entrar como Advogado/ }));
  await user.click(
    await screen.findByRole('link', {
      name: new RegExp(
        `^(Analisar agora|Continuar análise|Pedir evidência|Ver decisão|Registrar proposta|Continuar negociação|Ver processo): processo de ${plaintiff}$`,
      ),
    }),
  );
  await screen.findByRole('heading', { name: plaintiff, level: 1 });
}

async function openAdminDecisions(user: User) {
  await user.click(screen.getByRole('button', { name: 'Sair da demonstração' }));
  await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));
  await user.click(await screen.findByRole('link', { name: 'Decisões' }));
  await screen.findByRole('heading', { name: 'Registro da operação' });
  await screen.findByRole('table');
}

async function followRecommendation(user: User, notes?: string) {
  await user.click(screen.getByRole('button', { name: 'Seguir recomendação' }));
  const dialog = screen.getByRole('dialog', { name: 'Confirmar decisão' });
  if (notes) await user.type(within(dialog).getByRole('textbox', { name: /Observação/ }), notes);
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar decisão' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await screen.findByText('Decisão registrada. Você seguiu a recomendação da política.');
}

describe('application business flows', () => {
  it('separates aggregate indicators from traceable demo records in administration', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));

    await screen.findByRole('heading', { name: 'Visão geral' });
    const dataScope = await screen.findByRole('note', { name: 'Escopo dos dados administrativos' });
    expect(dataScope).toHaveTextContent('60.000 decisões simuladas');
    expect(dataScope).toHaveTextContent('5 registros rastreáveis');
    expect(
      screen.getByText(/5 registros rastreáveis no recorte atual.*60\.000 decisões simuladas/),
    ).toBeInTheDocument();

    const aggregateMetric = screen.getByText('Decisões na base agregada').closest('article');
    expect(aggregateMetric).not.toBeNull();
    expect(within(aggregateMetric!).getByText('60.000')).toBeInTheDocument();
    expect(
      within(aggregateMetric!).getByText('5 registros rastreáveis disponíveis'),
    ).toBeInTheDocument();
  });

  it('uses every aggregate decision and shows the count of every historical justification', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));
    await user.click(await screen.findByRole('link', { name: 'Aderência' }));

    const adherenceMetric = (await screen.findByText('Aderência geral')).closest('article');
    const overrideMetric = screen.getByText('Divergências registradas').closest('article');
    const justificationMetric = screen.getByText('Justificativas classificadas').closest('article');
    const firmMetric = screen.getByText('Total de escritórios').closest('article');
    const lawyerMetric = screen.getByText('Total de advogados').closest('article');
    expect(adherenceMetric).not.toBeNull();
    expect(overrideMetric).not.toBeNull();
    expect(justificationMetric).not.toBeNull();
    expect(firmMetric).not.toBeNull();
    expect(lawyerMetric).not.toBeNull();
    expect(adherenceMetric).toHaveTextContent('60.000 decisões no recorte');
    expect(overrideMetric).toHaveTextContent('26.149');
    expect(justificationMetric).toHaveTextContent('26.149');
    expect(justificationMetric).toHaveTextContent('7 motivos históricos no recorte');
    expect(firmMetric).toHaveTextContent('6');
    expect(firmMetric).toHaveTextContent('Na base agregada');
    expect(lawyerMetric).toHaveTextContent('36');
    expect(lawyerMetric).toHaveTextContent('Na base agregada');

    const viewTabs = within(
      screen.getByRole('tablist', { name: 'Visualizações da aderência' }),
    ).getAllByRole('tab');
    expect(viewTabs.map((tab) => tab.textContent)).toEqual([
      'Justificativas',
      'Escritórios',
      'Advogados',
    ]);
    expect(viewTabs[0]).toHaveAttribute('aria-selected', 'true');
    const reasons = screen.getByRole('region', { name: 'Motivos que concentram os desvios' });
    expect(within(reasons).getByRole('note')).toHaveTextContent(
      '26.149 justificativas classificadas',
    );
    const expectedReasons = [
      ['Baixa confiança do modelo', '12.820'],
      ['Caso de alto valor exigiu avaliação própria', '5.192'],
      ['Avaliação jurídica individual', '3.631'],
      ['Perfil mais negociador do advogado', '2.185'],
      ['Estratégia do escritório', '1.003'],
      ['Informação nova na análise', '963'],
      ['Estratégia autônoma do advogado', '355'],
    ];
    for (const [label, value] of expectedReasons) {
      expect(within(reasons).getByText(label).closest('.admin-reason')).toHaveTextContent(value);
    }

    await user.click(screen.getByRole('tab', { name: 'Escritórios' }));
    const firms = await screen.findByRole('region', {
      name: 'Escritórios que mais aderiram',
    });
    const firmRows = within(firms).getAllByRole('article');
    expect(firmRows).toHaveLength(6);
    const firmDecisionCounts = firmRows.map((row) =>
      readDisplayedInteger(within(row).getByText(/^\d[\d.]* decisões na base$/).textContent),
    );
    expect(firmDecisionCounts.every((value) => value > 1)).toBe(true);
    expect(firmDecisionCounts.reduce((total, value) => total + value, 0)).toBe(60_000);

    await user.click(screen.getByRole('tab', { name: 'Advogados' }));
    const lawyers = await screen.findByRole('region', { name: 'Indicadores por advogado' });
    const lawyerRows = within(lawyers).getAllByRole('article');
    expect(lawyerRows).toHaveLength(36);
    const lawyerDecisionCounts = lawyerRows.map((row) => {
      const scopeLabel = within(row).getByText('decisões na base');
      return readDisplayedInteger(scopeLabel.parentElement?.querySelector('strong')?.textContent);
    });
    expect(lawyerDecisionCounts.every((value) => value > 1)).toBe(true);
    expect(lawyerDecisionCounts.reduce((total, value) => total + value, 0)).toBe(60_000);

    await user.click(screen.getByRole('tab', { name: 'Justificativas' }));

    await user.selectOptions(screen.getByRole('combobox', { name: 'UF global' }), 'BA');
    expect(screen.getByText('Aderência geral').closest('article')).toHaveTextContent(
      '1 decisão no recorte',
    );
    expect(screen.getByText('Divergências registradas').closest('article')).toHaveTextContent('1');
    expect(screen.getByText('Justificativas informadas').closest('article')).toHaveTextContent('1');
    const filteredFirmMetric = screen.getByText('Total de escritórios').closest('article');
    const filteredLawyerMetric = screen.getByText('Total de advogados').closest('article');
    expect(within(filteredFirmMetric!).getByText('1')).toBeInTheDocument();
    expect(filteredFirmMetric).toHaveTextContent('No recorte rastreável');
    expect(within(filteredLawyerMetric!).getByText('1')).toBeInTheDocument();
    expect(filteredLawyerMetric).toHaveTextContent('No recorte rastreável');
    const filteredReasons = screen.getByRole('region', {
      name: 'Motivos que concentram os desvios',
    });
    expect(
      within(filteredReasons)
        .getByText('Fundamento jurídico ou estratégia processual')
        .closest('.admin-reason'),
    ).toHaveTextContent('(1)');
    expect(
      within(filteredReasons).queryByText('Baixa confiança do modelo'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Escritórios' }));
    const filteredFirms = await screen.findByRole('region', {
      name: 'Escritórios que mais aderiram',
    });
    const filteredFirmRows = within(filteredFirms).getAllByRole('article');
    expect(filteredFirmRows).toHaveLength(1);
    expect(filteredFirmRows[0]).toHaveTextContent('1 registro rastreável');

    await user.click(screen.getByRole('tab', { name: 'Advogados' }));
    const filteredLawyers = await screen.findByRole('region', {
      name: 'Indicadores por advogado',
    });
    const filteredLawyerRows = within(filteredLawyers).getAllByRole('article');
    expect(filteredLawyerRows).toHaveLength(1);
    const filteredScopeLabel = within(filteredLawyerRows[0]).getByText('registro rastreável');
    expect(filteredScopeLabel.parentElement).toHaveTextContent('1');
  });

  it('opens the referenced MOCK pages, confirms defense and shows the same decision to administration', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'Maria Aparecida Santos');
    await user.click(screen.getByRole('tab', { name: /^Evidências/ }));

    await user.click(
      screen.getByRole('button', {
        name: 'Ver evidência: Biometria e assinatura · MOCK, página 1',
      }),
    );
    let document = screen.getByRole('dialog', { name: 'Biometria e assinatura · MOCK' });
    expect(within(document).getByRole('combobox', { name: 'Página do documento' })).toHaveValue(
      '1',
    );
    expect(within(document).getByText('91%')).toBeInTheDocument();
    expect(within(document).getByText('97,3%')).toBeInTheDocument();
    await user.click(within(document).getByRole('button', { name: 'Voltar à análise' }));

    await user.click(
      screen.getByRole('button', { name: 'Ver evidência: Petição inicial · MOCK, página 2' }),
    );
    document = screen.getByRole('dialog', { name: 'Petição inicial · MOCK' });
    expect(within(document).getByRole('combobox', { name: 'Página do documento' })).toHaveValue(
      '2',
    );
    expect(
      within(document).getByText(/A autora afirma não reconhecer a contratação e contesta/),
    ).toBeInTheDocument();
    await user.click(within(document).getByRole('button', { name: 'Página anterior' }));
    expect(within(document).getByRole('combobox', { name: 'Página do documento' })).toHaveValue(
      '1',
    );
    await user.click(within(document).getByRole('button', { name: 'Voltar à análise' }));
    await user.click(screen.getByRole('tab', { name: 'Resumo' }));

    await user.click(screen.getByRole('button', { name: 'Seguir recomendação' }));
    const defenseDialog = screen.getByRole('dialog', { name: 'Confirmar decisão' });
    const defensePrefill = within(defenseDialog).getByRole('region', {
      name: 'Fundamentos para a defesa',
    });
    expect(defensePrefill).toHaveTextContent(
      'Contrato e comprovante de crédito constam no conjunto documental demonstrativo.',
    );
    expect(defensePrefill).toHaveTextContent('Contrato · MOCK, página 1');
    expect(within(defenseDialog).getByRole('textbox', { name: /Observação/ })).toHaveValue('');
    await user.click(within(defenseDialog).getByRole('button', { name: 'Confirmar decisão' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Decisão registrada. Você seguiu a recomendação da política.');
    await screen.findByText('Sua decisão:');
    expect(screen.getByRole('heading', { name: 'DEFESA' })).toBeInTheDocument();
    await openAdminDecisions(user);
    const row = screen.getByRole('row', { name: /1004827-32\.2026\.8\.26\.0114/ });
    expect(within(row).getByText(/Maria Aparecida Santos/)).toBeInTheDocument();
    expect(within(row).getAllByText('Defesa')).toHaveLength(2);
    expect(within(row).getByText('Aderente')).toBeInTheDocument();
    expect(within(row).getByText('Nesta demo')).toBeInTheDocument();
    expect(within(row).getByText('Decisão registrada')).toBeInTheDocument();
  });

  it('requires a reason and justification for divergence and exposes its context through administrative filters', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'José Carlos Oliveira');
    await user.click(screen.getByRole('tab', { name: /^Evidências/ }));
    await user.click(screen.getByRole('button', { name: /^Contradições/ }));
    expect(screen.getByText('O autor afirma não possuir conta na Caixa.')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Ver evidência: Consulta BACEN · MOCK, página 1' }),
    );
    const document = screen.getByRole('dialog', { name: 'Consulta BACEN · MOCK' });
    expect(
      within(document).getByText(
        /Consulta BACEN MOCK atribui a conta da Caixa ao tomador José Carlos Oliveira/,
      ),
    ).toBeInTheDocument();
    await user.click(within(document).getByRole('button', { name: 'Voltar à análise' }));
    await user.click(screen.getByRole('tab', { name: 'Resumo' }));

    await user.click(screen.getByRole('button', { name: 'Divergir' }));
    const dialog = screen.getByRole('dialog', { name: 'Divergir da recomendação' });
    await user.click(within(dialog).getByRole('button', { name: 'Salvar minha decisão' }));
    expect(within(dialog).getByText('Escolha a decisão que deseja registrar.')).toBeInTheDocument();
    expect(within(dialog).getByText('Selecione o motivo da divergência.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('A justificativa é obrigatória para divergir.'),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();

    const justification = 'Documento independente apresentado para revisão pelo advogado.';
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Minha decisão/ }),
      'DEFESA',
    );
    const reasonSelect = within(dialog).getByRole('combobox', { name: /outra decisão/ });
    for (const label of [
      'Fato ou documento novo',
      'Fundamento jurídico ou estratégia processual',
      'Dado relevante não considerado',
      'Exceção à regra da política',
      'Outro motivo verificável',
    ]) {
      expect(within(reasonSelect).getByRole('option', { name: label })).toBeInTheDocument();
    }
    await user.selectOptions(reasonSelect, 'NOVA_EVIDENCIA');
    expect(
      within(dialog).getByText(
        'Informe o fato ou documento, a data, a página ou origem e como isso muda a decisão.',
      ),
    ).toBeInTheDocument();
    const justificationField = within(dialog).getByRole('textbox', {
      name: /Explique sua escolha/,
    });
    expect(justificationField).toHaveAttribute(
      'placeholder',
      'Ex.: novo extrato, página 3, confirma pagamento e altera o risco do caso.',
    );
    await user.type(justificationField, 'Documento novo.');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar minha decisão' }));
    expect(
      within(dialog).getByText(
        'Explique com pelo menos 20 caracteres e inclua um fato verificável.',
      ),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    await user.clear(justificationField);
    await user.type(justificationField, justification);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar minha decisão' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Divergência registrada com motivo e justificativa.');
    expect(screen.getByRole('heading', { name: 'ACORDO' })).toBeInTheDocument();

    await openAdminDecisions(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Aderência' }), 'override');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Recomendação' }), 'ACORDO');
    await user.type(
      screen.getByRole('searchbox', { name: 'Buscar processo ou pessoa' }),
      'Jose Carlos',
    );
    const row = screen.getByRole('row', { name: /0801634-18\.2026\.8\.19\.0001/ });
    expect(within(row).getByText('Divergência')).toBeInTheDocument();
    expect(within(row).getByText('Defesa')).toBeInTheDocument();
    expect(screen.getByRole('table').querySelectorAll('tbody > tr')).toHaveLength(1);
    await user.click(within(row).getByRole('button', { name: '0801634-18.2026.8.19.0001' }));
    expect(screen.getByText(justification)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'UF' }), 'SP');
    expect(screen.getByRole('heading', { name: 'Nenhum registro encontrado' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]);
    await user.clear(screen.getByRole('searchbox', { name: 'Buscar processo ou pessoa' }));
    expect(screen.getByRole('row', { name: /0801634-18\.2026\.8\.19\.0001/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar processo ou pessoa' })).toHaveValue('');
  }, 10_000);

  it('requires negotiation amounts, preserves a counteroffer and records the accepted value in administration', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'José Carlos Oliveira');
    await user.click(screen.getByRole('button', { name: 'Seguir recomendação' }));
    const agreementDialog = screen.getByRole('dialog', { name: 'Confirmar decisão' });
    const agreementPrefill = within(agreementDialog).getByRole('region', {
      name: 'Faixa sugerida para acordo',
    });
    expect(agreementPrefill).toHaveTextContent('R$ 4.500,00');
    expect(agreementPrefill).toHaveTextContent('R$ 5.200,00');
    expect(agreementPrefill).toHaveTextContent('R$ 6.500,00');
    const initialProposal = within(agreementDialog).getByRole('spinbutton', {
      name: /Valor da proposta/,
    });
    expect(initialProposal).toHaveValue(5200);
    await user.clear(initialProposal);
    await user.type(initialProposal, '7000');
    await user.click(
      within(agreementDialog).getByRole('button', { name: 'Confirmar acordo e proposta' }),
    );
    expect(
      within(agreementDialog).getByText('Escolha um valor entre R$ 4.500,00 e R$ 6.500,00.'),
    ).toBeInTheDocument();
    await user.clear(initialProposal);
    await user.type(initialProposal, '6000');
    await user.click(
      within(agreementDialog).getByRole('button', { name: 'Confirmar acordo e proposta' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Acordo e proposta registrados. Aguardando resposta da outra parte.');
    await user.click(await screen.findByRole('button', { name: 'Atualizar negociação' }));
    let dialog = screen.getByRole('dialog', { name: 'Atualizar negociação' });
    const proposal = within(dialog).getByRole('spinbutton', { name: /Valor da proposta/ });
    expect(proposal).toHaveValue(6000);
    await user.clear(proposal);
    await user.type(proposal, '4500');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Resultado da negociação' }),
      'CONTRAPROPOSTA',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Salvar negociação' }));
    expect(within(dialog).getByText('Informe o valor da contraproposta.')).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('spinbutton', { name: /Valor da contraproposta/ }),
      '5600',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Salvar negociação' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Contraproposta recebida');

    await user.click(screen.getByRole('button', { name: 'Atualizar negociação' }));
    dialog = screen.getByRole('dialog', { name: 'Atualizar negociação' });
    expect(within(dialog).getByRole('spinbutton', { name: /Valor da proposta/ })).toHaveValue(4500);
    expect(within(dialog).getByRole('spinbutton', { name: /Valor da contraproposta/ })).toHaveValue(
      5600,
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Resultado da negociação' }),
      'ACEITA',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Salvar negociação' }));
    expect(within(dialog).getByText('Informe o valor final do acordo.')).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('spinbutton', { name: /Valor final do acordo/ }),
      '5200',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Salvar negociação' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Concluído');
    expect(screen.getByRole('heading', { name: 'ACORDO' })).toBeInTheDocument();

    await user.click(screen.getByText('Para analisar', { selector: 'a.back-link' }));
    await screen.findByRole('heading', { name: 'Casos aguardando sua análise' });
    expect(screen.queryByRole('row', { name: /José Carlos Oliveira/ })).not.toBeInTheDocument();
    expect(screen.getByText('Concluídos hoje').parentElement).toHaveTextContent('1');
    const lawyerNavigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    await user.click(within(lawyerNavigation).getByRole('link', { name: 'Finalizados' }));
    const completedAgreement = await screen.findByRole('row', { name: /José Carlos Oliveira/ });
    expect(within(completedAgreement).getByText('Concluído')).toBeInTheDocument();
    expect(
      within(completedAgreement).getByRole('link', {
        name: 'Ver processo: processo de José Carlos Oliveira',
      }),
    ).toBeInTheDocument();

    await openAdminDecisions(user);
    const row = screen.getByRole('row', { name: /0801634-18\.2026\.8\.19\.0001/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells[6]).toHaveTextContent('R$ 5.200,00');
    expect(within(row).getByText('Aceita')).toBeInTheDocument();
    expect(within(row).getByText('Aderente')).toBeInTheDocument();
    expect(within(row).getByText('Nesta demo')).toBeInTheDocument();
  });

  it('reopens a persisted review override and discards changes cancelled during editing', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'José Carlos Oliveira');
    await user.click(screen.getByRole('button', { name: 'Divergir' }));
    let dialog = screen.getByRole('dialog', { name: 'Divergir da recomendação' });
    const justification = 'Revisar o extrato independente antes de definir a estratégia.';
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Minha decisão/ }),
      'REVISAR',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /outra decisão/ }),
      'INFORMACAO_NAO_CONSIDERADA',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: /Explique sua escolha/ }),
      justification,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Salvar minha decisão' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText(justification);

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    await user.click(within(navigation).getByRole('link', { name: 'Finalizados' }));
    await user.click(
      await screen.findByRole('link', {
        name: /^(Analisar agora|Continuar análise|Ver decisão): processo de José Carlos Oliveira$/,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Divergir da recomendação' }));
    dialog = screen.getByRole('dialog', { name: 'Divergir da recomendação' });
    expect(within(dialog).getByRole('combobox', { name: /Minha decisão/ })).toHaveValue('REVISAR');
    expect(within(dialog).getByRole('combobox', { name: /outra decisão/ })).toHaveValue(
      'INFORMACAO_NAO_CONSIDERADA',
    );
    expect(within(dialog).getByRole('textbox', { name: /Explique sua escolha/ })).toHaveValue(
      justification,
    );

    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Minha decisão/ }),
      'DEFESA',
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /outra decisão/ }),
      'OUTRO',
    );
    await user.clear(within(dialog).getByRole('textbox', { name: /Explique sua escolha/ }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /Explique sua escolha/ }),
      'Rascunho que será cancelado.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Divergir da recomendação' }));
    dialog = screen.getByRole('dialog', { name: 'Divergir da recomendação' });
    expect(within(dialog).getByRole('combobox', { name: /Minha decisão/ })).toHaveValue('REVISAR');
    expect(within(dialog).getByRole('combobox', { name: /outra decisão/ })).toHaveValue(
      'INFORMACAO_NAO_CONSIDERADA',
    );
    expect(within(dialog).getByRole('textbox', { name: /Explique sua escolha/ })).toHaveValue(
      justification,
    );
  });

  it('keeps a cancelled restoration and clears the old success banner and decision draft after confirmed restoration', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'Maria Aparecida Santos');
    await followRecommendation(user, 'Contexto registrado antes da restauração.');
    await screen.findByText('Sua decisão:');

    await user.click(screen.getByRole('button', { name: 'Guia da experiência' }));
    let dialog = screen.getByRole('dialog', { name: 'Uma decisão bem fundamentada' });
    await user.click(within(dialog).getByRole('button', { name: 'Restaurar demonstração' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.click(within(dialog).getByRole('button', { name: 'Fechar janela' }));
    expect(screen.getByText('Sua decisão:')).toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Guia da experiência' }));
    dialog = screen.getByRole('dialog', { name: 'Uma decisão bem fundamentada' });
    await user.click(within(dialog).getByRole('button', { name: 'Restaurar demonstração' }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar restauração' }));
    await within(dialog).findByText(
      'Demonstração restaurada. Os processos voltaram ao cenário inicial.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Fechar janela' }));
    await screen.findByRole('button', { name: 'Divergir' });
    expect(screen.queryByText('Sua decisão:')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Decisão registrada. Você seguiu a recomendação da política.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando decisão')).toBeInTheDocument();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Seguir recomendação' }));
    dialog = screen.getByRole('dialog', { name: 'Confirmar decisão' });
    expect(within(dialog).getByRole('textbox', { name: /Observação/ })).toHaveValue('');
  });

  it('shows whether each case was opened and uses the CTA that matches its current state', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Advogado/ }));

    let mariaRow = await screen.findByRole('row', { name: /Maria Aparecida Santos/ });
    expect(within(mariaRow).getByText('Novo')).toBeInTheDocument();
    await user.click(
      within(mariaRow).getByRole('link', {
        name: 'Analisar agora: processo de Maria Aparecida Santos',
      }),
    );
    await screen.findByRole('heading', { name: 'Maria Aparecida Santos', level: 1 });

    await user.click(screen.getByText('Para analisar', { selector: 'a.back-link' }));
    mariaRow = await screen.findByRole('row', { name: /Maria Aparecida Santos/ });
    expect(within(mariaRow).getByText('Visualizado')).toBeInTheDocument();
    await user.click(
      within(mariaRow).getByRole('link', {
        name: 'Continuar análise: processo de Maria Aparecida Santos',
      }),
    );
    await screen.findByRole('heading', { name: 'Maria Aparecida Santos', level: 1 });

    await followRecommendation(user);
    await user.click(screen.getByText('Para analisar', { selector: 'a.back-link' }));
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Maria Aparecida Santos/ })).not.toBeInTheDocument(),
    );

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    await user.click(within(navigation).getByRole('link', { name: 'Finalizados' }));
    mariaRow = await screen.findByRole('row', { name: /Maria Aparecida Santos/ });
    expect(within(mariaRow).getByText('Decisão registrada')).toBeInTheDocument();
    expect(
      within(mariaRow).getByRole('link', {
        name: 'Ver decisão: processo de Maria Aparecida Santos',
      }),
    ).toBeInTheDocument();
    await user.click(within(navigation).getByRole('link', { name: 'Em andamento' }));
    const negotiationRow = await screen.findByRole('row', { name: /Luciana Martins Ferreira/ });
    expect(within(negotiationRow).getByText('Em negociação')).toBeInTheDocument();
    expect(
      within(negotiationRow).getByRole('link', {
        name: 'Continuar negociação: processo de Luciana Martins Ferreira',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Roberto Alves Souza/ })).not.toBeInTheDocument();
  });

  it('shows both attached examples only under cases to analyze and opens their PDF sources', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Advogado/ }));

    expect(await screen.findByRole('heading', { name: 'Para analisar' })).toBeInTheDocument();
    const mariaAttachment = screen.getByRole('row', { name: /0801234-56\.2024\.8\.10\.0001/ });
    const joseAttachment = screen.getByRole('row', { name: /0654321-09\.2024\.8\.04\.0001/ });
    expect(within(mariaAttachment).getByText('Novo')).toBeInTheDocument();
    expect(within(joseAttachment).getByText('Novo')).toBeInTheDocument();

    await user.click(
      within(mariaAttachment).getByRole('link', {
        name: 'Analisar agora: processo de Maria das Graças Silva Pereira',
      }),
    );
    await screen.findByRole('heading', { name: 'Maria das Graças Silva Pereira', level: 1 });
    await user.click(screen.getByRole('tab', { name: /^Evidências/ }));
    await user.click(
      screen.getByRole('button', { name: 'Ver evidência: Extrato bancário, página 1' }),
    );
    const viewer = screen.getByRole('dialog', { name: 'Extrato bancário' });
    expect(within(viewer).getByTitle('Extrato bancário — página 1')).toHaveAttribute(
      'src',
      expect.stringContaining(
        '/demo-cases/Caso_01_0801234-56-2024-8-10-0001/03_Extrato_Bancario.pdf#page=1',
      ),
    );
    await user.click(within(viewer).getByRole('button', { name: 'Voltar à análise' }));
    await user.click(screen.getByText('Para analisar', { selector: 'a.back-link' }));

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    await user.click(within(navigation).getByRole('link', { name: 'Em andamento' }));
    expect(
      screen.queryByRole('row', { name: /0801234-56\.2024\.8\.10\.0001/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('row', { name: /0654321-09\.2024\.8\.04\.0001/ }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('row', { name: /Luciana Martins Ferreira/ }),
    ).toBeInTheDocument();
    await user.click(within(navigation).getByRole('link', { name: 'Finalizados' }));
    expect(
      screen.queryByRole('row', { name: /0801234-56\.2024\.8\.10\.0001/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('row', { name: /0654321-09\.2024\.8\.04\.0001/ }),
    ).not.toBeInTheDocument();
  });

  it('registers the chosen agreement value and moves the case to work in progress', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'José Carlos Oliveira');
    await user.click(screen.getByRole('button', { name: 'Seguir recomendação' }));
    const agreementDialog = screen.getByRole('dialog', { name: 'Confirmar decisão' });
    await user.click(
      within(agreementDialog).getByRole('button', {
        name: /Usar abertura: R\$\s*4\.500,00/,
      }),
    );
    expect(
      within(agreementDialog).getByRole('spinbutton', { name: /Valor da proposta/ }),
    ).toHaveValue(4500);
    await user.click(
      within(agreementDialog).getByRole('button', { name: 'Confirmar acordo e proposta' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Acordo e proposta registrados. Aguardando resposta da outra parte.');

    await user.click(screen.getByText('Para analisar', { selector: 'a.back-link' }));
    await screen.findByRole('heading', { name: 'Casos aguardando sua análise' });
    expect(screen.queryByRole('row', { name: /José Carlos Oliveira/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Minha produtividade' })).toHaveTextContent(
      'Pendentes',
    );

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    await user.click(within(navigation).getByRole('link', { name: 'Em andamento' }));
    const agreementRow = await screen.findByRole('row', { name: /José Carlos Oliveira/ });
    expect(
      within(agreementRow).getByRole('link', {
        name: 'Continuar negociação: processo de José Carlos Oliveira',
      }),
    ).toBeInTheDocument();
  });

  it('shows a prioritized queue, discreet productivity and sourced decision points', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Advogado/ }));

    const queueFocus = await screen.findByRole('region', {
      name: 'Comece por José Raimundo Oliveira Costa',
    });
    expect(within(queueFocus).getByText('Risco alto')).toBeInTheDocument();
    expect(within(queueFocus).getByText('3 pontos a confirmar')).toBeInTheDocument();
    expect(
      within(queueFocus).getByRole('link', {
        name: 'Próxima ação: Analisar agora no processo de José Raimundo Oliveira Costa',
      }),
    ).toBeInTheDocument();

    const productivity = screen.getByRole('region', { name: 'Minha produtividade' });
    expect(within(productivity).getByText('Pendentes').parentElement).toHaveTextContent('5');
    expect(within(productivity).getByText('Em negociação').parentElement).toHaveTextContent('1');
    expect(within(productivity).getByText('Concluídos hoje').parentElement).toHaveTextContent('0');
    expect(within(productivity).getByText('Aderência pessoal').parentElement).toHaveTextContent(
      '100%',
    );

    const firstDataRow = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(firstDataRow).toHaveTextContent('José Raimundo Oliveira Costa');
    expect(firstDataRow).toHaveTextContent('Prioridade alta');

    await user.click(
      screen.getByRole('link', {
        name: 'Analisar agora: processo de José Raimundo Oliveira Costa',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Ver análise completa' }));
    const points = await screen.findByRole('region', { name: '3 pontos antes de decidir' });
    expect(within(points).getByText('A favor de acordo')).toBeInTheDocument();
    expect(within(points).getByText('A favor de defesa')).toBeInTheDocument();
    expect(within(points).getByText('Pode mudar a decisão')).toBeInTheDocument();
    expect(within(points).getByText('Risco para a defesa')).toBeInTheDocument();
    await user.click(
      within(points).getByRole('button', {
        name: 'Abrir fonte de A favor de defesa: Comprovante de crédito BACEN, página 1',
      }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Comprovante de crédito BACEN' }),
    ).toBeInTheDocument();
  });

  it('keeps the summary compact and exposes supporting content from tabs at the top', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'Maria Aparecida Santos');

    const navigation = screen.getByRole('tablist', { name: 'Conteúdo do processo' });
    const summaryTab = within(navigation).getByRole('tab', { name: 'Resumo' });
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Ver análise completa' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(
      screen.queryByRole('region', { name: '3 pontos antes de decidir' }),
    ).not.toBeInTheDocument();

    await user.click(within(navigation).getByRole('tab', { name: /^Evidências/ }));
    expect(await screen.findByRole('button', { name: /^Pontos importantes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seguir recomendação' })).not.toBeInTheDocument();

    await user.click(within(navigation).getByRole('tab', { name: /^Documentos/ }));
    expect(
      screen.getByRole('complementary', { name: 'Documentos do processo' }),
    ).toBeInTheDocument();

    await user.click(within(navigation).getByRole('tab', { name: 'Detalhes' }));
    expect(screen.getByRole('heading', { name: 'Detalhes do processo' })).toBeInTheDocument();

    await user.click(summaryTab);
    expect(await screen.findByRole('button', { name: 'Seguir recomendação' })).toBeInTheDocument();
  });

  it('shows the defense score computed by the risk model from the case subsidies', async () => {
    const user = userEvent.setup();
    renderApp();
    await openLawyerCase(user, 'Maria Aparecida Santos');

    const meter = screen.getByRole('meter', { name: 'Score de defesa' });
    expect(meter).toHaveAttribute('aria-valuenow', '98');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('Risco estimado de perda 1,7%')).toBeInTheDocument();
    expect(screen.getByText('Calculado com 5 de 6 subsídios da planilha')).toBeInTheDocument();
  });

  it('shows lawyer behavior as measurable percentages in administration', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));
    await user.click(await screen.findByRole('link', { name: 'Aderência' }));

    expect(
      await screen.findByRole('heading', { name: 'Motivos que concentram os desvios' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Escritórios' }));
    expect(
      await screen.findByRole('heading', { name: 'Escritórios que mais aderiram' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Advogados' }));

    expect(screen.getByRole('heading', { name: 'Indicadores por advogado' })).toBeInTheDocument();
    expect(screen.getAllByText('Aderência observada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Propensão estimada').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'Perfis' })).not.toBeInTheDocument();
  });

  it('keeps policy definition and operational monitoring separate from the lawyer flow', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));
    await user.click(await screen.findByRole('link', { name: 'Efetividade' }));

    expect(
      await screen.findByRole('heading', { name: 'Da proposta à economia' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Taxa de aceitação')).toBeInTheDocument();
    expect(screen.getAllByText('Custo sem política').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custo com política').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('heading', { name: 'Do custo-base ao custo projetado' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Resultados' }));
    expect(
      screen.getByRole('heading', { name: 'Como as propostas terminaram' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Política de acordos' }));
    const policy = screen.getByRole('dialog', { name: 'Política de acordos vigente' });
    expect(within(policy).getByText('Buscar composição')).toBeInTheDocument();
    expect(within(policy).getByText('Prosseguir com a defesa')).toBeInTheDocument();
    expect(within(policy).getByText('Confirmar antes de decidir')).toBeInTheDocument();
  });
});
