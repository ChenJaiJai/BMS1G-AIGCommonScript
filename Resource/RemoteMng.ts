import { Asset, ImageAsset, SpriteFrame, Texture2D, VideoClip, assetManager } from 'cc';

export interface RemoteLoadOptions {
    signal?: AbortSignal;
    reload?: boolean;
}

class RemoteMng {
    async load<T extends Asset>(
        url: string,
        ext: string,
        defaultUrl?: string,
        options: RemoteLoadOptions = {},
    ): Promise<T> {
        const tryLoad = (path: string) => new Promise<T>((resolve, reject) => {
            if (options.signal?.aborted) { reject(new Error('資源載入已取消')); return; }
            const loadOptions = options.reload ? { ext, reloadAsset: true, maxRetryCount: 0 } : { ext };
            assetManager.loadRemote<T>(path, loadOptions, (err, asset) => {
                if (options.signal?.aborted) {
                    if (asset) assetManager.releaseAsset(asset);
                    reject(new Error('資源載入已取消'));
                    return;
                }
                if (err || !asset) {
                    if (asset) assetManager.releaseAsset(asset);
                    reject(err ?? new Error(`loadRemote 失敗：${path}`));
                    return;
                }
                resolve(asset);
            });
        });

        try {
            return await tryLoad(url);
        } catch (error) {
            if (options.signal?.aborted || !defaultUrl || defaultUrl === url) throw error;
            console.error(`[RemoteMng] ${url} 沒有資源，改載入預設資源 ${defaultUrl}`, error);
            return await tryLoad(defaultUrl);
        }
    }

    /** PNG URL → SpriteFrame。第二參數為失敗時的預設 URL。 */
    async loadSpriteFrame(url: string, defaultUrl?: string, options: RemoteLoadOptions = {}): Promise<SpriteFrame> {
        let image: ImageAsset | undefined;
        try {
            image = await this.load<ImageAsset>(url, '.png', defaultUrl, options);
            return SpriteFrame.createWithImage(image);
        } catch (error) {
            if (image) assetManager.releaseAsset(image);
            const fallback = defaultUrl && defaultUrl !== url ? `（預設 ${defaultUrl} 也失敗）` : '';
            if (!options.signal?.aborted) console.error(`[RemoteMng] 下載失敗：${url}${fallback}`, error);
            throw error;
        }
    }

    /**
     * 影片 URL → VideoClip，並把 `_nativeUrl` 換成同源 blob。
     * loadRemote 對影片通常只掛 https，直接播會 tainted canvas（WebM／MP4 都要進 canvas）。
     * `ext` 依 URL 副檔名：`.webm` 或 `.mp4`。
     */
    async loadVideoClip(url: string, defaultUrl?: string, options: RemoteLoadOptions = {}): Promise<VideoClip> {
        let clip: VideoClip | undefined;
        try {
            const ext = this.videoExt(url);
            clip = await this.load<VideoClip>(url, ext, defaultUrl, options);
            const src = clip.nativeUrl || url;
            if (src.startsWith('blob:')) return clip;

            const res = await fetch(src, { signal: options.signal, cache: options.reload ? 'no-store' : 'default' });
            if (!res.ok) throw new Error(`fetch 影片失敗：${src} ${res.status}`);
            const blob = await res.blob();
            if (options.signal?.aborted) throw new Error('資源載入已取消');
            (clip as { _nativeUrl: string })._nativeUrl = URL.createObjectURL(blob);
            return clip;
        } catch (error) {
            if (clip) this.releaseVideoClip(clip);
            if (!options.signal?.aborted) console.error(`[RemoteMng] 影片下載失敗：${url}`, error);
            throw error;
        }
    }

    releaseVideoClip(clip: VideoClip): void {
        if (clip.nativeUrl?.startsWith('blob:')) URL.revokeObjectURL(clip.nativeUrl);
        assetManager.releaseAsset(clip);
    }

    /** createWithImage creates runtime SpriteFrame/Texture2D, both owned by the caller. */
    releaseSpriteFrame(sf: SpriteFrame): void {
        const texture = sf.texture as Texture2D;
        const image = texture?.image;
        assetManager.releaseAsset(sf);
        if (texture?.isValid) assetManager.releaseAsset(texture);
        if (image?.isValid) assetManager.releaseAsset(image);
    }

    private videoExt(url: string): '.webm' | '.mp4' {
        const path = url.split(/[?#]/)[0];
        const dot = path.lastIndexOf('.');
        const ext = dot >= 0 ? path.slice(dot) : '';
        if (ext === '.webm' || ext === '.mp4') return ext;
        throw new Error(`[RemoteMng] 不支援的影片副檔名：${url}`);
    }
}

export default new RemoteMng();
