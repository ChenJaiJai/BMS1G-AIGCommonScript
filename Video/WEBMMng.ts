import { _decorator, Asset, assetManager, Component, Material, Size, Sprite, SpriteFrame, UITransform, VideoClip, VideoPlayer } from 'cc';
import { DeskLogin } from 'db://assets/AIGCommon/Config/IDeskLogin';
import { VideoFormatConfig } from 'db://assets/AIGCommon/Config/VideoFormat';
import { CoreEvents } from 'db://assets/AIGCommon/Core/CoreEvents';
import { EventMsg } from 'db://assets/AIGCommon/Core/EventMsg';
import InitGate, { InitTask } from 'db://assets/AIGCommon/Core/InitGate';
import { waitUntil } from 'db://assets/AIGCommon/Core/waitUntil';
import BundleMng from 'db://assets/AIGCommon/Resource/BundleMng';
import { VideoComponent } from './VideoComponent';
import { buildWebmClipMap } from './WebmClipMap';
import { WebmVideoTexture } from './WebmVideoTexture';
const { ccclass, property } = _decorator;

/**等待影片載入時間 */
const WAIT_VIDEO_READY_MS = 60000;

@ccclass('WEBM')
export class WEBM extends Component {
    @property({ visible() { return !this.isMP4 } })
    isWebM: boolean = false;
    @property({ visible() { return !this.isWebM } })
    isMP4: boolean = false;
    @property({ type: Material, visible() { return this.isWebM } })
    matWebM: Material = null;

    @property({ type: Material, visible() { return this.isMP4 } })
    matMP4: Material = null;
    dataWebM: string = '';
    webm: Asset[] = [];
    webmMap: Map<string, VideoClip> = new Map();
    currentIndex: number = 0;

    @property(VideoPlayer)
    videoPlayers: VideoPlayer[] = [];

    @property({ type: Sprite, displayName: '影片貼圖目標 Sprite（2D）' })
    renderWebM: Sprite = null;

    videoComponentList: VideoComponent[] = [];
    playList: string[] = [];
    currentPlay: string = null;
    isEnd: boolean = false;
    isPlayProcess: boolean = false;
    isCreatrList: boolean = false;

    private readonly _videoTex = new WebmVideoTexture();
    /** 切 clip 過渡：目標顯示的上一支最後一幀快照 */
    private _holdSpriteFrame: SpriteFrame | null = null;
    /** true 時不將 video 幀寫入目標，維持 hold 直到新槽有幀 */
    private _syncPaused = false;
    /** 切換中等待就緒的目標 clip，用於忽略過期 READY_TO_PLAY */
    private _pendingClip: VideoClip | null = null;
    private _lastPlayingIndex = -1;


    protected async onLoad(): Promise<void> {
        EventMsg.on(CoreEvents.Init, this.init, this);
        EventMsg.on(CoreEvents.PlayWebM, this.playAni, this);
        EventMsg.on(CoreEvents.PlayVideo, this.playKeywords, this);
        EventMsg.on(CoreEvents.ResetGame, this.reset, this);
        EventMsg.on(CoreEvents.Reconnect, this.deleteList, this);
        for (let index = 0; index < this.videoPlayers.length; index++) {
            this.videoComponentList[index] = new VideoComponent(this.videoPlayers[index]);
            this.videoComponentList[index].init();
        }
        this.isMP4 = this.isWebM = false
    }

    protected onDestroy(): void {
        this._disposeVideoTexture();
    }

    protected update(): void {
        const playingIndex = this._resolvePlayingSlotIndex();
        if (playingIndex >= 0 && !this._syncPaused) {
            const video = this.videoComponentList[playingIndex]?.videoPlayer?.nativeVideo ?? null;
            this._syncVideoToTargets(video as HTMLVideoElement | null, true);
        }

        for (let index = 0; index < this.videoComponentList.length; index++) {
            if (this.videoComponentList[index].canSync) {
                EventMsg.emit(CoreEvents.SyncTime, this.videoComponentList[index].videoPlayer.currentTime);
            }
        }
    }

    async init(login: DeskLogin) {
        const options = VideoFormatConfig.resolve(login.styles.dealer);
        this.isMP4 = options.kind === 'mp4';
        this.isWebM = options.kind === 'webm';
        this.reset();
        const streamer = options.dealer;
        if (this.dataWebM !== streamer) {
            this.deleteAsset();
            await this.loadAsset(streamer, options.fallbackDealer);
        }
        if (this.renderWebM) {
            this.renderWebM.customMaterial = this.isWebM ? this.matWebM : this.matMP4;
        }
        InitGate.complete(InitTask.Video);
    }



    async reset() {
        this.unscheduleAllCallbacks();
        this.playList = [];
        this._disposeVideoTexture();
        if (this.renderWebM) {
            this.renderWebM.spriteFrame = null;
        }
        this._lastPlayingIndex = -1;
        this.videoComponentList.forEach((element) => {
            element.reset();
        });
        this.currentIndex = 0;
        this._pendingClip = null;
        this.currentPlay = null;
        this._syncPaused = this.isEnd = this.isPlayProcess = false;

    }

    async loadAsset(streamer: string, fallbackStreamer: string) {
        const _asset = await BundleMng.loadDir<Asset>(
            this.isWebM ? 'WebM' : 'MP4',
            streamer,
            Asset,
            fallbackStreamer,
        );
        console.log('下載完成', _asset);
        this.dataWebM = streamer;
        this.webm = _asset;
        this.webmMap = buildWebmClipMap(_asset);
    }

    async deleteAsset() {
        assetManager.getBundle('WebM')?.releaseAll();
        assetManager.getBundle('MP4')?.releaseAll();
        this.webm = [];
        this.webmMap.clear();
        this.dataWebM = '';
    }

    deleteList() {
        this.playList = [];
        this.videoComponentList.forEach((element) => {
            element.videoPlayer.loop = false;
            element.isEnd = true;
        });
        this.isPlayProcess = false;
    }

    private resolveClipByKeyword(keyword: string): VideoClip | null {
        if (!keyword) return null;

        const clip = this.webmMap.get(keyword);
        if (!clip) {
            console.error(`找不到要播放的 WebM：${keyword}`);
            return null;
        }

        return clip;
    }

    private async advanceToNextPlay(targetIndex: number) {
        if (this.playList.length > 0) {
            this.currentPlay = this.playList.shift();
            const foundNextItem = this.resolveClipByKeyword(this.currentPlay);
            if (foundNextItem) {
                this.videoComponentList[targetIndex].ready = false;
                this.videoComponentList[targetIndex].videoPlayer.clip = foundNextItem as VideoClip;
            }
            console.log('播放下一個', this.currentPlay);
        }
    }

    /** 遊戲端組好關鍵字後呼叫（或 emit CoreEvents.PlayVideo） */
    async playKeywords(keywords: string[]) {
        this.isCreatrList = true;
        await waitUntil(() => !this.isPlayProcess);
        console.warn('-------建立播放單-------');
        if (!keywords?.length) {
            console.error('播放清單為空', keywords);
            this.playList = [];
            this.isCreatrList = false;
            return;
        }

        this.playList = [...keywords];

        this.videoComponentList[this.currentIndex].reset();
        this.advanceToNextPlay(this.currentIndex);
        await waitUntil(() => this.videoComponentList[this.currentIndex].ready, { timeoutMs: WAIT_VIDEO_READY_MS });

        console.warn('-----------------開始播放-----------------');
        const lastIndex = this.currentIndex === 0 ? 1 : 0;
        this.videoComponentList[lastIndex].canSync = false;
        this.videoComponentList[lastIndex].ready = false;
        this.playAni();
        this.isCreatrList = false;
    }

    async playAni() {
        if (this.isPlayProcess) {
            console.warn('playAni 重入，等待前次完成');
            await waitUntil(() => !this.isPlayProcess);
        }
        this.isPlayProcess = true;

        const playingSlot = this.currentIndex;
        if (!this.videoComponentList[playingSlot].ready) {
            if (!(await waitUntil(() => this.videoComponentList[playingSlot].ready, { timeoutMs: WAIT_VIDEO_READY_MS }))) {
                this.isPlayProcess = false;
                console.warn('影片載入逾時，跳過播放');
                return;
            }
            if (this.isCreatrList) {
                this.isPlayProcess = false;
                console.warn('影片載入衝突');
                return;
            }
            console.warn('影片 ready');
        }

        if (this._lastPlayingIndex !== -1 && this._lastPlayingIndex !== playingSlot) {
            const nextClip = this.videoComponentList[playingSlot].videoPlayer.clip;
            this._beginClipTransition(nextClip);
        }
        this._lastPlayingIndex = playingSlot;
        this._syncPaused = false;

        EventMsg.emit(CoreEvents.VideoClipStarted, this.currentPlay);

        this.videoComponentList[playingSlot].play(this.currentPlay.includes('Dance'));
        const lastIndex = playingSlot === 0 ? 1 : 0;
        console.table({
            '播放器編號：': playingSlot,
            '剩餘播放清單': JSON.stringify(this.playList),
            '當前播放名稱': this.currentPlay,
            '下一個播放器編號': lastIndex,
        });

        this.scheduleOnce(() => {
            this.videoComponentList[playingSlot].setCanSync(!this.currentPlay.includes('Dance'));
            this.videoComponentList[lastIndex].close();
            this.currentIndex = lastIndex;
            if (this.playList.length === 0) {
                console.log('----------------最後一影片-----------------');
            } else if (this.isCreatrList) {
                console.warn('準備建立下一個影片，不需要切換下一個');
            } else {
                this.advanceToNextPlay(lastIndex);
                console.log('----------------預載下一支-----------------');
            }
            this.isPlayProcess = false;
        }, 0);
    }

    /** 正在輸出畫面的槽位：僅回傳「實際正在播放」的槽位。 */
    private _resolvePlayingSlotIndex(): number {
        for (let i = 0; i < this.videoComponentList.length; i++) {
            if (this.videoComponentList[i]?.videoPlayer?.isPlaying) {
                return i;
            }
        }
        return -1;
    }

    private _disposeVideoTexture(): void {
        this._releaseHoldFrame();
        if (this.renderWebM?.spriteFrame === this._videoTex.spriteFrame) {
            this.renderWebM.spriteFrame = null;
        }
        this._videoTex.dispose();
    }

    private _releaseHoldFrame(): void {
        if (!this._holdSpriteFrame) return;
        if (this.renderWebM?.spriteFrame === this._holdSpriteFrame) {
            this.renderWebM.spriteFrame = null;
        }
        const texture = this._holdSpriteFrame.texture;
        this._holdSpriteFrame.destroy();
        texture.destroy();
        this._holdSpriteFrame = null;
    }

    /** 切換槽位／clip：快照最後一幀到 hold，暫停同步直到新來源有幀 */
    private _beginClipTransition(nextClip: VideoClip | null): void {
        const snapshot = this._videoTex.cloneCurrentFrame();
        if (snapshot) {
            this._releaseHoldFrame();
            this._holdSpriteFrame = snapshot;
            if (this.renderWebM) {
                this.renderWebM.spriteFrame = snapshot;
                this.renderWebM.sizeMode = Sprite.SizeMode.CUSTOM;
            }
        }

        if (this.renderWebM?.spriteFrame === this._videoTex.spriteFrame) {
            this.renderWebM.spriteFrame = this._holdSpriteFrame ?? this.renderWebM.spriteFrame;
        }

        this._syncPaused = true;
        this._pendingClip = nextClip;
    }

    private _syncVideoToTargets(video: HTMLVideoElement | null, bindTargets: boolean): void {
        const recreated = this._videoTex.updateFromVideo(video, this.isMP4);
        const sf = this._videoTex.spriteFrame;
        if (!bindTargets || !sf) return;

        if (this._syncPaused && video) {
            this._syncPaused = false;
            this._pendingClip = null;
        }

        const needsBind = recreated || this._targetsNeedBind(sf);
        if (needsBind) {
            this._releaseHoldFrame();
            this._bindSpriteFrame(sf, this._videoTex.width, this._videoTex.height);
        }
    }

    private _targetsNeedBind(sf: SpriteFrame): boolean {
        return !!this.renderWebM && this.renderWebM.spriteFrame !== sf;
    }

    private _bindSpriteFrame(sf: SpriteFrame, w: number, h: number): void {
        if (!this.renderWebM) return;
        this.renderWebM.spriteFrame = sf;
        this.renderWebM.sizeMode = Sprite.SizeMode.CUSTOM;
        const ui = this.renderWebM.node.getComponent(UITransform);
        if (ui) {
            ui.setContentSize(new Size(w, h));
        }
    }
}
