// scripts/commands/setActive.js

const { withClient } = require('../lib/db');
const { validateUsername } = require('../lib/validate');
const { setAuthUserActive } = require('../lib/repo');
const { CliError } = require('../lib/errors');

module.exports = async function cmdSetActive({ username, active }) {
  const u = validateUsername(username);

  const row = await withClient((client) =>
    setAuthUserActive(client, { username: u, isActive: !!active }),
  );

  if (!row) {
    throw new CliError(`User not found: ${u}`, 3);
  }

  console.log(active ? 'Enabled user:' : 'Disabled user:', row);
};