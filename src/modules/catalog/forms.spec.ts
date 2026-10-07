import { describe, expect, it } from 'vitest';
import { validateAnswers, validateForm, type FormField } from './forms.js';

describe('Formulários dos eventos', () => {
  const form: FormField[] = [
    { id: 'instituicao', label: 'Instituição', type: 'text', required: true },
    { id: 'semestre', label: 'Semestre', type: 'number', required: false },
    {
      id: 'curso',
      label: 'Curso',
      type: 'select',
      required: true,
      options: ['Medicina', 'Enfermagem'],
    },
    {
      id: 'termos',
      label: 'Aceite dos termos',
      type: 'checkbox',
      required: true,
    },
  ];
  it('deve aceitar respostas válidas e omitir campos opcionais ausentes', () => {
    expect(
      validateAnswers(form, {
        instituicao: 'Universidade',
        curso: 'Medicina',
        termos: true,
      }),
    ).toEqual({ instituicao: 'Universidade', curso: 'Medicina', termos: true });
  });
  it('deve rejeitar identificadores duplicados', () => {
    expect(() => validateForm([form[0], form[0]])).toThrow(
      'Os identificadores',
    );
  });
  it('deve rejeitar mais de 25 campos', () => {
    expect(() =>
      validateForm(
        Array.from({ length: 26 }, (_, index) => ({
          ...form[0],
          id: `campo${index}`,
        })),
      ),
    ).toThrow('no máximo 25');
  });
  it('deve rejeitar opções repetidas de seleção', () => {
    expect(() =>
      validateForm([{ ...form[2], options: ['Medicina', 'Medicina'] }]),
    ).toThrow('opções válidas e únicas');
  });
  it.each([
    { instituicao: '', curso: 'Medicina', termos: true },
    { instituicao: 'Universidade', curso: 'Direito', termos: true },
    { instituicao: 'Universidade', curso: 'Medicina', termos: false },
    {
      instituicao: 'Universidade',
      curso: 'Medicina',
      termos: true,
      semestre: Infinity,
    },
    {
      instituicao: 'Universidade',
      curso: 'Medicina',
      termos: true,
      desconhecido: 'resposta',
    },
    { instituicao: 'a'.repeat(2001), curso: 'Medicina', termos: true },
  ])('deve rejeitar respostas inválidas: %j', (answers) => {
    expect(() => validateAnswers(form, answers)).toThrow();
  });
  it('deve aceitar checkbox opcional marcado como falso', () => {
    expect(
      validateAnswers(
        [
          {
            id: 'newsletter',
            label: 'Newsletter',
            type: 'checkbox',
            required: false,
          },
        ],
        { newsletter: false },
      ),
    ).toEqual({ newsletter: false });
  });
});
