// ============================================================
//  AUTH MIDDLEWARE — JWT Token Verification
// ============================================================

const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

/**
 * Generate a JWT token for a user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT token from cookie or Authorization header
 */
function authenticate(req, res, next) {
  // Try cookie first, then Authorization header
  let token = req.cookies?.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Extract user from socket handshake (for Socket.io)
 */
function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.cookie?.split('token=')[1]?.split(';')[0];

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
}

module.exports = { generateToken, authenticate, authenticateSocket };
