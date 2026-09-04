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
     * mp4 URL → VideoClip，並把 `_nativeUrl` 換成同源 blob。
     * loadRemote 對影片通常只掛 https，直接播會 tainted canvas。
     */
    async loadVideoClip(url: string, defaultUrl?: string): Promise<VideoClip> {
        const clip = await this.load<VideoClip>(url, '.mp4', defaultUrl);
        const src = clip.nativeUrl || url;
        if (src.startsWith('blob:')) return clip;

        const res = await fetch(src);
        if (!res.ok) throw new Error(`fetch 影片失敗：${src} ${res.status}`);
        (clip as { _nativeUrl: string })._nativeUrl = URL.createObjectURL(await res.blob());
        return clip;
    }
}

export default new RemoteMng();
