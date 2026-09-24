// The realm a preview scene sees: storage requests go to the preview server's own origin.
export async function getRealm() {
  return { realmInfo: { isPreview: true, baseUrl: process.env.PREVIEW_URL ?? 'http://localhost:8123', realmName: 'LocalPreview' } }
}
