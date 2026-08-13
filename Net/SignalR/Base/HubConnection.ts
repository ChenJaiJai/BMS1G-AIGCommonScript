// Licensed to the .NET Foundation under one or more agreements.
// The .NET Foundation licenses this file to you under the MIT license.

import { AbortError } from "./Errors";
import { HandshakeProtocol, HandshakeRequestMessage, HandshakeResponseMessage } from "./HandshakeProtocol";
import { IConnection } from "./IConnection";
import { CancelInvocationMessage, CloseMessage, CompletionMessage, IHubProtocol, InvocationMessage, MessageType, StreamInvocationMessage, StreamItemMessage } from "./IHubProtocol";
import { ILogger, LogLevel } from "./ILogger";
import { IRetryPolicy } from "./IRetryPolicy";
import { MessageBuffer } from "./MessageBuffer";
import { IStreamResult } from "./Stream";
import { Subject } from "./Subject";
import { Arg, getErrorString, Platform } from "./Utils";

const DEFAULT_TIMEOUT_IN_MS: number = 30 * 1000;
const DEFAULT_PING_INTERVAL_IN_MS: number = 15 * 1000;
const DEFAULT_STATEFUL_RECONNECT_BUFFER_SIZE = 100_000;

/** 描述 {@link HubConnection} 與伺服器連線的當前狀態。 */
export enum HubConnectionState {
    /** Hub 連線已斷線。 */
    Disconnected = "Disconnected",
    /** Hub 連線正在連線中。 */
    Connecting = "Connecting",
    /** Hub 連線已連線。 */
    Connected = "Connected",
    /** Hub 連線正在斷線中。 */
    Disconnecting = "Disconnecting",
    /** Hub 連線正在重新連線中。 */
    Reconnecting = "Reconnecting",
}

/** 代表到 SignalR Hub 的連線。 */
export class HubConnection {
    private readonly _cachedPingMessage: string | ArrayBuffer;
    // Needs to not start with _ for tests
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private readonly connection: IConnection;
    private readonly _logger: ILogger;
    private readonly _reconnectPolicy?: IRetryPolicy;
    private readonly _statefulReconnectBufferSize: number;
    private _protocol: IHubProtocol;
    private _handshakeProtocol: HandshakeProtocol;
    private _callbacks: { [invocationId: string]: (invocationEvent: StreamItemMessage | CompletionMessage | null, error?: Error) => void; };
    private _methods: { [name: string]: (((...args: any[]) => void) | ((...args: any[]) => any))[]; };
    private _invocationId: number;
    private _messageBuffer?: MessageBuffer;

    private _closedCallbacks: ((error?: Error) => void)[];
    private _reconnectingCallbacks: ((error?: Error) => void)[];
    private _reconnectedCallbacks: ((connectionId?: string) => void)[];

    private _receivedHandshakeResponse: boolean;
    private _handshakeResolver!: (value?: PromiseLike<{}>) => void;
    private _handshakeRejecter!: (reason?: any) => void;
    private _stopDuringStartError?: Error;

    private _connectionState: HubConnectionState;
    // connectionStarted is tracked independently from connectionState, so we can check if the
    // connection ever did successfully transition from connecting to connected before disconnecting.
    private _connectionStarted: boolean;
    private _startPromise?: Promise<void>;
    private _stopPromise?: Promise<void>;
    private _nextKeepAlive: number = 0;

    // The type of these a) doesn't matter and b) varies when building in browser and node contexts
    // Since we're building the WebPack bundle directly from the TypeScript, this matters (previously
    // we built the bundle from the compiled JavaScript).
    private _reconnectDelayHandle?: any;
    private _timeoutHandle?: any;
    private _pingServerHandle?: any;

    private _freezeEventListener = () => {
        this._logger.log(LogLevel.Warning, "The page is being frozen, this will likely lead to the connection being closed and messages being lost. For more information see the docs at https://learn.microsoft.com/aspnet/core/signalr/javascript-client#bsleep");
    };

    /** 伺服器逾時（毫秒）。
     *
     * 若在此時間內未接收到伺服器的任何訊息，連線將以錯誤終止。
     * 預設逾時為 30,000 毫秒（30 秒）。
     */
    public serverTimeoutInMilliseconds: number;

    /** 向伺服器發送 ping 的預設間隔（毫秒）。
     *
     * 預設為 15,000 毫秒（15 秒）。
     * 允許伺服器偵測到硬斷線（例如使用者拔除電腦）。
     * ping 的實際頻率不會高於伺服器的 ping 頻率。
     * 若伺服器每 5 秒 ping，設定小於 5 秒仍會以 5 秒為準。
     */
    public keepAliveIntervalInMilliseconds: number;

    /** @internal */
    // Using a public static factory method means we can have a private constructor and an _internal_
    // create method that can be used by HubConnectionBuilder. An "internal" constructor would just
    // be stripped away and the '.d.ts' file would have no constructor, which is interpreted as a
    // public parameter-less constructor.
    public static create(
        connection: IConnection,
        logger: ILogger,
        protocol: IHubProtocol,
        reconnectPolicy?: IRetryPolicy,
        serverTimeoutInMilliseconds?: number,
        keepAliveIntervalInMilliseconds?: number,
        statefulReconnectBufferSize?: number): HubConnection {
        return new HubConnection(connection, logger, protocol, reconnectPolicy,
            serverTimeoutInMilliseconds, keepAliveIntervalInMilliseconds, statefulReconnectBufferSize);
    }

    private constructor(
        connection: IConnection,
        logger: ILogger,
        protocol: IHubProtocol,
        reconnectPolicy?: IRetryPolicy,
        serverTimeoutInMilliseconds?: number,
        keepAliveIntervalInMilliseconds?: number,
        statefulReconnectBufferSize?: number) {
        Arg.isRequired(connection, "connection");
        Arg.isRequired(logger, "logger");
        Arg.isRequired(protocol, "protocol");

        this.serverTimeoutInMilliseconds = serverTimeoutInMilliseconds ?? DEFAULT_TIMEOUT_IN_MS;
        this.keepAliveIntervalInMilliseconds = keepAliveIntervalInMilliseconds ?? DEFAULT_PING_INTERVAL_IN_MS;

        this._statefulReconnectBufferSize = statefulReconnectBufferSize ?? DEFAULT_STATEFUL_RECONNECT_BUFFER_SIZE;

        this._logger = logger;
        this._protocol = protocol;
        this.connection = connection;
        this._reconnectPolicy = reconnectPolicy;
        this._handshakeProtocol = new HandshakeProtocol();

        this.connection.onreceive = (data: any) => this._processIncomingData(data);
        this.connection.onclose = (error?: Error) => this._connectionClosed(error);

        this._callbacks = {};
        this._methods = {};
        this._closedCallbacks = [];
        this._reconnectingCallbacks = [];
        this._reconnectedCallbacks = [];
        this._invocationId = 0;
        this._receivedHandshakeResponse = false;
        this._connectionState = HubConnectionState.Disconnected;
        this._connectionStarted = false;

        this._cachedPingMessage = this._protocol.writeMessage({ type: MessageType.Ping });
    }

    /** 表示 {@link HubConnection} 與伺服器的連線狀態。 */
    get state(): HubConnectionState {
        return this._connectionState;
    }

    /** 表示 {@link HubConnection} 在伺服器端的 connection id。當連線為斷線狀態或跳過協商時，connection id 會是 null。 */
    get connectionId(): string | null {
        return this.connection ? (this.connection.connectionId || null) : null;
    }

    /** 表示 {@link HubConnection} 連線的網址。 */
    get baseUrl(): string {
        return this.connection.baseUrl || "";
    }

    /**
     * 為 HubConnection 設定新的 url。注意只有在連線處於 Disconnected 或 Reconnecting 狀態時才能更改 url。
     * @param {string} url 要連線的網址。
     */
    set baseUrl(url: string) {
        if (this._connectionState !== HubConnectionState.Disconnected && this._connectionState !== HubConnectionState.Reconnecting) {
            throw new Error("The HubConnection must be in the Disconnected or Reconnecting state to change the url.");
        }

        if (!url) {
            throw new Error("The HubConnection url must be a valid url.");
        }

        this.connection.baseUrl = url;
    }

    /** 啟動連線。
     *
     * @returns {Promise<void>} 連線成功建立時解析，或發生錯誤時拒絕。
     */
    public start(): Promise<void> {
        this._startPromise = this._startWithStateTransitions();
        return this._startPromise;
    }

    private async _startWithStateTransitions(): Promise<void> {
        if (this._connectionState !== HubConnectionState.Disconnected) {
            return Promise.reject(new Error("Cannot start a HubConnection that is not in the 'Disconnected' state."));
        }

        this._connectionState = HubConnectionState.Connecting;
        this._logger.log(LogLevel.Debug, "Starting HubConnection.");

        try {
            await this._startInternal();

            if (Platform.isBrowser) {
                // Log when the browser freezes the tab so users know why their connection unexpectedly stopped working
                window.document.addEventListener("freeze", this._freezeEventListener);
            }

            this._connectionState = HubConnectionState.Connected;
            this._connectionStarted = true;
            this._logger.log(LogLevel.Debug, "HubConnection connected successfully.");
        } catch (e) {
            this._connectionState = HubConnectionState.Disconnected;
            this._logger.log(LogLevel.Debug, `HubConnection failed to start successfully because of error '${e}'.`);
            return Promise.reject(e);
        }
    }

    private async _startInternal() {
        this._stopDuringStartError = undefined;
        this._receivedHandshakeResponse = false;
        // 在連線（或重新連線）開始前先建立 promise，否則可能與接收訊息發生競爭
        const handshakePromise = new Promise((resolve, reject) => {
            this._handshakeResolver = resolve;
            this._handshakeRejecter = reject;
        });

        await this.connection.start(this._protocol.transferFormat);

        try {
            let version = this._protocol.version;
            if (!this.connection.features.reconnect) {
                // Stateful Reconnect 從 HubProtocol 版本 2 開始，舊伺服器僅支援版本 1，因此在握手時嘗試發送版本 1 以維持相容性。
                version = 1;
            }

            const handshakeRequest: HandshakeRequestMessage = {
                protocol: this._protocol.name,
                version,
            };

            this._logger.log(LogLevel.Debug, "Sending handshake request.");

            await this._sendMessage(this._handshakeProtocol.writeHandshakeRequest(handshakeRequest));

            this._logger.log(LogLevel.Information, `Using HubProtocol '${this._protocol.name}'.`);

            // 防禦性地清除超時，以防在完成 start 之前就收到伺服器訊息
            this._cleanupTimeout();
            this._resetTimeoutPeriod();
            this._resetKeepAliveInterval();

            await handshakePromise;

            // 在握手成功完成且連線被關閉之間，此續續可能執行，因此需要檢查 stopDuringStartError
            if (this._stopDuringStartError) {
                // 重要的是拋出錯誤而不是返回拒絕的 Promise，否則狀態轉換可能在稍後被允許發生。
                // eslint-disable-next-line @typescript-eslint/no-throw-literal
                throw this._stopDuringStartError;
            }

            const useStatefulReconnect = this.connection.features.reconnect || false;
            if (useStatefulReconnect) {
                this._messageBuffer = new MessageBuffer(this._protocol, this.connection, this._statefulReconnectBufferSize);
                this.connection.features.disconnected = this._messageBuffer._disconnected.bind(this._messageBuffer);
                this.connection.features.resend = () => {
                    if (this._messageBuffer) {
                        return this._messageBuffer._resend();
                    }
                };
            }

            if (!this.connection.features.inherentKeepAlive) {
                await this._sendMessage(this._cachedPingMessage);
            }
        } catch (e) {
            this._logger.log(LogLevel.Debug, `Hub handshake failed with error '${e}' during start(). Stopping HubConnection.`);

            this._cleanupTimeout();
            this._cleanupPingTimer();

            // HttpConnection.stop() 在 onclose callback 被呼叫之後才應完成。
            // 這會在 HttpConnection.stop() 完成前先將 HubConnection 轉為 disconnected。
            await this.connection.stop(e);
            throw e;
        }
    }

    /** 停止連線。
     *
     * @returns {Promise<void>} 連線成功終止時解析，或發生錯誤時拒絕。
     */
    public async stop(): Promise<void> {
        // Capture the start promise before the connection might be restarted in an onclose callback.
        const startPromise = this._startPromise;
        this.connection.features.reconnect = false;

        this._stopPromise = this._stopInternal();
        await this._stopPromise;

        try {
            // Awaiting undefined continues immediately
            await startPromise;
        } catch (e) {
            // 這個例外會作為 start 方法的拒絕 Promise 返回給使用者。
        }
    }

    private _stopInternal(error?: Error): Promise<void> {
        if (this._connectionState === HubConnectionState.Disconnected) {
            this._logger.log(LogLevel.Debug, `Call to HubConnection.stop(${error}) ignored because it is already in the disconnected state.`);
            return Promise.resolve();
        }

        if (this._connectionState === HubConnectionState.Disconnecting) {
            this._logger.log(LogLevel.Debug, `Call to HttpConnection.stop(${error}) ignored because the connection is already in the disconnecting state.`);
            return this._stopPromise!;
        }

        const state = this._connectionState;
        this._connectionState = HubConnectionState.Disconnecting;

        this._logger.log(LogLevel.Debug, "Stopping HubConnection.");

        if (this._reconnectDelayHandle) {
            // 我們正在等待重新連線延遲，此時底層連線已停止。
            // 只需清除 handle 停止重新連線迴圈，並觸發 onclose callbacks。
            this._logger.log(LogLevel.Debug, "Connection stopped during reconnect delay. Done reconnecting.");

            clearTimeout(this._reconnectDelayHandle);
            this._reconnectDelayHandle = undefined;

            this._completeClose();
            return Promise.resolve();
        }

        if (state === HubConnectionState.Connected) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._sendCloseMessage();
        }

        this._cleanupTimeout();
        this._cleanupPingTimer();
        this._stopDuringStartError = error || new AbortError("The connection was stopped before the hub handshake could complete.");

        // HttpConnection.stop() 應在 HttpConnection.start() 失敗或 onclose callback 被呼叫後才完成。
        // onclose callback 會在需要時先將 HubConnection 轉為 disconnected，然後 HttpConnection.stop() 再完成。
        return this.connection.stop(error);
    }

    private async _sendCloseMessage() {
        try {
            await this._sendWithProtocol(this._createCloseMessage());
        } catch {
            // 忽略，這僅是嘗試告知伺服器客戶端已正常關閉。
        }
    }

    /** 在伺服器上以指定名稱與參數呼叫可串流的 hub 方法。
     *
     * @typeparam T 伺服器回傳項目的型別。
     * @param {string} methodName 要呼叫的伺服器方法名稱。
     * @param {any[]} args 用來呼叫伺服器方法的參數。
     * @returns {IStreamResult<T>} 一個可以隨著伺服器回傳結果逐步取得項目的物件。
     */
    public stream<T = any>(methodName: string, ...args: any[]): IStreamResult<T> {
        const [streams, streamIds] = this._replaceStreamingParams(args);
        const invocationDescriptor = this._createStreamInvocation(methodName, args, streamIds);

        // eslint-disable-next-line prefer-const
        let promiseQueue: Promise<void>;

        const subject = new Subject<T>();
        subject.cancelCallback = () => {
            const cancelInvocation: CancelInvocationMessage = this._createCancelInvocation(invocationDescriptor.invocationId);

            delete this._callbacks[invocationDescriptor.invocationId];

            return promiseQueue.then(() => {
                return this._sendWithProtocol(cancelInvocation);
            });
        };

        this._callbacks[invocationDescriptor.invocationId] = (invocationEvent: CompletionMessage | StreamItemMessage | null, error?: Error) => {
            if (error) {
                subject.error(error);
                return;
            } else if (invocationEvent) {
                // invocationEvent 不會是 null 當沒有傳入錯誤給 callback
                if (invocationEvent.type === MessageType.Completion) {
                    if (invocationEvent.error) {
                        subject.error(new Error(invocationEvent.error));
                    } else {
                        subject.complete();
                    }
                } else {
                    subject.next((invocationEvent.item) as T);
                }
            }
        };

        promiseQueue = this._sendWithProtocol(invocationDescriptor)
            .catch((e) => {
                subject.error(e);
                delete this._callbacks[invocationDescriptor.invocationId];
            });

        this._launchStreams(streams, promiseQueue);

        return subject;
    }

    private _sendMessage(message: any) {
        this._resetKeepAliveInterval();
        return this.connection.send(message);
    }

    /**
     * 將一個 JS 物件序列化並傳送到伺服器。
     * @param message 要序列化並傳送的物件。
     */
    private _sendWithProtocol(message: any) {
        if (this._messageBuffer) {
            return this._messageBuffer._send(message);
        } else {
            return this._sendMessage(this._protocol.writeMessage(message));
        }
    }

    /** 在伺服器上以指定名稱與參數呼叫 hub 方法，但不等待伺服器回應。
     *
     * 此方法回傳的 Promise 會在客戶端已將呼叫發送給伺服器時解析。伺服器可能仍在處理該呼叫。
     *
     * @param {string} methodName 要呼叫的伺服器方法名稱。
     * @param {any[]} args 用來呼叫伺服器方法的參數。
     * @returns {Promise<void>} 呼叫已成功發送時解析，或發生錯誤時拒絕。
     */
    public send(methodName: string, ...args: any[]): Promise<void> {
        const [streams, streamIds] = this._replaceStreamingParams(args);
        const sendPromise = this._sendWithProtocol(this._createInvocation(methodName, args, true, streamIds));

        this._launchStreams(streams, sendPromise);

        return sendPromise;
    }

    /** 在伺服器上以指定名稱與參數呼叫 hub 方法。
     *
     * 此方法回傳的 Promise 會在伺服器表示已完成該方法的執行時解析。若方法有回傳值，該值會作為 Promise 的解析結果。
     *
     * @typeparam T 預期的回傳型別。
     * @param {string} methodName 要呼叫的伺服器方法名稱。
     * @param {any[]} args 用來呼叫伺服器方法的參數。
     * @returns {Promise<T>} 解析為伺服器方法的結果，或在錯誤時拒絕。
     */
    public invoke<T = any>(methodName: string, ...args: any[]): Promise<T> {
        const [streams, streamIds] = this._replaceStreamingParams(args);
        const invocationDescriptor = this._createInvocation(methodName, args, false, streamIds);

        const p = new Promise<any>((resolve, reject) => {
            // invocationId 對於非阻塞呼叫總是會有值
            this._callbacks[invocationDescriptor.invocationId!] = (invocationEvent: StreamItemMessage | CompletionMessage | null, error?: Error) => {
                if (error) {
                    reject(error);
                    return;
                } else if (invocationEvent) {
                    // invocationEvent 在沒有錯誤傳入 callback 時不會是 null
                    if (invocationEvent.type === MessageType.Completion) {
                        if (invocationEvent.error) {
                            reject(new Error(invocationEvent.error));
                        } else {
                            resolve(invocationEvent.result);
                        }
                    } else {
                        reject(new Error(`Unexpected message type: ${invocationEvent.type}`));
                    }
                }
            };

            const promiseQueue = this._sendWithProtocol(invocationDescriptor)
                .catch((e) => {
                    reject(e);
                    // invocationId 對於非阻塞呼叫總是會有值
                    delete this._callbacks[invocationDescriptor.invocationId!];
                });

            this._launchStreams(streams, promiseQueue);
        });

        return p;
    }

    /** 註冊當指定 hub 方法被呼叫時會被觸發的處理函式。
     *
     * @param {string} methodName 要定義的 hub 方法名稱。
     * @param {Function} newMethod 當 hub 方法被呼叫時會被觸發的處理函式。
     */
    public on(methodName: string, newMethod: (...args: any[]) => any): void;
    public on(methodName: string, newMethod: (...args: any[]) => void): void {
        if (!methodName || !newMethod) {
            return;
        }

        methodName = methodName.toLowerCase();
        if (!this._methods[methodName]) {
            this._methods[methodName] = [];
        }

        // 防止重複加入相同的處理函式
        if (this._methods[methodName].indexOf(newMethod) !== -1) {
            return;
        }

        this._methods[methodName].push(newMethod);
    }

    /** 移除指定 hub 方法的所有處理函式。
     *
     * @param {string} methodName 要移除處理函式的方法名稱。
     */
    public off(methodName: string): void;

    /** 移除指定 hub 方法的特定處理函式。
     *
     * 必須傳入與先前使用 {@link @microsoft/signalr.HubConnection.on} 註冊時相同的 Function 實例。傳入不同的實例（即使函式內容相同）也無法移除。
     *
     * @param {string} methodName 要移除處理函式的方法名稱。
     * @param {Function} method 要移除的處理函式。必須與先前傳入的 Function 實例相同。
     */
    public off(methodName: string, method: (...args: any[]) => void): void;
    public off(methodName: string, method?: (...args: any[]) => void): void {
        if (!methodName) {
            return;
        }

        methodName = methodName.toLowerCase();
        const handlers = this._methods[methodName];
        if (!handlers) {
            return;
        }
        if (method) {
            const removeIdx = handlers.indexOf(method);
            if (removeIdx !== -1) {
                handlers.splice(removeIdx, 1);
                if (handlers.length === 0) {
                    delete this._methods[methodName];
                }
            }
        } else {
            delete this._methods[methodName];
        }

    }

    /** 註冊當連線關閉時會被觸發的處理函式。
     *
     * @param {Function} callback 當連線關閉時會被觸發的函式。可選地接受一個參數，包含導致連線關閉的錯誤（如果有）。
     */
    public onclose(callback: (error?: Error) => void): void {
        if (callback) {
            this._closedCallbacks.push(callback);
        }
    }

    /** 註冊當連線開始重新連線時會被觸發的處理函式。
     *
     * @param {Function} callback 當連線開始重新連線時會被觸發的函式。可選地接受一個參數，包含導致重新連線的錯誤（如果有）。
     */
    public onreconnecting(callback: (error?: Error) => void): void {
        if (callback) {
            this._reconnectingCallbacks.push(callback);
        }
    }

    /** 註冊當連線成功重新連線時會被觸發的處理函式。
     *
     * @param {Function} callback 當連線成功重新連線時會被觸發的函式。
     */
    public onreconnected(callback: (connectionId?: string) => void): void {
        if (callback) {
            this._reconnectedCallbacks.push(callback);
        }
    }

    private _processIncomingData(data: any) {
        this._cleanupTimeout();

        if (!this._receivedHandshakeResponse) {
            data = this._processHandshakeResponse(data);
            this._receivedHandshakeResponse = true;
        }

        // 處理握手回應後可能資料已全部讀取完
        if (data) {
            // 解析訊息
            const messages = this._protocol.parseMessages(data, this._logger);

            for (const message of messages) {
                if (this._messageBuffer && !this._messageBuffer._shouldProcessMessage(message)) {
                    // 不處理該訊息，因為我們要麼在等待 SequenceMessage，要麼收到重複訊息
                    continue;
                }

                switch (message.type) {
                    case MessageType.Invocation:
                        this._invokeClientMethod(message)
                            .catch((e) => {
                                this._logger.log(LogLevel.Error, `Invoke client method threw error: ${getErrorString(e)}`);
                            });
                        break;
                    case MessageType.StreamItem:
                    case MessageType.Completion: {
                        const callback = this._callbacks[message.invocationId];
                        if (callback) {
                            if (message.type === MessageType.Completion) {
                                delete this._callbacks[message.invocationId];
                            }
                            try {
                                callback(message);
                            } catch (e) {
                                this._logger.log(LogLevel.Error, `Stream callback threw error: ${getErrorString(e)}`);
                            }
                        }
                        break;
                    }
                    case MessageType.Ping:
                        // 不處理 ping 訊息
                        break;
                    case MessageType.Close: {
                        this._logger.log(LogLevel.Information, "Close message received from server.");

                        const error = message.error ? new Error("Server returned an error on close: " + message.error) : undefined;

                        if (message.allowReconnect === true) {
                            // 雖然在這裡不等待 connection.stop() 看起來怪，但 processIncomingData 是在非 async 的 onreceive callback 中呼叫，
                            // 這已經是 serverTimeout() 的行為，且 HttpConnection.Stop() 應該捕捉並記錄所有可能的例外。
                            // eslint-disable-next-line @typescript-eslint/no-floating-promises
                            this.connection.stop(error);
                        } else {
                            // 我們無法在此等待 stopInternal()，但後續對 stop() 的呼叫會等待此 stopInternal()（若仍在進行中）
                            this._stopPromise = this._stopInternal(error);
                        }

                        break;
                    }
                    case MessageType.Ack:
                        if (this._messageBuffer) {
                            this._messageBuffer._ack(message);
                        }
                        break;
                    case MessageType.Sequence:
                        if (this._messageBuffer) {
                            this._messageBuffer._resetSequence(message);
                        }
                        break;
                    default:
                        this._logger.log(LogLevel.Warning, `Invalid message type: ${message.type}.`);
                        break;
                }
            }
        }

        this._resetTimeoutPeriod();
    }

    private _processHandshakeResponse(data: any): any {
        let responseMessage: HandshakeResponseMessage;
        let remainingData: any;

        try {
            [remainingData, responseMessage] = this._handshakeProtocol.parseHandshakeResponse(data);
        } catch (e) {
            const message = "Error parsing handshake response: " + e;
            this._logger.log(LogLevel.Error, message);

            const error = new Error(message);
            this._handshakeRejecter(error);
            throw error;
        }
        if (responseMessage.error) {
            const message = "Server returned handshake error: " + responseMessage.error;
            this._logger.log(LogLevel.Error, message);

            const error = new Error(message);
            this._handshakeRejecter(error);
            throw error;
        } else {
            this._logger.log(LogLevel.Debug, "Server handshake complete.");
        }

        this._handshakeResolver();
        return remainingData;
    }

    private _resetKeepAliveInterval() {
        if (this.connection.features.inherentKeepAlive) {
            return;
        }

        // 設定下次要發送 keep alive 的時間
        // 計時器會在下一次接收訊息時建立
        this._nextKeepAlive = new Date().getTime() + this.keepAliveIntervalInMilliseconds;

        this._cleanupPingTimer();
    }

    private _resetTimeoutPeriod() {
        if (!this.connection.features || !this.connection.features.inherentKeepAlive) {
            // 設定逾時計時器
            this._timeoutHandle = setTimeout(() => this.serverTimeout(), this.serverTimeoutInMilliseconds);

            // 若尚未有 keepAlive 計時器則設定一個
            if (this._pingServerHandle === undefined) {
                let nextPing = this._nextKeepAlive - new Date().getTime();
                if (nextPing < 0) {
                    nextPing = 0;
                }

                // 計時器必須從網路回呼中設定，以避免 Chrome 的計時器節流導致定時器每分鐘才執行一次
                this._pingServerHandle = setTimeout(async () => {
                    if (this._connectionState === HubConnectionState.Connected) {
                        try {
                            await this._sendMessage(this._cachedPingMessage);
                        } catch {
                            // 我們不在意錯誤，應該會在客戶端其他地方看到。連線可能已處於錯誤或關閉狀態，清理計時器避免繼續觸發
                            this._cleanupPingTimer();
                        }
                    }
                }, nextPing);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    private serverTimeout() {
        // 伺服器已長時間未與我們通訊。它不喜歡我們了 :(
        // 終止連線，但不需要等待該 Promise。這可能會觸發重新連線。
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.connection.stop(new Error("Server timeout elapsed without receiving a message from the server."));
    }

    private async _invokeClientMethod(invocationMessage: InvocationMessage) {
        const methodName = invocationMessage.target.toLowerCase();
        const methods = this._methods[methodName];
        if (!methods) {
            this._logger.log(LogLevel.Warning, `No client method with the name '${methodName}' found.`);

            // 客戶端沒有提供 handler，但伺服器仍期待回應，所以我們回傳錯誤
            if (invocationMessage.invocationId) {
                this._logger.log(LogLevel.Warning, `No result given for '${methodName}' method and invocation ID '${invocationMessage.invocationId}'.`);
                await this._sendWithProtocol(this._createCompletionMessage(invocationMessage.invocationId, "Client didn't provide a result.", null));
            }
            return;
        }

        // 複製 handlers 避免在迭代時被移除而修改陣列
        const methodsCopy = methods.slice();

        // 伺服器是否期待回應
        const expectsResponse = invocationMessage.invocationId ? true : false;
        // 我們保留最後的結果或例外，但仍會呼叫所有 handler
        let res;
        let exception;
        let completionMessage;
        for (const m of methodsCopy) {
            try {
                const prevRes = res;
                res = await m.apply(this, invocationMessage.arguments);
                if (expectsResponse && res && prevRes) {
                    this._logger.log(LogLevel.Error, `Multiple results provided for '${methodName}'. Sending error to server.`);
                    completionMessage = this._createCompletionMessage(invocationMessage.invocationId!, `Client provided multiple results.`, null);
                }
                // 若之後有結果則忽略先前的例外，例外會被記錄
                exception = undefined;
            } catch (e) {
                exception = e;
                this._logger.log(LogLevel.Error, `A callback for the method '${methodName}' threw error '${e}'.`);
            }
        }
        if (completionMessage) {
            await this._sendWithProtocol(completionMessage);
        } else if (expectsResponse) {
            // 若有例外代表沒有提供結果或在結果之後 handler 拋出例外
            if (exception) {
                completionMessage = this._createCompletionMessage(invocationMessage.invocationId!, `${exception}`, null);
            } else if (res !== undefined) {
                completionMessage = this._createCompletionMessage(invocationMessage.invocationId!, null, res);
            } else {
                this._logger.log(LogLevel.Warning, `No result given for '${methodName}' method and invocation ID '${invocationMessage.invocationId}'.`);
                // 客戶端沒有提供結果也沒有拋出例外，但伺服器期待回應，因此回傳錯誤
                completionMessage = this._createCompletionMessage(invocationMessage.invocationId!, "Client didn't provide a result.", null);
            }
            await this._sendWithProtocol(completionMessage);
        } else {
            if (res) {
                this._logger.log(LogLevel.Error, `Result given for '${methodName}' method but server is not expecting a result.`);
            }
        }
    }

    private _connectionClosed(error?: Error) {
        this._logger.log(LogLevel.Debug, `HubConnection.connectionClosed(${error}) called while in state ${this._connectionState}.`);

        // 觸發 handshakeRejecter 不一定足夠，因為它可能已解析但續續尚未執行
        this._stopDuringStartError = this._stopDuringStartError || error || new AbortError("The underlying connection was closed before the hub handshake could complete.");

        // 若握手正在進行中，start 會等待握手的 promise，所以我們完成它。
        // 若已完成，這將無作用。
        if (this._handshakeResolver) {
            this._handshakeResolver();
        }

        this._cancelCallbacksWithError(error || new Error("Invocation canceled due to the underlying connection being closed."));

        this._cleanupTimeout();
        this._cleanupPingTimer();

        if (this._connectionState === HubConnectionState.Disconnecting) {
            this._completeClose(error);
        } else if (this._connectionState === HubConnectionState.Connected && this._reconnectPolicy) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this._reconnect(error);
        } else if (this._connectionState === HubConnectionState.Connected) {
            this._completeClose(error);
        }

        // 如果上面的條件都不成立，HubConnection 應該處於以下狀態之一：
        // 1. Connecting：此時 handshakeResolver 會完成並由 stopDuringStartError 拋出錯誤。
        // 2. Reconnecting：handshakeResolver 會完成並讓目前的重連嘗試失敗，可能會繼續重試。
        // 3. Disconnected：已經完成工作。
    }

    private _completeClose(error?: Error) {
        if (this._connectionStarted) {
            this._connectionState = HubConnectionState.Disconnected;
            this._connectionStarted = false;
            if (this._messageBuffer) {
                this._messageBuffer._dispose(error ?? new Error("Connection closed."));
                this._messageBuffer = undefined;
            }

            if (Platform.isBrowser) {
                window.document.removeEventListener("freeze", this._freezeEventListener);
            }

            try {
                this._closedCallbacks.forEach((c) => c.apply(this, [error]));
            } catch (e) {
                this._logger.log(LogLevel.Error, `An onclose callback called with error '${error}' threw error '${e}'.`);
            }
        }
    }

    private async _reconnect(error?: Error) {
        const reconnectStartTime = Date.now();
        let previousReconnectAttempts = 0;
        let retryError = error !== undefined ? error : new Error("Attempting to reconnect due to a unknown error.");

        let nextRetryDelay = this._getNextRetryDelay(previousReconnectAttempts++, 0, retryError);

        if (nextRetryDelay === null) {
            this._logger.log(LogLevel.Debug, "Connection not reconnecting because the IRetryPolicy returned null on the first reconnect attempt.");
            this._completeClose(error);
            return;
        }

        this._connectionState = HubConnectionState.Reconnecting;

        if (error) {
            this._logger.log(LogLevel.Information, `Connection reconnecting because of error '${error}'.`);
        } else {
            this._logger.log(LogLevel.Information, "Connection reconnecting.");
        }

        if (this._reconnectingCallbacks.length !== 0) {
            try {
                this._reconnectingCallbacks.forEach((c) => c.apply(this, [error]));
            } catch (e) {
                this._logger.log(LogLevel.Error, `An onreconnecting callback called with error '${error}' threw error '${e}'.`);
            }

            // 若 onreconnecting callback 呼叫 connection.stop()，則提前結束
            if (this._connectionState !== HubConnectionState.Reconnecting) {
                this._logger.log(LogLevel.Debug, "Connection left the reconnecting state in onreconnecting callback. Done reconnecting.");
                return;
            }
        }

        while (nextRetryDelay !== null) {
            this._logger.log(LogLevel.Information, `Reconnect attempt number ${previousReconnectAttempts} will start in ${nextRetryDelay} ms.`);

            await new Promise((resolve) => {
                this._reconnectDelayHandle = setTimeout(resolve, nextRetryDelay!);
            });
            this._reconnectDelayHandle = undefined;

            if (this._connectionState !== HubConnectionState.Reconnecting) {
                this._logger.log(LogLevel.Debug, "Connection left the reconnecting state during reconnect delay. Done reconnecting.");
                return;
            }

            try {
                await this._startInternal();

                this._connectionState = HubConnectionState.Connected;
                this._logger.log(LogLevel.Information, "HubConnection reconnected successfully.");

                if (this._reconnectedCallbacks.length !== 0) {
                    try {
                        this._reconnectedCallbacks.forEach((c) => c.apply(this, [this.connection.connectionId]));
                    } catch (e) {
                        this._logger.log(LogLevel.Error, `An onreconnected callback called with connectionId '${this.connection.connectionId}; threw error '${e}'.`);
                    }
                }

                return;
            } catch (e) {
                this._logger.log(LogLevel.Information, `Reconnect attempt failed because of error '${e}'.`);

                if (this._connectionState !== HubConnectionState.Reconnecting) {
                    this._logger.log(LogLevel.Debug, `Connection moved to the '${this._connectionState}' from the reconnecting state during reconnect attempt. Done reconnecting.`);
                    // The TypeScript compiler thinks that connectionState must be Connected here. The TypeScript compiler is wrong.
                    if (this._connectionState as any === HubConnectionState.Disconnecting) {
                        this._completeClose();
                    }
                    return;
                }

                retryError = e instanceof Error ? e : new Error((e as any).toString());
                nextRetryDelay = this._getNextRetryDelay(previousReconnectAttempts++, Date.now() - reconnectStartTime, retryError);
            }
        }

        this._logger.log(LogLevel.Information, `Reconnect retries have been exhausted after ${Date.now() - reconnectStartTime} ms and ${previousReconnectAttempts} failed attempts. Connection disconnecting.`);

        this._completeClose();
    }

    private _getNextRetryDelay(previousRetryCount: number, elapsedMilliseconds: number, retryReason: Error) {
        try {
            return this._reconnectPolicy!.nextRetryDelayInMilliseconds({
                elapsedMilliseconds,
                previousRetryCount,
                retryReason,
            });
        } catch (e) {
            this._logger.log(LogLevel.Error, `IRetryPolicy.nextRetryDelayInMilliseconds(${previousRetryCount}, ${elapsedMilliseconds}) threw error '${e}'.`);
            return null;
        }
    }

    private _cancelCallbacksWithError(error: Error) {
        const callbacks = this._callbacks;
        this._callbacks = {};

        Object.keys(callbacks)
            .forEach((key) => {
                const callback = callbacks[key];
                try {
                    callback(null, error);
                } catch (e) {
                    this._logger.log(LogLevel.Error, `Stream 'error' callback called with '${error}' threw error: ${getErrorString(e)}`);
                }
            });
    }

    private _cleanupPingTimer(): void {
        if (this._pingServerHandle) {
            clearTimeout(this._pingServerHandle);
            this._pingServerHandle = undefined;
        }
    }

    private _cleanupTimeout(): void {
        if (this._timeoutHandle) {
            clearTimeout(this._timeoutHandle);
        }
    }

    private _createInvocation(methodName: string, args: any[], nonblocking: boolean, streamIds: string[]): InvocationMessage {
        if (nonblocking) {
            if (streamIds.length !== 0) {
                return {
                    target: methodName,
                    arguments: args,
                    streamIds,
                    type: MessageType.Invocation,
                };
            } else {
                return {
                    target: methodName,
                    arguments: args,
                    type: MessageType.Invocation,
                };
            }
        } else {
            const invocationId = this._invocationId;
            this._invocationId++;

            if (streamIds.length !== 0) {
                return {
                    target: methodName,
                    arguments: args,
                    invocationId: invocationId.toString(),
                    streamIds,
                    type: MessageType.Invocation,
                };
            } else {
                return {
                    target: methodName,
                    arguments: args,
                    invocationId: invocationId.toString(),
                    type: MessageType.Invocation,
                };
            }
        }
    }

    private _launchStreams(streams: IStreamResult<any>[], promiseQueue: Promise<void>): void {
        if (streams.length === 0) {
            return;
        }

        // 同步傳送 stream 資料以保證在伺服器端的順序
        if (!promiseQueue) {
            promiseQueue = Promise.resolve();
        }

        // 我們想對鍵進行迭代，因為鍵是 stream id
        // eslint-disable-next-line guard-for-in
        for (const streamId in streams) {
            streams[streamId].subscribe({
                complete: () => {
                    promiseQueue = promiseQueue.then(() => this._sendWithProtocol(this._createCompletionMessage(streamId)));
                },
                error: (err) => {
                    let message: string;
                    if (err instanceof Error) {
                        message = err.message;
                    } else if (err && err.toString) {
                        message = err.toString();
                    } else {
                        message = "Unknown error";
                    }

                    promiseQueue = promiseQueue.then(() => this._sendWithProtocol(this._createCompletionMessage(streamId, message)));
                },
                next: (item) => {
                    promiseQueue = promiseQueue.then(() => this._sendWithProtocol(this._createStreamItemMessage(streamId, item)));
                },
            });
        }
    }

    private _replaceStreamingParams(args: any[]): [IStreamResult<any>[], string[]] {
        const streams: IStreamResult<any>[] = [];
        const streamIds: string[] = [];
        for (let i = 0; i < args.length; i++) {
            const argument = args[i];
            if (this._isObservable(argument)) {
                const streamId = this._invocationId;
                this._invocationId++;
                // 保存 stream 供之後使用
                streams[streamId] = argument;
                streamIds.push(streamId.toString());

                // 從 args 中移除 stream
                args.splice(i, 1);
            }
        }

        return [streams, streamIds];
    }

    private _isObservable(arg: any): arg is IStreamResult<any> {
        // 允許其他 stream 實作（如 rxjs）也能運作
        return arg && arg.subscribe && typeof arg.subscribe === "function";
    }

    private _createStreamInvocation(methodName: string, args: any[], streamIds: string[]): StreamInvocationMessage {
        const invocationId = this._invocationId;
        this._invocationId++;

        if (streamIds.length !== 0) {
            return {
                target: methodName,
                arguments: args,
                invocationId: invocationId.toString(),
                streamIds,
                type: MessageType.StreamInvocation,
            };
        } else {
            return {
                target: methodName,
                arguments: args,
                invocationId: invocationId.toString(),
                type: MessageType.StreamInvocation,
            };
        }
    }

    private _createCancelInvocation(id: string): CancelInvocationMessage {
        return {
            invocationId: id,
            type: MessageType.CancelInvocation,
        };
    }

    private _createStreamItemMessage(id: string, item: any): StreamItemMessage {
        return {
            invocationId: id,
            item,
            type: MessageType.StreamItem,
        };
    }

    private _createCompletionMessage(id: string, error?: any, result?: any): CompletionMessage {
        if (error) {
            return {
                error,
                invocationId: id,
                type: MessageType.Completion,
            };
        }

        return {
            invocationId: id,
            result,
            type: MessageType.Completion,
        };
    }

    private _createCloseMessage(): CloseMessage {
        return { type: MessageType.Close };
    }
}
