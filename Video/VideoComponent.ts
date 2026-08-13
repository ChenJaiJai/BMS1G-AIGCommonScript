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
        this.videoPlayer.node.active = true;
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
        this.videoPlayer.currentTime = 0;
        this.videoPlayer.clip = null;
        if (this.videoPlayer.nativeVideo) {
            this.videoPlayer.nativeVideo.removeAttribute('src');
            this.videoPlayer.nativeVideo.load()
        }
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
