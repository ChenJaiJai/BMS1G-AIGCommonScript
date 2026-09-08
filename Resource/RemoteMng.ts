import { Asset, ImageAsset, SpriteFrame, VideoClip, assetManager } from 'cc';

class RemoteMng {
    async load<T extends Asset>(
        url: string,
        ext: string,
        defaultUrl?: string,
    ): Promise<T> {
        const tryLoad = (path: string) => new Promise<T>((resolve, reject) => {
            assetManager.loadRemote<T>(path, { ext }, (err, asset) => {
                if (err || !asset) {
                    reject(err ?? new Error(`loadRemote 失敗：${path}`));
                    return;
                }
                resolve(asset);
            });
        });

        try {
            return await tryLoad(url);
        } catch (error) {
            if (!defaultUrl || defaultUrl === url) throw error;
            console.error(`[RemoteMng] ${url} 沒有資源，改載入預設資源 ${defaultUrl}`, error);
            return await tryLoad(defaultUrl);
        }
    }

    /** PNG URL → SpriteFrame。第二參數為失敗時的預設 URL。 */
    async loadSpriteFrame(url: string, defaultUrl?: string): Promise<SpriteFrame> {
        try {
            const image = await this.load<ImageAsset>(url, '.png', defaultUrl);
            return SpriteFrame.createWithImage(image);
        } catch (error) {
            const fallback = defaultUrl && defaultUrl !== url ? `（預設 ${defaultUrl} 也失敗）` : '';
            console.error(`[RemoteMng] 下載失敗：${url}${fallback}`, error);
            throw error;
        }
    }

    /**
     * 影片 URL → VideoClip，並把 `_nativeUrl` 換成同源 blob。
     * loadRemote 對影片通常只掛 https，直接播會 tainted canvas（WebM／MP4 都要進 canvas）。
     * `ext` 依 URL 副檔名：`.webm` 或 `.mp4`。
     */
    async loadVideoClip(url: string, defaultUrl?: string): Promise<VideoClip> {
        const ext = this.videoExt(url);
        const clip = await this.load<VideoClip>(url, ext, defaultUrl);
        const src = clip.nativeUrl || url;
        if (src.startsWith('blob:')) return clip;

        const res = await fetch(src);
        if (!res.ok) throw new Error(`fetch 影片失敗：${src} ${res.status}`);
        (clip as { _nativeUrl: string })._nativeUrl = URL.createObjectURL(await res.blob());
        return clip;
    }

    private videoExt(url: string): '.webm' | '.mp4' {
        const path = url.split('?')[0].toLowerCase();
        const dot = path.lastIndexOf('.');
        const ext = dot >= 0 ? path.slice(dot) : '';
        if (ext === '.webm' || ext === '.mp4') return ext;
        throw new Error(`[RemoteMng] 不支援的影片副檔名：${url}`);
    }
}

export default new RemoteMng();
