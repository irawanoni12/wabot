const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys')
const pino = require('pino')
const fs = require('fs')
const { Boom } = require('@hapi/boom')
const qrcode = require('qrcode-terminal')
const ffmpeg = require('fluent-ffmpeg')
const { createCanvas, loadImage } = require("canvas")
const axios = require('axios')
const { exec } = require('child_process') 

// --- KONFIGURASI ---
const sessionName = 'session'
const ownerNumber = '6281387628476@s.whatsapp.net' 

// --- HELPER 1: TEXT TO IMAGE (.t) ---
function textToImageFit(text) {
    const fontSize = 250;
    const fontName = 'Arial';
    const padding = 80;
    const maxCanvasWidth = 2000;
    const lineHeight = fontSize * 1.15;

    const dummyCanvas = createCanvas(maxCanvasWidth, maxCanvasWidth);
    const dummyCtx = dummyCanvas.getContext("2d");
    dummyCtx.font = `bold ${fontSize}px ${fontName}`;

    const words = text.split(' ');
    let lines = [];
    let currentLine = words[0];
    const maxTextWidth = maxCanvasWidth - (padding * 2);

    for (let i = 1; i < words.length; i++) {
        let word = words[i];
        let width = dummyCtx.measureText(currentLine + " " + word).width;
        if (width < maxTextWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);

    let longestLineWidth = 0;
    lines.forEach(line => {
        let w = dummyCtx.measureText(line).width;
        if (w > longestLineWidth) longestLineWidth = w;
    });

    const finalWidth = Math.max(longestLineWidth + (padding * 2), 500);
    const finalHeight = (lines.length * lineHeight) + (padding * 2);

    const canvas = createCanvas(finalWidth, finalHeight);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, finalWidth, finalHeight);

    ctx.fillStyle = "#000000";
    ctx.font = `bold ${fontSize}px ${fontName}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    let currentY = padding;
    const currentX = padding;

    for (let line of lines) {
        ctx.fillText(line, currentX, currentY);
        currentY += lineHeight;
    }

    return canvas.toBuffer("image/png");
}

// --- HELPER 2: MEME MAKER (.mmf) ---
async function createMeme(imageBuffer, text, position = 'bawah') {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, img.width, img.height);
    const fontSizeInitial = img.width * 0.15; 
    const fontName = 'Arial Black, Arial-BoldMT, Impact, sans-serif'; 
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#000000'; 
    ctx.lineWidth = img.width * 0.015; ctx.textAlign = 'center';

    const drawMemeText = (txt, x, y, maxWidth, baseline) => {
        ctx.textBaseline = baseline;
        let fontSize = fontSizeInitial;
        ctx.font = `${fontSize}px ${fontName}`;
        let textMetrics = ctx.measureText(txt);
        while (textMetrics.width > maxWidth - 60 && fontSize > 20) {
             fontSize -= 5; ctx.font = `${fontSize}px ${fontName}`;
             textMetrics = ctx.measureText(txt);
        }
        const words = txt.split(' ');
        let lines = []; let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
            let word = words[i];
            let width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth - 40) currentLine += " " + word;
            else { lines.push(currentLine); currentLine = word; }
        }
        lines.push(currentLine);
        const lineHeight = fontSize * 1.2;
        let currentY = y;
        if (lines.length > 1) {
             if (baseline === 'middle') currentY -= (lines.length -1) * lineHeight / 2;
             else if (baseline === 'bottom') currentY -= (lines.length - 1) * lineHeight;
        }
        for (let line of lines) {
            ctx.strokeText(line, x, currentY); ctx.fillText(line, x, currentY);    
            currentY += lineHeight;
        }
    }
    const centerX = canvas.width / 2;
    const padding = img.height * 0.05;
    if (position === 'atas') drawMemeText(text, centerX, padding, canvas.width, 'top');
    else if (position === 'tengah') drawMemeText(text, centerX, canvas.height / 2, canvas.width, 'middle');
    else drawMemeText(text, centerX, canvas.height - padding, canvas.width, 'bottom');
    return canvas.toBuffer('image/png');
}

// --- HELPER 3: YT-DLP ENGINE (VPS) ---
const ytdlpDownload = async (url) => {
    return new Promise((resolve, reject) => {
        const fileName = `${Date.now()}.mp4`
        const command = `yt-dlp "${url}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${fileName}"`
        console.log(`⏳ Download: ${url}`)
        exec(command, (error, stdout, stderr) => {
            if (error) {
                if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
                reject(error);
                return;
            }
            if (fs.existsSync(fileName)) resolve(fileName);
            else reject(new Error("File hilang."));
        });
    });
}

// --- HELPER UMUM ---
const getRandom = (ext) => `${Math.floor(Math.random() * 10000)}${ext}`

const downloadMedia = async (message) => {
    let mime = (message.msg || message).mimetype || ''
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
    const stream = await downloadContentFromMessage(message, messageType)
    let buffer = Buffer.from([])
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
    return buffer
}

// --- STIKER MAKER HD (512px) ---
const bufferToSticker = async (buffer, isVideo) => {
    return new Promise((resolve, reject) => {
        const randInput = getRandom(isVideo ? '.mp4' : '.jpg')
        const randOutput = getRandom('.webp')
        fs.writeFileSync(randInput, buffer)
        
        // PERBAIKAN DI SINI: Memperbaiki syntax filter scale yang typo (min'(512) menjadi min(512))
        let ffmpegRules = [
            "-vcodec", "libwebp",
            "-vf", "scale='min(512,iw)':min(512,ih):force_original_aspect_ratio=decrease,fps=15, pad=512:512:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse"
        ]
        
        // Memastikan flag video diterapkan dengan benar untuk animasi
        if (isVideo) {
            ffmpegRules.push("-loop", "0", "-ss", "00:00:00", "-t", "00:00:08", "-preset", "default", "-an", "-vsync", "0")
        }
        
        ffmpeg(randInput).input(randInput).on('error', (err) => {
            if (fs.existsSync(randInput)) fs.unlinkSync(randInput)
            reject(err)
        }).on('end', () => {
            const stickerBuff = fs.readFileSync(randOutput)
            if (fs.existsSync(randInput)) fs.unlinkSync(randInput)
            if (fs.existsSync(randOutput)) fs.unlinkSync(randOutput)
            resolve(stickerBuff)
        }).addOutputOptions(ffmpegRules).toFormat('webp').save(randOutput)
    })
}

// --- BOT UTAMA ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionName)
    const { version } = await fetchLatestBaileysVersion()
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['PC', 'Chrome', '1.0.0'],
        generateHighQualityLinkPreview: true,
        markOnlineOnConnect: false
    })

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update
        if (qr) qrcode.generate(qr, { small: true })
        
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.badSession) {
                console.log("❌ Sesi Rusak. Hapus session.");
                if (fs.existsSync(sessionName)) fs.rmSync(sessionName, { recursive: true, force: true });
                process.exit();
            } else startBot()
        } else if (connection === 'open') {
            console.log('✅ Bot Online!')
            await sock.sendPresenceUpdate('unavailable') 
        }
    })
    
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async chatUpdate => {
        try {
            const m = chatUpdate.messages[0]
            if (!m.message) return
            if (m.key.remoteJid === 'status@broadcast') return
            if (!m.key.participant && m.key.remoteJid.includes('@g.us')) return

            const type = getContentType(m.message)
            if (type === 'ephemeralMessage') m.message = m.message.ephemeralMessage.message
            
            const msgKey = (type === 'extendedTextMessage') ? m.message.extendedTextMessage.contextInfo : null
            const quote = msgKey ? msgKey.quotedMessage : null
            if (quote) {
                const typeQuote = getContentType(quote)
                m.quoted = quote; m.quoted.type = typeQuote; m.quoted.msg = quote[typeQuote]; m.quoted.sender = m.message.extendedTextMessage.contextInfo.participant || m.message.extendedTextMessage.contextInfo.remoteJid
            }

            let body = ''
            if (type === 'conversation') body = m.message.conversation
            else if (type === 'imageMessage') body = m.message.imageMessage.caption
            else if (type === 'videoMessage') body = m.message.videoMessage.caption
            else if (type === 'extendedTextMessage') body = m.message.extendedTextMessage.text
            if (typeof body !== 'string') body = ''

            const prefix = /^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/.test(body) ? body.match(/^[°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©^]/)[0] : '.'
            const isCmd = body.startsWith(prefix)
            const command = isCmd ? body.replace(prefix, '').trim().split(/ +/).shift().toLowerCase() : ""
            const args = body.trim().split(/ +/).slice(1)
            const text = args.join(" ")
            const reply = (text) => sock.sendMessage(m.key.remoteJid, { text: String(text) }, { quoted: m })

            const isCreator = m.sender === ownerNumber || m.key.fromMe

            // --- INFO BOT (.ping) ---
            if (command === 'ping') {
                const os = require('os')
                const timestamp = m.messageTimestamp * 1000 
                const now = Date.now()
                const latensi = (now - timestamp)
                const finalPing = Math.abs(latensi).toFixed(2)
                const uptime = runtime(process.uptime())
                const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0) // MB
                const freeMem = (os.freemem() / 1024 / 1024).toFixed(0) // MB
                const caption = ` *PONG*\n\n` +
                                ` *Ping:* ${finalPing} ms\n` +
                                ` *Uptime:* ${uptime}\n` +
                                ` *RAM:* ${freeMem}MB / ${totalMem}MB\n` +
                                ` *Owner:* serpagengs`
                reply(caption)
            }
            
            // --- 1. RESTART PM2 (.restart) ---
            if (command === 'restart') {
                if (!isCreator) return reply("Fitur khusus Owner!")
                reply("Merestart sistem...")
                setTimeout(() => {
                    process.exit() 
                }, 1000)
            }

            // --- 2. GIT PULL / UPDATE (.update) ---
            if (command === 'update' || command === 'gitpull') {
                if (!isCreator) return reply(" Fitur khusus Owner!")
                await sock.sendMessage(m.key.remoteJid, { react: { text: '⏳', key: m.key } })
                exec('git pull', (err, stdout, stderr) => {
                    if (err) return reply(` Gagal Update:\n${err}`)
                    if (stdout) reply(` *Output Git:*\n${stdout}\n\n_Silakan ketik .restart untuk menerapkan update._`)
                })
            }

            // --- FITUR DOWNLOADER ---
            if (['tt', 'tiktok', 'ig', 'instagram', 'yt', 'youtube', 'x', 'twitter'].includes(command)) {
                if (!text) return reply(`❌ Masukkan Link!`)
                await sock.sendMessage(m.key.remoteJid, { react: { text: '⬇️', key: m.key } })

                let filePath = null;
                try {
                    filePath = await ytdlpDownload(text)
                    const stats = fs.statSync(filePath)
                    if (stats.size > 100 * 1024 * 1024) {
                        reply("❌ File terlalu besar (>100MB).")
                    } else {
                        await sock.sendMessage(m.key.remoteJid, { video: fs.readFileSync(filePath), caption: '' }, { quoted: m })
                    }
                    await sock.sendMessage(m.key.remoteJid, { react: { text: '✅', key: m.key } })
                } catch (e) {
                    console.error("DL Error:", e)
                    reply("❌ Gagal download.")
                } finally {
                    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
                }
            }

            // --- MEME MAKER (.mmf) ---
            if (command === 'mmf') {
                if (!m.quoted || m.quoted.type !== 'imageMessage') return reply("❌ Reply gambar!");
                if (!text) return reply("❌ Masukkan teks!");
                await sock.sendMessage(m.key.remoteJid, { react: { text: '🎨', key: m.key } });
                try {
                    const imageBuffer = await downloadMedia(m.quoted.msg);
                    let position = 'bawah'; let memeText = text;
                    const firstArg = args[0].toLowerCase();
                    if (['atas', 'tengah', 'bawah'].includes(firstArg)) { position = firstArg; memeText = args.slice(1).join(" "); }
                    const processedBuffer = await createMeme(imageBuffer, memeText, position);
                    const stickerBuffer = await bufferToSticker(processedBuffer, false);
                    await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m });
                    await sock.sendMessage(m.key.remoteJid, { react: { text: '✅', key: m.key } });
                } catch (e) { console.error(e); reply("Gagal buat meme.") }
            }

            // --- TEXT TO IMAGE (.t) ---
            if (command === 't') {
                if (!text) return reply("❌ Masukkan teks!")
                await sock.sendMessage(m.key.remoteJid, { react: { text: '🖌️', key: m.key } })
                try {
                    const imageBuffer = textToImageFit(text) 
                    await sock.sendMessage(m.key.remoteJid, { image: imageBuffer, caption: '' }, { quoted: m })
                } catch (e) { console.log(e); reply("Error membuat gambar.") }
            }

            // --- STIKER (.s) ---
            if (['s', 'sticker'].includes(command)) {
                await sock.sendMessage(m.key.remoteJid, { react: { text: '⏳', key: m.key } })
                try {
                    let media = null
                    if (type === 'imageMessage' || type === 'videoMessage') media = m.message
                    else if (m.quoted && (m.quoted.type === 'imageMessage' || m.quoted.type === 'videoMessage')) media = m.quoted.msg
                    
                    if (media) {
                        const buffer = await downloadMedia(media)
                        // Perbaikan Deteksi Video: Menggunakan mimetype dari objek media
                        const isVideo = (media.mimetype || '').includes('video') || (media.mimetype || '').includes('gif')
                        const stickerBuffer = await bufferToSticker(buffer, isVideo);
                        await sock.sendMessage(m.key.remoteJid, { sticker: stickerBuffer }, { quoted: m })
                        await sock.sendMessage(m.key.remoteJid, { react: { text: '✅', key: m.key } })
                    } else { reply("❌ Kirim/Reply gambar atau video!") }
                } catch (e) { console.log(e); reply("Gagal.") }
            }
            
            // --- AI ---
            if (command === 'ai') {
                if(!text) return reply("Tanya apa?")
                try { const { data } = await axios.get(`https://widipe.com/openai?text=${encodeURIComponent(text)}`); if(data.result) reply(data.result); } catch(e) { reply("AI sibuk.") }
            }

            // --- PRICE (CRYPTO) ---
            if (command === 'price') {
                if (!text) return reply("Simbol? (cth: BTC)")
                const symbol = text.toUpperCase().trim() + "USDT"
                try { 
                    const { data } = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`); 
                    const price = parseFloat(data.price).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); 
                    reply(`💰 *${text.toUpperCase()}*: ${price}`); 
                } catch (e) { 
                    reply("Koin tidak ditemukan atau salah simbol.") 
                }
            }

        } catch (err) { console.log("Error Handler:", err) }
    })
}

// --- HELPER FORMAT WAKTU (UPTIME) ---
function runtime(seconds) {
    seconds = Number(seconds)
    var d = Math.floor(seconds / (3600 * 24))
    var h = Math.floor(seconds % (3600 * 24) / 3600)
    var m = Math.floor(seconds % 3600 / 60)
    var s = Math.floor(seconds % 60)
    var dDisplay = d > 0 ? d + "d " : ""
    var hDisplay = h > 0 ? h + "h " : ""
    var mDisplay = m > 0 ? m + "m " : ""
    var sDisplay = s > 0 ? s + "s" : ""
    return dDisplay + hDisplay + mDisplay + sDisplay
}

startBot()
