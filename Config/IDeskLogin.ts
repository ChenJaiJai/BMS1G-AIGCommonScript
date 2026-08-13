/** 各遊戲登入成功後，轉成框架可讀的桌面樣式。 */
export interface DeskStyles {
    background: string;
    table: string;
    dealer: string;
    /** 無撲克的遊戲可省略 */
    poker?: string;
}

export interface DeskLogin {
    token: string;
    deskId: string;
    gameTypeCode: string;
    errCode?: number;
    styles: DeskStyles;
}
