const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let estadoSala = {
  url: '',
  tiempo: 0,
  pausado: true,
  ultimaActualizacion: Date.now()
};

function calcularTiempoActual() {
  if (!estadoSala.url || estadoSala.pausado) return estadoSala.tiempo;
  const segundosTranscurridos = (Date.now() - estadoSala.ultimaActualizacion) / 1000;
  return estadoSala.tiempo + segundosTranscurridos;
}

io.on('connection', (socket) => {
  if (estadoSala.url) {
    socket.emit('cargar', {
      url: estadoSala.url,
      tiempo: calcularTiempoActual(),
      pausado: estadoSala.pausado
    });
  }

  socket.on('cargar', (url) => {
    estadoSala = {
      url,
      tiempo: 0,
      pausado: false,
      ultimaActualizacion: Date.now()
    };
    io.emit('cargar', estadoSala);
  });

  socket.on('play', (tiempo) => {
    estadoSala.tiempo = tiempo;
    estadoSala.pausado = false;
    estadoSala.ultimaActualizacion = Date.now();
    socket.broadcast.emit('play', tiempo);
  });

  socket.on('pause', (tiempo) => {
    estadoSala.tiempo = tiempo;
    estadoSala.pausado = true;
    estadoSala.ultimaActualizacion = Date.now();
    socket.broadcast.emit('pause', tiempo);
  });

  socket.on('seek', (tiempo) => {
    estadoSala.tiempo = tiempo;
    estadoSala.ultimaActualizacion = Date.now();
    socket.broadcast.emit('seek', tiempo);
  });

  socket.on('mensaje', (data) => {
    io.emit('mensaje', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
