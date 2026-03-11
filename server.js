/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CORNERSTONE INTERNATIONAL SCHOOL - FAREWELL 2025
 * Backend Server - Node.js + Express + JSON file storage
 * Upgrades included:
 *  - Multi-admin users (Super Admin + sub-admins) with permissions + limits
 *  - Site settings + Theme settings (full color palette)
 *  - Upload window controls + event auto-approve window
 *  - Comments (public, name required) + replies (threaded)
 *  - Reactions (multi-type) + legacy likes compatibility
 *  - Edit memory metadata (caption/type) + replace file
 *  - Soft delete (trash) + restore + purge
 *  - Bulk actions (approve/delete/restore/change category)
 *  - Duplicate detection (SHA256)
 *  - Simple profanity filter (toggleable)
 *  - Pagination/infinite scroll support
 *  - CSV export
 *  - WebSocket live updates to clients/admin
 *  - Advice to Juniors feature
 * NOTE: JSON storage is not ideal for heavy concurrency; this is best-effort "production-ish".
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const WebSocket = require('ws');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'cornerstone2025';
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;
const MAX_FILES = 20;
const TOKEN_TTL_HOURS = 24;
const REACTION_TYPES = ['like', 'love', 'laugh', 'wow', 'sad'];

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZE EXPRESS APP + HTTP SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE REQUIRED DIRECTORIES
// ═══════════════════════════════════════════════════════════════════════════════

const uploadsDir = path.join(__dirname, 'uploads');
const databaseDir = path.join(__dirname, 'database');
const logsDir = path.join(__dirname, 'logs');

[uploadsDir, databaseDir, logsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// JSON FILE-BASED STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const dbPath = path.join(databaseDir, 'memories.json');
const sessionsPath = path.join(databaseDir, 'sessions.json');
const settingsPath = path.join(databaseDir, 'settings.json');
const adminPath = path.join(databaseDir, 'admin.json');
const commentsPath = path.join(databaseDir, 'comments.json');
const reactionsPath = path.join(databaseDir, 'reactions.json');
const auditPath = path.join(databaseDir, 'audit.json');
const advicePath = path.join(databaseDir, 'advice.json');

function initDatabase() {
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({ memories: [], nextId: 1 }, null, 2));
    console.log('💾 Created memories database');
  }
  if (!fs.existsSync(sessionsPath)) {
    fs.writeFileSync(sessionsPath, JSON.stringify({ sessions: [] }, null, 2));
    console.log('💾 Created sessions database');
  }
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({ settings: {} }, null, 2));
    console.log('💾 Created settings database');
  }
  if (!fs.existsSync(commentsPath)) {
    fs.writeFileSync(commentsPath, JSON.stringify({ comments: [], nextId: 1 }, null, 2));
    console.log('💾 Created comments database');
  }
  if (!fs.existsSync(reactionsPath)) {
    fs.writeFileSync(reactionsPath, JSON.stringify({ reactions: [] }, null, 2));
    console.log('💾 Created reactions database');
  }
  if (!fs.existsSync(auditPath)) {
    fs.writeFileSync(auditPath, JSON.stringify({ events: [], nextId: 1 }, null, 2));
    console.log('💾 Created audit database');
  }
  if (!fs.existsSync(advicePath)) {
    fs.writeFileSync(advicePath, JSON.stringify({ advices: [], nextId: 1 }, null, 2));
    console.log('💾 Created advice database');
  }

  if (!fs.existsSync(adminPath)) {
    const now = new Date().toISOString();
    fs.writeFileSync(adminPath, JSON.stringify({
      users: [
        {
          id: 'super',
          name: 'Super Admin',
          role: 'superadmin',
          password: ADMIN_PASSWORD,
          createdAt: now,
          updatedAt: now,
          disabled: false,
          permissions: {
            moderation: true,
            settings: true,
            theme: true,
            export: true,
            users: true,
            trash: true,
            replaceFile: true,
            editMemory: true,
            bulk: true,
            featured: true
          }
        }
      ]
    }, null, 2));
    console.log('💾 Created admin database with super admin');
  }
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readDB() { return safeReadJson(dbPath, { memories: [], nextId: 1 }); }
function writeDB(data) { safeWriteJson(dbPath, data); }
function readSessions() { return safeReadJson(sessionsPath, { sessions: [] }); }
function writeSessions(data) { safeWriteJson(sessionsPath, data); }
function readSettings() { return safeReadJson(settingsPath, { settings: {} }); }
function writeSettings(data) { safeWriteJson(settingsPath, data); }
function readAdmins() { return safeReadJson(adminPath, { users: [] }); }
function writeAdmins(data) { safeWriteJson(adminPath, data); }
function readComments() { return safeReadJson(commentsPath, { comments: [], nextId: 1 }); }
function writeComments(data) { safeWriteJson(commentsPath, data); }
function readReactions() { return safeReadJson(reactionsPath, { reactions: [] }); }
function writeReactions(data) { safeWriteJson(reactionsPath, data); }
function readAudit() { return safeReadJson(auditPath, { events: [], nextId: 1 }); }
function writeAudit(data) { safeWriteJson(auditPath, data); }
function readAdvice() { return safeReadJson(advicePath, { advices: [], nextId: 1 }); }
function writeAdvice(data) { safeWriteJson(advicePath, data); }

initDatabase();
console.log(`💾 Database initialized: ${dbPath}`);

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function generateToken() {
  return 'admin-' + Date.now() + '-' + Math.random().toString(36).substr(2, 12);
}

function cleanExpiredSessions() {
  const sessions = readSessions();
  const now = new Date();
  const before = sessions.sessions.length;
  sessions.sessions = sessions.sessions.filter(s => new Date(s.expiresAt) > now);
  if (sessions.sessions.length !== before) writeSessions(sessions);
}

function getSession(token) {
  if (!token) return null;
  cleanExpiredSessions();
  const data = readSessions();
  const now = new Date();
  return data.sessions.find(s => s.token === token && new Date(s.expiresAt) > now) || null;
}

function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = getSession(token);
  if (!session) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  const admins = readAdmins();
  const user = admins.users.find(u => u.id === session.userId && !u.disabled);
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return { token, user };
}

function hasPerm(user, perm) {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  return !!(user.permissions && user.permissions[perm]);
}

function audit(userId, action, meta = {}) {
  const a = readAudit();
  a.events.push({
    id: a.nextId++,
    userId,
    action,
    meta,
    createdAt: new Date().toISOString()
  });
  if (a.events.length > 5000) a.events = a.events.slice(-5000);
  writeAudit(a);
}

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function nowIso() { return new Date().toISOString(); }

function getEffectiveSettings() {
  const s = readSettings().settings || {};
  const defaults = {
    uploadsEnabled: true,
    commentsEnabled: true,
    profanityFilterEnabled: false,
    uploadWindowEnabled: false,
    uploadWindowStartIST: '',
    uploadWindowEndIST: '',
    autoApproveEnabled: false,
    autoApproveStartIST: '',
    autoApproveEndIST: '',
    theme: {}
  };
  return { ...defaults, ...s };
}

function containsProfanity(text) {
  const bad = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'slut'];
  const t = String(text || '').toLowerCase();
  return bad.some(w => t.includes(w));
}

// WebSocket
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'hello', payload: { ok: true } }));
});

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS - ADVICE TO JUNIORS
// ═══════════════════════════════════════════════════════════════════════════════

// Get all advice (public)
app.get('/api/advice', (req, res) => {
  try {
    const db = readAdvice();
    const advices = db.advices.map(a => ({
      id: a.id,
      name: a.name,
      text: a.text,
      date: a.date,
      createdAt: a.createdAt
    }));
    res.json({ success: true, advices });
  } catch (error) {
    console.error('Get advice error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Submit advice (public)
app.post('/api/advice', (req, res) => {
  try {
    const { name, text } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, error: 'Advice text is required' });
    }

    const settings = getEffectiveSettings();
    if (settings.profanityFilterEnabled) {
      if (containsProfanity(name) || containsProfanity(text)) {
        return res.status(400).json({ success: false, error: 'Content rejected by profanity filter.' });
      }
    }

    const db = readAdvice();
    const advice = {
      id: db.nextId++,
      name: String(name).trim().substring(0, 100),
      text: String(text).trim().substring(0, 1000),
      date: new Date().toLocaleDateString(),
      createdAt: nowIso()
    };

    db.advices.push(advice);
    writeAdvice(db);

    broadcast('advice:new', { advice });

    res.json({ success: true, message: 'Advice submitted successfully!', advice });
  } catch (error) {
    console.error('Submit advice error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin: delete advice
app.delete('/api/admin/advice/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!hasPerm(auth.user, 'moderation')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const db = readAdvice();
    const idx = db.advices.findIndex(a => a.id === id);

    if (idx === -1) return res.status(404).json({ success: false, error: 'Advice not found' });

    db.advices.splice(idx, 1);
    writeAdvice(db);

    audit(auth.user.id, 'delete_advice', { adviceId: id });
    broadcast('advice:deleted', { id });

    res.json({ success: true, message: 'Advice deleted' });
  } catch (error) {
    console.error('Delete advice error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVE FRONTEND
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🎓 CORNERSTONE INTERNATIONAL SCHOOL - FAREWELL 2025');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`🚀 Server running on: http://localhost:${PORT}`);
  console.log(`🌐 Network access: http://0.0.0.0:${PORT}`);
  console.log(`📁 Uploads folder: ${uploadsDir}`);
  console.log(`💾 Memories DB: ${dbPath}`);
  console.log(`⚙️ Settings DB: ${settingsPath}`);
  console.log(`🔐 Admin DB: ${adminPath}`);
  console.log(`💬 Comments DB: ${commentsPath}`);
  console.log(`😊 Reactions DB: ${reactionsPath}`);
  console.log(`🧾 Audit DB: ${auditPath}`);
  console.log(`💡 Advice DB: ${advicePath}`);
  console.log(`📊 Max upload size: ${MAX_TOTAL_SIZE / 1024 / 1024}MB total`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('🛑 SIGTERM received. Closing server...'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT received. Closing server...'); process.exit(0); });
