/** QR payload for an asset label: a link that opens the asset in the app. */
export function assetLabelUrl(assetId: string, origin = window.location.origin): string {
  return `${origin}/assets/${assetId}`
}

/**
 * Work out which asset a scanned code refers to. Our labels encode the asset
 * URL; older or third-party labels usually encode just the tag ID.
 */
export function resolveScan(
  text: string,
  assets: { id: string; tag_id: string }[],
): { kind: 'asset'; id: string } | { kind: 'tag'; tag: string } {
  const trimmed = text.trim()
  const m = trimmed.match(/\/assets\/([0-9a-f-]{36})(?:[/?#]|$)/i)
  if (m) return { kind: 'asset', id: m[1] }
  const byTag = assets.filter((a) => a.tag_id.toLowerCase() === trimmed.toLowerCase())
  if (byTag.length === 1) return { kind: 'asset', id: byTag[0].id }
  return { kind: 'tag', tag: trimmed }
}
