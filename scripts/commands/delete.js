// scripts/commands/delete.js

const { withClient, withTransaction } = require('../lib/db');
const { validateUsername } = require('../lib/validate');
const { confirmUsernameOrThrow } = require('../lib/prompt');
const {
  getAuthUserByUsername,
  purgeSyncByUserId,
  deleteAuthUserById,
} = require('../lib/repo');
const { CliError } = require('../lib/errors');

module.exports = async function cmdDelete({ username }) {
  const u = validateUsername(username);

  console.error('DANGEROUS OPERATION');
  console.error('- This deletes the account AND all synced chat data for that user.');
  console.error("- Recommendation: use 'disable' instead.\n");

  await confirmUsernameOrThrow(u);

  await withClient(async (client) => {
    const user = await getAuthUserByUsername(client, u);
    if (!user) {
      throw new CliError(`User not found: ${u}`, 3);
    }

    const userId = user.id;

    const result = await withTransaction(client, async () => {
      const purged = await purgeSyncByUserId(client, userId);
      const deleted = await deleteAuthUserById(client, userId);
      return { purged, deleted };
    });

    console.log('Deleted user:', { id: userId, username: u });
    console.log('Purged sync conversations:', result.purged);
    console.log('Deleted auth rows:', result.deleted);
  });
};