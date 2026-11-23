import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';

export class UploadChunkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(699052)
  dataBase64: string;

  @IsInt()
  @Min(0)
  @Max(19)
  chunkIndex: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-f0-9]{64}$/)
  checksum: string;
}
