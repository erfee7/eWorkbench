// scripts/lib/prompt.js

const readline = require('readline');
const { CliError } = require('./errors');

function requireTtyOrThrow() {
  if (!process.stdin.isTTY)
    throw new CliError('Interactive prompt requires a TTY. Use --generate.', 1);
}

function promptLine(question) {
  requireTtyOrThrow();

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.on('SIGINT', () => {
      rl.close();
      reject(new CliError('Interrupted', 130));
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  requireTtyOrThrow();

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // When muted, swallow any output readline attempts to echo (typed chars).
    rl.stdoutMuted = false;
    rl._writeToOutput = function _writeToOutput(str) {
      if (rl.stdoutMuted) return;
      rl.output.write(str);
    };

    rl.on('SIGINT', () => {
      rl.close();
      reject(new CliError('Interrupted', 130));
    });

    // Let readline print the prompt, then mute subsequent echo.
    rl.question(question, (answer) => {
      rl.close();

      // Ensure the next output starts on a fresh line (because enter was "muted").
      process.stdout.write('\n');

      resolve(answer);
    });

    rl.stdoutMuted = true;
  });
}

async function confirmUsernameOrThrow(username) {
  const typed = (await promptLine(`Type the username (${username}) to confirm: `)).trim();
  if (typed !== username)
    throw new CliError('Confirmation did not match. Aborting.', 1);
}

module.exports = {
  promptLine,
  promptHidden,
  confirmUsernameOrThrow,
};