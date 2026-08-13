import { Asset, assetManager, AssetManager } from 'cc';

type AssetType<T extends Asset> = new (...args: any[]) => T;

class BundleMng {
    private bundleCache = new Map<string, AssetManager.Bundle>();
    private bundleLoading = new Map<string, Promise<AssetManager.Bundle>>();

    private async ensureBundle(bundleName: string): Promise<AssetManager.Bundle> {
        const cached = this.bundleCache.get(bundleName) ?? assetManager.getBundle(bundleName);
        if (cached) {
            this.bundleCache.set(bundleName, cached);
            return cached;
        }

        const loading = this.bundleLoading.get(bundleName);
        if (loading) return loading;

        const task = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(bundleName, (err, bundle) => {
                this.bundleLoading.delete(bundleName);
                if (err || !bundle) {
                    reject(err ?? new Error(`loadBundle 失敗：${bundleName}`));
                    return;
                }
                this.bundleCache.set(bundleName, bundle);
                resolve(bundle);
            });
        });

        this.bundleLoading.set(bundleName, task);
        return task;
    }

    async load<T extends Asset>(
        bundleName: string,
        assetPath: string,
        type: AssetType<T>,
        defaultAssetPath?: string,
    ): Promise<T> {
        const bundle = await this.ensureBundle(bundleName);
        const tryLoad = (path: string) => new Promise<T>((resolve, reject) => {
            bundle.load(path, type, (err, asset) => {
                if (err || !asset) {
                    reject(err ?? new Error(`bundle.load 失敗：${bundleName}:${path}`));
                    return;
                }
                resolve(asset as T);
            });
        });

        try {
            return await tryLoad(assetPath);
        } catch (error) {
            if (!defaultAssetPath || defaultAssetPath === assetPath) throw error;
            console.error(`[BundleMng] ${bundleName}:${assetPath} 沒有資源，改載入預設資源 ${defaultAssetPath}`, error);
            return await tryLoad(defaultAssetPath);
        }
    }

    async loadDir<T extends Asset>(
        bundleName: string,
        dirPath: string,
        type?: AssetType<T>,
        defaultDirPath?: string,
    ): Promise<T[]> {
        const bundle = await this.ensureBundle(bundleName);
        const tryLoadDir = (path: string) => new Promise<T[]>((resolve, reject) => {
            const done = (err: Error | null, assets: Asset[] | null) => {
                if (err || !assets) {
                    reject(err ?? new Error(`bundle.loadDir 失敗：${bundleName}:${path}`));
                    return;
                }
                resolve(assets as T[]);
            };

            if (type) bundle.loadDir(path, type, done);
            else bundle.loadDir(path, done);
        });

        try {
            const assets = await tryLoadDir(dirPath);
            if (assets.length === 0 && defaultDirPath && defaultDirPath !== dirPath) {
                console.error(`[BundleMng] ${bundleName}:${dirPath} 沒有資源，改載入預設資源 ${defaultDirPath}`);
                return await tryLoadDir(defaultDirPath);
            }
            return assets;
        } catch (error) {
            if (!defaultDirPath || defaultDirPath === dirPath) throw error;
            console.error(`[BundleMng] ${bundleName}:${dirPath} 沒有資源，改載入預設資源 ${defaultDirPath}`, error);
            return await tryLoadDir(defaultDirPath);
        }
    }
}

export default new BundleMng();

