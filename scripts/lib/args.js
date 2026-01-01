// scripts/lib/args.js

const USERNAME_RE = /^[A-Za-z0-9]+$/;
const USERNAME_MAX_LEN = 32;
const PASSWORD_MIN_LEN = 6;

/**
 * Central command spec:
 * - prevents funny UX like treating unknown commands as "missing --username"
 * - validates which flags are allowed per command
 */
const COMMAND_SPECS = {
  'create': { needsUsername: true, allowGenerate: true, allowAdmin: true },
  'reset-password': { needsUsername: true, allowGenerate: true, allowAdmin: false },
  'list': { needsUsername: false, allowGenerate: false, allowAdmin: false },
  'enable': { needsUsername: true, allowGenerate: false, allowAdmin: false },
  'disable': { needsUsername: true, allowGenerate: false, allowAdmin: false },
  'promote-admin': { needsUsername: true, allowGenerate: false, allowAdmin: false },
  'demote-admin': { needsUsername: true, allowGenerate: false, allowAdmin: false },
  'delete': { needsUsername: true, allowGenerate: false, allowAdmin: false },
};

function getHelpText() {
  return `
Usage:
  node scripts/accounts.js <command> [options]

Commands:
  create          --username <name> [--generate] [--admin]
  reset-password  --username <name> [--generate]
  list
  enable          --username <name>
  disable         --username <name>
  promote-admin   --username <name>
  demote-admin    --username <name>
  delete          --username <name>

Rules:
  - Username: ${USERNAME_RE} (case-sensitive), max length ${USERNAME_MAX_LEN}
  - Manual password min length: ${PASSWORD_MIN_LEN}
  - Use --generate to auto-generate a password

Tips:
  - For docker usage, run:
      docker compose exec -it web node scripts/accounts.js <command> [options]
`.trim();
}

/**
 * Help is not an error: print to stdout and exit 0.
 */
function printHelpAndExit() {
  console.log(getHelpText());
  process.exit(0);
}

/**
 * Invalid usage is an error: print message + help to stderr and exit 1.
 */
function usageErrorAndExit(message) {
  if (message) console.error(message);
  console.error(getHelpText());
  process.exit(1);
}

function parseArgs(argv) {
  const command = argv[0];

  if (!command)
    usageErrorAndExit('Missing command.');

  if (command === '--help' || command === '-h')
    printHelpAndExit();

  // Validate command BEFORE validating required flags.
  const spec = COMMAND_SPECS[command];
  if (!spec)
    usageErrorAndExit(`Unknown command: ${command}`);

  const out = {
    command,
    username: null,
    generate: false,
    admin: false,
  };

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--help' || a === '-h')
      printHelpAndExit();

    if (a === '--username') {
      const v = argv[++i];
      if (!v) usageErrorAndExit('Missing value for --username');
      out.username = v;
      continue;
    }

    if (a === '--generate') {
      out.generate = true;
      continue;
    }

    if (a === '--admin') {
      out.admin = true;
      continue;
    }

    usageErrorAndExit(`Unknown argument: ${a}`);
  }

  // Requiredness
  if (spec.needsUsername && !out.username)
    usageErrorAndExit(`Missing required --username for command: ${command}`);

  if (!spec.needsUsername && out.username)
    usageErrorAndExit(`--username is not valid for command: ${command}`);

  // Allowed flags
  if (!spec.allowGenerate && out.generate)
    usageErrorAndExit(`--generate is not valid for command: ${command}`);

  if (!spec.allowAdmin && out.admin)
    usageErrorAndExit(`--admin is not valid for command: ${command}`);

  return out;
}

module.exports = {
  parseArgs,
  printHelpAndExit,
  usageErrorAndExit,
  USERNAME_RE,
  USERNAME_MAX_LEN,
  PASSWORD_MIN_LEN,
};