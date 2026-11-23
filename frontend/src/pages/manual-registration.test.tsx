import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { ApiError, send } from '../api';
import { ManualRegistration } from './manual-registration';
import type { Event } from '../types';

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  send: vi.fn(),
}));
const event = {
  id: 'event-id',
  startsAt: '2099-01-01T12:00:00Z',
  status: 'draft',
  registrationTypes: [
    { id: 'pago', name: 'Profissional', priceInCents: 5000, capacity: 5 },
  ],
  form: [
    { id: 'curso', label: 'Curso', type: 'text', required: true },
    { id: 'quantidade', label: 'Quantidade', type: 'number', required: true },
    {
      id: 'turno',
      label: 'Turno',
      type: 'select',
      required: true,
      options: ['Noite'],
    },
    {
      id: 'aceite',
      label: 'Aceita as regras',
      type: 'checkbox',
      required: true,
    },
  ],
} as Event;
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome completo'), 'Ana Participante');
  await user.type(screen.getByLabelText('E-mail'), 'ANA@example.com');
  await user.type(
    screen.getByLabelText('CPF do participante'),
    '529.982.247-25',
  );
  await user.type(screen.getByLabelText('Curso (obrigatório)'), 'Medicina');
  await user.type(screen.getByLabelText('Quantidade (obrigatório)'), '2');
  await user.selectOptions(
    screen.getByLabelText('Turno (obrigatório)'),
    'Noite',
  );
  await user.click(screen.getByLabelText('Aceita as regras (obrigatório)'));
}
describe('Inclusão manual', () => {
  it('valida CPF, envia categoria e respostas tipadas; mantém foco, acessibilidade e pendência', async () => {
    vi.mocked(send)
      .mockReset()
      .mockResolvedValue({ id: 'nova', emailDeliveryStatus: 'pending' });
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ManualRegistration
        event={event}
        onCreated={refresh}
        onDuplicate={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Adicionar participante',
    });
    await user.click(trigger);
    await fill(user);
    const dialog = screen.getByRole('dialog', {
      name: 'Adicionar participante',
    });
    expect(
      (
        await axe.run(dialog, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.clear(screen.getByLabelText('CPF do participante'));
    await user.type(
      screen.getByLabelText('CPF do participante'),
      '11111111111',
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cortesia' }),
    );
    expect(
      await screen.findByText('Informe um CPF válido para o participante.'),
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('CPF do participante'));
    await user.type(
      screen.getByLabelText('CPF do participante'),
      '52998224725',
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cortesia' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(send).toHaveBeenCalledExactlyOnceWith(
      '/events/event-id/registrations/manual',
      {
        name: 'Ana Participante',
        email: 'ana@example.com',
        cpf: '52998224725',
        registrationTypeId: 'pago',
        answers: {
          curso: 'Medicina',
          quantidade: 2,
          turno: 'Noite',
          aceite: true,
        },
      },
    );
    expect(screen.getByRole('status').textContent).toContain(
      'pendente na fila',
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });
  it('apresenta duplicata com busca explícita sem apagar os dados', async () => {
    vi.mocked(send)
      .mockReset()
      .mockRejectedValue(
        new ApiError(409, 'Inscrição existente.', undefined, 'existing-id'),
      );
    const user = userEvent.setup();
    const duplicate = vi.fn();
    render(
      <ManualRegistration
        event={event}
        onCreated={vi.fn()}
        onDuplicate={duplicate}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Adicionar participante' }),
    );
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cortesia' }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (screen.getByLabelText('Nome completo') as HTMLInputElement).value,
    ).toBe('Ana Participante');
    await user.click(
      screen.getByRole('button', { name: 'Localizar inscrição existente' }),
    );
    expect(duplicate).toHaveBeenCalledWith('ana@example.com', 'existing-id');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('impede reenvio e Escape enquanto salva; não repete cadastro se atualização da lista falhar', async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(send)
      .mockReset()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const user = userEvent.setup();
    render(
      <ManualRegistration
        event={event}
        onCreated={vi.fn().mockRejectedValue(new Error('falha da lista'))}
        onDuplicate={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Adicionar participante' }),
    );
    await fill(user);
    await user.click(
      screen.getByRole('button', { name: 'Confirmar cortesia' }),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Salvando…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    finish({});
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain(
      'Cortesia confirmada',
    );
  });
  it('explica indisponibilidade para evento encerrado ou sem data', () => {
    render(
      <ManualRegistration
        event={{ ...event, startsAt: null }}
        onCreated={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Adicionar participante',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/configure o início futuro/)).toBeTruthy();
  });
});
