export default {
  async fetch(req, env) {
    const TELEGRAM_TOKEN = env.BOT_TOKEN;
    const ADMIN_ID = env.BOT_OWNER_ID;
    const db = env.DB;

    async function telegramRequest(method, body) {
      return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(res => res.json());
    }

    async function handleStart(msg) {
      const chat_id = msg.chat.id;
      const username = msg.from.username || msg.from.first_name;

      const exists = await db.prepare(`SELECT 1 FROM users WHERE user_id = ?`).bind(msg.from.id).first();

      if (!exists) {
        await db.prepare(`INSERT INTO users (user_id) VALUES (?)`).bind(msg.from.id).run();

        const keyboard = {
          reply_markup: {
            keyboard: [
              [{ text: 'Kanallarim!📢' }],
              [{ text: 'Post yaratish📃' }]
            ],
            resize_keyboard: true
          }
        };

        await telegramRequest('sendMessage', {
          chat_id,
          text: `Salom @${username}! 👋\nMen bilan Kanal uchun Tugmali post yaratishingiz mumkin!`,
          ...keyboard
        });
      } else {
        await telegramRequest('sendMessage', { chat_id, text: `Salom @${username}! 👋` });
      }
    }

    async function handleChannels(chat_id, user_id) {
      const channels = await db.prepare(`SELECT * FROM channels WHERE user_id = ?`).bind(user_id).all();

      if (!channels.results.length) {
        return telegramRequest('sendMessage', {
          chat_id,
          text: 'Sizda kanallar yo\'q!📢🚫',
          reply_markup: { inline_keyboard: [[{ text: 'Kanal ulash!🎟', callback_data: 'share_channel' }]] }
        });
      }

      const buttons = channels.results.map(c => [{ text: c.name, callback_data: `post_to_${c.id}` }]);

      return telegramRequest('sendMessage', {
        chat_id,
        text: 'Sizning kanallaringiz:',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    async function handlePostCreate(chat_id, user_id) {
      const channels = await db.prepare(`SELECT * FROM channels WHERE user_id = ?`).bind(user_id).all();
      if (!channels.results.length) {
        return telegramRequest('sendMessage', { chat_id, text: 'Sizda kanallar yo\'q!📢🚫' });
      }

      const buttons = channels.results.map(c => [{ text: c.name, callback_data: `post_to_${c.id}` }]);
      return telegramRequest('sendMessage', {
        chat_id,
        text: 'Qaysi kanalga post yuborilsin?',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    async function handleAdminStats(chat_id) {
      const totalUsers = await db.prepare(`SELECT COUNT(*) as count FROM users`).all();
      const totalChannels = await db.prepare(`SELECT COUNT(*) as count FROM channels`).all();
      const totalPosts = await db.prepare(`SELECT COUNT(*) as count FROM posts`).all();

      return telegramRequest('sendMessage', {
        chat_id,
        text: `Umumiy foydalanuvchilar: ${totalUsers.results[0].count}\nUlangan kanallar: ${totalChannels.results[0].count}\nUmumiy yaratilgan Postlar: ${totalPosts.results[0].count}`,
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Xabar yuborish📧', callback_data: 'send_message_all' }],
            [{ text: 'Barcha kanallarga xabar yuborish!', callback_data: 'send_to_channels' }]
          ]
        }
      });
    }

    async function handleCallback(update) {
      const data = update.callback_query.data;
      const chat_id = update.callback_query.message.chat.id;
      const user_id = update.callback_query.from.id;
      const callback_id = update.callback_query.id;

      await telegramRequest('answerCallbackQuery', { callback_query_id: callback_id });

      if (data === 'share_channel') {
        return telegramRequest('sendMessage', { chat_id, text: 'Kanal ulash funksiyasi ishlayapti...' });
      }

      if (data.startsWith('post_to_')) {
        const channel_id = data.split('_')[2];
        await db.prepare(`INSERT INTO temp_post (user_id, channel_id) VALUES (?, ?)`).bind(user_id, channel_id).run();
        return telegramRequest('sendMessage', { chat_id, text: 'Ushbu kanalga yuboriladigan post matnini kiriting!📃' });
      }

      if (data.startsWith('send_channel_')) {
        const post_id = data.split('_')[2];
        const post = await db.prepare(`SELECT * FROM posts WHERE id = ?`).bind(post_id).first();
        if (!post) return telegramRequest('sendMessage', { chat_id, text: 'Post topilmadi!' });

        const channel = await db.prepare(`SELECT * FROM channels WHERE id = ?`).bind(post.channel_id).first();
        if (!channel) return telegramRequest('sendMessage', { chat_id, text: 'Kanal topilmadi!' });

        let inlineButtons = [];
        const inline = await db.prepare(`SELECT * FROM inline_buttons WHERE post_id = ?`).bind(post_id).all();
        if (inline.results.length) inlineButtons = inline.results.map(b => [{ text: b.name, url: b.link }]);

        await telegramRequest('sendMessage', { chat_id: channel.telegram_id, text: post.text, reply_markup: { inline_keyboard: inlineButtons } });
        return telegramRequest('sendMessage', { chat_id, text: 'Post yuborildi ✅' });
      }

      if (data === 'send_message_all' && user_id.toString() === ADMIN_ID) {
        await db.prepare(`INSERT OR REPLACE INTO temp_admin (user_id) VALUES (?)`).bind(user_id).run();
        return telegramRequest('sendMessage', { chat_id, text: 'Kerakli xabarni kiriting! Matn, rasm, video qo‘llab-quvvatlanadi.' });
      }

      if (data === 'send_to_channels' && user_id.toString() === ADMIN_ID) {
        await db.prepare(`INSERT OR REPLACE INTO temp_admin_channel (user_id) VALUES (?)`).bind(user_id).run();
        return telegramRequest('sendMessage', { chat_id, text: 'Xabarni kiriting, u barcha bot admin kanallariga yuboriladi.' });
      }
    }

    async function handleTextMessage(msg) {
      const chat_id = msg.chat.id;
      const user_id = msg.from.id;
      const text = msg.text;

      const tempPost = await db.prepare(`SELECT * FROM temp_post WHERE user_id = ? ORDER BY rowid DESC LIMIT 1`).bind(user_id).first();
      if (tempPost) {
        await db.prepare(`INSERT INTO posts (user_id, channel_id, text) VALUES (?, ?, ?)`).bind(user_id, tempPost.channel_id, text).run();
        await db.prepare(`DELETE FROM temp_post WHERE user_id = ?`).bind(user_id).run();

        const buttons = [
          { text: 'Inline tugma qo‘shish+', callback_data: `add_inline_${tempPost.channel_id}` },
          { text: 'Kanalga yuborish📤', callback_data: `send_channel_${tempPost.channel_id}` }
        ];

        return telegramRequest('sendMessage', { chat_id, text, reply_markup: { inline_keyboard: [buttons] } });
      }

      const tempAdmin = await db.prepare(`SELECT * FROM temp_admin WHERE user_id = ?`).bind(user_id).first();
      if (tempAdmin && user_id.toString() === ADMIN_ID) {
        const allUsers = await db.prepare(`SELECT user_id FROM users`).all();
        for (const u of allUsers.results) {
          telegramRequest('sendMessage', { chat_id: u.user_id, text });
        }
        await db.prepare(`DELETE FROM temp_admin WHERE user_id = ?`).bind(user_id).run();
        return telegramRequest('sendMessage', { chat_id, text: 'Xabar barcha foydalanuvchilarga yuborildi ✅' });
      }

      const tempAdminChannel = await db.prepare(`SELECT * FROM temp_admin_channel WHERE user_id = ?`).bind(user_id).first();
      if (tempAdminChannel && user_id.toString() === ADMIN_ID) {
        const channels = await db.prepare(`SELECT telegram_id FROM channels WHERE user_id = ?`).bind(user_id).all();
        for (const c of channels.results) {
          telegramRequest('sendMessage', { chat_id: c.telegram_id, text });
        }
        await db.prepare(`DELETE FROM temp_admin_channel WHERE user_id = ?`).bind(user_id).run();
        return telegramRequest('sendMessage', { chat_id, text: 'Xabar barcha kanallarga yuborildi ✅' });
      }
    }

    if (req.method === 'POST') {
      try {
        const update = await req.json();
        if (update.message) {
          const msg = update.message;
          if (msg.text === '/start') return handleStart(msg);
          if (msg.text === 'Kanallarim!📢') return handleChannels(msg.chat.id, msg.from.id);
          if (msg.text === 'Post yaratish📃') return handlePostCreate(msg.chat.id, msg.from.id);
          if (msg.text === '/admin' && msg.from.id.toString() === ADMIN_ID) return handleAdminStats(msg.chat.id);
          if (msg.text) return handleTextMessage(msg);
        }
        if (update.callback_query) return handleCallback(update);
      } catch (err) {
        return new Response('Error: ' + err.toString(), { status: 500 });
      }
      return new Response('ok');
    }

    return new Response('Telegram bot running', { status: 200 });
  }
};
