export default {
  async fetch(req, env) {
    const TELEGRAM_TOKEN = env.BOT_TOKEN;
    const EXTERNAL_API = "https://viscodev.x10.mx/gpt/api.php";

    // Telegram request helper
    async function telegramRequest(method, body) {
      return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }

    async function sendMessage(chat_id, text) {
      return telegramRequest("sendMessage", { chat_id, text, parse_mode: "HTML" });
    }

    async function sendTyping(chat_id) {
      await telegramRequest("sendChatAction", { chat_id, action: "typing" });
    }

    async function processWithAI(text, chat_id, message_id) {
      const res = await fetch(EXTERNAL_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, chat_id, message_id })
      });

      if (!res.ok) return { success: false, error: "API bilan bog'lanib bo'lmadi" };
      return res.json();
    }

    async function processUpdate(update) {
      if (!update.message || !update.message.text) return;

      const chat_id = update.message.chat.id;
      const text = update.message.text;
      const message_id = update.message.message_id;

      // Typing indicator
      sendTyping(chat_id);

      // AI javobini olish
      const aiResponse = await processWithAI(text, chat_id, message_id);

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
