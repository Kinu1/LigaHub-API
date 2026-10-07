import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UserRole } from '../entities/user.entity.js';

export class CreateUserHttpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'O nome deve ser um texto.' })
  @MinLength(1, { message: 'O nome é obrigatório.' })
  @MaxLength(150, { message: 'O nome deve ter no máximo 150 caracteres.' })
  name!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'O e-mail é inválido.' })
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email!: string;
  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password!: string;
  @IsIn(['admin', 'organizer'], { message: 'O papel do usuário é inválido.' })
  role!: UserRole;
}

export class UpdateUserStatusDto {
  @IsBoolean({ message: 'O estado ativo deve ser verdadeiro ou falso.' })
  active!: boolean;
}
