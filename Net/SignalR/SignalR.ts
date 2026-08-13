import { DEV } from 'cc/env';
import { HttpTransportType, HubConnection, HubConnectionBuilder, LogLevel } from './Base';
import { MessagePackHubProtocol } from './signalr-protocol-msgpack';
export class _signalR {
    connection: HubConnection;
    logger: LogLevel = LogLevel.Error;
    reconnectRetryDelays: number[] = [0, 5000, 5000, 5000, 5000];
    /**心跳機制 */
    keepAliveIntervalInMilliseconds: number = 5000;
    /**伺服器逾時（毫秒）。

若在此時間內未接收到伺服器的任何訊息，連線將以錯誤終止。 預設逾時為 30,000 毫秒（30 秒） */
    serverTimeoutInMilliseconds: number = 99999999;

    async init(url: string, token: string) {
        if (this.keepAliveIntervalInMilliseconds > 10000) console.error("心跳超過10秒以上可能會跟Server段連");

        // 每次建立新 Hub 前先釋放舊連線，否則 this.started 仍指向上一條 Promise，重連時不會真正 start()
        await this.stopConnection();

        const signalrBuilder = new HubConnectionBuilder()
            .withAutomaticReconnect(this.reconnectRetryDelays)
            .configureLogging(this.logger)
            //@ts-ignore
            .withUrl(`${url}`, {
                //@ts-ignore
                accessTokenFactory: () => token,
                skipNegotiation: true,
                transport: HttpTransportType.WebSockets
            });
        if (DEV) signalrBuilder.withHubProtocol(new MessagePackHubProtocol());
        this.connection = signalrBuilder.build();
        this.connection.keepAliveIntervalInMilliseconds = this.keepAliveIntervalInMilliseconds;
        this.connection.serverTimeoutInMilliseconds = this.serverTimeoutInMilliseconds;
        await this.startConnection();
        this.connection.on('Receive', this.onReceive);

        // await this.connection.send('Send', {});
        // this.connection.invoke('Send', {});
        // this.connection.start();
        // console.log(this.connection);
    }

    onReceive(data: any) {
        // console.log(data);

    }
    private heartbeatId: number | null = null;
    private started: Promise<void> | null = null;


    /**
     *  - on(event, cb): void
     *   - 註冊內部事件監聽器。支援事件: 'open'|'close'|'message'|'error'|'reconnecting'|'reconnected'。
     *   - cb 為任何接收參數的 callback。可用於監控連線生命週期與收到的訊息 metadata。
     */

    onReconnecting(cb: (error?: Error) => void) {
        this.connection.onreconnecting(cb);
    }

    onReconnected(cb: (connectionId?: string) => void) {
        this.connection.onreconnected(cb);
    }

    onClose(cb: (error?: Error) => void) {
        this.connection.onclose(cb);
    }
    private attachConnectionLifecycleHandlers() {
        if (!this.connection) return;

        this.connection.onreconnecting((error?: Error) => {
            console.error('--------reconnecting-------', error);
        });

        this.connection.onreconnected((connectionId?: string) => {
            console.error('--------reconnected-------', connectionId);
        });

        this.connection.onclose((error?: Error) => {
            console.error('close', error);
        });
    }

    /**
     * - startConnection(): Promise<void>
     *   - 安全的啟動連線（可多次呼叫但僅實際執行一次啟動流程）。
     *   - 內部會先 attachConnectionLifecycleHandlers()（將 Hub 的 onreconnecting/onreconnected/onclose 綁回本地事件）。
     *   - 啟動成功會 emit('open') 並啟動 startHeartbeat()；若失敗會 emit('error') 並重設 started 為 null 以利重試。
     *   - 回傳代表啟動完成或失敗的 Promise。
     */
    async startConnection(): Promise<void> {
        if (!this.connection) throw new Error('SignalR connection not initialized. Call init() first.');

        if (!this.started) {
            this.attachConnectionLifecycleHandlers();

            this.started = (async () => {
                try {
                    await this.connection.start();
                    this.startHeartbeat();
                } catch (err) {
                    console.error('error', err);
                    // clear started so caller can retry
                    this.started = null;
                    throw err;
                }
            })();
        }

        return this.started;
    }

    /**
     * - stopConnection(): Promise<void>
     *   - 停止心跳並呼叫 connection.stop()；無論是否成功都會重設 started 為 null。
     */
    async stopConnection(): Promise<void> {
        if (!this.connection) return;
        this.stopHeartbeat();
        try {
            await this.connection.stop();
        } finally {
            this.started = null;
        }
    }

    /**
     * - startHeartbeat(method: string = 'Ping'): void
     *   - 啟動一個輕量心跳，定期用 connection.send(method) 單向呼叫伺服器（不等待回應）。
     *   - 心跳間隔使用 keepAliveIntervalInMilliseconds（至少 1000ms）。
     *   - 與 SignalR 內建 keepalive 不同，此心跳為額外的應用層心跳，可用於自定義 Ping 演算法或觸發伺服器端狀態更新。
     */
    startHeartbeat(method: string = 'Ping') {
        this.stopHeartbeat();
        if (!this.connection) return;
        const interval = Math.max(1000, this.keepAliveIntervalInMilliseconds || 10000);
        this.heartbeatId = window.setInterval(() => {
            // fire-and-forget; server can implement Ping/Heartbeat
            try { void this.connection.send(method).catch(() => { }); } catch { }
        }, interval);
    }
    /**
     * - stopHeartbeat(): void
     *   - 停止先前啟動的心跳 interval（若存在）。
     */
    stopHeartbeat() {
        if (this.heartbeatId != null) {
            clearInterval(this.heartbeatId);
            this.heartbeatId = null;
        }
    }

    /**
     *   - 嘗試確保連線已啟動，會呼叫 startConnection() 並在 timeoutMs 到時候拒絕（預設 10s）。
     *   - 傳入 timeoutMs <= 0 時會直接回傳 startConnection() 的 Promise（不額外套超時）。
     */
    async ensureStarted(timeoutMs: number = 10000): Promise<void> {
        const startPromise = this.startConnection();
        if (!timeoutMs || timeoutMs <= 0) return startPromise;
        return new Promise<void>((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('SignalR start timeout')), timeoutMs);
            startPromise.then(() => { clearTimeout(to); resolve(); }).catch(err => { clearTimeout(to); reject(err); });
        });
    }
    /**
     * - getConnection(): HubConnection | undefined
     *   - 回傳底層 HubConnection 實例（可用於需要直接存取底層 API 的情況）。
     */
    getConnection(): HubConnection | Promise<never> {
        if (!this.connection) return Promise.reject(new Error('Connection not initialized'));
        return this.connection;
    }
}
export default new _signalR();