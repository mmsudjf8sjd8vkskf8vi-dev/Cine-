const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  socket.on('cargar', (url) => io.emit('cargar', url));
  socket.on('play', (t) => socket.broadcast.emit('play', t));
  socket.on('pause', (t) => socket.broadcast.emit('pause', t));
  socket.on('seek', (t) => socket.broadcast.emit('seek', t));
  socket.on('mensaje', (m) => io.emit('mensaje', m));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Servidor listo en el puerto ' + PORT));
