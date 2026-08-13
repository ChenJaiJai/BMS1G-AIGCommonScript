export interface IGameConfig {
    authUrl: string;
    messageRoomUrl: string;
    tokenRetrySeconds: number;
    defaultBackground: string;
    defaultTable: string;
    defaultPoker?: string;
}

/** 遊戲啟動時寫入，框架 Scene／連線讀取。 */
export const AppConfig = {
    current: null as IGameConfig | null,
};
