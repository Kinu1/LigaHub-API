import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth';
import { api, send } from './api';
const account = {
  id: 'u',
  name: 'Ana Organizadora',
  role: 'organizer',
  email: 'ana@example.com',
};
vi.mock('./api', () => ({ api: vi.fn(), send: vi.fn() }));
beforeEach(() => {
  history.replaceState(null, '', '/painel');
  vi.mocked(api).mockResolvedValue(account);
  vi.mocked(send).mockResolvedValue({ user: account });
});
afterEach(() => {
  history.replaceState(null, '', '/');
  vi.resetAllMocks();
});
function Draft() {
  const { user } = useAuth();
  return (
    <main id="conteudo" tabIndex={-1}>
      <p>{user?.name}</p>
      <label>
        Rascunho
        <input defaultValue="Encontro" />
      </label>
    </main>
  );
}
it('preserva preenchimento e restaura foco após renovar sessão na mesma conta', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Draft />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(account.name);
  const user = userEvent.setup();
  const input = screen.getByLabelText('Rascunho');
  await user.type(input, ' de emergência');
  await act(async () => window.dispatchEvent(new Event('session-expired')));
  await screen.findByRole('dialog', { name: 'Sessão expirada' });
  await user.type(await screen.findByLabelText('E-mail'), account.email);
  await user.type(screen.getByLabelText('Senha'), 'senha-segura');
  await user.click(screen.getByRole('button', { name: /Entrar no painel/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect((input as HTMLInputElement).value).toBe('Encontro de emergência');
  expect(send).toHaveBeenCalledWith('/auth/login', {
    email: account.email,
    password: 'senha-segura',
  });
});
