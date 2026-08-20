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
 *
 * GPU 生命週期：canvas / 播放貼圖 / hold 貼圖各只建一次，尺寸變更走 reset／canvas 縮放，禁止每幀 new。
 */
export class WebmVideoTexture {
    private _texture: Texture2D | null = null;
    private _spriteFrame: SpriteFrame | null = null;
    private _canvas: HTMLCanvasElement | null = null;
    private _ctx: CanvasRenderingContext2D | null = null;
    private _w = 0;
    private _h = 0;

    /** 切 clip 過渡專用；與播放貼圖分開，避免 updateFromVideo 覆寫正在顯示的最後一幀。 */
    private _holdTexture: Texture2D | null = null;
    private _holdSpriteFrame: SpriteFrame | null = null;
    private _holdW = 0;
    private _holdH = 0;

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
    updateFromVideo(video: HTMLVideoElement | null, isMP4: boolean): boolean {
        if (!video
            || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            || video.videoWidth < 1
            || video.videoHeight < 1) {
            return false;
        }

        const vw = isMP4 ? video.videoWidth / 2 : video.videoWidth;
        const vh = video.videoHeight;
        const recreated = this._ensureLive(vw, vh);
        if (!this._ctx || !this._texture || !this._canvas) {
            return false;
        }

        // clearRect 防止 WebM alpha 帶來的上一幀殘影。
        this._ctx.clearRect(0, 0, this._w, this._h);
        this._ctx.drawImage(video, 0, 0, this._w, this._h);
        this._texture.uploadData(this._canvas, 0);
        return recreated;
    }

    /**
     * 把當前 canvas 上傳到「可重用」的 hold SpriteFrame（切 clip 過渡）。
     *
     * 必須與播放貼圖分開：同一張 Texture2D 會在下一幀被 updateFromVideo 覆寫，畫面會閃到新 clip 空幀。
     * 畫質與每次 new Texture2D 相同（同源 canvas、同尺寸、同一條 uploadData），差別只是 GPU 紋理不每切一次就配置。
     * 回傳物件由本 class 持有，呼叫端只可綁／解綁 Sprite，不可 destroy。
     */
    cloneCurrentFrame(): SpriteFrame | null {
        if (!this._canvas || this._w < 1 || this._h < 1) return null;
        if (!this._ensureHold(this._w, this._h) || !this._holdTexture || !this._holdSpriteFrame) {
            return null;
        }
        this._holdTexture.uploadData(this._canvas, 0);
        return this._holdSpriteFrame;
    }

    /**
     * 釋放 Texture2D / SpriteFrame；canvas 元素保留並縮成 0，避免反覆 createElement。
     * 呼叫前請確保外部(如 Sprite.spriteFrame)已解除對本物件 spriteFrame／hold 的引用。
     */
    dispose(): void {
        this._disposeLive();
        this._disposeHold();
        if (this._canvas) {
            this._canvas.width = this._canvas.height = 0;
        }
        this._w = 0;
        this._h = 0;
    }

    private _ensureCanvas(): boolean {
        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
        }
        if (!this._ctx) {
            this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });
        }
        return !!this._ctx;
    }

    /** @returns 是否首次建立或尺寸變更（呼叫端需重綁 Sprite） */
    private _ensureLive(w: number, h: number): boolean {
        if (!this._ensureCanvas()) {
            return false;
        }

        const sizeChanged = this._w !== w || this._h !== h;
        const needTexture = !this._texture || !this._spriteFrame;
        if (!sizeChanged && !needTexture) {
            return false;
        }

        this._canvas!.width = w;
        this._canvas!.height = h;
        this._w = w;
        this._h = h;

        if (!this._texture) {
            this._texture = new Texture2D();
        }
        this._texture.reset({ width: w, height: h });

        if (!this._spriteFrame) {
            this._spriteFrame = new SpriteFrame();
            this._spriteFrame.packable = false;
        }
        this._spriteFrame.texture = this._texture;
        this._spriteFrame.rect = new Rect(0, 0, w, h);
        return true;
    }

    private _ensureHold(w: number, h: number): boolean {
        if (!this._holdTexture) {
            this._holdTexture = new Texture2D();
        }
        if (!this._holdSpriteFrame) {
            this._holdSpriteFrame = new SpriteFrame();
            this._holdSpriteFrame.packable = false;
        }
        if (this._holdW !== w || this._holdH !== h) {
            this._holdTexture.reset({ width: w, height: h });
            this._holdSpriteFrame.texture = this._holdTexture;
            this._holdSpriteFrame.rect = new Rect(0, 0, w, h);
            this._holdW = w;
            this._holdH = h;
        }
        return true;
    }

    private _disposeLive(): void {
        this._spriteFrame?.destroy();
        this._spriteFrame = null;
        this._texture?.destroy();
        this._texture = null;
    }

    private _disposeHold(): void {
        this._holdSpriteFrame?.destroy();
        this._holdSpriteFrame = null;
        this._holdTexture?.destroy();
        this._holdTexture = null;
        this._holdW = 0;
        this._holdH = 0;
    }
}
