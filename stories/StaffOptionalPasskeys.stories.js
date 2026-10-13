import passkeyUx from '../src/presentation/staffPasskeyUx.js';
function surface(credentials) {
  const html = passkeyUx.managePage({ credentials, optionalPasskeys: true });
  return (
    `<style>${[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')}</style>` +
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1]
  );
}
export default {
  title: 'Staff/Optional passkeys',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};
export const SavedPasskey = {
  render: () =>
    surface([
      { id: 900001, label: 'Synthetic phone', current: true, createdAt: '2026-10-13T06:00:00Z' },
      { id: 900002, label: 'Synthetic removed phone', revokedAt: '2026-10-13T06:00:00Z' },
    ]),
};
export const NoPasskeys = { render: () => surface([]) };
