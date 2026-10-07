import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { FormField } from './forms.js';

export class CreateEventDto {
  @ApiProperty()
  @IsString({ message: 'O título deve ser um texto.' })
  @MinLength(1, { message: 'O título é obrigatório.' })
  @MaxLength(200, { message: 'O título deve conter até 200 caracteres.' })
  title: string;
  @ApiProperty()
  @IsInt({ message: 'O preço deve ser inteiro em centavos.' })
  @Min(1, { message: 'O preço deve ser positivo.' })
  @Max(2147483647, { message: 'O preço excede o limite permitido.' })
  priceInCents: number;
  @ApiProperty()
  @IsInt({ message: 'A capacidade deve ser inteira.' })
  @Min(1, { message: 'A capacidade deve ser positiva.' })
  @Max(2147483647, { message: 'A capacidade excede o limite permitido.' })
  capacity: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'O responsável deve possuir um UUID válido.' })
  ownerId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(10000, {
    message: 'A descrição deve conter até 10000 caracteres.',
  })
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'O local deve ser um texto.' })
  @MaxLength(500, { message: 'O local deve conter até 500 caracteres.' })
  location?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'A data inicial é inválida.' })
  startsAt?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'A data final é inválida.' })
  endsAt?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'O prazo de inscrição é inválido.' })
  registrationDeadline?: string;
  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @IsInt({ message: 'O prazo de reserva deve ser inteiro.' })
  @Min(5, { message: 'A reserva deve durar pelo menos 5 minutos.' })
  @Max(60, { message: 'A reserva deve durar no máximo 60 minutos.' })
  reservationMinutes?: number;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray({ message: 'O formulário deve ser uma lista.' })
  form?: FormField[];
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}
export class EventPaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'A página deve ser inteira.' })
  @Min(1, { message: 'A página deve ser positiva.' })
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O tamanho da página deve ser inteiro.' })
  @Min(1, { message: 'O tamanho da página deve ser positivo.' })
  @Max(100, { message: 'A página deve conter até 100 itens.' })
  limit = 20;
}
