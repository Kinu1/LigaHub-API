import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { Field } from './ui';

describe('Campos acessíveis', () => {
  it('associa rótulo, instrução e erro sem perder uma descrição existente', async () => {
    const { container, rerender } = render(
      <main>
        <p id="privacy">Seu endereço permanece privado.</p>
        <Field
          label="E-mail"
          hint="Enviaremos seu acesso."
          error="Informe um e-mail válido."
        >
          <input id="email" type="email" aria-describedby="privacy" />
        </Field>
      </main>,
    );
    const input = screen.getByRole('textbox', { name: 'E-mail' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const descriptions = input
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toEqual([
      'Seu endereço permanece privado.',
      'Enviaremos seu acesso.',
      'Informe um e-mail válido.',
    ]);
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
    rerender(
      <Field label="E-mail">
        <input id="email" type="email" />
      </Field>,
    );
    expect(
      screen
        .getByRole('textbox', { name: 'E-mail' })
        .hasAttribute('aria-describedby'),
    ).toBe(false);
    expect(
      screen
        .getByRole('textbox', { name: 'E-mail' })
        .hasAttribute('aria-invalid'),
    ).toBe(false);
  });

  it('mantém nomes independentes para perguntas repetidas e seletores', () => {
    render(
      <main>
        <Field label="Nome">
          <input />
        </Field>
        <Field label="Nome">
          <input />
        </Field>
        <Field label="Instituição">
          <select>
            <option>Universidade</option>
          </select>
        </Field>
      </main>,
    );
    const inputs = screen.getAllByRole('textbox', { name: 'Nome' });
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(screen.getByRole('combobox', { name: 'Instituição' })).toBeTruthy();
  });
});
