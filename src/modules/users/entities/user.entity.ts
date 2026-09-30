export type UserRole = 'admin' | 'organizer';

export type CreateUserInput = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

export class User {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly email: string,
    public readonly role: UserRole,
  ) {}

  public static create(input: CreateUserInput): User {
    const id = input.id.trim();
    const name = input.name.trim();
    const email = input.email.trim().toLowerCase();

    if (id.length === 0) {
      throw new Error('O ID do usuário é obrigatório.');
    }

    if (name.length === 0) {
      throw new Error('O nome do usuário é obrigatório.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('O e-mail do usuário é inválido.');
    }

    if (input.role !== 'admin' && input.role !== 'organizer') {
      throw new Error('O papel do usuário é inválido.');
    }

    return new User(id, name, email, input.role);
  }
}