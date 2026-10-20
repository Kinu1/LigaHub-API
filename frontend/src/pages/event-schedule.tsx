import { useId, type ReactNode } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { Field } from '../ui';

export function scheduleError(value: string): string | undefined {
  if (!value) return;
  const [day, time] = value.split('T');
  if (!day) return 'Escolha a data para este horário.';
  if (!time) return 'Informe o horário para esta data.';
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}:00-03:00`))
  )
    return 'Informe uma data e um horário válidos.';
}

export function ScheduleField({
  title,
  description,
  value,
  onChange,
  error,
  onBlur,
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}) {
  const id = useId();
  const [day = '', time = ''] = value.split('T');
  const update = (nextDay: string, nextTime: string) =>
    onChange(nextDay || nextTime ? `${nextDay}T${nextTime}` : '');
  return (
    <fieldset
      className="min-w-0"
      aria-describedby={description ? `${id}-description` : undefined}
    >
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {description && (
        <p id={`${id}-description`} className="muted mb-4 text-sm">
          {description}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-3">
        <Field
          label="Data"
          error={error && (!day || (!!day && !!time)) ? error : undefined}
        >
          <input
            type="date"
            value={day}
            onChange={(event) => update(event.target.value, time)}
            onBlur={onBlur}
          />
        </Field>
        <Field
          label="Horário"
          error={error && !!day && !time ? error : undefined}
        >
          <input
            type="time"
            value={time}
            onChange={(event) => update(day, event.target.value)}
            onBlur={onBlur}
          />
        </Field>
      </div>
      {value && (
        <button
          type="button"
          className="mt-3 text-sm text-red-800 underline underline-offset-4"
          onClick={() => onChange('')}
        >
          Limpar {title.toLocaleLowerCase('pt-BR')}
        </button>
      )}
    </fieldset>
  );
}

export function ScheduleSection({
  children,
  deadline,
}: {
  children: ReactNode;
  deadline: ReactNode;
}) {
  return (
    <div className="space-y-7 border-t border-zinc-200 pt-6">
      <section aria-labelledby="event-period-title">
        <div className="mb-5 flex items-start gap-3">
          <CalendarDays className="mt-0.5 shrink-0 text-red-800" size={21} />
          <div>
            <h3 id="event-period-title" className="font-semibold">
              Quando acontece
            </h3>
            <p className="muted mt-1 text-sm">
              Defina a data e o horário de início e término do evento.
            </p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">{children}</div>
      </section>
      <section
        aria-labelledby="registration-deadline-title"
        className="border-t border-zinc-200 pt-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <Clock3 className="mt-0.5 shrink-0 text-red-800" size={21} />
          <div>
            <h3 id="registration-deadline-title" className="font-semibold">
              Prazo de inscrição
            </h3>
            <p className="muted mt-1 text-sm">
              Até quando os participantes poderão se inscrever?
            </p>
          </div>
        </div>
        <div className="max-w-lg">{deadline}</div>
      </section>
      <p className="muted text-sm">
        Todos os horários seguem o horário de Brasília. Se ainda não definiu uma
        data, deixe os dois campos em branco.
      </p>
    </div>
  );
}
