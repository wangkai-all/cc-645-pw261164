// Minimal WebSocket fan-out hub. The browser opens one socket and receives
// typed messages: sample, collection-status, connection, config.
import { WebSocketServer } from 'ws';

export class WsHub {
  constructor(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.clients = new Set();
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }));
    });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  sendTo(ws, message) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  get clientCount() {
    return this.clients.size;
  }
}
