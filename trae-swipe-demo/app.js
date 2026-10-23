/**
 * 示例内容包 —— 可整包替换。
 * 默认用「今日菜谱」演示主题可换；闲置易物同样只改 CARDS + 文案。
 * 左滑 = 正向（今晚做），右滑 = 跳过。
 */
const CARDS = [
  {
    title: "番茄牛腩面",
    want: "冰箱有番茄和面就能开做",
    condition: "约 35 分钟",
    user: "家常",
    dist: "主食",
    avatar: "linear-gradient(135deg,#F4A261,#E76F51)",
    image: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "蒜香西兰花",
    want: "空气炸锅 12 分钟",
    condition: "约 15 分钟",
    user: "快手",
    dist: "蔬菜",
    avatar: "linear-gradient(135deg,#A7C957,#6A994E)",
    image: "https://images.unsplash.com/photo-1628773823110-08992293c0b1?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "日式照烧鸡腿",
    want: "配米饭刚好两人份",
    condition: "约 40 分钟",
    user: "下饭",
    dist: "荤菜",
    avatar: "linear-gradient(135deg,#E9C46A,#F4A261)",
    image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "酸奶燕麦碗",
    want: "早餐或夜宵都行",
    condition: "约 5 分钟",
    user: "轻食",
    dist: "早餐",
    avatar: "linear-gradient(135deg,#FFE6A7,#F4A261)",
    image: "https://images.unsplash.com/photo-1511690658100-ac0eee42034b?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "椒盐虾",
    want: "平底锅一炒就出锅",
    condition: "约 20 分钟",
    user: "聚餐",
    dist: "海鲜",
    avatar: "linear-gradient(135deg,#FF9B8C,#E76F51)",
    image: "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1200&q=80",
  },
];

const LABEL_WANT = "今晚做";
const LABEL_PASS = "换一道";

const app = document.getElementById("app");
const toast = document.getElementById("toast");
let toastTimer;

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove("show");
  }, 1400);
}

const deck = new SwipeDeck(app, {
  cards: CARDS,
  onWant: function (card) {
    showToast(LABEL_WANT + " · " + card.title);
  },
  onPass: function (card) {
    showToast(LABEL_PASS + " · " + card.title);
  },
});

app.addEventListener("click", function (e) {
  var btn = e.target.closest("[data-action]");
  if (!btn) return;
  var action = btn.getAttribute("data-action");
  if (action === "want") deck.want();
  if (action === "pass") deck.pass();
  if (action === "undo") deck.undo();
  if (action === "detail") showToast("详情可展开步骤（Demo 省略）");
});
