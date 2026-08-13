
import { assetManager, AudioClip, AudioSource, Node, NodePool, random, resources } from "cc";
export class DataMusic {
    protected audioSourcePool: NodePool = new NodePool();
    protected audio_Music: AudioSource;
    protected audio_Effect: Map<string, AudioSource> = new Map();

    protected _is_open_music: boolean = true;
    protected get is_open_music() {
        return this._is_open_music;
    }
    protected set is_open_music(value: boolean) {
        this._is_open_music = value;
        // console.error(value);
    }
    protected _is_open_effect: boolean = true;
    protected get is_open_effect() {
        return this._is_open_effect;
    }
    protected set is_open_effect(value: boolean) {
        this._is_open_effect = value;
    }

    protected _volMusic: number = .5;
    public get volMusic() {
        return this._volMusic;
    }
    protected set volMusic(value: number) {
        this._volMusic = value;
    }
    protected _volEffect: number = .5;
    public get volEffect() {
        return this._volEffect;
    }
    protected set volEffect(value: number) {
        this._volEffect = value;
    }
}

class MusicAsset {
    typePath = 'Music/';
    bundlePath = 'Music';

    async loadAsset(): Promise<Map<string, AudioClip>> {
        const [localClips, bundleClips] = await Promise.all([
            this.loadResourcesDir(this.typePath),
            this.loadBundleDir(this.bundlePath, ''),
        ]);

        const data = new Map<string, AudioClip>();
        for (const clip of [...localClips, ...bundleClips]) {
            data.set(clip.name, clip);
        }
        return data;
    }

    private loadResourcesDir(path: string): Promise<AudioClip[]> {
        return new Promise((resolve, reject) => {
            resources.loadDir(path, AudioClip, (err, clips) => {
                if (err) reject(err);
                else resolve(clips ?? []);
            });
        });
    }

    private loadBundleDir(bundleName: string, dir: string): Promise<AudioClip[]> {
        return new Promise((resolve, reject) => {
            assetManager.loadBundle(bundleName, (err, bundle) => {
                if (err || !bundle) {
                    reject(err ?? new Error(`loadBundle 失敗：${bundleName}`));
                    return;
                }
                bundle.loadDir(dir, AudioClip, (err2, clips) => {
                    if (err2) reject(err2);
                    else resolve(clips ?? []);
                });
            });
        });
    }
}
class MusicMng extends DataMusic {
    mapClip: Map<string, AudioClip> = new Map();
    async init(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            this.mapClip = await new MusicAsset().loadAsset();
            this.audio_Music = new Node().addComponent(AudioSource);
            resolve();
        });
    }

    private initValue(bgOpen: boolean, efxOpen: boolean, bgVol: number | string, efxVol: number | string) {
        this.volMusic = Number(bgVol);
        this.volEffect = Number(efxVol);
        this.is_open_music = bgOpen;
        this.is_open_effect = efxOpen;

        this.switchEffect(this.is_open_effect);
        this.switchMusic(this.is_open_music);
        this.musicVolSet(this.volMusic);
        this.effectVolSet(this.volEffect);

    }
    private getClip(name: string): AudioClip {
        if (!this.mapClip.has(name)) throw new Error(`沒有這首音樂${name}`);
        return this.mapClip.get(name);
    }

    switchMusic(_boolean?: boolean): boolean {
        this.is_open_music = _boolean != null ? _boolean : !this.is_open_music;
        this.musicVolSet();
        return this.getMusicState();
    }

    musicPlay(musicName: string, playLoop = true): void {
        if (this.audio_Music.state === 1 && musicName === this.audio_Music.clip.name) return;
        this.musicStop();
        this.audio_Music.clip = this.getClip(musicName);
        this.audio_Music.loop = playLoop;
        this.audio_Music.play();
    }

    musicStop(): void {
        this.audio_Music.stop();
    }

    musicVolSet(vol?: number): void {
        if (vol) {
            this._volMusic = vol;
        }
        this.audio_Music.volume = this.getMusicState() ? this._volMusic : 0;
    }

    getMusicState(): boolean {
        return this.is_open_music;
    }


    switchEffect(_boolean?: boolean): boolean {
        this.is_open_effect = _boolean != null ? _boolean : !this.is_open_effect;
        this.effectVolSet();
        return this.getEffectState();
    }

    // private readonly _onEffectEnded = (audio: AudioSource) => {
    //     if (!audio) {
    //         console.error('為ˇ什麼audio is null');
    //         return
    //     }
    //     this.putAudioSourcePool(audio, audio.clip.name);
    // }
    effectPlay(effectName: string, _vol?: number, playLoop: boolean = false): void {
        //撥放音樂
        let audio: AudioSource = this.getAudioSourcePool();
        audio.loop = playLoop;
        audio.clip = this.getClip(effectName);
        let vol = _vol ? _vol : this._volEffect;
        audio.volume = this.getEffectState() ? vol : 0;

        audio.play();
        //資料儲存
        let effectRandom = effectName + this.checkEffectRandom(effectName, random()).toString();
        this.audio_Effect.set(
            effectRandom,
            audio);
        if (!playLoop) {
            const _onEffectEnded = () => {

                this.putAudioSourcePool(audio, effectRandom);
            }

            audio.node.on(AudioSource.EventType.ENDED, _onEffectEnded)
        }
    }

    effectStopAll(): void {
        this.audio_Effect.forEach((audioSource, _effectName) => {
            this.putAudioSourcePool(audioSource, _effectName);
        });
        this.audio_Effect.clear();//確認清乾淨

    }

    effectStop(effectName: string): void {
        this.audio_Effect.forEach((audioSource, _effectName) => {
            //為了部分音效不重複，音名後面有新增亂數
            if (_effectName.split("0.")[0] == effectName) {
                this.putAudioSourcePool(audioSource, _effectName);
            }
        });
    }

    effectVolSet(vol?: number): void {
        if (vol) {
            this._volEffect = vol;
        }
        this.audio_Effect.forEach(audioSource => {
            audioSource.volume = this.getEffectState() ? this._volEffect : 0;
        });
    }

    getEffectState(): boolean {
        return this.is_open_effect;
    }

    checkEffectRandom(effectName: string, number: number):number {
        if (this.audio_Effect.has(effectName + number))
            return this.checkEffectRandom(effectName, random());
        else
            return number;
    }

    getAudioSourcePool() {
        if (this.audioSourcePool.size() > 0) {
            return this.audioSourcePool.get().getComponent(AudioSource);
        }
        else {
            return new Node().addComponent(AudioSource);
        }
    }
    putAudioSourcePool(_audioSource: AudioSource, _effectName: string) {
        _audioSource.node.off(AudioSource.EventType.ENDED);
        _audioSource.stop();
        this.audioSourcePool.put(_audioSource.node);
        this.audio_Effect.delete(_effectName);
    }

}

export default new MusicMng();



