// scripts/lib/validate.js

const { USERNAME_RE, USERNAME_MAX_LEN, PASSWORD_MIN_LEN } = require('./args');
const { CliError } = require('./errors');

function validateUsername(usernameRaw) {
  const username = (usernameRaw || '').trim();

  if (!username) throw new CliError('username is required', 1);
  if (username.length > USERNAME_MAX_LEN)
    throw new CliError(`username too long (max ${USERNAME_MAX_LEN})`, 1);
  if (!USERNAME_RE.test(username))
    throw new CliError('username must contain letters and numbers only (A-Z a-z 0-9)', 1);

  return username;
}

function validatePassword(password) {
  if (!password) throw new CliError('password is empty', 1);
  if (password.length < PASSWORD_MIN_LEN)
    throw new CliError(`password too short (min ${PASSWORD_MIN_LEN})`, 1);
  return password;
}

module.exports = {
  validateUsername,
  validatePassword,
};