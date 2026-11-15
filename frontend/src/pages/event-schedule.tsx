import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useId, type ReactNode } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { Field } from '../ui';

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
  const id = useId();
  return (
    <fieldset
      className="min-w-0"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="mb-2 text-sm font-medium">Data</legend>
      <label className="sr-only" htmlFor={id}>Data</label>
      <Input
        id={id}
        className="schedule-input"
        type="date"
        value={value}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={(event) => event.currentTarget.showPicker?.()}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
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
          <Input
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
        <Button
          type="button"
          variant="link"
          className="mt-3 px-0"
          onClick={() => onChange('')}
        >
          Limpar {title.toLocaleLowerCase('pt-BR')}
        </Button>
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
    <div className="space-y-7 border-t border-border pt-6">
      <section aria-labelledby="event-period-title">
        <div className="mb-5 flex items-start gap-3">
          <CalendarDays className="mt-0.5 shrink-0 text-primary" size={21} />
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
        className="border-t border-border pt-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <Clock3 className="mt-0.5 shrink-0 text-primary" size={21} />
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
