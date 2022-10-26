// noinspection JSUnusedGlobalSymbols

import {VK, Env, TG} from './types'

let env: Env;

export default {
    async fetch(request: Request, iEnv: Env): Promise<Response> {

        if ((new URL(request.url)).pathname === '/favicon.ico') {
            return new Response();
        }

        env = iEnv;
        await go();
        return new Response();
    },

    async scheduled(event: ScheduledController, iEnv: Env, ctx: ExecutionContext) {
        env = iEnv;
        ctx.waitUntil(go());
    }

};

async function go() {
    const response = await getVkData();

    if (response && response.items.length) {
        env.DEBUG && console.log(`Got ${response.items.length} incoming items`);
        const posts = await processItems(response.items);
        for (let post of posts) {
            await sendPost(post);
        }
    }
}


async function sendPost(post: TG.Post) {
    switch (post.type) {
        case 'text':
            return await sendTelegramMsg(post.text);
        case 'media':
            return await sendMediaGroup(post.photos);
    }
}

async function processItems(items: VK.Item[]): Promise<TG.Post[]> {
    let lastDate = Number(await env.KV.get("last-date"));
    env.DEBUG && console.log(`lastDate = ${lastDate}`);

    items = items
        .filter(item => item.date > lastDate && !item.marked_as_ads)
        .reverse();

    let posts = [];

    for (let item of items) {

        let post: TG.Post = {
            'type': 'text',
            'photos': [],
            'text': '',
            'link': ''
        }
        let videos = [];

        if (item.attachments) {
            for (let attach of item.attachments) {
                switch (attach.type) {
                    case 'photo':
                        post.photos.push({
                            'type': 'photo',
                            'media': getPhotoLinkWithMaxSize(attach.photo.sizes),
                            'caption': ''
                        });
                        break;
                    case 'video':
                        videos.push("https://vk.com/video" + attach.video.owner_id + "_" + attach.video.id);
                        break;
                    case 'link':
                        post.link = attach.link.url;
                }
            }
        }

        if (env.APPEND_TEXT) {
            item.text += env.APPEND_TEXT.replace('{id}', `wall${item.owner_id}_${item.id}`);
        }

        if (item.text && item.text.length) {
            // Use text as photo caption if it fits (Telegram limit is 1024 chars)
            if (item.text.length < 1024 && post.photos.length) {
                post.photos[0].caption = item.text;
                post.type = 'media';
            } else {
                post.text = item.text;
            }
        }

        if (videos.length) {
            if (videos.length === 1 && !post.link && post.text) {
                post.text += "\n " + videos[0];
                videos = [];
                post.type = 'text';
            } else {
                for (let video of videos) { // Send videos as separate posts
                    let newPost: TG.Post = {
                        'type': 'text',
                        'photos': [],
                        'text': video,
                        'link': ''
                    }
                    posts.push(newPost);
                }
            }
        }

        if (post.link) {
            if (!post.text.includes(post.link)) {
                post.text += "\n " + post.link;
            }
        }

        if (post.text && post.photos.length) {
            let newPost: TG.Post = {
                'type': 'media',
                'photos': post.photos.slice(),
                'text': '',
                'link': ''
            }
            posts.push(newPost);
            post.photos = [];
        }

        post.text = md2escape(convertLinks(post.text));

        if (Object.entries(post).length !== 0) {
            posts.push(post);
        }

        // We check date every time as pinned post issue workaround
        if (item.date > lastDate) {
            lastDate = item.date;
            // @ts-ignore
            await env.KV.put("last-date", item.date);
        }
    }

    return posts;
}

function getPhotoLinkWithMaxSize(sizes: VK.PhotoSize[]): string {
    let maxWidth = 0;
    let imageUrl = '';
    env.DEBUG && console.log(`Start choosing from ${sizes.length} sizes`);
    for (let i = sizes.length - 1; i >= 0; i--) {
        let sizeData = sizes[i];

        env.DEBUG && console.log(`Size: ${sizeData.width}x${sizeData.height}`);

        if (sizeData.width > maxWidth) {
            maxWidth = sizeData.width;
            imageUrl = sizeData.url;
            env.DEBUG && console.log(`Select ${sizeData.type} photo as current.`);
        }
    }
    return imageUrl;
}


async function getVkData(): Promise<VK.Response | null> {
    const res = await fetch('https://api.vk.com/method/wall.get?owner_id=' + env.VK_SOURCE_ID + '&access_token=' + env.VK_KEY + '&offset=0&count=4&v=5.131', {
        method: 'POST',
    }).then(function (r: Response): Promise<VK.Response> {
        return r.json();
    });
    // @ts-ignore
    if (res.response) {
        // @ts-ignore
        return res.response;
    }

    console.error("Error: vk returned null");

    return null;
}


function sendTelegramMsg(msg: string, quite: boolean = false): Promise<any> {
    return telegramApiRequest('sendMessage', {
        'text': msg,
        'disable_notification': quite,
        'parse_mode': 'MarkdownV2'
    });
}

function sendPhoto(photoLink: string, caption: string) {
    return telegramApiRequest('sendPhoto', {
        'photo': photoLink,
        'caption': caption,
        'parse_mode': 'MarkdownV2'
    });
}

/**
 * Escaping for telegram's MarkdownV2
 * TODO: don't do the work twice - merge escaping with converting links
 * @param text
 */
function md2escape(text: string): string {
    return text.replace(/(\[[^\][]*]\(http[^()]*\))|[_*[\]()~>#+=|{}.!-]/gi, (x, y) => y ? y : '\\' + x)
        .replace(/\[([^\][]*)]\(/g, (x, y) => "[" + y.replace(/[-.+?^$[\](){}\\!#]/g, '\\$&') + "]\(");
}

/**
 * Converts strange VK links to markdown
 * @param text
 */
function convertLinks(text: string): string {

    const linkPattern = /^http(s):/;

    return text.replace(/\[(\S+)\|([^\]]+)\]/g, (match, link, linkText) => {
        if (!linkPattern.test(link)) {
            link = 'https://vk.com/' + link;
        }
        return `[${linkText}](${link})`;
    })
}

/**
 * We use it for photo only. Due to inability to send real videos.
 * Singular photos also send through this (not 'sendPhoto') - its works and its simpler
 * @param media
 */
async function sendMediaGroup(media: TG.MediaGroupItem[]): Promise<boolean> {
    if (media[0].caption) {
        media[0].caption = md2escape(convertLinks(media[0].caption));
        media[0].parse_mode = 'MarkdownV2';
    }

    return telegramApiRequest('sendMediaGroup', {
        'media': media,
    });
}


async function telegramApiRequest(method: string, params: Record<string | number, unknown>): Promise<boolean> {
    params['chat_id'] = env.CHAT_ID;
    const response = await fetch('https://api.telegram.org/bot' + env.TG_TOKEN + '/' + method, {
        body: JSON.stringify(params),
        method: 'POST',
        headers: {
            'content-type': 'application/json;charset=UTF-8',
        },
    }).then(response => {
        return response.json();
    });

    // @ts-ignore
    if (!response.ok) {
        // @ts-ignore
        env.DEBUG && console.log(method, response.description);
        return false;
    }

    return true;
}
