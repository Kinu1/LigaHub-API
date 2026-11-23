import { IsOptional, IsString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { RecipientStatus } from '../communications.enums.js';

export class ListRecipientsQuery {
  @IsOptional()
  @IsIn([
    'pending',
    'queued',
    'processing',
    'accepted',
    'delivered',
    'delayed',
    'failed',
    'unconfirmed_after24h',
    'skipped',
  ])
  status?: RecipientStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  search?: string;
}
