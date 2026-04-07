const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname);
const DB_FILE = path.join(__dirname, 'dcu_diag.db');

const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
  if (err) {
    console.error('⚠️ SQLite database open failed:', err.message);
  } else {
    console.log('✓ SQLite database opened:', DB_FILE);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    category TEXT,
    severity TEXT,
    content TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category TEXT,
    content TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const query = new URL(`http://localhost${req.url}`).searchParams;

  // CORS 和通用头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (url === '/' || url === '/index.html') {
    return sendFile('dcu_diag.html', 'text/html', res);
  }

  if (url.startsWith('/api/')) {
    if (req.method === 'POST') {
      if (url === '/api/logs') return handlePostLogs(req, res);
      if (url === '/api/reports') return handlePostReports(req, res);
    }

    if (req.method === 'GET') {
      if (url === '/api/status') return sendJSON(res, 200, { status: 'ok', message: 'DCU diag backend available' });
      if (url === '/api/logs') return handleGetLogs(req, res, query);
      if (url === '/api/reports') return handleGetReports(req, res, query);
      if (url === '/api/stats') return handleGetStats(req, res);
    }

    if (req.method === 'DELETE') {
      if (url === '/api/logs') return handleDeleteLogs(req, res);
      if (url === '/api/reports') return handleDeleteReports(req, res);
    }

    return sendJSON(res, 404, { error: 'Endpoint not found' });
  }

  const target = path.join(PUBLIC_DIR, decodeURIComponent(url));
  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJSON(res, 403, { error: 'Forbidden' });
  }

  fs.stat(target, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendJSON(res, 404, { error: 'Not found' });
    }

    const ext = path.extname(target).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    sendFile(target, type, res);
  });
});

function handlePostLogs(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const type = data.type || 'UNKNOWN';
      const category = data.category || 'GENERAL';
      const severity = data.severity || 'INFO';
      const content = data.content || '';
      const timestamp = new Date().toISOString();

      const insertSQL = 'INSERT INTO logs (type, category, severity, content, timestamp) VALUES (?, ?, ?, ?, ?)';
      db.run(insertSQL, [type, category, severity, content, timestamp], function(err) {
        if (err) {
          console.error('Failed to insert log:', err.message);
          sendJSON(res, 500, { error: 'Failed to save log' });
          return;
        }

        const id = this.lastID;
      sendJSON(res, 201, { message: 'Log saved', id });
      });
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON' });
    }
  });
}

function handleGetLogs(req, res, query) {
  const conditions = [];
  const params = [];

  if (query.has('category')) {
    conditions.push('category = ?');
    params.push(query.get('category'));
  }
  if (query.has('type')) {
    conditions.push('type = ?');
    params.push(query.get('type'));
  }

  let sql = 'SELECT * FROM logs';
  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const sort = ['timestamp', 'id', 'severity', 'type', 'category'].includes(query.get('sort')) ? query.get('sort') : 'timestamp';
  const order = query.get('order') === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.max(1, parseInt(query.get('limit') || '20', 10));
  const offset = Math.max(0, parseInt(query.get('offset') || '0', 10));

  sql += ` ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`;
  const finalParams = params.concat([limit, offset]);

  db.all(sql, finalParams, (err, rows) => {
    if (err) {
      console.error('Failed to query logs:', err.message);
      sendJSON(res, 500, { error: 'Failed to query logs' });
      return;
    }

    const countSQL = 'SELECT COUNT(*) AS total FROM logs' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
    db.get(countSQL, params, (countErr, countRow) => {
      if (countErr) {
        console.error('Failed to count logs:', countErr.message);
        sendJSON(res, 500, { error: 'Failed to count logs' });
        return;
      }

      sendJSON(res, 200, { total: countRow.total || 0, limit, offset, logs: rows });
    });
  });
}

function handlePostReports(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const title = data.title || 'Untitled';
      const category = data.category || 'GENERAL';
      const content = data.content || '';

      const insertSQL = 'INSERT INTO reports (title, category, content) VALUES (?, ?, ?)';
      db.run(insertSQL, [title, category, content], function(err) {
        if (err) {
          console.error('Failed to insert report:', err.message);
          sendJSON(res, 500, { error: 'Failed to save report' });
          return;
        }

        const id = this.lastID;
        sendJSON(res, 201, { message: 'Report saved', id });
      });
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON' });
    }
  });
}

function handleGetReports(req, res, query) {
  const conditions = [];
  const params = [];

  if (query.has('category')) {
    conditions.push('category = ?');
    params.push(query.get('category'));
  }

  let sql = 'SELECT * FROM reports';
  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  const sort = query.get('sort') === 'created_at' ? 'created_at' : 'id';
  const order = query.get('order') === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.max(1, parseInt(query.get('limit') || '20', 10));
  const offset = Math.max(0, parseInt(query.get('offset') || '0', 10));

  sql += ` ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`;
  const finalParams = params.concat([limit, offset]);

  db.all(sql, finalParams, (err, rows) => {
    if (err) {
      console.error('Failed to query reports:', err.message);
      sendJSON(res, 500, { error: 'Failed to query reports' });
      return;
    }

    const countSQL = 'SELECT COUNT(*) AS total FROM reports' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
    db.get(countSQL, params, (countErr, countRow) => {
      if (countErr) {
        console.error('Failed to count reports:', countErr.message);
        sendJSON(res, 500, { error: 'Failed to count reports' });
        return;
      }
      sendJSON(res, 200, { total: countRow.total || 0, limit, offset, reports: rows });
    });
  });
}

function handleDeleteLogs(req, res) {
  const deleteSQL = 'DELETE FROM logs';
  db.run(deleteSQL, [], function(err) {
    if (err) {
      console.error('Failed to delete logs:', err.message);
      sendJSON(res, 500, { error: 'Failed to delete logs' });
      return;
    }
    sendJSON(res, 200, { message: 'All logs deleted', deleted: this.changes });
  });
}

function handleDeleteReports(req, res) {
  const deleteSQL = 'DELETE FROM reports';
  db.run(deleteSQL, [], function(err) {
    if (err) {
      console.error('Failed to delete reports:', err.message);
      sendJSON(res, 500, { error: 'Failed to delete reports' });
      return;
    }
    sendJSON(res, 200, { message: 'All reports deleted', deleted: this.changes });
  });
}

function handleGetStats(req, res) {
  const statsSQL = 'SELECT category, COUNT(*) AS count FROM logs GROUP BY category';
  db.all(statsSQL, [], (err, rows) => {
    if (err) {
      console.error('Failed to generate stats:', err.message);
      sendJSON(res, 500, { error: 'Failed to generate stats' });
      return;
    }
    sendJSON(res, 200, rows);
  });
}

function sendFile(filepath, contentType, res) {
  fs.readFile(filepath, (error, data) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

server.listen(PORT, HOST, () => {
  console.log(`✓ DCU diag server started at http://${HOST}:${PORT}`);
  console.log(`✓ Open http://localhost:${PORT}/ in your browser`);
  console.log(`✓ API: http://localhost:${PORT}/api/status`);
});
