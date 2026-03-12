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

// This is ONLY used on first run to create super admin in database/admin.json.
// After that, the password stored in admin.json is used.
const ADMIN_PASSWORD = 'cornerstone2025'; // ⚠️ CHANGE THIS IN PRODUCTION!

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB total per upload
const MAX_FILES = 20; // Maximum files per upload

const TOKEN_TTL_HOURS = 24;

// Reactions supported
const REACTION_TYPES = ['like', 'love', 'laugh', 'wow', 'sad'];

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZE EXPRESS APP + HTTP SERVER (for WebSocket)
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
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
const studentDirectoryPath = path.join(databaseDir, 'student_directory.json');
const superlativeVotesPath = path.join(databaseDir, 'superlative_votes.json');
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

  // Admin users database:
  //  - creates super admin from ADMIN_PASSWORD
  //  - you can create other users in admin panel
  if (!fs.existsSync(studentDirectoryPath)) {
  fs.writeFileSync(studentDirectoryPath, JSON.stringify({ students: [] }, null, 2));
  console.log(' Created student directory database');
 }
 if (!fs.existsSync(superlativeVotesPath)) {
  fs.writeFileSync(superlativeVotesPath, JSON.stringify({ votes: [] }, null, 2));
  console.log(' Created superlative votes database');
 }
 if (!fs.existsSync(adminPath)) {
    const now = new Date().toISOString();
    fs.writeFileSync(adminPath, JSON.stringify({
      users: [
        {
          id: 'super',
          name: 'Super Admin',
          role: 'superadmin',
          password: ADMIN_PASSWORD, // plaintext for now (requested keep simple JSON). Strongly recommend hashing in real prod.
          createdAt: now,
          updatedAt: now,
          disabled: false,
          // permissions: superadmin ignores these and has everything.
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

function readDB() {
  return safeReadJson(dbPath, { memories: [], nextId: 1 });
}
function writeDB(data) {
  safeWriteJson(dbPath, data);
}

function readSessions() {
  return safeReadJson(sessionsPath, { sessions: [] });
}
function writeSessions(data) {
  safeWriteJson(sessionsPath, data);
}

function readSettings() {
  return safeReadJson(settingsPath, { settings: {} });
}
function writeSettings(data) {
  safeWriteJson(settingsPath, data);
}

function readAdmins() {
  return safeReadJson(adminPath, { users: [] });
}
function writeAdmins(data) {
  safeWriteJson(adminPath, data);
}

function readComments() {
  return safeReadJson(commentsPath, { comments: [], nextId: 1 });
}
function writeComments(data) {
  safeWriteJson(commentsPath, data);
}

function readReactions() {
  return safeReadJson(reactionsPath, { reactions: [] });
}
function writeReactions(data) {
  safeWriteJson(reactionsPath, data);
}

function readAudit() {
  return safeReadJson(auditPath, { events: [], nextId: 1 });
}
function writeAudit(data) {
  safeWriteJson(auditPath, data);
}

initDatabase();
console.log(`💾 Database initialized: ${dbPath}`);

// ═══════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD CONFIGURATION (MULTER)
// ═══════════════════════════════════════════════════════════════════════════════

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 50);
    cb(null, `${uniqueSuffix}-${safeName}${ext && safeName.endsWith(ext) ? '' : ''}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
  const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error(`Invalid file type: ${file.mimetype}`), false);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter
});

const checkTotalSize = (req, res, next) => {
  if (req.files && req.files.length > 0) {
    const totalSize = req.files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      req.files.forEach(file => {
        const filePath = path.join(uploadsDir, file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
      return res.status(400).json({
        success: false,
        error: `Total upload size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit`
      });
    }
  }
  next();
};

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

function validateAdminToken(token) {
  if (!token) return false;
  cleanExpiredSessions();
  const data = readSessions();
  const now = new Date();
  const session = data.sessions.find(s => s.token === token && new Date(s.expiresAt) > now);
  return !!session;
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
  // keep audit bounded
  if (a.events.length > 5000) a.events = a.events.slice(-5000);
  writeAudit(a);
}

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, payload });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'unknown';
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

// settings toggles / windows
function getEffectiveSettings() {
  const s = readSettings().settings || {};
  const defaults = {
    uploadsEnabled: true,
    commentsEnabled: true,
    profanityFilterEnabled: false,

    // Upload window: if enabled, uploads only allowed between start/end (IST local string)
    uploadWindowEnabled: false,
    uploadWindowStartIST: '',
    uploadWindowEndIST: '',

    // Auto-approve window: if enabled, memories auto-approved within window
    autoApproveEnabled: false,
    autoApproveStartIST: '',
    autoApproveEndIST: '',

    // Theme object stored here too
    theme: {}
  };
  return { ...defaults, ...s };
}

// IST local "YYYY-MM-DDTHH:mm" -> Date object in UTC
function parseISTLocalToDate(istLocal) {
  if (!istLocal || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(istLocal)) return null;
  const [datePart, timePart] = istLocal.split('T');
  const [Y, M, D] = datePart.split('-').map(Number);
  const [h, m] = timePart.split(':').map(Number);
  const utcMs = Date.UTC(Y, M - 1, D, h - 5, m - 30, 0);
  return new Date(utcMs);
}

function isNowWithinISTWindow(startIST, endIST) {
  const start = parseISTLocalToDate(startIST);
  const end = parseISTLocalToDate(endIST);
  if (!start || !end) return false;
  const now = new Date();
  return now >= start && now <= end;
}

function containsProfanity(text) {
  // Simple filter; you can expand this list.
  const bad = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'slut'];
  const t = String(text || '').toLowerCase();
  return bad.some(w => t.includes(w));
}

function sanitizeCsvCell(v) {
  const s = String(v ?? '');
  // protect against CSV injection in Excel
  if (/^[=\-+@]/.test(s)) return `'${s}`;
  return s.replaceAll('"', '""');
}

function memoryPublicShape(m) {
  return {
    ...m,
    file_url: `/uploads/${m.file_path}`,
    file_size_formatted: formatFileSize(m.file_size || 0)
  };
}

function getReactionCountsForMemory(memoryId) {
  const rx = readReactions();
  const items = rx.reactions.filter(r => r.memoryId === memoryId);
  const counts = {};
  for (const t of REACTION_TYPES) counts[t] = 0;
  for (const r of items) {
    if (counts[r.type] !== undefined) counts[r.type]++;
  }
  return counts;
}

function getCommentTree(memoryId) {
  const cdb = readComments();
  const all = cdb.comments
    .filter(c => c.memoryId === memoryId && !c.deletedAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const byId = new Map();
  all.forEach(c => byId.set(c.id, { ...c, replies: [] }));

  const roots = [];
  for (const c of byId.values()) {
    if (c.parentId) {
      const p = byId.get(c.parentId);
      if (p) p.replies.push(c);
      else roots.push(c);
    } else roots.push(c);
  }
  return roots;
}

// WebSocket basic: clients just connect and listen to broadcasts
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'hello', payload: { ok: true } }));
});
// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS - PUBLIC
// ═══════════════════════════════════════════════════════════════════════════════

// Get Site Settings (public)
app.get('/api/settings', (req, res) => {
  try {
    const data = readSettings();
    res.json({ success: true, settings: data.settings || {} });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload Memory (with window control + auto-approve + profanity filter + duplicate detection)
app.post('/api/upload', upload.array('files', MAX_FILES), checkTotalSize, (req, res) => {
  try {
    const { name, caption, type } = req.body;
    const files = req.files;

    const settings = getEffectiveSettings();

    if (!settings.uploadsEnabled) {
      return res.status(403).json({ success: false, error: 'Uploads are currently disabled.' });
    }

    if (settings.uploadWindowEnabled) {
      const ok = isNowWithinISTWindow(settings.uploadWindowStartIST, settings.uploadWindowEndIST);
      if (!ok) return res.status(403).json({ success: false, error: 'Uploads are currently closed (outside upload window).' });
    }

    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Student name is required' });
    if (!caption || !caption.trim()) return res.status(400).json({ success: false, error: 'Caption is required' });
    if (!type) return res.status(400).json({ success: false, error: 'Memory type is required' });
    if (!files || files.length === 0) return res.status(400).json({ success: false, error: 'Please select at least one file' });

    if (settings.profanityFilterEnabled) {
      if (containsProfanity(name) || containsProfanity(caption) || containsProfanity(type)) {
        // clean uploaded files
        files.forEach(file => {
          const fp = path.join(uploadsDir, file.filename);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        });
        return res.status(400).json({ success: false, error: 'Content rejected by profanity filter.' });
      }
    }

    const db = readDB();
    const insertedIds = [];
    const duplicates = [];

    const autoApproveNow = settings.autoApproveEnabled
      ? isNowWithinISTWindow(settings.autoApproveStartIST, settings.autoApproveEndIST)
      : false;

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file.filename);
      const hash = sha256File(filePath);

      // duplicate detection by hash against existing memories (any status except hard deleted)
      const exists = db.memories.find(m => m.sha256 === hash && !m.purgedAt);
      if (exists) {
        duplicates.push({ originalId: exists.id, duplicateFile: file.originalname });
        // delete dup file from disk
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      }

      const memory = {
        id: db.nextId++,
        student_name: name.trim(),
        caption: caption.trim().substring(0, 1000),
        memory_type: type,
        file_path: file.filename,
        file_name: file.originalname,
        file_type: getFileType(file.mimetype),
        file_size: file.size,
        sha256: hash,

        // moderation
        approved: autoApproveNow ? 1 : 0,
        featured: 0,

        // reactions/likes
        likes: 0, // legacy compatibility

        // soft delete
        deletedAt: null,
        purgedAt: null,

        created_at: nowIso(),
        updated_at: nowIso()
      };

      db.memories.push(memory);
      insertedIds.push(memory.id);
    });

    writeDB(db);

    if (insertedIds.length === 0 && duplicates.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate upload detected (all files were duplicates).',
        duplicates
      });
    }

    console.log(`📤 New upload: ${insertedIds.length} file(s) from "${name}" (duplicates skipped: ${duplicates.length})`);
    broadcast('memory:new', { count: insertedIds.length });

    res.json({
      success: true,
      message: `Successfully uploaded ${insertedIds.length} memory${insertedIds.length > 1 ? 'ies' : ''}!`,
      count: insertedIds.length,
      ids: insertedIds,
      duplicates
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Approved Memories (pagination + featured first)
app.get('/api/memories', (req, res) => {
  try {
    const db = readDB();

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const type = req.query.type || 'all';
    const cursor = req.query.cursor ? new Date(req.query.cursor) : null; // optional

    let memories = db.memories
      .filter(m => m.approved === 1 && !m.deletedAt && !m.purgedAt);

    if (type !== 'all') memories = memories.filter(m => m.memory_type === type);

    // cursor-based: only older than cursor
    if (cursor) memories = memories.filter(m => new Date(m.created_at) < cursor);

    // featured first, then newest
    memories.sort((a, b) => {
      if ((b.featured || 0) !== (a.featured || 0)) return (b.featured || 0) - (a.featured || 0);
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const total = memories.length;
    const start = (page - 1) * limit;
    const items = memories.slice(start, start + limit).map(m => {
      const shaped = memoryPublicShape(m);
      shaped.reactions = getReactionCountsForMemory(m.id);
      return shaped;
    });

    const nextCursor = items.length ? items[items.length - 1].created_at : null;

    res.json({
      success: true,
      memories: items,
      page,
      limit,
      total,
      nextCursor,
      hasMore: start + limit < total
    });
  } catch (error) {
    console.error('Get memories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy Like Memory (kept) + also increments reaction "like"
app.post('/api/like/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const db = readDB();

    const memory = db.memories.find(m => m.id === id && m.approved === 1 && !m.deletedAt && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    memory.likes = (memory.likes || 0) + 1;
    memory.updated_at = nowIso();
    writeDB(db);

    // also store as reaction event (anonymous)
    const rx = readReactions();
    rx.reactions.push({ memoryId: id, type: 'like', createdAt: nowIso() });
    writeReactions(rx);

    broadcast('reaction:update', { memoryId: id });

    res.json({ success: true, likes: memory.likes, reactions: getReactionCountsForMemory(id) });
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reactions: add one reaction (anonymous, no auth)
app.post('/api/reactions/:memoryId', (req, res) => {
  try {
    const memoryId = parseInt(req.params.memoryId, 10);
    const { type } = req.body || {};
    if (!REACTION_TYPES.includes(type)) return res.status(400).json({ success: false, error: 'Invalid reaction type' });

    const db = readDB();
    const memory = db.memories.find(m => m.id === memoryId && m.approved === 1 && !m.deletedAt && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    const rx = readReactions();
    rx.reactions.push({ memoryId, type, createdAt: nowIso() });
    writeReactions(rx);

    broadcast('reaction:update', { memoryId });

    res.json({ success: true, reactions: getReactionCountsForMemory(memoryId) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Comments: list comment tree for a memory (public)
app.get('/api/comments/:memoryId', (req, res) => {
  try {
    const settings = getEffectiveSettings();
    if (!settings.commentsEnabled) {
      return res.json({ success: true, comments: [], disabled: true });
    }

    const memoryId = parseInt(req.params.memoryId, 10);
    const db = readDB();
    const memory = db.memories.find(m => m.id === memoryId && m.approved === 1 && !m.deletedAt && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    res.json({ success: true, comments: getCommentTree(memoryId), disabled: false });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Comments: create comment or reply (public; requires name)
app.post('/api/comments/:memoryId', (req, res) => {
  try {
    const settings = getEffectiveSettings();
    if (!settings.commentsEnabled) {
      return res.status(403).json({ success: false, error: 'Comments are disabled.' });
    }

    const memoryId = parseInt(req.params.memoryId, 10);
    const { name, text, parentId } = req.body || {};

    if (!name || !String(name).trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    if (!text || !String(text).trim()) return res.status(400).json({ success: false, error: 'Comment text is required' });

    if (settings.profanityFilterEnabled) {
      if (containsProfanity(name) || containsProfanity(text)) {
        return res.status(400).json({ success: false, error: 'Comment rejected by profanity filter.' });
      }
    }

    const db = readDB();
    const memory = db.memories.find(m => m.id === memoryId && m.approved === 1 && !m.deletedAt && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    const cdb = readComments();

    // parent must exist and belong to same memory
    if (parentId) {
      const p = cdb.comments.find(c => c.id === Number(parentId) && c.memoryId === memoryId && !c.deletedAt);
      if (!p) return res.status(400).json({ success: false, error: 'Invalid parentId' });
    }

    const comment = {
      id: cdb.nextId++,
      memoryId,
      parentId: parentId ? Number(parentId) : null,
      name: String(name).trim().substring(0, 60),
      text: String(text).trim().substring(0, 800),
      createdAt: nowIso(),
      deletedAt: null
    };

    cdb.comments.push(comment);
    writeComments(cdb);

    broadcast('comment:new', { memoryId });

    res.json({ success: true, comment });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get Stats (public)
app.get('/api/stats', (req, res) => {
  try {
    const db = readDB();
    const approved = db.memories.filter(m => m.approved === 1 && !m.deletedAt && !m.purgedAt);
    const totalLikes = approved.reduce((sum, m) => sum + (m.likes || 0), 0);

    res.json({
      success: true,
      stats: { totalMemories: approved.length, totalLikes }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS - ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

// Admin login with userId + password
app.post('/api/admin/login', (req, res) => {
  try {
    const { userId, password } = req.body || {};
    const uid = String(userId || '').trim() || 'super'; // allow legacy login with just password by using super
    const pwd = String(password || '').trim();

    const admins = readAdmins();
    const user = admins.users.find(u => u.id === uid);

    if (!user || user.disabled) {
      console.log('❌ Failed admin login (no user)');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (pwd !== user.password) {
      console.log('❌ Failed admin login (bad password)');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const sessions = readSessions();
    sessions.sessions = sessions.sessions.filter(s => new Date(s.expiresAt) > new Date());
    sessions.sessions.push({ token, expiresAt: expiresAt.toISOString(), userId: user.id });
    writeSessions(sessions);

    audit(user.id, 'login', {});

    res.json({ success: true, token, expiresAt: expiresAt.toISOString(), user: { id: user.id, name: user.name, role: user.role, permissions: user.permissions } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Verify token
app.post('/api/admin/verify', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = getSession(token);
    if (!session) return res.json({ success: true, valid: false });

    const admins = readAdmins();
    const user = admins.users.find(u => u.id === session.userId && !u.disabled);
    if (!user) return res.json({ success: true, valid: false });

    res.json({ success: true, valid: true, user: { id: user.id, name: user.name, role: user.role, permissions: user.permissions } });
  } catch {
    res.json({ success: true, valid: false });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const sessions = readSessions();
      sessions.sessions = sessions.sessions.filter(s => s.token !== token);
      writeSessions(sessions);
    }
    res.json({ success: true, message: 'Logged out' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get All Memories (Admin) + includes soft deleted optionally + pagination
app.get('/api/admin/memories', (req, res) => {
  try {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    if (!hasPerm(auth.user, 'moderation')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { filter, sort, search, includeDeleted } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || '30', 10)));

    const db = readDB();
    let memories = [...db.memories];

    // exclude purged always
    memories = memories.filter(m => !m.purgedAt);

    if (includeDeleted !== 'true') {
      memories = memories.filter(m => !m.deletedAt);
    }

    if (filter === 'approved') memories = memories.filter(m => m.approved === 1);
    else if (filter === 'pending') memories = memories.filter(m => m.approved === 0);
    else if (filter === 'featured') memories = memories.filter(m => (m.featured || 0) === 1);
    else if (filter === 'trash') memories = memories.filter(m => !!m.deletedAt);

    if (search) {
      const s = String(search).toLowerCase();
      memories = memories.filter(m =>
        String(m.student_name || '').toLowerCase().includes(s) ||
        String(m.caption || '').toLowerCase().includes(s) ||
        String(m.memory_type || '').toLowerCase().includes(s)
      );
    }

    if (sort === 'oldest') memories.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sort === 'likes') memories.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const allMemories = db.memories.filter(m => !m.purgedAt);
    const stats = {
      total: allMemories.filter(m => !m.deletedAt).length,
      approved: allMemories.filter(m => m.approved === 1 && !m.deletedAt).length,
      pending: allMemories.filter(m => m.approved === 0 && !m.deletedAt).length,
      trash: allMemories.filter(m => !!m.deletedAt).length,
      totalSize: allMemories.filter(m => !m.deletedAt).reduce((sum, m) => sum + (m.file_size || 0), 0),
      totalSizeFormatted: formatFileSize(allMemories.filter(m => !m.deletedAt).reduce((sum, m) => sum + (m.file_size || 0), 0))
    };

    const start = (page - 1) * limit;
    const pageItems = memories.slice(start, start + limit).map(m => {
      const shaped = memoryPublicShape(m);
      shaped.reactions = getReactionCountsForMemory(m.id);
      shaped.commentCount = readComments().comments.filter(c => c.memoryId === m.id && !c.deletedAt).length;
      return shaped;
    });

    res.json({ success: true, memories: pageItems, stats, page, limit, total: memories.length, hasMore: start + limit < memories.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Approve Memory
app.post('/api/admin/approve/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'moderation')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const db = readDB();
    const memory = db.memories.find(m => m.id === id && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    memory.approved = 1;
    memory.updated_at = nowIso();
    writeDB(db);

    audit(auth.user.id, 'approve', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, message: 'Memory approved' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Approve All Pending
app.post('/api/admin/approve-all', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'bulk')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const db = readDB();
    let count = 0;
    db.memories.forEach(m => {
      if (m.approved === 0 && !m.deletedAt && !m.purgedAt) { m.approved = 1; m.updated_at = nowIso(); count++; }
    });
    writeDB(db);

    audit(auth.user.id, 'approve-all', { count });
    broadcast('memory:bulk', { type: 'approve', count });

    res.json({ success: true, message: `Approved ${count} memories`, count });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Soft Delete Memory (moves to trash)
app.delete('/api/admin/delete/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'trash')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const db = readDB();
    const memory = db.memories.find(m => m.id === id && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    memory.deletedAt = nowIso();
    memory.updated_at = nowIso();
    writeDB(db);

    audit(auth.user.id, 'trash', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, message: 'Memory moved to trash' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Restore from Trash
app.post('/api/admin/restore/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'trash')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const db = readDB();
    const memory = db.memories.find(m => m.id === id && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    memory.deletedAt = null;
    memory.updated_at = nowIso();
    writeDB(db);

    audit(auth.user.id, 'restore', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, message: 'Restored' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Purge (hard delete file + record)
app.delete('/api/admin/purge/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (auth.user.role !== 'superadmin') return res.status(403).json({ success: false, error: 'Super admin only' });

    const id = parseInt(req.params.id, 10);
    const db = readDB();
    const memory = db.memories.find(m => m.id === id && !m.purgedAt);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

    const fp = path.join(uploadsDir, memory.file_path);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);

    memory.purgedAt = nowIso();
    memory.updated_at = nowIso();
    writeDB(db);

    audit(auth.user.id, 'purge', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, message: 'Purged permanently' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Bulk category change (26) + bulk trash/restore/approve
app.post('/api/admin/bulk', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'bulk')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const { action, ids, memoryType } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'ids required' });

    const db = readDB();
    const set = new Set(ids.map(x => Number(x)));
    let changed = 0;

    for (const m of db.memories) {
      if (!set.has(m.id) || m.purgedAt) continue;

      if (action === 'approve') {
        if (!m.deletedAt && m.approved === 0) { m.approved = 1; m.updated_at = nowIso(); changed++; }
      } else if (action === 'trash') {
        if (!m.deletedAt) { m.deletedAt = nowIso(); m.updated_at = nowIso(); changed++; }
      } else if (action === 'restore') {
        if (m.deletedAt) { m.deletedAt = null; m.updated_at = nowIso(); changed++; }
      } else if (action === 'setType') {
        if (typeof memoryType !== 'string' || !memoryType.trim()) return res.status(400).json({ success: false, error: 'memoryType required' });
        m.memory_type = memoryType.trim();
        m.updated_at = nowIso();
        changed++;
      } else if (action === 'feature') {
        m.featured = 1;
        m.updated_at = nowIso();
        changed++;
      } else if (action === 'unfeature') {
        m.featured = 0;
        m.updated_at = nowIso();
        changed++;
      }
    }

    writeDB(db);
    audit(auth.user.id, 'bulk', { action, changed });
    broadcast('memory:bulk', { type: action, changed });

    res.json({ success: true, changed });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Edit memory metadata (21)
app.post('/api/admin/memory/edit/:id', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'editMemory')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const { caption, memory_type, student_name, featured } = req.body || {};

    const db = readDB();
    const m = db.memories.find(x => x.id === id && !x.purgedAt);
    if (!m) return res.status(404).json({ success: false, error: 'Not found' });

    if (typeof caption === 'string') m.caption = caption.trim().substring(0, 1000);
    if (typeof memory_type === 'string') m.memory_type = memory_type.trim();
    if (typeof student_name === 'string') m.student_name = student_name.trim().substring(0, 100);
    if (typeof featured === 'number') m.featured = featured ? 1 : 0;

    m.updated_at = nowIso();
    writeDB(db);

    audit(auth.user.id, 'edit-memory', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, memory: memoryPublicShape(m) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Replace file (22) — upload 1 file, replace disk file + update metadata + sha duplicate check
app.post('/api/admin/memory/replace-file/:id', upload.single('file'), (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'replaceFile')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const id = parseInt(req.params.id, 10);
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'file required' });

    const db = readDB();
    const m = db.memories.find(x => x.id === id && !x.purgedAt);
    if (!m) return res.status(404).json({ success: false, error: 'Not found' });

    const newPath = path.join(uploadsDir, file.filename);
    const hash = sha256File(newPath);
    const exists = db.memories.find(x => x.sha256 === hash && x.id !== id && !x.purgedAt);
    if (exists) {
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
      return res.status(409).json({ success: false, error: `Duplicate of memory #${exists.id}` });
    }

    // delete old file
    const oldPath = path.join(uploadsDir, m.file_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

    m.file_path = file.filename;
    m.file_name = file.originalname;
    m.file_type = getFileType(file.mimetype);
    m.file_size = file.size;
    m.sha256 = hash;
    m.updated_at = nowIso();

    writeDB(db);

    audit(auth.user.id, 'replace-file', { memoryId: id });
    broadcast('memory:update', { memoryId: id });

    res.json({ success: true, memory: memoryPublicShape(m) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Download all approved as ZIP (existing behavior; ignores deleted)
app.get('/api/admin/download-all', (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    if (!validateAdminToken(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const db = readDB();
    const memories = db.memories.filter(m => m.approved === 1 && !m.deletedAt && !m.purgedAt);

    if (memories.length === 0) return res.status(404).json({ success: false, error: 'No approved memories to download' });

    const timestamp = new Date().toISOString().split('T')[0];
    const zipFilename = `cornerstone-memories-${timestamp}.zip`;

    res.attachment(zipFilename);
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => { console.error('Archive error:', err); res.status(500).end(); });

    archive.pipe(res);
    memories.forEach(memory => {
      const filePath = path.join(uploadsDir, memory.file_path);
      if (fs.existsSync(filePath)) {
        const safeStudentName = memory.student_name.replace(/[^a-zA-Z0-9]/g, '_');
        const ext = path.extname(memory.file_path);
        const archiveName = `${memory.memory_type}/${safeStudentName}-${memory.id}${ext}`;
        archive.file(filePath, { name: archiveName });
      }
    });
    archive.finalize();
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get Settings (Admin)
// Reset duplicate-detection hashes (recomputes SHA256 for all files on disk)
app.post('/api/admin/reset-hashes', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (auth.user.role !== 'superadmin') return res.status(403).json({ success: false, error: 'Super admin only' });

    const db = readDB();
    let updated = 0;
    db.memories.forEach(m => {
      if (m.purgedAt) return;
      const fp = path.join(uploadsDir, m.file_path);
      if (fs.existsSync(fp)) {
        const buf = fs.readFileSync(fp);
        m.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        m.updated_at = nowIso();
        updated++;
      }
    });
    writeDB(db);
    audit(auth.user.id, 'reset-hashes', { updated });
    res.json({ success: true, updated });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Batch upload by admin (bypasses upload window, auto-approved)
app.post('/api/admin/upload-batch', upload.array('files', 50), (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'bulk')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, error: 'No files provided' });

    const { name = 'Admin Upload', caption = 'Batch upload', type = 'general' } = req.body;
    const db = readDB();
    const insertedIds = [];
    const duplicates = [];

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file.filename);
      const buf = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const exists = db.memories.find(m => m.sha256 === hash && !m.purgedAt);
      if (exists) {
        duplicates.push({ originalId: exists.id, file: file.originalname });
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      }
      const memory = {
        id: db.nextId++,
        student_name: String(name).trim().substring(0, 100),
        caption: String(caption).trim().substring(0, 1000),
        memory_type: String(type).trim(),
        file_path: file.filename,
        file_name: file.originalname,
        file_type: getFileType(file.mimetype),
        file_size: file.size,
        sha256: hash,
        approved: 1,
        featured: 0,
        likes: 0,
        deletedAt: null,
        purgedAt: null,
        created_at: nowIso(),
        updated_at: nowIso()
      };
      db.memories.push(memory);
      insertedIds.push(memory.id);
    });

    writeDB(db);
    audit(auth.user.id, 'batch-upload', { count: insertedIds.length });
    broadcast('memory:bulk', { type: 'new', count: insertedIds.length });
    res.json({ success: true, count: insertedIds.length, ids: insertedIds, duplicates });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Upload intro video
app.post('/api/admin/upload-intro-video', upload.single('video'), (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No video file provided' });

    const data = readSettings();
    // Remove old intro video file if it exists
    if (data.settings?.introVideoPath) {
      const oldFile = path.join(uploadsDir, path.basename(data.settings.introVideoPath));
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    }
    data.settings = data.settings || {};
    data.settings.introVideoPath = `/uploads/${file.filename}`;
    writeSettings(data);
    audit(auth.user.id, 'upload-intro-video', {});
    broadcast('settings:update', {});
    res.json({ success: true, introVideoPath: data.settings.introVideoPath });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Set intro video path via URL (no file upload)
app.post('/api/admin/settings/intro-video', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const { introVideoPath } = req.body || {};
    if (!introVideoPath) return res.status(400).json({ success: false, error: 'introVideoPath required' });
    const data = readSettings();
    data.settings = data.settings || {};
    data.settings.introVideoPath = String(introVideoPath).trim();
    writeSettings(data);
    audit(auth.user.id, 'set-intro-video', {});
    broadcast('settings:update', {});
    res.json({ success: true, introVideoPath: data.settings.introVideoPath });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Remove intro video
app.delete('/api/admin/settings/intro-video', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const data = readSettings();
    if (data.settings?.introVideoPath) {
      const oldFile = path.join(uploadsDir, path.basename(data.settings.introVideoPath));
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      delete data.settings.introVideoPath;
      writeSettings(data);
    }
    audit(auth.user.id, 'remove-intro-video', {});
    broadcast('settings:update', {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Export CSV (49)
app.get('/api/admin/export/csv', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const data = readSettings();
    res.json({ success: true, settings: data.settings || {} });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Settings save (includes theme + toggles) (64,57,58)
app.post('/api/admin/settings', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });

    const incoming = req.body?.settings;
    if (!incoming || typeof incoming !== 'object') return res.status(400).json({ success: false, error: 'Missing settings object' });

    // validate IST fields if present
    const istFields = ['farewellIST','uploadWindowStartIST','uploadWindowEndIST','autoApproveStartIST','autoApproveEndIST'];
    for (const f of istFields) {
      if (incoming[f] && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(incoming[f])) {
        return res.status(400).json({ success: false, error: `Invalid ${f} format. Use YYYY-MM-DDTHH:mm` });
      }
    }

    // theme permission gating
    if (incoming.theme && !hasPerm(auth.user, 'theme')) {
      return res.status(403).json({ success: false, error: 'No permission to edit theme' });
    }

    writeSettings({ settings: incoming });
    audit(auth.user.id, 'save-settings', {});
    broadcast('settings:update', {});

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Change own password
app.post('/api/admin/change-password', (req, res) => {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ success: false, error: 'Missing oldPassword or newPassword' });
    if (String(newPassword).length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

    const admins = readAdmins();
    const u = admins.users.find(x => x.id === auth.user.id);
    if (!u) return res.status(404).json({ success: false, error: 'User not found' });

    if (u.password !== oldPassword) return res.status(400).json({ success: false, error: 'Old password incorrect' });
    u.password = String(newPassword);
    u.updatedAt = nowIso();
    writeAdmins(admins);

    // invalidate all sessions for that user
    const sessions = readSessions();
    sessions.sessions = sessions.sessions.filter(s => s.userId !== u.id);
    writeSessions(sessions);

    audit(auth.user.id, 'change-password', {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// User management (superadmin only): create/update/disable + permissions toggles ("limits")
app.get('/api/admin/users', (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  if (!hasPerm(auth.user, 'users')) return res.status(403).json({ success: false, error: 'Forbidden' });

  const admins = readAdmins();
  res.json({
    success: true,
    users: admins.users.map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      disabled: !!u.disabled,
      permissions: u.permissions,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }))
  });
});

app.post('/api/admin/users', (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  if (!hasPerm(auth.user, 'users')) return res.status(403).json({ success: false, error: 'Forbidden' });

  const { id, name, password, role, permissions } = req.body || {};
  const uid = String(id || '').trim();
  if (!uid || uid.length < 3) return res.status(400).json({ success: false, error: 'id too short' });
  if (!/^[a-zA-Z0-9_-]+$/.test(uid)) return res.status(400).json({ success: false, error: 'id must be alnum/_/-' });
  if (!password || String(password).length < 8) return res.status(400).json({ success: false, error: 'password min 8 chars' });

  const admins = readAdmins();
  if (admins.users.find(u => u.id === uid)) return res.status(409).json({ success: false, error: 'User already exists' });

  const now = nowIso();
  admins.users.push({
    id: uid,
    name: String(name || uid).trim().substring(0, 60),
    role: role === 'admin' ? 'admin' : 'moderator',
    password: String(password),
    createdAt: now,
    updatedAt: now,
    disabled: false,
    permissions: typeof permissions === 'object' && permissions ? permissions : {
      moderation: true,
      settings: false,
      theme: false,
      export: false,
      users: false,
      trash: true,
      replaceFile: false,
      editMemory: true,
      bulk: false,
      featured: false
    }
  });

  writeAdmins(admins);
  audit(auth.user.id, 'create-user', { id: uid });
  res.json({ success: true });
});

app.post('/api/admin/users/:id', (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  if (!hasPerm(auth.user, 'users')) return res.status(403).json({ success: false, error: 'Forbidden' });

  const uid = String(req.params.id);
  if (uid === 'super') return res.status(400).json({ success: false, error: 'Cannot modify super via this endpoint' });

  const { name, password, disabled, permissions } = req.body || {};
  const admins = readAdmins();
  const u = admins.users.find(x => x.id === uid);
  if (!u) return res.status(404).json({ success: false, error: 'User not found' });

  if (typeof name === 'string') u.name = name.trim().substring(0, 60);
  if (typeof password === 'string' && password.length >= 8) u.password = password;
  if (typeof disabled === 'boolean') u.disabled = disabled;
  if (permissions && typeof permissions === 'object') u.permissions = permissions;

  u.updatedAt = nowIso();
  writeAdmins(admins);

  // invalidate their sessions
  const sessions = readSessions();
  sessions.sessions = sessions.sessions.filter(s => s.userId !== uid);
  writeSessions(sessions);

  audit(auth.user.id, 'update-user', { id: uid });
  res.json({ success: true });
});

// Export CSV (49)
app.get('/api/admin/export/csv', (req, res) => {
  const auth = requireAdmin(req, res); if (!auth) return;
  if (!hasPerm(auth.user, 'export')) return res.status(403).json({ success: false, error: 'Forbidden' });

  const db = readDB();
  const rows = db.memories.filter(m => !m.purgedAt).map(m => ({
    id: m.id,
    student_name: m.student_name,
    caption: m.caption,
    memory_type: m.memory_type,
    approved: m.approved,
    featured: m.featured || 0,
    likes: m.likes || 0,
    file_name: m.file_name,
    file_path: m.file_path,
    file_type: m.file_type,
    file_size: m.file_size,
    sha256: m.sha256,
    created_at: m.created_at,
    deletedAt: m.deletedAt || ''
  }));

  const header = Object.keys(rows[0] || { id: '' });
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map(h => `"${sanitizeCsvCell(r[h])}"`).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="memories-export-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(lines.join('\n'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILATIONS
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  const compilationsPath = path.join(databaseDir, 'compilations.json');
  if (!fs.existsSync(compilationsPath)) safeWriteJson(compilationsPath, { compilations: [], nextId: 1 });

  function readComp() { return safeReadJson(compilationsPath, { compilations: [], nextId: 1 }); }
  function writeComp(d) { safeWriteJson(compilationsPath, d); }

  app.get('/api/compilations', (req, res) => {
    try {
      const db = readComp();
      res.json({ success: true, compilations: db.compilations });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/compilations/:id', (req, res) => {
    try {
      const db = readComp();
      const comp = db.compilations.find(c => c.id === parseInt(req.params.id, 10));
      if (!comp) return res.status(404).json({ success: false, error: 'Compilation not found' });
      res.json({ success: true, compilation: comp });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/compilations', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const { title, description, memoryIds, transition, settings: compSettings } = req.body || {};
      if (!title?.trim()) return res.status(400).json({ success: false, error: 'title required' });

      const db = readComp();
      const comp = {
        id: db.nextId++,
        title: String(title).trim().substring(0, 120),
        description: String(description || '').trim().substring(0, 500),
        memoryIds: Array.isArray(memoryIds) ? memoryIds.map(Number) : [],
        transition: String(transition || 'fade'),
        settings: compSettings || {},
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.compilations.push(comp);
      writeComp(db);
      audit(auth.user.id, 'create-compilation', { id: comp.id });
      res.json({ success: true, compilation: comp });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/compilations/:id', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const db = readComp();
      const comp = db.compilations.find(c => c.id === parseInt(req.params.id, 10));
      if (!comp) return res.status(404).json({ success: false, error: 'Compilation not found' });

      const { title, description, memoryIds, transition, settings: compSettings } = req.body || {};
      if (typeof title === 'string') comp.title = title.trim().substring(0, 120);
      if (typeof description === 'string') comp.description = description.trim().substring(0, 500);
      if (Array.isArray(memoryIds)) comp.memoryIds = memoryIds.map(Number);
      if (typeof transition === 'string') comp.transition = transition;
      if (compSettings && typeof compSettings === 'object') comp.settings = compSettings;
      comp.updatedAt = nowIso();
      writeComp(db);
      audit(auth.user.id, 'update-compilation', { id: comp.id });
      res.json({ success: true, compilation: comp });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.delete('/api/admin/compilations/:id', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const db = readComp();
      const idx = db.compilations.findIndex(c => c.id === parseInt(req.params.id, 10));
      if (idx === -1) return res.status(404).json({ success: false, error: 'Compilation not found' });
      db.compilations.splice(idx, 1);
      writeComp(db);
      audit(auth.user.id, 'delete-compilation', { id: req.params.id });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  console.log('✅ Compilations API loaded.');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// DESTINATIONS (Future Map / Globe pins)
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  const destinationsPath = path.join(databaseDir, 'destinations.json');
  if (!fs.existsSync(destinationsPath)) safeWriteJson(destinationsPath, { pins: [], submissions: [], nextId: 1 });

  function readDest() { return safeReadJson(destinationsPath, { pins: [], submissions: [], nextId: 1 }); }
  function writeDest(d) { safeWriteJson(destinationsPath, d); }

  // GET approved pins for the globe
  app.get('/api/destinations', (req, res) => {
    try {
      const db = readDest();
      const approved = db.pins.filter(p => p.approved && !p.deletedAt);
      res.json({ success: true, destinations: approved });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET all pending submissions (admin alias)
  app.get('/api/destinations/submissions', (req, res) => {
    try {
      const db = readDest();
      res.json({ success: true, submissions: db.submissions || [] });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET pin submissions (same as above — frontend calls both)
  app.get('/api/destinations/pin-submissions', (req, res) => {
    try {
      const db = readDest();
      const pending = (db.pins || []).filter(p => !p.approved && !p.deletedAt);
      res.json({ success: true, submissions: pending });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST submit a destination (v1)
  app.post('/api/destinations/submit', (req, res) => {
    try {
      const { name, school, city, country, lat, lng, type, note } = req.body || {};
      if (!name?.trim() || !city?.trim() || !country?.trim())
        return res.status(400).json({ success: false, error: 'name, city, and country are required' });

      const db = readDest();
      const pin = {
        id: db.nextId++,
        name: String(name).trim().substring(0, 80),
        school: String(school || '').trim().substring(0, 120),
        city: String(city).trim().substring(0, 80),
        country: String(country).trim().substring(0, 80),
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        type: String(type || 'university').trim(),
        note: String(note || '').trim().substring(0, 300),
        approved: false,
        deletedAt: null,
        createdAt: nowIso()
      };
      db.pins.push(pin);
      writeDest(db);
      broadcast('destination:new', { id: pin.id });
      res.json({ success: true, pin });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST submit a destination (v2 — same shape, kept separate for frontend compat)
  app.post('/api/destinations/submit-v2', (req, res) => {
    try {
      const { name, school, city, country, lat, lng, type, note, emoji } = req.body || {};
      if (!name?.trim() || !city?.trim() || !country?.trim())
        return res.status(400).json({ success: false, error: 'name, city, and country are required' });

      const db = readDest();
      const pin = {
        id: db.nextId++,
        name: String(name).trim().substring(0, 80),
        school: String(school || '').trim().substring(0, 120),
        city: String(city).trim().substring(0, 80),
        country: String(country).trim().substring(0, 80),
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        type: String(type || 'university').trim(),
        emoji: String(emoji || '📍').substring(0, 4),
        note: String(note || '').trim().substring(0, 300),
        approved: false,
        deletedAt: null,
        createdAt: nowIso()
      };
      db.pins.push(pin);
      writeDest(db);
      broadcast('destination:new', { id: pin.id });
      res.json({ success: true, pin });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST pin-submit (alias used by globe component)
  app.post('/api/destinations/pin-submit', (req, res) => {
    try {
      const { name, school, city, country, lat, lng, type, note, emoji } = req.body || {};
      if (!name?.trim())
        return res.status(400).json({ success: false, error: 'name is required' });

      const db = readDest();
      const pin = {
        id: db.nextId++,
        name: String(name).trim().substring(0, 80),
        school: String(school || '').trim().substring(0, 120),
        city: String(city || '').trim().substring(0, 80),
        country: String(country || '').trim().substring(0, 80),
        lat: parseFloat(lat) || 0,
        lng: parseFloat(lng) || 0,
        type: String(type || 'university').trim(),
        emoji: String(emoji || '📍').substring(0, 4),
        note: String(note || '').trim().substring(0, 300),
        approved: false,
        deletedAt: null,
        createdAt: nowIso()
      };
      db.pins.push(pin);
      writeDest(db);
      broadcast('destination:new', { id: pin.id });
      res.json({ success: true, pin });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST admin: approve / delete / bulk manage destinations
  app.post('/api/admin/destinations', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const { action, id, ids } = req.body || {};
      const db = readDest();

      const targets = ids ? ids.map(Number) : (id ? [Number(id)] : []);
      let changed = 0;
      db.pins.forEach(p => {
        if (!targets.includes(p.id)) return;
        if (action === 'approve') { p.approved = true; changed++; }
        else if (action === 'delete') { p.deletedAt = nowIso(); changed++; }
        else if (action === 'restore') { p.deletedAt = null; changed++; }
      });

      writeDest(db);
      audit(auth.user.id, `destinations-${action}`, { changed });
      broadcast('destinations:update', {});
      res.json({ success: true, changed });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST admin destinations v2 (same — frontend calls both endpoints)
  app.post('/api/admin/destinations-v2', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const { action, id, ids } = req.body || {};
      const db = readDest();

      const targets = ids ? ids.map(Number) : (id ? [Number(id)] : []);
      let changed = 0;
      db.pins.forEach(p => {
        if (!targets.includes(p.id)) return;
        if (action === 'approve') { p.approved = true; changed++; }
        else if (action === 'delete') { p.deletedAt = nowIso(); changed++; }
        else if (action === 'restore') { p.deletedAt = null; changed++; }
      });

      writeDest(db);
      audit(auth.user.id, `destinations-v2-${action}`, { changed });
      broadcast('destinations:update', {});
      res.json({ success: true, changed });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  console.log('✅ Destinations API loaded.');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// PAPER NOTES (flying paper airplane notes)
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  const paperNotesPath = path.join(databaseDir, 'paper_notes.json');
  if (!fs.existsSync(paperNotesPath)) safeWriteJson(paperNotesPath, { notes: [], nextId: 1 });

  function readNotes() { return safeReadJson(paperNotesPath, { notes: [], nextId: 1 }); }
  function writeNotes(d) { safeWriteJson(paperNotesPath, d); }

  // GET a random note (only newer than `since` timestamp)
  app.get('/api/paper-notes/random', (req, res) => {
    try {
      const since = req.query.since ? Number(req.query.since) : 0;
      const db = readNotes();
      const pool = db.notes.filter(n => !n.deletedAt && new Date(n.createdAt).getTime() > since);
      if (!pool.length) return res.json({ success: true, note: null });
      const note = pool[Math.floor(Math.random() * pool.length)];
      res.json({ success: true, note });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // GET a random memory used as a paper note (pulls from approved memories)
  app.get('/api/paper-notes/random-memory', (req, res) => {
    try {
      // Read memories db — re-require the readDB via the passed-in safeReadJson
      const memDbPath = path.join(databaseDir, 'memories.json');
      const memDb = safeReadJson(memDbPath, { memories: [] });
      const approved = memDb.memories.filter(m => m.approved === 1 && !m.deletedAt && !m.purgedAt);
      if (!approved.length) return res.json({ success: true, memory: null });
      const mem = approved[Math.floor(Math.random() * approved.length)];
      res.json({
        success: true,
        memory: {
          id: mem.id,
          student_name: mem.student_name,
          caption: mem.caption,
          memory_type: mem.memory_type,
          file_url: `/uploads/${mem.file_path}`,
          file_type: mem.file_type
        }
      });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST create a new paper note
  app.post('/api/paper-notes', (req, res) => {
    try {
      const { name, message, color } = req.body || {};
      if (!message?.trim()) return res.status(400).json({ success: false, error: 'message is required' });

      const db = readNotes();
      const note = {
        id: db.nextId++,
        name: String(name || 'Anonymous').trim().substring(0, 60),
        message: String(message).trim().substring(0, 300),
        color: String(color || '#ffffff').substring(0, 20),
        deletedAt: null,
        createdAt: nowIso()
      };
      db.notes.push(note);
      // keep bounded
      if (db.notes.length > 2000) db.notes = db.notes.slice(-2000);
      writeNotes(db);
      broadcast('paper:note', { id: note.id, name: note.name, message: note.message, color: note.color });
      res.json({ success: true, note });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST convert a memory into a paper note
  app.post('/api/paper-notes/from-memory', (req, res) => {
    try {
      const { memoryId, color } = req.body || {};
      if (!memoryId) return res.status(400).json({ success: false, error: 'memoryId is required' });

      const memDbPath = path.join(databaseDir, 'memories.json');
      const memDb = safeReadJson(memDbPath, { memories: [] });
      const mem = memDb.memories.find(m => m.id === Number(memoryId) && m.approved === 1 && !m.deletedAt && !m.purgedAt);
      if (!mem) return res.status(404).json({ success: false, error: 'Memory not found' });

      const db = readNotes();
      const note = {
        id: db.nextId++,
        name: mem.student_name,
        message: mem.caption,
        color: String(color || '#fffde7').substring(0, 20),
        memoryId: mem.id,
        file_url: `/uploads/${mem.file_path}`,
        file_type: mem.file_type,
        deletedAt: null,
        createdAt: nowIso()
      };
      db.notes.push(note);
      if (db.notes.length > 2000) db.notes = db.notes.slice(-2000);
      writeNotes(db);
      broadcast('paper:note', { id: note.id, name: note.name, message: note.message, color: note.color });
      res.json({ success: true, note });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  console.log('✅ Paper Notes API loaded.');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER AUDIO MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  const teacherAudioPath = path.join(databaseDir, 'teacher_audio.json');
  if (!fs.existsSync(teacherAudioPath)) safeWriteJson(teacherAudioPath, { tracks: [], nextId: 1 });

  function readAudio() { return safeReadJson(teacherAudioPath, { tracks: [], nextId: 1 }); }
  function writeAudio(d) { safeWriteJson(teacherAudioPath, d); }

  // GET all teacher audio tracks (public)
  app.get('/api/teacher-audio', (req, res) => {
    try {
      const db = readAudio();
      res.json({ success: true, tracks: db.tracks.filter(t => !t.deletedAt) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST upload a new teacher audio track (admin only)
  app.post('/api/admin/teacher-audio', upload.single('audio'), (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const file = req.file;
      const { teacherName, subject, message } = req.body || {};

      if (!teacherName?.trim()) return res.status(400).json({ success: false, error: 'teacherName is required' });

      const db = readAudio();
      const track = {
        id: db.nextId++,
        teacherName: String(teacherName).trim().substring(0, 80),
        subject: String(subject || '').trim().substring(0, 80),
        message: String(message || '').trim().substring(0, 500),
        file_path: file ? file.filename : null,
        file_url: file ? `/uploads/${file.filename}` : null,
        deletedAt: null,
        createdAt: nowIso()
      };
      db.tracks.push(track);
      writeAudio(db);
      audit(auth.user.id, 'add-teacher-audio', { id: track.id });
      broadcast('teacher-audio:new', { id: track.id });
      res.json({ success: true, track });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  console.log('✅ Teacher Audio API loaded.');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  const studentDirPath = path.join(databaseDir, 'student_directory.json');
  if (!fs.existsSync(studentDirPath)) safeWriteJson(studentDirPath, { students: [] });

  function readDir() { return safeReadJson(studentDirPath, { students: [] }); }
  function writeDir(d) { safeWriteJson(studentDirPath, d); }

  // GET student directory (public)
  app.get('/api/student-directory', (req, res) => {
    try {
      const db = readDir();
      res.json({ success: true, students: db.students });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // POST update student directory (admin only — accepts full array replacement)
  app.post('/api/admin/student-directory', (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      if (!hasPerm(auth.user, 'settings')) return res.status(403).json({ success: false, error: 'Forbidden' });

      const { students } = req.body || {};
      if (!Array.isArray(students)) return res.status(400).json({ success: false, error: 'students array required' });

      writeDir({ students: students.map(s => ({
        name: String(s.name || '').trim().substring(0, 80),
        section: String(s.section || '').trim().substring(0, 40),
        photo: String(s.photo || '').trim(),
        quote: String(s.quote || '').trim().substring(0, 200),
        destination: String(s.destination || '').trim().substring(0, 120)
      }))});

      audit(auth.user.id, 'update-student-directory', { count: students.length });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  console.log('✅ Student Directory API loaded.');
})();

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

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB per file.` });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: `Too many files. Maximum is ${MAX_FILES} files per upload.` });
    }
  }
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// FUN FEATURES API
// ═══════════════════════════════════════════════════════════════════════════════
(() => {
  if (global.__FUN_FEATURES_PATCH__) return;
  global.__FUN_FEATURES_PATCH__ = true;

  const funDir = path.join(databaseDir, 'fun');
  if (!fs.existsSync(funDir)) fs.mkdirSync(funDir, { recursive: true });

  const ffPaths = {
    gratitude:    path.join(funDir, 'gratitude.json'),
    superlatives: path.join(funDir, 'superlatives.json'),
    wishes:       path.join(funDir, 'wishes.json'),
    dedications:  path.join(funDir, 'dedications.json'),
    mood:         path.join(funDir, 'mood.json'),
    capsules:     path.join(funDir, 'capsules.json'),
    settings:     path.join(funDir, 'ff_settings.json'),
  };

  const ffDefaults = {
    gratitude:    { entries: [], nextId: 1 },
    superlatives: { categories: [], nextId: 1 },
    wishes:       { entries: [], nextId: 1 },
    dedications:  { entries: [], nextId: 1 },
    mood:         { votes: [], options: ['Excited','Happy','Nostalgic','Bittersweet','Emotional'] },
    capsules:     { entries: [], nextId: 1 },
    settings:     { enabled: { gratitude:true, superlatives:true, wishes:true, dedications:true, mood:true, capsules:true } },
  };

  Object.entries(ffPaths).forEach(([k, p]) => {
    if (!fs.existsSync(p)) safeWriteJson(p, ffDefaults[k]);
  });

  function ffRead(key)      { return safeReadJson(ffPaths[key], ffDefaults[key]); }
  function ffWrite(key, d)  { safeWriteJson(ffPaths[key], d); }

  // ── Settings ────────────────────────────────────────────────────────────────
  app.get('/api/fun/settings', (req, res) => {
    res.json({ success: true, settings: ffRead('settings') });
  });
  app.post('/api/fun/settings', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const s = ffRead('settings');
    if (req.body?.enabled && typeof req.body.enabled === 'object') {
      s.enabled = { ...s.enabled, ...req.body.enabled };
    }
    ffWrite('settings', s);
    broadcast('ff:settings', s.enabled);
    res.json({ success: true, settings: s });
  });

  // ── Gratitude Wall ───────────────────────────────────────────────────────────
  app.get('/api/fun/gratitude', (req, res) => {
    const db = ffRead('gratitude');
    res.json({ success: true, entries: db.entries });
  });
  app.post('/api/fun/gratitude', (req, res) => {
    const { from, to, message } = req.body || {};
    if (!from?.trim() || !to?.trim() || !message?.trim())
      return res.status(400).json({ success: false, error: 'from, to, and message are required' });
    const db = ffRead('gratitude');
    const entry = { id: db.nextId++, from: from.trim().substring(0,60), to: to.trim().substring(0,60), message: message.trim().substring(0,400), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('gratitude', db);
    broadcast('ff:gratitude:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/gratitude/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('gratitude');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('gratitude', db);
    res.json({ success: true });
  });

  // ── Superlatives ─────────────────────────────────────────────────────────────
  app.get('/api/fun/superlatives', (req, res) => {
    res.json({ success: true, categories: ffRead('superlatives').categories });
  });
  app.post('/api/fun/superlatives', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const { categories } = req.body || {};
    if (!Array.isArray(categories)) return res.status(400).json({ success: false, error: 'categories array required' });
    const db = ffRead('superlatives');
    db.categories = categories.map(c => ({
      id: c.id || db.nextId++,
      title: String(c.title||'').trim().substring(0,100),
      nominees: Array.isArray(c.nominees) ? c.nominees.map(n=>({ name: String(n.name||'').trim().substring(0,60), votes: Number(n.votes)||0, imageUrl: n.imageUrl||null })) : [],
      imageUrl: c.imageUrl || null
    }));
    ffWrite('superlatives', db);
    res.json({ success: true, categories: db.categories });
  });
  app.post('/api/fun/superlatives/nominee', (req, res) => {
    const { categoryId, name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name required' });
    const db = ffRead('superlatives');
    const cat = db.categories.find(c => c.id === Number(categoryId));
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
    if (!cat.nominees.find(n => n.name.toLowerCase() === name.trim().toLowerCase())) {
      cat.nominees.push({ name: name.trim().substring(0,60), votes: 0, imageUrl: null });
      ffWrite('superlatives', db);
    }
    res.json({ success: true, categories: db.categories });
  });
  app.post('/api/fun/superlatives/vote', (req, res) => {
    const { categoryId, nomineeName } = req.body || {};
    const db = ffRead('superlatives');
    const cat = db.categories.find(c => c.id === Number(categoryId));
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
    const nom = cat.nominees.find(n => n.name === nomineeName);
    if (!nom) return res.status(404).json({ success: false, error: 'Nominee not found' });
    nom.votes++;
    ffWrite('superlatives', db);
    broadcast('ff:superlatives:vote', { categoryId, nomineeName });
    res.json({ success: true });
  });
  app.post('/api/fun/superlatives/upload-image', upload.single('image'), (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, error: 'No image file' });
      const { categoryId, nomineeName } = req.body || {};
      const db = ffRead('superlatives');
      const cat = db.categories.find(c => c.id === Number(categoryId));
      if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
      const imageUrl = `/uploads/${file.filename}`;
      if (nomineeName) {
        const nom = cat.nominees.find(n => n.name === nomineeName);
        if (nom) nom.imageUrl = imageUrl;
      } else {
        cat.imageUrl = imageUrl;
      }
      ffWrite('superlatives', db);
      res.json({ success: true, imageUrl });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── Wish Jar ─────────────────────────────────────────────────────────────────
  app.get('/api/fun/wishes', (req, res) => {
    res.json({ success: true, entries: ffRead('wishes').entries });
  });
  app.post('/api/fun/wishes', (req, res) => {
    const { name, category, text } = req.body || {};
    if (!name?.trim() || !text?.trim()) return res.status(400).json({ success: false, error: 'name and text required' });
    const db = ffRead('wishes');
    const entry = { id: db.nextId++, name: name.trim().substring(0,60), category: String(category||'General').trim().substring(0,40), text: text.trim().substring(0,500), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('wishes', db);
    broadcast('ff:wish:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/wishes/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('wishes');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('wishes', db);
    res.json({ success: true });
  });

  // ── Song Dedications ──────────────────────────────────────────────────────────
  app.get('/api/fun/dedications', (req, res) => {
    res.json({ success: true, entries: ffRead('dedications').entries });
  });
  app.post('/api/fun/dedications', (req, res) => {
    const { from, to, song, message } = req.body || {};
    if (!from?.trim() || !to?.trim() || !song?.trim()) return res.status(400).json({ success: false, error: 'from, to, and song required' });
    const db = ffRead('dedications');
    const entry = { id: db.nextId++, from: from.trim().substring(0,60), to: to.trim().substring(0,60), song: song.trim().substring(0,100), message: (message||'').trim().substring(0,400), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('dedications', db);
    broadcast('ff:dedication:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/dedications/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('dedications');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('dedications', db);
    res.json({ success: true });
  });

  // ── Mood Board ────────────────────────────────────────────────────────────────
  app.get('/api/fun/mood', (req, res) => {
    const db = ffRead('mood');
    const counts = {};
    (db.options||[]).forEach(o => counts[o] = 0);
    (db.votes||[]).forEach(v => { if (counts[v.mood] !== undefined) counts[v.mood]++; });
    res.json({ success: true, votes: db.votes, options: db.options, counts });
  });
  app.post('/api/fun/mood', (req, res) => {
    const { name, mood } = req.body || {};
    if (!mood?.trim()) return res.status(400).json({ success: false, error: 'mood required' });
    const db = ffRead('mood');
    db.votes.push({ name: (name||'Anonymous').trim().substring(0,60), mood: mood.trim().substring(0,40), createdAt: nowIso() });
    if (db.votes.length > 5000) db.votes = db.votes.slice(-5000);
    ffWrite('mood', db);
    broadcast('ff:mood:new', {});
    res.json({ success: true });
  });
  app.delete('/api/fun/mood/:idx', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('mood');
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= db.votes.length) return res.status(404).json({ success: false, error: 'Not found' });
    db.votes.splice(idx, 1);
    ffWrite('mood', db);
    res.json({ success: true });
  });

  // ── Time Capsule ──────────────────────────────────────────────────────────────
  app.get('/api/fun/capsules', (req, res) => {
    const db = ffRead('capsules');
    const now = new Date();
    const safe = db.entries.map(e => ({
      id: e.id, name: e.name, revealDate: e.revealDate, createdAt: e.createdAt,
      revealed: new Date(e.revealDate) <= now,
      letter: new Date(e.revealDate) <= now ? e.letter : null
    }));
    res.json({ success: true, entries: safe });
  });
  app.post('/api/fun/capsules', (req, res) => {
    const { name, revealDate, letter } = req.body || {};
    if (!name?.trim() || !letter?.trim() || !revealDate) return res.status(400).json({ success: false, error: 'name, revealDate, and letter required' });
    const db = ffRead('capsules');
    const entry = { id: db.nextId++, name: name.trim().substring(0,60), revealDate, letter: letter.trim().substring(0,2000), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('capsules', db);
    res.json({ success: true, entry: { id: entry.id, name: entry.name, revealDate: entry.revealDate, createdAt: entry.createdAt } });
  });
  app.delete('/api/fun/capsules/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('capsules');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('capsules', db);
    res.json({ success: true });
  });

  // ── Admin CSV Export ──────────────────────────────────────────────────────────
  // ── Admin Stats (counts + entries for all fun features) ───────────────────
  app.get('/api/admin/fun/stats', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    try {
      const gratitude  = ffRead('gratitude');
      const wishes     = ffRead('wishes');
      const dedications= ffRead('dedications');
      const capsules   = ffRead('capsules');
      const mood       = ffRead('mood');
      const sups       = ffRead('superlatives');

      const moodCounts = {};
      (mood.options||[]).forEach(o => moodCounts[o] = 0);
      (mood.votes||[]).forEach(v => { if (moodCounts[v.mood] !== undefined) moodCounts[v.mood]++; });

      res.json({ success: true, stats: {
        gratitude:   { count: gratitude.entries.length,   entries: gratitude.entries },
        wishes:      { count: wishes.entries.length,      entries: wishes.entries },
        dedications: { count: dedications.entries.length, entries: dedications.entries },
        capsules:    { count: capsules.entries.length,    entries: capsules.entries },
        mood:        { total: (mood.votes||[]).length, votes: moodCounts, rawVotes: mood.votes||[] },
        superlatives:{ categories: sups.categories }
      }});
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/admin/fun/export/:feature', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'export')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const feature = req.params.feature;
    if (!['gratitude','wishes','dedications','capsules','mood'].includes(feature))
      return res.status(400).json({ success: false, error: 'Invalid feature' });
    const db = ffRead(feature);
    const items = db.entries || db.votes || [];
    if (!items.length) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${feature}-export.csv"`);
      return res.send('No data\n');
    }
    const header = Object.keys(items[0]);
    const lines = [header.join(','), ...items.map(r => header.map(h => `"${sanitizeCsvCell(r[h])}"`).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${feature}-export-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join('\n'));
  });

 console.log('✅ Fun Features API loaded.');
})();

  const funDir = path.join(databaseDir, 'fun');
  if (!fs.existsSync(funDir)) fs.mkdirSync(funDir, { recursive: true });

  const ffPaths = {
    gratitude:    path.join(funDir, 'gratitude.json'),
    superlatives: path.join(funDir, 'superlatives.json'),
    wishes:       path.join(funDir, 'wishes.json'),
    dedications:  path.join(funDir, 'dedications.json'),
    mood:         path.join(funDir, 'mood.json'),
    capsules:     path.join(funDir, 'capsules.json'),
    settings:     path.join(funDir, 'ff_settings.json'),
  };

  const ffDefaults = {
    gratitude:    { entries: [], nextId: 1 },
    superlatives: { categories: [], nextId: 1 },
    wishes:       { entries: [], nextId: 1 },
    dedications:  { entries: [], nextId: 1 },
    mood:         { votes: [], options: ['Excited','Happy','Nostalgic','Bittersweet','Emotional'] },
    capsules:     { entries: [], nextId: 1 },
    settings:     { enabled: { gratitude:true, superlatives:true, wishes:true, dedications:true, mood:true, capsules:true } },
  };

  Object.entries(ffPaths).forEach(([k, p]) => {
    if (!fs.existsSync(p)) safeWriteJson(p, ffDefaults[k]);
  });

  function ffRead(key)     { return safeReadJson(ffPaths[key], ffDefaults[key]); }
  function ffWrite(key, d) { safeWriteJson(ffPaths[key], d); }

  app.get('/api/fun/settings', (req, res) => {
    res.json({ success: true, settings: ffRead('settings') });
  });
  app.post('/api/fun/settings', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const s = ffRead('settings');
    if (req.body?.enabled && typeof req.body.enabled === 'object') s.enabled = { ...s.enabled, ...req.body.enabled };
    ffWrite('settings', s);
    broadcast('ff:settings', s.enabled);
    res.json({ success: true, settings: s });
  });

  app.get('/api/fun/gratitude', (req, res) => {
    res.json({ success: true, entries: ffRead('gratitude').entries });
  });
  app.post('/api/fun/gratitude', (req, res) => {
    const { from, to, message } = req.body || {};
    if (!from?.trim() || !to?.trim() || !message?.trim()) return res.status(400).json({ success: false, error: 'from, to, and message are required' });
    const db = ffRead('gratitude');
    const entry = { id: db.nextId++, from: from.trim().substring(0,60), to: to.trim().substring(0,60), message: message.trim().substring(0,400), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('gratitude', db);
    broadcast('ff:gratitude:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/gratitude/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('gratitude');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('gratitude', db);
    res.json({ success: true });
  });

  app.get('/api/fun/superlatives', (req, res) => {
    res.json({ success: true, categories: ffRead('superlatives').categories });
  });
  app.post('/api/fun/superlatives', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const { categories } = req.body || {};
    if (!Array.isArray(categories)) return res.status(400).json({ success: false, error: 'categories array required' });
    const db = ffRead('superlatives');
    db.categories = categories.map(c => ({
      id: c.id || db.nextId++,
      title: String(c.title||'').trim().substring(0,100),
      nominees: Array.isArray(c.nominees) ? c.nominees.map(n=>({ name: String(n.name||'').trim().substring(0,60), votes: Number(n.votes)||0, imageUrl: n.imageUrl||null })) : [],
      imageUrl: c.imageUrl || null
    }));
    ffWrite('superlatives', db);
    res.json({ success: true, categories: db.categories });
  });
  app.post('/api/fun/superlatives/nominee', (req, res) => {
    const { categoryId, name } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name required' });
    const db = ffRead('superlatives');
    const cat = db.categories.find(c => c.id === Number(categoryId));
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
    if (!cat.nominees.find(n => n.name.toLowerCase() === name.trim().toLowerCase())) {
      cat.nominees.push({ name: name.trim().substring(0,60), votes: 0, imageUrl: null });
      ffWrite('superlatives', db);
    }
    res.json({ success: true, categories: db.categories });
  });
  app.post('/api/fun/superlatives/vote', (req, res) => {
    const { categoryId, nomineeName } = req.body || {};
    const db = ffRead('superlatives');
    const cat = db.categories.find(c => c.id === Number(categoryId));
    if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
    const nom = cat.nominees.find(n => n.name === nomineeName);
    if (!nom) return res.status(404).json({ success: false, error: 'Nominee not found' });
    nom.votes++;
    ffWrite('superlatives', db);
    broadcast('ff:superlatives:vote', { categoryId, nomineeName });
    res.json({ success: true });
  });
  app.post('/api/fun/superlatives/upload-image', upload.single('image'), (req, res) => {
    try {
      const auth = requireAdmin(req, res); if (!auth) return;
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, error: 'No image file' });
      const { categoryId, nomineeName } = req.body || {};
      const db = ffRead('superlatives');
      const cat = db.categories.find(c => c.id === Number(categoryId));
      if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
      const imageUrl = `/uploads/${file.filename}`;
      if (nomineeName) {
        const nom = cat.nominees.find(n => n.name === nomineeName);
        if (nom) nom.imageUrl = imageUrl;
      } else {
        cat.imageUrl = imageUrl;
      }
      ffWrite('superlatives', db);
      res.json({ success: true, imageUrl });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/fun/wishes', (req, res) => {
    res.json({ success: true, entries: ffRead('wishes').entries });
  });
  app.post('/api/fun/wishes', (req, res) => {
    const { name, category, text } = req.body || {};
    if (!name?.trim() || !text?.trim()) return res.status(400).json({ success: false, error: 'name and text required' });
    const db = ffRead('wishes');
    const entry = { id: db.nextId++, name: name.trim().substring(0,60), category: String(category||'General').trim().substring(0,40), text: text.trim().substring(0,500), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('wishes', db);
    broadcast('ff:wish:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/wishes/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('wishes');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('wishes', db);
    res.json({ success: true });
  });

  app.get('/api/fun/dedications', (req, res) => {
    res.json({ success: true, entries: ffRead('dedications').entries });
  });
  app.post('/api/fun/dedications', (req, res) => {
    const { from, to, song, message } = req.body || {};
    if (!from?.trim() || !to?.trim() || !song?.trim()) return res.status(400).json({ success: false, error: 'from, to, and song required' });
    const db = ffRead('dedications');
    const entry = { id: db.nextId++, from: from.trim().substring(0,60), to: to.trim().substring(0,60), song: song.trim().substring(0,100), message: (message||'').trim().substring(0,400), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('dedications', db);
    broadcast('ff:dedication:new', { id: entry.id });
    res.json({ success: true, entry });
  });
  app.delete('/api/fun/dedications/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('dedications');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('dedications', db);
    res.json({ success: true });
  });

  app.get('/api/fun/mood', (req, res) => {
    const db = ffRead('mood');
    const counts = {};
    (db.options||[]).forEach(o => counts[o] = 0);
    (db.votes||[]).forEach(v => { if (counts[v.mood] !== undefined) counts[v.mood]++; });
    res.json({ success: true, votes: db.votes, options: db.options, counts });
  });
  app.post('/api/fun/mood', (req, res) => {
    const { name, mood } = req.body || {};
    if (!mood?.trim()) return res.status(400).json({ success: false, error: 'mood required' });
    const db = ffRead('mood');
    db.votes.push({ name: (name||'Anonymous').trim().substring(0,60), mood: mood.trim().substring(0,40), createdAt: nowIso() });
    if (db.votes.length > 5000) db.votes = db.votes.slice(-5000);
    ffWrite('mood', db);
    broadcast('ff:mood:new', {});
    res.json({ success: true });
  });
  app.delete('/api/fun/mood/:idx', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('mood');
    const idx = Number(req.params.idx);
    if (idx < 0 || idx >= db.votes.length) return res.status(404).json({ success: false, error: 'Not found' });
    db.votes.splice(idx, 1);
    ffWrite('mood', db);
    res.json({ success: true });
  });

  app.get('/api/fun/capsules', (req, res) => {
    const db = ffRead('capsules');
    const now = new Date();
    const safe = db.entries.map(e => ({
      id: e.id, name: e.name, revealDate: e.revealDate, createdAt: e.createdAt,
      revealed: new Date(e.revealDate) <= now,
      letter: new Date(e.revealDate) <= now ? e.letter : null
    }));
    res.json({ success: true, entries: safe });
  });
  app.post('/api/fun/capsules', (req, res) => {
    const { name, revealDate, letter } = req.body || {};
    if (!name?.trim() || !letter?.trim() || !revealDate) return res.status(400).json({ success: false, error: 'name, revealDate, and letter required' });
    const db = ffRead('capsules');
    const entry = { id: db.nextId++, name: name.trim().substring(0,60), revealDate, letter: letter.trim().substring(0,2000), createdAt: nowIso() };
    db.entries.push(entry);
    ffWrite('capsules', db);
    res.json({ success: true, entry: { id: entry.id, name: entry.name, revealDate: entry.revealDate, createdAt: entry.createdAt } });
  });
  app.delete('/api/fun/capsules/:id', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    const db = ffRead('capsules');
    const idx = db.entries.findIndex(e => e.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ success: false, error: 'Not found' });
    db.entries.splice(idx, 1);
    ffWrite('capsules', db);
    res.json({ success: true });
  });

  app.get('/api/admin/fun/export/:feature', (req, res) => {
    const auth = requireAdmin(req, res); if (!auth) return;
    if (!hasPerm(auth.user, 'export')) return res.status(403).json({ success: false, error: 'Forbidden' });
    const feature = req.params.feature;
    if (!['gratitude','wishes','dedications','capsules','mood'].includes(feature)) return res.status(400).json({ success: false, error: 'Invalid feature' });
    const db = ffRead(feature);
    const items = db.entries || db.votes || [];
    if (!items.length) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${feature}-export.csv"`);
      return res.send('No data\n');
    }
    const header = Object.keys(items[0]);
    const lines = [header.join(','), ...items.map(r => header.map(h => `"${sanitizeCsvCell(r[h])}"`).join(','))];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${feature}-export-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join('\n'));
  });

  console.log('✅ Fun Features API loaded.');


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
  console.log(`📊 Max upload size: ${MAX_TOTAL_SIZE / 1024 / 1024}MB total`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => { console.log('🛑 SIGTERM received. Closing server...'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT received. Closing server...'); process.exit(0); });
