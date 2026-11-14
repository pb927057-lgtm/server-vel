import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('VEL Relay Server is running securely.\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('Nuevo dispositivo conectado al Relay.');

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      // Reenvío de sobres E2EE cifrados de extremo a extremo sin almacenamiento en servidor
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(data));
        }
      });
    } catch (e) {
      console.error('Error al procesar el mensaje en el Relay:', e);
    }
  });

  ws.on('close', () => {
    console.log('Dispositivo desconectado del Relay.');
  });
});

server.listen(PORT, () => {
  console.log(`Servidor VEL Relay escuchando en el puerto ${PORT}`);
});