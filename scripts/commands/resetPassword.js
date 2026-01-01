// scripts/commands/resetPassword.js

const { withClient } = require('../lib/db');
const { validateUsername } = require('../lib/validate');
const { getPassword, hashPassword } = require('../lib/password');
const { updateAuthUserPassword } = require('../lib/repo');
const { CliError } = require('../lib/errors');

module.exports = async function cmdResetPassword({ username, generate }) {
  const u = validateUsername(username);

  const { password, generated } = await getPassword({ generate });
  const passwordHash = await hashPassword(password);

  const row = await withClient((client) =>
    updateAuthUserPassword(client, { username: u, passwordHash }),
  );

  if (!row) {
    throw new CliError(`User not found: ${u}`, 3);
  }

  console.log('Password updated for user:', row);
  if (generated) {
    console.log('\nGenerated password (store it now; it will not be shown again):');
    console.log(password);
  }
};