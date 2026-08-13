export type VideoKind = 'webm' | 'mp4';

export interface VideoLoadOptions {
    kind: VideoKind;
    dealer: string;
    fallbackDealer: string;
}

export type VideoFormatResolver = (dealer: string) => VideoLoadOptions;

const defaultResolve: VideoFormatResolver = (dealer) => ({
    kind: 'webm',
    dealer,
    fallbackDealer: dealer,
});

/** 遊戲在啟動時覆寫，避免框架寫死荷官名單。 */
export const VideoFormatConfig = {
    resolve: defaultResolve,
};
