import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  console.log("Starting backfill of balancePaise...");
  const ledgerGroups = await db.ledgerEntry.groupBy({
    by: ['studentId'],
    _sum: { debitPaise: true, creditPaise: true },
    where: { type: { not: 'VOID' }, voidOfId: null }
  });

  let count = 0;
  for (const g of ledgerGroups) {
    const debit = g._sum.debitPaise || 0;
    const credit = g._sum.creditPaise || 0;
    const balance = debit - credit;
    await db.student.update({
      where: { id: g.studentId },
      data: { balancePaise: balance }
    });
    count++;
  }
  console.log(`Updated ${count} students.`);
}

main().catch(console.error).finally(() => db.$disconnect());
