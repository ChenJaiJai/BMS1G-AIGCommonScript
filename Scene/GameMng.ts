import { _decorator, assetManager, Component, game, Label, Node, Sprite, SpriteFrame, Tween, tween, v3, Vec3 } from 'cc';
import { BUILD, DEBUG, EDITOR } from 'cc/env';
import { AppConfig } from 'db://assets/AIGCommon/Config/IGameConfig';
import { DeskLogin } from 'db://assets/AIGCommon/Config/IDeskLogin';
import { CoreEvents } from 'db://assets/AIGCommon/Core/CoreEvents';
import { EventMsg } from 'db://assets/AIGCommon/Core/EventMsg';
import InitGate, { InitTask } from 'db://assets/AIGCommon/Core/InitGate';
import BundleMng from 'db://assets/AIGCommon/Resource/BundleMng';
const { ccclass, property } = _decorator;

@ccclass('GameMng')
export class GameMng extends Component {
    @property(Sprite)
    background: Sprite
    @property(Sprite)
    table: Sprite
    @property({ type: Node, formerlySerializedAs: 'panelLaoding' })
    panelLoading: Node
    @property(Node)
    loadingContent: Node

    @property({ tooltip: '目標幀率（FPS）' })
    targetFrameRate = 24
    @property({ tooltip: '載入動畫：單段放大／縮放時間（秒）' })
    loadingAniSegmentDuration = 0.35
    @property(Label)
    currentAni: Label
    @property(Label)
    currentStatus: Label
    @property(Label)
    versionTitle: Label
    dataBackground: string = '';
    dataTable: string = '';

    protected async onLoad(): Promise<void> {
        game.frameRate = this.targetFrameRate;
        this.panelLoading.active = false
        EventMsg.on(CoreEvents.Init, this.loadBG, this);
        EventMsg.on(CoreEvents.Init, this.loadTable, this);
        EventMsg.on(CoreEvents.LoadingOpen, this.loadingAni, this);
        EventMsg.on(CoreEvents.LoadingClose, this.stopLoadingAni, this);
        if (BUILD) {
            try {
                const url = new URL("./version.json", window.location.href).toString();
                const response = await fetch(url, { cache: "no-store" }); // 避免拿到舊快取
                if (!response.ok) throw new Error(`讀取 version.json 失敗: ${response.status}`);
                const data = await response.json();
                const versionText = String(data?.version ?? '');
                const siteText = String(data?.site ?? '');
                this.versionTitle.string = `${versionText} - ${siteText}`;

            } catch (error) {
                console.error('[GameMng] 讀取 version.json 失敗', error);
            }
        }
        if (!EDITOR)
            this.loadingAni();
        if (!DEBUG) {
            //@ts-ignore
            if (!window.console) window.console = {};
            var methods = ["log", "debug", "warn", "info", "timeEnd", "table", "error"];
            for (var i = 0; i < methods.length; i++) {
                console[methods[i]] = function () { };
            }
            this.currentAni.node.active = this.currentStatus.node.active = false;
        }
        else {
            this.currentAni.node.active = this.currentStatus.node.active = true;
            EventMsg.on(CoreEvents.VideoClipStarted, this.updateVideoLabel, this);
            EventMsg.on(CoreEvents.GameCurrentStatus, this.updateStatusLabel, this);
        }
    }
    async loadBG(login: DeskLogin) {
        if (!this.background) {
            console.error('[GameMng] background 未綁定 Sprite，請先在 Inspector 指定。');
            InitGate.complete(InitTask.Background);
            return;
        }
        const defaultBackGround = AppConfig.current?.defaultBackground ?? 'G8_XTA';
        if (this.dataBackground == login.styles.background) {
            InitGate.complete(InitTask.Background);
            return;
        }
        assetManager.getBundle('BackGround')?.releaseAll();
        this.dataBackground = login.styles.background;
        const backgroundPath = `${login.styles.background || defaultBackGround}/spriteFrame`;
        const defaultBackgroundPath = `${defaultBackGround}/spriteFrame`;
        const sp = await BundleMng.load<SpriteFrame>('BackGround', backgroundPath, SpriteFrame, defaultBackgroundPath);
        this.background.spriteFrame = sp;

        InitGate.complete(InitTask.Background);
    }
    async loadTable(login: DeskLogin) {
        if (!this.table) {
            console.error('[GameMng] table 未綁定 Sprite，請先在 Inspector 指定。');
            InitGate.complete(InitTask.Table);
            return;
        }
        const defaultTable = AppConfig.current?.defaultTable ?? 'TA1_1';
        if (this.dataTable == login.styles.table) {
            InitGate.complete(InitTask.Table);
            return;
        }
        assetManager.getBundle('Table')?.releaseAll();
        this.dataTable = login.styles.table;
        const tablePath = `${login.styles.table || defaultTable}/spriteFrame`;
        const defaultTablePath = `${defaultTable}/spriteFrame`;
        const sp = await BundleMng.load<SpriteFrame>('Table', tablePath, SpriteFrame, defaultTablePath);
        this.table.spriteFrame = sp;

        InitGate.complete(InitTask.Table);
    }


    updateVideoLabel(playName: string) {
        this.currentAni.string = `當前影片:\n${playName}`;
    }

    updateStatusLabel(status: string) {
        this.currentStatus.string = `當前狀態:\n${status}`;
    }

    loadingAni(maxIndex: number = this.loadingContent.children.length - 1) {
        if (this.panelLoading.active) return
        this.panelLoading.active = true;
        this.loopLoadingAni(maxIndex);
    }
    loopLoadingAni(maxIndex: number) {
        for (let i = 0; i < this.loadingContent.children.length; i++) {
            const delay = i * (this.loadingAniSegmentDuration * 0.35);
            tween(this.loadingContent.children[i])
                .set({ scale: Vec3.ZERO })
                .delay(delay)
                .to(this.loadingAniSegmentDuration, { scale: v3(1, 1, 1) },)
                .to(this.loadingAniSegmentDuration, { scale: Vec3.ZERO }, {
                    onComplete: () => {
                        if (i == maxIndex)
                            this.loopLoadingAni(maxIndex);
                    }
                })
                .start();
        }
    }

    stopLoadingAni() {
        if (!this.panelLoading.active) return;
        for (let i = 0; i < this.loadingContent.children.length; i++) {
            Tween.stopAllByTarget(this.loadingContent.children[i]);
        }
        this.panelLoading.active = false;
    }

}
