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
const cfg = require('../config');
const { requireAuth } = require('../middleware');

const router = express.Router();
// 挂载于 app.use('/api', ...)，路径写全子路径（与 auth.js / report.js 同模式）
router.use('/claude', requireAuth);

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
  if (kind === 'tool_use') {
    const name = String(ev.toolName || ev.tool || '');
    if (name && t.tools[t.tools.length - 1] !== name) t.tools.push(name);
    return;
  }
  if (kind === 'error') { t.error = String(ev.content || '未知错误'); return; }
  if (kind === 'complete') { t.done = true; return; }
}

function startJob(message, sessionId) {
  const taskId = crypto.randomUUID();
  const t = {
    id: taskId, status: 'running',
    texts: [], delta: '', tools: [],
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

// POST /api/claude?action=chat  {message, sessionId?} → {taskId}
router.post('/claude', (req, res) => {
  const action = String(req.query.action || '');
  if (action !== 'chat') return res.status(404).json({ error: 'not_found' });

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
});

// GET /api/claude?action=task&id=xxx → {status, text, sessionId, tools, error?}
router.get('/claude', (req, res) => {
  const action = String(req.query.action || '');
  if (action !== 'task') return res.status(404).json({ error: 'not_found' });

  const t = tasks.get(String(req.query.id || ''));
  if (!t) return res.status(404).json({ error: 'task_not_found', hint: '任务不存在或服务已重启，请重新发送' });
  return res.json({
    status: t.status,
    text: liveText(t),
    sessionId: t.sessionId,
    tools: t.tools,
    error: t.error || undefined,
  });
});

module.exports = router;
