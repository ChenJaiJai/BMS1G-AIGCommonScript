# AIGCommon

人工座台系列共用層（腳本 + Shader）。掛在遊戲專案 `assets/AIGCommon`。

後續獨立成 Git submodule 時：

```bash
git submodule add <AIGCommon-url> assets/AIGCommon
```

## 遊戲端要做的事

1. 實作 `IGameConfig`，啟動時寫入 `AppConfig.current`（見百家樂 `Presentation/Config/GameConfig.ts`）。
2. 覆寫 `VideoFormatConfig.resolve`，告訴框架哪個荷官走 WebM／MP4。
3. 連線成功後：

```ts
InitGate.reset([InitTask.Background, InitTask.Table, InitTask.Video /* , InitTask.Poker */]);
EventMsg.emit(CoreEvents.Init, deskLogin);
await InitGate.waitAll();
```

沒有撲克的遊戲不要登記 `InitTask.Poker`。

4. 把後端登入轉成 `DeskLogin`（`token` / `deskId` / `styles`）。
5. 局結果組好關鍵字後：`EventMsg.emit(CoreEvents.PlayVideo, string[])`。
6. Import 用 `db://assets/AIGCommon/...`。

## 不要改的事

- 不要重產 `.meta` UUID，場景／Prefab 靠 UUID 綁腳本與 Shader。
- 荷官影片、撲克貼圖、FBX 不進本庫，留在各遊戲 Asset Bundle。
