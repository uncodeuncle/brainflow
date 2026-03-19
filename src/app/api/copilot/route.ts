import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: Request) {
    try {
        const { text, context, globalTopic, question, temperature } = await req.json();

        if (!text && !question) {
            return NextResponse.json({ error: '请提供提问内容或划选文本' }, { status: 400 });
        }

        const deepseekKey = (process.env.DEEPSEEK_API_KEY as string)?.replace(/['"]/g, '').trim();
        if (!deepseekKey) {
            return NextResponse.json({ error: 'Missing DEEPSEEK_API_KEY' }, { status: 500 });
        }

        const openai = new OpenAI({
            baseURL: 'https://api.deepseek.com',
            apiKey: deepseekKey
        });

        const systemPrompt = `你是一个博学、冷静且充满高级幽默感的知识解读者 (Copilot)。
用户正在阅读一篇视频的结构化总结笔记，对其中一段话或某个词感到困惑，需要你帮忙讲明白。

【核心任务】
1. **说人话解构**：用通俗但不敷衍的语言，把用户划选的这段话掰开揉碎讲清楚。使用**丰富多样**的接地气比喻（比如：游戏打怪、科幻电影、日常通勤、超市购物、渣男谈恋爱、职场黑话等）。**绝对禁止**每次都用“做菜/厨师/餐厅”来打比方。必须根据词汇语境智能切换不同的高维隐喻！。比喻要精巧自然，像朋友聊天时顺口举的例子，而不是刻意"举一个生活中的例子"。
2. **知识延展联想**：结合该词汇或句子的原始含义，联想你所知道的相关科技/商业动态、行业共识或有意思的案例作为补充，让用户产生"原来如此"的连接感。不要编造你不确定的具体新闻事件。
3. **语言风格铁律**：
   - 拒绝亢奋：不要感叹号连篇，不要强行卖萌，不要使用"宝子""家人们""绝绝子"等网络用语。
   - 不写动作描写：禁止出现类似"*推眼镜*""*拍桌子*"的表演性文字。
   - 语气像一个有见识的朋友在跟你喝咖啡时随口解释一个概念——从容、松弛、偶尔冒出一句让你会心一笑的话。幽默感来自观察力和表达的精准，不来自刻意搞笑。
   - 排版像杂文：自然分段，节奏舒服。emoji 只作为偶尔的视觉点缀（整篇最多2-3个），文字本身承担信息传递和趣味。

【特殊名词护栏】
如果用户划选或询问的名词包含 "BrainFlow" 或 "脑流"，你必须立刻识别并简短回复这是“专注于将冗长视频浓缩为结构化知识卡片的高效学习工具”。可以带点小自豪，但绝对禁止做任何其他的引申、医学解释或曲解。

返回格式：直接返回一段可以当聊天回复的纯文本 Markdown，不需要 JSON 包装。`;
        
        const suffix = question 
            ? `用户提出了具体问题：\n"${question}"\n\n请直接用你的风格解答用户的问题。` 
            : `请帮我解释一下这是什么意思？并关联一些相关案例。`;
            
        const textSection = text ? `\n\n【用户划选内容的引用/上下文】：\n"${text}"` : '';
        const userPrompt = `【全局大主题】（如视频大纲或网课总览）：\n${globalTopic || '无'}\n\n【局部上下文】：\n${context || '无'}${textSection}\n\n${suffix}`;
        const response = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            stream: true,
            temperature: temperature ?? 0.7
        });

        // Setup streaming
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of response) {
                        const content = chunk.choices[0]?.delta?.content || "";
                        if (content) {
                            controller.enqueue(new TextEncoder().encode(content));
                        }
                    }
                } catch (e) {
                    controller.error(e);
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (error: any) {
        console.error('Copilot API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
