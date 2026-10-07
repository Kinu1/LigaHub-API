import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'O e-mail é inválido.' })
  @MaxLength(254, { message: 'O e-mail deve ter no máximo 254 caracteres.' })
  email!: string;

  @IsString({ message: 'A senha deve ser um texto.' })
  @MinLength(1, { message: 'A senha é obrigatória.' })
  @MaxLength(128, { message: 'A senha deve ter no máximo 128 caracteres.' })
  password!: string;
}
