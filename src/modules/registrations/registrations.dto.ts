import {
  IsBoolean,
  IsIn,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.js';

export class RegistrationPaginationDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_-]{1,80}$/)
  registrationTypeId?: string;
  @IsOptional() @IsString() @MaxLength(254) search?: string;
  @IsOptional()
  @IsIn([
    '',
    'reserved',
    'expired',
    'confirmed',
    'payment_review',
    'cancellation',
  ])
  status?: string;
}

export class CreateRegistrationDto {
  @ApiProperty({
    description:
      'CPF obrigatório do participante. O pagamento deve usar o mesmo CPF.',
  })
  @IsString()
  @Matches(/^\d{11}$/)
  cpf!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  answers: Record<string, unknown> = {};
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  registrationTypeId?: string;
}

export class CreateManualRegistrationDto {
  @ApiProperty({
    description: 'CPF obrigatório do participante.',
  })
  @IsString()
  @Matches(/^\d{11}$/)
  cpf!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  answers: Record<string, unknown> = {};
  @ApiProperty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,80}$/)
  @MaxLength(80)
  registrationTypeId!: string;
}

export class RegistrationSuspensionDto {
  @ApiProperty() @IsBoolean() suspended!: boolean;
}
