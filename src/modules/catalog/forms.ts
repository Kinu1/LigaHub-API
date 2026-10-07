import { BadRequestException } from '@nestjs/common';

export type FormField = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
};

export function validateForm(value: unknown): FormField[] {
  if (!Array.isArray(value) || value.length > 25) {
    throw new BadRequestException(
      'O formulário deve conter no máximo 25 campos.',
    );
  }
  const identifiers = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException('O campo do formulário é inválido.');
    }
    const field = item as Record<string, unknown>;
    if (
      Object.keys(field).some(
        (key) => !['id', 'label', 'type', 'required', 'options'].includes(key),
      )
    ) {
      throw new BadRequestException(
        'O campo contém propriedades desconhecidas.',
      );
    }
    if (
      typeof field.id !== 'string' ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(field.id) ||
      identifiers.has(field.id)
    ) {
      throw new BadRequestException(
        'Os identificadores dos campos devem ser únicos e válidos.',
      );
    }
    identifiers.add(field.id);
    if (
      typeof field.label !== 'string' ||
      !field.label.trim() ||
      field.label.length > 150 ||
      typeof field.required !== 'boolean' ||
      !['text', 'number', 'select', 'checkbox'].includes(String(field.type))
    ) {
      throw new BadRequestException(
        'O rótulo, tipo ou obrigatoriedade do campo é inválido.',
      );
    }
    if (field.type === 'select') {
      if (
        !Array.isArray(field.options) ||
        field.options.length < 1 ||
        field.options.length > 50 ||
        field.options.some(
          (option: unknown) =>
            typeof option !== 'string' || !option.trim() || option.length > 150,
        ) ||
        new Set(field.options).size !== field.options.length
      ) {
        throw new BadRequestException(
          'O campo de seleção deve conter opções válidas e únicas.',
        );
      }
    } else if (field.options !== undefined) {
      throw new BadRequestException(
        'Somente campos de seleção podem conter opções.',
      );
    }
    return {
      id: field.id,
      label: field.label.trim(),
      type: field.type as FormField['type'],
      required: field.required,
      ...(field.options ? { options: field.options as string[] } : {}),
    };
  });
}

export function validateAnswers(
  form: unknown,
  value: unknown,
): Record<string, string | number | boolean> {
  const fields = validateForm(form);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('As respostas do formulário são inválidas.');
  }
  const answers = value as Record<string, unknown>;
  if (
    Object.keys(answers).some(
      (key) => !fields.some((field) => field.id === key),
    )
  ) {
    throw new BadRequestException(
      'Uma resposta não corresponde ao formulário do evento.',
    );
  }
  const result: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const answer = answers[field.id];
    const missing =
      answer === undefined ||
      answer === null ||
      (typeof answer === 'string' && !answer.trim());
    if (missing) {
      if (field.required)
        throw new BadRequestException(`O campo ${field.label} é obrigatório.`);
      continue;
    }
    const valid =
      field.type === 'text'
        ? typeof answer === 'string' && answer.length <= 2000
        : field.type === 'number'
          ? typeof answer === 'number' && Number.isFinite(answer)
          : field.type === 'checkbox'
            ? typeof answer === 'boolean' && (!field.required || answer)
            : typeof answer === 'string' && field.options?.includes(answer);
    if (!valid)
      throw new BadRequestException(
        `A resposta do campo ${field.label} é inválida.`,
      );
    result[field.id] = answer as string | number | boolean;
  }
  return result;
}
