import { startChatSyncWatcher } from '~/common/sync/chatSyncWatcher';
import { createChatSyncUploader } from '~/common/sync/chatSyncUploader';
import { createChatSyncTransportNoop } from '~/common/sync/chatSyncTransport.noop';

let singletonStopAgent: (() => void) | null = null;

export interface ChatSyncAgentOptions {
  debug?: boolean;
  traceSkips?: boolean;
}

/**
 * One-stop sync bootstrap:
 * watcher -> uploader -> transport
 */
export function startChatSyncAgent(options: ChatSyncAgentOptions = {}): () => void {
  if (singletonStopAgent) return singletonStopAgent;

  const { debug = true, traceSkips = false } = options;

  const transport = createChatSyncTransportNoop();
  const uploader = createChatSyncUploader({ transport, debug });

  const stopWatcher = startChatSyncWatcher({
    debug,
    traceSkips,
    onUpsert: uploader.queueUpsert,
    onDelete: uploader.queueDelete,
  });

  singletonStopAgent = () => {
    stopWatcher();
    singletonStopAgent = null;
  };

  return singletonStopAgent;
}