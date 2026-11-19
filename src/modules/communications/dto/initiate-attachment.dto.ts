import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsIn,
  Matches,
} from 'class-validator';

export class InitiateAttachmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  @IsString()
  @IsNotEmpty()
  @IsIn([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ])
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024) // 10 MiB total
  sizeBytes: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  checksum: string;

  @IsInt()
  @Min(1)
  @Max(20)
  totalChunks: number;
}
