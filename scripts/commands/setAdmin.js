// scripts/commands/setAdmin.js

const { withClient } = require('../lib/db');
const { validateUsername } = require('../lib/validate');
const { setAuthUserAdmin } = require('../lib/repo');
const { CliError } = require('../lib/errors');

module.exports = async function cmdSetAdmin({ username, admin }) {
  const u = validateUsername(username);

  const row = await withClient((client) =>
    setAuthUserAdmin(client, { username: u, isAdmin: !!admin }),
  );

  if (!row) {
    throw new CliError(`User not found: ${u}`, 3);
  }

  console.log(admin ? 'Promoted to admin:' : 'Demoted from admin:', row);
};