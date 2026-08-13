import { Asset, VideoClip } from 'cc';

/** 由 WebM 資源目錄建立檔名 → VideoClip 對照表。 */
export function buildWebmClipMap(assets: Asset[]): Map<string, VideoClip> {
    const map = new Map<string, VideoClip>();
    for (const asset of assets) {
        map.set(asset.name, asset as unknown as VideoClip);
    }
    return map;
}
