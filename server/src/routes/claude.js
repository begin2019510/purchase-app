'use strict';
// /api/claude —— 手机端「和 Claude 对话」：代理 CloudCLI（127.0.0.1:3001）
//
// 设计：异步任务 + 轮询（不是同步长等待）。
// 原因：Cloudflare 边缘对源站 TTFB 有 ~100s 限制（524），分钟级 Agent 任务同步等待必被掐断。
// 因此每次 HTTP 都是短请求：POST 发起任务立即返回 taskId，前端轮询 GET 取进度文本。
//
// v3.1.12 起主链路走 CloudCLI WebSocket `chat.send`（不是 HTTP /api/agent SSE）：
// HTTP /api/agent 写死 permissionMode=bypassPermissions（root 下变 auto），SDK 在
// auto/bypass 会跳过 canUseTool，AskUserQuestion 永远到不了前端 —— 只能模型自己编答案。
// WS 默认 permission 走 canUseTool → permission_request → 本服务透出 question →
// 前端选项卡 → POST action=answer → chat.permission-response 回给 CloudCLI。
// WS 不可用/会话行不存在时回退旧 HTTP SSE（非交互，但聊天不断）。
//
// 安全：CloudCLI key/JWT 只在 server.env（服务端内存），不透传任何用户凭据；
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
const TASK_MAX_MS = 25 * 60 * 1000;   // 单任务绝对上限（不含等待用户作答）

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

// 结构化 questions（给前端选项卡）；answers 已有则一并带出
function parseAskPayload(input) {
  const obj = parseToolInput(input);
  const qs = obj && Array.isArray(obj.questions) ? obj.questions : null;
  if (!qs || !qs.length) return null;
  const answers = (obj.answers && typeof obj.answers === 'object') ? obj.answers : null;
  const questions = [];
  for (const raw of qs) {
    const q = parseToolInput(raw);
    if (!q) continue;
    const text = String(q.question || '').trim();
    if (!text) continue;
    const options = [];
    const opts = Array.isArray(q.options) ? q.options : [];
    for (const o of opts) {
      if (typeof o === 'string') {
        const label = o.trim();
        if (label) options.push({ label, description: '' });
      } else if (o && typeof o === 'object') {
        const label = String(o.label || o.value || '').trim();
        if (label) options.push({ label, description: String(o.description || '') });
      }
    }
    questions.push({
      question: text,
      header: String(q.header || '').trim(),
      multiSelect: !!q.multiSelect,
      options,
      answer: answers ? String(answers[text] || (q.id ? answers[q.id] : '') || '') : '',
    });
  }
  if (!questions.length) return null;
  return { questions };
}

// 事件解析：对两种格式都做防御
// 1) normalized 消息 {kind:'text'|'stream_delta'|'tool_use'|'session_created'|..., role, content}
// 2) 旧版 {type:'claude-response', data:{type:'assistant', message:{content:[{type:'text',text}]}}}
function applyEvent(t, ev) {
  if (!ev || typeof ev !== 'object') return;

  // SSEStreamWriter 控制帧 / WS 协议帧
  // WS 链路会话号保持 app 行 id（回复前端持久化）；provider id 只用于续跑，不能反写
  if (ev.type === 'session-id' && ev.sessionId) {
    if (!t.resolvedSid) t.sessionId = String(ev.sessionId);
    return;
  }
  if (ev.type === 'done') { t.done = true; return; }
  if (ev.type === 'error') { t.error = String(ev.error || ev.message || '未知错误'); return; }
  if (ev.type === 'status') return; // token_budget 等心跳
  if (ev.kind === 'protocol_error') {
    t.error = String(ev.error || ev.code || 'CloudCLI 协议错误');
    t.done = true;
    return;
  }
  if (ev.kind === 'session_upserted' || ev.kind === 'chat_subscribed' || ev.kind === 'loading_progress') return;

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
    if (sid && !t.resolvedSid) t.sessionId = String(sid);
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
  if (kind === 'permission_request') {
    const name = String(ev.toolName || ev.tool || '');
    if (name && t.tools[t.tools.length - 1] !== name) t.tools.push(name);
    if (ASK_TOOLS.has(name)) {
      const input = parseToolInput(ev.input || ev.toolInput) || {};
      const payload = parseAskPayload(input);
      // 气泡里留可读问题卡（作答后会补「已选择」）
      const q = formatAskQuestion(input);
      if (q && !t.asked.has(q)) {
        t.asked.add(q);
        t.texts.push(q);
        t.delta = '';
        t.askTextAt = t.texts.length - 1;
      }
      // 结构化选项卡只在 WS 链路（有 requestId 才能作答；HTTP 无 canUseTool 不会走到这）
      if (payload && ev.requestId && t.ws) {
        t.question = {
          requestId: String(ev.requestId),
          toolName: name,
          questions: payload.questions,
          input,
        };
      }
    }
    return;
  }
  if (kind === 'permission_resolved') {
    if (t.question && String(ev.requestId || '') === t.question.requestId) {
      t.question = null;
    }
    return;
  }
  if (kind === 'tool_use') {
    const name = String(ev.toolName || ev.tool || '');
    if (name && t.tools[t.tools.length - 1] !== name) t.tools.push(name);
    if (ASK_TOOLS.has(name)) {
      const q = formatAskQuestion(ev.toolInput);
      if (q && !t.asked.has(q)) {
        t.asked.add(q);
        t.texts.push(q);
        t.delta = ''; // 问题卡进入可见文本，避免流式残余盖住
        t.askTextAt = t.texts.length - 1;
      }
    }
    return;
  }
  if (kind === 'error') { t.error = String(ev.content || '未知错误'); return; }
  if (kind === 'complete') { t.done = true; return; }
}

function mintCloudcliJwt() {
  if (!cfg.CLOUDCLI_JWT_SECRET) {
    throw new Error('服务端未配置 CLOUDCLI_JWT_SECRET');
  }
  return jwt.sign(
    { userId: cfg.CLOUDCLI_USER_ID, username: cfg.CLOUDCLI_USER },
    cfg.CLOUDCLI_JWT_SECRET,
    { expiresIn: '2h' },
  );
}

function cloudcliWsUrl(token) {
  const u = new URL(cfg.CLOUDCLI_BASE);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '?token=' + encodeURIComponent(token);
  return u.toString();
}

// 新会话：先在 CloudCLI 建 app session 行（chat.send 硬性要求 sessionId 已存在）
async function createCloudcliSession(initialMessage) {
  const r = await cloudcliApi('POST', '/api/providers/sessions', {
    provider: 'claude',
    projectPath: '/',
    initialMessage: String(initialMessage || '').slice(0, 200),
  });
  if (r.status === 201 && r.json && r.json.success && r.json.data && r.json.data.sessionId) {
    return String(r.json.data.sessionId);
  }
  const detail = (r.json && (r.json.error || r.json.code)) || ('HTTP ' + r.status);
  throw new Error('创建 CloudCLI 会话失败: ' + detail);
}

// 查会话行并归一化成 app-facing id：用 provider-native id 查询时 CloudCLI 也会
// 返回对应行（data.sessionId 是 app id）。空串 = 行不存在，走 HTTP 回退。
async function resolveSessionRowId(sessionId) {
  try {
    const r = await cloudcliApi('GET', '/api/providers/sessions/' + encodeURIComponent(sessionId));
    if (r.status === 200 && r.json && r.json.success) {
      const rowId = r.json.data && r.json.data.sessionId;
      return String(rowId || sessionId);
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 打开 CloudCLI WebSocket（失败由调用方决定回退）
function openCloudcliWs() {
  return new Promise((resolve, reject) => {
    if (!cfg.CLOUDCLI_JWT_SECRET) return reject(new Error('服务端未配置 CLOUDCLI_JWT_SECRET'));
    let ws;
    try {
      ws = new WebSocket(cloudcliWsUrl(mintCloudcliJwt()));
    } catch (e) { return reject(e); }
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) { /* ignore */ }
      done(reject, new Error('连接 CloudCLI WebSocket 超时'));
    }, 10000);
    ws.addEventListener('open', () => done(resolve, ws), { once: true });
    ws.addEventListener('error', () => done(reject, new Error('无法连接 CloudCLI WebSocket')), { once: true });
    ws.addEventListener('close', () => done(reject, new Error('CloudCLI WebSocket 连接关闭')), { once: true });
  });
}

// ===== WS 主链路：ws 已打开，chat.send 由本函数发出 =====
function startJobWs(message, sessionId, ws) {
  const taskId = crypto.randomUUID();
  const t = {
    id: taskId, status: 'running',
    texts: [], delta: '', tools: [], asked: new Set(),
    sessionId: sessionId || '', error: '', done: false,
    question: null, askTextAt: -1,
    createdAt: Date.now(), finishedAt: 0,
    ws, resolvedSid: sessionId || '',
  };
  tasks.set(taskId, t);
  runningTaskId = taskId;

  let finished = false;
  let absoluteTimer = null;
  let budgetLeft = TASK_MAX_MS;   // 绝对预算；等用户作答时不扣
  let lastTick = Date.now();

  const finish = (status, error) => {
    if (finished) return;
    finished = true;
    if (absoluteTimer) clearTimeout(absoluteTimer);
    t.status = status;
    if (error) t.error = error;
    t.finishedAt = Date.now();
    t.question = null;
    if (runningTaskId === taskId) runningTaskId = '';
    try { if (t.ws) t.ws.close(); } catch (e) { /* ignore */ }
    t.ws = null;
  };

  const sendWs = (obj) => {
    if (t.ws && t.ws.readyState === 1) t.ws.send(JSON.stringify(obj));
  };

  // 预算心跳：作答窗口（t.question 存在）不扣时
  const armAbsolute = () => {
    if (absoluteTimer) clearTimeout(absoluteTimer);
    const waitMs = t.question ? 15000 : Math.max(5000, Math.min(budgetLeft, 60000));
    absoluteTimer = setTimeout(function tickBudget() {
      const now = Date.now();
      if (!t.question) budgetLeft -= (now - lastTick);
      lastTick = now;
      if (budgetLeft <= 0) {
        try { sendWs({ type: 'chat.abort', sessionId: t.resolvedSid || t.sessionId }); } catch (e) { /* ignore */ }
        finish('error', '任务超时（25 分钟），已中止');
        return;
      }
      armAbsolute();
    }, waitMs);
    if (absoluteTimer.unref) absoluteTimer.unref();
  };

  t.cancel = () => {
    if (finished) return false;
    try { sendWs({ type: 'chat.abort', sessionId: t.resolvedSid || t.sessionId }); } catch (e) { /* ignore */ }
    finish('cancelled');
    return true;
  };

  // 作答：把 answers 写进 updatedInput，经 WS 回给 canUseTool
  t.answer = (payload) => {
    if (finished || !t.question) return { ok: false, error: '没有待回答的问题' };
    const allow = payload && payload.allow === false ? false : true;
    const answers = (payload && payload.answers && typeof payload.answers === 'object') ? payload.answers : {};
    const input = Object.assign({}, t.question.input || {});
    if (allow) input.answers = answers;
    else input.answers = input.answers || {};
    const requestId = t.question.requestId;
    // 先落气泡「已选择」再清 question（permission_resolved 也会清，双保险）
    if (allow) {
      const q = formatAskQuestion(input);
      if (q && t.askTextAt >= 0 && t.askTextAt < t.texts.length) {
        t.texts[t.askTextAt] = q;
        t.asked.add(q);
      } else if (q && !t.asked.has(q)) {
        t.texts.push(q);
        t.asked.add(q);
      }
    }
    t.question = null;
    sendWs({
      type: 'chat.permission-response',
      requestId,
      allow,
      updatedInput: allow ? input : undefined,
      message: allow ? undefined : String((payload && payload.message) || '用户跳过了问题'),
    });
    armAbsolute();
    return { ok: true };
  };

  armAbsolute();

  ws.addEventListener('message', (ev) => {
    if (finished) return;
    let data;
    try { data = JSON.parse(String(ev.data)); } catch (e) { return; }
    applyEvent(t, data);
    if (t.question) armAbsolute(); // 进入作答窗口 → 改短心跳、不扣预算
    if (t.done) {
      finish(t.error ? 'error' : 'done');
      return;
    }
  });
  ws.addEventListener('close', () => {
    if (finished) return;
    // 连接断了但还没 complete：有文本当 done，否则报错
    if (t.error) finish('error', t.error);
    else if (liveText(t)) finish('done');
    else finish('error', '与 CloudCLI 的连接中断');
  });

  sendWs({
    type: 'chat.send',
    sessionId,
    content: message,
    options: {
      model: cfg.CLOUDCLI_MODEL || undefined,
      // 必须显式 default：CloudCLI 在 auto/bypass 模式会跳过 canUseTool，
      // AskUserQuestion 被模型/分类器自动作答，前端永远收不到 permission_request
      permissionMode: 'default',
    },
  });
  return taskId;
}

// ===== HTTP SSE 回退（WS 失败 / 会话行缺失）=====
function startJobHttp(message, sessionId) {
  const taskId = crypto.randomUUID();
  const t = {
    id: taskId, status: 'running',
    texts: [], delta: '', tools: [], asked: new Set(),
    sessionId: sessionId || '', error: '', done: false,
    question: null, askTextAt: -1,
    createdAt: Date.now(), finishedAt: 0,
    resolvedSid: sessionId || '',
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
    t.question = null;
    if (runningTaskId === taskId) runningTaskId = '';
  };

  t.cancel = () => {
    if (finished) return false;
    finish('cancelled');
    try { if (req) req.destroy(); } catch (e) { /* ignore */ }
    return true;
  };

  // HTTP 回退不支持交互作答
  t.answer = () => ({ ok: false, error: '当前任务不支持在线作答，请在 CloudCLI 网页版操作' });

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

// 统一入口（chat 路由）：预解析会话行 → 开 WS → 挂任务；任何一步失败回退 HTTP（taskId 唯一）
async function startJobSmart(message, sessionId) {
  const sid = String(sessionId || '').trim();
  let resolved = '';
  if (sid) {
    // 旧前端可能持久化了 provider-native id：归一化成 app id 才能进 WS
    const rowId = await resolveSessionRowId(sid);
    if (!rowId) {
      console.log('[claude] fallback http: session row missing sid=' + sid.slice(0, 8));
      return startJobHttp(message, sid);
    }
    resolved = rowId;
    if (resolved !== sid) {
      console.log('[claude] normalized session ' + sid.slice(0, 8) + ' -> app id ' + resolved.slice(0, 8));
    }
  } else {
    try {
      resolved = await createCloudcliSession(message);
    } catch (e) {
      // 建行失败不挡聊天：HTTP /api/agent 自己会建 session_created
      console.log('[claude] fallback http: create session failed: ' + e.message);
      return startJobHttp(message, '');
    }
  }

  let ws;
  try {
    ws = await openCloudcliWs();
  } catch (e) {
    // WS 打不开只能 HTTP：该链路无 canUseTool，AskUserQuestion 不会有弹窗
    console.log('[claude] fallback http: ws open failed: ' + e.message);
    return startJobHttp(message, resolved || sid);
  }
  console.log('[claude] path=ws sid=' + resolved.slice(0, 8));
  return startJobWs(message, resolved, ws);
}

// GET /api/claude?action=task&id=xxx → {status, text, sessionId, tools, question?, error?}
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
      question: t.question
        ? {
            requestId: t.question.requestId,
            toolName: t.question.toolName,
            questions: t.question.questions,
          }
        : undefined,
      error: t.error || undefined,
    });
  }
  if (action === 'sessions') return handleSessions(req, res);
  if (action === 'history') return handleHistory(req, res);
  return res.status(404).json({ error: 'not_found' });
});

// POST /api/claude?action=chat {message,sessionId} → {ok,taskId}
// POST /api/claude?action=answer {id,requestId,answers,allow} → {ok}
// POST /api/claude?action=rename {id,title} | action=delete {id} | action=cancel {id}
router.post('/claude', (req, res) => {
  const action = String(req.query.action || '');
  if (action === 'chat') return handleChat(req, res);
  if (action === 'answer') return handleAnswer(req, res);
  if (action === 'rename') return handleRename(req, res);
  if (action === 'delete') return handleDelete(req, res);
  if (action === 'cancel') return handleCancel(req, res);
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

function handleCancel(req, res) {
  const id = String((req.body && req.body.id) || '').trim();
  if (!id) return res.status(400).json({ error: 'id 必填' });
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: 'task_not_found' });
  if (t.status !== 'running') return res.json({ ok: true, status: t.status });
  t.cancel();
  return res.json({ ok: true, status: 'cancelled' });
}

function handleAnswer(req, res) {
  const body = req.body || {};
  const id = String(body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id 必填' });
  const t = tasks.get(id);
  if (!t) return res.status(404).json({ error: 'task_not_found' });
  if (t.status !== 'running' || !t.question) {
    return res.status(409).json({ error: 'no_question', hint: '没有待回答的问题（可能已超时或已作答）' });
  }
  const requestId = String(body.requestId || '').trim();
  if (requestId && requestId !== t.question.requestId) {
    return res.status(409).json({ error: 'request_mismatch' });
  }
  if (typeof t.answer !== 'function') {
    return res.status(409).json({ error: 'no_question' });
  }
  const r = t.answer({
    allow: body.allow !== false,
    answers: body.answers && typeof body.answers === 'object' ? body.answers : {},
    message: body.message,
  });
  if (!r.ok) return res.status(409).json({ error: r.error || 'answer_failed' });
  return res.json({ ok: true });
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

async function handleChat(req, res) {
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
  try {
    const taskId = await startJobSmart(message, sessionId);
    return res.json({ ok: true, taskId });
  } catch (e) {
    return res.status(502).json({ error: e.message || '启动任务失败' });
  }
}

module.exports = router;
