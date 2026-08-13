export default class Request {
    method: Method = Method.GET;
    headers: Headers = new Headers();
    body: string | FormData
    isApp: boolean = false;
    /**避免傳遞過長，因此在初始化時就先記錄app狀況 */
    constructor(appBool: boolean = false) {
        this.isApp = appBool
    }
    setMethod(_method: Method) {
        this.method = _method;
        return this
    }
    setHeaders(_headers: Headers) {
        this.headers = _headers;
        return this
    }
    setToken(str: string) {
        this.headers.Authorization = `Bearer ${str}`
        return this
    }
    setBody(_body: string | FormData) {
        this.body = _body;
        return this
    }
    deletother() {
        delete this.headers.Accept
        delete this.headers.Authorization
        return this
    }
    deletContentType() {
        delete this.headers["Content-Type"]
        return this
    }
    setContentType(type: ContentType) {
        this.headers["Content-Type"] = type;
        return this
    }

    async fetchData(_url: string, callback?: Function) {
        // console.log(_url);
        // console.log(_url.split("?"));
        // console.log(_url.split("?")[0].split("/"));
        // console.log(_url.split("?")[0].split("/")[_url.split("?")[0].split("/").length]);
        console.log(this);
        const response = await fetch(_url, this);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${_url}`);
        }

        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(`Invalid JSON from ${_url}: ${text}`);
            }
        }

        console.log(`資料名稱：${_url.split("?")[0].split("/")[_url.split("?")[0].split("/").length - 1]}`)
        console.log(`資料內容`, data)
        if (callback)
            callback(data)

        return data
    }
    XMLData(url: string, callback?: Function) {
        console.log("開始", url);
        return new Promise((resolve, reject) => {
            var xhr = new XMLHttpRequest()
            // console.error(this.method);
            // console.error(this.headers["Content-Type"]);
            xhr.setRequestHeader("Content-Type", this.headers["Content-Type"])
            xhr.setRequestHeader("Accept", this.headers["Accept"])
            xhr.setRequestHeader("Authorization", this.headers["Authorization"])
            if (xhr.overrideMimeType) xhr.overrideMimeType('text\/plain; charset=utf-8');
            xhr.onload = () => {
                console.log(xhr);
                if (xhr.readyState === 4 && xhr.status === 200) {
                    try {
                        console.warn(JSON.parse(xhr.response));
                        if (callback)
                            callback(JSON.parse(xhr.response));
                        resolve(JSON.parse(xhr.response))
                    } catch (error) {
                        resolve(new PacketData(new Status("999")))
                        console.error("Format error", xhr);
                    }
                }
                else {
                    resolve(new PacketData(new Status(xhr.status.toString())))
                    console.error("connet error", xhr);
                }
            };
            xhr.open(this.method, url, true);
            if (this.method == Method.POST)
                xhr.send(this.body);
            else
                xhr.send();
        })
    }
    async SwitchGetData(url: string, callback?: Function) {
        return new Promise(async (resolve, reject) => {
            if (this.isApp)
                resolve(await this.XMLData(url, callback))
            else
                resolve(await this.fetchData(url, callback))
        })
    }
}

export enum Method {
    GET = "GET",
    POST = "POST",
}
export enum ContentType {
    Default = "",
    Json = "application/json, text/plain, */*",
    FormData = "multipart/form-data",
    Form = "application/x-www-form-urlencoded"
}
class Headers {

    [x: string]: string;
    "Content-Type": string = ContentType.Json;
    "Accept": string = "application/json;charset=UTF-8"
    "Authorization": string = ""
}
class PacketData {
    Status: Status;
    constructor(_state: Status) { this.Status = _state }
}

class Status {
    Code: string;
    Message: string;
    Timestamp: number;
    TraceCode: any;
    constructor(_code: string, _message?: string) {
        this.Code = _code; this.Message = _message;
    }
}
