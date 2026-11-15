import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { Confirm } from './ui';

describe('Confirmação', () => {
  it('mantém erro no diálogo, devolve foco e confirma sem duplicar a ação', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('Tente novamente.'))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <Confirm
        title="Encerrar evento?"
        description="O evento será encerrado."
        onConfirm={action}
      >
        Encerrar
      </Confirm>,
    );
    const trigger = screen.getByRole('button', { name: 'Encerrar' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Encerrar evento?' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Voltar' }),
    );
    expect(
      (
        await axe.run(dialog, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(action).toHaveBeenCalledTimes(2);
  });
  it('bloqueia Escape e confirmação repetida enquanto aguarda a API', async () => {
    let resolve!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const user = userEvent.setup();
    render(
      <Confirm
        title="Suspender?"
        description="Inscrições serão interrompidas."
        onConfirm={action}
      >
        Suspender
      </Confirm>,
    );
    await user.click(screen.getByRole('button', { name: 'Suspender' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Aguarde…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(action).toHaveBeenCalledTimes(1);
  });
});
