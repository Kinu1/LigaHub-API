import type { User } from './entities/user.entity.js'

export type UserWithCredentials = {
    user: User;
    passwordHash: string;
};

export abstract class UserRepository {
    abstract create(user: User, passwordHash: string, actorId?: string): Promise<void>;

    abstract findByEmail(email:string): Promise<UserWithCredentials | null>;
}
