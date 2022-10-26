export interface Env {
    VK_SOURCE_ID: number | string,
    VK_KEY: string, // service key for VK App
    CHAT_ID: string, // identifier for the target chat or username of the target channel (in the format @channelusername)
    TG_TOKEN: string,
    APPEND_TEXT: string,
    KV: KVNamespace,
    DEBUG: boolean
}

export namespace TG {

    type Post = {
        type: 'text' | 'media';
        'photos': MediaGroupItem[],
        'text': string,
        'link': string
    }


    type MediaGroupItem = {
        type: "photo",
        media: string,
        caption?: string,
        parse_mode?: 'MarkdownV2'
    }
}


export namespace VK {
    type BoolInt = 0 | 1;

    type PhotoSize = {
        url: string,
        width: number,
        height: number,
        type: 's' | 'm' | 'x' | 'o' | 'p' | 'q' | 'r' | 'y' | 'z' | 'w'
    }


    type Photo = {
        type: "photo",
        photo: {
            sizes: PhotoSize[]
        }
    }

    type Video = {
        type: "video",
        video: {
            id: string,
            owner_id: string
        }
    }

    type Link = {
        type: "link",
        link: {
            url: string
        }
    }

    type Attachment = Photo | Video | Link;

    interface Item {
        id: number,
        owner_id: number,
        date: number,
        marked_as_ads: BoolInt,
        text?: string,
        attachments: Attachment[]
    }

    interface Response {
        count: number,
        items: Item[]
    }
}


