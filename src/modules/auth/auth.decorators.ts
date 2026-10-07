import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRole } from '../users/entities/user.entity.js';

export const PUBLIC_ROUTE = 'ligahub:public';
export const REQUIRED_ROLES = 'ligahub:roles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
