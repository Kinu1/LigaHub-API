import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CommunicationStatus } from '../communications.enums.js';

export class ListCampaignsQuery {
  @IsOptional()
  @IsUUID('4')
  eventId?: string;

  @IsOptional()
  @IsIn(['draft', 'sending', 'sent', 'failed'])
  status?: CommunicationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsString()
  search?: string;
}
