require('dotenv').config();
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

client.once('ready', () => {
  console.log(`ログイン成功: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // ボット自身のメッセージは無視
  if (message.author.bot) return;

  // ボットへのメンション、またはDMの場合のみ反応
  if (!message.mentions.has(client.user) && message.channel.type !== 1) return;

  try {
    // 「考え中...」を表示
    await message.channel.sendTyping();

    // メンションを除去したメッセージを取得
    const userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // ChatGPT APIを呼び出し
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // gpt-4も使用可能
      messages: [
        {
          role: 'system',
          content: 'あなたは親切で役立つアシスタントです。日本語で応答してください。',
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const reply = response.choices[0].message.content;

    // Discordのメッセージ長制限（2000文字）を考慮
    if (reply.length > 2000) {
      await message.reply(reply.substring(0, 1997) + '...');
    } else {
      await message.reply(reply);
    }

    // コンソールに使用トークン数を表示（課金額の確認用）
    console.log(`使用トークン数: ${response.usage.total_tokens}`);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    await message.reply('申し訳ありません。エラーが発生しました。');
  }
});

client.login(process.env.DISCORD_TOKEN);
