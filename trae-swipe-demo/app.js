const CARDS = [
  {
    title: "索尼微单 · 附 3 支镜头",
    want: "一台能听黑胶的唱片机",
    condition: "九成新",
    user: "小林",
    dist: "1.2km",
    avatar: "linear-gradient(135deg,#E8D9C4,#B9A58A)",
    image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "机械键盘 · 奶油轴",
    want: "降噪耳机或咖啡手冲壶",
    condition: "几乎全新",
    user: "阿哲",
    dist: "800m",
    avatar: "linear-gradient(135deg,#C9D6FF,#E2E2E2)",
    image: "https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "户外帐篷 3–4 人",
    want: "公路车或露营气罐炉",
    condition: "八成新",
    user: "山山",
    dist: "2.4km",
    avatar: "linear-gradient(135deg,#D4E7C5,#A7C957)",
    image: "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "黑胶唱片机",
    want: "胶片相机或摄影灯",
    condition: "能正常转",
    user: "南南",
    dist: "3.1km",
    avatar: "linear-gradient(135deg,#F7C8C8,#E08A8A)",
    image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1200&q=80",
  },
  {
    title: "北欧落地灯",
    want: "绿植或收纳柜",
    condition: "九成新",
    user: "阿暖",
    dist: "1.7km",
    avatar: "linear-gradient(135deg,#FFE6A7,#F4A261)",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1200&q=80",
  },
];

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
    showToast("想换 · " + card.title);
  },
  onPass: function (card) {
    showToast("跳过 · " + card.title);
  },
});

app.addEventListener("click", function (e) {
  var btn = e.target.closest("[data-action]");
  if (!btn) return;
  var action = btn.getAttribute("data-action");
  if (action === "want") deck.want();
  if (action === "pass") deck.pass();
  if (action === "undo") deck.undo();
  if (action === "detail") showToast("上滑也可打开详情（Demo 省略）");
});
