
export namespace Body {
    export namespace NoMemberID {
        export class base {
            sign: string;
        }
    }
    export namespace NeedToken {
        export class base {
            sign: string;
            memberId: string;
        }

    }
    export namespace NotNeedToken {
    }
}
export namespace APIUrl {
    export interface Environment {
        PlayAPI: string;
        QAPlayAPI: string;
    }

    export class GPG implements Environment {
        PlayAPI = "";
        QAPlayAPI = "";
    }

}
export enum API {
    test = "www.google.com"
}

export namespace APIKey {
    export interface Environment {
        QA: string;
        Online: string;
    }
    export class GPG implements Environment {
        QA = "";
        Online = "";
    }
}
