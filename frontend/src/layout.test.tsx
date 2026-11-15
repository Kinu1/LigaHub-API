import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './layout';

const auth = vi.hoisted(() => ({
  user: { id: 'u', name: 'Ana', role: 'admin' },
  loading: false,
  logout: vi.fn(),
}));
vi.mock('./auth', () => ({ useAuth: () => auth }));
let mobile = false;
beforeEach(() => {
  localStorage.clear();
  mobile = false;
  auth.user.role = 'admin';
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width') && mobile,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());
function show() {
  render(
    <MemoryRouter initialEntries={['/painel']}>
      <Routes>
        <Route path="/painel" element={<Layout />}>
          <Route
            index
            element={
              <label>
                Rascunho
                <input defaultValue="Preservado" />
              </label>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
it('recolhe a sidebar mantendo nomes, permissões e conteúdo', async () => {
  const user = userEvent.setup();
  show();
  expect(screen.getByRole('link', { name: 'Usuários' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Recolher menu' }));
  expect(screen.getByRole('button', { name: 'Expandir menu' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Eventos' })).toBeTruthy();
  expect((screen.getByLabelText('Rascunho') as HTMLInputElement).value).toBe(
    'Preservado',
  );
});
it('oferece sheet no celular, fecha com Escape e devolve foco', async () => {
  mobile = true;
  auth.user.role = 'organizer';
  const user = userEvent.setup();
  show();
  const trigger = screen.getByRole('button', { name: 'Abrir menu' });
  await user.click(trigger);
  expect(
    await screen.findByRole('dialog', { name: 'Menu de gestão' }),
  ).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Usuários' })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Fechar menu' }),
  );
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
