import * as React from 'react';
import { startChatSyncWatcher } from './chatSyncWatcher';

/**
 * This component renders nothing.
 * It only exists to "start" the background watcher on the client.
 */
export function SyncBootstrap() {
  React.useEffect(() => {
    const stop = startChatSyncWatcher({
      debug: true,
      // later you'll replace onUpsert/onDelete with real API calls
    });

    return stop;
  }, []);

  return null;
}