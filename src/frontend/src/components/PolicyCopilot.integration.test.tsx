// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { SessionProvider } from '../hooks/useSession';
import { DEMO_STORAGE_KEY, resetDemoData } from '../services/api';

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

describe('Policy Copilot in each profile', () => {
  it('grounds the lawyer answer in the assigned case and opens the cited document', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Entrar como Advogado/ }));
    await user.click(
      await screen.findByRole('link', {
        name: /^(Analisar agora|Continuar análise): processo de José Carlos Oliveira$/,
      }),
    );
    await screen.findByRole('heading', { name: 'José Carlos Oliveira', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Copiloto da Política' }));
    const dialog = screen.getByRole('dialog', { name: 'Copiloto deste caso' });
    expect(
      within(dialog).getByText(/0801634-18\.2026\.8\.19\.0001/, {
        selector: '.copilot-header p',
      }),
    ).toBeInTheDocument();
    const caseSelector = within(dialog).getByRole('combobox', {
      name: 'Caso analisado pelo copiloto',
    });
    expect(within(caseSelector).getAllByRole('option').length).toBeGreaterThan(1);
    expect(
      within(dialog).queryByRole('button', { name: 'Qual escritório mais diverge?' }),
    ).not.toBeInTheDocument();

    await user.selectOptions(caseSelector, 'caso-anexo-01');
    expect(caseSelector).toHaveValue('caso-anexo-01');
    expect(
      within(dialog).getByText(/0801234-56\.2024\.8\.10\.0001 · Maria das Graças Silva Pereira/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Por que esta recomendação foi indicada?' }),
    );
    expect(await within(dialog).findByText('Leitura da recomendação')).toBeInTheDocument();
    expect(within(dialog).getByText(/A política recomenda DEFESA/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Risco estimado de perda:/)).toBeInTheDocument();
    expect(within(dialog).getByText('politica-demo-v1.0')).toBeInTheDocument();
    expect(within(dialog).getByText('modelo-simulado-v1.0')).toBeInTheDocument();

    const source = within(dialog).getAllByRole('button', { name: /^Abrir fonte:/ })[0];
    expect(source).toBeDefined();
    await user.click(source!);

    const viewer = await screen.findByRole('dialog', {
      name: /Autos|Contrato|Extrato|Comprovante|Dossiê|Demonstrativo|Laudo/i,
    });
    expect(within(viewer).getByRole('combobox', { name: 'Página do documento' })).toBeVisible();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    expect(
      screen.queryByText('Decisão registrada. Você seguiu a recomendação da política.'),
    ).not.toBeInTheDocument();
  });

  it('uses the current admin slice, labels simulations and refuses an unsupported limit scenario', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /Entrar como Administrativo/ }));
    await screen.findByRole('heading', { name: 'Visão geral' });
    await user.click(await screen.findByRole('button', { name: 'Refinar análise' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'UF global' }), 'SP');
    await screen.findByText(/1 registro rastreável no\s*recorte atual/);

    await user.click(screen.getByRole('button', { name: 'Copiloto da Política' }));
    const dialog = screen.getByRole('dialog', { name: 'Copiloto da política' });
    expect(within(dialog).getByText(/1 decisão no recorte detalhado/)).toBeInTheDocument();
    const dashboardSelector = within(dialog).getByRole('combobox', {
      name: 'Dashboard ou aba analisada',
    });
    await user.selectOptions(dashboardSelector, 'adherence');
    expect(dashboardSelector).toHaveValue('adherence');
    expect(within(dialog).getByText(/Aderência à política · 1 decisão/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Por que foi recomendado/ }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Qual escritório mais diverge?' }));
    expect(await within(dialog).findByText('Divergência por escritório')).toBeInTheDocument();
    expect(within(dialog).getByText(/N=1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/uf=SP/)).toBeInTheDocument();
    expect(within(dialog).getByText('politica-demo-v1.0')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Base sintetica de 60.000 decisoes simuladas'),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', {
        name: 'SIMULAÇÃO: e se a taxa de aceite fosse 65%?',
      }),
    );
    expect(await within(dialog).findByText('SIMULAÇÃO administrativa')).toBeInTheDocument();
    expect(within(dialog).getByText('Taxa de aceitação simulada:')).toBeInTheDocument();
    expect(within(dialog).getAllByText('SIMULAÇÃO').length).toBeGreaterThan(0);

    const composer = within(dialog).getByRole('textbox', {
      name: 'Pergunte ao Copiloto da Política',
    });
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(
      composer,
      'O que aconteceria se aumentássemos o limite de acordo de 30% para 35%?',
    );
    expect(composer).toHaveValue(
      'O que aconteceria se aumentássemos o limite de acordo de 30% para 35%?',
    );
    const send = within(dialog).getByRole('button', { name: 'Enviar pergunta' });
    expect(send).toBeEnabled();
    await user.click(send);
    await within(dialog).findByText(
      'O que aconteceria se aumentássemos o limite de acordo de 30% para 35%?',
    );
    await waitFor(() =>
      expect(within(dialog).getByText('Informação indisponível')).toBeInTheDocument(),
    );
    expect(
      within(dialog).getByText(/limites e demais variações numéricas não serão inferidos/i),
    ).toBeInTheDocument();
  });
});
