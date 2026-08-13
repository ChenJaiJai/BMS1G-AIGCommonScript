/** 框架層事件。字串值須與遊戲端 GameState 對應項保持一致。 */
export enum CoreEvents {
    Init = 'Init',
    ReqInit = 'ReqInit',
    PlayWebM = 'PlayWebM',
    /** 遊戲組好關鍵字清單後，請框架播放器依序播放 */
    PlayVideo = 'PlayVideo',
    /** 一支 clip 真正開始播放（百家樂用來驅動撲克動畫） */
    VideoClipStarted = 'VideoClipStarted',
    SyncTime = 'SyncTime',
    ResetGame = 'ResetGame',
    LoadingOpen = 'LoadingOpen',
    LoadingClose = 'LoadingClose',
    Reconnect = 'Reconnect',
    /** DEBUG：目前桌況字串 */
    GameCurrentStatus = 'GameCurrentStatus',
}
