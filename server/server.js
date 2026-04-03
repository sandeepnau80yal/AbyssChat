import express from 'express';
import http from 'http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Constants
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://abyss-chat.vercel.app"
];

const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const MAX_MESSAGE_LENGTH = 20000;
const MAX_ROOM_MESSAGES = 50; // Keep last 50 messages per room

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
};

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS
});

app.use(limiter);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ["GET", "POST"]
  },
  connectionStateRecovery: {}
});

// Room management - now includes message history, encryption status, and room passwords
const rooms = new Map(); // { roomId: { users: Map, messages: Array, isEncrypted: boolean, passwordHash: string, passwordSalt: string, creator: string } }
const userRooms = new Map();

const userColors = [
  '#FF5733', '#33FF57', '#3357FF', '#FF33EE', '#FFBD33',
  '#33FFEE', '#EE33FF', '#80FF33', '#3380FF', '#FF3380'
];

// Helper functions
const generateUniqueId = () => Math.random().toString(36).substring(2, 6);

const sanitizeMessage = (msg) => {
  let cleanedMsg = msg.trim();
  if (!cleanedMsg) return '';
  if (cleanedMsg.length > MAX_MESSAGE_LENGTH) {
    cleanedMsg = cleanedMsg.substring(0, MAX_MESSAGE_LENGTH);
  }

  cleanedMsg = cleanedMsg
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  if (cleanedMsg.startsWith('&amp;&amp;&amp;') && cleanedMsg.endsWith('&amp;&amp;&amp;')) {
    cleanedMsg = cleanedMsg
      .replace(/&lt;s(?:cript|tyle).*?&gt;.*?&lt;\/(?:script|style).*?&gt;/gim, '')
      .replace(/&lt;img.*?&gt;/gim, '')
      .replace(/&lt;iframe.*?&gt;.*?&lt;\/iframe.*?&gt;/gim, '');
  }

  return cleanedMsg;
};

// Validation for encrypted message data
const isValidEncryptedMessage = (msgData) => {
  return (
    msgData &&
    typeof msgData === 'object' &&
    Array.isArray(msgData.encrypted) &&
    Array.isArray(msgData.iv) &&
    msgData.encrypted.length > 0 &&
    msgData.iv.length === 12 // AES-GCM IV should be 12 bytes
  );
};

const getRoomData = (room) => {
  if (!rooms.has(room)) {
    rooms.set(room, { 
      users: new Map(), 
      messages: [], 
      isEncrypted: true, // All rooms are encrypted by default now
      passwordHash: null,
      passwordSalt: null,
      creator: null      // Will be set when room is created
    });
  }
  return rooms.get(room);
};

const getRoomUsers = (room) => getRoomData(room).users;
const getRoomMessages = (room) => getRoomData(room).messages;
const isRoomEncrypted = (room) => getRoomData(room).isEncrypted;
const setRoomEncrypted = (room) => {
  const roomData = getRoomData(room);
  roomData.isEncrypted = true;
};

// NEW: Room password management functions
const setRoomPassword = (room, password, creator) => {
  const roomData = getRoomData(room);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  roomData.passwordSalt = salt;
  roomData.passwordHash = hash;
  roomData.creator = creator;
  roomData.isEncrypted = true; // Ensure encryption is enabled
};

const validateRoomPassword = (room, password) => {
  const roomData = rooms.get(room);
  if (!roomData) return false;
  if (!roomData.passwordSalt || !roomData.passwordHash) return false;

  const providedHash = crypto.scryptSync(password || '', roomData.passwordSalt, 64).toString('hex');
  const expectedHashBuffer = Buffer.from(roomData.passwordHash, 'hex');
  const providedHashBuffer = Buffer.from(providedHash, 'hex');

  if (expectedHashBuffer.length !== providedHashBuffer.length) return false;
  return crypto.timingSafeEqual(expectedHashBuffer, providedHashBuffer);
};

const addMessageToRoom = (room, message) => {
  const roomData = getRoomData(room);
  roomData.messages.push(message);
  
  // Keep only the last MAX_ROOM_MESSAGES
  if (roomData.messages.length > MAX_ROOM_MESSAGES) {
    roomData.messages = roomData.messages.slice(-MAX_ROOM_MESSAGES);
  }
};

const updateUserCount = (room) => {
  const users = getRoomUsers(room);
  io.to(room).emit('userCount', users.size);
};

const cleanupRoom = (room) => {
  const roomData = getRoomData(room);
  if (roomData.users.size === 0) {
    rooms.delete(room);
    console.log(`Room ${room} deleted - no users remaining`);
  }
};

const getCurrentTimestamp = () => new Date().toLocaleTimeString();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  const handleRoomOperations = (room, username, password, action) => {
    try {
      // Leave previous room if any
      const previousRoom = userRooms.get(socket.id);
      if (previousRoom) {
        socket.leave(previousRoom);
        const prevUsers = getRoomUsers(previousRoom);
        prevUsers.delete(socket.id);
        updateUserCount(previousRoom);
        cleanupRoom(previousRoom);
      }

      if (action === 'join') {
        // Check if room exists and if password is required
        const roomExists = rooms.has(room);
        
        if (roomExists) {
          // Room exists - validate password
          if (!validateRoomPassword(room, password)) {
            socket.emit('error', 'Incorrect room password');
            return;
          }
        } else {
          // Room doesn't exist - user is creating it
          if (!password || password.trim().length === 0) {
            socket.emit('error', 'Password required to create room');
            return;
          }
          // Create room with password
          setRoomPassword(room, password.trim(), username);
          console.log(`New room ${room} created by ${username} with password protection`);
        }

        socket.join(room);

        const roomUsers = getRoomUsers(room);
        const userColor = userColors[Math.floor(Math.random() * userColors.length)];
        const uniqueId = generateUniqueId();

        roomUsers.set(socket.id, {
          username,
          color: userColor,
          uniqueId,
          isTyping: false
        });

        userRooms.set(socket.id, room);

        // Send recent message history to the new user
        const recentMessages = getRoomMessages(room);
        if (recentMessages.length > 0) {
          // Send last 20 messages to new user
          const messagesToSend = recentMessages.slice(-20);
          messagesToSend.forEach(msg => {
            socket.emit('message', msg);
          });
        }

        // Notify client that room is encrypted (all rooms are now encrypted)
        socket.emit('roomEncrypted');

        // Notify others about new user
        const joinMessage = {
          user: 'System',
          text: sanitizeMessage(`${username} joined the room`),
          timestamp: getCurrentTimestamp(),
          isEncrypted: false
        };

        socket.to(room).emit('message', joinMessage);
        addMessageToRoom(room, joinMessage);

        updateUserCount(room);
        
        console.log(`${username} (ID: ${uniqueId}) joined room ${room} with color ${userColor}`);
        
        // Send success confirmation to the user - MUST be after all setup
        socket.emit('joinSuccess', { 
          room, 
          isCreator: !roomExists,
          message: roomExists ? 'Joined room successfully' : 'Room created successfully'
        });
      }
    } catch (error) {
      console.error(`Error during ${action} room operation:`, error);
      socket.emit('error', `Failed to ${action} room`);
    }
  };

  // UPDATED: Now requires password
  socket.on('joinRoom', ({ room, username, password }) => {
    handleRoomOperations(room, username, password, 'join');
  });

  // Handle both encrypted and plain text messages (unchanged)
  socket.on('sendMessage', (msgData) => {
    try {
      const room = userRooms.get(socket.id);
      if (!room) return;

      const roomUsers = getRoomUsers(room);
      const user = roomUsers.get(socket.id);
      if (!user) return;

      let messageToSend;

      // Check if this is an encrypted message
      if (isValidEncryptedMessage(msgData)) {
        // Handle encrypted message - forward encrypted data as-is
        messageToSend = {
          user: user.username,
          encrypted: msgData.encrypted,
          iv: msgData.iv,
          color: user.color,
          uniqueId: user.uniqueId,
          timestamp: getCurrentTimestamp(),
          isEncrypted: true
        };

        console.log(`Encrypted message from ${user.username} in room ${room}`);
      } else {
        // Handle plain text message (backward compatibility)
        const plainTextMsg = typeof msgData === 'string' ? msgData : '';
        const sanitizedMsg = sanitizeMessage(plainTextMsg);
        
        if (!sanitizedMsg.trim()) return;

        messageToSend = {
          user: user.username,
          text: sanitizedMsg,
          color: user.color,
          uniqueId: user.uniqueId,
          timestamp: getCurrentTimestamp(),
          isEncrypted: false
        };

        console.log(`Plain text message from ${user.username} in room ${room}: ${sanitizedMsg.substring(0, 50)}...`);
      }

      // Broadcast message to all users in the room
      io.to(room).emit('message', messageToSend);
      
      // Store message in room history
      addMessageToRoom(room, messageToSend);

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', 'Failed to send message');
    }
  });

  const handleTyping = (typingState) => {
    try {
      const room = userRooms.get(socket.id);
      if (!room) return;

      const roomUsers = getRoomUsers(room);
      const user = roomUsers.get(socket.id);
      if (!user || user.isTyping === typingState) return;

      user.isTyping = typingState;
      socket.to(room).emit('userTyping', {
        user: user.username,
        isTyping: typingState,
        uniqueId: user.uniqueId
      });
    } catch (error) {
      console.error(`Error handling ${typingState ? 'start' : 'stop'} typing:`, error);
    }
  };

  socket.on('startTyping', () => handleTyping(true));
  socket.on('stopTyping', () => handleTyping(false));

  socket.on('disconnect', () => {
    try {
      const room = userRooms.get(socket.id);
      if (room) {
        const roomUsers = getRoomUsers(room);
        const user = roomUsers.get(socket.id);

        if (user) {
          const leaveMessage = {
            user: 'System',
            text: sanitizeMessage(`${user.username} left the room`),
            timestamp: getCurrentTimestamp(),
            isEncrypted: false
          };

          socket.to(room).emit('message', leaveMessage);
          addMessageToRoom(room, leaveMessage);

          roomUsers.delete(socket.id);
          updateUserCount(room);
          cleanupRoom(room); // This will delete room AND messages when empty
        }

        userRooms.delete(socket.id);
      }

      console.log(`User disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket server running on port ${PORT}`);
});