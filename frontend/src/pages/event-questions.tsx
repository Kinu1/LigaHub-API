import { useRef } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Field } from '../ui';
import type { Field as Question } from '../types';

const kinds: Record<Question['type'], { title: string; hint: string }> = {
  text: {
    title: 'Resposta escrita',
    hint: 'O participante escreve livremente. Ex.: Qual é a sua instituição?',
  },
  number: {
    title: 'Número',
    hint: 'O participante informa um número. Ex.: Em qual período você está?',
  },
  select: {
    title: 'Escolher uma opção',
    hint: 'Você define as opções e o participante escolhe apenas uma.',
  },
  checkbox: {
    title: 'Caixa de confirmação',
    hint: 'O participante marca ou deixa desmarcado. Se obrigatória, precisa ser marcada para continuar.',
  },
};

export function questionError(question: Question): string | undefined {
  if (!question.label.trim()) return 'Escreva o que você quer perguntar.';
  if (question.type === 'select') {
    const options = question.options ?? [];
    if (!options.length || options.some((option) => !option.trim()))
      return 'Preencha todas as opções ou remova as que estiverem vazias.';
    if (new Set(options.map((option) => option.trim())).size !== options.length)
      return 'Use opções diferentes para esta pergunta.';
  }
}

export function QuestionsPreview({ fields }: { fields: Question[] }) {
  return (
    <div className="space-y-5">
      <Field label="Nome completo">
        <input
          form="event-preview"
          placeholder="Nome do participante"
          autoComplete="off"
        />
      </Field>
      <Field label="E-mail">
        <input
          form="event-preview"
          type="email"
          placeholder="participante@exemplo.com"
          autoComplete="off"
        />
      </Field>
      {fields.map((question, index) => (
        <Field
          key={`${question.id}-${question.type}`}
          label={`${question.label.trim() || `Pergunta ${index + 1}`}${question.required ? ' (obrigatória)' : ' (opcional)'}`}
        >
          {question.type === 'select' ? (
            <select form="event-preview" defaultValue="">
              <option value="">Selecione uma opção</option>
              {question.options?.map((option, i) => (
                <option key={i} value={option || `empty-${i}`}>
                  {option || `Opção ${i + 1}`}
                </option>
              ))}
            </select>
          ) : question.type === 'checkbox' ? (
            <input form="event-preview" type="checkbox" />
          ) : (
            <input
              form="event-preview"
              type={question.type === 'number' ? 'number' : 'text'}
              placeholder={
                question.type === 'number'
                  ? 'Digite um número'
                  : 'Escreva sua resposta'
              }
            />
          )}
        </Field>
      ))}
    </div>
  );
}

export function EventQuestions({
  fields,
  onChange,
  showErrors,
}: {
  fields: Question[];
  onChange: (fields: Question[]) => void;
  showErrors: boolean;
}) {
  const pendingFocus = useRef<string | null>(null);
  const update = (index: number, patch: Partial<Question>) =>
    onChange(
      fields.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const add = () => {
    const id = `campo_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    pendingFocus.current = id;
    onChange([...fields, { id, label: '', type: 'text', required: false }]);
  };
  const move = (index: number, direction: number) => {
    const next = [...fields];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  };
  return (
    <div>
      <h2>Perguntas da inscrição</h2>
      <p className="muted mt-2 text-sm">
        O que você precisa saber sobre os participantes? Nome e e-mail já são
        pedidos automaticamente.
      </p>
      <div className="mt-6 grid items-start gap-8 xl:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-4 text-sm font-semibold" aria-live="polite">
            {fields.length} de 25 perguntas extras
          </p>
          {!fields.length && (
            <div className="mb-5 border-l-4 border-red-200 bg-red-50 p-5">
              <h3 className="font-semibold">Só nome e e-mail? Tudo pronto.</h3>
              <p className="muted mt-2 text-sm">
                Se precisar de mais informações, adicione uma pergunta. Por
                exemplo: “Qual é a sua instituição?” ou “Em qual período você
                está?”.
              </p>
            </div>
          )}
          <div className="divide-y divide-zinc-200">
            {fields.map((question, index) => (
              <fieldset
                key={question.id}
                className="min-w-0 space-y-4 pb-6 pt-4"
              >
                <legend className="font-semibold">Pergunta {index + 1}</legend>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === 0}
                    aria-label={`Mover pergunta ${index + 1} para cima`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={index === fields.length - 1}
                    aria-label={`Mover pergunta ${index + 1} para baixo`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    type="button"
                    className="btn secondary ml-auto"
                    onClick={() =>
                      onChange(fields.filter((_, i) => i !== index))
                    }
                    aria-label={`Remover pergunta ${index + 1}`}
                  >
                    <Trash2 size={16} />
                    Remover
                  </button>
                </div>
                <Field
                  label="O que você quer perguntar?"
                  error={
                    showErrors && !question.label.trim()
                      ? questionError(question)
                      : undefined
                  }
                >
                  <input
                    ref={(element) => {
                      if (element && pendingFocus.current === question.id) {
                        element.focus();
                        pendingFocus.current = null;
                      }
                    }}
                    value={question.label}
                    maxLength={150}
                    placeholder="Ex.: Qual é a sua instituição?"
                    onChange={(event) =>
                      update(index, { label: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Como o participante vai responder?"
                  hint={kinds[question.type].hint}
                >
                  <select
                    value={question.type}
                    onChange={(event) => {
                      const type = event.target.value as Question['type'];
                      update(index, {
                        type,
                        options:
                          type === 'select'
                            ? (question.options ?? ['', ''])
                            : question.options,
                      });
                    }}
                  >
                    {Object.entries(kinds).map(([value, kind]) => (
                      <option key={value} value={value}>
                        {kind.title}
                      </option>
                    ))}
                  </select>
                </Field>
                {question.type === 'select' && (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold">
                      Opções que o participante poderá escolher
                    </p>
                    {(question.options ?? []).map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Field
                            label={`Opção ${optionIndex + 1}`}
                            error={
                              showErrors &&
                              (!option.trim() ||
                                question.options?.some(
                                  (other, i) =>
                                    i !== optionIndex &&
                                    other.trim() === option.trim(),
                                ))
                                ? 'Preencha uma opção diferente das demais.'
                                : undefined
                            }
                          >
                            <input
                              value={option}
                              maxLength={150}
                              placeholder={
                                optionIndex === 0
                                  ? 'Ex.: Medicina'
                                  : 'Ex.: Enfermagem'
                              }
                              onChange={(event) =>
                                update(index, {
                                  options: question.options!.map((item, i) =>
                                    i === optionIndex
                                      ? event.target.value
                                      : item,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </div>
                        <button
                          type="button"
                          className="icon-btn mb-1"
                          aria-label={`Remover opção ${optionIndex + 1} da pergunta ${index + 1}`}
                          onClick={() =>
                            update(index, {
                              options: question.options!.filter(
                                (_, i) => i !== optionIndex,
                              ),
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={(question.options?.length ?? 0) >= 50}
                      onClick={() =>
                        update(index, {
                          options: [...(question.options ?? []), ''],
                        })
                      }
                    >
                      <Plus size={16} />
                      Adicionar opção
                    </button>
                    {showErrors && !question.options?.length && (
                      <p role="alert" className="text-sm text-red-700">
                        Adicione pelo menos uma opção.
                      </p>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={question.required}
                    onChange={(event) =>
                      update(index, { required: event.target.checked })
                    }
                  />
                  {question.type === 'checkbox'
                    ? 'Exigir que esta caixa seja marcada'
                    : 'Tornar a resposta obrigatória'}
                </label>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="btn secondary w-full"
            disabled={fields.length >= 25}
            onClick={add}
          >
            <Plus size={17} />
            Adicionar pergunta
          </button>
        </div>
        <aside
          className="min-w-0 border-t border-zinc-200 pt-6 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0"
          aria-label="Prévia do formulário de inscrição"
        >
          <p className="eyebrow">VISÃO DO PARTICIPANTE</p>
          <h3 className="mb-2 font-semibold">Experimente o formulário</h3>
          <p className="muted mb-6 text-sm">
            A prévia acompanha suas alterações. As respostas digitadas aqui não
            serão salvas.
          </p>
          <QuestionsPreview fields={fields} />
        </aside>
      </div>
    </div>
  );
}
