import type { Response } from 'express';
import {
  Inject,
  Res,
  ParseUUIDPipe,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../auth/auth.guards.js';
import { Roles } from '../auth/auth.decorators.js';
import { CommunicationsService } from './communications.service.js';
import { AttachmentsService } from './attachments.service.js';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  InitiateAttachmentDto,
  UploadChunkDto,
  FinalizeAttachmentDto,
  SendCampaignDto,
  TestCampaignDto,
  ListCampaignsQuery,
  ListRecipientsQuery,
} from './dto/index.js';

@ApiTags('Communications')
@ApiBearerAuth()
@Controller('events/:eventId/communications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommunicationsController {
  constructor(
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
    @Inject(AttachmentsService)
    private readonly attachments: AttachmentsService,
  ) {}

  // Campaign CRUD
  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async createCampaign(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: CreateCampaignDto,
  ) {
    return this.communications.createCampaign(
      eventId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async listCampaigns(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Query() query: ListCampaignsQuery,
  ) {
    return this.communications.listCampaigns(
      eventId,
      req.user.id,
      req.user.role,
      query,
    );
  }

  @Get(':campaignId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async getCampaign(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
  ) {
    return this.communications.getCampaign(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
    );
  }

  @Put(':campaignId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async updateCampaign(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.communications.updateCampaign(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  // Audience preview
  @Get(':campaignId/preview')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async previewAudience(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
  ) {
    return this.communications.previewAudience(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
    );
  }

  // Test email
  @Post(':campaignId/test')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async sendTest(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: TestCampaignDto,
  ) {
    return this.communications.sendTestEmail(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      dto.email,
    );
  }

  // Final send
  @Post(':campaignId/send')
  @HttpCode(202)
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async finalSend(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: SendCampaignDto,
  ) {
    return this.communications.finalizeSend(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      dto.idempotencyKey,
    );
  }

  // Recipients
  @Get(':campaignId/recipients')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async listRecipients(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Query() query: ListRecipientsQuery,
  ) {
    return this.communications.listRecipients(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      query,
    );
  }

  // Attachments
  @Post(':campaignId/attachments/initiate')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async initiateAttachment(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: InitiateAttachmentDto,
  ) {
    return this.attachments.initiateUpload(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      dto,
    );
  }

  @Post(':campaignId/attachments/:attachmentId/chunks')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async uploadChunk(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: UploadChunkDto,
  ) {
    return this.attachments.uploadChunk(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      attachmentId,
      dto,
    );
  }

  @Post(':campaignId/attachments/finalize')
  @HttpCode(200)
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async finalizeAttachment(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Body() dto: FinalizeAttachmentDto,
  ) {
    return this.attachments.finalizeUpload(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      dto.attachmentId,
    );
  }

  @Delete(':campaignId/attachments/:attachmentId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async deleteAttachment(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
  ) {
    return this.attachments.deleteAttachment(
      eventId,
      campaignId,
      req.user.id,
      req.user.role,
      attachmentId,
    );
  }

  @Get(':campaignId/attachments/:attachmentId/download')
  @UseGuards(RolesGuard)
  @Roles('admin', 'organizer')
  async downloadAttachment(
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Param('campaignId', new ParseUUIDPipe()) campaignId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Req() req: { user: { id: string; role: 'admin' | 'organizer' } },
    @Res() res: Response,
  ) {
    const { buffer, filename, mimeType } =
      await this.attachments.downloadAttachment(
        eventId,
        campaignId,
        req.user.id,
        req.user.role,
        attachmentId,
      );
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  }
}
