import { IsBoolean, IsEmail, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateRegistrationDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() answers: Record<string, unknown> = {};
}

export class RegistrationSuspensionDto {
  @ApiProperty() @IsBoolean() suspended!: boolean;
}
