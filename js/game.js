// JOHNNY! TAKES SAN FRANCISCO

// Capture the return value: K.audioCtx is the ONLY handle to the AudioContext,
// and kaplay never resumes it on user input, so audio.js has to do it.
const K = kaplay({
  canvas: document.getElementById("game-canvas"),
  width: 800, height: 500,
  background: [26,26,26],
  pixelDensity: Math.min(2, window.devicePixelRatio || 1),
});

initAudio(K);   // registers every SFX, installs the autoplay unlock + mute key

const GAME_W=800, GAME_H=500;
const C_TEXT=[240,230,211], C_ACCENT=[201,168,76], C_MUTED=[138,122,106], C_SURFACE=[42,42,42];

// Kaplay throws "Font not found" unless document.fonts.check() accepts the family,
// so fall back to its built-in default rather than taking the whole game down.
const FONT = (() => {
  const want = "'Courier New', monospace";
  try { return document.fonts.check(`64px ${want}`) ? want : "monospace"; }
  catch { return "monospace"; }
})();

const PLAYER_W=40, PLAYER_H=80, GROUND_H=48, GRAVITY=1800, PLAYER_MAX_HP=100;
const FLOOR_W=80, FLOOR_H=36, BLDG_GAP=12, BLOCK_HP=60, PUNCH_REACH=60, PUNCH_COOLDOWN=0.25;
const DMG_COOLDOWN=0.5, SCORE_PER_BLOCK=100, SCORE_PER_PERSON=150, WIN_THRESHOLD=0.80;
const SPX = 2;                          // 1 art pixel = 2x2 screen pixels
const GW=FLOOR_W/SPX, GH=FLOOR_H/SPX;   // floor art grid: 40 x 18

// Character sheet. The body art is 20x40, but the punch throws a fist ~10px past
// the body, so the frame is 40 wide with the body inset by CHAR_OFF. (The old
// 20-wide frame clipped the entire extended arm off the sheet.)
const CHAR_GW=40, CHAR_GH=40, CHAR_OFF=10, CHAR_FRAMES=5;

// Backdrop. Drawn in a 420x236 logical space, then bled by SKY_PAD on every side
// so a screen shake can never drag an edge into view. SKY_OFF is chosen so that
// logical (x,y) still lands at screen (2x-20, 2y-20) exactly as before.
const SKY_LW=420, HORIZON=236;          // logical width, and the row where the street begins
const SKY_PAD=20;
const SKY_GW=SKY_LW+SKY_PAD*2, SKY_GH=HORIZON+SKY_PAD*2;
const SKY_OFF=-(SKY_PAD*SPX)-20;        // -60
const FOG_GW=440, FOG_GH=30;

const LIT_CHANCE=0.35, MAX_PEOPLE=5, MAX_FX=48;

// Draw layers. Negative z works: kaplay sorts children by layerIndex then (z ?? 0).
const Z_SKY=-20, Z_SKYLINE=-10, Z_BEACON=-9, Z_FOG=-8;
const Z_BLOCK=0, Z_WINLIT=2, Z_PERSON=3, Z_FOG_FRONT=5, Z_ENEMY=6, Z_PLAYER=10, Z_PROJ=12, Z_HUD=20, Z_OVERLAY=30;

const CHARACTERS = [
  { id:"johnny", name:"JOHNNY TL",      role:"Bass / Vocals",    speed:160, punch:20, jumpForce:520, tagline:"Balanced. The wall of sound." },
  { id:"evan",   name:"SHREDDIN' EVAN", role:"Guitars / Vocals", speed:120, punch:35, jumpForce:420, tagline:"Slow but hits like a freight train." },
  { id:"petey",  name:"PETEY",          role:"Drums",            speed:220, punch:12, jumpForce:640, tagline:"Fastest feet in the Bay Area." },
];
const STAT_MAX = { speed:260, punch:40, jumpForce:700 };

// ============================================================
// FACADES — the single source of truth for window geometry.
// Lit-window overlays and window-people are positioned from these exact rects,
// and the floor draw functions read the same list, so they can never drift.
// Fire escapes live in a vertical gutter that no window occupies.
// ============================================================
const FACADES = {
  mission: [
    { id:"mission_fe",  fe:true,  windows:[[3,4,6,9],[12,4,6,9],[21,4,6,9]] },              // escape in gutter x28-39
    { id:"mission_pln", fe:false, windows:[[3,4,6,9],[12,4,6,9],[21,4,6,9],[30,4,6,9]] },
  ],
  haight: [
    // Victorians have no front fire escape — the bay window owns the middle.
    { id:"haight_bay",  bay:true,  windows:[[12,5,5,9],[18,5,5,9],[24,5,5,9],[4,6,3,7],[34,6,3,7]] },
    { id:"haight_flat", bay:false, windows:[[4,5,6,9],[13,5,6,9],[22,5,6,9],[31,5,6,9]] },
  ],
  tenderloin: [
    { id:"tl_fe",  fe:true,  windows:[[4,4,3,9],[11,4,3,9],[18,4,3,9],[25,4,3,9]] },        // ladder cage x30-35
    { id:"tl_pln", fe:false, windows:[[3,4,3,9],[9,4,3,9],[15,4,3,9],[21,4,3,9],[27,4,3,9]] },
  ],
};

const LEVELS = [
  { name:"MISSION DISTRICT", subtitle:"The taquerias won't save you now.",
    skyColor:[24,16,12], skyline:"sky_mission", fog:false,
    beacons:[[474,48]],                             // Sutro Tower needle light (left mast, art x=247)
    facades:"mission", variantMask:[0,1,0,1,0,0,1],
    stores:["store_taqueria","store_laundromat"],
    buildingColors:[[198,142,96],[210,168,120],[186,126,84],[204,150,104],[214,178,132],[190,136,90],[206,158,112]],
    buildingHeights:[4,6,3,5,4,6,3],
    spawnRoster:[{ type:"hipster", maxCount:3, interval:5.5, firstSpawn:3, speedMult:1.0 }] },

  { name:"HAIGHT-ASHBURY", subtitle:"Peace was never an option.",
    skyColor:[18,14,26], skyline:"sky_haight", fog:true,
    beacons:[],
    facades:"haight", variantMask:[0,1,0,0,1,0,1],
    stores:["store_vintage","store_thrift"],
    buildingColors:[[96,160,152],[168,116,178],[128,174,114],[178,148,96],[108,134,186],[178,108,128],[136,178,120]],
    buildingHeights:[5,7,4,6,5,7,4],
    spawnRoster:[{ type:"hippie", maxCount:5, interval:4, firstSpawn:2.5, speedMult:1.1 }] },

  { name:"TENDERLOIN", subtitle:"Nobody's coming to help you.",
    skyColor:[18,16,10], skyline:"sky_tenderloin", fog:false,
    beacons:[[108,72],[520,212],[700,212]],         // pyramid spire + both bridge towers
    facades:"tenderloin", variantMask:[0,0,1,0,1,0,0],
    stores:["store_smoke","store_tobacco"],
    buildingColors:[[128,112,96],[112,100,86],[120,106,90],[104,94,80],[124,110,94],[114,102,88],[118,104,88]],
    buildingHeights:[6,8,5,7,6,8,5],
    spawnRoster:[
      { type:"crackhead", maxCount:4, interval:4,   firstSpawn:2,   speedMult:1.0 },
      { type:"rat",       maxCount:6, interval:2.6, firstSpawn:1.5, speedMult:1.0, batchSize:2 },
    ] },
];

const ENEMY_DEFS = {
  hipster:   { w:28, h:60, maxHp:2, score:250, baseSpeed:50,  touchDamage:8, frames:3, animRate:7,
               projectile:"burrito", throwInterval:4.0, projDamage:9,  projVY:-215, projSpeedMin:80,  projSpeedMax:180, projOffsetY:14 },
  hippie:    { w:28, h:60, maxHp:2, score:250, baseSpeed:45,  touchDamage:8, frames:3, animRate:7,
               projectile:"flower",  throwInterval:4.5, projDamage:8,  projVY:-220, projSpeedMin:80,  projSpeedMax:180, projOffsetY:14 },
  crackhead: { w:28, h:48, maxHp:2, score:200, baseSpeed:80,  touchDamage:6, frames:3, animRate:8,
               projectile:"syringe", throwInterval:3.2, projDamage:10, projVY:-90,  projSpeedMin:150, projSpeedMax:270, projOffsetY:12 },
  // crossing:true -> runs straight across on a fixed heading, never tracks the player.
  rat:       { w:28, h:16, maxHp:1, score:75,  baseSpeed:210, touchDamage:5, frames:2, animRate:16, crossing:true },
};

const PROJ = {
  flower:  { hw:4, hh:4, spin:280,  grav:0.35 },
  burrito: { hw:6, hh:4, spin:-340, grav:0.40 },
  syringe: { hw:8, hh:4, spin:0,    grav:0.18 },
};

// ============================================================
// PIXEL ART HELPERS
// ============================================================
function genCanvas(gw, gh, frames, drawFn) {
  const c = document.createElement('canvas');
  c.width = gw * SPX * frames; c.height = gh * SPX;
  const ctx = c.getContext('2d');
  for (let f = 0; f < frames; f++) drawFn(ctx, f * gw, f);
  return c.toDataURL();
}

function mkR(ctx, xOff) {
  return (x,y,w,h,col) => { ctx.fillStyle=col; ctx.fillRect((xOff+x)*SPX,y*SPX,w*SPX,h*SPX); };
}

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const mix = (a,b,t) => Math.round(a + (b-a)*t);
const hex = (r,g,b) => '#' + [r,g,b].map(v => Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join('');

// ── Tiny 3x5 signage font ───────────────────────────────────
const GLYPHS = {
  A:["010","101","111","101","101"], B:["110","101","110","101","110"],
  C:["011","100","100","100","011"], D:["110","101","101","101","110"],
  E:["111","100","110","100","111"], F:["111","100","110","100","100"],
  G:["011","100","101","101","011"], H:["101","101","111","101","101"],
  I:["111","010","010","010","111"], J:["001","001","001","101","010"],
  K:["101","101","110","101","101"], L:["100","100","100","100","111"],
  M:["1001","1111","1111","1001","1001"], N:["101","111","111","101","101"],
  O:["010","101","101","101","010"], P:["110","101","110","100","100"],
  Q:["010","101","101","110","011"], R:["110","101","110","101","101"],
  S:["011","100","010","001","110"], T:["111","010","010","010","010"],
  U:["101","101","101","101","111"], V:["101","101","101","101","010"],
  W:["1001","1001","1111","1111","0110"], X:["101","101","010","101","101"],
  Y:["101","101","010","010","010"], Z:["111","001","010","100","111"],
  "'":["010","010","000","000","000"], " ":["00","00","00","00","00"],
};
function textW(s){
  let w = 0;
  for (const ch of s) w += (GLYPHS[ch] ? GLYPHS[ch][0].length : 3) + 1;
  return w - 1;
}
function drawText3(r, s, x, y, col){
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch];
    if (!g) { cx += 4; continue; }
    for (let ry=0; ry<5; ry++)
      for (let rx=0; rx<g[ry].length; rx++)
        if (g[ry][rx] === "1") r(cx+rx, y+ry, 1, 1, col);
    cx += g[0].length + 1;
  }
}
function centerText3(r, s, y, col){
  drawText3(r, s, Math.max(0, Math.round((GW - textW(s)) / 2)), y, col);
}

// ============================================================
// BUILDING DAMAGE OVERLAY (frame 0 intact, 1 cracked, 2 gutted)
// ============================================================
function damage(r, f, seed){
  if (!f) return;
  const rnd = rngFrom(seed);
  const cracks = f === 1 ? 4 : 7;
  for (let i=0; i<cracks; i++) {
    let x = 1 + Math.floor(rnd() * (GW-2));
    let y = 1 + Math.floor(rnd() * 3);
    const len = 4 + Math.floor(rnd() * (GH-6));
    for (let j=0; j<len; j++) {
      r(x, y, 1, 1, '#2A2018');
      if (rnd() < 0.35) r(x+1, y, 1, 1, '#4A4038');
      if (++y >= GH-1) break;
      if (rnd() < 0.4) x += rnd() < 0.5 ? -1 : 1;
      x = Math.max(1, Math.min(GW-2, x));
    }
  }
  if (f === 2) {
    for (let i=0; i<3; i++) {
      const hx = 3 + Math.floor(rnd() * (GW-9));
      const hy = 3 + Math.floor(rnd() * (GH-9));
      r(hx,   hy-1, 5, 1, '#C8541C');
      r(hx,   hy,   5, 4, '#171214');
      r(hx+1, hy+1, 3, 2, '#0C0A0C');
      r(hx+1, hy+4, 3, 1, '#8A3A14');
      r(hx+2, hy,   1, 1, '#E89828');
    }
    r(0, GH-1, GW, 1, '#241C18');
  }
}

// ============================================================
// APARTMENT FLOORS (near-white; tinted per building at runtime)
// ============================================================
function sashWindow(r, x, y, w, h, trim, glass, hi, mull, sill){
  r(x-1, y-1, w+2, h+2, trim);
  r(x,   y,   w,   h,   glass);
  r(x,   y,   w,   2,   hi);
  if (w >= 5) {
    r(x + (w>>1), y, 1, h, mull);
    r(x, y + (h>>1), w, 1, mull);
  }
  r(x-1, y+h+1, w+2, 1, sill);
}

function drainpipe(r, x){
  r(x,0,1,GH,'#C4C0BA');
  for (let y=2;y<GH-1;y+=6) r(x-1,y,3,1,'#A8A49E');
}

function missionFE(r){
  r(29,0,1,GH,'#5E5A56'); r(38,0,1,GH,'#5E5A56');      // continuous side rails
  for (let y=1;y<GH-1;y+=2) r(30,y,8,1,'#6A6664');     // ladder rungs
  for (let x=29;x<39;x+=2) r(x,11,1,2,'#605C5A');      // balusters
  r(28,13,12,1,'#55514E'); r(28,14,12,1,'#454140');    // platform
}

function missionFloor(r, v, top){
  r(0,0,GW,GH,'#FAF8F4');
  r(0,0,1,GH,'#D6D2CC'); r(GW-1,0,1,GH,'#C8C4BE');
  for (let i=0;i<16;i++) r((i*7+3)%(GW-2)+1, (i*5+2)%9+4, 1, 1, '#EFEBE5');   // stucco speckle

  if (top) { r(0,0,GW,3,'#EDE9E3'); r(0,0,GW,1,'#8E8A84'); r(1,1,GW-2,1,'#FFFDF8'); r(0,2,GW,1,'#B0ACA6'); }
  else     { r(0,0,GW,1,'#B8B4AE'); }

  v.windows.forEach(([x,y,w,h]) => sashWindow(r,x,y,w,h,'#E6E2DA','#2A2C34','#3E4450','#4A4C54','#D0CCC4'));

  if (v.fe) missionFE(r); else drainpipe(r,38);
  r(0,GH-1,GW,1,'#9E9A94');
}

function haightFloor(r, v, top){
  r(0,0,GW,GH,'#FBF9F5');
  r(0,0,1,GH,'#DAD6CE'); r(GW-1,0,1,GH,'#CCC8C0');

  if (top) {
    r(0,0,GW,4,'#EFEBE3'); r(0,0,GW,1,'#8A8680');
    for (let x=1;x<GW-1;x+=2) r(x,1,1,2,'#BEB9B0');
    r(0,3,GW,1,'#A8A49E');
  } else {
    r(0,0,GW,1,'#A8A49E');
    r(0,1,GW,2,'#E4E0D8');
    for (let x=1;x<GW-1;x+=3) r(x,1,1,2,'#BEB9B0');
  }

  if (v.bay) {
    r(11,4,18,12,'#FFFFFF');
    r(10,4,1,12,'#DAD6CE'); r(29,4,1,12,'#CFCBC3');
    v.windows.slice(0,3).forEach(([x,y,w,h]) => {
      r(x,y,w,h,'#2A2E38'); r(x,y,w,2,'#3E4652'); r(x+2,y,1,h,'#4A4E58');
    });
    r(11,16,18,1,'#C8C4BC');
    [13,19,25].forEach(x => r(x,15,2,2,'#D6D2CA'));                 // brackets
    v.windows.slice(3).forEach(([x,y,w,h]) => {
      r(x-1,y-1,w+2,h+2,'#E6E2DA');
      r(x,y,w,h,'#2A2E38'); r(x,y,w,2,'#3E4652');
      r(x-1,y+h+1,w+2,1,'#CFCBC3');
    });
  } else {
    r(0,3,GW,1,'#DCD8D0');
    v.windows.forEach(([x,y,w,h]) => {
      r(x-2,y-3,w+4,1,'#D2CEC6');                                   // pediment shelf
      r(x-1,y-2,w+2,1,'#EEEAE2');
      sashWindow(r,x,y,w,h,'#E6E2DA','#2A2E38','#3E4652','#4A4E58','#CFCBC3');
    });
    r(2,16,GW-4,1,'#C8C4BC');
  }
  r(0,GH-1,GW,1,'#9A968E');
}

function tenderloinFloor(r, v, top){
  r(0,0,GW,GH,'#F4F1EC');
  r(0,0,1,GH,'#CFCBC5'); r(GW-1,0,1,GH,'#C2BEB8');
  [2,7,15,22,29,36].forEach(x => r(x,1,1,GH-2,'#B6AFA6'));         // grime streaks

  if (top) { r(0,0,GW,3,'#E8E4DE'); r(0,0,GW,1,'#78746E'); r(0,2,GW,1,'#A6A29C'); }
  else     { r(0,0,GW,1,'#8A8680'); r(0,1,GW,1,'#C4C0BA'); }

  v.windows.forEach(([x,y,w,h]) => {
    r(x-1,y-1,w+2,h+2,'#D8D4CE');
    r(x,y,w,h,'#20242A');
    r(x,y,w,2,'#333A44');
  });

  if (v.fe) {
    r(30,0,1,GH,'#5A5654'); r(35,0,1,GH,'#5A5654');
    for (let y=1;y<GH-1;y+=2) r(31,y,4,1,'#6A6664');
    for (let x=2;x<29;x+=3) r(x,14,1,2,'#605C5A');
    r(1,15,29,1,'#55514E'); r(1,16,29,1,'#454140');
  } else {
    r(32,4,6,9,'#C0B8AE');                                          // bricked-up window
    for (let y=5;y<13;y+=2) r(32,y,6,1,'#A69E94');
    r(33,4,1,9,'#A69E94');
    drainpipe(r,30);
    [11,25].forEach(x => r(x,13,1,4,'#C6BFB6'));                    // extra grime
  }
  r(0,GH-1,GW,1,'#8E8A84');
}

const FLOOR_DRAW = { mission:missionFloor, haight:haightFloor, tenderloin:tenderloinFloor };

// ============================================================
// STOREFRONTS (ground floor; drawn in final colors, not tinted)
// ============================================================
function shell(r, wall, cornice, edge){
  r(0,0,GW,GH,wall);
  r(0,0,GW,1,cornice);
  r(0,0,1,GH,edge); r(GW-1,0,1,GH,edge);
  r(0,GH-1,GW,1,'#14100E');
}
function signBand(r, panel, border, txt, txtCol){
  r(0,1,GW,7,panel);
  r(0,1,GW,1,border);
  r(0,7,GW,1,border);
  centerText3(r, txt, 2, txtCol);
}
function awning(r, cols){
  for (let x=0;x<GW;x++) r(x,8,1,2,cols[Math.floor(x/3)%cols.length]);
  for (let x=0;x<GW;x++) r(x,10,1,1, x%4<2 ? cols[Math.floor(x/3)%cols.length] : '#1E1814');
}
function shopFrame(r, frame, door, doorGlass){
  r(0,11,GW,6,frame);
  r(26,11,11,6,door);
  r(28,12,7,3,doorGlass);
  r(35,14,1,1,'#D8C060');
}
function drawTaqueria(r){
  shell(r,'#C98A5C','#A9704A','#B07A50');
  signBand(r,'#8C1F28','#5E1018','TAQUERIA','#F2E2C4');
  awning(r,['#C8202C','#E8E0D0','#1E7A44']);
  shopFrame(r,'#3A2A1E','#5A3A22','#E8C070');
  r(2,11,21,5,'#F0C468');
  r(2,14,21,2,'#7A4A2A');
  r(5,12,3,3,'#3A2418'); r(12,12,3,3,'#3A2418'); r(18,12,2,3,'#3A2418');
  r(2,16,21,1,'#241810');
}
function drawLaundromat(r){
  shell(r,'#B8B0A0','#948C7E','#A39B8C');
  signBand(r,'#1E4E8C','#123058','LAVANDERIA','#EAF2FA');
  awning(r,['#2A5FA0','#2A5FA0','#E8E8E0']);
  shopFrame(r,'#2E3844','#3C4A58','#A8CBD8');
  r(2,11,21,5,'#A9CFDA');
  for (let i=0;i<3;i++) {
    const x = 3 + i*7;
    r(x,12,6,4,'#EEF2F4'); r(x+1,13,4,2,'#3E4E58'); r(x+2,13,2,2,'#7FA3B0');
  }
  r(2,16,21,1,'#1E2830');
}
function drawVintage(r){
  shell(r,'#D8C8B0','#B0A088','#C0B098');
  signBand(r,'#4A2A6A','#2C1642','VINTAGE','#F0D8A0');
  awning(r,['#C83030','#E08828','#E8D040','#40A050','#3060C0','#7040A0']);
  shopFrame(r,'#4A3828','#6A4A30','#D8C8A8');
  r(2,11,21,5,'#CBD8D2');
  r(2,12,21,1,'#7A6A50');
  [[4,'#C84070'],[9,'#3A6AA0'],[14,'#D8A030'],[19,'#4AA070']].forEach(([x,c]) => {
    r(x+1,12,1,1,'#8A7A60'); r(x,13,3,3,c);
  });
  r(2,16,21,1,'#2E2418');
}
function drawThrift(r){
  shell(r,'#C0C8B8','#98A090','#A8B0A0');
  signBand(r,'#2A6A5A','#164038','THRIFT','#F0E0B0');
  awning(r,['#2A6A5A','#E8E0C8']);
  shopFrame(r,'#38402E','#4E5840','#C8D0B8');
  r(2,11,21,5,'#C8D0C4');
  [[3,'#C05038'],[10,'#3E8A6A'],[17,'#D0A83C']].forEach(([x,c]) => { r(x,13,5,3,c); r(x,12,5,1,'#8A8A78'); });
  r(2,16,21,1,'#242A1E');
}
function neonSign(r, txt, col, glow){
  r(0,1,GW,7,'#141414');
  r(0,1,GW,1,glow); r(0,7,GW,1,glow);
  centerText3(r, txt, 2, col);
}
function securityGate(r){
  r(0,8,GW,2,'#2C2C2C');
  for (let x=0;x<GW;x+=2) r(x,8,1,2,'#3E3E3E');
  r(0,10,GW,1,'#1A1A1A');
}
function drawSmoke(r){
  shell(r,'#6E665C','#4A443C','#5A544C');
  neonSign(r,'SMOKE SHOP','#40E8E0','#E23C90');
  securityGate(r);
  shopFrame(r,'#2A2622','#2E2A28','#1E2A28');
  r(2,11,21,5,'#1B2422');
  for (let x=3;x<23;x+=3) r(x,11,1,5,'#3E3E3E');
  r(4,12,6,2,'#E23C90');  r(5,13,4,1,'#FF8CC8');
  r(14,12,6,2,'#38D06A'); r(15,13,4,1,'#96F0B4');
  r(28,13,7,1,'#C8407A'); r(29,12,1,1,'#C8407A'); r(33,14,1,1,'#C8407A');
  r(2,16,21,1,'#141816');
}
function drawTobacco(r){
  shell(r,'#5E5850','#3E3A34','#4C4842');
  neonSign(r,'TOBACCO','#F050A0','#40E8E0');
  securityGate(r);
  shopFrame(r,'#26241F','#2A2824','#1A2220');
  r(2,11,21,5,'#182220');
  for (let x=3;x<23;x+=3) r(x,11,1,5,'#3A3A3A');
  r(5,12,5,2,'#E8B830');  r(6,13,3,1,'#FFE890');
  r(15,12,5,2,'#40C8E8'); r(16,13,3,1,'#A0E8F8');
  r(29,12,1,3,'#7ACF5A'); r(30,13,4,1,'#7ACF5A');
  r(2,16,21,1,'#12100E');
}

// ============================================================
// LIT WINDOWS + WINDOW PEOPLE
// These are drawn UNTINTED on top of the block, because kaplay multiplies a
// sprite by its color() — an amber glow baked into a teal Victorian would come
// out muddy dark teal.
// ============================================================
function drawWinlit(gw, gh){
  return (ctx, xOff, f) => {
    const r = mkR(ctx, xOff);
    const warm = f === 0;
    const base = warm ? '#F0C060' : '#7FA8D8';       // lamp vs television
    const brite = warm ? '#FFE9A8' : '#C4DCF4';
    const dim   = warm ? '#B8842C' : '#4E6E9C';
    r(0,0,gw,gh,base);
    r(0,0,gw,1,brite);
    r(0,gh-1,gw,1,dim);
    if (gw >= 4) { r(0,0,1,gh,dim); r(gw-1,0,1,gh,dim); }   // curtain edges
    if (gw >= 5) r(gw>>1,0,1,gh,'#8A6018');
    if (gh >= 8) r(0,gh>>1,gw,1,'#8A6018');
  };
}

function drawPerson(shirt){
  return (ctx, xOff, f) => {
    const r = mkR(ctx, xOff);
    const SKIN='#D8A878', HAIR='#3A2A1A', EYE='#2A1A12';
    if (f === 0) {                                   // peek over the sill
      r(1,2,3,2,HAIR);
      r(1,3,3,2,SKIN);
      r(1,4,1,1,EYE); r(3,4,1,1,EYE);
      r(1,5,3,3,shirt);
      r(0,6,1,2,SKIN); r(4,6,1,2,SKIN);              // hands on the sill
    } else if (f === 1) {                            // lean out and wave
      r(1,1,3,2,HAIR);
      r(1,2,3,2,SKIN);
      r(1,3,1,1,EYE); r(3,3,1,1,EYE);
      r(2,4,1,1,'#8A4038');
      r(1,4,3,4,shirt);
      r(0,5,1,3,SKIN);
      r(4,1,1,4,SKIN); r(4,0,1,1,SKIN);
    } else {                                         // panic
      r(1,2,3,2,HAIR);
      r(1,3,3,2,SKIN);
      r(1,4,1,1,EYE); r(3,4,1,1,EYE);
      r(2,5,1,1,'#7A2A22');
      r(1,5,3,3,shirt);
      r(0,0,1,5,SKIN); r(4,0,1,5,SKIN);              // both arms up
    }
  };
}

// ── IMPACT BURST ── grid 12x12 -> 24x24 ───────────────────
function drawImpact(ctx, xOff, f){
  const r = mkR(ctx, xOff);
  const c = 6;
  const rays = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  const len  = f === 0 ? 2 : f === 1 ? 5 : 6;
  const hot  = f === 2 ? '#C87830' : '#FFFFFF';
  const cool = f === 2 ? '#8A4A18' : '#F0C060';
  if (f < 2) r(c-1,c-1,2,2,hot);
  rays.forEach(([dx,dy], i) => {
    const L = len - (i >= 4 ? 1 : 0);
    for (let k = f===2?3:1; k <= L; k++) {
      const x = c + dx*k, y = c + dy*k;
      if (x < 0 || y < 0 || x >= 12 || y >= 12) continue;
      r(x, y, 1, 1, k <= 1 ? hot : cool);
    }
  });
}

// ============================================================
// SKYLINES — one 840x492 backdrop per level, drawn at (-20,-20)
// so a screen shake can never expose the canvas clear color.
// ============================================================
// Every sky draw uses this: logical coords, bled by SKY_PAD into the sprite.
function skyR(ctx, xOff){
  const base = mkR(ctx, xOff);
  return (x,y,w,h,c) => base(x+SKY_PAD, y+SKY_PAD, w, h, c);
}
function skyGradient(r, top, bot){
  for (let y = -SKY_PAD; y < HORIZON; y++) {
    const t = Math.max(0, y) / HORIZON;
    r(-SKY_PAD, y, SKY_LW+SKY_PAD*2, 1, hex(mix(top[0],bot[0],t), mix(top[1],bot[1],t), mix(top[2],bot[2],t)));
  }
}
function street(r){ r(-SKY_PAD, HORIZON, SKY_LW+SKY_PAD*2, SKY_PAD*2, hex(...C_SURFACE)); }

function stars(r, rnd, n, maxY, col){
  for (let i=0;i<n;i++) {
    const x = Math.floor(rnd()*SKY_LW), y = Math.floor(rnd()*maxY);
    r(x, y, 1, 1, rnd() < 0.25 ? '#FFFFFF' : col);
  }
}
// Upper half-disc — the building block for cloud puffs.
function puff(r, cx, cy, rad, col){
  for (let y=-rad; y<=0; y++) {
    const half = Math.round(Math.sqrt(rad*rad - y*y));
    if (half > 0) r(cx-half, cy+y, half*2, 1, col);
  }
}
function cloud(r, cx, base, w, col, colB){
  [[-0.36,0,0.30],[0.02,-4,0.36],[0.34,-1,0.27],[0.14,-7,0.20],[-0.18,-4,0.24]]
    .forEach(([dx,dy,rr]) => puff(r, Math.round(cx+dx*w), base+dy, Math.round(rr*w), col));
  r(Math.round(cx-w*0.42), base, Math.round(w*0.84), 3, colB);
}
// Dome with straight sides down to the base — a tree in silhouette.
function canopy(r, cx, base, rw, rh, col){
  const cy = base - Math.round(rh*0.55), ry = Math.round(rh*0.55);
  for (let y = cy-ry; y <= base; y++) {
    let half;
    if (y <= cy) { const t = (cy-y)/ry; half = Math.round(rw*Math.sqrt(Math.max(0,1-t*t))); }
    else half = rw;
    if (half > 0) r(cx-half, y, half*2, 1, col);
  }
}

// Parabolic hill: y = peakY + (dx/halfW)^2 * (base - peakY)
function hill(r, cx, peakY, halfW, base, col, lightCol, rnd){
  for (let x = Math.max(0,cx-halfW); x < Math.min(SKY_LW,cx+halfW); x++) {
    const t = (x - cx) / halfW;
    const y = Math.round(peakY + t*t*(base - peakY));
    r(x, y, 1, base - y, col);
    if (lightCol && rnd() < 0.06 && y < base - 6) r(x, y + 4 + Math.floor(rnd()*(base-y-6)), 1, 1, lightCol);
  }
}
function rooftops(r, rnd, y0, y1, col, litCol){
  let x = 0;
  while (x < SKY_LW) {
    const w = 8 + Math.floor(rnd()*16);
    const h = 4 + Math.floor(rnd()*(y1-y0-4));
    r(x, y1-h, w, h, col);
    for (let wy = y1-h+2; wy < y1-1; wy += 3)
      for (let wx = x+1; wx < x+w-1; wx += 3)
        if (rnd() < 0.30) r(wx, wy, 1, 1, litCol);
    x += w + 1;
  }
}

function drawSkyMission(ctx, xOff, f){
  const r = skyR(ctx, xOff);
  const rnd = rngFrom(991);
  skyGradient(r, [20,13,10], [96,48,28]);
  stars(r, rnd, 90, 120, '#C8BCA8');
  hill(r, 150, 152, 100, HORIZON, '#241A16', '#E8B84C', rnd);   // Twin Peak (near)
  hill(r, 255, 138, 110, HORIZON, '#2E211B', '#E8B84C', rnd);   // Twin Peak (far)

  // ── Sutro Tower ──────────────────────────────────────────
  // The silhouette is an hourglass: the outer legs lean IN from the deck down to
  // a pinched waist, then splay back OUT to a wide base. Three masts stand on a
  // latticed deck, the left one carrying a long needle.
  const tx = 255, BASE = 142, DECK = 80, WAIST = 108;
  const STEEL = '#4A3C36', STEEL_HI = '#5E4E46', DARK = '#2A211C';

  const legHalf = (y) => y <= WAIST
    ? 14 - (y - DECK) * (14 - 5) / (WAIST - DECK)      // deck -> waist: converge
    : 5  + (y - WAIST) * (17 - 5) / (BASE - WAIST);    // waist -> base: splay

  for (let y = DECK; y <= BASE; y++) {
    const h = Math.round(legHalf(y));
    r(tx - h - 1, y, 2, 1, STEEL);                     // outer legs
    r(tx + h,     y, 2, 1, STEEL);
    r(tx - 1,     y, 2, 1, STEEL_HI);                  // centre leg, straight down
  }
  [88, 100, 116, 128, 137].forEach(y => {              // cross braces
    const h = Math.round(legHalf(y));
    r(tx - h, y, h*2 + 1, 1, DARK);
  });
  r(tx - 19, BASE, 39, 2, DARK);                       // footing

  // Main deck: top chord, bottom chord, zig-zag web between, overhanging lip
  r(tx - 17, 76, 35, 1, STEEL);
  r(tx - 17, 79, 35, 1, STEEL);
  for (let i = 0; i < 34; i++) r(tx - 17 + i, i % 2 ? 77 : 78, 1, 1, STEEL_HI);
  r(tx - 18, 80, 37, 1, DARK);
  // Secondary deck
  r(tx - 10, 100, 21, 1, STEEL);
  r(tx - 10, 103, 21, 1, STEEL);
  for (let i = 0; i < 20; i++) r(tx - 10 + i, i % 2 ? 101 : 102, 1, 1, STEEL_HI);

  // Three masts on the deck. Aviation banding, muted so a distant tower doesn't
  // read as candy stripes; the left mast carries a fine needle.
  [[-8, 50], [-1, 44], [6, 44]].forEach(([dx, top], k) => {
    for (let y = 76; y >= top; y--) {
      const band = Math.floor((76 - y) / 5) % 2;
      r(tx + dx, y, 2, 1, band ? '#9A9488' : '#7E3427');
    }
    if (k === 0) { r(tx + dx, 36, 1, 14, '#7E7870'); r(tx + dx, 34, 1, 2, '#9A9488'); }
  });

  rooftops(r, rnd, 214, HORIZON, '#171210', '#E8B84C');
  street(r);
}

function drawSkyHaight(ctx, xOff, f){
  const r = skyR(ctx, xOff);
  const rnd = rngFrom(773);
  skyGradient(r, [16,12,24], [78,62,102]);
  stars(r, rnd, 60, 100, '#C0B8D0');

  [[62,86,54],[150,72,68],[258,94,58],[368,80,58]].forEach(([cx,cy,w]) =>
    cloud(r, cx, cy, w, '#443A60', '#372F50'));

  puff(r, 308, 50, 8, '#E8E4D8'); r(300,50,16,4,'#E8E4D8');      // moon, clear of the clouds
  r(304,44,4,4,'#D0CCC0');

  // Golden Gate Park — a far, hazier row behind a near, darker one
  for (let x = -6; x < SKY_LW+10; x += 9)
    canopy(r, x + Math.floor(rnd()*6), HORIZON-4, 7+Math.floor(rnd()*7), 34+Math.floor(rnd()*22), '#22331F');
  for (let x = -6; x < SKY_LW+10; x += 11)
    canopy(r, x + Math.floor(rnd()*8), HORIZON, 8+Math.floor(rnd()*8), 26+Math.floor(rnd()*24), '#152318');

  // Dutch windmill (Golden Gate Park has two), standing clear of the treeline
  const mx = 78, mb = HORIZON - 6, hy = mb - 62;
  for (let y = mb; y > mb-58; y--) {
    const half = Math.round(10 - (mb - y) * 0.10);
    r(mx-half, y, half*2, 1, '#241F1B');
    if ((mb-y) % 9 === 0) r(mx-half, y, half*2, 1, '#332C26');
  }
  r(mx-9, hy-6, 18, 8, '#1B1714');                                // cap
  r(mx-10, hy-8, 20, 2, '#2A241F');
  [[1,-0.42],[0.42,1],[-1,0.42],[-0.42,-1]].forEach(([dx,dy]) => {   // four lattice sails
    for (let k=5; k<=30; k++) {
      const x = Math.round(mx + dx*k), y = Math.round(hy + dy*k);
      r(x, y, 2, 2, '#3E372E');
      if (k % 5 === 0) r(Math.round(x - dy*3), Math.round(y + dx*3), 2, 2, '#332C26');
    }
  });
  r(mx-2, hy-2, 4, 4, '#4A443C');
  street(r);
}

function drawSkyTenderloin(ctx, xOff, f){
  const r = skyR(ctx, xOff);
  const rnd = rngFrom(1487);
  skyGradient(r, [16,14,9], [70,60,42]);
  stars(r, rnd, 50, 90, '#B8B0A0');

  const WATER = 196;
  r(0, WATER, SKY_LW, HORIZON-WATER, '#151512');
  for (let i=0;i<70;i++) r(Math.floor(rnd()*SKY_LW), WATER+2+Math.floor(rnd()*(HORIZON-WATER-3)), 2+Math.floor(rnd()*4), 1, '#22211C');

  // Bay Bridge. The main cable hangs FROM the tower tops and sags to its lowest
  // point at midspan; side spans run down to the anchorages at deck level.
  const DECK = 178, T1 = 270, T2 = 360, TOP = 118, ANCHOR_L = 228, ANCHOR_R = SKY_LW-2;
  const SAG = 44;
  const cableY = (x) => {
    if (x <= T1) return Math.round(TOP + ((T1-x)/(T1-ANCHOR_L)) * (DECK-6-TOP));
    if (x >= T2) return Math.round(TOP + ((x-T2)/(ANCHOR_R-T2)) * (DECK-6-TOP));
    const t = (x - T1) / (T2 - T1);
    return Math.round(TOP + SAG * (1 - 4*(t-0.5)*(t-0.5)));       // lowest at midspan
  };
  for (let x = ANCHOR_L; x < SKY_LW; x++) {
    const cy = cableY(x);
    if (x % 6 === 0 && cy < DECK-2) r(x, cy, 1, DECK-cy, '#3A3730');   // hangers
    r(x, cy, 1, 2, '#5A564E');
  }
  r(230, DECK, SKY_LW-230, 3, '#3E3A34');
  r(230, DECK+3, SKY_LW-230, 1, '#2A2722');
  for (let x = 234; x < SKY_LW; x += 12) r(x, DECK+4, 2, WATER-DECK-4, '#2E2B26');
  [T1,T2].forEach(tx => {
    r(tx-5, TOP, 2, DECK-TOP+8, '#4A453E');
    r(tx+3, TOP, 2, DECK-TOP+8, '#4A453E');
    r(tx-5, TOP+6,  10, 2, '#4A453E');
    r(tx-5, TOP+30, 10, 2, '#4A453E');
    r(tx-6, TOP-2,  12, 2, '#57514A');
  });

  // Downtown cluster. Placed so the Pyramid (art x=64 -> screen x=108) rises over
  // the SHORT left-hand building rather than hiding behind the 8-floor tower.
  [[14,178,16],[96,152,22],[126,182,18],[158,160,24],[190,174,20],[210,188,14]].forEach(([x,top,w]) => {
    r(x, top, w, WATER-top, '#2A2724');
    r(x, top, w, 2, '#3C3834');
    r(x, top, 1, WATER-top, '#38342F');
    for (let wy = top+4; wy < WATER-3; wy += 4)
      for (let wx = x+2; wx < x+w-2; wx += 3)
        if (rnd() < 0.34) r(wx, wy, 1, 2, '#E8C878');
  });

  // ── Transamerica Pyramid ─────────────────────────────────
  // A long latticed spire, a hard shoulder where the occupied floors begin, a
  // straight taper of window rows, and the open triangular truss arcade at the base.
  const px = 64, SPIRE_TOP = 52, SHOULDER = 88, BODY_BASE = 176, PBASE = 190;
  const SKIN = '#2E2A28', EDGE = '#46413C', CAP = '#26221F';
  const skyAt = (y) => hex(mix(16,70,y/HORIZON), mix(14,60,y/HORIZON), mix(9,42,y/HORIZON));

  const spireHalf = (y) => (y - SPIRE_TOP) * 4.5 / (SHOULDER - SPIRE_TOP);
  for (let y = SPIRE_TOP; y < SHOULDER; y++) {
    const h = Math.round(spireHalf(y));
    r(px - h, y, 1, 1, EDGE); r(px + h, y, 1, 1, EDGE);          // spire legs
    if ((y - SPIRE_TOP) % 3 === 0 && h > 0) r(px - h, y, h*2 + 1, 1, EDGE);   // rungs
  }
  r(px, SPIRE_TOP-6, 1, 6, '#9A9088');                            // tip

  r(px - 8, SHOULDER, 17, 5, CAP);                                // shoulder

  const bodyHalf = (y) => 8 + (y - SHOULDER - 5) * 0.175;
  for (let y = SHOULDER + 5; y <= PBASE; y++) {
    const h = Math.round(bodyHalf(y));
    r(px - h, y, h*2 + 1, 1, SKIN);
    r(px + h, y, 1, 1, EDGE);
    if (y < BODY_BASE && (y - SHOULDER) % 4 === 0 && h > 3)
      for (let wx = px - h + 2; wx < px + h - 1; wx += 3)
        if (rnd() < 0.32) r(wx, y, 1, 1, '#E8C878');
  }

  // Wings: slim fins flush with the shaft, fading into the base.
  r(px - Math.round(bodyHalf(150)) - 2, 150, 2, PBASE-150, CAP);
  r(px + Math.round(bodyHalf(150)) + 1, 150, 2, PBASE-150, CAP);

  // Truss arcade: carve open triangles out of the base using the sky behind it.
  for (let i = 0; i < 5; i++) {
    const cx = px - 20 + i*10;
    for (let k = 1; k <= PBASE - BODY_BASE - 1; k++) {
      const w = Math.round(k * 0.42);
      r(cx - w, PBASE - k, w*2 + 1, 1, skyAt(PBASE - k));
    }
  }
  r(px - 27, PBASE, 55, 2, CAP);                                  // base slab
  r(0, 190, SKY_LW, 6, '#1B1A17');                                     // near shoreline
  street(r);
}

function drawFog(ctx, xOff, f){
  const r = mkR(ctx, xOff);
  const rnd = rngFrom(f === 0 ? 55 : 211);
  for (let i=0;i<90;i++) {
    const x = Math.floor(rnd()*FOG_GW), y = 3 + Math.floor(rnd()*(FOG_GH-8));
    r(x, y, 14 + Math.floor(rnd()*46), 3 + Math.floor(rnd()*7), 'rgba(216,222,234,0.11)');
  }
  r(0, FOG_GH/2 - 4, FOG_GW, 9, 'rgba(216,222,234,0.09)');
}

// ============================================================
// CHARACTER SPRITES  (body art 20x40, inset by CHAR_OFF in a 40-wide frame)
// Frames: 0 idle, 1 walkA, 2 walkB, 3 punch-extend, 4 punch-recover
// ============================================================
function drawJohnny(ctx, xOff, f) {
  const r = mkR(ctx, xOff + CHAR_OFF);
  const lean = f===3 ? 1 : 0;
  r(1,3,  4,13, '#BFA038');
  r(15,3, 4,11, '#BFA038');
  r(4,0, 12,5, '#D4B248');
  r(5,0, 10,2, '#E4C460');
  r(4+lean,3,  12,12, '#C8906A');
  r(5+lean,4,  10,3,  '#D49878');
  r(16+lean,5, 2,4,   '#C8906A');
  r(5+lean,7,  4,3, '#0C0C0C');
  r(11+lean,7, 4,3, '#0C0C0C');
  r(9+lean,8,  2,1, '#302828');
  r(9+lean,11, 2,2, '#A87050');
  r(6+lean,14, 8,2, '#904840');
  r(8,14, 4,4, '#C8906A');
  r(5,13, 5,7, '#B02030');
  r(10,14,5,8, '#802020');
  r(5,13, 5,2, '#D04040');
  r(2,17, 16,3, '#1C1814');
  r(2,20, 4,13, '#201C18');
  r(14,20,4,13, '#201C18');
  r(2,20, 2,13, '#141010');
  r(16,20,2,13, '#141010');
  r(6,17, 8,14, '#DCD8C8');
  r(9,19, 2,10, '#B4B0A0');
  r(9,17, 1,12, '#686460');

  if (f===3) {                                   // full extension
    r(0,22, 3,10, '#1C1814');                    // rear arm cocked back
    r(17,17, 3,4, '#1C1814');                    // shoulder
    r(19,18, 7,3, '#201C18');                    // arm
    r(22,17, 5,1, '#3A342C'); r(22,21,5,1,'#3A342C');   // motion smear
    r(25,16, 5,6, '#C8906A');                    // fist
    r(25,16, 5,1, '#E0A880');
    r(29,17, 1,4, '#8A6448');
  } else if (f===4) {                            // recover
    r(0,20, 3,12, '#1C1814');
    r(17,18, 3,4, '#1C1814');
    r(19,19, 4,3, '#201C18');
    r(22,18, 4,5, '#C8906A');
    r(22,18, 4,1, '#E0A880');
  } else {
    const la=f===1?15:f===2?21:18, ra=f===2?15:f===1?21:18;
    r(0,la, 3,12, '#1C1814');
    r(17,ra,3,12, '#1C1814');
  }

  r(2,31, 16,3, '#141010');
  r(9,31, 3,3,  '#302018');
  const [lx,rx,ly,ry]=f===1?[2,11,31,33]:f===2?[4,9,33,31]:f===3?[1,12,32,32]:[3,10,32,32];
  r(lx,ly,7,8,'#282848'); r(lx,ly,7,2,'#202040');
  r(rx,ry,7,8,'#282848'); r(rx,ry,7,2,'#202040');
  const lsx=lx+(f===1?-1:f===2?1:0), rsx=rx+(f===1?1:f===2?-1:0);
  r(lsx,38,9,2,'#100C08'); r(lsx+1,38,3,1,'#282018');
  r(rsx,38,9,2,'#100C08'); r(rsx+1,38,3,1,'#282018');
}

function drawEvan(ctx, xOff, f) {
  const r = mkR(ctx, xOff + CHAR_OFF);
  const lean = f===3 ? 1 : 0;
  r(3,0, 14,12,'#2C2010');
  r(1,6, 4,14, '#241A0C');
  r(15,6,4,12, '#241A0C');
  r(3,10,14,4, '#201808');
  r(4,1, 12,3, '#3C2C14');
  r(4+lean,10,12,12,'#C8906A');
  r(5+lean,11,10,3, '#D49878');
  r(4+lean,15, 6,5, '#C09828');
  r(11+lean,15,5,5, '#C09828');
  r(10+lean,17,2,2, '#907018');
  r(5+lean,15, 5,4, '#0A0A18');
  r(12+lean,15,4,4, '#0A0A18');
  r(5+lean,15, 5,1, '#2020A0');
  r(9+lean,21, 2,2, '#A87050');
  r(7+lean,23, 6,2, '#904840');
  r(8,22, 4,4, '#C8906A');
  r(2,19, 16,4, '#181414');
  r(2,23, 4,14, '#1A1616');
  r(14,23,4,14, '#1A1616');
  r(3,23, 2,14, '#0C0A0A');
  r(15,23,2,14, '#0C0A0A');
  r(6,21, 8,14, '#C8C4B0');
  r(9,23, 2,10, '#A8A498');
  r(3,25,2,2,'#AAAAAA'); r(3,29,2,2,'#AAAAAA'); r(15,25,2,2,'#AAAAAA');
  r(9,19,2,14,'#606060');

  if (f===3) {
    r(0,24,3,12,'#181414');
    r(17,19,3,4,'#181414');
    r(19,20,7,3,'#181414');
    r(22,19,5,1,'#3A3636'); r(22,23,5,1,'#3A3636');
    r(25,18,5,6,'#C8906A');
    r(25,18,5,1,'#E0A880');
    r(29,19,1,4,'#8A6448');
  } else if (f===4) {
    r(0,22,3,14,'#181414');
    r(17,20,3,4,'#181414');
    r(19,21,4,3,'#181414');
    r(22,20,4,5,'#C8906A');
    r(22,20,4,1,'#E0A880');
  } else {
    const la=f===1?17:f===2?23:20, ra=f===2?17:f===1?23:20;
    r(0,la,3,14,'#181414');
    r(17,ra,3,14,'#181414');
  }

  r(2,35,16,3,'#141010'); r(9,35,3,3,'#302018');
  const [lx,rx,ly,ry]=f===1?[2,11,33,35]:f===2?[4,9,35,33]:f===3?[1,12,34,34]:[3,10,34,34];
  r(lx,ly,7,6,'#2A306A'); r(lx,ly,7,2,'#1E2254');
  r(rx,ry,7,6,'#2A306A'); r(rx,ry,7,2,'#1E2254');
  const lsx=lx+(f===1?-1:f===2?1:0), rsx=rx+(f===1?1:f===2?-1:0);
  r(lsx,38,9,2,'#100C08'); r(lsx+1,38,3,1,'#282018');
  r(rsx,38,9,2,'#100C08'); r(rsx+1,38,3,1,'#282018');
}

function drawPetey(ctx, xOff, f) {
  const r = mkR(ctx, xOff + CHAR_OFF);
  const lean = f===3 ? 1 : 0;
  r(5,0, 10,5, '#120E0A');
  r(3,2, 14,7, '#1A1410');
  r(4,7, 12,4, '#100C08');
  r(5,2,  8,3, '#2A1E16');
  r(3,11,3,5,'#120E0A'); r(14,11,3,5,'#120E0A');
  r(4+lean,7, 12,12,'#BE8C65');
  r(5+lean,8, 10,3, '#D09870');
  r(5+lean,13, 4,3,'#111111'); r(11+lean,13,4,3,'#111111');
  r(9+lean,14, 2,1,'#222222'); r(5+lean,13,4,1,'#333333');
  r(9+lean,17,2,2,'#9E7248');
  r(6+lean,19,8,3,'#7A4A30');
  r(8,19,4,4,'#BE8C65');
  r(2,21, 5,16,'#302A26'); r(13,21,5,16,'#302A26');
  r(2,21, 3,6, '#221E1A'); r(15,21,3,6, '#221E1A');
  r(7,21, 6,16,'#6C3E22');
  r(9,23, 2,10,'#4E2C14');

  if (f===3) {
    r(0,24, 3,12,'#BE8C65'); r(1,27,2,4,'#3C3560');
    r(17,19,3,4,'#BE8C65');
    r(19,20,7,3,'#BE8C65');
    r(22,19,5,1,'#4A3A2C'); r(22,23,5,1,'#4A3A2C');
    r(25,18,5,6,'#BE8C65');
    r(25,18,5,1,'#D8A67E');
    r(29,19,1,4,'#8A6448');
  } else if (f===4) {
    r(0,22, 3,14,'#BE8C65'); r(1,26,2,4,'#3C3560');
    r(17,20,3,4,'#BE8C65');
    r(19,21,4,3,'#BE8C65');
    r(22,20,4,5,'#BE8C65');
    r(22,20,4,1,'#D8A67E');
  } else {
    const la=f===1?17:f===2?23:20, ra=f===2?17:f===1?23:20;
    r(0,la,  3,14,'#BE8C65'); r(1,la+4, 2,4,'#3C3560'); r(1,la+8,2,3,'#3C3560');
    r(17,ra, 3,14,'#BE8C65'); r(18,ra+4,2,4,'#3C3560'); r(18,ra+8,2,3,'#3C3560');
  }

  r(2,35,16,3,'#181410'); r(9,35,3,3,'#2C2218');
  const [lx,rx,ly,ry]=f===1?[2,11,33,35]:f===2?[4,9,35,33]:f===3?[1,12,34,34]:[3,10,34,34];
  r(lx,ly,7,6,'#1E1C18'); r(lx,ly,7,2,'#161412');
  r(rx,ry,7,6,'#1E1C18'); r(rx,ry,7,2,'#161412');
  const lsx=lx+(f===1?-1:f===2?1:0), rsx=rx+(f===1?1:f===2?-1:0);
  r(lsx,38,10,2,'#0C0A08'); r(lsx+1,38,3,1,'#201810');
  r(rsx,38,10,2,'#0C0A08'); r(rsx+1,38,3,1,'#201810');
}

// ============================================================
// ENEMY SPRITES
// ============================================================

// ── HIPSTER ── grid 14w x 30h -> 28x60 ────────────────────
function drawHipster(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  r(3,0,8,3,'#2E5070'); r(4,0,6,1,'#3E6488');
  r(3,3,8,2,'#1E3A56');
  r(3,5,1,4,'#3A2A18'); r(10,5,1,4,'#3A2A18');
  r(4,5,6,6,'#D0A078'); r(5,5,4,2,'#DCB088');
  r(3,7,4,3,'#141414'); r(8,7,4,3,'#141414');
  r(4,8,2,1,'#5A6A78'); r(9,8,2,1,'#5A6A78');
  r(7,8,1,1,'#141414');
  r(3,10,8,4,'#5A3A20'); r(4,10,6,1,'#6E4A28');
  r(5,11,4,1,'#8A4A38');
  r(4,14,6,1,'#4A2E18');
  r(6,14,2,1,'#D0A078');
  r(2,15,10,9,'#8E2C2C');
  r(4,15,1,9,'#5E1C1C'); r(7,15,1,9,'#5E1C1C'); r(10,15,1,9,'#5E1C1C');
  r(2,17,10,1,'#5E1C1C'); r(2,20,10,1,'#5E1C1C'); r(2,23,10,1,'#5E1C1C');
  r(6,15,1,9,'#D8C070');
  r(2,15,2,9,'#3A5070'); r(10,15,2,9,'#3A5070');
  r(2,15,1,9,'#2C3E58'); r(11,15,1,9,'#2C3E58');
  const la=f===1?14:f===2?18:16, ra=f===2?14:f===1?18:16;
  r(0,la,2,7,'#3A5070');  r(0,la+7,2,2,'#D0A078');
  r(12,ra,2,7,'#3A5070'); r(12,ra+7,2,2,'#D0A078');
  r(2,24,10,1,'#241A12');
  const [lx,rx,ly,ry]=f===1?[2,8,25,26]:f===2?[4,8,26,25]:[3,7,25,25];
  r(lx,ly,3,28-ly,'#22242E'); r(rx,ry,3,28-ry,'#22242E');
  r(lx,27,3,1,'#4A6A90'); r(rx,27,3,1,'#4A6A90');
  r(lx-1,28,5,2,'#E8E4DC'); r(rx-1,28,5,2,'#E8E4DC');
  r(lx-1,29,5,1,'#B8B4AC'); r(rx-1,29,5,1,'#B8B4AC');
}

// ── HIPPIE ── grid 14w x 30h -> 28x60 ─────────────────────
function drawHippie(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  r(1,2, 4,18,'#8C7028'); r(9,2,4,16,'#8C7028');
  r(2,5, 10,2,'#D04040');
  r(2,0, 10,8,'#A08030'); r(3,0,8,3,'#B89040');
  r(3,4, 8,10,'#C8906A'); r(4,5,6,3,'#D49878');
  r(4,9, 2,2, '#3A2818'); r(8,9,2,2,'#3A2818');
  r(4,12,6,1, '#904840'); r(4,12,1,2,'#904840'); r(9,12,1,2,'#904840');
  r(6,14,2,3, '#C8906A');
  r(2,16,10,8,'#C04090');
  r(3,17,3,4, '#40A0B0'); r(7,19,3,4,'#C8C028'); r(5,17,2,2,'#E06030');
  r(2,16,10,2,'#D050A0');
  if(f===0||f===1){ r(0,18,2,8,'#C04090'); r(12,18,2,8,'#C04090'); }
  else            { r(0,18,2,8,'#C04090'); r(12,14,2,12,'#C04090'); }
  r(2,24,10,2,'#806030'); r(5,24,2,2,'#604820');
  const [lx2,rx2,ly2,ry2]=f===1?[1,7,26,28]:f===2?[3,5,28,26]:[2,6,27,27];
  r(lx2,ly2,4,10,'#4060B0'); r(lx2,ly2,4,2,'#2A4080');
  r(rx2,ry2,4,10,'#4060B0'); r(rx2,ry2,4,2,'#2A4080');
  r(lx2-1,ly2+7,6,3,'#3858A8'); r(rx2-1,ry2+7,6,3,'#3858A8');
  r(lx2-1,29,6,1,'#806030'); r(rx2-1,29,6,1,'#806030');
}

// ── CRACKHEAD ── grid 14w x 24h -> 28x48 ──────────────────
// Hunched forward: rounded upper back, head jutting out BELOW the shoulder
// line, long dangling arms, bent knees, shuffling stance.
function drawCrackhead(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  const SKIN='#93A47E', SKIN_HI='#A3B48C', SHADE='#75855F';
  const HOOD='#3E4A44', HOOD_D='#2E3832', HOOD_L='#4C5A52';

  // hunched back (high point at left/rear), sloping down to the neck
  r(2,4,6,3,HOOD_D);
  r(1,6,8,10,HOOD);
  r(1,6,8,2,HOOD_D);
  r(2,4,5,2,HOOD_L);
  r(3,10,1,6,HOOD_D);              // spine seam
  r(7,12,2,4,'#2A322C');           // tear

  // stringy hair hanging forward over the jutting head
  r(7,5,5,3,'#2E2418');
  r(6,6,2,5,'#241C12');
  r(11,6,1,4,'#241C12');

  // head, forward and low
  r(7,7,5,6,SKIN);
  r(8,7,4,2,SKIN_HI);
  r(8,9,1,2,'#1C2416'); r(10,9,1,2,'#1C2416');   // sunken eyes
  r(9,9,1,1,'#D8E040'); r(11,9,1,1,'#D8E040');
  r(7,10,1,3,SHADE);                              // hollow cheek
  r(9,11,3,2,'#2A1410');                          // open mouth
  r(9,11,2,1,'#B8A87A');
  r(11,12,1,1,SKIN);                              // chin

  // long dangling arms, hands near the knees
  const sw = f===1 ? 1 : f===2 ? -1 : 0;
  r(0,8,2,9,HOOD);  r(0,17,2,2,SKIN);
  r(9+sw,13,2,7,HOOD); r(9+sw,20,2,2,SKIN);

  // bent knees, shuffling
  const [lx,rx] = f===1 ? [2,7] : f===2 ? [4,7] : [3,7];
  r(lx,16,3,5,'#383028'); r(lx,16,3,1,'#2A2418');
  r(rx,16,3,5,'#383028'); r(rx,16,3,1,'#2A2418');
  r(lx-1,21,5,2,'#1E1A16'); r(rx-1,21,5,2,'#1E1A16');
  r(lx-1,23,5,1,'#141210'); r(rx-1,23,5,1,'#141210');
}

// ── RAT ── grid 14w x 8h -> 28x16 ─────────────────────────
function drawRat(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  if(f===0){ r(0,5,2,1,'#A99184'); r(1,4,3,1,'#A99184'); }
  else     { r(0,3,1,2,'#A99184'); r(1,5,3,1,'#A99184'); }
  r(3,2,7,4,'#6B6158'); r(4,1,5,2,'#847668'); r(3,5,7,1,'#463E38');
  r(4,3,3,2,'#5C534B');
  r(9,2,3,4,'#7A6E64'); r(12,3,1,2,'#8E8078');
  r(13,4,1,1,'#C99A9A');
  r(9,0,2,2,'#8A7C72'); r(10,0,1,1,'#C79A9C');
  r(11,3,1,1,'#120A0A'); r(12,2,1,1,'#EFE6DC');
  if(f===0){ r(4,6,1,2,'#4E463E'); r(8,6,1,2,'#4E463E'); }
  else     { r(3,6,2,1,'#4E463E'); r(8,6,2,1,'#4E463E'); }
}

// ── PROJECTILES ──────────────────────────────────────────
function drawFlower(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  r(1,0,2,1,'#D84090'); r(0,1,1,2,'#D84090'); r(3,1,1,2,'#D84090'); r(1,3,2,1,'#D84090');
  r(1,1,2,2,'#F0E030');
}
function drawBurrito(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  r(1,0,4,4,'#D9C08A'); r(0,1,1,2,'#C6AB74'); r(5,1,1,2,'#C6AB74');
  r(1,0,2,4,'#C9CDD1'); r(1,1,1,1,'#AEB2B6'); r(2,2,1,1,'#AEB2B6');
  r(3,0,2,1,'#E6D0A2'); r(3,3,2,1,'#B2934F');
}
function drawSyringe(ctx, xOff, f) {
  const r = mkR(ctx, xOff);
  r(0,1,2,2,'#C03A3A');
  r(2,1,4,2,'#DCE4E8');
  r(3,1,2,2,'#B8E020');
  r(2,0,4,1,'#F0F6FA');
  r(6,1,2,1,'#B8C0C8'); r(6,2,1,1,'#8A929A');
}

// ============================================================
// Load sprites
// ============================================================
loadSprite("johnny", genCanvas(CHAR_GW,CHAR_GH,CHAR_FRAMES,drawJohnny), { sliceX:CHAR_FRAMES, sliceY:1 });
loadSprite("evan",   genCanvas(CHAR_GW,CHAR_GH,CHAR_FRAMES,drawEvan),   { sliceX:CHAR_FRAMES, sliceY:1 });
loadSprite("petey",  genCanvas(CHAR_GW,CHAR_GH,CHAR_FRAMES,drawPetey),  { sliceX:CHAR_FRAMES, sliceY:1 });

loadSprite("hipster",   genCanvas(14,30,3,drawHipster),   { sliceX:3, sliceY:1 });
loadSprite("hippie",    genCanvas(14,30,3,drawHippie),    { sliceX:3, sliceY:1 });
loadSprite("crackhead", genCanvas(14,24,3,drawCrackhead), { sliceX:3, sliceY:1 });
loadSprite("rat",       genCanvas(14,8, 2,drawRat),       { sliceX:2, sliceY:1 });

loadSprite("flower",  genCanvas(4,4, 1,drawFlower),  { sliceX:1, sliceY:1 });
loadSprite("burrito", genCanvas(6,4, 1,drawBurrito), { sliceX:1, sliceY:1 });
loadSprite("syringe", genCanvas(8,4, 1,drawSyringe), { sliceX:1, sliceY:1 });
loadSprite("impact",  genCanvas(12,12,3,drawImpact), { sliceX:3, sliceY:1 });

loadSprite("person0", genCanvas(5,8,3,drawPerson('#C85040')), { sliceX:3, sliceY:1 });
loadSprite("person1", genCanvas(5,8,3,drawPerson('#3A6AA0')), { sliceX:3, sliceY:1 });
const PERSON_SPRITES = ["person0","person1"];
const PERSON_W = 5*SPX, PERSON_H = 8*SPX;

function loadFloor(name, drawBase, seed) {
  loadSprite(name, genCanvas(GW, GH, 3, (ctx, xOff, f) => {
    const r = mkR(ctx, xOff);
    drawBase(r);
    damage(r, f, seed);
  }), { sliceX:3, sliceY:1 });
}

// Apartment floors: one mid + one top sprite per facade variant.
for (const key of Object.keys(FACADES)) {
  for (const v of FACADES[key]) {
    loadFloor(v.id,          r => FLOOR_DRAW[key](r, v, false), hashSeed(v.id));
    loadFloor(v.id + "_top", r => FLOOR_DRAW[key](r, v, true),  hashSeed(v.id + "_top"));
  }
}

// One lit-window sprite per distinct window size used by any facade.
const WINLIT_SIZES = new Set();
for (const key of Object.keys(FACADES))
  for (const v of FACADES[key])
    for (const [, , w, h] of v.windows) WINLIT_SIZES.add(`${w}x${h}`);
for (const size of WINLIT_SIZES) {
  const [w,h] = size.split('x').map(Number);
  loadSprite(`winlit_${size}`, genCanvas(w, h, 2, drawWinlit(w,h)), { sliceX:2, sliceY:1 });
}

loadFloor("store_taqueria",   drawTaqueria,   4401);
loadFloor("store_laundromat", drawLaundromat, 4402);
loadFloor("store_vintage",    drawVintage,    5501);
loadFloor("store_thrift",     drawThrift,     5502);
loadFloor("store_smoke",      drawSmoke,      6601);
loadFloor("store_tobacco",    drawTobacco,    6602);

loadSprite("sky_mission",    genCanvas(SKY_GW,SKY_GH,1,drawSkyMission),    { sliceX:1, sliceY:1 });
loadSprite("sky_haight",     genCanvas(SKY_GW,SKY_GH,1,drawSkyHaight),     { sliceX:1, sliceY:1 });
loadSprite("sky_tenderloin", genCanvas(SKY_GW,SKY_GH,1,drawSkyTenderloin), { sliceX:1, sliceY:1 });
loadSprite("fog",            genCanvas(FOG_GW,FOG_GH,2,drawFog),           { sliceX:2, sliceY:1 });

// ============================================================
// Scene: select
// ============================================================
scene("select", () => {
  let selected = 0;
  const CARD_W=232, CARD_H=306, CARD_GAP=22;
  const TOTAL_W=CHARACTERS.length*CARD_W+(CHARACTERS.length-1)*CARD_GAP;
  const START_X=Math.floor((GAME_W-TOTAL_W)/2), CARD_Y=112;
  const BG_OFF=[34,34,34], BG_ON=[48,44,38];
  const C_DIM=[176,162,144];

  add([text("CHOOSE YOUR FIGHTER",{size:34,font:FONT,letterSpacing:3}), pos(GAME_W/2,44), anchor("center"), color(...C_ACCENT)]);
  add([text("JOHNNY! TAKES SAN FRANCISCO",{size:14,font:FONT,letterSpacing:2}), pos(GAME_W/2,78), anchor("center"), color(...C_DIM)]);

  function statRow(cx, y, label, value, max) {
    add([text(label,{size:13,font:FONT}), pos(cx+16,y), anchor("left"), color(...C_DIM)]);
    add([rect(104,7), pos(cx+62,y-3), color(58,54,48)]);
    add([rect(Math.max(3,Math.round(104*value/max)),7), pos(cx+62,y-3), color(...C_ACCENT)]);
    add([text(String(value),{size:13,font:FONT}), pos(cx+CARD_W-16,y), anchor("right"), color(...C_TEXT)]);
  }

  const cards = CHARACTERS.map((ch,i) => {
    const cx = START_X + i*(CARD_W+CARD_GAP);
    const border = add([rect(CARD_W+6,CARD_H+6), pos(cx-3,CARD_Y-3), color(...C_MUTED)]);
    const bg     = add([rect(CARD_W,CARD_H), pos(cx,CARD_Y), color(...BG_OFF)]);
    const strip  = add([rect(CARD_W,4), pos(cx,CARD_Y), color(...BG_OFF)]);

    add([sprite(ch.id), pos(cx+CARD_W/2,CARD_Y+78), anchor("center"), scale(1.35,1.35)]);
    add([text(ch.name,{size:17,font:FONT,letterSpacing:1,width:CARD_W-16,align:"center"}), pos(cx+CARD_W/2,CARD_Y+140), anchor("top"), color(...C_TEXT)]);
    add([text(ch.role,{size:13,font:FONT,width:CARD_W-16,align:"center"}), pos(cx+CARD_W/2,CARD_Y+166), anchor("top"), color(...C_DIM)]);
    add([rect(CARD_W-40,1), pos(cx+20,CARD_Y+190), color(...C_MUTED)]);

    statRow(cx, CARD_Y+206, "SPD", ch.speed,     STAT_MAX.speed);
    statRow(cx, CARD_Y+228, "POW", ch.punch,     STAT_MAX.punch);
    statRow(cx, CARD_Y+250, "JMP", ch.jumpForce, STAT_MAX.jumpForce);

    add([text(ch.tagline,{size:13,font:FONT,width:CARD_W-28,align:"center",lineSpacing:3}), pos(cx+CARD_W/2,CARD_Y+272), anchor("top"), color(...C_DIM)]);
    return { border, bg, strip, cx, cy:CARD_Y };
  });

  add([text("CLICK A CARD   ·   ARROWS + ENTER   ·   M MUTE",{size:14,font:FONT,letterSpacing:1}), pos(GAME_W/2,GAME_H-24), anchor("center"), color(...C_DIM)]);

  const hovered = (mp,c) => mp.x>=c.cx && mp.x<=c.cx+CARD_W && mp.y>=c.cy && mp.y<=c.cy+CARD_H;

  onUpdate(()=>{
    const mp = mousePos();
    cards.forEach((c,i)=>{ if(hovered(mp,c)) selected=i; });
    cards.forEach((c,i)=>{
      const on = i===selected;
      c.border.color = on ? rgb(...C_ACCENT) : rgb(...C_MUTED);
      c.bg.color     = rgb(...(on ? BG_ON : BG_OFF));
      c.strip.color  = on ? rgb(...C_ACCENT) : rgb(...BG_OFF);
    });
  });

  const start = i => { sfx("menu_select"); go("game",{char:CHARACTERS[i],levelIdx:0,score:0}); };
  onKeyPress("left",  ()=>{ selected=(selected-1+CHARACTERS.length)%CHARACTERS.length; sfx("menu_move"); });
  onKeyPress("right", ()=>{ selected=(selected+1)%CHARACTERS.length; sfx("menu_move"); });
  onKeyPress(["enter","space"], ()=>start(selected));
  onClick(()=>{ const mp=mousePos(); cards.forEach((c,i)=>{ if(hovered(mp,c)) start(i); }); });
});

// ============================================================
// Scene: game
// ============================================================
scene("game", ({char:chosenChar, levelIdx=0, score:prevScore=0}={}) => {
  const level   = LEVELS[levelIdx];
  const groundY = GAME_H - GROUND_H;

  let velY=0, prevY=0, onGround=false, facingRight=true, canPunch=true;
  let playerHP=PLAYER_MAX_HP, dmgCooldown=0;
  let score=prevScore, blocksDestroyed=0, gameActive=false;
  let shakeLevel=0, personTimer=1.5;

  const enemies=[], projectiles=[], people=[], fx=[], impacts=[], flickers=[], beacons=[], fogs=[];
  const spawnTimers=level.spawnRoster.map(ro=>({...ro, timer:ro.firstSpawn}));

  // ── Background. Everything here rides the camera, so a screen shake would drag
  // an edge into view. The sky rect, the skyline (bled by SKY_PAD) and the ground
  // all overscan far past the canvas so the clear color can never show through.
  add([rect(GAME_W+160, GAME_H+160), pos(-80,-80), color(...level.skyColor), z(Z_SKY)]);
  add([sprite(level.skyline), pos(SKY_OFF,SKY_OFF), z(Z_SKYLINE)]);

  level.beacons.forEach(([bx,by],i) => {
    beacons.push(add([rect(2,2), pos(bx,by), color(230,70,50), opacity(1), z(Z_BEACON)]));
  });
  if (level.fog) {
    // One bank behind the city for depth, one drifting across the front of it.
    // Both sit below the enemies and the player so they never hide the action.
    [{ y:292, z:Z_FOG,       op:1.0,  speed:6  },
     { y:374, z:Z_FOG_FRONT, op:0.55, speed:11 }].forEach((L,i) => {
      const o = add([sprite("fog"), pos(-40*i, L.y), opacity(L.op), z(L.z)]);
      o.frame = i;
      fogs.push({ o, speed: L.speed });
    });
  }

  add([rect(GAME_W+160,GROUND_H+90), pos(-80,groundY), color(...C_SURFACE)]);
  add([rect(GAME_W+160,3), pos(-80,groundY), color(58,56,54)]);

  const player = add([rect(PLAYER_W,PLAYER_H), pos(20,groundY-PLAYER_H), opacity(0)]);
  prevY = player.pos.y;

  const pSpr = add([sprite(chosenChar.id), pos(player.pos.x+PLAYER_W/2,player.pos.y+PLAYER_H/2), anchor("center"), scale(1,1), z(Z_PLAYER)]);
  let walkPhase=0, punchTimer=0;

  // ── City blocks
  const blocks=[], aptBlocks=[];
  const fac=FACADES[level.facades];
  const totalCityW=level.buildingHeights.length*FLOOR_W+(level.buildingHeights.length-1)*BLDG_GAP;
  const cityStartX=Math.floor((GAME_W-totalCityW)/2);

  level.buildingHeights.forEach((numFloors,bi)=>{
    const bx=cityStartX+bi*(FLOOR_W+BLDG_GAP);
    const tint=level.buildingColors[bi%level.buildingColors.length];
    const store=level.stores[bi%level.stores.length];
    const v=fac[level.variantMask[bi]%fac.length];

    for(let fi=0;fi<numFloors;fi++){
      const by=groundY-(fi+1)*FLOOR_H;
      const isGround=fi===0, isTop=fi===numFloors-1;
      const sprName=isGround?store:(isTop?v.id+"_top":v.id);
      const base=isGround?[255,255,255]:tint;
      const spr=add([sprite(sprName), pos(bx,by), color(...base), z(Z_BLOCK)]);

      const block={x:bx,y:by,w:FLOOR_W,h:FLOOR_H,hp:BLOCK_HP,maxHp:BLOCK_HP,base,spr,
                   apartment:!isGround, variant:v, lights:[], people:[], occupied:new Set()};

      if (block.apartment) {
        v.windows.forEach(([wx,wy,ww,wh]) => {
          if (Math.random() >= LIT_CHANCE) return;
          const l = add([sprite(`winlit_${ww}x${wh}`), pos(bx+wx*SPX, by+wy*SPX), opacity(1), z(Z_WINLIT)]);
          l.frame = Math.random() < 0.18 ? 1 : 0;          // 0 lamp, 1 television
          block.lights.push(l);
          if (Math.random() < 0.12) flickers.push({ o:l, t:Math.random()*2 });
        });
        aptBlocks.push(block);
      }
      blocks.push(block);
    }
  });
  const totalBlocks=blocks.length;

  // ── HUD. fixed() keeps it out of the camera transform so it never shakes.
  add([text(chosenChar.name,{size:14,font:FONT}), pos(10,8), color(...C_ACCENT), z(Z_HUD), fixed()]);
  const hpBar     =add([text(mkHpBar(PLAYER_MAX_HP),{size:12,font:FONT}), pos(10,30), color(100,200,60), z(Z_HUD), fixed()]);
  add([text("SCORE",{size:11,font:FONT,letterSpacing:1}), pos(GAME_W/2,8), anchor("center"), color(...C_MUTED), z(Z_HUD), fixed()]);
  const scoreLabel=add([text(fmtScore(prevScore),{size:18,font:FONT}), pos(GAME_W/2,26), anchor("center"), color(...C_ACCENT), z(Z_HUD), fixed()]);
  const destLabel =add([text("DEST: 0%",{size:11,font:FONT}), pos(GAME_W/2,50), anchor("center"), color(...C_MUTED), z(Z_HUD), fixed()]);
  add([text(`LVL ${levelIdx+1}  ${level.name}`,{size:12,font:FONT}), pos(GAME_W-10,8), anchor("right"), color(...C_MUTED), z(Z_HUD), fixed()]);
  const eHUD=add([text("ENEMIES: 0",{size:12,font:FONT}), pos(GAME_W-10,28), anchor("right"), color(...C_MUTED), z(Z_HUD), fixed()]);
  add([text("ARROWS/WASD MOVE   UP/W JUMP   Z PUNCH   M MUTE   ESC QUIT",{size:11,font:FONT}), pos(GAME_W/2,groundY+26), anchor("center"), color(...C_MUTED), z(Z_HUD), fixed()]);

  const iO=[
    add([rect(GAME_W,GAME_H),pos(0,0),color(...level.skyColor),z(Z_OVERLAY),fixed()]),
    add([text(`— LEVEL ${levelIdx+1} —`,{size:14,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2-60),anchor("center"),color(...C_MUTED),z(Z_OVERLAY),fixed()]),
    add([text(level.name,{size:34,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2-16),anchor("center"),color(...C_ACCENT),z(Z_OVERLAY),fixed()]),
    add([text(level.subtitle,{size:14,font:FONT}),pos(GAME_W/2,GAME_H/2+28),anchor("center"),color(...C_MUTED),z(Z_OVERLAY),fixed()]),
    add([text("GET READY...",{size:16,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2+66),anchor("center"),color(...C_TEXT),z(Z_OVERLAY),fixed()]),
  ];
  wait(2.5, ()=>{ iO.forEach(o=>destroy(o)); gameActive=true; sfx("level_start"); firstSpawns(); });

  // ── Helpers ─────────────────────────────────────────────
  function overlaps(ax,ay,aw,ah,bx,by,bw,bh){
    return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by;
  }
  function mkHpBar(hp){
    const f=Math.round((hp/PLAYER_MAX_HP)*20);
    return "HP ["+"=".repeat(f)+" ".repeat(20-f)+"] "+hp;
  }
  function fmtScore(s){ return s.toString().padStart(6,"0"); }
  function hpColor(hp){ const p=hp/PLAYER_MAX_HP; return p>.66?rgb(100,200,60):p>.33?rgb(220,180,40):rgb(220,60,60); }
  function addScore(pts){ score+=pts; scoreLabel.text=fmtScore(score); }

  // shake() ADDS to cam.shake, so a fast combo would stack faster than it decays.
  function addShake(n){ if(shakeLevel < 7){ shake(n); shakeLevel += n; } }

  function refreshBlock(block){
    const t=block.hp/block.maxHp;
    const f=t>0.66?0:t>0.33?1:2;
    block.spr.frame=f;
    const [r,g,b]=block.base;
    if(f===0)      block.spr.color=rgb(r,g,b);
    else if(f===1) block.spr.color=rgb(mix(r,255,.22),mix(g,205,.22),mix(b,160,.22));
    else           block.spr.color=rgb(mix(r,255,.45),mix(g,235,.45),mix(b,215,.45));
  }

  // ── Effects ──────────────────────────────────────────────
  function spawnImpact(x,y){
    impacts.push({ o: add([sprite("impact"), pos(x,y), anchor("center"), opacity(1), z(Z_PROJ)]), t:0 });
  }
  function spawnDebris(x,y,col,n){
    for(let i=0;i<n && fx.length<MAX_FX;i++){
      const s=2+Math.floor(Math.random()*3);
      const o=add([rect(s,s), pos(x,y), anchor("center"), rotate(0), color(...col), opacity(1), z(Z_PROJ)]);
      fx.push({o, vx:(Math.random()*2-1)*190, vy:-70-Math.random()*190,
               spin:(Math.random()*2-1)*600, t:0, life:0.35+Math.random()*0.4});
    }
  }
  function dustBurst(x,y){ spawnDebris(x,y,[150,140,130],3); }

  // ── Window people ────────────────────────────────────────
  function trySpawnPerson(){
    if (people.length >= MAX_PEOPLE) return;
    const cands = aptBlocks.filter(b => b.spr && b.hp === b.maxHp && b.occupied.size < b.variant.windows.length);
    if (!cands.length) return;
    const b = cands[Math.floor(Math.random()*cands.length)];
    const free = b.variant.windows.map((_,i)=>i).filter(i => !b.occupied.has(i));
    const slot = free[Math.floor(Math.random()*free.length)];
    const [wx,wy,ww,wh] = b.variant.windows[slot];

    const o = add([
      sprite(PERSON_SPRITES[Math.floor(Math.random()*PERSON_SPRITES.length)]),
      pos(b.x + (wx + ww/2)*SPX, b.y + (wy + wh)*SPX),
      anchor("bot"), rotate(0), opacity(1), z(Z_PERSON),
    ]);
    b.occupied.add(slot);
    const p = { o, block:b, slot, t:0, life:2.6+Math.random()*1.6, falling:false, vx:0, vy:0, spin:0 };
    people.push(p);
    b.people.push(p);
  }

  function detachPerson(p){
    p.block.occupied.delete(p.slot);
    const i = p.block.people.indexOf(p);
    if (i >= 0) p.block.people.splice(i,1);
  }

  // Called from doPunch the instant a block dies. Mutates person state only —
  // never splices people[], because doPunch is mid-iteration over blocks[].
  function collapseBlock(block){
    if (block.lights.length) { block.lights.forEach(destroy); block.lights = []; }
    block.people.forEach(p => {
      if (p.falling) return;
      p.falling = true;
      p.o.anchor = "center";
      p.o.pos.y -= PERSON_H/2;                // bot-anchored pos sits at the feet
      p.o.frame  = 2;
      p.vx = (Math.random()*2-1)*50;
      p.vy = -70 - Math.random()*70;
      p.spin = (Math.random()<0.5?-1:1)*(200+Math.random()*200);
      addScore(SCORE_PER_PERSON);
      // Several people can fall from one collapse; sfx() de-dups per frame.
      sfx("scream", { vol:0.7, detune:vary(220), x:p.o.pos.x });
    });
    block.people = [];
    block.occupied.clear();
  }

  function updatePeople(d){
    personTimer -= d;
    if (personTimer <= 0) { personTimer = 1.1 + Math.random()*1.4; if (gameActive) trySpawnPerson(); }

    for (let i=people.length-1; i>=0; i--) {
      const p = people[i];
      if (p.falling) {
        p.vy += GRAVITY*0.5*d;
        p.o.pos.x += p.vx*d;
        p.o.pos.y += p.vy*d;
        p.o.angle += p.spin*d;
        if (p.o.pos.y >= groundY - PERSON_H/2) {
          sfx("splat", { vol:0.8, detune:vary(150), x:p.o.pos.x });
          dustBurst(p.o.pos.x, groundY);
          destroy(p.o); people.splice(i,1);
        }
        continue;
      }
      p.t += d;
      const b = p.block;
      if (b.hp < b.maxHp) p.o.frame = 2;                          // panic
      else p.o.frame = p.t < 0.45 ? 0 : (Math.floor(p.t*4)%2);    // peek, then wave
      if (p.t >= p.life) { detachPerson(p); destroy(p.o); people.splice(i,1); }
    }
  }

  // ── Enemy system ─────────────────────────────────────────
  function firstSpawns(){ spawnTimers.forEach(ro=>{ doSpawn(ro); ro.timer=ro.interval; }); }
  function doSpawn(roster){
    const batch=roster.batchSize||1, fromLeft=Math.random()<0.5;
    for(let i=0;i<batch;i++) spawnEnemy(roster,fromLeft,i);
  }

  function spawnEnemy(roster,fromLeft,bi=0){
    const type=roster.type, def=ENEMY_DEFS[type];
    if(!def) return;
    if(enemies.filter(e=>e.type===type).length>=(roster.maxCount||3)) return;
    const sx=fromLeft?-def.w-5+bi*26:GAME_W+5+bi*26;
    const sy=groundY-def.h;
    const spr=add([sprite(type), pos(sx+def.w/2,sy+def.h/2), anchor("center"), scale(fromLeft?1:-1,1), z(Z_ENEMY)]);
    enemies.push({
      type,def,x:sx,y:sy,w:def.w,h:def.h,
      hp:def.maxHp,score:def.score,
      speed:def.baseSpeed*(roster.speedMult||1),
      touchDamage:def.touchDamage||0,
      dir:fromLeft?1:-1, facingRight:fromLeft, spr,
      animTimer:Math.random(),
      behaviorTimer:0.5+Math.random()*1.5,
      stagger:1, settled:false,
      throwTimer:(def.throwInterval||999)+Math.random()*2,
    });
    // Rats spawn in batches of two; sfx() de-dups per frame so that's one squeak.
    if(type==="rat") sfx("rat_squeak", { vol:0.5, detune:vary(250), x:sx });
    eHUD.text=`ENEMIES: ${enemies.length}`;
  }

  function killEnemy(idx){                       // punched: award score
    destroy(enemies[idx].spr);
    addScore(enemies[idx].score);
    enemies.splice(idx,1);
    eHUD.text=`ENEMIES: ${enemies.length}`;
  }
  function removeEnemy(idx){                     // walked off screen: no score
    destroy(enemies[idx].spr);
    enemies.splice(idx,1);
    eHUD.text=`ENEMIES: ${enemies.length}`;
  }

  // One whoosh, pitched per projectile: a burrito is heavy, a syringe is sharp.
  const THROW_DETUNE={ burrito:-350, flower:120, syringe:450 };

  function spawnProj(x,y,vx,vy,dmg,name){
    const p=PROJ[name];
    const spr=add([sprite(name),pos(x,y),anchor("center"),rotate(0),scale(vx<0?-1:1,1),z(Z_PROJ)]);
    projectiles.push({spr,x,y,velX:vx,velY:vy,damage:dmg,hw:p.hw,hh:p.hh,spin:p.spin,grav:p.grav});
    sfx("throw", { vol:0.45, detune:(THROW_DETUNE[name]||0)+vary(80), x });
  }

  function hurtPlayer(dmg){
    playerHP=Math.max(0,playerHP-dmg);
    hpBar.text=mkHpBar(playerHP); hpBar.color=hpColor(playerHP);
    dmgCooldown=DMG_COOLDOWN;
    sfx("player_hurt", { vol:0.8, detune:vary(120), x:player.pos.x });
    if(playerHP<=0) go("gameover",{score,levelIdx});
  }

  function doPunch(){
    if(!canPunch||!gameActive) return;
    canPunch=false; punchTimer=PUNCH_COOLDOWN;
    wait(PUNCH_COOLDOWN,()=>{ canPunch=true; });
    const hx=facingRight?player.pos.x+PLAYER_W:player.pos.x-PUNCH_REACH;
    const hy=player.pos.y+PLAYER_H*.05, hw=PUNCH_REACH, hh=PLAYER_H*.95;

    sfx("swing", { vol:0.5, detune:vary(180), x:player.pos.x });

    // The hitbox is 76px tall, so one swing routinely damages several stacked
    // floors and can destroy two at once. Collect what happened and emit at most
    // one block sound and one enemy sound afterwards, instead of one per hit.
    let hitBlock=false, brokeBlock=false, hitEnemy=false, killedEnemy=false;
    let sndX=player.pos.x;

    blocks.forEach(block=>{
      if(block.hp<=0||!overlaps(hx,hy,hw,hh,block.x,block.y,block.w,block.h)) return;

      // Lights go out on the first connecting punch. Emptying the array makes
      // this idempotent, so later punches on the same block are no-ops.
      if(block.lights.length){ block.lights.forEach(destroy); block.lights=[]; }

      block.hp-=chosenChar.punch;
      const cx = facingRight ? block.x : block.x+block.w;
      const cy = Math.max(block.y+4, Math.min(block.y+block.h-4, player.pos.y+PLAYER_H*0.35));

      if(block.hp<=0){
        block.hp=0;
        brokeBlock=true; sndX=block.x+block.w/2;
        spawnDebris(block.x+block.w/2, block.y+block.h/2, block.base, 6);
        spawnImpact(block.x+block.w/2, block.y+block.h/2);
        collapseBlock(block);
        destroy(block.spr); block.spr=null;
        addShake(4);
        blocksDestroyed++; addScore(SCORE_PER_BLOCK);
        destLabel.text=`DEST: ${Math.floor((blocksDestroyed/totalBlocks)*100)}%`;
        if(blocksDestroyed>=Math.ceil(totalBlocks*WIN_THRESHOLD)){
          levelIdx>=LEVELS.length-1?go("wingame",{score}):go("levelclear",{char:chosenChar,levelIdx,score});
        }
      } else {
        refreshBlock(block);
        if(!brokeBlock){ hitBlock=true; sndX=cx; }
        spawnDebris(cx, cy, block.base, 3);
        spawnImpact(cx, cy);
        addShake(1.25);
      }
    });

    let enemyX=player.pos.x;
    for(let i=enemies.length-1;i>=0;i--){
      const e=enemies[i];
      if(overlaps(hx,hy,hw,hh,e.x,e.y,e.w,e.h)){
        e.hp-=chosenChar.punch;
        enemyX=e.x+e.w/2;
        spawnImpact(e.x+e.w/2, e.y+e.h/2);
        addShake(0.75);
        if(e.hp<=0){ killedEnemy=true; killEnemy(i); } else hitEnemy=true;
      }
    }

    // Destroy beats hit; kill beats hit. go("levelclear") may already have fired
    // inside the loop above, but kaplay defers go() to frame end, so this is fine.
    if(brokeBlock)      sfx("destroy_block", { vol:0.95, detune:vary(90),  x:sndX });
    else if(hitBlock)   sfx("hit_block",     { vol:0.75, detune:vary(160), x:sndX });
    if(killedEnemy)     sfx("kill_enemy",    { vol:0.7,  detune:vary(140), x:enemyX });
    else if(hitEnemy)   sfx("hit_enemy",     { vol:0.65, detune:vary(170), x:enemyX });
  }

  // ── Enemy update ─────────────────────────────────────────
  function updateEnemy(e,i,d){
    const def=e.def;

    // Crossing enemies (rats) run on a fixed heading. This branch MUST come
    // before the player-seeking dirX and before the screen clamp, or they'd
    // flip to face the player and get pinned at the screen edge -- which is
    // exactly the "rat freezes under you, facing left then right" bug.
    if (def.crossing) {
      e.x += e.dir * e.speed * d;
      e.facingRight = e.dir > 0;
      e.animTimer += d;
      e.spr.frame = Math.floor(e.animTimer*def.animRate)%2;
      e.spr.pos.x = e.x + e.w/2;
      e.spr.pos.y = e.y + e.h/2 + Math.sin(e.animTimer*20)*0.8;
      e.spr.scale.x = e.facingRight ? 1 : -1;
      if(dmgCooldown<=0 && e.touchDamage>0 && overlaps(player.pos.x,player.pos.y,PLAYER_W,PLAYER_H,e.x,e.y,e.w,e.h))
        hurtPlayer(e.touchDamage);
      if (e.x < -e.w-60 || e.x > GAME_W+60) removeEnemy(i);
      return;
    }

    // Signed gap from the player's centre. Negative means the enemy is to the left.
    const gap = (e.x + e.w/2) - (player.pos.x + PLAYER_W/2);
    const dirX = gap < 0 ? 1 : -1;                 // direction that points at the player

    // Settle band with hysteresis. Without it, an enemy standing on the player
    // has gap flip sign every frame, so it jitters and faces alternately left
    // and right. STOP leaves ~10px of overlap so touch damage still lands.
    const stop = (PLAYER_W + e.w)/2 - 10;
    if (e.settled) { if (Math.abs(gap) > stop + 18) e.settled = false; }
    else if (Math.abs(gap) <= stop)                e.settled = true;

    if (Math.abs(gap) > 6) e.facingRight = (dirX === 1);   // don't flip while settled

    if (!e.settled) {
      if(e.type==="crackhead"){
        e.behaviorTimer-=d;
        if(e.behaviorTimer<=0){ e.stagger=(Math.random()<.5?-1:1); e.behaviorTimer=1+Math.random()*1.5; }
        e.x+=(Math.random()<.15?e.stagger:dirX)*e.speed*d;
      } else {
        e.x+=dirX*e.speed*d;
      }
    }

    if(def.projectile && e.x>-e.w*0.5 && e.x<GAME_W-e.w*0.5){
      e.throwTimer-=d;
      if(e.throwTimer<=0){
        e.throwTimer=def.throwInterval+Math.random()*1.5;
        const sp=Math.min(def.projSpeedMax,Math.max(def.projSpeedMin,Math.abs(gap)*0.65));
        spawnProj(e.x+e.w/2, e.y+def.projOffsetY, dirX*sp, def.projVY, def.projDamage, def.projectile);
      }
    }

    e.x=Math.max(-e.w,Math.min(GAME_W,e.x));

    e.animTimer+=d;
    e.spr.frame = def.frames===2
      ? Math.floor(e.animTimer*def.animRate)%2
      : e.settled ? 0 : 1+(Math.floor(e.animTimer*def.animRate)%2);   // stand still when settled

    e.spr.pos.x=e.x+e.w/2;
    e.spr.pos.y=e.y+e.h/2;
    e.spr.scale.x=e.facingRight?1:-1;

    if(dmgCooldown<=0&&e.touchDamage>0&&overlaps(player.pos.x,player.pos.y,PLAYER_W,PLAYER_H,e.x,e.y,e.w,e.h))
      hurtPlayer(e.touchDamage);
  }

  // Ground enemies converge on the same point, so without this they stack into a
  // single silhouette and you can't tell how many are on you. Push overlapping
  // pairs apart by half their overlap each; a few frames resolves a whole crowd.
  // Rats are excluded -- they cross on a fixed heading and pass straight through.
  function separateEnemies(){
    for(let i=0;i<enemies.length;i++){
      const a=enemies[i];
      if(a.def.crossing) continue;
      for(let j=i+1;j<enemies.length;j++){
        const b=enemies[j];
        if(b.def.crossing) continue;
        const minDist=(a.w+b.w)*0.45;
        let dx=(a.x+a.w/2)-(b.x+b.w/2);
        if(dx===0) dx = (i%2 ? 0.01 : -0.01);      // break exact ties deterministically
        const dist=Math.abs(dx);
        if(dist>=minDist) continue;
        const push=(minDist-dist)*0.25, s=dx<0?-1:1;
        a.x+=s*push; b.x-=s*push;
      }
    }
    for(const e of enemies){
      if(e.def.crossing) continue;
      e.x=Math.max(-e.w,Math.min(GAME_W,e.x));
      e.spr.pos.x=e.x+e.w/2;
    }
  }

  // ── Main update ───────────────────────────────────────────
  onUpdate(()=>{
    if(!gameActive) return;
    const d=dt();
    prevY=player.pos.y;
    shakeLevel=Math.max(0, shakeLevel - 30*d);

    const goL=isKeyDown("left")||isKeyDown("a");
    const goR=isKeyDown("right")||isKeyDown("d");
    if(goL&&!goR){ player.pos.x-=chosenChar.speed*d; facingRight=false; }
    else if(goR&&!goL){ player.pos.x+=chosenChar.speed*d; facingRight=true; }
    player.pos.x=Math.max(0,Math.min(GAME_W-PLAYER_W,player.pos.x));

    // onGround is recomputed from scratch every frame, so a landing is a
    // false->true transition. Capture the descent speed before it's zeroed.
    const wasOnGround=onGround;
    velY+=GRAVITY*d; player.pos.y+=velY*d; onGround=false;
    const impactVel=velY;
    if(player.pos.y>=groundY-PLAYER_H){ player.pos.y=groundY-PLAYER_H; velY=0; onGround=true; }

    if(!onGround&&velY>=0){
      for(const block of blocks){
        if(block.hp<=0) continue;
        const pf=player.pos.y+PLAYER_H, pvf=prevY+PLAYER_H;
        if(player.pos.x+PLAYER_W>block.x+4&&player.pos.x<block.x+block.w-4&&pvf<=block.y+4&&pf>=block.y){
          player.pos.y=block.y-PLAYER_H; velY=0; onGround=true; break;
        }
      }
    }

    // Landed: only for a real drop, not the 1-frame settle at spawn.
    if(!wasOnGround && onGround && impactVel > 260)
      sfx("land", { vol:0.45, detune:vary(120), x:player.pos.x });

    punchTimer=Math.max(0,punchTimer-d);

    pSpr.pos.x=player.pos.x+PLAYER_W/2 + (punchTimer>0 ? (facingRight?7:-7) : 0);   // lunge (visual only)
    pSpr.pos.y=player.pos.y+PLAYER_H/2;
    pSpr.scale.x=facingRight?1:-1;

    if(punchTimer>0){
      pSpr.frame = punchTimer > PUNCH_COOLDOWN*0.55 ? 3 : 4;
    } else if(goL||goR){
      walkPhase+=8*d;
      pSpr.frame=1+(Math.floor(walkPhase)%2);
    } else {
      pSpr.frame=0;
    }

    dmgCooldown=Math.max(0,dmgCooldown-d);
    for(let i=enemies.length-1;i>=0;i--) updateEnemy(enemies[i],i,d);
    separateEnemies();

    for(let i=projectiles.length-1;i>=0;i--){
      const p=projectiles[i];
      p.velY+=GRAVITY*p.grav*d; p.x+=p.velX*d; p.y+=p.velY*d;
      p.spr.pos.x=p.x; p.spr.pos.y=p.y;
      if(p.spin) p.spr.angle+=p.spin*d;
      if(p.y>groundY+20||p.x<-60||p.x>GAME_W+60){ destroy(p.spr); projectiles.splice(i,1); continue; }
      if(dmgCooldown<=0&&overlaps(p.x-p.hw,p.y-p.hh,p.hw*2,p.hh*2,player.pos.x,player.pos.y,PLAYER_W,PLAYER_H)){
        hurtPlayer(p.damage); destroy(p.spr); projectiles.splice(i,1);
      }
    }

    updatePeople(d);

    for(let i=fx.length-1;i>=0;i--){
      const p=fx[i];
      p.t+=d;
      p.vy+=GRAVITY*0.7*d;
      p.o.pos.x+=p.vx*d; p.o.pos.y+=p.vy*d; p.o.angle+=p.spin*d;
      p.o.opacity=Math.max(0,1-p.t/p.life);
      if(p.t>=p.life||p.o.pos.y>GAME_H+20){ destroy(p.o); fx.splice(i,1); }
    }

    for(let i=impacts.length-1;i>=0;i--){
      const im=impacts[i];
      im.t+=d;
      im.o.frame=Math.min(2,Math.floor(im.t/0.06));
      im.o.opacity=Math.max(0,1-im.t/0.19);
      if(im.t>=0.19){ destroy(im.o); impacts.splice(i,1); }
    }

    for(let i=flickers.length-1;i>=0;i--){
      const fl=flickers[i];
      if(!fl.o.exists()){ flickers.splice(i,1); continue; }
      fl.t+=d;
      fl.o.opacity = (Math.sin(fl.t*7)>0.86 || Math.sin(fl.t*13)>0.94) ? 0.35 : 1;
    }

    beacons.forEach((b,i)=>{ b.opacity = (Math.sin(time()*2.2 + i)>0.4) ? 1 : 0.12; });

    fogs.forEach(f=>{
      f.o.pos.x -= f.speed*d;
      if (f.o.pos.x < -80) f.o.pos.x = 0;
    });

    spawnTimers.forEach(ro=>{ ro.timer-=d; if(ro.timer<=0){ doSpawn(ro); ro.timer=ro.interval; } });
  });

  onKeyPress(["up","w"], ()=>{ if(gameActive&&onGround){ velY=-chosenChar.jumpForce; onGround=false; sfx("jump",{vol:0.4,detune:vary(100),x:player.pos.x}); } });
  onKeyPress("z", doPunch);
  onKeyPress("escape", ()=>go("select"));
});

// ============================================================
// Transition scenes (fixed() so a residual camera shake can't drag them)
// ============================================================
scene("levelclear",({char,levelIdx=0,score=0}={})=>{
  sfx("level_clear");
  const lv=LEVELS[levelIdx], nx=LEVELS[levelIdx+1];
  add([rect(GAME_W,GAME_H),pos(0,0),color(...lv.skyColor),fixed()]);
  add([text(lv.name+" CLEARED!",{size:30,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2-84),anchor("center"),color(...C_ACCENT),fixed()]);
  add([text("SCORE  "+score.toString().padStart(6,"0"),{size:20,font:FONT}),pos(GAME_W/2,GAME_H/2-34),anchor("center"),color(...C_TEXT),fixed()]);
  add([rect(300,1),pos(GAME_W/2,GAME_H/2+6),anchor("center"),color(...C_MUTED),fixed()]);
  add([text("NEXT: "+nx.name,{size:20,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2+30),anchor("center"),color(...C_ACCENT),fixed()]);
  add([text(nx.subtitle,{size:13,font:FONT}),pos(GAME_W/2,GAME_H/2+60),anchor("center"),color(...C_MUTED),fixed()]);
  add([text("PRESS ENTER TO CONTINUE",{size:14,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2+96),anchor("center"),color(...C_TEXT),fixed()]);
  onKeyPress(["enter","space"],()=>go("game",{char,levelIdx:levelIdx+1,score}));
  onKeyPress("escape",()=>go("select"));
});

scene("wingame",({score=0}={})=>{
  sfx("win");
  add([rect(GAME_W,GAME_H),pos(0,0),color(10,10,18),fixed()]);
  add([text("SAN FRANCISCO CONQUERED!",{size:28,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2-94),anchor("center"),color(...C_ACCENT),fixed()]);
  add([text("MISSION · HAIGHT · TENDERLOIN",{size:13,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2-58),anchor("center"),color(...C_MUTED),fixed()]);
  add([text("ALL CLEARED.",{size:18,font:FONT}),pos(GAME_W/2,GAME_H/2-30),anchor("center"),color(...C_TEXT),fixed()]);
  add([rect(300,1),pos(GAME_W/2,GAME_H/2-4),anchor("center"),color(...C_MUTED),fixed()]);
  add([text(score.toString().padStart(6,"0"),{size:48,font:FONT}),pos(GAME_W/2,GAME_H/2+28),anchor("center"),color(...C_ACCENT),fixed()]);
  add([text("FINAL SCORE",{size:12,font:FONT,letterSpacing:2}),pos(GAME_W/2,GAME_H/2+72),anchor("center"),color(...C_MUTED),fixed()]);
  add([text("PRESS ENTER TO PLAY AGAIN",{size:14,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2+100),anchor("center"),color(...C_MUTED),fixed()]);
  onKeyPress(["enter","space"],()=>go("select"));
});

scene("gameover",({score=0,levelIdx=0}={})=>{
  sfx("game_over");
  const lv=LEVELS[levelIdx];
  add([rect(GAME_W,GAME_H),pos(0,0),color(18,10,10),fixed()]);
  add([text("GAME OVER",{size:44,font:FONT,letterSpacing:3}),pos(GAME_W/2,GAME_H/2-58),anchor("center"),color(...C_ACCENT),fixed()]);
  add([text("FELL IN "+lv.name,{size:14,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2-10),anchor("center"),color(...C_MUTED),fixed()]);
  add([text("SCORE: "+score.toString().padStart(6,"0"),{size:18,font:FONT}),pos(GAME_W/2,GAME_H/2+20),anchor("center"),color(...C_TEXT),fixed()]);
  add([text("PRESS ENTER TO TRY AGAIN",{size:14,font:FONT,letterSpacing:1}),pos(GAME_W/2,GAME_H/2+54),anchor("center"),color(...C_MUTED),fixed()]);
  onKeyPress(["enter","space"],()=>go("select"));
});

go("select");
