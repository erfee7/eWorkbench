import * as React from 'react';
import { startChatSyncAgent } from './chatSyncAgent';

/**
 * This component renders nothing.
 * It only exists to "start" the background watcher on the client.
 */
export function SyncBootstrap() {
  React.useEffect(() => {
    const isDev = process.env.NODE_ENV === 'development';
    const stop = startChatSyncAgent({
      debug: true,
      // do not spam skip logs unless explicitly desired
      traceSkips: false,
    });

    return () => stop();
  }, []);

  return null;
}