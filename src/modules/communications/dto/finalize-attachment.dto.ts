import { IsUUID } from 'class-validator';

export class FinalizeAttachmentDto {
  @IsUUID('4')
  attachmentId: string;
}
