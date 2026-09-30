import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma.module.js";
import { UserRepository } from "./users.repository.js";
import { PrismaUsersRepository } from "./prisma-users.repository.js";

@Module({
    imports: [PrismaModule],
    providers: [
        {
            provide: UserRepository,
            useClass: PrismaUsersRepository,
        },
    ],
    exports: [UserRepository],
})

export class UsersModule {}