# AIGCommon

人工座台系列**框架庫**，不是可執行遊戲。掛到遊戲專案後，仍要自己寫登入、場景、Bundle 名稱、Material，以及 `InitGate.complete`。

只 clone 本庫也能照這份建立新專案。BBA 遊戲細節（百家樂規則、荷官清單）不在這裡。

| 項目 | 值 |
|------|-----|
| 引擎 | Cocos Creator **3.8.7** |
| 目標平台 | Web（H5） |
| 掛載路徑 | **必須** `assets/AIGCommon`（import 寫死 `db://assets/AIGCommon/...`） |
| 遠端 | `https://github.com/ChenJaiJai/BMS1G-AIGCommonScript.git`（branch `master`） |

路徑改名（例如 `assets/Common`）會讓全部 import 失敗。

---

## 1. 掛載（會自動產生 `.gitmodules`）

在**新專案 repo 根目錄**執行。`git submodule add` 會 clone 本庫到 `assets/AIGCommon`，並**自動寫出**根目錄的 `.gitmodules`。資料夾名必須是 `AIGCommon`。

```bash
git submodule add -b master https://github.com/ChenJaiJai/BMS1G-AIGCommonScript.git assets/AIGCommon
```

跑完後根目錄會出現：

```
# .gitmodules（指令自動產生，不要手改 path）
[submodule "assets/AIGCommon"]
	path = assets/AIGCommon
	url = https://github.com/ChenJaiJai/BMS1G-AIGCommonScript.git
	branch = master
```

然後 pin 到你驗證過能編譯的 commit（不要 blindly 跟 `master`），再 commit 進遊戲 repo：

```bash
cd assets/AIGCommon
git checkout <你驗證過的SHA>
cd ../..
git add .gitmodules assets/AIGCommon
git commit -m "Add AIGCommon submodule"
```

其他人 clone 新專案：

```bash
git clone --recurse-submodules <新專案.git>
# 或已 clone 完、缺 AIGCommon 內容：
git submodule update --init --recursive
```

本 README 寫作時 BBA 指向 `24988eb`（2026-08-14）。之後請以你實際驗證過的 SHA 為準。

不要用「在 `assets/` 裡 `git clone`」當正式做法：那樣**不會**產生 `.gitmodules`，別人 clone 遊戲 repo 也帶不走本庫。

### 必帶 `.meta`

整包帶走 `.meta`，**不要**讓 Creator 重產 UUID。Shader、腳本互相引用都靠 UUID。  
若 Editor 跳出「UUID 衝突／重新產生」，先停下來對 diff，不要全選 Accept。

---

## 2. 目錄（本庫有什麼）

```
assets/AIGCommon/
├── Core/           EventMsg、CoreEvents、InitGate、waitUntil
├── Resource/       BundleMng
├── Video/          VideoComponent、WebmVideoTexture、WebmClipMap
├── Audio/          MusicMng
├── Net/
│   ├── RequestTool/
│   └── SignalR/    Hub + MessagePack
└── Shader/         webm-edge-smooth、yyeva-alpha-split（effect + 預設 Material）
```

本庫**不含**：場景 Prefab（GameCanvas／VideoCanvas／EnvCam）、Loading UI、背景／桌布 Sprite、荷官影片、撲克 FBX／材質、遊戲 Domain。影片預設 Material 在 `Shader/`，與 effect 同目錄。

---

## 3. InitGate

`InitTask` 只放各座台都會等的項：`Background`、`Table`、`Video`。  
遊戲自己的項在遊戲專案定義，`reset` 時一起傳。

```ts
import { EventMsg } from 'db://assets/AIGCommon/Core/EventMsg';
import { CoreEvents } from 'db://assets/AIGCommon/Core/CoreEvents';
import InitGate, { InitTask } from 'db://assets/AIGCommon/Core/InitGate';

// 遊戲端常數；沒撲克就不要加
export const GameInitTask = { Poker: 'Poker' } as const;

InitGate.reset([
    InitTask.Background,
    InitTask.Table,
    InitTask.Video,
    GameInitTask.Poker,
]);
EventMsg.emit(CoreEvents.Init, loginData);
await InitGate.waitAll();
```

- 沒撲克：不要把 `Poker` 放進 `reset`
- 沒荷官影片：不要把 `InitTask.Video` 放進 `reset`
- `reset` 列出的每個 id 都要有人 `complete`（**失敗路徑也要**），否則 `waitAll` 不會結束
- `complete` 可重入，重複呼叫無害

不要把遊戲專屬任務加進本庫的 `InitTask`。

---

## 4. CoreEvents — 必接／選接

現行 enum **已無** `ReqInit`。啟動完成只走 InitGate。

| 事件 | 新專案 | 說明 |
|------|--------|------|
| `Init` | **必接** | 登入成功後由遊戲端 emit；各 Manager 載入資源 |
| `LoadingOpen` / `LoadingClose` | **建議** | 斷線／開局遮罩 |
| `ResetGame` | **建議** | 斷線重置播放與牌面 |
| `Reconnect` | **建議** | 重連中清播放清單 |
| `GameCurrentStatus` | 可選 | DEBUG 狀態字串 |
| `PlayWebM` | 有荷官影片才接 | `VideoComponent` COMPLETED 會 emit；要有 Manager 播下一支 |
| `VideoClipStarted` | 有 3D／除錯 Label 才接 | clip 開始播 |
| `SyncTime` | 有 skeletal 對嘴才接 | 影片秒數 |

遊戲專屬事件（開獎、補牌、換靴）放遊戲端 `GameState`，**不要**加進 `CoreEvents`。

---

## 5. 遊戲端最小骨架（複製後改 URL）

```ts
// Presentation/Config/GameConfig.ts
export const GameConfig = {
    deskId: '',
    authUrl: 'https://你的登入API',
    messageRoomUrl: 'https://你的Hub',
    defaultBackground: '你的背景子路徑',
    defaultTable: '你的桌布子路徑',
};

// 遊戲事件 — 不要寫進 CoreEvents
export enum GameState {
    // 本遊戲自己的事件
}

// 登入成功後（遊戲端 Manager）
import Request, { Method } from 'db://assets/AIGCommon/Net/RequestTool/Request';
import { _signalR } from 'db://assets/AIGCommon/Net/SignalR/SignalR';
import BundleMng from 'db://assets/AIGCommon/Resource/BundleMng';
import { SpriteFrame } from 'cc';

const login = await new Request()
    .setMethod(Method.POST)
    .setBody(JSON.stringify({ DeskId: deskId }))
    .deletother()
    .fetchData(GameConfig.authUrl);

const signal = new _signalR();
await signal.init(GameConfig.messageRoomUrl, login.Data.token);
signal.connection.on('你的Hub事件', handler);
signal.onClose(() => { /* LoadingOpen + ResetGame + 重登 */ });

InitGate.reset([InitTask.Background, InitTask.Table]); // 有影片再加 Video
EventMsg.emit(CoreEvents.Init, login.Data);
await InitGate.waitAll();

// 聽 Init 的模組：載入後 complete；catch 也要 complete
try {
    await BundleMng.load<SpriteFrame>('BackGround', path, SpriteFrame, GameConfig.defaultBackground);
} finally {
    InitGate.complete(InitTask.Background);
}
```

### 連線契約（這座 Hub，原樣抄）

座台系列走同一組 Auth + MessageRoom。下列是**後端／實測要求**，不要當 bug 改掉。

| 行為 | 為什麼這樣 |
|------|------------|
| 登入呼叫 `deletother()` | 這座登入 API 的現況。下一個座台同一支 API，沒有「改帶 Bearer」的問題 |
| **DEV 用 MessagePack，BUILD 用 JSON** | 原因未釐清；實測若 BUILD 也走 MessagePack，**正式環境連不上 SignalR**。不要拿掉 `if (DEV)` |
| 心跳 5 秒、只走 WebSocket、`skipNegotiation` | **後端指定這座**如此。超過 10 秒心跳可能被踢 |
| Hub 事件名、登入 DTO | 遊戲端自己寫（例如 `OnDeskChangeEGame`） |

---

## 6. Editor：Bundle、Shader、場景

`BundleMng.load('BackGround', ...)` 的第一個參數必須等於 Editor 裡的 **Bundle 名稱**。

| 常用名稱 | 誰 load | 沒有這項時 |
|----------|---------|------------|
| `BackGround` | 背景 Sprite | 不要 `reset(Background)` |
| `Table` | 桌布 | 同上 |
| `WebM` / `MP4` | 荷官影片 | 不要 `reset(Video)` |
| `Poker` | 牌面 | 不要把 Poker 加進 reset |
| `Music` | 音效 | `MusicMng` 也會試 `resources/Music/` |

### Shader vs Material

庫內 **effect 與預設 Material 都在**，與 effect 同目錄。可直接拖，不要重產 `.meta` UUID。

| 在本庫 | 掛到 |
|--------|------|
| `Shader/Smooth/webm-edge-smooth.effect` + `material.mtl` | WebM 槽 |
| `Shader/VideoMP4/yyeva-alpha-split.effect` + `yyeva-alpha-split.mtl` | MP4 槽 |

也可自建 Material、effect 指到同一支。撲克／牆壁材質留遊戲端。

場景 Prefab **不要**放進本庫。有荷官影片時，場景至少要有：

- 兩個 `VideoPlayer`（雙槽，避免切 clip 黑屏）
- 一個 2D `Sprite` 當貼圖目標
- 上述兩個 Material 拖到 Inspector
- 必須有人 `EventMsg.on(CoreEvents.PlayWebM, ...)`，否則下一支不會播

### 其它 API

```ts
import { waitUntil } from 'db://assets/AIGCommon/Core/waitUntil';
const ok = await waitUntil(() => ready, { timeoutMs: 60000 });
// 逾時 → resolve(false)，不 throw

import MusicMng from 'db://assets/AIGCommon/Audio/MusicMng';
await MusicMng.init();
MusicMng.musicPlay('TableBGM');
```

---

## 7. 不要搬／不要做

從舊座台（例如 BBA）抄程式時，**只抄遊戲端 Manager 當參考，不要整包複製**。

### 不要放進本庫

- 荷官影片、撲克貼圖、FBX
- 場景 Prefab（GameCanvas／VideoCanvas／EnvCam）
- 遊戲專屬事件、登入 DTO、荷官 enum
- 遊戲專屬 Init 任務（在遊戲端定義常數）

### 不要從 BBA 遊戲 repo 搬進新專案

BBA 這些舊路徑**已刪**；不要從 git 歷史抄回，一律用本庫：

| 不要搬（已刪） | 改用本庫 |
|--------|----------|
| `assets/Script/Mng/EventMsg.ts` | `Core/EventMsg.ts` |
| `assets/Script/Mng/BundleMng.ts` | `Resource/BundleMng.ts` |
| `assets/Script/Mng/MusicMng.ts` | `Audio/MusicMng.ts` |
| `assets/Script/SignalR/` | `Net/SignalR/` |
| `assets/RequestTool/` | `Net/RequestTool/` |
| `assets/Script/Presentation/Webm/` | `Video/` |
| `assets/Shader/` | `Shader/`（effect + 預設 `.mtl`） |

這些是 **BBA 遊戲專屬**，別的座台不要搬：

- `assets/Script/Domain/Baccarat/`
- `assets/Script/App/UseCases/`（PlayRound／PlayList）
- `DealerList`、荷官 enum、`ProcessState`／`Winner`
- `UrlQuery`（`deskId`／`gameType`）、`GameState.LoadingLogo`
- `Poker/`、撲克 FBX／貼圖、`Mat/Poker`
- `Prefab/`（GameCanvas／VideoCanvas／EnvCam／DefaultPoker）
- 荷官 WebM／MP4
- `GameConfig` 裡的 BBA URL、`gameTypeCode: 'BBA'`

可以當寫法參考、再刪掉遊戲邏輯的：`SignalRMng`（登入＋InitGate）、`GameMng`（loadBG／loadTable）、有影片才看 `WEBMMng`。

---

## 8. 驗收清單

接遊戲邏輯前先勾：

- [ ] `assets/AIGCommon` 存在，`.meta` 沒被重產
- [ ] `db://assets/AIGCommon/...` 可編譯
- [ ] `InitGate.reset` 的每個 id 都有 complete（含失敗路徑）
- [ ] `await InitGate.waitAll()` 會結束
- [ ] 斷線能 `LoadingOpen` + `ResetGame`
- [ ] （可選）能 POST 登入並 `_signalR.init` 連上 Hub
- [ ] （有影片）雙 VideoPlayer + 庫內預設 Material 已掛；`PlayWebM` 有人聽
- [ ] （有 Bundle）Editor Bundle 名稱與 `BundleMng.load` 第一參數一致
- [ ] 沒有把 BBA Domain／場景 Prefab／已刪舊路徑從 git 歷史抄進來

---

## 9. 已知缺口

- `CoreEvents` 混了影片專用事件；沒荷官可以不訂閱，但 enum 仍在
- 場景 Prefab 刻意不進本庫；影片預設 Material 已在 `Shader/`

空專案由各遊戲自己搭。掛載用第 1 節的 `git submodule add`（會自動產生 `.gitmodules`）。

有 BBA 遊戲 repo 時，對照文件：`MD/08-新專案接入AIGCommon.md`。
