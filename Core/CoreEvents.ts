/** 框架層事件。遊戲專屬事件請放遊戲端 GameState。 */
export enum CoreEvents {
    Init = 'Init',
    PlayVideo = 'PlayVideo',
    VideoClipStarted = 'VideoClipStarted',
    SyncTime = 'SyncTime',
    ResetGame = 'ResetGame',
    LoadingOpen = 'LoadingOpen',
    LoadingClose = 'LoadingClose',
    Reconnect = 'Reconnect',
    GameCurrentStatus = 'GameCurrentStatus',
}
