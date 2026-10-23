/**
 * HuanHuan-style swipe stack (browser port of barter-mp WXS feel)
 * Left = WANT (想换), Right = PASS (跳过)
 * Params mirror /workspace/barter-mp/config/swipe.js
 */
(function (global) {
  const CFG = {
    tiltPerScreen: 15,
    maxRotate: 15,
    commitRatio: 0.3,
    velocity: 800,
    flyXRatio: 1.5,
    flyMs: 280,
    flyMin: 180,
    flyRot: 25,
    carryY: 0.5,
    spring: { k: 400, d: 30, m: 1 },
    next: { scale: 0.94, offsetY: 12 },
    third: { scale: 0.88, offsetY: 22 },
    hintFullRatio: 0.25,
    hintMax: 1,
    hintFrom: 0.8,
    bezier: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function SwipeDeck(root, opts) {
    this.root = root;
    this.cards = opts.cards.slice();
    this.onWant = opts.onWant || function () {};
    this.onPass = opts.onPass || function () {};
    this.index = 0;
    this.lock = false;
    this._bind();
    this.render();
  }

  SwipeDeck.prototype._W = function () {
    return this.root.clientWidth || window.innerWidth;
  };

  SwipeDeck.prototype._bind = function () {
    var self = this;
    this.root.addEventListener("pointerdown", function (e) {
      return self._start(e);
    });
    window.addEventListener("pointermove", function (e) {
      return self._move(e);
    });
    window.addEventListener("pointerup", function (e) {
      return self._end(e);
    });
    window.addEventListener("pointercancel", function (e) {
      return self._end(e);
    });
  };

  SwipeDeck.prototype.render = function () {
    var stack = this.root.querySelector("[data-stack]");
    stack.innerHTML = "";
    var slice = this.cards.slice(this.index, this.index + 3);
    for (var i = slice.length - 1; i >= 0; i--) {
      var item = slice[i];
      var el = document.createElement("article");
      el.className = "card" + (i === 0 ? " is-top" : i === 1 ? " is-next" : " is-third");
      el.dataset.level = String(i);
      el.innerHTML =
        '<div class="card-media" style="background-image:url(' +
        JSON.stringify(item.image) +
        ')"></div>' +
        '<div class="card-shade"></div>' +
        '<div class="stamp stamp-want" aria-hidden="true">想换</div>' +
        '<div class="stamp stamp-pass" aria-hidden="true">跳过</div>' +
        '<div class="card-meta">' +
        '<span class="chip">' +
        item.condition +
        "</span>" +
        "<h2>" +
        item.title +
        "</h2>" +
        '<p class="want"><b>想换</b> ' +
        item.want +
        "</p>" +
        '<div class="who"><span class="av" style="background:' +
        item.avatar +
        '"></span>' +
        item.user +
        " · " +
        item.dist +
        "</div>" +
        "</div>";
      stack.appendChild(el);
    }
    var pager = this.root.querySelector("[data-pager]");
    if (pager) pager.textContent = Math.min(this.index + 1, this.cards.length) + "/" + this.cards.length;
    this.top = stack.querySelector(".is-top");
    this.next = stack.querySelector(".is-next");
    this.third = stack.querySelector(".is-third");
    this._paint(0, 0, 0, 0, "");
  };

  SwipeDeck.prototype._paint = function (x, y, r, np, tr) {
    var W = this._W();
    var commit = W * CFG.commitRatio;
    var p = Math.max(clamp(Math.abs(x) / commit, 0, 1), np || 0);
    var t = tr || "none";
    if (this.top) {
      this.top.style.transition = t;
      this.top.style.transform = "translate(" + x + "px," + y + "px) rotate(" + r + "deg)";
      var o = clamp(Math.abs(x) / (W * CFG.hintFullRatio), 0, CFG.hintMax);
      var want = this.top.querySelector(".stamp-want");
      var pass = this.top.querySelector(".stamp-pass");
      var s = CFG.hintFrom + (1 - CFG.hintFrom) * (o / CFG.hintMax);
      if (want) {
        want.style.opacity = x < 0 ? o : 0;
        want.style.transform = "rotate(12deg) scale(" + (x < 0 ? s : CFG.hintFrom) + ")";
      }
      if (pass) {
        pass.style.opacity = x > 0 ? o : 0;
        pass.style.transform = "rotate(-12deg) scale(" + (x > 0 ? s : CFG.hintFrom) + ")";
      }
    }
    if (this.next) {
      var sx1 = CFG.next.scale + (1 - CFG.next.scale) * p;
      var ty1 = CFG.next.offsetY * (1 - p);
      this.next.style.transition = t;
      this.next.style.transform = "translateY(" + ty1 + "px) scale(" + sx1 + ")";
    }
    if (this.third) {
      var sx2 = CFG.third.scale + (CFG.next.scale - CFG.third.scale) * p;
      var ty2 = CFG.next.offsetY + (CFG.third.offsetY - CFG.next.offsetY) * (1 - p);
      this.third.style.transition = t;
      this.third.style.transform = "translateY(" + ty2 + "px) scale(" + sx2 + ")";
    }
  };

  SwipeDeck.prototype._start = function (e) {
    if (this.lock || !this.top || e.button) return;
    if (e.target.closest("[data-action]")) return;
    this.active = true;
    this.drag = false;
    this.pid = e.pointerId;
    this.top.setPointerCapture && this.top.setPointerCapture(e.pointerId);
    this.ox = e.clientX - (this.x || 0);
    this.oy = e.clientY - (this.y || 0);
    this.x = this.x || 0;
    this.y = this.y || 0;
    this.vx = 0;
    this.vy = 0;
    this.lt = performance.now();
    this._stopSpring();
  };

  SwipeDeck.prototype._move = function (e) {
    if (!this.active || e.pointerId !== this.pid) return;
    var x = e.clientX - this.ox;
    var y = e.clientY - this.oy;
    if (!this.drag) {
      if (Math.abs(x - (this.x || 0)) < 4 && Math.abs(y - (this.y || 0)) < 4) return;
      this.drag = true;
    }
    var now = performance.now();
    var dt = now - this.lt;
    if (dt > 0) {
      this.vx = 0.8 * (((x - this.x) / dt) * 1000) + 0.2 * this.vx;
      this.vy = 0.8 * (((y - this.y) / dt) * 1000) + 0.2 * this.vy;
    }
    this.x = x;
    this.y = y;
    this.lt = now;
    var W = this._W();
    this.r = clamp((x / W) * CFG.tiltPerScreen, -CFG.maxRotate, CFG.maxRotate);
    this._paint(x, y, this.r, 0, "");
  };

  SwipeDeck.prototype._end = function (e) {
    if (!this.active || (e && e.pointerId !== this.pid)) return;
    this.active = false;
    if (this.lock) return;
    if (!this.drag) {
      if (Math.abs(this.x || 0) > 0.5) this._snap(0, 0);
      return;
    }
    if (performance.now() - this.lt > 80) {
      this.vx = 0;
      this.vy = 0;
    }
    var W = this._W();
    var commit = W * CFG.commitRatio;
    var fling = Math.abs(this.vx) > CFG.velocity;
    if (Math.abs(this.x) > commit || fling) {
      var dir = (fling ? this.vx : this.x) < 0 ? -1 : 1;
      this._fly(dir);
    } else {
      this._snap(this.vx, this.vy);
    }
  };

  SwipeDeck.prototype._fly = function (dir) {
    var self = this;
    this.lock = true;
    var W = this._W();
    var flyX = W * CFG.flyXRatio;
    var remain = Math.abs(dir * flyX - this.x);
    var speed = Math.abs(this.vx || 0);
    var ms = speed > 1 ? clamp((remain / speed) * 1000, CFG.flyMin, CFG.flyMs) : CFG.flyMs;
    ms = Math.round(ms);
    var yTo = this.y + (this.vy || 0) * (ms / 1000) * CFG.carryY;
    var tr = "transform " + ms + "ms " + CFG.bezier;
    this._paint(dir * flyX, yTo, dir * CFG.flyRot, 1, tr);
    var card = this.cards[this.index];
    setTimeout(function () {
      if (dir < 0) self.onWant(card);
      else self.onPass(card);
      self.index += 1;
      self.x = 0;
      self.y = 0;
      self.r = 0;
      self.lock = false;
      self.drag = false;
      if (self.index >= self.cards.length) {
        self.root.classList.add("is-empty");
        return;
      }
      self.render();
    }, ms);
  };

  SwipeDeck.prototype._snap = function (vx, vy) {
    var self = this;
    this._stopSpring();
    var st = {
      x: this.x || 0,
      y: this.y || 0,
      r: this.r || 0,
      vx: vx || 0,
      vy: vy || 0,
      vr: clamp(((vx || 0) / this._W()) * CFG.tiltPerScreen, -200, 200),
    };
    var gen = (this._gen = (this._gen || 0) + 1);
    var last = performance.now();
    var sk = CFG.spring;
    function frame(now) {
      if (gen !== self._gen) return;
      var dt = clamp((now - last) / 1000, 0, 0.032);
      last = now;
      var steps = Math.ceil(dt / 0.004) || 1;
      var h = dt / steps;
      for (var i = 0; i < steps; i++) {
        var ax = (-sk.k * st.x - sk.d * st.vx) / sk.m;
        st.vx += ax * h;
        st.x += st.vx * h;
        var ay = (-sk.k * st.y - sk.d * st.vy) / sk.m;
        st.vy += ay * h;
        st.y += st.vy * h;
        var ar = (-sk.k * st.r - sk.d * st.vr) / sk.m;
        st.vr += ar * h;
        st.r += st.vr * h;
      }
      self.x = st.x;
      self.y = st.y;
      self.r = st.r;
      var rest =
        Math.abs(st.x) < 0.5 &&
        Math.abs(st.vx) < 5 &&
        Math.abs(st.y) < 0.5 &&
        Math.abs(st.vy) < 5 &&
        Math.abs(st.r) < 0.05;
      if (rest) {
        self.x = self.y = self.r = 0;
        self._paint(0, 0, 0, 0, "");
        return;
      }
      self._paint(st.x, st.y, st.r, 0, "");
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  SwipeDeck.prototype._stopSpring = function () {
    this._gen = (this._gen || 0) + 1;
  };

  SwipeDeck.prototype.want = function () {
    if (this.lock || !this.top) return;
    this.vx = 0;
    this.vy = 0;
    this.x = this.x || 0;
    this.y = this.y || 0;
    this._fly(-1);
  };

  SwipeDeck.prototype.pass = function () {
    if (this.lock || !this.top) return;
    this.vx = 0;
    this.vy = 0;
    this.x = this.x || 0;
    this.y = this.y || 0;
    this._fly(1);
  };

  SwipeDeck.prototype.undo = function () {
    if (this.lock || this.index <= 0) return;
    this.root.classList.remove("is-empty");
    this.index -= 1;
    this.render();
  };

  global.SwipeDeck = SwipeDeck;
  global.SWIPE_CFG = CFG;
})(window);
