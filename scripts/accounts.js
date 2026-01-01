// scripts/accounts.js
//
// Operator-only account management CLI (closed system).
// Docker usage example (TTY required for prompts):
//   docker compose exec -it web node scripts/accounts.js create --username Alice

const { parseArgs } = require('./lib/args');
const { isCliError } = require('./lib/errors');

const cmdCreate = require('./commands/create');
const cmdResetPassword = require('./commands/resetPassword');
const cmdList = require('./commands/list');
const cmdSetActive = require('./commands/setActive');
const cmdSetAdmin = require('./commands/setAdmin');
const cmdDelete = require('./commands/delete');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'create':
      return cmdCreate(args);

    case 'reset-password':
      return cmdResetPassword(args);

    case 'list':
      return cmdList(args);

    case 'enable':
      return cmdSetActive({ ...args, active: true });

    case 'disable':
      return cmdSetActive({ ...args, active: false });

    case 'promote-admin':
      return cmdSetAdmin({ ...args, admin: true });

    case 'demote-admin':
      return cmdSetAdmin({ ...args, admin: false });

    case 'delete':
      return cmdDelete(args);
  }
}

// Run the main function and handle errors appropriately
main().catch((err) => {
  if (isCliError(err)) {
    console.error(err.message);
    process.exit(err.exitCode || 1);
  }

  console.error(err?.stack || err);
  process.exit(2);
});
