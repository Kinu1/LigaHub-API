import {
  IsBoolean,
  IsIn,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.js';
export class RegistrationPaginationDto extends PaginationDto {
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
}

export class RegistrationSuspensionDto {
  @ApiProperty() @IsBoolean() suspended!: boolean;
}
