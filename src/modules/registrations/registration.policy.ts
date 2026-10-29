import { ConflictException, GoneException } from '@nestjs/common';

export function assertRegistrationOpen(
  event: {
    status: string;
    startsAt: Date | null;
    registrationDeadline: Date | null;
    registrationStartsAt?: Date | null;
  },
  now: Date,
): void {
  if (event.status !== 'published')
    throw new ConflictException(
      'As inscrições deste evento estão indisponíveis.',
    );
  const deadline = event.registrationDeadline ?? event.startsAt;
  if (event.registrationStartsAt && event.registrationStartsAt > now)
    throw new ConflictException(
      'As inscrições deste evento ainda não começaram.',
    );
  if (!deadline || deadline <= now)
    throw new GoneException('O prazo de inscrição foi encerrado.');
}

export function assertAvailableCapacity(
  capacity: number,
  occupied: number,
): void {
  if (occupied >= capacity)
    throw new ConflictException('Todas as vagas deste evento estão ocupadas.');
}
