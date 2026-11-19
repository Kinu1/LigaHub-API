import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import {
  encryptCredential,
  decryptCredential,
} from '../payments/payment-security.js';
import {
  campaignAccess,
  type Db,
  type Role,
  terminalRecipientStates,
} from './communications.policy.js';
import {
  calculateChecksum,
  validateFilename,
  validateFileSignature,
} from './attachment-validator.js';
import {
  MAX_CHUNK_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
} from './communications.enums.js';
import type { InitiateAttachmentDto, UploadChunkDto } from './dto/index.js';
@Injectable()
export class AttachmentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private async file(tx: Db, campaignId: string, id: string, upload = false) {
    const f = await tx.communicationAttachment.findUnique({ where: { id } });
    if (!f || f.campaignId !== campaignId)
      throw new NotFoundException('Anexo não encontrado.');
    if (upload && (f.status !== 'uploading' || f.expiresAt <= new Date()))
      throw new ConflictException('Upload não disponível.');
    return f;
  }
  async initiateUpload(
    eventId: string,
    campaignId: string,
    userId: string,
    role: Role,
    dto: InitiateAttachmentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await campaignAccess(tx, eventId, campaignId, userId, role, true, true);
      if (
        !validateFilename(dto.filename, dto.mimeType) ||
        dto.totalChunks !== Math.ceil(dto.sizeBytes / MAX_CHUNK_SIZE)
      )
        throw new BadRequestException('Nome/tipo/chunks inválidos.');
      const files = await tx.communicationAttachment.findMany({
        where: { campaignId },
      });
      if (
        files.length >= 5 ||
        files.reduce((n, f) => n + Number(f.sizeBytes), dto.sizeBytes) >
          MAX_TOTAL_ATTACHMENT_SIZE
      )
        throw new BadRequestException('Limite de anexos excedido.');
      const f = await tx.communicationAttachment.create({
        data: {
          filename: dto.filename,
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes,
          checksum: dto.checksum,
          totalChunks: dto.totalChunks,
          campaignId,
          expiresAt: new Date(Date.now() + 24 * 3600000),
        },
      });
      return { attachmentId: f.id, expiresAt: f.expiresAt };
    });
  }
  async uploadChunk(
    eventId: string,
    campaignId: string,
    userId: string,
    role: Role,
    id: string,
    dto: UploadChunkDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await campaignAccess(tx, eventId, campaignId, userId, role, true, true);
      const f = await this.file(tx, campaignId, id, true);
      const b = Buffer.from(dto.dataBase64, 'base64');
      const expected =
        dto.chunkIndex === f.totalChunks - 1
          ? Number(f.sizeBytes) - MAX_CHUNK_SIZE * (f.totalChunks - 1)
          : MAX_CHUNK_SIZE;
      if (
        dto.chunkIndex >= f.totalChunks ||
        b.toString('base64') !== dto.dataBase64 ||
        b.length !== expected ||
        b.length > MAX_CHUNK_SIZE ||
        calculateChecksum(b) !== dto.checksum
      )
        throw new BadRequestException('Chunk inválido.');
      const where = {
        attachmentId_chunkIndex: {
          attachmentId: id,
          chunkIndex: dto.chunkIndex,
        },
      };
      const prior = await tx.communicationAttachmentChunk.findUnique({ where });
      if (prior && prior.checksum !== dto.checksum)
        throw new ConflictException('Chunk divergente.');
      if (!prior)
        await tx.communicationAttachmentChunk.create({
          data: {
            attachmentId: id,
            chunkIndex: dto.chunkIndex,
            checksum: dto.checksum,
            dataBase64: encryptCredential(dto.dataBase64),
          },
        });
      return {
        receivedChunks: await tx.communicationAttachmentChunk.count({
          where: { attachmentId: id },
        }),
        totalChunks: f.totalChunks,
      };
    });
  }
  async finalizeUpload(
    eventId: string,
    campaignId: string,
    userId: string,
    role: Role,
    id: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await campaignAccess(tx, eventId, campaignId, userId, role, true, true);
        const f = await this.file(tx, campaignId, id);
        if (f.status === 'ready')
          return { status: 'ready', message: 'Anexo finalizado.' };
        if (f.status !== 'uploading' || f.expiresAt <= new Date())
          throw new ConflictException('Upload expirado.');
        const chunks = await tx.communicationAttachmentChunk.findMany({
          where: { attachmentId: id },
          orderBy: { chunkIndex: 'asc' },
        });
        if (
          chunks.length !== f.totalChunks ||
          chunks.some((c, i) => c.chunkIndex !== i)
        )
          throw new BadRequestException('Chunks incompletos.');
        const b = Buffer.concat(
          chunks.map((c) =>
            Buffer.from(decryptCredential(c.dataBase64), 'base64'),
          ),
        );
        if (
          b.length !== Number(f.sizeBytes) ||
          calculateChecksum(b) !== f.checksum ||
          !validateFileSignature(b, f.mimeType)
        )
          throw new BadRequestException('Arquivo inválido.');
        await tx.communicationAttachment.update({
          where: { id },
          data: {
            status: 'ready',
            uploadedAt: new Date(),
            encryptedPayload: encryptCredential(b.toString('base64')),
          },
        });
        await tx.communicationAttachmentChunk.deleteMany({
          where: { attachmentId: id },
        });
        return { status: 'ready', message: 'Anexo finalizado.' };
      },
      { timeout: 30000 },
    );
  }
  async deleteAttachment(
    eventId: string,
    campaignId: string,
    userId: string,
    role: Role,
    id: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await campaignAccess(tx, eventId, campaignId, userId, role, true, true);
      await this.file(tx, campaignId, id);
      await tx.communicationAttachment.delete({ where: { id } });
      return { message: 'Anexo removido.' };
    });
  }
  async downloadAttachment(
    eventId: string,
    campaignId: string,
    userId: string,
    role: Role,
    id: string,
  ) {
    await campaignAccess(this.prisma, eventId, campaignId, userId, role);
    const f = await this.file(this.prisma, campaignId, id);
    if (f.status !== 'ready' || !f.encryptedPayload)
      throw new NotFoundException('Arquivo indisponível.');
    return {
      buffer: Buffer.from(decryptCredential(f.encryptedPayload), 'base64'),
      filename: f.filename,
      mimeType: f.mimeType,
    };
  }
  async cleanup(now = new Date(), deadline = Infinity) {
    const cutoff = new Date(now.getTime() - 30 * 24 * 3600000);
    // Same campaign lock as send/upload; explicit known terminal states only.
    const files = await this.prisma.communicationAttachment.findMany({
      where: {
        OR: [
          { status: 'uploading', expiresAt: { lt: now } },
          { status: 'ready', uploadedAt: { lt: cutoff } },
        ],
      },
      take: 100,
      select: { id: true, campaignId: true },
    });
    for (const f of files) {
      if (Date.now() + 2000 >= deadline) break;
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM communication_campaigns WHERE id=${f.campaignId}::uuid FOR UPDATE`;
        const c = await tx.communicationCampaign.findUnique({
          where: { id: f.campaignId },
        });
        const file = await this.file(tx, f.campaignId, f.id);
        if (
          file.status === 'uploading' &&
          file.expiresAt < now &&
          c?.status === 'draft'
        )
          await tx.communicationAttachment.delete({ where: { id: f.id } });
        else if (
          file.status === 'ready' &&
          file.uploadedAt &&
          file.uploadedAt < cutoff &&
          c &&
          c.completedAt &&
          c.completedAt < cutoff &&
          ['sent', 'failed'].includes(c.status)
        ) {
          const pending = await tx.communicationRecipient.count({
            where: {
              campaignId: c.id,
              status: { notIn: [...terminalRecipientStates] },
            },
          });
          if (!pending)
            await tx.communicationAttachment.delete({ where: { id: f.id } });
        }
      });
    }
  }
}
