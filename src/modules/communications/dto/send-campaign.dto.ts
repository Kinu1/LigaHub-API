import { IsUUID } from 'class-validator';

export class SendCampaignDto {
  @IsUUID('4')
  idempotencyKey: string;
}
