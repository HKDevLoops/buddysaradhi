### Task 1: Seed Admin Credentials & Password Utilities

**Goal**: Establish admin db client helper, scrypt-based password utilities, and initialize the admin account.

**Files**:
* Create: `apps/product-page/src/lib/db.ts`
* Create: `apps/product-page/src/lib/adminAuth.ts`
* Create: `apps/product-page/src/lib/seedAdmin.ts`
* Modify: `apps/product-page/src/app/page.tsx`

**Interfaces**:
* Produces: `hashPassword(password: string): string`
* Produces: `verifyPassword(password: string, stored: string): boolean`
* Produces: `seedAdminUser(): Promise<void>`

**Instructions**:
1. **Set up product-page Prisma client helper**
   Create file `apps/product-page/src/lib/db.ts` to instantiate PrismaClient using the relative path to `prisma/dev.db`.
2. **Create hashing and verification utilities**
   Create file `apps/product-page/src/lib/adminAuth.ts` containing `hashPassword` and `verifyPassword` using Node's native `crypto` module (scryptSync with 16-byte random salt).
3. **Create admin seed helper script**
   Create file `apps/product-page/src/lib/seedAdmin.ts` to seed `hkdevs` with password `$thisisHKdevs@22$` if not already seeded.
4. **Hook seeding to landing page load**
   Import and invoke `seedAdminUser()` inside the landing page layout/render flow `apps/product-page/src/app/page.tsx`.
5. **Compilation Check**
   Run `bun run build` inside `apps/product-page` to verify successful client compilation.
