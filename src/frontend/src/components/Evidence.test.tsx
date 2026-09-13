// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentViewer } from './Evidence';
import { demoCases } from '../mocks/fixtures';

afterEach(() => cleanup());

it('identifies an unavailable source page and only displays a different page after explicit selection', async () => {
  const user = userEvent.setup();
  const document = demoCases.find((item) => item.case_id === 'caso-1')!.documents[0];
  render(<DocumentViewer document={document} initialPage={7} onClose={() => undefined} />);

  const dialog = screen.getByRole('dialog', { name: document.name });
  const selector = within(dialog).getByRole('combobox', { name: 'Página do documento' });
  expect(selector).toHaveValue('7');
  expect(
    within(dialog).getByText(
      'A fonte referencia a página 7, mas este documento possui 2 páginas. Selecione uma página disponível para consultar o documento.',
    ),
  ).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Página anterior' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  expect(within(dialog).queryByRole('article')).not.toBeInTheDocument();
  for (const page of document.demo_pages ?? []) {
    expect(within(dialog).queryByRole('heading', { name: page.title })).not.toBeInTheDocument();
  }

  await user.selectOptions(selector, '2');
  expect(selector).toHaveValue('2');
  expect(within(dialog).queryByText(/A fonte referencia a página 7/)).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole('heading', { name: 'Alegação da parte — MOCK' }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      'A autora afirma não reconhecer a contratação e contesta a autenticidade da assinatura apresentada.',
    ),
  ).toBeInTheDocument();
});
