const TELEGRAM_TOKEN = '8311667835:AAFyuUGpjH0WC8zwav0G5xTtXwX9NkLynUM';
const ADMIN_ID = '7098943602';
const db = BOT_DB;

// Telegram API ga request yuborish
async function telegramRequest(method, body) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(res => res.json());
}

// --- /start ---
async function handleStart(message) {
  const chat_id = message.chat.id;
  const username = message.from.username || message.from.first_name;

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
    text: `Salom @${username}!👋\nMen bilan Kanal uchun Tugmali post yaratishingiz mumkin!`,
    ...keyboard
  });

  await db.prepare(`INSERT OR IGNORE INTO users (user_id) VALUES (?)`).bind(message.from.id).run();
}

// --- Kanallar ro'yxati ---
async function handleChannels(chat_id, user_id) {
  const channels = await db.prepare(`SELECT * FROM channels WHERE user_id = ?`).bind(user_id).all();
  if (channels.results.length === 0) {
    return telegramRequest('sendMessage', {
      chat_id,
      text: 'Sizda kanallar yo\'q!📢🚫',
      reply_markup: {
        inline_keyboard: [[{ text: 'Kanal ulash!🎟', callback_data: 'share_channel' }]]
      }
    });
  } 
  const buttons = channels.results.map(c => [{ text: c.name, callback_data: `post_to_${c.id}` }]);
  return telegramRequest('sendMessage', {
    chat_id,
    text: 'Sizning kanallaringiz:',
    reply_markup: { inline_keyboard: buttons }
  });
}

// --- Post yaratish ---
async function handlePostCreate(message) {
  const chat_id = message.chat.id;
  const user_id = message.from.id;

  const channels = await db.prepare(`SELECT * FROM channels WHERE user_id = ?`).bind(user_id).all();
  if (channels.results.length === 0) {
    return telegramRequest('sendMessage', { chat_id, text: 'Sizda kanallar yo\'q!📢🚫' });
  }

  const buttons = channels.results.map(c => [{ text: c.name, callback_data: `post_to_${c.id}` }]);
  return telegramRequest('sendMessage', {
    chat_id,
    text: 'Qaysi kanalga post yuborilsin?',
    reply_markup: { inline_keyboard: buttons }
  });
}

// --- Admin statistikasi ---
async function handleAdminStats(chat_id) {
  const totalUsers = await db.prepare(`SELECT COUNT(*) as count FROM users`).all();
  const totalChannels = await db.prepare(`SELECT COUNT(*) as count FROM channels`).all();
  const totalPosts = await db.prepare(`SELECT COUNT(*) as count FROM posts`).all();

  return telegramRequest('sendMessage', {
    chat_id,
    text: `Umumiy foydalanuvchilar: ${totalUsers.results[0].count}\n` +
          `Ulangan kanallar: ${totalChannels.results[0].count}\n` +
          `Umumiy yaratilgan Postlar: ${totalPosts.results[0].count}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Xabar yuborish📧', callback_data: 'send_message_all' }],
        [{ text: 'Barcha kanallarga xabar yuborish!', callback_data: 'send_to_channels' }]
      ]
    }
  });
}

// --- Callback handler ---
async function handleCallback(update) {
  const data = update.callback_query.data;
  const chat_id = update.callback_query.message.chat.id;
  const user_id = update.callback_query.from.id;
  const callback_id = update.callback_query.id;

  // Kanal ulash
  if (data === 'share_channel') {
    return telegramRequest('answerCallbackQuery', { callback_query_id: callback_id, text: 'Kanal ulash funksiyasi ishlayapti...' });
  }

  // Kanal tanlash post uchun
  if (data.startsWith('post_to_')) {
    const channel_id = data.split('_')[2];
    await db.prepare(`INSERT INTO temp_post (user_id, channel_id) VALUES (?, ?)`).bind(user_id, channel_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Ushbu kanalga yuboriladigan post matnini kiriting!📃' });
  }

  // Inline tugma qo'shish
  if (data.startsWith('add_inline_')) {
    await db.prepare(`INSERT INTO temp_inline (user_id, post_id) VALUES (?, ?)`).bind(user_id, data.split('_')[2]).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Tugma nomi va linkni formatda yuboring: [Tugma nomi + link]' });
  }

  // Kanalga yuborish
  if (data.startsWith('send_channel_')) {
    const post_id = data.split('_')[2];
    const post = await db.prepare(`SELECT * FROM posts WHERE id = ?`).bind(post_id).first();
    if (!post) return telegramRequest('sendMessage', { chat_id, text: 'Post topilmadi!' });
    const channel = await db.prepare(`SELECT * FROM channels WHERE id = ?`).bind(post.channel_id).first();
    if (!channel) return telegramRequest('sendMessage', { chat_id, text: 'Kanal topilmadi!' });

    let inlineButtons = [];
    const inline = await db.prepare(`SELECT * FROM inline_buttons WHERE post_id = ?`).bind(post_id).all();
    if (inline.results.length > 0) {
      inlineButtons = inline.results.map(b => [{ text: b.name, url: b.link }]);
    }

    await telegramRequest('sendMessage', { chat_id: channel.telegram_id, text: post.text, reply_markup: { inline_keyboard: inlineButtons } });
    return telegramRequest('sendMessage', { chat_id, text: 'Post yuborildi ✅' });
  }

  // Admin xabar yuborish
  if (data === 'send_message_all') {
    await db.prepare(`INSERT OR REPLACE INTO temp_admin (user_id) VALUES (?)`).bind(user_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Kerakli xabarni kiriting! Matn, rasm, video qo‘llab-quvvatlanadi.' });
  }

  if (data === 'send_to_channels') {
    await db.prepare(`INSERT OR REPLACE INTO temp_admin_channel (user_id) VALUES (?)`).bind(user_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Xabarni kiriting, u barcha bot admin kanallariga yuboriladi.' });
  }
}

// --- Text handler ---
async function handleTextMessage(message) {
  const chat_id = message.chat.id;
  const user_id = message.from.id;
  const text = message.text;

  // Temp post
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

  // Admin xabar
  const tempAdmin = await db.prepare(`SELECT * FROM temp_admin WHERE user_id = ?`).bind(user_id).first();
  if (tempAdmin && user_id.toString() === ADMIN_ID) {
    const allUsers = await db.prepare(`SELECT user_id FROM users`).all();
    for (const u of allUsers.results) {
      telegramRequest('sendMessage', { chat_id: u.user_id, text });
    }
    await db.prepare(`DELETE FROM temp_admin WHERE user_id = ?`).bind(user_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Xabar barcha foydalanuvchilarga yuborildi ✅' });
  }

  // Admin barcha kanallarga xabar
  const tempAdminChannel = await db.prepare(`SELECT * FROM temp_admin_channel WHERE user_id = ?`).bind(user_id).first();
  if (tempAdminChannel && user_id.toString() === ADMIN_ID) {
    const channels = await db.prepare(`SELECT telegram_id FROM channels WHERE user_id = ?`).bind(user_id).all();
    for (const c of channels.results) {
      telegramRequest('sendMessage', { chat_id: c.telegram_id, text });
    }
    await db.prepare(`DELETE FROM temp_admin_channel WHERE user_id = ?`).bind(user_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Xabar barcha kanallarga yuborildi ✅' });
  }

  // Inline tugma qo'shish
  const tempInline = await db.prepare(`SELECT * FROM temp_inline WHERE user_id = ? ORDER BY rowid DESC LIMIT 1`).bind(user_id).first();
  if (tempInline) {
    const matches = text.match(/\[(.+)\s*\+\s*(.+)\]/);
    if (!matches) return telegramRequest('sendMessage', { chat_id, text: 'Formati xato! [Tugma nomi + link]' });
    const name = matches[1].trim();
    const link = matches[2].trim();
    await db.prepare(`INSERT INTO inline_buttons (post_id, name, link) VALUES (?, ?, ?)`).bind(tempInline.post_id, name, link).run();
    await db.prepare(`DELETE FROM temp_inline WHERE user_id = ?`).bind(user_id).run();
    return telegramRequest('sendMessage', { chat_id, text: 'Inline tugma qo‘shildi ✅' });
  }
}

// --- Webhook ---
async function handleWebhook(req) {
  const update = await req.json();

  if (update.message) {
    const message = update.message;
    const text = message.text;

    if (text === '/start') return handleStart(message);
    if (text === 'Kanallarim!📢') return handleChannels(message.chat.id, message.from.id);
    if (text === 'Post yaratish📃') return handlePostCreate(message);
    if (text === '/admin' && message.from.id.toString() === ADMIN_ID) return handleAdminStats(message.chat.id);
    if (text) return handleTextMessage(message);
  }

  if (update.callback_query) return handleCallback(update);

  return new Response('ok');
}

// --- Fetch listener ---
addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname === '/webhook' && event.request.method === 'POST') {
    event.respondWith(handleWebhook(event.request));
  } else {
    event.respondWith(new Response('Telegram bot is running', { status: 200 }));
  }
});
