import { IsOptional, IsNotEmpty, IsEmail, MaxLength } from 'class-validator';

export class TestCampaignDto {
  @IsOptional()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email?: string;
}
