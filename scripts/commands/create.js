// scripts/commands/create.js

const { withClient } = require('../lib/db');
const { validateUsername } = require('../lib/validate');
const { getPassword, hashPassword } = require('../lib/password');
const { insertAuthUser } = require('../lib/repo');

module.exports = async function cmdCreate({ username, generate, admin }) {
  const u = validateUsername(username);

  const { password, generated } = await getPassword({ generate });
  const passwordHash = await hashPassword(password);

  const row = await withClient((client) =>
    insertAuthUser(client, { username: u, passwordHash, isAdmin: !!admin }),
  );

  console.log('Created user:', row);
  if (generated) {
    console.log('\nGenerated password (store it now; it will not be shown again):');
    console.log(password);
  }
};