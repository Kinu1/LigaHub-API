import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, ThemeToggle } from './theme';

let dark = false;
let change: ((event: MediaQueryListEvent) => void) | undefined;
beforeEach(() => {
  localStorage.clear();
  dark = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      change = fn;
    },
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

describe('Aparência', () => {
  it('detecta o tema do sistema automaticamente e preserva campos ao escolher um tema', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <label>
          Rascunho
          <input />
        </label>
      </ThemeProvider>,
    );
    await user.type(screen.getByLabelText('Rascunho'), 'Meu evento');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => {
      dark = true;
      change?.({ matches: dark } as MediaQueryListEvent);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Tema: Escuro' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Claro' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('ligahub:theme')).toBe('light');
    expect((screen.getByLabelText('Rascunho') as HTMLInputElement).value).toBe(
      'Meu evento',
    );
    act(() => {
      dark = true;
      change?.({ matches: dark } as MediaQueryListEvent);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
  it('funciona quando armazenamento está bloqueado e reage a outra aba', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Tema: Claro' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Escuro' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'ligahub:theme',
          newValue: 'light',
        }),
      ),
    );
    await waitFor(() =>
      expect(document.documentElement.classList.contains('dark')).toBe(false),
    );
  });
});
