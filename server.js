const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};

function obtenerEstadoSala(sala) {
  if (!salas[sala]) {
    salas[sala] = {
      url: '',
      tiempo: 0,
      pausado: true,
      actualizadoEn: Date.now(),
      usuarios: {}
    };
  }
  return salas[sala];
}

function emitirUsuarios(sala) {
  const estado = obtenerEstadoSala(sala);
  const lista = Object.values(estado.usuarios);
  io.to(sala).emit('usuarios', lista);
}

io.on('connection', (socket) => {
  let salaActual = 'general';

  socket.on('unirseA_sala', (datos) => {
    const nuevaSala = (typeof datos === 'string' ? datos : datos.sala) || 'general';
    const nombreUsuario = (typeof datos === 'object' && datos.nombre) ? datos.nombre : 'Invitado';

    if (salaActual && salas[salaActual] && salas[salaActual].usuarios[socket.id]) {
      delete salas[salaActual].usuarios[socket.id];
      emitirUsuarios(salaActual);
    }

    socket.leave(salaActual);
    salaActual = nuevaSala;
    socket.join(salaActual);

    const estado = obtenerEstadoSala(salaActual);
    const esAdmin = Object.keys(estado.usuarios).length === 0;

    estado.usuarios[socket.id] = {
      id: socket.id,
      nombre: nombreUsuario,
      admin: esAdmin
    };

    let tiempoActual = estado.tiempo;
    if (!estado.pausado && estado.url) {
      tiempoActual += (Date.now() - estado.actualizadoEn) / 1000;
    }

    socket.emit('cargar', {
      url: estado.url,
      tiempo: tiempoActual,
      pausado: estado.pausado
    });

    emitirUsuarios(salaActual);
  });

  socket.on('cambiar_nombre', (nuevoNombre) => {
    const estado = obtenerEstadoSala(salaActual);
    if (estado.usuarios[socket.id]) {
      estado.usuarios[socket.id].nombre = nuevoNombre || 'Invitado';
      emitirUsuarios(salaActual);
    }
  });

  socket.on('cargar', (url) => {
    const estado = obtenerEstadoSala(salaActual);
    estado.url = url;
    estado.tiempo = 0;
    estado.pausado = false;
    estado.actualizadoEn = Date.now();
    io.to(salaActual).emit('cargar', { url, tiempo: 0, pausado: false });
  });

  socket.on('play', (t) => {
    const estado = obtenerEstadoSala(salaActual);
    estado.tiempo = t;
    estado.pausado = false;
    estado.actualizadoEn = Date.now();
    socket.to(salaActual).emit('play', t);
  });

  socket.on('pause', (t) => {
    const estado = obtenerEstadoSala(salaActual);
    estado.tiempo = t;
    estado.pausado = true;
    estado.actualizadoEn = Date.now();
    socket.to(salaActual).emit('pause', t);
  });

  socket.on('seek', (t) => {
    const estado = obtenerEstadoSala(salaActual);
    estado.tiempo = t;
    estado.actualizadoEn = Date.now();
    socket.to(salaActual).emit('seek', t);
  });

  socket.on('mensaje', (data) => {
    io.to(salaActual).emit('mensaje', data);
  });

  socket.on('disconnect', () => {
    if (salaActual && salas[salaActual] && salas[salaActual].usuarios[socket.id]) {
      const eraAdmin = salas[salaActual].usuarios[socket.id].admin;
      delete salas[salaActual].usuarios[socket.id];
      const restantes = Object.keys(salas[salaActual].usuarios);
      if (eraAdmin && restantes.length > 0) {
        salas[salaActual].usuarios[restantes[0]].admin = true;
      }
      emitirUsuarios(salaActual);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Servidor listo en puerto ' + PORT));
