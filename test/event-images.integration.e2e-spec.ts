import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.decorators.js';

describe('Imagens persistidas dos eventos', () => {
  const prisma = new PrismaService();
  const catalog = new CatalogService(prisma);
  const ownerId = randomUUID();
  const eventId = randomUUID();
  const publicId = randomUUID();
  const image =
    'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
  const actor: AuthenticatedUser = {
    id: ownerId,
    name: 'QA imagens',
    email: `${ownerId}@ligahub.test`,
    role: 'admin',
  };
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        name: actor.name,
        email: actor.email,
        role: 'admin',
        passwordHash: 'hash-teste',
      },
    });
    await prisma.academicEvent.create({
      data: {
        id: eventId,
        publicId,
        ownerId,
        title: 'Evento QA imagens',
        priceInCents: 2500,
        capacity: 10,
        status: 'published',
        startsAt: new Date(Date.now() + 86400000),
      },
    });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: ownerId } });
    await prisma.academicEvent.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });
  it('salva, lê pelo link público, preserva em edição parcial e remove as imagens', async () => {
    await catalog.update(
      eventId,
      { logoImage: image, bannerImage: image },
      actor,
    );
    expect(await catalog.publicEvent(publicId)).toMatchObject({
      logoImage: image,
      bannerImage: image,
    });
    await catalog.update(eventId, { title: 'Título atualizado' }, actor);
    expect(await catalog.get(eventId, actor)).toMatchObject({
      logoImage: image,
      bannerImage: image,
    });
    await expect(
      catalog.update(
        eventId,
        { logoImage: null },
        { ...actor, id: randomUUID(), role: 'organizer' },
      ),
    ).rejects.toThrow('permissão');
    await catalog.update(
      eventId,
      { logoImage: null, bannerImage: null },
      actor,
    );
    expect(await catalog.publicEvent(publicId)).toMatchObject({
      logoImage: null,
      bannerImage: null,
    });
  });
});
