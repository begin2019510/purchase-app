'use strict';
// /api/claude —— 手机端「和 Claude 对话」：代理 CloudCLI POST /api/agent（127.0.0.1:3001）
//
// 设计：异步任务 + 轮询（不是同步长等待）。
// 原因：Cloudflare 边缘对源站 TTFB 有 ~100s 限制（524），分钟级 Agent 任务同步等待必被掐断。
// 因此每次 HTTP 都是短请求：POST 发起任务立即返回 taskId，前端轮询 GET 取进度文本。
//
// CloudCLI 侧用 stream:true 收 SSE（normalized 消息），在本服务聚合成整段文本。
// 会话复用 CloudCLI 自己的 sessionId：手机聊的会话在 agent 网页版也能看到、能续聊。
//
// 安全：CloudCLI key 只在 server.env（服务端内存），不透传任何用户凭据；
// 本路由挂在 X-Service-Token 闸 + parseJWT 之后，requireAuth 强制登录。
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
// 挂载于 app.use('/api', ...)，路径写全子路径（与 auth.js / report.js 同模式）
// 仅管理员：3 个 App 账号共用同一个 CloudCLI 身份，开放给所有人等于共享完整 agent
async function requireAdmin(req, res, next) {
  try {
    const row = await db.one('SELECT is_admin FROM users WHERE username = ?', [req.username]);
    if (!row || !Number(row.is_admin)) {
      return res.status(403).json({ error: '仅管理员可使用 Claude 对话' });
    }
  } catch (e) {
    return res.status(500).json({ error: '权限校验失败' });
  }
  next();
}
router.use('/claude', requireAuth, requireAdmin);

// 内存任务表：taskId → 状态。purchase-server 重启即丢失（前端提示重新发送）。
const tasks = new Map();
let runningTaskId = '';
const TASK_TTL = 30 * 60 * 1000;      // 完成后保留 30 分钟供轮询/回看
const TASK_MAX_MS = 25 * 60 * 1000;   // 单任务绝对上限

setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (t.status !== 'running' && now - t.finishedAt > TASK_TTL) tasks.delete(id);
  }
}, 10 * 60 * 1000).unref();

// 聚合当前可见文本：已定稿的整段 + 正在流出的 delta
function liveText(t) {
  const s = t.texts.filter(Boolean).join('\n\n');
  if (t.delta) return s ? s + '\n\n' + t.delta : t.delta;
  return s;
}

const ASK_TOOLS = new Set(['AskUserQuestion', 'request_user_input']);

// toolInput 可能是对象，也可能是 JSON 字符串
function parseToolInput(v) {
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s.startsWith('{')) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  return v && typeof v === 'object' ? v : null;
}

// 把 AskUserQuestion 的 questions[] 变成可读文本（气泡里能看见问题和选项）
function formatAskQuestion(input) {
  const obj = parseToolInput(input);
  const qs = obj && Array.isArray(obj.questions) ? obj.questions : null;
  if (!qs || !qs.length) return '';
  const answers = (obj.answers && typeof obj.answers === 'object') ? obj.answers : null;
  const lines = ['❓ Claude 想问你：'];
  for (const raw of qs) {
    const q = parseToolInput(raw);
    if (!q) continue;
    const text = String(q.question || '').trim();
    if (!text) continue;
    lines.push('', text);
    const opts = Array.isArray(q.options) ? q.options : [];
    opts.forEach((o, i) => {
      const label = typeof o === 'string' ? o : String((o && (o.label || o.value)) || '').trim();
      if (label) lines.push((i + 1) + '. ' + label);
    });
    if (answers) {
      const ans = answers[text] || (q.id ? answers[q.id] : '');
      if (ans) lines.push('→ 已选择：' + String(ans));
    }
  }
  return lines.join('\n');
}

// 事件解析：对两种格式都做防御
// 1) normalized 消息 {kind:'text'|'stream_delta'|'tool_use'|'session_created'|..., role, content}
// 2) 旧版 {type:'claude-response', data:{type:'assistant', message:{content:[{type:'text',text}]}}}
function applyEvent(t, ev) {
  if (!ev || typeof ev !== 'object') return;

  // SSEStreamWriter 控制帧
  if (ev.type === 'session-id' && ev.sessionId) { t.sessionId = String(ev.sessionId); return; }
  if (ev.type === 'done') { t.done = true; return; }
  if (ev.type === 'error') { t.error = String(ev.error || ev.message || '未知错误'); return; }
  if (ev.type === 'status') return; // token_budget 等心跳

  // 旧格式 claude-response
  if (ev.type === 'claude-response') {
    const data = ev.data || {};
    if (data.type === 'assistant') {
      const msg = data.message || data;
      const blocks = msg && msg.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b && b.type === 'text' && b.text) { t.texts.push(String(b.text)); t.delta = ''; }
        }
      } else if (msg && typeof msg.text === 'string' && msg.text) {
        t.texts.push(msg.text); t.delta = '';
      }
    }
    return;
  }

  // normalized 消息
  const kind = ev.kind;
  if (kind === 'session_created') {
    const sid = ev.newSessionId || ev.sessionId;
    if (sid) t.sessionId = String(sid);
    return;
  }
  if (kind === 'text') {
    if (ev.role === 'assistant' && typeof ev.content === 'string' && ev.content) {
      t.texts.push(ev.content);
      t.delta = ''; // 整段已到，清掉与之重复的流式残余
    }
    return;
  }
  if (kind === 'stream_delta') {
    const c = ev.content;
    if (typeof c === 'string') t.delta += c;
    else if (c && typeof c.text === 'string') t.delta += c.text;
    return;
  }
  if (kind === 'tool_use' || kind === 'permission_request') {
    const name = String(ev.toolName || ev.tool || '');
    if (name && t.tools[t.tools.length - 1] !== name) t.tools.push(name);
    if (ASK_TOOLS.has(name)) {
      const q = formatAskQuestion(kind === 'permission_request' ? (ev.input || ev.toolInput) : ev.toolInput);
      if (q && !t.asked.has(q)) {
        t.asked.add(q);
        t.texts.push(q);
        t.delta = ''; // 问题卡进入可见文本，避免流式残余盖住
      }
    }
    return;
  }
  if (kind === 'error') { t.error = String(ev.content || '未知错误'); return; }
  if (kind === 'complete') { t.done = true; return; }
}

function startJob(message, sessionId) {
  const taskId = crypto.randomUUID();
  const t = {
    id: taskId, status: 'running',
    texts: [], delta: '', tools: [], asked: new Set(),
    sessionId: sessionId || '', error: '', done: false,
    createdAt: Date.now(), finishedAt: 0,
  };
  tasks.set(taskId, t);
  runningTaskId = taskId;

  let finished = false;
  let absoluteTimer = null;
  let req = null;
  const finish = (status, error) => {
    if (finished) return;
    finished = true;
    if (absoluteTimer) clearTimeout(absoluteTimer);
    t.status = status;
    if (error) t.error = error;
    t.finishedAt = Date.now();
    if (runningTaskId === taskId) runningTaskId = '';
  };

  const payload = JSON.stringify({
    projectPath: '/',
    message,
    provider: 'claude',
    sessionId: sessionId || undefined,
    stream: true,
    cleanup: false,
    model: cfg.CLOUDCLI_MODEL || undefined,
  });
  const u = new URL(cfg.CLOUDCLI_BASE + '/api/agent');

  absoluteTimer = setTimeout(() => {
    try { if (req) req.destroy(); } catch (e) { /* ignore */ }
    finish('error', '任务超时（25 分钟），已中止');
  }, TASK_MAX_MS);
  if (absoluteTimer.unref) absoluteTimer.unref();

  // 用核心 http 模块而非 fetch：Agent 可能安静数分钟，fetch(undici) 默认 300s 头/体超时会掐断；
  // 这里不设 socket 超时，靠上面的绝对定时器兜底。
  req = http.request({
    hostname: u.hostname,
    port: u.port,
    path: u.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.CLOUDCLI_API_KEY,
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (resp) => {
    if (resp.statusCode !== 200) {
      let body = '';
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        let msg = 'CloudCLI 返回 HTTP ' + resp.statusCode;
        try {
          const j = JSON.parse(body);
          if (j && j.error) msg += ': ' + (j.error.message || j.error);
        } catch (e) { /* 非 JSON 就只报状态码 */ }
        finish('error', msg);
      });
      return;
    }
    let buf = '';
    resp.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try { applyEvent(t, JSON.parse(raw)); } catch (e) { /* 忽略坏帧 */ }
        }
        if (t.done) {
          try { resp.destroy(); } catch (e) { /* ignore */ }
          finish(t.error ? 'error' : 'done');
          return;
        }
      }
    });
    resp.on('end', () => finish(t.error ? 'error' : 'done'));
    resp.on('error', (e) => finish('error', '连接 CloudCLI 中断: ' + e.message));
  });
  req.on('error', (e) => finish('error', '无法连接 CloudCLI: ' + e.message));
  req.write(payload);
  req.end();
  return taskId;
}

// GET /api/claude?action=task&id=xxx → {status, text, sessionId, tools, error?}
// GET /api/claude?action=sessions&limit=30 → {sessions:[{id,title,at,project}],total}
// GET /api/claude?action=history&id=xxx&limit=200 → {messages:[{role,text,at}]}
router.get('/claude', (req, res) => {
  const action = String(req.query.action || '');
  if (action === 'task') {
    const t = tasks.get(String(req.query.id || ''));
    if (!t) return res.status(404).json({ error: 'task_not_found', hint: '任务不存在或服务已重启，请重新发送' });
    return res.json({
      status: t.status,
      text: liveText(t),
      sessionId: t.sessionId,
      tools: t.tools,
      error: t.error || undefined,
    });
  }
  if (action === 'sessions') return handleSessions(req, res);
  if (action === 'history') return handleHistory(req, res);
  return res.status(404).json({ error: 'not_found' });
});

// POST /api/claude?action=rename {id,title} | action=delete {id}
// （rename/delete 放 POST：CF toServer 对 DELETE 透传没问题，但统一走现有 POST 契约更简单）
router.post('/claude', (req, res) => {
  const action = String(req.query.action || '');
  if (action === 'chat') return handleChat(req, res);
  if (action === 'rename') return handleRename(req, res);
  if (action === 'delete') return handleDelete(req, res);
  return res.status(404).json({ error: 'not_found' });
});

// ===== 会话管理：铸 CloudCLI JWT 代理 /api/providers/sessions/* =====
// /api/agent 用 x-api-key；sessions API 用 Bearer JWT（secret 在 CloudCLI app_config）。

function cloudcliApi(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!cfg.CLOUDCLI_JWT_SECRET) {
      return reject(new Error('服务端未配置 CLOUDCLI_JWT_SECRET（会话管理不可用）'));
    }
    let token;
    try {
      token = jwt.sign(
        { userId: cfg.CLOUDCLI_USER_ID, username: cfg.CLOUDCLI_USER },
        cfg.CLOUDCLI_JWT_SECRET,
        { expiresIn: '15m' },
      );
    } catch (e) { return reject(e); }

    const payload = body != null ? JSON.stringify(body) : '';
    const u = new URL(cfg.CLOUDCLI_BASE + path);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (resp) => {
      let buf = '';
      resp.on('data', (c) => { buf += c; });
      resp.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* 非 JSON */ }
        resolve({ status: resp.statusCode, json, raw: buf });
      });
      resp.on('error', reject);
    });
    req.setTimeout(15000, () => { try { req.destroy(); } catch (e) { /* ignore */ } reject(new Error('CloudCLI 超时')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function handleSessions(req, res) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  try {
    const r = await cloudcliApi('GET', '/api/providers/sessions/recent?limit=' + limit);
    if (r.status !== 200 || !r.json || !r.json.success) {
      return res.status(502).json({ error: 'CloudCLI 会话列表失败', detail: r.json && (r.json.error || r.json.code) || ('HTTP ' + r.status) });
    }
    const page = r.json.data || {};
    const list = (page.conversations || []).map((c) => ({
      id: String(c.sessionId || ''),
      title: String(c.sessionTitle || '（无标题）'),
      at: c.lastActivity || '',
      project: String(c.projectDisplayName || ''),
    }));
    return res.json({ sessions: list, total: Number(page.total) || list.length });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'CloudCLI 不可达' });
  }
}

async function handleHistory(req, res) {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id 必填' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  try {
    const r = await cloudcliApi('GET', '/api/providers/sessions/' + encodeURIComponent(id) + '/messages?limit=' + limit);
    if (r.status !== 200 || !r.json || !r.json.success) {
      return res.status(502).json({ error: 'CloudCLI 历史拉取失败', detail: r.json && (r.json.error || r.json.code) || ('HTTP ' + r.status) });
    }
    const msgs = [];
    for (const m of (r.json.data && r.json.data.messages) || []) {
      if (!m) continue;
      if (m.kind === 'text' && (m.role === 'user' || m.role === 'assistant') && m.content) {
        msgs.push({ role: m.role, text: String(m.content), at: m.timestamp || '' });
        continue;
      }
      // 历史里 Claude 的提问只落在 tool_use，不展开就永远看不到
      if (m.kind === 'tool_use' && ASK_TOOLS.has(String(m.toolName || ''))) {
        const q = formatAskQuestion(m.toolInput);
        if (q) msgs.push({ role: 'assistant', text: q, at: m.timestamp || '' });
      }
    }
    return res.json({ messages: msgs });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'CloudCLI 不可达' });
  }
}

async function handleRename(req, res) {
  const id = String((req.body && req.body.id) || '').trim();
  const title = String((req.body && req.body.title) || '').trim();
  if (!id) return res.status(400).json({ error: 'id 必填' });
  if (!title || title.length > 200) return res.status(400).json({ error: 'title 需 1~200 字' });
  try {
    const r = await cloudcliApi('PUT', '/api/providers/sessions/' + encodeURIComponent(id), { summary: title });
    if (r.status !== 200 || !r.json || !r.json.success) {
      return res.status(502).json({ error: '重命名失败', detail: r.json && (r.json.error || r.json.code) || ('HTTP ' + r.status) });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'CloudCLI 不可达' });
  }
}

async function handleDelete(req, res) {
  const id = String((req.body && req.body.id) || '').trim();
  if (!id) return res.status(400).json({ error: 'id 必填' });
  try {
    // 不带 force：CloudCLI 默认归档（网页版可 restore），不物理删
    const r = await cloudcliApi('DELETE', '/api/providers/sessions/' + encodeURIComponent(id));
    if (r.status !== 200 || !r.json || !r.json.success) {
      return res.status(502).json({ error: '删除失败', detail: r.json && (r.json.error || r.json.code) || ('HTTP ' + r.status) });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'CloudCLI 不可达' });
  }
}

// 原 chat 逻辑抽出，路由分发在上面
function handleChat(req, res) {
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'message 必填' });
  if (message.length > 20000) return res.status(400).json({ error: '消息过长（上限 2 万字）' });
  if (!cfg.CLOUDCLI_API_KEY) return res.status(503).json({ error: '服务端未配置 CLOUDCLI_API_KEY' });

  const rt = runningTaskId ? tasks.get(runningTaskId) : null;
  if (rt && rt.status === 'running') {
    // 单并发：2 核 1.6G 小机器，避免多个 Agent 同时跑爆内存；返回现有任务让前端切过去看进度
    return res.status(409).json({ error: 'busy', taskId: runningTaskId });
  }

  const sessionId = String((req.body && req.body.sessionId) || '').trim();
  const taskId = startJob(message, sessionId);
  return res.json({ ok: true, taskId });
}

module.exports = router;
