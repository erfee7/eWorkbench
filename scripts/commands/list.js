// scripts/commands/list.js

const { withClient } = require('../lib/db');
const { listAuthUsers } = require('../lib/repo');

module.exports = async function cmdList() {
  const rows = await withClient((client) => listAuthUsers(client));

  if (!rows.length) {
    console.log('No users found.');
    return;
  }

  console.table(rows);
};