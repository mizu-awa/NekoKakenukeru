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
const SPRITES = { head: null, body: null, tail: null, bodyFeathered: null };

function loadSprites() {
  return Promise.all(['head', 'body', 'tail'].map(key => new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { SPRITES[key] = img; resolve(); };
    img.onerror = () => resolve();   // fallback: stay null → use block
    img.src = `./img/${key}.png`;
  })));
}

/**
 * body スプライトの左右端にアルファグラデーションをかけたオフスクリーン版を生成する。
 * PART_W / PART_H が確定した後に呼ぶこと。
 */
function createFeatheredBodySprite() {
  if (!SPRITES.body) return;
  const oc = document.createElement('canvas');
  oc.width  = PART_W;
  oc.height = PART_H;
  const c = oc.getContext('2d');

  // 元画像を描画
  c.drawImage(SPRITES.body, 0, 0, PART_W, PART_H);

  // 左右 28% をフェードさせるグラデーションマスク
  const fadeW = PART_W * 0.28;
  const grad = c.createLinearGradient(0, 0, PART_W, 0);
  grad.addColorStop(0,               'rgba(0,0,0,0)');
  grad.addColorStop(fadeW / PART_W,  'rgba(0,0,0,1)');
  grad.addColorStop(1 - fadeW / PART_W, 'rgba(0,0,0,1)');
  grad.addColorStop(1,               'rgba(0,0,0,0)');

  // destination-in: グラデーションのアルファで画像アルファを切り抜く
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = grad;
  c.fillRect(0, 0, PART_W, PART_H);

  SPRITES.bodyFeathered = oc;
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
 * Catmull-Rom スプライン: 制御点列を通る滑らかな曲線を生成する。
 * 返り値: { x, y, angle }[] （等パラメータサンプル）
 *
 * @param {{ x:number, y:number }[]} pts  制御点（2点以上）
 * @param {number} totalSamples  全体のサンプル数
 */
function sampleCatmullRom(pts, totalSamples) {
  if (pts.length < 2) return pts.map(p => ({ ...p, angle: 0 }));

  // 端点用のファントムポイントを追加（反射）
  const ext = [
    { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y },
    ...pts,
    { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x,
      y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y },
  ];

  const segments = pts.length - 1;
  const result = [];

  for (let seg = 0; seg < segments; seg++) {
    const p0 = ext[seg];
    const p1 = ext[seg + 1];
    const p2 = ext[seg + 2];
    const p3 = ext[seg + 3];

    const samplesInSeg = (seg === segments - 1)
      ? Math.ceil(totalSamples / segments)
      : Math.floor(totalSamples / segments);

    for (let i = 0; i < samplesInSeg; i++) {
      const t = i / samplesInSeg;
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * ((2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      // 接線（微分）
      const dx = 0.5 * ((-p0.x + p2.x) +
        (4 * p0.x - 10 * p1.x + 8 * p2.x - 2 * p3.x) * t +
        (-3 * p0.x + 9 * p1.x - 9 * p2.x + 3 * p3.x) * t2);
      const dy = 0.5 * ((-p0.y + p2.y) +
        (4 * p0.y - 10 * p1.y + 8 * p2.y - 2 * p3.y) * t +
        (-3 * p0.y + 9 * p1.y - 9 * p2.y + 3 * p3.y) * t2);

      result.push({ x, y, angle: Math.atan2(dy, dx) });
    }
  }

  // 最終点を追加
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  result.push({ x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x) });

  return result;
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
  // 胴体（head/tail 以外）はフェザリング済み画像を優先使用
  const img = (!isHead && !isTail && SPRITES.bodyFeathered)
    ? SPRITES.bodyFeathered
    : SPRITES[spriteKey];

  if (img) {
    const drawOffsetX = isTail ? 2 : 0;
    ctx.drawImage(img, -PART_W / 2 + drawOffsetX, -PART_H / 2, PART_W, PART_H);
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
 * スプラインに沿ってねこ全身を描画する。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {BodyPart[]} parts   全パーツ（tail=0 … head=N-1）
 * @param {number} camX
 */
function drawCatBody(ctx, parts, camX) {
  // 制御点: 各パーツの中心（スクリーン座標）
  const controlPts = parts.map(p => ({
    x: p.worldX - camX,
    y: p.y + PART_H / 2,
  }));

  // スプライン上のサンプル数（パーツ間ごとに十分な密度）
  const samplesPerSeg = Math.max(2, Math.ceil(PART_GAP / (PART_W * 0.6)));
  const totalSamples = samplesPerSeg * (parts.length - 1);
  const samples = sampleCatmullRom(controlPts, totalSamples);

  // --- 白い胴体背景の下塗り（フェザリングのすき間を埋める） ---
  // body.png の白い帯は画像中心よりやや上にある（上方向 PART_H*0.08 オフセット）
  // 胴体タイルより先に描くことで、タイル間のすき間を白で埋める
  if (samples.length >= 2) {
    const whiteOffset = PART_H * 0.05; // 画像中心から白帯中央までの距離（上向き）
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const bx = s.x + Math.sin(s.angle) * whiteOffset;
      const by = s.y - Math.cos(s.angle) * whiteOffset;
      if (i === 0) ctx.moveTo(bx, by);
      else         ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = PART_H * 0.35; // 画像内の白い帯の高さに近似
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // --- 胴体タイルを描画（間引き） ---
  const step = Math.max(1, Math.floor(samples.length / (parts.length * 2)));
  for (let i = 0; i < samples.length; i += step) {
    const s = samples[i];
    drawBodyPart(ctx, {
      screenX: s.x,
      y: s.y - PART_H / 2,
      color: parts[0].color,
      label: null,
      isHead: (i + step >= samples.length),
      isTail: (i === 0),
    }, s.angle);
  }
  // 最終点（頭）が間引きで飛ばされた場合に補完
  if ((samples.length - 1) % step !== 0) {
    const s = samples[samples.length - 1];
    drawBodyPart(ctx, {
      screenX: s.x,
      y: s.y - PART_H / 2,
      color: parts[0].color,
      label: null,
      isHead: true,
      isTail: false,
    }, s.angle);
  }

  // --- 背中ライン（白＋黒） ---
  // 胴体セグメントの "上端" は画像中心から法線方向にオフセット
  if (samples.length >= 2) {
    const backOffset = PART_H * 0.20;
    const lineExtendPx = 8; // 両端を延長するpx数

    // 白ライン（背中ラインの下側、胴体画像との隙間を埋める）
    const whiteBackOffset = backOffset - PART_H * 0.04;
    ctx.save();
    ctx.beginPath();
    {
      const s0 = samples[0];
      const bx0 = s0.x + Math.sin(s0.angle) * whiteBackOffset - Math.cos(s0.angle) * lineExtendPx;
      const by0 = s0.y - Math.cos(s0.angle) * whiteBackOffset - Math.sin(s0.angle) * lineExtendPx;
      ctx.moveTo(bx0, by0);
    }
    for (let i = 0; i < samples.length - 2; i++) {
      const s = samples[i];
      const bx = s.x + Math.sin(s.angle) * whiteBackOffset;
      const by = s.y - Math.cos(s.angle) * whiteBackOffset;
      ctx.lineTo(bx, by);
    }
    {
      const sN = samples[samples.length - 2];
      const bxN = sN.x + Math.sin(sN.angle) * whiteBackOffset + Math.cos(sN.angle) * lineExtendPx;
      const byN = sN.y - Math.cos(sN.angle) * whiteBackOffset + Math.sin(sN.angle) * lineExtendPx;
      ctx.lineTo(bxN, byN);
    }
    ctx.strokeStyle = 'white';
    ctx.lineWidth   = 6;
    ctx.lineCap     = 'butt';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.restore();

    // 黒ライン（背中の輪郭）
    ctx.save();
    ctx.beginPath();
    {
      const s0 = samples[0];
      const bx0 = s0.x + Math.sin(s0.angle) * backOffset - Math.cos(s0.angle) * lineExtendPx;
      const by0 = s0.y - Math.cos(s0.angle) * backOffset - Math.sin(s0.angle) * lineExtendPx;
      ctx.moveTo(bx0, by0);
    }
    for (let i = 0; i < samples.length - 2; i++) {
      const s = samples[i];
      const bx = s.x + Math.sin(s.angle) * backOffset;
      const by = s.y - Math.cos(s.angle) * backOffset;
      ctx.lineTo(bx, by);
    }
    {
      const sN = samples[samples.length - 2];
      const bxN = sN.x + Math.sin(sN.angle) * backOffset + Math.cos(sN.angle) * lineExtendPx;
      const byN = sN.y - Math.cos(sN.angle) * backOffset + Math.sin(sN.angle) * lineExtendPx;
      ctx.lineTo(bxN, byN);
    }
    ctx.strokeStyle = 'black';
    ctx.lineWidth   = 3;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // --- 操作パーツのラベルを描画（ねこの上に浮かせる） ---
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of parts) {
    const sx = p.worldX - camX;
    const labelY = p.y - 14; // ねこの上方に浮かせる

    // 背景（丸角矩形）
    const tw = ctx.measureText(p.label).width;
    const padX = 5, padY = 3;
    const bx = sx - tw / 2 - padX;
    const by = labelY - 8 - padY;
    const bw = tw + padX * 2;
    const bh = 16 + padY * 2;
    roundRectPath(ctx, bx, by, bw, bh, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.fillText(p.label, sx, labelY);
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

  // Body (solid fill + border, no clip/stripes for performance)
  roundRectPath(ctx, sx, y, w, h, 3);
  ctx.fillStyle = '#7f1d1d';
  ctx.fill();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner highlight line (lightweight alternative to stripes)
  roundRectPath(ctx, sx + 3, y + 3, w - 6, h - 6, 2);
  ctx.strokeStyle = 'rgba(239,68,68,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

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

/** Simple mountain height: |sin| gives sharp valleys and round peaks. */
function _mtHeight(wx, seed, amp, freq) {
  return Math.abs(Math.sin(wx * freq + seed)) * amp;
}

/** Draw one mountain silhouette layer with parallax. */
function drawMountainLayer(ctx, camX, parallax, baseY, color, amp, freq) {
  const ox   = camX * parallax;
  const seed = parallax * 17;
  ctx.save();
  ctx.fillStyle = color;

  // Mountain silhouette
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let sx = 0; sx <= CANVAS_W; sx += 8) {
    ctx.lineTo(sx, baseY - _mtHeight(sx + ox, seed, amp, freq));
  }
  ctx.lineTo(CANVAS_W, GROUND_Y);
  ctx.closePath();
  ctx.fill();

  // Cat ears on every 5th peak.
  // |sin(wx*freq + seed)| peaks at wx = (π/2 + n*π - seed) / freq
  const nMin = Math.ceil(((ox - 60) * freq + seed - Math.PI / 2) / Math.PI);
  const nMax = Math.floor(((ox + CANVAS_W + 60) * freq + seed - Math.PI / 2) / Math.PI);
  const ew = amp * 0.36;  // ear base half-width
  const eh = amp * 0.34;  // ear height (lower = gentler)
  const gap = amp * 0.22; // gap between ears
  for (let n = nMin; n <= nMax; n++) {
    if (((n % 5) + 5) % 5 !== 0) continue;
    const wxPeak = (Math.PI / 2 + n * Math.PI - seed) / freq;
    const px = wxPeak - ox;
    const py = baseY - amp;
    const base = py + ew * 0.3; // ear base y (slightly below peak)

    // Left ear – quadratic bezier sides to round the tip
    const lOuter = px - gap - ew * 2;
    const lInner = px - gap;
    const lTipX  = px - gap - ew;
    const lTipY  = py - eh;
    ctx.beginPath();
    ctx.moveTo(lOuter, base);
    ctx.lineTo(lInner, base);
    ctx.quadraticCurveTo(lInner  - ew * 0.3, base - eh * 0.55, lTipX, lTipY);
    ctx.quadraticCurveTo(lOuter  + ew * 0.3, base - eh * 0.55, lOuter, base);
    ctx.closePath();
    ctx.fill();

    // Right ear
    const rInner = px + gap;
    const rOuter = px + gap + ew * 2;
    const rTipX  = px + gap + ew;
    const rTipY  = py - eh;
    ctx.beginPath();
    ctx.moveTo(rInner, base);
    ctx.lineTo(rOuter, base);
    ctx.quadraticCurveTo(rOuter  - ew * 0.3, base - eh * 0.55, rTipX, rTipY);
    ctx.quadraticCurveTo(rInner  + ew * 0.3, base - eh * 0.55, rInner, base);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** Ensure mountain cache canvases exist. */
function ensureMtCaches() {
  if (_mtCaches) return;
  const layers = [
    { parallax: 0.04, baseY: GROUND_Y * 0.65, color: '#7aabcc', amp: 55, freq: 0.006 },
    { parallax: 0.11, baseY: GROUND_Y * 0.75, color: '#5a8fb0', amp: 50, freq: 0.009 },
    { parallax: 0.22, baseY: GROUND_Y * 0.85, color: '#3d6e8a', amp: 42, freq: 0.013 },
  ];
  _mtCaches = layers.map(l => ({
    canvas: null, lastOx: -Infinity, ...l,
  }));
}

/** Render a mountain layer into its cache if needed, then blit to screen. */
function drawMountainLayerCached(ctx, camX, layer) {
  const ox = camX * layer.parallax;
  const cacheW = CANVAS_W + MT_CACHE_PAD * 2;

  // Redraw cache if first time or scrolled too far
  if (!layer.canvas || Math.abs(ox - layer.lastOx) > MT_REDRAW_THRESHOLD) {
    if (!layer.canvas) {
      layer.canvas = document.createElement('canvas');
      layer.canvas.width = cacheW;
      layer.canvas.height = CANVAS_H;
    }
    const c = layer.canvas.getContext('2d');
    c.clearRect(0, 0, cacheW, CANVAS_H);

    // Render mountain into cache (shifted so ox - MT_CACHE_PAD is at x=0)
    const cacheOx = ox - MT_CACHE_PAD;
    c.save();
    c.fillStyle = layer.color;
    c.beginPath();
    c.moveTo(0, GROUND_Y);
    const seed = layer.parallax * 17;
    for (let sx = 0; sx <= cacheW; sx += 8) {
      c.lineTo(sx, layer.baseY - _mtHeight(sx + cacheOx, seed, layer.amp, layer.freq));
    }
    c.lineTo(cacheW, GROUND_Y);
    c.closePath();
    c.fill();

    // Cat ears
    const nMin = Math.ceil(((cacheOx - 60) * layer.freq + seed - Math.PI / 2) / Math.PI);
    const nMax = Math.floor(((cacheOx + cacheW + 60) * layer.freq + seed - Math.PI / 2) / Math.PI);
    const ew = layer.amp * 0.36;
    const eh = layer.amp * 0.34;
    const gap = layer.amp * 0.22;
    for (let n = nMin; n <= nMax; n++) {
      if (((n % 5) + 5) % 5 !== 0) continue;
      const wxPeak = (Math.PI / 2 + n * Math.PI - seed) / layer.freq;
      const px = wxPeak - cacheOx;
      const py = layer.baseY - layer.amp;
      const base = py + ew * 0.3;
      const lOuter = px - gap - ew * 2, lInner = px - gap, lTipX = px - gap - ew, lTipY = py - eh;
      c.beginPath();
      c.moveTo(lOuter, base); c.lineTo(lInner, base);
      c.quadraticCurveTo(lInner - ew * 0.3, base - eh * 0.55, lTipX, lTipY);
      c.quadraticCurveTo(lOuter + ew * 0.3, base - eh * 0.55, lOuter, base);
      c.closePath(); c.fill();
      const rInner = px + gap, rOuter = px + gap + ew * 2, rTipX = px + gap + ew, rTipY = py - eh;
      c.beginPath();
      c.moveTo(rInner, base); c.lineTo(rOuter, base);
      c.quadraticCurveTo(rOuter - ew * 0.3, base - eh * 0.55, rTipX, rTipY);
      c.quadraticCurveTo(rInner + ew * 0.3, base - eh * 0.55, rInner, base);
      c.closePath(); c.fill();
    }
    c.restore();

    layer.lastOx = ox;
  }

  // Blit: shift cache so that the cached region aligns with the viewport
  const shiftX = -(ox - layer.lastOx) - MT_CACHE_PAD;
  ctx.drawImage(layer.canvas, shiftX, 0);
}

/** Draw the scrolling sky background. */
function drawBackground(ctx, camX) {
  ctx.drawImage(_bgCache, 0, 0);

  ensureMtCaches();
  for (const layer of _mtCaches) {
    drawMountainLayerCached(ctx, camX, layer);
  }
}

/** Draw the ground plane with a glowing edge and tile grid. */
function drawGround(ctx, camX) {
  ctx.drawImage(_groundCache, 0, GROUND_Y);

  // Glow edge
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, GROUND_Y, CANVAS_W, 2);

  // Grid
  const tile = 48;
  const off = ((camX % tile) + tile) % tile;
  ctx.strokeStyle = 'rgba(56,189,248,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -off; x < CANVAS_W + tile; x += tile) {
    ctx.moveTo(x, GROUND_Y); ctx.lineTo(x, CANVAS_H);
  }
  for (let y2 = GROUND_Y + tile; y2 < CANVAS_H; y2 += tile) {
    ctx.moveTo(0, y2); ctx.lineTo(CANVAS_W, y2);
  }
  ctx.stroke();
}

// ================================================================
//  BODY PART  (physics state)
// ================================================================
class BodyPart {
  constructor(index, totalParts) {
    this.index    = index;
    // Part 0 = tail (leftmost on screen). Part N-1 = head (rightmost/front).
    // Key A controls the leftmost block, matching the left-to-right screen order.
    const headScreenX = Math.max(220, (totalParts - 1) * PART_GAP + 100);
    this.worldX   = headScreenX - (totalParts - 1 - index) * PART_GAP;
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
//  AUTO-PLAY & VALIDATION
// ================================================================

/**
 * 障害物を越えるために「あと何フレーム猶予があるか」を計算する。
 * 地面にいるパーツが対象障害物と Y 方向で重なる（＝ジャンプ必須）場合のみ有効。
 * @returns null（対象外）| { dMax, dMin }（猶予フレーム）| { impossible }
 */
function calcJumpDeadline(partWorldX, obs, speed) {
  // 地上での Y 重なり判定
  if (GROUND_Y <= obs.y || (GROUND_Y - PART_H) >= obs.y + obs.h) return null;

  const distToEntry = obs.x - (partWorldX + PART_W / 2);
  const distToExit  = (obs.x + obs.w) - (partWorldX - PART_W / 2);
  if (distToExit <= 0) return null;           // すでに通過済み
  if (distToEntry <= 0) return { dMax: -1 };  // すでに重なっている

  const framesToEntry = distToEntry / speed;
  const framesToExit  = distToExit / speed;

  // 放物線: bottom(t) = GROUND_Y + JUMP_V*t + 0.5*GRAVITY*t²
  // bottom(t) ≤ obs.y - MARGIN となる区間 [u1, u2] を求める
  const MARGIN = 1;
  const a    = 0.5 * GRAVITY;
  const b    = JUMP_V;
  const c    = GROUND_Y - (obs.y - MARGIN);
  const disc = b * b - 4 * a * c;

  if (disc < 0) return { impossible: true, dMax: -Infinity };

  const sq = Math.sqrt(disc);
  const u1 = (-b - sq) / (2 * a);  // ジャンプ後、クリア開始フレーム
  const u2 = (-b + sq) / (2 * a);  // ジャンプ後、クリア終了フレーム

  const dMax = framesToEntry - u1;  // 最も遅く飛べるタイミング（猶予）
  const dMin = framesToExit  - u2;  // 最も早く飛ばねばならないタイミング

  if (dMax < dMin) return { impossible: true, dMax: -Infinity };

  return { dMax, dMin, u1, u2 };
}

/**
 * 現在位置からジャンプした場合の軌道をシミュレーションし、
 * 障害物との衝突が起きるかチェックする。
 */
function simulateJump(partWorldX, obstacles, speed) {
  let y  = GROUND_Y - PART_H;
  let vy = JUMP_V;

  for (let t = 1; t <= 200; t++) {
    const wx = partWorldX + speed * t;
    vy += GRAVITY;
    y  += vy;
    if (y >= GROUND_Y - PART_H) return { safe: true, landFrame: t };

    const left   = wx - PART_W / 2;
    const right  = wx + PART_W / 2;
    const top    = y;
    const bottom = y + PART_H;

    for (const obs of obstacles) {
      if (right > obs.x && left < obs.x + obs.w &&
          bottom > obs.y && top < obs.y + obs.h) {
        return { safe: false, collideFrame: t, obs };
      }
    }
  }
  return { safe: true, landFrame: 200 };
}

/**
 * ステージをヘッドレスで自動プレイし、クリア可能かを検証する。
 */
function validateStage(stageIdx) {
  const def = STAGES[Math.min(stageIdx, STAGES.length - 1)];
  const { speed, length: stageLen, numParts } = def;
  const obstacles = def.obstacles.map(o => ({ ...o }));
  const parts = Array.from({ length: numParts }, (_, i) => new BodyPart(i, numParts));

  let distance = 0;
  const maxFrames = Math.ceil(stageLen / speed) + 500;

  for (let frame = 0; frame < maxFrames; frame++) {
    // オートプレイ判定
    for (const part of parts) {
      if (!part.onGround) continue;

      let urgentDeadline = Infinity;
      for (const obs of obstacles) {
        const r = calcJumpDeadline(part.worldX, obs, speed);
        if (!r) continue;
        if (r.dMax < urgentDeadline) urgentDeadline = r.dMax;
      }
      if (urgentDeadline > 5) continue;

      const sim = simulateJump(part.worldX, obstacles, speed);
      if (sim.safe && urgentDeadline <= 2) { part.jump(); continue; }
      if (urgentDeadline <= 0) part.jump();
    }

    // 物理更新
    parts.forEach(p => p.update(speed));
    distance += speed;

    // 衝突判定
    for (const part of parts) {
      const bb = part.worldAABB();
      for (const obs of obstacles) {
        if (bb.right > obs.x && bb.left < obs.x + obs.w &&
            bb.bottom > obs.y && bb.top < obs.y + obs.h) {
          return { beatable: false, frame, collidedObs: obs, partIndex: part.index };
        }
      }
    }

    if (distance >= stageLen) return { beatable: true, frames: frame };
  }

  return { beatable: false, reason: 'timeout' };
}

// ================================================================
//  CACHED BACKGROUNDS (avoid creating gradients every frame)
// ================================================================
let _bgCache = null;   // offscreen canvas for sky gradient
let _groundCache = null; // offscreen canvas for ground gradient

// Mountain layer cache: pre-render wide strips, scroll via drawImage
let _mtCaches = null;   // [{canvas, lastOx}] per layer
const MT_CACHE_PAD = 200; // extra pixels beyond viewport to avoid frequent redraws
const MT_REDRAW_THRESHOLD = 100; // redraw when scrolled this far from cached origin

function ensureBgCache() {
  if (_bgCache) return;
  _bgCache = document.createElement('canvas');
  _bgCache.width = CANVAS_W;
  _bgCache.height = GROUND_Y;
  const c = _bgCache.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, '#4a90d9');
  grad.addColorStop(1, '#a8d8f0');
  c.fillStyle = grad;
  c.fillRect(0, 0, CANVAS_W, GROUND_Y);
}

function ensureGroundCache() {
  if (_groundCache) return;
  _groundCache = document.createElement('canvas');
  _groundCache.width = CANVAS_W;
  _groundCache.height = CANVAS_H - GROUND_Y;
  const c = _groundCache.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, CANVAS_H - GROUND_Y);
  grad.addColorStop(0, '#1e293b');
  grad.addColorStop(1, '#0f172a');
  c.fillStyle = grad;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H - GROUND_Y);
}

// ================================================================
//  GAME
// ================================================================
class Game {
  constructor() {
    this.canvas   = document.getElementById('gameCanvas');
    this.ctx      = this.canvas.getContext('2d', { alpha: false });
    this.keys     = new Set();
    this.state    = 'start';   // start | playing | gameover | clear
    this.stageIdx = 0;
    this.parts    = [];
    this.obstacles = [];
    this.camX     = 0;
    this.distance = 0;
    this.speed    = 3;
    this.stageLen = 1;
    this.autoPlay = false;
    this.autoAdvanceTimer = 0;
    this.validationResult = null;
    this._isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._lastFrame = 0;

    ensureBgCache();
    ensureGroundCache();

    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
    this._setupInput();
    this._loadStage(0);
    requestAnimationFrame(t => this._loop(t));
  }

  // ----------------------------------------------------------
  _resizeCanvas() {
    const maxW  = Math.min(window.innerWidth,        CANVAS_W);
    const maxH  = Math.min(window.innerHeight * 0.6, CANVAS_H);
    const scale = Math.min(maxW / CANVAS_W, maxH / CANVAS_H);
    this.canvas.style.width  = (CANVAS_W * scale) + 'px';
    this.canvas.style.height = (CANVAS_H * scale) + 'px';

    // モバイルでは解像度を半分にして描画負荷を軽減
    const res = this._isMobile ? 0.5 : 1;
    this.canvas.width  = CANVAS_W * res;
    this.canvas.height = CANVAS_H * res;

    if (this._isMobile) {
      this.ctx.setTransform(res, 0, 0, res, 0, 0);
    } else {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // 解像度変更でキャッシュが合わなくなるので再生成
    _bgCache = null;
    _groundCache = null;
    if (_mtCaches) _mtCaches.forEach(l => { l.canvas = null; l.lastOx = -Infinity; });
    ensureBgCache();
    ensureGroundCache();
  }

  // ----------------------------------------------------------
  _loadStage(idx) {
    const def      = STAGES[Math.min(idx, STAGES.length - 1)];
    this.stageIdx  = idx;
    this.speed     = def.speed * (this._isMobile ? 2 : 1);
    this.stageLen  = def.length;
    this.obstacles = def.obstacles.map(o => ({ ...o }));
    this.camX      = 0;
    this.distance  = 0;
    // Reset mountain caches so they redraw from new camera position
    if (_mtCaches) _mtCaches.forEach(l => l.lastOx = -Infinity);
    this.parts     = Array.from({ length: def.numParts },
                       (_, i) => new BodyPart(i, def.numParts));

    this._updateHUD();
    this._buildMobileButtons();
  }

  // ----------------------------------------------------------
  _setupInput() {
    this.canvas.addEventListener('mousedown', e => {
      if (this.state !== 'playing') { e.preventDefault(); this._advance(); }
    });
    this.canvas.addEventListener('touchstart', e => {
      if (this.state !== 'playing') { e.preventDefault(); this._advance(); }
    }, { passive: false });

    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (e.key === ' ') e.preventDefault();
      if (!this.keys.has(k)) {
        this.keys.add(k);
        this._onKey(k);
        this._setButtonActive(k, true);
      }
    });
    document.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      this._setButtonActive(k, false);
    });
  }

  _setButtonActive(k, active) {
    if (!this.btnEls) return;
    if (k === ' ') {
      this.btnEls.forEach(b => b.classList.toggle('key-active', active));
      if (this.allBtnEl) this.allBtnEl.classList.toggle('key-active', active);
      return;
    }
    for (let i = 0; i < this.parts.length; i++) {
      if (k === PART_KEYS[i]) {
        this.btnEls[i]?.classList.toggle('key-active', active);
        return;
      }
    }
  }

  _onKey(k) {
    if (k === 'p') { this.autoPlay = !this.autoPlay; return; }
    if (k === 'v') { this._validateAllStages(); return; }

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
      this.state = 'playing';
    }
  }

  // ----------------------------------------------------------
  _buildMobileButtons() {
    const container = document.getElementById('mobileButtons');
    container.innerHTML = '';
    this.btnEls = [];

    this.parts.forEach((part) => {
      const btn        = document.createElement('button');
      btn.className    = 'jumpBtn';
      btn.textContent  = part.label;
      btn.style.background = part.color;
      const fire = e => {
        e.preventDefault();
        if (this.state === 'playing') part.jump();
        else this._advance();
      };
      btn.addEventListener('touchstart', fire, { passive: false });
      btn.addEventListener('mousedown',  fire);
      container.appendChild(btn);
      this.btnEls.push(btn);
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
    this.allBtnEl = allBtn;
  }

  _updateHUD() {
    document.getElementById('stageLbl').textContent = t('stageLabel', { n: this.stageIdx + 1 });
    const keys = PART_KEYS.slice(0, this.parts.length).map(k => k.toUpperCase()).join(' / ');
    document.getElementById('keyHints').textContent = t('keyHints', { keys });
  }

  // ----------------------------------------------------------
  //  AUTO-PLAY
  // ----------------------------------------------------------
  _autoPlayUpdate() {
    for (const part of this.parts) {
      if (!part.onGround) continue;
      if (this._shouldAutoJump(part)) part.jump();
    }
  }

  _shouldAutoJump(part) {
    let urgentDeadline = Infinity;

    for (const obs of this.obstacles) {
      const r = calcJumpDeadline(part.worldX, obs, this.speed);
      if (!r) continue;
      if (r.dMax < urgentDeadline) urgentDeadline = r.dMax;
    }

    if (urgentDeadline > 5) return false;

    // ジャンプ軌道が安全か（浮遊障害物に当たらないか）チェック
    const sim = simulateJump(part.worldX, this.obstacles, this.speed);
    if (sim.safe) return urgentDeadline <= 2;

    // 不安全だがデッドライン超過 → やむを得ずジャンプ
    return urgentDeadline <= 0;
  }

  _validateAllStages() {
    console.log('=== Stage Validation ===');
    this.validationResult = [];
    for (let i = 0; i < STAGES.length; i++) {
      const r = validateStage(i);
      this.validationResult.push(r);
      if (r.beatable) {
        console.log(`Stage ${i + 1}: ✓ クリア可能 (${r.frames} frames)`);
      } else if (r.reason === 'timeout') {
        console.log(`Stage ${i + 1}: ✗ タイムアウト`);
      } else {
        console.log(`Stage ${i + 1}: ✗ Part ${r.partIndex} が障害物(x=${r.collidedObs.x})に衝突 (frame ${r.frame})`);
      }
    }
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
    if (this.state !== 'playing') {
      if (this.autoPlay) {
        this.autoAdvanceTimer++;
        if (this.autoAdvanceTimer > 90) {
          this.autoAdvanceTimer = 0;
          this._advance();
        }
      }
      return;
    }

    if (this.autoPlay) this._autoPlayUpdate();

    this.parts.forEach(p => p.update(this.speed));

    // Camera: keep head fixed so the full cat body is visible
    const catSpan = (this.parts.length - 1) * PART_GAP;
    this.camX = this.parts[this.parts.length - 1].worldX - Math.max(220, catSpan + 100);

    this.distance += this.speed;

    if (this._checkCollision()) {
      this.state = 'gameover';
      return;
    }

    if (this.distance >= this.stageLen) {
      this.state = 'clear';
      return;
    }

    // Cull obstacles that are well past the camera
    this.obstacles = this.obstacles.filter(o => o.x + o.w > this.camX - 200);
  }

  // ----------------------------------------------------------
  _draw() {
    const ctx = this.ctx;
    // alpha:false + 背景が全面を覆うため clearRect は不要
    drawBackground(ctx, this.camX);
    drawGround(ctx, this.camX);

    // Obstacles
    this.obstacles.forEach(o => drawObstacle(ctx, o, this.camX));

    // スプラインベースでねこ全身を描画
    drawCatBody(ctx, this.parts, this.camX);

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

    // Auto-play indicator
    if (this.autoPlay) {
      ctx.save();
      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('AUTO', CANVAS_W - 14, 14);
      ctx.restore();
    }

    // Validation result display
    if (this.validationResult) {
      ctx.save();
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      let vy = 32;
      for (let i = 0; i < this.validationResult.length; i++) {
        const r = this.validationResult[i];
        ctx.fillStyle = r.beatable ? '#22c55e' : '#ef4444';
        const label = r.beatable
          ? `Stage ${i + 1}: ✓`
          : `Stage ${i + 1}: ✗`;
        ctx.fillText(label, CANVAS_W - 14, vy);
        vy += 16;
      }
      ctx.restore();
    }

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
      sub   = t('gameOverSub');
    } else if (this.state === 'clear') {
      const next = this.stageIdx + 1;
      if (next < STAGES.length) {
        title = t('stageClear', { stage: this.stageIdx + 1 });
        sub   = t('stageClearSub', { parts: STAGES[next].numParts });
      } else {
        title = t('allClear');
        sub   = t('allClearSub');
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
  _loop(now) {
    requestAnimationFrame(t => this._loop(t));

    // Throttle to ~30fps on mobile to reduce GPU/CPU load
    if (this._isMobile) {
      if (!this._lastFrame) this._lastFrame = 0;
      if (now - this._lastFrame < 30) return; // ~33ms = 30fps
      this._lastFrame = now;
    }

    this._update();
    this._draw();
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

  // PART_W/PART_H 確定後にフェザリングスプライトを生成
  createFeatheredBodySprite();

  new Game();

}

window.addEventListener('load', main);
