import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { EventQuestions, questionError } from './event-questions';
import type { Field } from '../types';

function Builder() {
  const [fields, setFields] = useState<Field[]>([]);
  return (
    <main>
      <h1>Criar evento</h1>
      <form>
        <EventQuestions fields={fields} onChange={setFields} showErrors />
      </form>
    </main>
  );
}

describe('Perguntas da inscrição', () => {
  it('permite montar opções, experimentar a prévia e preservar opções ao trocar o tipo', async () => {
    const user = userEvent.setup();
    render(<Builder />);
    expect(screen.getByText('Só nome e e-mail? Tudo pronto.')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Adicionar pergunta' }),
    );
    const title = screen.getByLabelText('O que você quer perguntar?');
    expect(document.activeElement).toBe(title);
    await user.type(title, 'Qual é o seu curso?');
    const kind = screen.getByLabelText('Como o participante vai responder?');
    await user.selectOptions(kind, 'select');
    await user.type(screen.getByLabelText('Opção 1'), 'Medicina');
    await user.type(screen.getByLabelText('Opção 2'), 'Enfermagem');
    const preview = within(screen.getByRole('complementary'));
    const answer = preview.getByRole('combobox', {
      name: 'Qual é o seu curso? (opcional)',
    });
    await user.selectOptions(answer, 'Medicina');
    expect((answer as HTMLSelectElement).value).toBe('Medicina');
    expect((answer as HTMLSelectElement).form).toBe(null);
    await user.selectOptions(kind, 'text');
    await user.selectOptions(kind, 'select');
    expect((screen.getByLabelText('Opção 1') as HTMLInputElement).value).toBe(
      'Medicina',
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Tornar a resposta obrigatória' }),
    );
    expect(
      preview.getByRole('combobox', {
        name: 'Qual é o seu curso? (obrigatória)',
      }),
    ).toBeTruthy();
  });

  it('reordena e remove perguntas mantendo seus textos', async () => {
    const user = userEvent.setup();
    render(<Builder />);
    await user.click(
      screen.getByRole('button', { name: 'Adicionar pergunta' }),
    );
    await user.type(
      screen.getByLabelText('O que você quer perguntar?'),
      'Instituição',
    );
    await user.click(
      screen.getByRole('button', { name: 'Adicionar pergunta' }),
    );
    await user.type(
      screen.getAllByLabelText('O que você quer perguntar?')[1],
      'Período',
    );
    await user.click(
      screen.getByRole('button', { name: 'Mover pergunta 2 para cima' }),
    );
    expect(
      (
        screen.getAllByLabelText(
          'O que você quer perguntar?',
        )[0] as HTMLInputElement
      ).value,
    ).toBe('Período');
    await user.click(
      screen.getByRole('button', { name: 'Remover pergunta 1' }),
    );
    expect(
      (screen.getByLabelText('O que você quer perguntar?') as HTMLInputElement)
        .value,
    ).toBe('Instituição');
  });

  it('explica a confirmação obrigatória e mantém rótulos acessíveis', async () => {
    const user = userEvent.setup();
    const { container } = render(<Builder />);
    await user.click(
      screen.getByRole('button', { name: 'Adicionar pergunta' }),
    );
    await user.type(
      screen.getByLabelText('O que você quer perguntar?'),
      'Li as orientações',
    );
    await user.selectOptions(
      screen.getByLabelText('Como o participante vai responder?'),
      'checkbox',
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Exigir que esta caixa seja marcada',
      }),
    );
    expect(
      within(screen.getByRole('complementary')).getByRole('checkbox', {
        name: 'Li as orientações (obrigatória)',
      }),
    ).toBeTruthy();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });

  it('impede perguntas vazias e opções vazias ou repetidas', () => {
    const field: Field = {
      id: 'curso',
      label: 'Curso',
      type: 'select',
      required: false,
      options: ['Medicina', ' Medicina '],
    };
    expect(questionError(field)).toContain('diferentes');
    expect(questionError({ ...field, options: [''] })).toContain('vazias');
    expect(questionError({ ...field, label: '' })).toContain('perguntar');
    expect(
      questionError({ ...field, options: ['Medicina', 'Enfermagem'] }),
    ).toBeUndefined();
  });
});
