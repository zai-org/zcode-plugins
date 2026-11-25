// PDF 字体常把常用字登记成部首码位（如 ⻘ U+2ED8、⽅ U+2F45）：部首补充区按 Unicode EquivalentUnifiedIdeograph.txt，康熙部首区按 NFKC（少数按简体字形修正）。
const RADICALS = new Map([..."⺁厂⺂乛⺃乚⺄乙⺅亻⺆冂⺇𠘨⺈刀⺉刂⺊卜⺋㔾⺎兀⺏尣⺐尢⺑𡯂⺒巳⺓幺⺔彑⺕𫜹⺖忄⺗心⺘扌⺙攵⺛旡⺜日⺝月⺞歺⺟母⺠民⺡氵⺢氺⺣灬⺦丬⺧牛⺨犭⺩王⺪𤴔⺫目⺬示⺭礻⺮𥫗⺯糹⺰纟⺱罓⺲罒⺳㓁⺴冗⺵𦉫⺶羊⺷𦍌⺸𦍋⺹耂⺺肀⺻聿⺼肉⺽𦥑⻁虎⻂衤⻃覀⻄西⻅见⻆角⻇𧢲⻈讠⻉贝⻊𧾷⻋车⻏邑⻐钅⻑長⻒镸⻓长⻔门⻕𨸏⻖阝⻗雨⻘青⻙韦⻚页⻛风⻜飞⻝食⻞𩙿⻟飠⻠饣⻡𩠐⻢马⻣骨⻤鬼⻥鱼⻦鸟⻧卤⻨麦⻩黄⻪黾⻫斉⻬齐⻭歯⻮齿⻯竜⻰龙⻱龜⻲亀⻳龟"].reduce<[string, string][]>((acc, c, i, all) => (i % 2 ? acc : [...acc, [c, all[i + 1]]]), []));
const KANGXI_SC: Record<string, string> = { "\u2f3e": "户", "\u2fad": "青" };
export const radical = (c: string) => KANGXI_SC[c] ?? RADICALS.get(c) ?? c.normalize("NFKC");
export const unradical = (s: string) => s.replace(/[\u2e80-\u2fdf]/g, radical);
