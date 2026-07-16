import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  console.log('Seeding database...');
  
  const tenantId = 'test-tutor-id';
  
  await db.setting.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      instituteName: 'Test Academy',
      tenantSecret: 'secret',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  });

  await db.tutor.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      email: 'test@example.com',
      name: 'Test Tutor',
      isActive: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: tenantId,
    }
  });

  console.log('Seeding complete!');
}

main().catch(console.error).finally(() => db.$disconnect());
