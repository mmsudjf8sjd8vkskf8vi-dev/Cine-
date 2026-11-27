const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ytSearch = require('yt-search');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};
const CLAVE_VIP = 'VIP2026';

function obtenerEstadoSala(sala) {
  if (!salas[sala]) {
    salas[sala] = {
      url: '',
      cola: [],
      indiceCola: 0,
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

function extraerIdPlaylist(texto) {
  if (!texto || typeof texto !== 'string') return null;
  const match = texto.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

async function resolverCola(payload) {
  if (Array.isArray(payload?.cola) && payload.cola.length > 0) {
    return payload.cola.filter(Boolean);
  }

  const entrada = typeof payload === 'string' ? payload.trim() : (payload?.url || '').trim();
  if (!entrada) return [];

  const listId = extraerIdPlaylist(entrada);
  if (listId) {
    try {
      const resultado = await ytSearch({ listId });
      if (resultado && Array.isArray(resultado.videos) && resultado.videos.length > 0) {
        return resultado.videos
          .map(v => v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : null)
          .filter(Boolean);
      }
    } catch (err) {
      console.error('Error al cargar playlist:', err.message);
    }
  }

  return [entrada];
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
      admin: esAdmin,
      vip: esAdmin
    };

    let tiempoActual = estado.tiempo;
    if (!estado.pausado && estado.url) {
      tiempoActual += (Date.now() - estado.actualizadoEn) / 1000;
    }

    socket.emit('cargar', {
      url: estado.url,
      cola: estado.cola,
      indiceCola: estado.indiceCola,
      tiempo: tiempoActual,
      pausado: estado.pausado
    });

    emitirUsuarios(salaActual);
  });

  socket.on('activar_vip', (clave) => {
    const estado = obtenerEstadoSala(salaActual);
    if (estado.usuarios[socket.id] && clave === CLAVE_VIP) {
      estado.usuarios[socket.id].vip = true;
      emitirUsuarios(salaActual);
      socket.emit('vip_estado', { activo: true });
    } else {
      socket.emit('vip_estado', { activo: false });
    }
  });

  socket.on('expulsar_usuario', (objetivoId) => {
    const estado = obtenerEstadoSala(salaActual);
    const solicitante = estado.usuarios[socket.id];
    if (!solicitante || (!solicitante.admin && !solicitante.vip)) return;
    if (objetivoId === socket.id) return;

    const socketObjetivo = io.sockets.sockets.get(objetivoId);
    if (socketObjetivo && estado.usuarios[objetivoId]) {
      delete estado.usuarios[objetivoId];
      socketObjetivo.leave(salaActual);
      socketObjetivo.emit('expulsado');
      emitirUsuarios(salaActual);
    }
  });

  socket.on('cambiar_nombre', (nuevoNombre) => {
    const estado = obtenerEstadoSala(salaActual);
    if (estado.usuarios[socket.id]) {
      estado.usuarios[socket.id].nombre = nuevoNombre || 'Invitado';
      emitirUsuarios(salaActual);
    }
  });

  socket.on('cargar', async (payload) => {
    const estado = obtenerEstadoSala(salaActual);
    const colaResuelta = await resolverCola(payload);

    if (!colaResuelta.length) return;

    estado.cola = colaResuelta;
    estado.indiceCola = 0;
    estado.url = colaResuelta[0];
    estado.tiempo = 0;
    estado.pausado = false;
    estado.actualizadoEn = Date.now();

    io.to(salaActual).emit('cargar', {
      url: estado.url,
      cola: estado.cola,
      indiceCola: estado.indiceCola,
      tiempo: 0,
      pausado: false
    });
  });

  socket.on('siguiente_video', () => {
    const estado = obtenerEstadoSala(salaActual);
    if (estado.cola.length > estado.indiceCola + 1) {
      estado.indiceCola += 1;
      estado.url = estado.cola[estado.indiceCola];
      estado.tiempo = 0;
      estado.pausado = false;
      estado.actualizadoEn = Date.now();
      io.to(salaActual).emit('cargar', {
        url: estado.url,
        cola: estado.cola,
        indiceCola: estado.indiceCola,
        tiempo: 0,
        pausado: false
      });
    }
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
