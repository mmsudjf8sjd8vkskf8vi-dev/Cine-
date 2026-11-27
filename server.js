const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const YouTube = require('youtube-sr').default;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const VIP_KEY = 'VIP2026';

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function createRoom(roomId) {
  return {
    id: roomId,
    users: {},
    banned: new Set(),
    queue: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdate: Date.now(),
    messages: []
  };
}

function getRoom(roomId = 'general') {
  if (!rooms[roomId]) {
    rooms[roomId] = createRoom(roomId);
  }
  return rooms[roomId];
}

function getSyncedTime(room) {
  if (!room.isPlaying) return room.currentTime;
  const elapsed = (Date.now() - room.lastUpdate) / 1000;
  return room.currentTime + elapsed;
}

function getRoomState(room) {
  return {
    roomId: room.id,
    users: Object.values(room.users),
    queue: room.queue,
    currentVideo: room.currentVideo,
    isPlaying: room.isPlaying,
    currentTime: getSyncedTime(room),
    messages: room.messages.slice(-50)
  };
}

function extractPlaylistId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('list')) {
      return parsed.searchParams.get('list');
    }
  } catch {}
  if (url.includes('list=')) {
    return url.split('list=')[1].split('&')[0];
  }
  return null;
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1);
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
  } catch {}
  const match = url.match(/(?:v=|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

async function parseMediaInput(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return [];

  const playlistId = extractPlaylistId(trimmed);
  if (playlistId) {
    try {
      const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      const playlist = await YouTube.getPlaylist(playlistUrl, { fetchAll: true });
      if (playlist && Array.isArray(playlist.videos) && playlist.videos.length > 0) {
        return playlist.videos
          .filter((v) => v && v.id)
          .map((v) => ({
            id: v.id,
            title: v.title || 'Video de YouTube',
            url: `https://www.youtube.com/watch?v=${v.id}`,
            type: 'youtube'
          }));
      }
    } catch (err) {
      console.error('Error al obtener playlist completa:', err);
    }
  }

  const videoId = extractVideoId(trimmed);
  if (videoId) {
    return [{
      id: videoId,
      title: 'Video de YouTube',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      type: 'youtube'
    }];
  }

  return [{
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: trimmed.split('/').pop() || 'Video',
    url: trimmed,
    type: 'direct'
  }];
}

function playNextInQueue(room) {
  if (room.queue.length > 0) {
    room.currentVideo = room.queue.shift();
    room.currentTime = 0;
    room.isPlaying = true;
    room.lastUpdate = Date.now();
  } else {
    room.currentVideo = null;
    room.currentTime = 0;
    room.isPlaying = false;
    room.lastUpdate = Date.now();
  }
}

io.on('connection', (socket) => {
  let currentRoomId = 'general';
  const defaultNum = Math.floor(100 + Math.random() * 900);
  let userProfile = {
    id: socket.id,
    name: `Usuario_${defaultNum}`,
    isVip: false
  };

  socket.on('join_room', ({ roomId, userName } = {}) => {
    const targetRoomId = (roomId || 'general').trim() || 'general';
    const room = getRoom(targetRoomId);

    if (room.banned.has(socket.id)) {
      socket.emit('banned', { message: 'Fuiste expulsado de esta sala.' });
      return;
    }

    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].users[socket.id]) {
      socket.leave(currentRoomId);
      delete rooms[currentRoomId].users[socket.id];
      io.to(currentRoomId).emit('room_state', getRoomState(rooms[currentRoomId]));
    }

    currentRoomId = targetRoomId;
    socket.join(currentRoomId);

    if (userName && userName.trim()) {
      userProfile.name = userName.trim().slice(0, 24);
    }

    room.users[socket.id] = { ...userProfile };
    socket.emit('joined_success', { user: room.users[socket.id], roomId: currentRoomId });
    io.to(currentRoomId).emit('room_state', getRoomState(room));
  });

  socket.on('activate_vip', ({ key } = {}) => {
    const room = getRoom(currentRoomId);
    if (key === VIP_KEY) {
      userProfile.isVip = true;
      if (room.users[socket.id]) {
        room.users[socket.id].isVip = true;
      }
      socket.emit('vip_status', { isVip: true, message: 'Modo VIP activado.' });
      io.to(currentRoomId).emit('room_state', getRoomState(room));
    } else {
      socket.emit('vip_status', { isVip: false, message: 'Clave VIP incorrecta.' });
    }
  });

  socket.on('kick_user', ({ targetId } = {}) => {
    const room = getRoom(currentRoomId);
    const requester = room.users[socket.id];
    if (!requester || !requester.isVip) {
      socket.emit('error_msg', 'Solo los usuarios VIP pueden expulsar.');
      return;
    }
    if (!targetId || targetId === socket.id || !room.users[targetId]) return;

    room.banned.add(targetId);
    delete room.users[targetId];
    io.to(targetId).emit('kicked', { message: 'Has sido expulsado de la sala.' });
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.leave(currentRoomId);
    }
    io.to(currentRoomId).emit('room_state', getRoomState(room));
  });

  socket.on('add_media', async ({ input, clearQueue } = {}) => {
    const room = getRoom(currentRoomId);
    try {
      const items = await parseMediaInput(input);
      if (!items.length) {
        socket.emit('error_msg', 'No se pudo leer el enlace.');
        return;
      }
      if (clearQueue) {
        room.queue = [];
      }
      room.queue.push(...items);

      if (!room.currentVideo) {
        playNextInQueue(room);
      }

      io.to(currentRoomId).emit('room_state', getRoomState(room));
    } catch (err) {
      console.error('Error al cargar media:', err);
      socket.emit('error_msg', 'Error al procesar el enlace o la playlist.');
    }
  });

  socket.on('next_video', () => {
    const room = getRoom(currentRoomId);
    playNextInQueue(room);
    io.to(currentRoomId).emit('room_state', getRoomState(room));
  });

  socket.on('player_sync', ({ action, time } = {}) => {
    const room = getRoom(currentRoomId);
    if (typeof time === 'number' && !Number.isNaN(time)) {
      room.currentTime = Math.max(0, time);
    } else {
      room.currentTime = getSyncedTime(room);
    }
    room.lastUpdate = Date.now();

    if (action === 'play') {
      room.isPlaying = true;
    } else if (action === 'pause') {
      room.isPlaying = false;
    } else if (action === 'seek') {
      room.lastUpdate = Date.now();
    }

    socket.to(currentRoomId).emit('player_sync', {
      action,
      time: room.currentTime,
      isPlaying: room.isPlaying,
      timestamp: room.lastUpdate
    });
  });

  socket.on('chat_message', ({ text } = {}) => {
    const room = getRoom(currentRoomId);
    const cleanText = (text || '').trim().slice(0, 300);
    if (!cleanText) return;

    const sender = room.users[socket.id] || userProfile;
    const msg = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: sender.name,
      isVip: Boolean(sender.isVip),
      text: cleanText,
      time: new Date().toISOString()
    };
    room.messages.push(msg);
    if (room.messages.length > 100) {
      room.messages.shift();
    }
    io.to(currentRoomId).emit('chat_message', msg);
  });

  socket.on('disconnect', () => {
    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].users[socket.id]) {
      delete rooms[currentRoomId].users[socket.id];
      io.to(currentRoomId).emit('room_state', getRoomState(rooms[currentRoomId]));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Cine2Gether activo en puerto ${PORT}`);
});

