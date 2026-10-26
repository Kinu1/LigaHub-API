import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/pagination.js';

export const auditEntityTypes = [
  'user',
  'event',
  'registration',
  'payment',
  'payment_account',
] as const;

export class AuditQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: auditEntityTypes })
  @IsOptional()
  @IsIn(auditEntityTypes, { message: 'Selecione um tipo de registro válido.' })
  entityType?: (typeof auditEntityTypes)[number];
}
