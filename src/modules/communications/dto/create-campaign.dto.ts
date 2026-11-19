import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsIn,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { CommunicationAudience } from '../communications.enums.js';
export class CreateCampaignDto {
  @IsString() @IsNotEmpty() @MaxLength(255) subject: string;
  @IsString() @IsNotEmpty() @MaxLength(100000) htmlContent: string;
  @IsString() @IsNotEmpty() @MaxLength(100000) textContent: string;
  @IsIn(['all_active', 'confirmed_only', 'categories'])
  audienceType: CommunicationAudience;
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  audienceCategoryIds: string[];
  @IsOptional() @IsBoolean() confirmedOnly?: boolean;
}
