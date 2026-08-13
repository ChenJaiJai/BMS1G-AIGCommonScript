// 已根據一個或多個協議授權給 .NET Foundation。
// .NET Foundation 以 MIT 授權此檔案給您。

import { ILogger } from "./ILogger";
import { TransferFormat } from "./ITransport";

/** 定義 Hub 訊息的類型。 */
export enum MessageType {
    /** 表示此訊息為 Invocation（呼叫）訊息並實作 {@link @microsoft/signalr.InvocationMessage} 介面。 */
    Invocation = 1,
    /** 表示此訊息為 StreamItem（串流項目）訊息並實作 {@link @microsoft/signalr.StreamItemMessage} 介面。 */
    StreamItem = 2,
    /** 表示此訊息為 Completion（完成）訊息並實作 {@link @microsoft/signalr.CompletionMessage} 介面。 */
    Completion = 3,
    /** 表示此訊息為 Stream Invocation（串流呼叫）訊息並實作 {@link @microsoft/signalr.StreamInvocationMessage} 介面。 */
    StreamInvocation = 4,
    /** 表示此訊息為 Cancel Invocation（取消呼叫）訊息並實作 {@link @microsoft/signalr.CancelInvocationMessage} 介面。 */
    CancelInvocation = 5,
    /** 表示此訊息為 Ping 訊息並實作 {@link @microsoft/signalr.PingMessage} 介面。 */
    Ping = 6,
    /** 表示此訊息為 Close（關閉）訊息並實作 {@link @microsoft/signalr.CloseMessage} 介面。 */
    Close = 7,
    Ack = 8,
    Sequence = 9
}

/** 定義一個字典，使用字串為鍵和值，代表附加於 Hub 訊息的標頭。 */
export interface MessageHeaders {
    /** 取得或設定指定鍵的標頭。 */
    [key: string]: string;
}

/** 所有已知 Hub 訊息的聯合類型。 */
export type HubMessage =
    InvocationMessage |
    StreamInvocationMessage |
    StreamItemMessage |
    CompletionMessage |
    CancelInvocationMessage |
    PingMessage |
    CloseMessage |
    AckMessage |
    SequenceMessage;

/** 定義所有 Hub 訊息共用的屬性。 */
export interface HubMessageBase {
    /** A {@link @microsoft/signalr.MessageType} value indicating the type of this message. */
    readonly type: MessageType;
}

/** 定義所有與特定呼叫相關的 Hub 訊息共用的屬性。 */
export interface HubInvocationMessage extends HubMessageBase {
    /** 包含附加於訊息的標頭的 {@link @microsoft/signalr.MessageHeaders} 字典。 */
    readonly headers?: MessageHeaders;
    /** 與此訊息相關的呼叫 ID。
     *
     * 對於 {@link @microsoft/signalr.StreamInvocationMessage} 和 {@link @microsoft/signalr.CompletionMessage} 預期會存在。若為 {@link @microsoft/signalr.InvocationMessage}，當傳送者不期望回應時，該值可能為 'undefined'。
     */
    readonly invocationId?: string;
}

/** 表示非串流呼叫的 Hub 訊息。 */
export interface InvocationMessage extends HubInvocationMessage {
    /** @inheritDoc */
    readonly type: MessageType.Invocation;
    /** 目標方法名稱。 */
    readonly target: string;
    /** 目標方法的參數。 */
    readonly arguments: any[];
    /** 目標方法的串流 ID。 */
    readonly streamIds?: string[];
}

/** 表示串流呼叫的 Hub 訊息。 */
export interface StreamInvocationMessage extends HubInvocationMessage {
    /** @inheritDoc */
    readonly type: MessageType.StreamInvocation;

    /** 呼叫 ID。 */
    readonly invocationId: string;
    /** 目標方法名稱。 */
    readonly target: string;
    /** 目標方法的參數。 */
    readonly arguments: any[];
    /** 目標方法的串流 ID。 */
    readonly streamIds?: string[];
}

/** 表示作為結果串流的一部分所產生的單一項目的 Hub 訊息。 */
export interface StreamItemMessage extends HubInvocationMessage {
    /** @inheritDoc */
    readonly type: MessageType.StreamItem;

    /** 呼叫 ID。 */
    readonly invocationId: string;

    /** 伺服器產生的項目。 */
    readonly item?: any;
}

/** 表示呼叫結果的 Hub 訊息。 */
export interface CompletionMessage extends HubInvocationMessage {
    /** @inheritDoc */
    readonly type: MessageType.Completion;
    /** 呼叫 ID。 */
    readonly invocationId: string;
    /** 呼叫所產生的錯誤（若有）。
     *
     * {@link @microsoft/signalr.CompletionMessage.error} 或 {@link @microsoft/signalr.CompletionMessage.result} 必須擇一定義，但不能同時存在。
     */
    readonly error?: string;
    /** 呼叫產生的結果（若有）。
     *
     * {@link @microsoft/signalr.CompletionMessage.error} 或 {@link @microsoft/signalr.CompletionMessage.result} 必須擇一定義，但不能同時存在。
     */
    readonly result?: any;
}

/** 表示傳送者仍處於活動狀態的 Hub 訊息。 */
export interface PingMessage extends HubMessageBase {
    /** @inheritDoc */
    readonly type: MessageType.Ping;
}

/** 表示傳送者正在關閉連線的 Hub 訊息。
 *
 * 若 {@link @microsoft/signalr.CloseMessage.error} 被定義，表示傳送者因錯誤而關閉連線。
 */
export interface CloseMessage extends HubMessageBase {
    /** @inheritDoc */
    readonly type: MessageType.Close;
    /** 觸發關閉的錯誤（若有）。
     *
     * 若此屬性為 undefined，表示連線為正常且無錯誤地關閉。
     */
    readonly error?: string;

    /** 若為 true，啟用自動重新連線的客戶端在接收到 CloseMessage 後應該嘗試重新連線。否則不應該嘗試。 */
    readonly allowReconnect?: boolean;
}

/** 用以請求取消串流呼叫的 Hub 訊息。 */
export interface CancelInvocationMessage extends HubInvocationMessage {
    /** @inheritDoc */
    readonly type: MessageType.CancelInvocation;
    /** 呼叫 ID。 */
    readonly invocationId: string;
}

export interface AckMessage extends HubMessageBase
{
    readonly type: MessageType.Ack;

    readonly sequenceId: number;
}

export interface SequenceMessage extends HubMessageBase
{
    readonly type: MessageType.Sequence;

    readonly sequenceId: number;
}

/** 用於與 SignalR Hubs 通訊的協定抽象。  */
export interface IHubProtocol {
    /** 協定的名稱。SignalR 用它在客戶端與伺服器之間解析協定。 */
    readonly name: string;
    /** 協定的版本。 */
    readonly version: number;
    /** 協定的 {@link @microsoft/signalr.TransferFormat}。 */
    readonly transferFormat: TransferFormat;

    /** 從指定的序列化表示建立 {@link @microsoft/signalr.HubMessage} 物件陣列。
     *
     * 若 {@link @microsoft/signalr.IHubProtocol.transferFormat} 為 'Text'，則 `input` 參數必須為字串，否則必須為 ArrayBuffer。
     *
     * @param {string | ArrayBuffer} input 包含序列化表示的字串或 ArrayBuffer。
     * @param {ILogger} logger 用於在解析期間記錄訊息的記錄器。
     */
    parseMessages(input: string | ArrayBuffer, logger: ILogger): HubMessage[];

    /** 將指定的 {@link @microsoft/signalr.HubMessage} 寫入為字串或 ArrayBuffer 並傳回。
     *
     * 若 {@link @microsoft/signalr.IHubProtocol.transferFormat} 為 'Text'，則此方法的結果將為字串，否則為 ArrayBuffer。
     *
     * @param {HubMessage} message 要寫入的訊息。
     * @returns {string | ArrayBuffer} 包含序列化表示的字串或 ArrayBuffer。
     */
    writeMessage(message: HubMessage): string | ArrayBuffer;
}
