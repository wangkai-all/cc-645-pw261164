// Auto-reconnecting WebSocket client. Re-subscribes are the server's job;
// this only dispatches typed messages to listeners.
export function openSocket(onMessage) {
  let ws;
  let closedByUser = false;
  let retry = 0;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (closedByUser) return;
      retry = Math.min(retry + 1, 8);
      setTimeout(connect, 250 * 2 ** retry);
    };
    ws.onerror = () => ws.close();
  }

  connect();
  return {
    close() {
      closedByUser = true;
      ws?.close();
    },
  };
}
