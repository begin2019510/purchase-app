export async function onRequest(context) {
  const { env } = context;
  const keys = Object.keys(env || {});
  return new Response(JSON.stringify({
    envKeys: keys,
    apiKeyExists: 'API_KEY' in (env || {}),
    apiKeyValue: env.API_KEY ? '***' + String(env.API_KEY).slice(-2) : 'undefined',
    envType: typeof env,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
