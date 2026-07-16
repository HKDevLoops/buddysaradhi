import { db } from "./db";
import { hashPassword } from "./adminAuth";

export async function seedAdminUser() {
  const adminUsername = "hkdevs";
  const adminPassword = "$thisisHKdevs@22$";
  
  const existing = await db.adminUser.findUnique({
    where: { username: adminUsername }
  });
  
  if (!existing) {
    const hashedPassword = hashPassword(adminPassword);
    await db.adminUser.create({
      data: {
        username: adminUsername,
        password: hashedPassword
      }
    });
    console.log(`[Admin Seeding] Successfully seeded admin user: ${adminUsername}`);
  }
}
