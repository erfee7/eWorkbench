// scripts/lib/errors.js

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

function isCliError(err) {
  return !!err && (err instanceof CliError || err.name === 'CliError');
}

module.exports = {
  CliError,
  isCliError,
};