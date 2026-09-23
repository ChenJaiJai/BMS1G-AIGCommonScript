import { _decorator, assetManager, Component, Sprite, VideoClip, VideoPlayer } from 'cc';
import { CoreEvents } from '../Core/CoreEvents';
import { EventMsg } from '../Core/EventMsg';
import { waitUntil } from '../Core/waitUntil';
import RemoteMng from '../Resource/RemoteMng';
import { buildVideoClipMap } from './VideoClipMap';
import { VideoComponent } from './VideoComponent';
const { ccclass, property } = _decorator;

@ccclass('BaseVideoMng')
export default class BaseVideoMng extends Component {
    @property(VideoPlayer)
    videoPlayers: VideoPlayer[] = [];
    @property(Sprite)
    renderVideo: Sprite = null;
    videoMap: Map<string, VideoClip> = new Map();
    playList: string[] = [];
    currentPlay: string = '';
    currentDealer: string = '';
    videoComponentList: VideoComponent[] = [];
    isPlayProcess = false;
    isCreatrList = false;
    protected static readonly WAIT_VIDEO_READY_MS = 60000;

    protected onLoad(): void {
        EventMsg.on(CoreEvents.Init, this.init, this);
        EventMsg.on(CoreEvents.PlayVideo, this.playAni, this);
        EventMsg.on(CoreEvents.ResetGame, this.reset, this);
        for (let index = 0; index < this.videoPlayers.length; index++) {
            this.videoComponentList[index] = new VideoComponent(this.videoPlayers[index]);
            this.videoComponentList[index].init();
        }
    }

    protected onDestroy(): void {
        EventMsg.off(CoreEvents.PlayVideo, this.playAni, this);
        EventMsg.off(CoreEvents.Init, this.init, this);
        EventMsg.off(CoreEvents.ResetGame, this.reset, this);
    }

    async reset() {
        this.unscheduleAllCallbacks();
        if (this.renderVideo) {
            this.renderVideo.spriteFrame = null;
        }
        this.playList = [];
        this.currentPlay = '';
        this.isPlayProcess = false;
        this.isCreatrList = false;
        for (const component of this.videoComponentList) {
            component.reset();
        }
    }

    async init(domain: string) {
        await this.reset();
    }
    async loadAsset(path: string, streamer: string, fallbackStreamer: string, list: string[]): Promise<void> {
        const states = list
        const results = await Promise.allSettled(states.map(async (state) => {
            const clip = await RemoteMng.loadVideoClip(`${path}/${state}.mp4`);
            clip.name = state;
            return clip;
        }));
        const loaded: VideoClip[] = [];
        let failed = false;
        for (const result of results) {
            if (result.status === 'fulfilled') loaded.push(result.value);
            else failed = true;
        }
        if (failed) {
            this.releaseClips(loaded);
            console.error(`[VideoMng] ${path} 有檔案載入失敗`);
            failed = false;
            path = path.replace(/[^/]+$/, fallbackStreamer);
            const results = await Promise.allSettled(states.map(async (state) => {
                const clip = await RemoteMng.loadVideoClip(`${path}/${state}.mp4`);
                clip.name = state;
                return clip;
            }));
            const defaultClip: VideoClip[] = []
            for (const result of results) {
                if (result.status === 'fulfilled') defaultClip.push(result.value);
                else failed = true;
            }
            if (failed) {
                this.releaseClips(defaultClip);
                throw new Error(`[VideoMng] ${path} 連預設都失敗載入失敗`);
                return
            }
            this.videoMap = buildVideoClipMap(defaultClip);
            this.currentDealer = fallbackStreamer;

        }
        else {
            this.videoMap = buildVideoClipMap(loaded);
            this.currentDealer = streamer;
        }
    }
    deleteAsset() {
        this.releaseClips(this.videoMap.values());
        this.videoMap.clear();
        this.currentDealer = '';
    }


    protected releaseClips(clips: Iterable<VideoClip>): void {
        for (const clip of clips) {
            const src = clip.nativeUrl;
            if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
            assetManager.releaseAsset(clip);
        }
    }

    protected async advanceToNextPlay(_targetIndex?: number): Promise<boolean> {
        if (this.playList.length === 0) return false;
        this.currentPlay = this.playList.shift();
        return true;
    }

    protected resolveClipByKeyword(keyword: string): VideoClip | null {
        if (!keyword) return null;

        const clip = this.videoMap.get(keyword);
        if (!clip) {
            console.error(`找不到要播放的 video：${keyword}`);
            return null;
        }

        return clip;
    }

    async playKeywords(keywords: string[]) {
        this.isCreatrList = true;
        await waitUntil(() => !this.isPlayProcess);
        if (!keywords?.length) {
            this.playList = [];
            this.isCreatrList = false;
            return;
        }

        this.playList = [...keywords];

        const video = this.videoComponentList[0];
        if (!video) {
            console.error('[BaseVideoMng] videoComponentList[0] 不存在');
            this.isCreatrList = false;
            return;
        }
        video.reset();
        await this.advanceToNextPlay();
        const ready = await waitUntil(() => this.videoComponentList[0].ready, {
            timeoutMs: BaseVideoMng.WAIT_VIDEO_READY_MS,
        });
        if (!ready) {
            console.warn('[BaseVideoMng] 等待 video ready 逾時', this.currentPlay);
        }

        await this.playAni();
        this.isCreatrList = false;
    }

    async playAni() {
        if (this.isPlayProcess) {
            await waitUntil(() => !this.isPlayProcess);
        }
        this.isPlayProcess = true;

        const video = this.videoComponentList[0];
        if (!video) {
            this.isPlayProcess = false;
            return;
        }

        if (!video.ready && this.playList.length > 0) {
            await this.advanceToNextPlay();
            const ready = await waitUntil(() => video.ready, {
                timeoutMs: BaseVideoMng.WAIT_VIDEO_READY_MS,
            });
            if (!ready) {
                console.warn('[BaseVideoMng] playAni 等待 video ready 逾時', this.currentPlay);
                this.isPlayProcess = false;
                return;
            }
        } else if (!video.ready && this.playList.length === 0) {
            await this.onPlaylistExhausted();
            this.isPlayProcess = false;
            return;
        }

        EventMsg.emit(CoreEvents.VideoClipStarted, this.currentPlay);
        video.play(false);
        this.isPlayProcess = false;
    }

    protected async onPlaylistExhausted(): Promise<void> {
    }
}
