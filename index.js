require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ───────────────────────────────────────────
// 設定ファイル（model, history）
// ───────────────────────────────────────────
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let settings = {};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8') || '{}');
    }
  } catch {
    settings = {};
  }
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

loadSettings();

// ───────────────────────────────────────────
// 会話履歴（Guild/DM単位）
// ───────────────────────────────────────────
const conversationHistory = {};

// ───────────────────────────────────────────
// トークン消費統計（Bot 全体）
// ───────────────────────────────────────────
let tokenStats = {
  total_tokens: 0,
  prompt_tokens: 0,
  completion_tokens: 0
};

// トークン統計リセット
function resetTokenStats() {
  tokenStats = {
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0
  };
}

// ───────────────────────────────────────────
// 長文分割
// ───────────────────────────────────────────
function splitMessage(text) {
  const chunks = [];
  while (text.length > 1900) {
    chunks.push(text.slice(0, 1900));
    text = text.slice(1900);
  }
  chunks.push(text);
  return chunks;
}

// ───────────────────────────────────────────
// URL → 本文取得関数（function-calling）
// ───────────────────────────────────────────
async function fetch_url_content(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const html = await res.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);

    return text || "テキスト抽出に失敗しました。";
  } catch (e) {
    return `URL取得失敗: ${e.message}`;
  }
}

// ───────────────────────────────────────────
// Bot Ready
// ───────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`ログイン成功: ${client.user.tag}`);

  // /ai_chat_model
  await client.application.commands.create({
    name: 'ai_chat_model',
    description: 'AIモデルを選択します',
    options: [
      {
        name: 'name',
        type: 3,
        description: 'モデル名',
        required: true,
        choices: [
          { name: 'gpt-4o-mini（速い・軽い）', value: 'gpt-4o-mini' },
          { name: 'gpt-4o（高品質）', value: 'gpt-4o' },
          { name: 'o3-mini（推論強い）', value: 'o3-mini' },
          { name: 'o1-mini（コード向き）', value: 'o1-mini' },
        ],
      },
    ],
  });

  // /ai_chat_history_reset
  await client.application.commands.create({
    name: 'ai_chat_history_reset',
    description: '会話履歴をリセットします',
  });

  // /ai_chat_history_mode
  await client.application.commands.create({
    name: 'ai_chat_history_mode',
    description: '会話履歴の使用を on/off します',
    options: [
      {
        name: 'mode',
        type: 3,
        description: 'on または off',
        required: true,
        choices: [
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ],
      },
    ],
  });

  // /ai_chat_history_status
  await client.application.commands.create({
    name: 'ai_chat_history_status',
    description: '覚えている履歴を表示します',
  });

  // /ai_chat_token_usage
  await client.application.commands.create({
    name: 'ai_chat_token_usage',
    description: 'Bot起動後のトークン使用量を表示します',
  });

  // /ai_chat_token_reset
  await client.application.commands.create({
    name: 'ai_chat_token_reset',
    description: 'トークン使用量の統計をリセットします',
  });

  console.log('全コマンド登録完了');
});

// ───────────────────────────────────────────
// Slash Command
// ───────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const key = interaction.guildId ? interaction.guildId : `DM_${interaction.user.id}`;
  if (!settings[key]) settings[key] = { model: 'gpt-4o-mini', history: true };

  // /ai_chat_model
  if (interaction.commandName === 'ai_chat_model') {
    const name = interaction.options.getString('name');
    settings[key].model = name;
    saveSettings();
    return interaction.reply({ content: `モデルを **${name}** に設定しました`, flags: 64 });
  }

  // /ai_chat_history_reset
  if (interaction.commandName === 'ai_chat_history_reset') {
    conversationHistory[key] = [];
    return interaction.reply({ content: '会話履歴をリセットしました', flags: 64 });
  }

  // /ai_chat_history_mode
  if (interaction.commandName === 'ai_chat_history_mode') {
    const mode = interaction.options.getString('mode');
    settings[key].history = mode === 'on';
    saveSettings();
    return interaction.reply({ content: `履歴参照を **${mode}** に設定しました`, flags: 64 });
  }

  // /ai_chat_history_status
  if (interaction.commandName === 'ai_chat_history_status') {
    const hist = conversationHistory[key] || [];
    if (hist.length === 0) {
      return interaction.reply({ content: '履歴は空です', flags: 64 });
    }
    const out = hist.map((h, i) => `${i+1}. [${h.role}] ${h.content.slice(0,100)}...`).join('\n').slice(0,1900);
    return interaction.reply({ content: `**履歴一覧**\n${out}`, flags: 64 });
  }

  // /ai_chat_token_usage
  if (interaction.commandName === 'ai_chat_token_usage') {
    const msg =
      `**トークン使用量（起動後）**\n` +
      `総トークン: ${tokenStats.total_tokens}\n` +
      `プロンプト: ${tokenStats.prompt_tokens}\n` +
      `生成: ${tokenStats.completion_tokens}`;
    return interaction.reply({ content: msg, flags: 64 });
  }

  // /ai_chat_token_reset
  if (interaction.commandName === 'ai_chat_token_reset') {
    resetTokenStats();
    return interaction.reply({ content: 'トークン統計をリセットしました', flags: 64 });
  }
});

// ───────────────────────────────────────────
// メッセージ応答（function-calling）
// ───────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user) && !message.channel.isDMBased()) return;

  const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();
  const key = message.guild ? message.guild.id : `DM_${message.author.id}`;

  if (!settings[key]) settings[key] = { model: 'gpt-4o-mini', history: true };

  const model = settings[key].model;
  const useHistory = settings[key].history;

  if (!conversationHistory[key]) conversationHistory[key] = [];
  conversationHistory[key].push({ role: 'user', content: userMessage });

  try {
    await message.channel.sendTyping();

    const tools = [
      {
        type: "function",
        function: {
          name: "fetch_url",
          description: "URL の本文を取得する",
          parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"]
          }
        }
      }
    ];

    const historyToSend = useHistory ? conversationHistory[key].slice(-10) : [];

    // ──────────────────────────────────────
    // ① function-call を含む最初の呼び出し
    // ──────────────────────────────────────
    const first = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "あなたは役立つアシスタントです。" },
        ...historyToSend,
        { role: "user", content: userMessage }
      ],
      tools,
      max_tokens: 1500
    });

    // トークン記録
    const u1 = first.usage;
    tokenStats.total_tokens += u1.total_tokens;
    tokenStats.prompt_tokens += u1.prompt_tokens;
    tokenStats.completion_tokens += u1.completion_tokens;

    console.log(`使用トークン(1st): ${u1.total_tokens}`);

    const msg = first.choices[0].message;

    // ──────────────────────────────────────
    // ② function-call 要求がある場合
    // ──────────────────────────────────────
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const tool = msg.tool_calls[0];

      if (tool.function.name === "fetch_url") {
        const args = JSON.parse(tool.function.arguments);

        const result = await fetch_url_content(args.url);

        // ──────────────────────────────────────
        // ③ 関数結果を渡して最終回答生成
        // ──────────────────────────────────────
        const second = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "あなたは役立つアシスタントです。" },
            ...historyToSend,
            { role: "user", content: userMessage },
            msg,
            {
              role: "tool",
              tool_call_id: tool.id,
              content: result
            }
          ],
          max_tokens: 1500
        });

        const u2 = second.usage;
        tokenStats.total_tokens += u2.total_tokens;
        tokenStats.prompt_tokens += u2.prompt_tokens;
        tokenStats.completion_tokens += u2.completion_tokens;

        console.log(`使用トークン(2nd): ${u2.total_tokens}`);

        const final = second.choices[0].message.content;

        conversationHistory[key].push({ role: "assistant", content: final });

        for (const chunk of splitMessage(final)) {
          await message.reply(chunk);
        }
        return;
      }
    }

    // ──────────────────────────────────────
    // ③ 通常回答
    // ──────────────────────────────────────
    const reply = msg.content;
    conversationHistory[key].push({ role: "assistant", content: reply });

    for (const chunk of splitMessage(reply)) {
      await message.reply(chunk);
    }

  } catch (e) {
    console.error(e);
    message.reply("エラーが発生しました");
  }
});

client.login(process.env.DISCORD_TOKEN);
