import { VideoPlayer } from 'cc';
import { CoreEvents } from 'db://assets/AIGCommon/Core/CoreEvents';
import { EventMsg } from 'db://assets/AIGCommon/Core/EventMsg';

export class VideoComponent {
    videoPlayer: VideoPlayer = null;
    canSync: boolean = false;
    ready: boolean = false;
    isEnd: boolean = false;
    private _hiddenNativeVideo: HTMLVideoElement | null = null;
    constructor(videoPlayer: VideoPlayer) {
        this.videoPlayer = videoPlayer;
    }

    init() {
        this.reset();
        this.videoPlayer.stayOnBottom = true;
        this.videoPlayer.node.on(VideoPlayer.EventType.ERROR, () => {
        }, this);
        this.videoPlayer.node.on(VideoPlayer.EventType.READY_TO_PLAY, () => {
            this._hideNativeVideo();
            this.videoPlayer.pause();
            this.ready = true;
        }, this);
        this.videoPlayer.node.on(VideoPlayer.EventType.COMPLETED, () => {
            this.ready = this.canSync = false;
            if (this.isEnd) {
                this.close()
                console.error('影片結尾?');
                return;
            }
            if (!this.videoPlayer.loop) {
                EventMsg.emit(CoreEvents.PlayWebM);
            }
        }, this);
    }

    private _hideNativeVideo(): void {
        const native = this.videoPlayer?.nativeVideo as HTMLVideoElement | null;
        if (!native?.style || native === this._hiddenNativeVideo) return;
        native.style.opacity = '0';
        this._hiddenNativeVideo = native;
    }
    reset() {
        if (!this.videoPlayer) {
            console.error('video 組件是空的，Mng 的 video 有放嗎?');
            return;
        }
        // close() 後 nativeVideo 會是 null；Cocos 仍會對它寫 currentTime 而 throw
        const native = this.videoPlayer.nativeVideo as HTMLVideoElement | null;
        if (native) {
            native.pause();
            native.querySelectorAll('source').forEach((s) => s.remove());
            native.removeAttribute('src');
            native.src = '';
            native.load();
            this.videoPlayer.clip = null;
        } else {
            this.videoPlayer.clip = null;
        }
        this._hiddenNativeVideo = null;
        this.isEnd = this.ready = this.canSync = this.videoPlayer.loop = false;
    }

    play(endState: boolean = false) {
        this.isEnd = endState;
        this.videoPlayer.play();
    }

    setCanSync(v: boolean) {
        this.canSync = v;
    }

    close() {
        this.reset();
    }
}
