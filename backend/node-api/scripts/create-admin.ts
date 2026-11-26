import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  const email = process.env.ADMIN_EMAIL || (await ask('Admin email: '));
  const password = process.env.ADMIN_PASSWORD || (await ask('Admin password (min 8 chars): '));
  const role = (process.env.ADMIN_ROLE || (await ask('Role (admin | moderator) [admin]: ')) || 'admin').toLowerCase();

  if (!email || !email.includes('@')) {
    console.error('Error: Valid email is required.');
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error('Error: Password must be at least 8 characters.');
    process.exit(1);
  }
  if (!['admin', 'moderator'].includes(role)) {
    console.error('Error: Role must be "admin" or "moderator".');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.adminUser.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, role, disabled: false },
    create: { email: email.toLowerCase(), passwordHash, role, disabled: false },
  });

  console.log(`Admin user ready: ${user.email} (role=${user.role}, id=${user.id})`);
}

main()
  .catch((err) => {
    console.error('Failed to create admin user:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
