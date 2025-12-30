// src/common/sync/SyncBootstrap.tsx

import * as React from 'react';
import { startChatSyncAgent } from './chatSyncAgent';
import { getBootUserNamespace, isUnauthorizedNamespace } from '~/common/auth/userNamespace';

/**
 * This component renders nothing.
 * It only exists to "start" the background sync agent on the client.
 */
export function SyncBootstrap() {
  React.useEffect(() => {
    const ns = getBootUserNamespace();

    // When unauthenticated (future login page), avoid running background sync.
    if (isUnauthorizedNamespace(ns))
      return;

    const stop = startChatSyncAgent({
      debug: false,
      traceSkips: false,
    });

    return () => stop();
  }, []);

  return null;
}