import { useId, useState, type ReactNode } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { Field } from '../ui';

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2030, month, 1)),
  ),
);
const capitalize = (text: string) =>
  text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);

export function DateSelector({
  value,
  onChange,
  onBlur,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}) {
  const today = new Date();
  const [fallbackYear, setYear] = useState(today.getFullYear());
  const [fallbackMonth, setMonth] = useState(today.getMonth() + 1);
  const parts = value.split('-').map(Number);
  const year = parts[0] || fallbackYear;
  const month = parts[1] || fallbackMonth;
  const day = parts[2] || 0;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const id = useId();
  const update = (nextYear: number, nextMonth: number, nextDay: number) => {
    setYear(nextYear);
    setMonth(nextMonth);
    const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
    onChange(
      nextDay
        ? `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(nextDay, lastDay)).padStart(2, '0')}`
        : '',
    );
  };
  return (
    <fieldset
      className="min-w-0"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="mb-2 text-sm font-medium">Data</legend>
      <div className="grid gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
          <Field label="Mês">
            <select
              value={month}
              onBlur={onBlur}
              onChange={(e) => update(year, Number(e.target.value), day)}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {capitalize(name)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ano">
            <select
              value={year}
              onBlur={onBlur}
              onChange={(e) => update(Number(e.target.value), month, day)}
            >
              {Array.from(
                {
                  length:
                    Math.max(today.getFullYear() + 20, year) -
                    Math.min(today.getFullYear() - 1, year) +
                    1,
                },
                (_, index) => Math.min(today.getFullYear() - 1, year) + index,
              ).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Dia">
          <select
            value={day}
            onBlur={onBlur}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => update(year, month, Number(e.target.value))}
          >
            <option value={0}>Selecione o dia</option>
            {Array.from({ length: days }, (_, index) => index + 1).map((d) => (
              <option key={d} value={d}>
                {capitalize(
                  new Intl.DateTimeFormat('pt-BR', {
                    weekday: 'long',
                    timeZone: 'UTC',
                  }).format(new Date(Date.UTC(year, month - 1, d))),
                )}
                , {d}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && (
        <small
          id={`${id}-error`}
          className="field-error mt-2 block"
          role="alert"
        >
          {error}
        </small>
      )}
    </fieldset>
  );
}

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
      className="schedule-field min-w-0"
      aria-describedby={description ? `${id}-description` : undefined}
    >
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {description && (
        <p id={`${id}-description`} className="muted mb-3 text-sm">
          {description}
        </p>
      )}
      <div className="grid items-end gap-3">
        <DateSelector
          value={day}
          onChange={(nextDay) => update(nextDay, time)}
          onBlur={onBlur}
          error={error && (!day || (!!day && !!time)) ? error : undefined}
        />
        <Field
          label="Horário"
          error={error && !!day && !time ? error : undefined}
        >
          <input
            className="schedule-input"
            type="time"
            onClick={(event) => event.currentTarget.showPicker?.()}
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
              Período de inscrições
            </h3>
            <p className="muted mt-1 text-sm">
              Escolha quando as inscrições abrem e encerram.
            </p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">{deadline}</div>
      </section>
      <p className="muted text-sm">
        Todos os horários seguem o horário de Brasília. Se ainda não definiu uma
        data, deixe os dois campos em branco.
      </p>
    </div>
  );
}
