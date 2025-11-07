export default {
  async fetch(req, env) {
    const TELEGRAM_TOKEN = env.BOT_TOKEN;
    const EXTERNAL_API = "https://viscodev.x10.mx/gpt/api.php";

    // Telegram API so'rov yuborish helper
    async function telegramRequest(method, body) {
      return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }

    async function sendMessage(chat_id, text) {
      return telegramRequest("sendMessage", { chat_id, text, parse_mode: "HTML" });
    }

    async function deleteMessage(chat_id, message_id) {
      return telegramRequest("deleteMessage", { chat_id, message_id });
    }

    async function sendTyping(chat_id) {
      await telegramRequest("sendChatAction", { chat_id, action: "typing" });
    }

    // AI API bilan ishlash (PHP processWithAI logikasi)
    async function processWithAI(text, chat_id, message_id) {
      try {
        const res = await fetch(EXTERNAL_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, chat_id, message_id })
        });
        if (!res.ok) return { success: false, error: "API bilan bog'lanib bo'lmadi" };
        return res.json();
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    async function processUpdate(update) {
      if (!update.message || !update.message.text) return;

      const chat_id = update.message.chat.id;
      const message_id = update.message.message_id;
      const text = update.message.text;
      const username = update.message.from.username || update.message.from.first_name || "Foydalanuvchi";

      // /start komandasi
      if (text === "/start") {
        const startText = `Salom @${username}! 👋\nBu Realix Ai!\nSavolingizni yozing?`;
        return sendMessage(chat_id, startText);
      }

      // Typing indicator
      sendTyping(chat_id);

      // "Processing" xabari yuborish
      const processing = await sendMessage(chat_id, "☕ Jarayon davom etmoqda...");

      // AI javobini olish
      const aiResponse = await processWithAI(text, chat_id, message_id);

      // "Processing" xabarini o'chirish
      if (processing.result && processing.result.message_id) {
        await deleteMessage(chat_id, processing.result.message_id);
      }

      // Javob yuborish
      if (aiResponse.success) {
        return sendMessage(chat_id, aiResponse.response);
      } else {
        return sendMessage(chat_id, `❌ Xatolik: ${aiResponse.error}`);
      }
    }

    if (req.method === "POST") {
      const update = await req.json();
      return processUpdate(update);
    }

    return new Response("Bot ishlayapti", { status: 200 });
  }
};
