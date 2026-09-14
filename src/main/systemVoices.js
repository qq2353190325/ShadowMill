// src/main/systemVoices.js
// Qwen-TTS 非实时语音合成预设系统音色表（内置，来源于官方 voice 参数清单）
// 字段：voice（作为合成接口的 voice 参数）/ desc（描述）/ langs（特色语种）/ series（支持模型系列）
// 渲染层据此把音色下拉分为「系统音色」与「自定义音色」两类。
const SYSTEM_VOICES = [
  { voice: 'Cherry', desc: '阳光积极、亲切自然小姐姐（女性）', langs: '普通话', series: ['instruct-flash', 'flash', 'tts'] },
  { voice: 'Serena', desc: '温柔小姐姐（女性）', langs: '普通话', series: ['instruct-flash', 'flash', 'tts'] },
  { voice: 'Ethan', desc: '标准普通话，带部分北方口音。阳光、温暖、活力、朝气（男性）', langs: '普通话', series: ['instruct-flash', 'flash', 'tts'] },
  { voice: 'Chelsie', desc: '二次元虚拟女友（女性）', langs: '普通话', series: ['instruct-flash', 'flash', 'tts'] },
  { voice: 'Momo', desc: '撒娇搞怪，逗你开心（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Vivian', desc: '拽拽的、可爱的小暴躁（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Moon', desc: '率性帅气的月白（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Maia', desc: '知性与温柔的碰撞（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Kai', desc: '耳朵的一场SPA（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Nofish', desc: '不会翘舌音的设计师（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Bella', desc: '喝酒不打醉拳的小萝莉（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Jennifer', desc: '品牌级、电影质感般美语女声（女性）', langs: '普通话', series: ['flash'] },
  { voice: 'Ryan', desc: '节奏拉满，戏感炸裂，真实与张力共舞（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Katerina', desc: '御姐音色，韵律回味十足（女性）', langs: '普通话', series: ['flash'] },
  { voice: 'Aiden', desc: '精通厨艺的美语大男孩（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Eldric Sage', desc: '沉稳睿智的老者，沧桑如松却心明如镜（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Mia', desc: '温顺如春水，乖巧如初雪（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Mochi', desc: '聪明伶俐的小大人，童真未泯却早慧如禅（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Bellona', desc: '声音洪亮，吐字清晰，人物鲜活，听得人热血沸腾；金戈铁马入梦来，字正腔圆间尽显千面人声的江湖（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Vincent', desc: '一口独特的沙哑烟嗓，一开口便道尽了千军万马与江湖豪情（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Bunny', desc: '"萌属性"爆棚的小萝莉（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Neil', desc: '平直的基线语调，字正腔圆的咬字发音，最专业的新闻主持人（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Elias', desc: '既保持学科严谨性，又通过叙事技巧将复杂知识转化为可消化的认知模块（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Arthur', desc: '被岁月和旱烟浸泡过的质朴嗓音，不疾不徐地摇开了满村的奇闻异事（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Nini', desc: '糯米糍一样又软又黏的嗓音，那一声声拉长了的"哥哥"，甜得能把人的骨头都叫酥了（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Seren', desc: '温和舒缓的声线，助你更快地进入睡眠，晚安，好梦（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Pip', desc: '调皮捣蛋却充满童真的他来了，这是你记忆中的小新吗（男性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Stella', desc: '平时是甜到发腻的迷糊少女音，但在喊出"代表月亮消灭你"时，瞬间充满不容置疑的爱与正义（女性）', langs: '普通话', series: ['instruct-flash', 'flash'] },
  { voice: 'Bodega', desc: '热情的西班牙大叔（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Sonrisa', desc: '热情开朗的拉美大姐（女性）', langs: '普通话', series: ['flash'] },
  { voice: 'Alek', desc: '一开口，是战斗民族的冷，也是毛呢大衣下的暖（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Dolce', desc: '慵懒的意大利大叔（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Sohee', desc: '温柔开朗，情绪丰富的韩国欧尼（女性）', langs: '普通话', series: ['flash'] },
  { voice: 'Ono Anna', desc: '鬼灵精怪的青梅竹马（女性）', langs: '普通话', series: ['flash'] },
  { voice: 'Lenn', desc: '理性是底色，叛逆藏在细节里——穿西装也听后朋克的德国青年（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Emilien', desc: '浪漫的法国大哥哥（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Andre', desc: '声音磁性，自然舒服、沉稳男生（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Radio Gol', desc: '足球诗人Rádio Gol！今天我要用名字为你们解说足球（男性）', langs: '普通话', series: ['flash'] },
  { voice: 'Jada', desc: '风风火火的沪上阿姐（女性）', langs: '上海话', series: ['flash', 'tts'] },
  { voice: 'Dylan', desc: '北京胡同里长大的少年（男性）', langs: '北京话', series: ['flash', 'tts'] },
  { voice: 'Li', desc: '耐心的瑜伽老师（男性）', langs: '南京话', series: ['flash'] },
  { voice: 'Marcus', desc: '面宽话短，心实声沉——老陕的味道（男性）', langs: '陕西话', series: ['flash'] },
  { voice: 'Roy', desc: '诙谐直爽、市井活泼的台湾哥仔形象（男性）', langs: '闽南语', series: ['flash'] },
  { voice: 'Peter', desc: '天津相声，专业捧哏（男性）', langs: '天津话', series: ['flash'] },
  { voice: 'Sunny', desc: '甜到你心里的川妹子（女性）', langs: '四川话', series: ['flash', 'tts'] },
  { voice: 'Eric', desc: '一个跳脱市井的四川成都男子（男性）', langs: '四川话', series: ['flash'] },
  { voice: 'Rocky', desc: '幽默风趣的阿强，在线陪聊（男性）', langs: '粤语', series: ['flash'] },
  { voice: 'Kiki', desc: '甜美的港妹闺蜜（女性）', langs: '粤语', series: ['flash'] }
];

// 按 voice 参数快速校验是否内置系统音色
function isSystemVoice(voice) {
  return SYSTEM_VOICES.some((v) => v.voice === voice);
}

module.exports = { SYSTEM_VOICES, isSystemVoice };
