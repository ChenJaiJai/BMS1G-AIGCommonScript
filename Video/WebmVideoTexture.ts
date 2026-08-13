import { Rect, SpriteFrame, Texture2D } from 'cc';

/**
 * 將 HTMLVideoElement 的當前幀轉成 Cocos Texture2D / SpriteFrame。
 *
 * 影片 → GPU 注意：
 * 1) 不可用 ImageAsset(video)：ImageAsset.data 不認 HTMLVideoElement，貼圖永遠不會上傳。
 * 2) 不可直接 uploadData(video)：3.8 的 WebGL2 後端對「video 且同尺寸」走 texImage2D 路徑，
 *    但 Texture2D 預設用 texStorage2D 建立 immutable 紋理，造成
 *    GL_INVALID_OPERATION: glTexImage2DRobustANGLE: Texture is immutable.
 *    解法：以 <canvas> 中介，每幀 drawImage(video) → uploadData(canvas)，走 texSubImage2D。
 */
export class WebmVideoTexture {
    private _texture: Texture2D | null = null;
    private _spriteFrame: SpriteFrame | null = null;
    private _canvas: HTMLCanvasElement | null = null;
    private _ctx: CanvasRenderingContext2D | null = null;
    private _w = 0;
    private _h = 0;

    get spriteFrame(): SpriteFrame | null {
        return this._spriteFrame;
    }

    get width(): number {
        return this._w;
    }

    get height(): number {
        return this._h;
    }

    /**
     * 用當前 video 幀更新貼圖。
     * @param video 來源 video；切換 clip 過程中 VideoPlayer.nativeVideo 可能為 null，視同「尚未就緒」回 false
     * @returns 是否有(重)建立貼圖；首次建立或尺寸變更時為 true，呼叫端應據此重新綁定 Sprite。
     */
    updateFromVideo(video: HTMLVideoElement | null,isMP4:boolean): boolean {
        if (!video
            || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || video.videoWidth < 1
            || video.videoHeight < 1) {
            return false;
        }

        const vw = isMP4 ? video.videoWidth / 2 : video.videoWidth;
        const vh = video.videoHeight;
        const sizeChanged = !!this._texture && (vw !== this._w || vh !== this._h);

        let recreated = false;
        if (!this._texture || !this._spriteFrame || !this._canvas || sizeChanged) {
            if (sizeChanged) {
                this.dispose();
            }
            if (!this._allocate(vw, vh)) {
                return false;
            }
            recreated = true;
        }

        // clearRect 防止 WebM alpha 帶來的上一幀殘影。
        const ctx = this._ctx!;
        ctx.clearRect(0, 0, this._w, this._h);
        ctx.drawImage(video, 0, 0, this._w, this._h);
        this._texture!.uploadData(this._canvas!, 0);
        return recreated;
    }

    /**
     * 複製當前 canvas 為獨立 SpriteFrame（切 clip 過渡：tempSP 繼續顯示最後一幀）。
     * 呼叫端負責在不再需要時 destroy 回傳的 SpriteFrame 與其專屬 Texture2D。
     */
    cloneCurrentFrame(): SpriteFrame | null {
        if (!this._canvas || this._w < 1 || this._h < 1) return null;

        const texture = new Texture2D();
        texture.reset({ width: this._w, height: this._h });
        texture.uploadData(this._canvas, 0);

        const sf = new SpriteFrame();
        sf.packable = false;
        sf.texture = texture;
        sf.rect = new Rect(0, 0, this._w, this._h);
        return sf;
    }

    /**
     * 釋放 Texture2D / SpriteFrame / canvas。
     * 呼叫前請確保外部(如 Sprite.spriteFrame)已解除對本物件 spriteFrame 的引用，
     * 否則 destroy 後 Sprite 將持有失效資源。
     */
    dispose(): void {
        this._spriteFrame?.destroy();
        this._spriteFrame = null;
        this._texture?.destroy();
        this._texture = null;
        if (this._canvas) {
            this._canvas.width = this._canvas.height = 0;
        }
        this._canvas = null;
        this._ctx = null;
        this._w = 0;
        this._h = 0;
    }

    private _allocate(w: number, h: number): boolean {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return false;
        }
        this._canvas = canvas;
        this._ctx = ctx;
        this._w = w;
        this._h = h;

        this._texture = new Texture2D();
        this._texture.reset({ width: w, height: h });

        const sf = new SpriteFrame();
        sf.packable = false;
        sf.texture = this._texture;
        sf.rect = new Rect(0, 0, w, h);
        this._spriteFrame = sf;
        return true;
    }
}
