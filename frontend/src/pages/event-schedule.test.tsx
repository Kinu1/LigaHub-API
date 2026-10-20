import { useState } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { ScheduleField, scheduleError } from './event-schedule';

function Schedule() {
  const [value, setValue] = useState('');
  return (
    <main>
      <h1>Datas do evento</h1>
      <ScheduleField
        title="Início do evento"
        value={value}
        onChange={setValue}
        error={scheduleError(value)}
      />
      <output aria-label="Valor salvo">{value}</output>
    </main>
  );
}

describe('Data e horário do evento', () => {
  it('separa data e hora, orienta preenchimento parcial e permite limpar', async () => {
    const user = userEvent.setup();
    const { container } = render(<Schedule />);
    const group = within(
      screen.getByRole('group', { name: 'Início do evento' }),
    );
    fireEvent.change(group.getByLabelText('Data'), {
      target: { value: '2026-10-25' },
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Informe o horário para esta data.',
    );
    fireEvent.change(group.getByLabelText('Horário'), {
      target: { value: '14:30' },
    });
    expect(screen.getByLabelText('Valor salvo').textContent).toBe(
      '2026-10-25T14:30',
    );
    expect(screen.queryByRole('alert')).toBe(null);
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: 'Limpar início do evento' }),
    );
    expect(screen.getByLabelText('Valor salvo').textContent).toBe('');
  });

  it('solicita a data se o horário for escolhido primeiro e aceita rascunho sem datas', () => {
    expect(scheduleError('T10:00')).toBe('Escolha a data para este horário.');
    expect(scheduleError('')).toBeUndefined();
    expect(scheduleError('2026-10-25T10:00')).toBeUndefined();
    expect(scheduleError('inválidoT10:00')).toBe(
      'Informe uma data e um horário válidos.',
    );
  });
});
