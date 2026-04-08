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

  db.run(`CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    module TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    details TEXT NOT NULL,
    severity TEXT,
    tags TEXT,
    confidence REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE knowledge_base ADD COLUMN kb_category TEXT DEFAULT '通用模型'`, () => {});
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
      if (url === '/api/knowledge') return handlePostKnowledge(req, res);
      if (url === '/api/knowledge/import-analysis') return handleImportKnowledgeFromAnalysis(req, res);
      if (url === '/api/log-upload') return handleLogUpload(req, res);
      if (url === '/api/analyze-log') return handleAnalyzeLog(req, res);
    }

    if (req.method === 'GET') {
      if (url === '/api/status') return sendJSON(res, 200, { status: 'ok', message: 'DCU diag backend available' });
      if (url === '/api/logs') return handleGetLogs(req, res, query);
      if (url === '/api/reports') return handleGetReports(req, res, query);
      if (url === '/api/stats') return handleGetStats(req, res);
      if (url === '/api/knowledge') return handleGetKnowledge(req, res, query);
    }

    if (req.method === 'DELETE') {
      if (url === '/api/logs') return handleDeleteLogs(req, res);
      if (url === '/api/reports') return handleDeleteReports(req, res);
      if (url === '/api/knowledge') return handleDeleteKnowledge(req, res, query);
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

function handlePostKnowledge(req, res) {
  parseJSONBody(req, res, (data) => {
    const source = data.source === 'ANALYSIS' ? 'ANALYSIS' : 'MANUAL';
    const module = ['XID', 'DRV', 'HW', 'GENERAL'].includes(data.module) ? data.module : 'GENERAL';
    const kbCategoryOptions = ['硬件驱动', 'DTK', 'DAS', '服务器', '大模型', '通用模型'];
    const kbCategory = kbCategoryOptions.includes(data.kbCategory) ? data.kbCategory : '通用模型';
    const title = (data.title || '').trim();
    const details = (data.details || '').trim();

    if (!title || !details) {
      return sendJSON(res, 400, { error: 'title and details are required' });
    }

    const summary = typeof data.summary === 'string' ? data.summary : '';
    const severity = typeof data.severity === 'string' ? data.severity : 'INFO';
    const tags = Array.isArray(data.tags) ? JSON.stringify(data.tags) : '[]';
    const confidence = Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null;

    const sql = `
      INSERT INTO knowledge_base (source, module, kb_category, title, summary, details, severity, tags, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [source, module, kbCategory, title, summary, details, severity, tags, confidence], function(err) {
      if (err) {
        console.error('Failed to insert knowledge:', err.message);
        return sendJSON(res, 500, { error: 'Failed to save knowledge' });
      }
      sendJSON(res, 201, { message: 'Knowledge saved', id: this.lastID });
    });
  });
}

function handleImportKnowledgeFromAnalysis(req, res) {
  parseJSONBody(req, res, (data) => {
    const module = ['XID', 'DRV', 'HW'].includes(data.module) ? data.module : null;
    const kbCategoryOptions = ['硬件驱动', 'DTK', 'DAS', '服务器', '大模型', '通用模型'];
    const defaultCategory = kbCategoryOptions.includes(data.kbCategory) ? data.kbCategory : '通用模型';
    const items = Array.isArray(data.items) ? data.items : [];
    if (!module || !items.length) {
      return sendJSON(res, 400, { error: 'module and non-empty items are required' });
    }

    const sql = `
      INSERT INTO knowledge_base (source, module, kb_category, title, summary, details, severity, tags, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    let inserted = 0;
    let skipped = 0;
    let errored = false;

    const runNext = (idx) => {
      if (idx >= items.length) {
        return sendJSON(res, 201, { message: 'Import complete', inserted, skipped, total: items.length });
      }
      const item = items[idx] || {};
      const title = String(item.title || item.key || '').trim();
      const details = String(item.details || item.raw || '').trim();
      if (!title || !details) {
        skipped += 1;
        return runNext(idx + 1);
      }
      const summary = typeof item.summary === 'string' ? item.summary : '';
      const severity = typeof item.severity === 'string' ? item.severity : 'INFO';
      const tags = Array.isArray(item.tags) ? JSON.stringify(item.tags) : '[]';
      const confidence = Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null;
      const kbCategory = kbCategoryOptions.includes(item.kbCategory) ? item.kbCategory : defaultCategory;
      db.run(sql, ['ANALYSIS', module, kbCategory, title, summary, details, severity, tags, confidence], (err) => {
        if (err && !errored) {
          errored = true;
          console.error('Import knowledge failed:', err.message);
          return sendJSON(res, 500, { error: 'Failed to import knowledge' });
        }
        if (!err) inserted += 1;
        runNext(idx + 1);
      });
    };

    runNext(0);
  });
}

function handleGetKnowledge(req, res, query) {
  const conditions = [];
  const params = [];

  if (query.has('module')) {
    conditions.push('module = ?');
    params.push(query.get('module').toUpperCase());
  }
  if (query.has('source')) {
    conditions.push('source = ?');
    params.push(query.get('source').toUpperCase());
  }
  if (query.has('kbCategory')) {
    conditions.push('kb_category = ?');
    params.push(query.get('kbCategory'));
  }
  if (query.has('q')) {
    const q = `%${query.get('q')}%`;
    conditions.push('(title LIKE ? OR summary LIKE ? OR details LIKE ? OR kb_category LIKE ?)');
    params.push(q, q, q, q);
  }

  let sql = 'SELECT * FROM knowledge_base';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

  const sort = query.get('sort') === 'id' ? 'id' : 'created_at';
  const order = query.get('order') === 'ASC' ? 'ASC' : 'DESC';
  const limit = Math.max(1, parseInt(query.get('limit') || '20', 10));
  const offset = Math.max(0, parseInt(query.get('offset') || '0', 10));

  sql += ` ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`;

  db.all(sql, params.concat([limit, offset]), (err, rows) => {
    if (err) {
      console.error('Failed to query knowledge:', err.message);
      return sendJSON(res, 500, { error: 'Failed to query knowledge' });
    }
    const countSQL = 'SELECT COUNT(*) AS total FROM knowledge_base' + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
    db.get(countSQL, params, (countErr, countRow) => {
      if (countErr) {
        console.error('Failed to count knowledge:', countErr.message);
        return sendJSON(res, 500, { error: 'Failed to count knowledge' });
      }
      const normalized = rows.map(row => ({
        ...row,
        tags: (() => {
          try { return JSON.parse(row.tags || '[]'); } catch { return []; }
        })()
      }));
      sendJSON(res, 200, { total: countRow.total || 0, limit, offset, items: normalized });
    });
  });
}

function handleLogUpload(req, res) {
  parseJSONBody(req, res, (data) => {
    const logText = String(data.logText || '').trim();
    const source = String(data.source || 'WEB');
    if (!logText) return sendJSON(res, 400, { error: 'logText is required' });
    const payload = {
      type: 'PIPELINE',
      category: 'UPLOAD',
      severity: 'INFO',
      content: JSON.stringify({ source, logText })
    };
    db.run(
      'INSERT INTO logs (type, category, severity, content, timestamp) VALUES (?, ?, ?, ?, ?)',
      [payload.type, payload.category, payload.severity, payload.content, new Date().toISOString()],
      function(err) {
        if (err) return sendJSON(res, 500, { error: 'Failed to upload log' });
        sendJSON(res, 201, { message: 'Log uploaded', logId: this.lastID, timestamp: new Date().toISOString() });
      }
    );
  });
}

function handleAnalyzeLog(req, res) {
  parseJSONBody(req, res, (data) => {
    const logText = String(data.logText || '').trim();
    if (!logText) return sendJSON(res, 400, { error: 'logText is required' });

    db.all('SELECT * FROM knowledge_base ORDER BY created_at DESC LIMIT 200', [], (err, rows) => {
      if (err) return sendJSON(res, 500, { error: 'Failed to query knowledge base' });
      const best = pickBestKnowledgeMatch(logText, rows || []);
      if (best && best.score >= 0.12) {
        return sendJSON(res, 200, {
          mode: 'KB_MATCH',
          confidence: Number(best.score.toFixed(2)),
          category: best.item.kb_category || '通用模型',
          title: best.item.title,
          solution: best.item.details,
          knowledgeId: best.item.id
        });
      }
      const llm = fallbackLLMAnalysis(logText);
      sendJSON(res, 200, {
        mode: 'LLM_FALLBACK',
        confidence: llm.confidence,
        category: llm.category,
        solution: llm.solution
      });
    });
  });
}

function pickBestKnowledgeMatch(logText, rows) {
  const text = tokenize(logText);
  let best = null;
  rows.forEach((item) => {
    const docText = [item.title, item.summary, item.details, item.kb_category].join(' ');
    const docTokens = tokenize(docText);
    const inter = new Set([...text].filter(t => docTokens.has(t)));
    const denom = Math.max(1, docTokens.size);
    const score = inter.size / denom;
    if (!best || score > best.score) best = { item, score };
  });
  return best;
}

function tokenize(raw) {
  return new Set(
    String(raw || '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function fallbackLLMAnalysis(logText) {
  const txt = String(logText).toLowerCase();
  if (txt.includes('timeout')) {
    return { category: '大模型', confidence: 0.55, solution: '知识库未命中高置信方案，建议大模型继续分析 timeout 根因并给出处置路径。' };
  }
  if (txt.includes('firmware') || txt.includes('driver')) {
    return { category: '硬件驱动', confidence: 0.53, solution: '知识库命中不足，建议调用大模型结合驱动版本与固件版本做兼容性分析。' };
  }
  return { category: '通用模型', confidence: 0.5, solution: '知识库匹配度较低，已切换到大模型分析，请补充更多上下文日志提升结论准确度。' };
}

function handleDeleteKnowledge(req, res, query) {
  if (query.has('id')) {
    const id = parseInt(query.get('id'), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }
    return db.run('DELETE FROM knowledge_base WHERE id = ?', [id], function(err) {
      if (err) {
        console.error('Failed to delete knowledge by id:', err.message);
        return sendJSON(res, 500, { error: 'Failed to delete knowledge' });
      }
      sendJSON(res, 200, { message: 'Knowledge deleted', deleted: this.changes });
    });
  }
  db.run('DELETE FROM knowledge_base', [], function(err) {
    if (err) {
      console.error('Failed to delete all knowledge:', err.message);
      return sendJSON(res, 500, { error: 'Failed to delete knowledge' });
    }
    sendJSON(res, 200, { message: 'All knowledge deleted', deleted: this.changes });
  });
}

function parseJSONBody(req, res, onSuccess) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      onSuccess(JSON.parse(body || '{}'));
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON' });
    }
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
