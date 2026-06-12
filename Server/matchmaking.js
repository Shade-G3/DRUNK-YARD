/**
 * matchmaking.js — Filter-aware matchmaking utility
 * Primary logic lives in server.js; this class is for unit testing.
 */

const MAX_ROOM_SIZE = 6;

class Matchmaking {
  constructor() {
    this.queues      = {};
    this.activeRooms = {};
  }

  static queueKey({ drink, vibe, mode }) {
    return `${drink}__${vibe}__${mode}`;
  }

  enqueue(socket) {
    const key = socket.data?.queueKey;
    if (!key) throw new Error("Socket has no queueKey set");
    if (!this.queues[key]) this.queues[key] = [];
    this.queues[key].push(socket);
  }

  dequeue(socket) {
    const key = socket.data?.queueKey;
    if (!key || !this.queues[key]) return;
    this.queues[key] = this.queues[key].filter(s => s.id !== socket.id);
    if (this.queues[key].length === 0) delete this.queues[key];
  }

  matchSolo(socket) {
    const key   = socket.data?.queueKey;
    const queue = this.queues[key];
    if (!queue || queue.length === 0) return null;

    const partner = queue.shift();
    if (queue.length === 0) delete this.queues[key];

    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.activeRooms[roomId] = { sockets: new Set([socket.id, partner.id]), mode: "solo", key };
    socket.data.roomId  = roomId;
    partner.data.roomId = roomId;
    return { partner, roomId };
  }

  matchGroup(socket) {
    const key = socket.data?.queueKey;

    for (const [roomId, room] of Object.entries(this.activeRooms)) {
      if (room.mode !== "group" || room.key !== key || room.sockets.size >= MAX_ROOM_SIZE) continue;
      const existingPeers = [...room.sockets];
      room.sockets.add(socket.id);
      socket.data.roomId = roomId;
      return { existingPeers, roomId, isNew: false };
    }

    const queue = this.queues[key];
    if (!queue || queue.length < 1) return null;

    const roomId  = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const members = [socket, ...queue.splice(0, MAX_ROOM_SIZE - 1)];
    if (queue.length === 0) delete this.queues[key];

    const memberIds = members.map(s => s.id);
    this.activeRooms[roomId] = { sockets: new Set(memberIds), mode: "group", key };
    members.forEach(s => { s.data.roomId = roomId; });
    return { members, roomId, isNew: true };
  }

  removeFromRoom(socketId, roomId) {
    const room = this.activeRooms[roomId];
    if (!room) return [];
    room.sockets.delete(socketId);
    if (room.sockets.size === 0) { delete this.activeRooms[roomId]; return []; }
    return [...room.sockets];
  }

  removeRoom(roomId) { delete this.activeRooms[roomId]; }

  getPartner(roomId, socketId) {
    const room = this.activeRooms[roomId];
    if (!room) return null;
    return [...room.sockets].find(id => id !== socketId) || null;
  }

  getQueueStats() {
    const stats = {};
    for (const [k, q] of Object.entries(this.queues)) { if (q.length) stats[k] = q.length; }
    return stats;
  }
}

module.exports = Matchmaking;
