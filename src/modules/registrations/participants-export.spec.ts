import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { ForbiddenException } from '@nestjs/common';
import { createParticipantsWorkbook } from './participants-export.js';
import { validParticipantCpf } from './participant-cpf.js';
import { RegistrationsService } from './registrations.service.js';
import { encryptCredential } from '../payments/payment-security.js';
import type { PrismaService } from '../../prisma.service.js';

const actor = {
  id: 'owner',
  name: 'Organizador',
  email: 'owner@example.com',
  role: 'organizer' as const,
};
const prisma = {
  academicEvent: { findUnique: vi.fn() },
  registration: { findMany: vi.fn(), count: vi.fn() },
  auditLog: { findMany: vi.fn() },
};
const service = new RegistrationsService(prisma as unknown as PrismaService);

beforeEach(() => {
  vi.resetAllMocks();
  prisma.auditLog.findMany.mockResolvedValue([]);
  process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString(
    'base64',
  );
  prisma.academicEvent.findUnique.mockResolvedValue({
    id: 'event',
    ownerId: actor.id,
    title: 'Jornada',
  });
  prisma.registration.findMany.mockResolvedValue([
    {
      id: 'registration',
      name: '=1+1',
      email: 'ana@example.com',
      participantCpfEncrypted: encryptCredential('01234567890'),
      registrationTypeId: 'estudante',
      registrationTypeName: 'Estudante',
      status: 'confirmed',
      payments: [{ status: 'approved' }],
      priceInCents: 2500,
      reservationExpiresAt: new Date(Date.now() + 60000),
    },
  ]);
  prisma.registration.count.mockResolvedValue(1);
});

describe('Participantes por tipo e exportação protegida', () => {
  it('exige CPF nas novas inscrições antes de consultar o evento', async () => {
    await expect(
      service.reserve('public', {
        name: 'Ana',
        email: 'ana@example.com',
        answers: {},
      } as never),
    ).rejects.toThrow('CPF válido');
    expect(prisma.academicEvent.findUnique).not.toHaveBeenCalled();
  });
  it('nega lista e exportação de outro organizador antes de consultar participantes', async () => {
    const outsider = { ...actor, id: 'other' };
    await expect(
      service.list('event', outsider, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.exportParticipants('event', outsider, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });
  it('combina filtros e revela o CPF somente na consulta autorizada', async () => {
    const result = await service.list('event', actor, {
      page: 1,
      limit: 20,
      registrationTypeId: 'estudante',
      search: 'Ana',
      status: 'confirmed',
    });
    expect(prisma.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventId: 'event',
          registrationTypeId: 'estudante',
          status: 'confirmed',
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      cpf: '01234567890',
      paymentStatus: 'approved',
    });
    expect(result.items[0]).not.toHaveProperty('participantCpfEncrypted');
    expect(result.items[0]).not.toHaveProperty('payments');
  });
  it('combina busca e expiração com inscrições antigas na categoria geral', async () => {
    await service.list('event', actor, {
      page: 1,
      limit: 20,
      registrationTypeId: 'geral',
      search: 'Ana',
      status: 'expired',
    });
    const args = prisma.registration.findMany.mock.calls[0][0];
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.AND).toHaveLength(2);
    expect(args.where.AND[1]).toEqual({
      OR: [{ registrationTypeId: 'geral' }, { registrationTypeId: null }],
    });
  });
  it('mantém inscrição cancelada independente do aprovado e consulta contestação histórica', async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        id: 'registration',
        name: 'Ana',
        email: 'ana@example.com',
        status: 'canceled',
        priceInCents: 2500,
        participantCpfEncrypted: null,
        payments: [
          { id: 'recent', status: 'rejected' },
          { id: 'older', status: 'approved' },
        ],
      },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([{ entityId: 'older' }]);
    const result = await service.list('event', actor, { page: 1, limit: 20 });
    expect(result.items[0]).toMatchObject({
      status: 'canceled',
      paymentStatus: 'rejected',
      latestPaymentStatus: 'rejected',
      financialStatus: 'approved',
      financialWarnings: ['dispute_history'],
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: 'payment',
          entityId: { in: ['recent', 'older'] },
        }),
      }),
    );
    expect(
      prisma.registration.findMany.mock.calls[0][0].select.payments,
    ).toEqual({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
  });
  it('exporta todas as páginas e mantém CPF e texto literal no XLSX', async () => {
    prisma.registration.count.mockResolvedValue(101);
    const file = await service.exportParticipants('event', actor, {
      page: 8,
      limit: 20,
      registrationTypeId: 'estudante',
    });
    expect(prisma.registration.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.registration.findMany.mock.calls[1][0]).toMatchObject({
      skip: 100,
      take: 100,
      where: { registrationTypeId: 'estudante' },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Participantes')!;
    expect(sheet.getCell('D2').value).toBe('01234567890');
    expect(sheet.getCell('C2').value).toBe('=1+1');
    expect(sheet.getCell('C2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('G2').value).toBe('Aprovado');
    expect(sheet.getCell('H2').value).toBe(25);
  });
  it('mostra inscrição gratuita e CPF ausente sem recorrer ao pagador', async () => {
    const file = await createParticipantsWorkbook('Jornada', [
      {
        name: 'Ana',
        cpf: null,
        email: 'ana@example.com',
        registrationTypeName: null,
        status: 'confirmed',
        paymentStatus: 'free',
        priceInCents: 0,
      },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet(1)!.getCell('D2').value).toBe('Não informado');
    expect(workbook.getWorksheet(1)!.getCell('G2').value).toBe('Gratuita');
  });
  it('recusa mais de 50.000 participantes sem entregar arquivo parcial', async () => {
    prisma.registration.count.mockResolvedValue(50001);
    await expect(
      service.exportParticipants('event', actor, { page: 1, limit: 20 }),
    ).rejects.toThrow('50.000');
  });
  it.each(['12345678909', '52998224725'])('aceita CPF válido %s', (cpf) =>
    expect(validParticipantCpf(cpf)).toBe(true),
  );
  it.each(['11111111111', '12345678900', '123', 'abcdefghijk'])(
    'recusa CPF inválido %s',
    (cpf) => expect(validParticipantCpf(cpf)).toBe(false),
  );
});
