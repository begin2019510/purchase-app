// push 公共模块 - 被所有 push 函数共享
import { CORS_ORIGINS, getCorsHeaders, jsonResponse, getFeishuToken } from '../_auth.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

export { CORS_ORIGINS };
export const corsHeaders = getCorsHeaders;
export const json = jsonResponse;
export const getToken = getFeishuToken;

export async function feishuFetch(method, path, body, env) {
  const token = await getToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_BASE}${path}`, opts);
  return res.json();
}

export async function getAllRecords(app, table, env) {
  const records = [];
  let pageToken = '';
  do {
    const url = `/bitable/v1/apps/${app}/tables/${table}/records?page_size=500${pageToken ? '&page_token=' + pageToken : ''}`;
    const data = await feishuFetch('GET', url, null, env);
    if (data.code !== 0) throw new Error('Feishu API error: ' + JSON.stringify(data));
    if (data.data?.items) records.push(...data.data.items);
    pageToken = data.data?.page_token || '';
  } while (pageToken);
  return records;
}
