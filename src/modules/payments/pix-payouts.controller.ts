import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from '../auth/auth.decorators.js';
import { PixDestinationsService } from './pix-destinations.service.js';
import { PixPayoutsService } from './pix-payouts.service.js';
import { pixKeyTypes } from './pix-payout.policy.js';

class OwnerQuery {
  @IsOptional() @IsUUID('4') ownerId?: string;
}
class SavePixDestinationDto extends OwnerQuery {
  @IsIn(pixKeyTypes) keyType!: string;
  @IsString() @MaxLength(254) key!: string;
}
class ApprovePixDestinationDto {
  @IsUUID('4') ownerId!: string;
  @IsUUID('4') destinationId!: string;
}
class PayoutHistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page = 1;
}

@Controller('payments')
@Roles('admin', 'organizer')
export class PixPayoutsController {
  constructor(
    @Inject(PixDestinationsService)
    private readonly destinations: PixDestinationsService,
    @Inject(PixPayoutsService) private readonly payouts: PixPayoutsService,
  ) {}

  @Get('pix-destination')
  @Header('Cache-Control', 'no-store')
  destination(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: OwnerQuery,
  ) {
    return this.destinations.status(actor, query.ownerId);
  }

  @Put('pix-destination')
  @Header('Cache-Control', 'no-store')
  save(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: SavePixDestinationDto,
  ) {
    return this.destinations.save(
      actor,
      input.keyType,
      input.key,
      input.ownerId,
    );
  }

  @Post('pix-destination/approval')
  @Roles('admin')
  @Header('Cache-Control', 'no-store')
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: ApprovePixDestinationDto,
  ) {
    return this.destinations.approve(actor, input.ownerId, input.destinationId);
  }

  @Get('payouts')
  @Header('Cache-Control', 'no-store')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: PayoutHistoryQuery,
  ) {
    return this.payouts.history(actor, query.page);
  }
}
