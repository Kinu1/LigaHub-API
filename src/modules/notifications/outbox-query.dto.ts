import { IsIn } from 'class-validator';
import { PaginationDto } from '../../common/pagination.js';

export class OutboxQueryDto extends PaginationDto {
  @IsIn(['pending', 'processing', 'sent', 'failed', 'skipped'])
  status!: string;
}
