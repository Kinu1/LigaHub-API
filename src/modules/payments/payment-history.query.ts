import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';

export class PaymentHistoryQuery {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN,
  )
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;
  @IsOptional()
  @IsUUID('4')
  eventId?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  eventSearch?: string;
  @IsOptional()
  @IsIn([
    'created',
    'pending',
    'in_process',
    'authorized',
    'in_mediation',
    'approved',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
  ])
  status?: string;
  @IsOptional()
  @IsIn(['pix', 'card'])
  method?: string;
  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  from?: string;
  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  to?: string;

  assertPeriod() {
    const start = this.from ? Date.parse(this.from) : undefined;
    const end = this.to ? Date.parse(this.to) : undefined;
    if (
      (start !== undefined && !Number.isFinite(start)) ||
      (end !== undefined && !Number.isFinite(end)) ||
      (start !== undefined && end !== undefined && start >= end)
    )
      throw new BadRequestException(
        'O período informado é inválido: o início deve ser anterior ao fim.',
      );
  }
}
