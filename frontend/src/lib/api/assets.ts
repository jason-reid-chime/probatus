import { supabase } from '../supabase'
import { db } from '../db'
import type { LocalAsset } from '../db'

// ---------------------------------------------------------------------------
// fetchAssets
// ---------------------------------------------------------------------------
export async function fetchAssets(tenantId: string): Promise<LocalAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('next_due_at', { ascending: true, nullsFirst: false })

  if (error) throw error

  const assets = (data ?? []) as LocalAsset[]

  // Cache in Dexie
  await db.assets.bulkPut(assets)

  return assets
}

// ---------------------------------------------------------------------------
// fetchAssetByTagId
// ---------------------------------------------------------------------------
export async function fetchAssetByTagId(
  tenantId: string,
  tagId: string,
): Promise<LocalAsset | null> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('tag_id', tagId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const asset = data as LocalAsset

  // Cache in Dexie
  await db.assets.put(asset)

  return asset
}

// ---------------------------------------------------------------------------
// upsertAsset
// ---------------------------------------------------------------------------
export async function upsertAsset(
  asset: Omit<LocalAsset, 'updated_at'>,
): Promise<LocalAsset> {
  const now = new Date().toISOString()
  const payload: LocalAsset = { ...asset, updated_at: now }

  const { data, error } = await supabase
    .from('assets')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('A asset with this Tag ID already exists. Please use a unique tag ID.')
    }
    throw error
  }

  const saved = data as LocalAsset

  // Cache in Dexie
  await db.assets.put(saved)

  return saved
}

// ---------------------------------------------------------------------------
// deleteAsset
// ---------------------------------------------------------------------------
export async function deleteAsset(id: string): Promise<void> {
  const { error } = await supabase.from('assets').delete().eq('id', id)

  if (error) throw error

  // Remove from Dexie
  await db.assets.delete(id)
}
