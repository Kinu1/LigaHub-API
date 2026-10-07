import type { CreateUserDto } from '../users/dto/create-user.dto.js';

type BootstrapStore = {
  user: {
    findUnique(input: {
      where: { email: string };
    }): Promise<{ role: string; active: boolean } | null>;
  };
};
type BootstrapCreator = { create(input: CreateUserDto): Promise<unknown> };

export async function ensureBootstrapAdmin(
  store: BootstrapStore,
  creator: BootstrapCreator,
  input: Omit<CreateUserDto, 'role'>,
): Promise<'created' | 'existing'> {
  const email = input.email.trim().toLowerCase();
  const existing = await store.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin')
      throw new Error(
        'O e-mail informado já pertence a uma conta que não é administradora.',
      );
    if (!existing.active)
      throw new Error(
        'A conta administradora já existe e está suspensa. Não foi alterada.',
      );
    return 'existing';
  }
  await creator.create({ ...input, email, role: 'admin' });
  return 'created';
}
