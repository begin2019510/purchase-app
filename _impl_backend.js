const fs = require('fs');
let code = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\items.js', 'utf8');

// 1. Add helper functions before the onRequest export
const insertBefore = 'export async function onRequest(context) {';

const helpers = `
// ===== Todo linking helpers =====
async function getFeishuTokenForItems(env) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  return data.tenant_access_token;
}

async function createLinkedTodo(env, todoApp, todoTable, item, title, dueDate, priority) {
  try {
    const token = await getFeishuTokenForItems(env);
    const fields = {
      '\u6807\u9898': title.slice(0, 200),
      '\u4f18\u5148\u7ea7': priority || '\u4e2d',
      '\u5206\u7c7b': '\u91c7\u8d2d',
      '\u72b6\u6001': '\u5f85\u529e',
      '\u91cd\u590d': '\u65e0',
      '\u5b50\u4efb\u52a1': '[]',
      '\u5173\u8054\u7c7b\u578b': '\u91c7\u8d2d',
      '\u5173\u8054ID': item.id || '',
    };
    if (dueDate) fields['\u622a\u6b62\u65e5\u671f'] = new Date(dueDate).getTime();
    await fetch(\`https://open.feishu.cn/open-apis/bitable/v1/apps/\${todoApp}/tables/\${todoTable}/records\`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  } catch (e) { console.error('createLinkedTodo error:', e.message); }
}

async function deleteLinkedTodos(env, todoApp, todoTable, itemId) {
  try {
    const token = await getFeishuTokenForItems(env);
    // Search for todos linked to this item
    const searchUrl = \`https://open.feishu.cn/open-apis/bitable/v1/apps/\${todoApp}/tables/\${todoTable}/records/search\`;
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { conjunction: 'and', conditions: [{ field_name: '\u5173\u8054ID', operator: 'is', value: [itemId] }] },
        page_size: 50,
      }),
    });
    const data = await res.json();
    if (data.data?.items) {
      for (const rec of data.data.items) {
        await fetch(\`https://open.feishu.cn/open-apis/bitable/v1/apps/\${todoApp}/tables/\${todoTable}/records/\${rec.record_id}\`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token },
        });
      }
    }
  } catch (e) { console.error('deleteLinkedTodos error:', e.message); }
}

async function completeLinkedTodos(env, todoApp, todoTable, itemId, titlePrefix) {
  try {
    const token = await getFeishuTokenForItems(env);
    const searchUrl = \`https://open.feishu.cn/open-apis/bitable/v1/apps/\${todoApp}/tables/\${todoTable}/records/search\`;
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { conjunction: 'and', conditions: [
          { field_name: '\u5173\u8054ID', operator: 'is', value: [itemId] },
          { field_name: '\u6807\u9898', operator: 'contains', value: [titlePrefix] },
        ]},
        page_size: 10,
      }),
    });
    const data = await res.json();
    if (data.data?.items) {
      for (const rec of data.data.items) {
        await fetch(\`https://open.feishu.cn/open-apis/bitable/v1/apps/\${todoApp}/tables/\${todoTable}/records/\${rec.record_id}\`, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { '\u72b6\u6001': '\u5df2\u5b8c\u6210', '\u5b8c\u6210\u65f6\u95f4': Date.now() } }),
        });
      }
    }
  } catch (e) { console.error('completeLinkedTodos error:', e.message); }
}

function calcInstallmentDate(baseDate, period) {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + period);
  d.setDate(15); // 15th of each month
  return d.toISOString().slice(0, 10);
}

`;

code = code.replace(insertBefore, helpers + insertBefore);
console.log('1. Added helper functions');

// 2. Add todo linking logic in PATCH handler after status update
// Find the PATCH handler's status update loop
const patchMarker = '        results.push({ id, ok: data.code === 0 });';
const todoLogic = `        results.push({ id, ok: data.code === 0 });

        // Todo linking: auto-create/delete/complete todos on status change
        if (body.status && user.bitable?.todoApp && user.bitable?.todoTable) {
          const todoApp = user.bitable.todoApp;
          const todoTable = user.bitable.todoTable;
          // Get item details for todo creation
          if (body.status === '\u5df2\u5ba1\u6279' || body.status === '\u5df2\u4e0b\u5355' || body.status === '\u5df2\u5230' || body.status === '\u5df2\u9000' || body.status === '\u5df2\u53d6\u6d88') {
            try {
              const itemRes = await feishuFetch('GET', \`/bitable/v1/apps/\${APP}/tables/\${TABLE}/records/\${id}\`, null, env);
              const item = itemRes.data?.record?.fields || {};
              const itemName = item['\u5546\u54c1\u540d\u79f0'] || '\u5546\u54c1';
              const instPeriods = Number(item['\u5206\u671f\u671f\u6570']) || 0;
              const instAmount = Number(item['\u5206\u671f\u91d1\u989d']) || 0;

              if (body.status === '\u5df2\u5ba1\u6279') {
                await createLinkedTodo(env, todoApp, todoTable, {id}, '\u4e0b\u5355\uff1a' + itemName, null, '\u9ad8');
              }
              if (body.status === '\u5df2\u4e0b\u5355' && instPeriods > 1) {
                for (let p = 1; p <= instPeriods; p++) {
                  const due = calcInstallmentDate(item['\u65e5\u671f'] || Date.now(), p);
                  await createLinkedTodo(env, todoApp, todoTable, {id}, \`\u7b2c\${p}\u671f\u8fd8\u6b3e \u00a5\${instAmount}\`, due, '\u4e2d');
                }
              }
              if (body.status === '\u5df2\u5230') {
                await completeLinkedTodos(env, todoApp, todoTable, id, '\u4e0b\u5355');
              }
              if (body.status === '\u5df2\u9000' || body.status === '\u5df2\u53d6\u6d88') {
                await deleteLinkedTodos(env, todoApp, todoTable, id);
              }
            } catch (e) { console.error('Todo linking error:', e.message); }
          }
        }`;

code = code.replace(patchMarker, todoLogic);
console.log('2. Added todo linking in PATCH handler');

fs.writeFileSync('D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\items.js', code, 'utf8');
console.log('items.js updated!');
