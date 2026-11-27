const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const salas = new Map();

function calcularTiempo(sala) {
  if (!sala.url || sala.pausado) return sala.tiempo;
  return sala.tiempo + (Date.now() - sala.ultimaActualizacion) / 1000;
}

io.on('connection', (socket) => {
  let salaId = 'general';

  socket.on('unirseA_sala', (id) => {
    socket.leave(salaId);
    salaId = id || 'general';
    socket.join(salaId);

    if (!salas.has(salaId)) {
      salas.set(salaId, {
        url: '',
        tiempo: 0,
        pausado: true,
        ultimaActualizacion: Date.now()
      });
    }

    const sala = salas.get(salaId);
    socket.emit('cargar', {
      url: sala.url,
      tiempo: calcularTiempo(sala),
      pausado: sala.pausado
    });
  });

  socket.on('cargar', (url) => {
    const sala = salas.get(salaId);
    if (!sala) return;
    sala.url = url;
    sala.tiempo = 0;
    sala.pausado = false;
    sala.ultimaActualizacion = Date.now();
    io.to(salaId).emit('cargar', {
      url: sala.url,
      tiempo: 0,
      pausado: false
    });
  });

  socket.on('play', (tiempo) => {
    const sala = salas.get(salaId);
    if (!sala) return;
    sala.tiempo = tiempo;
    sala.pausado = false;
    sala.ultimaActualizacion = Date.now();
    socket.to(salaId).emit('play', tiempo);
  });

  socket.on('pause', (tiempo) => {
    const sala = salas.get(salaId);
    if (!sala) return;
    sala.tiempo = tiempo;
    sala.pausado = true;
    sala.ultimaActualizacion = Date.now();
    socket.to(salaId).emit('pause', tiempo);
  });

  socket.on('seek', (tiempo) => {
    const sala = salas.get(salaId);
    if (!sala) return;
    sala.tiempo = tiempo;
    sala.ultimaActualizacion = Date.now();
    socket.to(salaId).emit('seek', tiempo);
  });

  socket.on('mensaje', (data) => {
    io.to(salaId).emit('mensaje', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
