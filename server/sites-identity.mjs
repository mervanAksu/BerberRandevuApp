// Only the Sites Worker entry point calls this adapter. The local HTTP server
// does not read identity headers. Enable the adapter only behind Sites dispatch.
export function sitesIdentity(request, env) {
  if (env.SITES_MANAGED_IDENTITY !== 'enabled' || !env.OWNER_EMAIL?.trim()) return {};
  const subject = request.headers.get('oai-authenticated-user-id')?.trim();
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const state = !subject || !email ? 'missing' :
    email === env.OWNER_EMAIL.trim().toLowerCase() ? 'owner' : 'other';
  return { OWNER_HOSTED_IDENTITY: state };
}
