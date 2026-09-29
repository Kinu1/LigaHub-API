export type CreateAcademicEventInput = {
  id: string;
  title: string;
  priceInCents: number;
  capacity: number;
};

const MAX_DATABASE_INT = 2_147_483_647;

export class AcademicEvent {
  public readonly status = 'draft' as const;

  private constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly priceInCents: number,
    public readonly capacity: number,
  ) {}

  public static create(input: CreateAcademicEventInput): AcademicEvent {
    const id = input.id.trim();
    const title = input.title.trim();

    if (id.length === 0) {
      throw new Error('o ID do evento é obrigatório.');
    }

    if (title.length === 0) {
      throw new Error('O título do evento é obrigatório.');
    }

    if (
      !Number.isSafeInteger(input.priceInCents) ||
      input.priceInCents <= 0 ||
      input.priceInCents > MAX_DATABASE_INT
    ) {
      throw new Error(
        'O preço do evento deve estar entre 1 e 2.147.483.647 centavos.',
      );
    }

    if (
      !Number.isSafeInteger(input.capacity) ||
      input.capacity <= 0 ||
      input.capacity > MAX_DATABASE_INT
    ) {
      throw new Error(
        'A capacidade do evento deve estar entre 1 e 2.147.483.647 participantes.',
      );
    }

    return new AcademicEvent(id, title, input.priceInCents, input.capacity);
  }
}
