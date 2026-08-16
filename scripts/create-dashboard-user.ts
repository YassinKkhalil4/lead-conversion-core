import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const roleSchema = z.enum(['admin', 'manager', 'salesperson']);

export interface CreateDashboardUserArgs {
  clientKey: string;
  email: string;
  name: string;
  role: z.infer<typeof roleSchema>;
  password: string;
  salespersonPhone: string;
}

const USAGE = `Usage: npm run user:create -- \\
  --client-key <client_key|legacy_airtable_id> \\
  --email <email> \\
  --name "<full name>" \\
  [--role admin|manager|salesperson] \\
  [--salesperson-phone +2010...] \\
  [--password <password>]

Omit --password to have one generated and printed once.
A salesperson user must be linked to an existing salesperson via --salesperson-phone.`;

export function parseArgs(argv: string[]): CreateDashboardUserArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${arg}\n\n${USAGE}`);
    values.set(arg.slice(2), next);
    index += 1;
  }

  const clientKey = values.get('client-key') ?? '';
  const email = values.get('email') ?? '';
  const name = values.get('name') ?? '';
  if (!clientKey || !email || !name) throw new Error(`--client-key, --email and --name are required\n\n${USAGE}`);

  const role = roleSchema.parse(values.get('role') ?? 'admin');
  const salespersonPhone = values.get('salesperson-phone') ?? '';
  if (role === 'salesperson' && !salespersonPhone) {
    throw new Error(`--salesperson-phone is required for role=salesperson\n\n${USAGE}`);
  }

  return {
    clientKey,
    email,
    name,
    role,
    salespersonPhone,
    // 24 random bytes rendered base64url: long enough that the generated
    // credential does not need a policy check before hashing.
    password: values.get('password') ?? randomBytes(24).toString('base64url'),
  };
}

export async function createDashboardUser(args: CreateDashboardUserArgs): Promise<{ userId: string }> {
  const [{ pool, closePool }, { DashboardUserService }] = await Promise.all([
    import('../src/db/pool.js'),
    import('../src/services/dashboard/user-service.js'),
  ]);
  try {
    const client = await pool.query<{ client_id: string; company_name: string }>(
      `SELECT client_id, company_name
       FROM app.clients
       WHERE client_key = $1 OR legacy_airtable_id = $1
       LIMIT 1`,
      [args.clientKey],
    );
    const clientRow = client.rows[0];
    if (!clientRow) throw new Error(`Client not found: ${args.clientKey}`);

    let salespersonId: string | null = null;
    if (args.salespersonPhone) {
      const salesperson = await pool.query<{ salesperson_id: string }>(
        `SELECT salesperson_id FROM app.salespeople WHERE client_id = $1 AND phone_e164 = $2 LIMIT 1`,
        [clientRow.client_id, args.salespersonPhone],
      );
      salespersonId = salesperson.rows[0]?.salesperson_id ?? null;
      if (!salespersonId) {
        throw new Error(`Salesperson not found in ${clientRow.company_name}: ${args.salespersonPhone}`);
      }
    }

    const users = new DashboardUserService();
    const created = await users.create({
      clientId: clientRow.client_id,
      email: args.email,
      password: args.password,
      name: args.name,
      role: args.role,
      salespersonId,
      actorId: 'cli:create-dashboard-user',
    });
    return { userId: created.userId };
  } finally {
    await closePool();
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const result = await createDashboardUser(args);
  console.log(`Created ${args.role} user ${args.email} (${result.userId}).`);
  console.log(`Password: ${args.password}`);
  console.log('Store it in a password manager now — it is not recoverable from the database.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
