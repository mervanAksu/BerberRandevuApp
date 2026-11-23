import { processReminders } from './reminders.mjs';

// Only a scheduler with the separately provisioned job credential can run this endpoint.
export async function reminderJob(request, env) {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  const secret = env.JOB_SECRET;
  const supplied = request.headers.get('authorization');
  if (typeof secret !== 'string' || secret.length < 32 || !supplied || supplied.length > 1024) {
    return new Response(null, { status: 403, headers });
  }
  const encode = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const expected = await crypto.subtle.sign('HMAC', key, encode.encode('Bearer ' + secret));
  if (!await crypto.subtle.verify('HMAC', key, expected, encode.encode(supplied))) {
    return new Response(null, { status: 403, headers });
  }
  return Response.json(await processReminders(env), { headers });
}
