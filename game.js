// ================================================================
//  CONFIG (populated from config.json at startup)
// ================================================================
let CANVAS_W, CANVAS_H, GROUND_Y, GRAVITY, JUMP_V;
let PART_W, PART_H, PART_GAP;
let PART_KEYS, PART_LABELS, PART_COLORS, STAGES;

// ================================================================
//  I18N
// ================================================================
let L = {};

/** Replace {key} placeholders in a locale string. */
function t(key, vars = {}) {
  let s = L[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ================================================================
//  SPRITE IMAGES
// ================================================================
const SPRITES = { head: null, body: null, tail: null };

function loadSprites() {
  return Promise.all(['head', 'body', 'tail'].map(key => new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { SPRITES[key] = img; resolve(); };
    img.onerror = () => resolve();   // fallback: stay null → use block
    img.src = `./img/${key}.png`;
  })));
}

// ================================================================
//  DRAWING FUNCTIONS
//  These are intentionally isolated so images can replace them.
// ================================================================

/** Internal helper: build a rounded-rect path (includes beginPath). */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw one body part using sprite images (head/body/tail).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ screenX:number, y:number, color:string, label:string, isHead:boolean, isTail:boolean }} part
 */

/**
 * ベジェ曲線上の点と、その点における接線の角度を計算する
 */
function getBezierData(t, p0, p1, p2, p3) {
  const cx = 3 * (p1.x - p0.x);
  const bx = 3 * (p2.x - p1.x) - cx;
  const ax = p3.x - p0.x - cx - bx;

  const cy = 3 * (p1.y - p0.y);
  const by = 3 * (p2.y - p1.y) - cy;
  const ay = p3.y - p0.y - cy - by;

  const x = ax * t ** 3 + bx * t ** 2 + cx * t + p0.x;
  const y = ay * t ** 3 + by * t ** 2 + cy * t + p0.y;

  // 接線（微分）から角度を算出
  const dx = 3 * ax * t ** 2 + 2 * bx * t + cx;
  const dy = 3 * ay * t ** 2 + 2 * by * t + cy;
  const angle = Math.atan2(dy, dx);

  return { x, y, angle };
}

/**
 * 個別のパーツを描画する（回転対応版）
 */
function drawBodyPart(ctx, part, angle = 0) {
  const { screenX: sx, y, color, label, isHead, isTail } = part;
  
  ctx.save();
  ctx.translate(sx, y + PART_H / 2); // パーツの中心を原点に
  ctx.rotate(angle);

  // 地面の影（回転させない方が自然なので、必要ならtranslate前に描画）
  
  const spriteKey = isHead ? 'head' : (isTail ? 'tail' : 'body');
  const img = SPRITES[spriteKey];

  if (img) {
    ctx.drawImage(img, -PART_W / 2, -PART_H / 2, PART_W, PART_H);
  } else {
    // Fallback: 枠線付きブロック
    roundRectPath(ctx, -PART_W / 2, -PART_H / 2, PART_W, PART_H, 7);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();
  }

  // ラベル描画
  if (label) {
    ctx.rotate(-angle); // テキストは水平に
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 4);
  }
  
  ctx.restore();
}

/**
 * パーツ間を「胴体画像」で埋め尽くす（タイリング補完）
 */
function drawConnector(ctx, a, b, camX, angleA, angleB) {
  const halfW = PART_W / 2;
  const centerY_A = a.y + PART_H / 2;
  const centerY_B = b.y + PART_H / 2;

  // aの右端（しっぽ側のパーツなら前方の接続点）
  const p0 = {
    x: (a.worldX - camX) + halfW * Math.cos(angleA),
    y: centerY_A + halfW * Math.sin(angleA)
  };

  // bの左端（頭側のパーツなら後方の接続点）
  const p3 = {
    x: (b.worldX - camX) - halfW * Math.cos(angleB),
    y: centerY_B - halfW * Math.sin(angleB)
  };

  // 制御点：それぞれの角度の方向に少し伸ばすと、より「しなり」が綺麗に出ます
  const handleLen = (p3.x - p0.x) * 0.8;
  const p1 = {
    x: p0.x + handleLen * Math.cos(angleA),
    y: p0.y + handleLen * Math.sin(angleA)
  };
  const p2 = {
    x: p3.x - handleLen * Math.cos(angleB),
    y: p3.y - handleLen * Math.sin(angleB)
  };

  // 描画ループ
  const dist = Math.sqrt((p3.x - p0.x)**2 + (p3.y - p0.y)**2);
  const segments = Math.max(2, Math.floor(dist / (PART_W * 0.5)));

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const { x, y, angle } = getBezierData(t, p0, p1, p2, p3);
    
    drawBodyPart(ctx, {
      screenX: x,
      y: y - PART_H / 2,
      color: a.color,
      isHead: false,
      isTail: false
    }, angle);
  }
}

/**
 * Draw an obstacle block.
 * Replace to swap in spike/lava/enemy sprites.
 */
function drawObstacle(ctx, obs, camX) {
  const sx = obs.x - camX;
  const { y, w, h } = obs;
  ctx.save();

  // Body
  roundRectPath(ctx, sx, y, w, h, 3);
  ctx.fillStyle = '#7f1d1d';
  ctx.fill();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Danger stripes (clipped to block)
  ctx.save();
  roundRectPath(ctx, sx, y, w, h, 3);
  ctx.clip();
  ctx.strokeStyle = 'rgba(239,68,68,0.3)';
  ctx.lineWidth = 10;
  for (let i = -h; i < w + h; i += 18) {
    ctx.beginPath();
    ctx.moveTo(sx + i, y);
    ctx.lineTo(sx + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();

  // Spikes on top
  ctx.fillStyle = '#ef4444';
  const spikeCount = Math.max(1, Math.floor(w / 14));
  const spikeW = w / spikeCount;
  for (let i = 0; i < spikeCount; i++) {
    const cx = sx + (i + 0.5) * spikeW;
    ctx.beginPath();
    ctx.moveTo(cx - spikeW * 0.45, y);
    ctx.lineTo(cx,                  y - 11);
    ctx.lineTo(cx + spikeW * 0.45, y);
    ctx.fill();
  }

  ctx.restore();
}

/** Draw the scrolling sky background. */
function drawBackground(ctx, camX) {
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, '#080c1e');
  grad.addColorStop(1, '#1a2050');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);

  // Parallax stars
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 65; i++) {
    const x = ((i * 139 - camX * 0.15) % CANVAS_W + CANVAS_W) % CANVAS_W;
    const y = (i * 71 + 17) % (GROUND_Y - 50);
    const r = (i % 4 === 0) ? 1.5 : 1;
    ctx.globalAlpha = 0.35 + (i % 6) * 0.1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Draw the ground plane with a glowing edge and tile grid. */
function drawGround(ctx, camX) {
  const grad = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
  grad.addColorStop(0, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

  // Glow edge
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, GROUND_Y, CANVAS_W, 2);

  // Grid
  const tile = 48;
  const off = ((camX % tile) + tile) % tile;
  ctx.strokeStyle = 'rgba(56,189,248,0.1)';
  ctx.lineWidth = 1;
  for (let x = -off; x < CANVAS_W + tile; x += tile) {
    ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x, CANVAS_H); ctx.stroke();
  }
  for (let y2 = GROUND_Y + tile; y2 < CANVAS_H; y2 += tile) {
    ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(CANVAS_W, y2); ctx.stroke();
  }
}

// ================================================================
//  BODY PART  (physics state)
// ================================================================
class BodyPart {
  constructor(index, totalParts) {
    this.index    = index;
    // Part 0 = tail (leftmost on screen). Part N-1 = head (rightmost/front).
    // Key A controls the leftmost block, matching the left-to-right screen order.
    this.worldX   = 220 - (totalParts - 1 - index) * PART_GAP;
    this.y        = GROUND_Y - PART_H;
    this.vy       = 0;
    this.onGround = true;
    this.color    = PART_COLORS[index % PART_COLORS.length];
    this.label    = PART_LABELS[index];
    this.isHead   = (index === totalParts - 1);
    this.isTail   = (index === 0);
  }

  jump() {
    if (this.onGround) {
      this.vy       = JUMP_V;
      this.onGround = false;
    }
  }

  update(speed) {
    this.worldX += speed;
    this.vy     += GRAVITY;
    this.y      += this.vy;
    if (this.y >= GROUND_Y - PART_H) {
      this.y        = GROUND_Y - PART_H;
      this.vy       = 0;
      this.onGround = true;
    }
  }

  /** AABB in world coordinates. */
  worldAABB() {
    return {
      left:   this.worldX - PART_W / 2,
      right:  this.worldX + PART_W / 2,
      top:    this.y,
      bottom: this.y + PART_H,
    };
  }
}

// ================================================================
//  GAME
// ================================================================
class Game {
  constructor() {
    this.canvas   = document.getElementById('gameCanvas');
    this.ctx      = this.canvas.getContext('2d');
    this.keys     = new Set();
    this.state    = 'start';   // start | playing | gameover | clear
    this.score    = 0;
    this.stageIdx = 0;
    this.parts    = [];
    this.obstacles = [];
    this.camX     = 0;
    this.distance = 0;
    this.speed    = 3;
    this.stageLen = 1;

    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
    this._setupInput();
    this._loadStage(0);
    this._loop();
  }

  // ----------------------------------------------------------
  _resizeCanvas() {
    const maxW  = Math.min(window.innerWidth,        CANVAS_W);
    const maxH  = Math.min(window.innerHeight * 0.6, CANVAS_H);
    const scale = Math.min(maxW / CANVAS_W, maxH / CANVAS_H);
    this.canvas.style.width  = (CANVAS_W * scale) + 'px';
    this.canvas.style.height = (CANVAS_H * scale) + 'px';
    this.canvas.width  = CANVAS_W;
    this.canvas.height = CANVAS_H;
  }

  // ----------------------------------------------------------
  _loadStage(idx) {
    const def      = STAGES[Math.min(idx, STAGES.length - 1)];
    this.stageIdx  = idx;
    this.speed     = def.speed;
    this.stageLen  = def.length;
    this.obstacles = def.obstacles.map(o => ({ ...o }));
    this.camX      = 0;
    this.distance  = 0;
    this.parts     = Array.from({ length: def.numParts },
                       (_, i) => new BodyPart(i, def.numParts));

    this._updateHUD();
    this._buildMobileButtons();
  }

  // ----------------------------------------------------------
  _setupInput() {
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (e.key === ' ') e.preventDefault();
      if (!this.keys.has(k)) {
        this.keys.add(k);
        this._onKey(k);
      }
    });
    document.addEventListener('keyup', e => {
      this.keys.delete(e.key.toLowerCase());
    });
  }

  _onKey(k) {
    if (this.state !== 'playing') {
      if (k === 'enter' || k === ' ') this._advance();
      return;
    }
    if (k === ' ') { this.parts.forEach(p => p.jump()); return; }
    for (let i = 0; i < this.parts.length; i++) {
      if (k === PART_KEYS[i]) { this.parts[i].jump(); return; }
    }
  }

  _advance() {
    if (this.state === 'gameover') {
      this._loadStage(this.stageIdx);
      this.state = 'playing';
    } else if (this.state === 'start') {
      this.state = 'playing';
    } else if (this.state === 'clear') {
      const next = this.stageIdx + 1;
      this._loadStage(next < STAGES.length ? next : 0);
      if (next >= STAGES.length) this.score = 0;
      this.state = 'playing';
    }
  }

  // ----------------------------------------------------------
  _buildMobileButtons() {
    const container = document.getElementById('mobileButtons');
    container.innerHTML = '';

    this.parts.forEach((part, i) => {
      const btn        = document.createElement('button');
      btn.className    = 'jumpBtn';
      btn.textContent  = `${part.label} (${i + 1})`;
      btn.style.background = part.color;
      const fire = e => {
        e.preventDefault();
        if (this.state === 'playing') part.jump();
        else this._advance();
      };
      btn.addEventListener('touchstart', fire, { passive: false });
      btn.addEventListener('mousedown',  fire);
      container.appendChild(btn);
    });

    const allBtn     = document.createElement('button');
    allBtn.className = 'jumpBtn all-btn';
    allBtn.textContent = 'ALL';
    const fireAll = e => {
      e.preventDefault();
      if (this.state === 'playing') this.parts.forEach(p => p.jump());
      else this._advance();
    };
    allBtn.addEventListener('touchstart', fireAll, { passive: false });
    allBtn.addEventListener('mousedown',  fireAll);
    container.appendChild(allBtn);
  }

  _updateHUD() {
    document.getElementById('stageLbl').textContent = t('stageLabel', { n: this.stageIdx + 1 });
    document.getElementById('scoreLbl').textContent = t('scoreLabel', { n: this.score });
    const keys = PART_KEYS.slice(0, this.parts.length).map(k => k.toUpperCase()).join(' / ');
    document.getElementById('keyHints').textContent = t('keyHints', { keys });
  }

  // ----------------------------------------------------------
  _checkCollision() {
    for (const part of this.parts) {
      const bb = part.worldAABB();
      for (const obs of this.obstacles) {
        if (bb.right  > obs.x       &&
            bb.left   < obs.x + obs.w &&
            bb.bottom > obs.y       &&
            bb.top    < obs.y + obs.h) {
          return true;
        }
      }
    }
    return false;
  }

  // ----------------------------------------------------------
  _update() {
    if (this.state !== 'playing') return;

    this.parts.forEach(p => p.update(this.speed));

    // Camera: keep head (parts[N-1], rightmost) fixed at 220px from left edge
    this.camX = this.parts[this.parts.length - 1].worldX - 220;

    this.distance += this.speed;
    this.score     = Math.floor(this.distance);
    document.getElementById('scoreLbl').textContent = t('scoreLabel', { n: this.score });

    if (this._checkCollision()) {
      this.state = 'gameover';
      return;
    }

    if (this.distance >= this.stageLen) {
      this.score += 1000 * (this.stageIdx + 1);
      this.state  = 'clear';
      return;
    }

    // Cull obstacles that are well past the camera
    this.obstacles = this.obstacles.filter(o => o.x + o.w > this.camX - 200);
  }

  // ----------------------------------------------------------
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    drawBackground(ctx, this.camX);
    drawGround(ctx, this.camX);

    // Obstacles
    this.obstacles.forEach(o => drawObstacle(ctx, o, this.camX));

    // 各パーツの現在の角度をリスト化しておく
    const angles = this.parts.map((p, i) => {
      if (i < this.parts.length - 1) {
        const next = this.parts[i + 1];
        return Math.atan2(next.y - p.y, next.worldX - p.worldX);
      } else {
        const prev = this.parts[i - 1];
        return Math.atan2(p.y - prev.y, p.worldX - prev.worldX);
      }
    });

    // 1. コネクタ（補完された胴体）を先に描画
    for (let i = 0; i < this.parts.length - 1; i++) {
      drawConnector(ctx, this.parts[i], this.parts[i + 1], this.camX, angles[i], angles[i+1]);
    }

    // 2. メインの操作パーツを描画
    this.parts.forEach((p, i) => {
      //if (p.isHead || p.isTail) {
        drawBodyPart(ctx, {
          screenX: p.worldX - this.camX,
          y: p.y,
          color: p.color,
          label: p.label,
          isHead: p.isHead,
          isTail: p.isTail,
        }, angles[i]);
      /*} else {
        // 胴体はラベルのみ
        ctx.fillStyle = 'white';
        ctx.fillText(p.label, p.worldX - this.camX, p.y + PART_H / 2 + 5);
      }*/
    });

    // Progress bar
    const prog = Math.min(this.distance / this.stageLen, 1);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(10, 10, 200, 10);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(10, 10, 200 * prog, 10);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 200, 10);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('goal'), 216, 10);

    // Overlay (start / game-over / stage-clear)
    if (this.state !== 'playing') this._drawOverlay();
  }

  _drawOverlay() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    let title, sub;
    if (this.state === 'start') {
      title = t('title');
      sub   = t('startSub');
    } else if (this.state === 'gameover') {
      title = t('gameOver');
      sub   = t('gameOverSub', { score: this.score });
    } else if (this.state === 'clear') {
      const next = this.stageIdx + 1;
      if (next < STAGES.length) {
        title = t('stageClear', { stage: this.stageIdx + 1 });
        sub   = t('stageClearSub', { parts: STAGES[next].numParts });
      } else {
        title = t('allClear');
        sub   = t('allClearSub', { score: this.score });
      }
    }

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 38px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, CANVAS_W / 2, CANVAS_H / 2 - 26);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '18px monospace';
    ctx.fillText(sub, CANVAS_W / 2, CANVAS_H / 2 + 26);
    ctx.restore();
  }

  // ----------------------------------------------------------
  _loop() {
    this._update();
    this._draw();
    requestAnimationFrame(() => this._loop());
  }
}

// ================================================================
//  BOOT
// ================================================================
async function main() {
  const lang = navigator.language.startsWith('ja') ? 'ja' : 'en';
  L = await fetch(`./locales/${lang}.json`).then(r => r.json());
  document.title = L.title;

  const [cfg] = await Promise.all([
    fetch('./config.json').then(r => r.json()),
    loadSprites(),
  ]);

  CANVAS_W    = cfg.CANVAS_W;
  CANVAS_H    = cfg.CANVAS_H;
  GROUND_Y    = cfg.GROUND_Y;
  GRAVITY     = cfg.GRAVITY;
  JUMP_V      = cfg.JUMP_V;
  PART_W      = cfg.PART_W;
  PART_H      = cfg.PART_H;
  PART_GAP    = cfg.PART_GAP;
  PART_KEYS   = cfg.PART_KEYS;
  PART_LABELS = cfg.PART_LABELS;
  PART_COLORS = cfg.PART_COLORS;
  STAGES      = cfg.STAGES;

  new Game();

}

window.addEventListener('load', main);
