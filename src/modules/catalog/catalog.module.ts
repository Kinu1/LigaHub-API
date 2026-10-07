import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import {
  CatalogController,
  PublicEventsController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CatalogController, PublicEventsController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
