class Matchmaking {
  constructor() {
    this.waitingQueue = [];
    this.activeRooms = new Map();
  }

  // Add user to queue
  addUser(socket) {
    this.waitingQueue.push(socket);
  }

  // Remove user (disconnect / skip)
  removeUser(socket) {
    this.waitingQueue = this.waitingQueue.filter(
      (user) => user.id !== socket.id
    );

    // Also remove from active room if exists
    for (let [roomId, users] of this.activeRooms.entries()) {
      if (users.includes(socket.id)) {
        this.activeRooms.delete(roomId);
      }
    }
  }

  // Try matching users
  matchUsers() {
    if (this.waitingQueue.length >= 2) {
      const user1 = this.waitingQueue.shift();
      const user2 = this.waitingQueue.shift();

      const roomId = `${user1.id}#${user2.id}`;

      this.activeRooms.set(roomId, [user1.id, user2.id]);

      return { user1, user2, roomId };
    }
    return null;
  }

  // Get partner socket id
  getPartner(roomId, socketId) {
    const users = this.activeRooms.get(roomId);
    if (!users) return null;

    return users.find((id) => id !== socketId);
  }

  // Remove room (on disconnect / skip)
  removeRoom(roomId) {
    this.activeRooms.delete(roomId);
  }
}

module.exports = new Matchmaking();