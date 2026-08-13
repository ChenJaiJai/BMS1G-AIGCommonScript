import { _decorator, Component, Material, Sprite, SpriteRenderer, Vec4 } from 'cc';
const { ccclass, property } = _decorator;

const EDGE_FX_PROP = 'u_edge_fx';

/**
 * 執行時調整 webm-edge-smooth（2D Sprite）與 SpriteRendererEfx（3D SpriteRenderer）
 * 的 u_edge_fx；兩組參數在 Inspector 分開、以滑桿 0~1 調整。
 */
@ccclass('ShaderTool')
export default class ShaderTool extends Component {
    @property({ type: Sprite, displayName: '2D Sprite 目標' })
    sprite2D: Sprite = null;

    @property({ type: SpriteRenderer, displayName: '3D SpriteRenderer 目標' })
    spriteRenderer3D: SpriteRenderer = null;

    @property({
        group: { name: '2D / webm-edge-smooth', id: 'fx2d', displayOrder: 1 },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'X 半徑倍率',
    })
    fx2dX = 0.4;

    @property({
        group: { name: '2D / webm-edge-smooth', id: 'fx2d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'Y Alpha 閾值',
    })
    fx2dY = 0.35;

    @property({
        group: { name: '2D / webm-edge-smooth', id: 'fx2d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'Z 過渡軟度',
    })
    fx2dZ = 0.12;

    @property({
        group: { name: '2D / webm-edge-smooth', id: 'fx2d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'W 顏色拉回',
    })
    fx2dW = 0.75;

    @property({
        group: { name: '3D / SpriteRendererEfx', id: 'fx3d', displayOrder: 2 },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'X 半徑倍率',
    })
    fx3dX = 0.4;

    @property({
        group: { name: '3D / SpriteRendererEfx', id: 'fx3d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'Y Alpha 閾值',
    })
    fx3dY = 0.35;

    @property({
        group: { name: '3D / SpriteRendererEfx', id: 'fx3d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'Z 過渡軟度',
    })
    fx3dZ = 0.12;

    @property({
        group: { name: '3D / SpriteRendererEfx', id: 'fx3d' },
        slide: true,
        range: [0, 1, 0.01],
        displayName: 'W 顏色拉回',
    })
    fx3dW = 0.75;

    private _mat2d: Material | null = null;
    private _mat3d: Material | null = null;
    private _pulled2d = false;
    private _pulled3d = false;
    private readonly _last2d = new Vec4();
    private readonly _last3d = new Vec4();
    private readonly _edgeFx2d = new Vec4();
    private readonly _edgeFx3d = new Vec4();

    onLoad(): void {
        this._syncMaterials();
    }

    update(): void {
        this._syncMaterials();
        this._apply2D(false);
        this._apply3D(false);
    }

    /** 從目前滑桿值寫入 2D 材質（可給外部腳本呼叫） */
    apply2DEdgeFx(): void {
        this._apply2D(true);
    }

    /** 從目前滑桿值寫入 3D 材質（可給外部腳本呼叫） */
    apply3DEdgeFx(): void {
        this._apply3D(true);
    }

    private _syncMaterials(): void {
        if (this.sprite2D?.customMaterial) {
            if (!this._pulled2d) {
                const shared = this.sprite2D.getRenderMaterial(0) ?? this.sprite2D.customMaterial;
                if (this._pullEdgeFxToSliders(shared, true)) {
                    this._pulled2d = true;
                }
            }
            if (!this._mat2d) {
                this._mat2d = this.sprite2D.getMaterialInstance(0);
                this._last2d.set(this.fx2dX, this.fx2dY, this.fx2dZ, this.fx2dW);
            }
        }
        if (this.spriteRenderer3D) {
            if (!this._pulled3d) {
                const shared = this.spriteRenderer3D.getRenderMaterial(0)
                    ?? this.spriteRenderer3D.sharedMaterial;
                if (this._pullEdgeFxToSliders(shared, false)) {
                    this._pulled3d = true;
                }
            }
            if (!this._mat3d) {
                this._mat3d = this.spriteRenderer3D.getMaterialInstance(0);
                this._last3d.set(this.fx3dX, this.fx3dY, this.fx3dZ, this.fx3dW);
            }
        }
    }

    /** 從材質球讀取 u_edge_fx，寫入對應滑桿（啟動時材質 → 腳本） */
    private _pullEdgeFxToSliders(mat: Material | null, is2d: boolean): boolean {
        const v = this._readEdgeFx(mat);
        if (!v) {
            return false;
        }
        if (is2d) {
            this.fx2dX = this._clamp01(v.x);
            this.fx2dY = this._clamp01(v.y);
            this.fx2dZ = this._clamp01(v.z);
            this.fx2dW = this._clamp01(v.w);
            this._last2d.set(this.fx2dX, this.fx2dY, this.fx2dZ, this.fx2dW);
        } else {
            this.fx3dX = this._clamp01(v.x);
            this.fx3dY = this._clamp01(v.y);
            this.fx3dZ = this._clamp01(v.z);
            this.fx3dW = this._clamp01(v.w);
            this._last3d.set(this.fx3dX, this.fx3dY, this.fx3dZ, this.fx3dW);
        }
        return true;
    }

    private _readEdgeFx(mat: Material | null): Vec4 | null {
        if (!mat) {
            return null;
        }
        const raw = mat.getProperty(EDGE_FX_PROP) as Vec4 | number[] | Readonly<Vec4> | null;
        if (!raw) {
            return null;
        }
        if (Array.isArray(raw)) {
            return new Vec4(raw[0] ?? 0, raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0);
        }
        return new Vec4(raw.x, raw.y, raw.z, raw.w);
    }

    private _clamp01(v: number): number {
        return Math.min(1, Math.max(0, v));
    }

    private _apply2D(force: boolean): void {
        this._edgeFx2d.set(this.fx2dX, this.fx2dY, this.fx2dZ, this.fx2dW);
        if (!force && this._vec4Equal(this._edgeFx2d, this._last2d)) {
            return;
        }
        if (!this._mat2d) {
            return;
        }
        this._mat2d.setProperty(EDGE_FX_PROP, this._edgeFx2d);
        this._last2d.set(this._edgeFx2d);
    }

    private _apply3D(force: boolean): void {
        this._edgeFx3d.set(this.fx3dX, this.fx3dY, this.fx3dZ, this.fx3dW);
        if (!force && this._vec4Equal(this._edgeFx3d, this._last3d)) {
            return;
        }
        if (!this._mat3d) {
            return;
        }
        this._mat3d.setProperty(EDGE_FX_PROP, this._edgeFx3d);
        this._last3d.set(this._edgeFx3d);
    }

    private _vec4Equal(a: Vec4, b: Vec4): boolean {
        return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
    }
}
