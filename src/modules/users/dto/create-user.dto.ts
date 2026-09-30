import type { UserRole } from '../entities/user.entity.js';

export type CreateUserDto = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};