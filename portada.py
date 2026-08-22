"""portada.py — La página pública del canal.

El visor de `/` es la pantalla que OBS captura para el directo: gráficos a
pantalla completa, pensados para verse en un video. Esto es otra cosa —
una página web para que la gente entre, se entere de cuándo es la próxima
sesión, lea las noticias del motor y encuentre el directo.

De dónde sale cada dato (todo ya existía, aquí solo se pinta):

    /apex      cuenta atrás, calendario, clasificaciones, qué hay al aire
    /noticias  titulares con su medio, su enlace y su foto
    /shorts    los videos que el canal ya subió a YouTube

Sobre las imágenes, que es donde es fácil meterse en un lío: la miniatura
de una noticia es la que el propio medio publica en su RSS, y se muestra
como preview del enlace — su nombre al lado y clic a su artículo. No se
copia el texto de nadie; se manda el tráfico a quien lo escribió, igual
que hacen Google News o Flipboard. Cuando un medio no da foto, queda el
marco vacío y no pasa nada. Las miniaturas de video son las de nuestros
propios videos de YouTube.
"""

HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>APEX — Motorsport, all of it</title>
<meta name="description" content="Live motorsport coverage, news from every
series and championship standings.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #08090C; --sur: #0F1218; --sur2: #12161D; --alt: #0A0C11;
    --line: #232B37; --soft: #1A2029; --hair: #14181F;
    --txt: #F5F7FA; --dim: #8992A3; --dim2: #5C6474;
    --acc: #FF2D16;
    --f1: #FF2D16; --motogp: #FFB020; --nascar: #2FC4E0;
    --indycar: #31D97A; --wec: #A78BFA;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: var(--bg); color: var(--txt);
         font-family: Barlow, "Segoe UI", system-ui, sans-serif;
         -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  h1, h2, h3 { font-family: Archivo, "Helvetica Neue", Arial, sans-serif; }
  .num { font-family: "Barlow Condensed", Barlow, sans-serif;
         font-variant-numeric: tabular-nums; }
  .wrap { max-width: 1440px; margin: 0 auto; }

  /* ── cabecera ── */
  header { position: sticky; top: 0; z-index: 60; background: var(--bg);
           border-bottom: 1px solid var(--line); }
  .hd { display: flex; align-items: center; gap: 40px; height: 68px;
        padding: 0 40px; }
  .mark { display: flex; align-items: center; gap: 11px; flex: none; }
  .mark span { font-family: Archivo, sans-serif; font-weight: 900;
               font-size: 23px; letter-spacing: -.015em; }
  nav { display: flex; align-items: center; gap: 30px; }
  nav a { position: relative; font-size: 13px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; color: var(--dim);
          padding: 24px 0; transition: color .15s; }
  nav a:hover, nav a.on { color: var(--txt); }
  nav a.on::after { content: ""; position: absolute; left: 0; right: 0;
                    bottom: -1px; height: 2px; background: var(--acc); }
  .hdr { margin-left: auto; display: flex; align-items: center; gap: 16px; }
  .onair { display: none; align-items: center; gap: 8px; padding: 6px 12px;
           border: 1px solid var(--acc); border-radius: 2px; }
  .onair.show { display: flex; }
  .onair b { font-size: 11px; font-weight: 700; letter-spacing: .16em;
             color: var(--acc); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--acc);
         animation: bl 1.5s infinite; flex: none; }
  @keyframes bl { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
  .btn { display: flex; align-items: center; justify-content: center;
         gap: 9px; height: 38px; padding: 0 20px; background: var(--acc);
         color: #fff; font-size: 12px; font-weight: 700; letter-spacing: .12em;
         text-transform: uppercase; border-radius: 2px; white-space: nowrap;
         transition: filter .15s; }
  .btn:hover { filter: brightness(1.12); }
  .burger { display: none; background: none; border: 0; cursor: pointer;
            padding: 8px; }

  /* ── hero ── */
  .hero { position: relative; overflow: hidden; background: var(--alt);
          border-bottom: 1px solid var(--line); }
  .hero .in { position: relative; display: grid;
              grid-template-columns: 1.34fr 1fr; gap: 52px;
              align-items: start; padding: 52px 40px 46px; }
  .trace { position: absolute; right: -60px; top: -30px; opacity: .06;
           pointer-events: none; }
  .eyebrow { display: flex; align-items: center; gap: 12px; }
  .eyebrow i { width: 30px; height: 3px; background: var(--acc); }
  .eyebrow span { font-size: 12px; font-weight: 700; letter-spacing: .2em;
                  text-transform: uppercase; color: var(--dim); }
  .hero h1 { font-weight: 900; font-size: clamp(34px, 5vw, 66px);
             line-height: .95; letter-spacing: -.028em; text-transform: uppercase;
             text-wrap: balance; }
  .hero .circ { font-size: 16px; font-weight: 500; letter-spacing: .04em;
                color: var(--dim); }
  .cd { display: flex; align-items: flex-end; }
  .cd div { display: flex; flex-direction: column; gap: 4px;
            padding-right: 26px; margin-right: 26px;
            border-right: 1px solid var(--line); }
  .cd b { font-size: clamp(34px, 4vw, 54px); font-weight: 700;
          line-height: .9; letter-spacing: -.01em; }
  .cd i { font-size: 11px; font-weight: 600; letter-spacing: .18em;
          text-transform: uppercase; color: var(--dim2); font-style: normal; }
  .ses { display: flex; flex-wrap: wrap; gap: 10px; }
  .ses div { display: flex; flex-direction: column; gap: 3px;
             padding: 10px 18px 11px; background: var(--sur);
             border: 1px solid var(--line); border-top: 2px solid var(--line);
             border-radius: 2px; }
  .ses div.next { border-top-color: var(--acc); }
  .ses b { font-size: 11px; font-weight: 700; letter-spacing: .14em;
           text-transform: uppercase; color: var(--dim); }
  .ses span { font-size: 19px; font-weight: 600; }

  .live { display: flex; flex-direction: column; background: var(--sur);
          border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
  .shot { position: relative; overflow: hidden; background: var(--sur2);
          display: flex; align-items: center; justify-content: center; }
  .shot img { position: absolute; inset: 0; width: 100%; height: 100%;
              object-fit: cover; }
  .shot iframe { position: absolute; inset: 0; width: 100%; height: 100%;
                 border: 0; }
  .shot .lines { position: absolute; inset: 0; width: 100%; height: 100%;
                 opacity: .3; }
  .play { position: relative; display: flex; align-items: center;
          justify-content: center; width: 62px; height: 62px;
          background: rgba(8,9,12,.55); border: 2px solid var(--acc);
          border-radius: 50%; }
  .tag { position: absolute; top: 14px; left: 14px; display: flex;
         align-items: center; gap: 7px; padding: 5px 11px; border-radius: 2px;
         font-size: 10px; font-weight: 800; letter-spacing: .14em; }
  .live .body { display: flex; flex-direction: column; gap: 14px;
                padding: 20px 22px 22px; }
  .lbl { font-size: 11px; font-weight: 700; letter-spacing: .18em;
         text-transform: uppercase; color: var(--dim2); }
  .live .now { font-size: 19px; font-weight: 600; line-height: 1.25; }
  .live .next { display: flex; align-items: center; gap: 8px;
                padding-top: 13px; border-top: 1px solid var(--soft);
                font-size: 13px; color: var(--dim); }
  .live .btn { height: 46px; font-size: 13px; }

  /* ── ticker ── */
  .tick { display: flex; align-items: center; height: 46px;
          background: var(--sur); border-bottom: 1px solid var(--line);
          overflow: hidden; }
  .tick .badge { flex: none; display: flex; align-items: center; gap: 8px;
                 height: 100%; padding: 0 20px; background: var(--acc); }
  .tick .badge b { font-size: 11px; font-weight: 800; letter-spacing: .18em;
                   color: #fff; }
  .tick .badge .dot { background: #fff; }
  .tick .track { flex: 1; position: relative; height: 100%; overflow: hidden; }
  .tick .run { position: absolute; top: 0; left: 0; height: 100%;
               display: flex; align-items: center; white-space: nowrap;
               animation: crawl 60s linear infinite; }
  .tick:hover .run { animation-play-state: paused; }
  @keyframes crawl { from { transform: translateX(0); }
                     to { transform: translateX(-50%); } }
  .tick .it { display: inline-flex; align-items: center; gap: 11px;
              padding: 0 26px; border-right: 1px solid var(--soft); }
  .tick .it b { font-size: 11px; font-weight: 800; letter-spacing: .1em; }
  .tick .it span { font-size: 14px; font-weight: 500; color: #C9D0DB; }

  /* ── secciones ── */
  section { border-bottom: 1px solid var(--line); }
  section.alt { background: var(--alt); }
  .sec { padding: 46px 40px 44px; }
  .shead { display: flex; align-items: flex-end; gap: 24px;
           margin-bottom: 26px; flex-wrap: wrap; }
  .shead .t { display: flex; flex-direction: column; gap: 8px; }
  .shead .kick { font-size: 12px; font-weight: 700; letter-spacing: .2em;
                 text-transform: uppercase; color: var(--acc); }
  .shead h2 { font-weight: 800; font-size: clamp(24px, 3vw, 34px);
              line-height: 1; letter-spacing: -.022em; text-transform: uppercase; }
  .more { margin-left: auto; display: flex; align-items: center; gap: 9px;
          font-size: 12px; font-weight: 700; letter-spacing: .12em;
          text-transform: uppercase; color: var(--dim); }
  .more:hover { color: var(--txt); }
  .chips { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
  .chp { font-size: 12px; font-weight: 600; letter-spacing: .1em;
         text-transform: uppercase; color: var(--dim); padding: 7px 14px;
         background: none; border: 1px solid var(--line); border-radius: 2px;
         cursor: pointer; font-family: inherit; transition: all .15s; }
  .chp:hover { color: var(--txt); border-color: #3A4454; }
  .chp.on { color: var(--txt); border-color: #3A4454; background: #171B22; }

  /* ── noticias ── */
  .news { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 22px; }
  .lead { display: flex; flex-direction: column; background: var(--sur);
          border: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
  .lead .shot { height: 250px; }
  .lead .body { display: flex; flex-direction: column; gap: 14px;
                padding: 20px 22px 22px; flex: 1; }
  .lead h3 { font-weight: 700; font-size: clamp(21px, 2.2vw, 29px);
             line-height: 1.1; letter-spacing: -.02em; text-wrap: pretty;
             transition: color .15s; }
  .lead:hover h3 { color: var(--acc); }
  .lead .foot { display: flex; align-items: center; gap: 9px; margin-top: auto;
                padding-top: 6px; }
  .lead .src { font-size: 12px; font-weight: 700; letter-spacing: .12em;
               text-transform: uppercase; color: var(--acc); }
  .col { display: flex; flex-direction: column; }
  .item { display: flex; gap: 14px; padding: 16px 0 17px;
          border-bottom: 1px solid var(--soft); }
  .item .shot { flex: none; width: 104px; height: 78px; border-radius: 2px; }
  .item .tx { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .item h4 { font-size: 16px; font-weight: 600; line-height: 1.28;
             letter-spacing: -.008em; text-wrap: pretty; transition: color .15s; }
  .item:hover h4 { color: var(--acc); }
  .meta { display: flex; align-items: center; gap: 9px; }
  .meta b { font-size: 10px; font-weight: 800; letter-spacing: .14em; }
  .meta span { font-size: 12px; font-weight: 500; color: var(--dim2); }
  .src2 { font-size: 10px; font-weight: 600; letter-spacing: .1em;
          text-transform: uppercase; color: var(--dim2); }

  /* ── videos ── */
  .vids { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 20px; }
  .vid { display: flex; flex-direction: column; background: var(--sur);
         border: 1px solid var(--line); border-radius: 2px; overflow: hidden; }
  .vid .shot { height: 174px; }
  .vid .play { width: 44px; height: 44px; border-width: 1.5px; }
  .dur { position: absolute; right: 9px; bottom: 9px; padding: 3px 7px;
         background: rgba(8,9,12,.85); border-radius: 2px; font-size: 12px;
         font-weight: 600; }
  .vid .body { display: flex; flex-direction: column; gap: 8px;
               padding: 15px 16px 17px; }
  .vid h4 { font-size: 16px; font-weight: 600; line-height: 1.28;
            letter-spacing: -.008em; text-wrap: pretty; transition: color .15s; }
  .vid:hover h4 { color: var(--acc); }

  /* ── tablas ── */
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; }
  .tab { display: flex; flex-direction: column; }
  .th { display: flex; align-items: center; gap: 14px; padding-bottom: 12px;
        border-bottom: 2px solid var(--line); }
  .th h3 { font-weight: 800; font-size: 18px; letter-spacing: .01em;
           text-transform: uppercase; }
  .th i { font-size: 10px; font-weight: 700; letter-spacing: .14em;
          text-transform: uppercase; color: var(--dim2); font-style: normal;
          text-align: right; }
  .th .w { margin-left: auto; width: 58px; }
  .th .p { width: 62px; }
  .tr { display: flex; align-items: center; gap: 14px; padding: 11px 0;
        border-bottom: 1px solid var(--hair); }
  .tr .pos { width: 24px; font-size: 20px; font-weight: 700; color: var(--dim2); }
  .tr.top .pos { color: var(--acc); }
  .tr .bar { width: 3px; height: 28px; border-radius: 1px; flex: none; }
  .tr .nm { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .tr .nm b { font-size: 15px; font-weight: 600; letter-spacing: -.005em; }
  .tr .nm span { font-size: 11px; font-weight: 500; letter-spacing: .08em;
                 text-transform: uppercase; color: var(--dim2); }
  .tr .w { margin-left: auto; width: 58px; text-align: right; font-size: 17px;
           font-weight: 600; color: var(--dim); }
  .tr .p { width: 62px; text-align: right; font-size: 21px; font-weight: 700; }

  /* ── calendario ── */
  .rounds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 20px; }
  .rd { display: flex; flex-direction: column; gap: 14px;
        padding: 18px 20px 20px; background: var(--sur);
        border: 1px solid var(--line); border-left: 3px solid var(--line);
        border-radius: 2px; }
  .rd.next { border-left-color: var(--acc); }
  .rd .top { display: flex; align-items: baseline; gap: 9px; }
  .rd .top i { font-size: 10px; font-weight: 700; letter-spacing: .16em;
               color: var(--dim2); font-style: normal; }
  .rd .top b { font-size: 22px; font-weight: 700; line-height: 1; }
  .rd .when { margin-left: auto; font-size: 13px; font-weight: 600;
              letter-spacing: .06em; color: var(--dim); }
  .rd.next .when { color: var(--acc); }
  .rd .gp { font-size: 17px; font-weight: 700; line-height: 1.18;
            letter-spacing: -.01em; text-transform: uppercase; }
  .rd .cir { font-size: 12px; font-weight: 500; color: var(--dim2); }
  .rd .chips2 { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 12px;
                border-top: 1px solid var(--soft); }
  .rd .chips2 span { font-size: 10px; font-weight: 700; letter-spacing: .1em;
                     text-transform: uppercase; color: var(--dim);
                     padding: 4px 8px; background: #151A22; border-radius: 2px; }

  /* ── pie ── */
  footer { display: flex; align-items: flex-start; gap: 48px;
           padding: 34px 40px 38px; flex-wrap: wrap; }
  footer p { font-size: 12px; line-height: 1.6; color: var(--dim2);
             max-width: 430px; }
  .fcols { margin-left: auto; display: flex; gap: 56px; flex-wrap: wrap; }
  .fcol { display: flex; flex-direction: column; gap: 9px; }
  .fcol i { font-size: 10px; font-weight: 700; letter-spacing: .18em;
            text-transform: uppercase; color: var(--dim2); font-style: normal; }
  .fcol a { font-size: 13px; font-weight: 500; color: var(--dim); }
  .fcol a:hover { color: var(--txt); }

  .empty { padding: 40px 0; font-size: 14px; color: var(--dim2); }

  /* ── responsive ── */
  @media (max-width: 1100px) {
    .news { grid-template-columns: 1fr 1fr; }
    .lead { grid-column: 1 / -1; }
    .vids, .rounds { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 860px) {
    .hd { gap: 16px; padding: 0 20px; }
    nav { display: none; }
    nav.open { display: flex; position: absolute; top: 68px; left: 0;
               right: 0; flex-direction: column; gap: 0; padding: 8px 20px 16px;
               background: var(--bg); border-bottom: 1px solid var(--line); }
    nav.open a { padding: 13px 0; }
    nav.open a.on::after { display: none; }
    .burger { display: block; }
    .hero .in { grid-template-columns: 1fr; gap: 30px; padding: 32px 20px 30px; }
    .sec { padding: 32px 20px 30px; }
    .news { grid-template-columns: 1fr; }
    .tabs { grid-template-columns: 1fr; gap: 30px; }
    .vids, .rounds { grid-template-columns: 1fr; }
    footer { padding: 26px 20px 30px; gap: 26px; }
    .fcols { margin-left: 0; gap: 32px; }
    .cd div { padding-right: 15px; margin-right: 15px; }
  }
</style>
</head>
<body>

<header>
 <div class="wrap hd">
  <a href="#" class="mark">
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M10 5 L24 5 L21 9.5 L7 9.5 Z" fill="#FF2D16"/>
      <path d="M6.5 12 L20.5 12 L17.5 16.5 L3.5 16.5 Z" fill="#FF2D16" opacity=".62"/>
      <path d="M3 19 L17 19 L14 23.5 L0 23.5 Z" fill="#FF2D16" opacity=".3"/>
    </svg>
    <span>APEX</span>
  </a>
  <nav id="nav">
    <a href="#live" class="on">Live</a>
    <a href="#news">News</a>
    <a href="#watch">Watch</a>
    <a href="#standings">Standings</a>
    <a href="#schedule">Schedule</a>
  </nav>
  <div class="hdr">
    <div class="onair" id="onair"><i class="dot"></i><b>ON AIR</b></div>
    <a class="btn" id="watchTop" href="#watch">
      <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true"><path d="M0 0 L11 6.5 L0 13 Z" fill="currentColor"/></svg>
      Watch
    </a>
    <button class="burger" id="burger" aria-label="Menu">
      <svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
        <path d="M0 1h22M0 8h22M0 15h22" stroke="#F5F7FA" stroke-width="1.6"/>
      </svg>
    </button>
  </div>
 </div>
</header>

<section class="hero" id="live">
 <svg class="trace" width="620" height="400" viewBox="0 0 620 400" fill="none" aria-hidden="true">
   <path d="M96 330 C40 300 34 224 84 190 C138 154 214 196 258 166 C312 130 286 60 342 44 C400 28 462 62 500 108 C544 162 566 236 522 288 C470 350 372 322 300 336 C226 350 152 362 96 330 Z" stroke="#F5F7FA" stroke-width="14" stroke-linejoin="round"/>
 </svg>
 <div class="wrap in">
  <div style="display:flex;flex-direction:column;gap:22px">
    <div class="eyebrow"><i></i><span id="kicker">Next session</span></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <h1 id="gp">Loading…</h1>
      <p class="circ" id="circuito"></p>
    </div>
    <div class="cd num" id="cd"></div>
    <div class="ses" id="ses"></div>
  </div>

  <div class="live">
    <a class="shot" id="liveShot" style="height:210px" href="#watch">
      <svg class="lines" viewBox="0 0 1000 210" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path d="M0 150 L1000 44" stroke="#232B37"/><path d="M0 176 L1000 70" stroke="#232B37"/><path d="M0 124 L1000 18" stroke="#232B37"/>
      </svg>
      <span class="play"><svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true"><path d="M1 0 L17 10 L1 20 Z" fill="#FF2D16"/></svg></span>
      <span class="tag" id="liveTag" style="display:none;background:#FF2D16;color:#fff"><i class="dot" style="background:#fff"></i>LIVE</span>
    </a>
    <div class="body">
      <div style="display:flex;flex-direction:column;gap:6px">
        <span class="lbl">Now playing</span>
        <span class="now" id="ahora">—</span>
      </div>
      <div class="next"><span class="lbl">Up next</span><span id="siguiente">—</span></div>
      <span class="src2" id="msgDirecto"></span>
      <a class="btn" id="watchBtn" href="#watch">
        <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/></svg>
        Watch on YouTube
      </a>
    </div>
  </div>
 </div>
</section>

<div class="tick" id="tick" style="display:none">
  <div class="badge"><i class="dot"></i><b>LATEST</b></div>
  <div class="track"><div class="run" id="run"></div></div>
</div>

<section id="news">
 <div class="wrap sec">
  <div class="shead">
    <div class="t"><span class="kick">The paddock</span><h2>Motorsport news</h2></div>
    <div class="chips" id="chips"></div>
  </div>
  <div class="news" id="newsGrid"></div>
 </div>
</section>

<section class="alt" id="watch">
 <div class="wrap sec">
  <div class="shead">
    <div class="t"><span class="kick">From the channel</span><h2>Watch</h2></div>
    <a class="more" id="allVideos" href="#watch">All videos
      <svg width="13" height="9" viewBox="0 0 13 9" fill="none" aria-hidden="true"><path d="M0 4.5 H11 M7.5 1 L11 4.5 L7.5 8" stroke="currentColor" stroke-width="1.5"/></svg>
    </a>
  </div>
  <div class="vids" id="vids"></div>
 </div>
</section>

<section id="standings">
 <div class="wrap sec">
  <div class="shead">
    <div class="t"><span class="kick" id="season">Formula 1</span><h2>Standings</h2></div>
  </div>
  <div class="tabs" id="tabs"></div>
 </div>
</section>

<section class="alt" id="schedule">
 <div class="wrap sec">
  <div class="shead"><div class="t"><h2>Coming up</h2></div></div>
  <div class="rounds" id="rounds"></div>
 </div>
</section>

<footer class="wrap">
  <div style="display:flex;flex-direction:column;gap:11px">
    <div class="mark">
      <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M10 5 L24 5 L21 9.5 L7 9.5 Z" fill="#FF2D16"/>
        <path d="M6.5 12 L20.5 12 L17.5 16.5 L3.5 16.5 Z" fill="#FF2D16" opacity=".62"/>
        <path d="M3 19 L17 19 L14 23.5 L0 23.5 Z" fill="#FF2D16" opacity=".3"/>
      </svg>
      <span style="font-size:18px">APEX</span>
    </div>
    <p>An independent motorsport channel. Not associated with, endorsed by, or
       affiliated with Formula 1, the FIA, or any championship or team. All
       trademarks belong to their owners.</p>
    <p>Headlines and thumbnails are link previews credited to the publisher and
       link to the original article. Archive photography is used under Creative
       Commons licences.</p>
  </div>
  <div class="fcols">
    <div class="fcol"><i>Channel</i>
      <a href="#live">Live stream</a><a href="#watch">Watch</a><a href="/podcast.xml">Podcast</a>
    </div>
    <div class="fcol"><i>Sections</i>
      <a href="#news">News</a><a href="#standings">Standings</a><a href="#schedule">Schedule</a>
    </div>
  </div>
</footer>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Solo se pinta una URL de imagen si es https de verdad. Un feed es texto
// que escribe otro: sin esto un href raro entraria tal cual en el HTML.
function urlOk(u) {
  try { return new URL(u).protocol === "https:"; } catch (e) { return false; }
}
const LINEAS = '<svg class="lines" viewBox="0 0 300 200" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M0 168 L300 90" stroke="#232B37"/><path d="M0 200 L300 122" stroke="#232B37"/></svg>';
const foto = (u) => urlOk(u)
  ? '<img loading="lazy" src="' + esc(u) + '" alt="">' : LINEAS;

let NOTICIAS = [], FILTRO = "", proxima = null;

// ── cuenta atras ──────────────────────────────────────────────────────
function pintarCuenta() {
  if (!proxima) return;
  let s = Math.max(0, Math.floor((proxima - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);    s -= m * 60;
  const dd = (n) => String(n).padStart(2, "0");
  $("#cd").innerHTML = [[dd(d), "Days"], [dd(h), "Hrs"], [dd(m), "Min"],
                        [dd(s), "Sec"]]
    .map(([v, k]) => "<div><b>" + v + "</b><i>" + k + "</i></div>").join("");
}

// ── noticias ──────────────────────────────────────────────────────────
function pintarNoticias() {
  const lista = FILTRO ? NOTICIAS.filter((n) => n.serie === FILTRO) : NOTICIAS;
  const g = $("#newsGrid");
  if (!lista.length) {
    g.innerHTML = '<p class="empty">No headlines right now — the feed '
      + 'refreshes every few minutes.</p>';
    return;
  }
  const [lead, ...resto] = lista;
  const href = (n) => urlOk(n.link)
    ? ' href="' + esc(n.link) + '" target="_blank" rel="noopener noreferrer"' : "";
  let html = "<a class=\\"lead\\"" + href(lead) + ">"
    + '<div class="shot">' + foto(lead.imagen)
    + (lead.serie ? '<span class="tag" style="background:' + esc(lead.color)
        + ';color:#08090C">' + esc(lead.serie) + "</span>" : "")
    + '</div><div class="body"><h3>' + esc(lead.texto) + "</h3>"
    + '<div class="foot"><span class="src">' + esc(lead.fuente) + "</span>"
    + '<svg width="13" height="9" viewBox="0 0 13 9" fill="none" aria-hidden="true"><path d="M0 4.5 H11 M7.5 1 L11 4.5 L7.5 8" stroke="#FF2D16" stroke-width="1.5"/></svg>'
    + '<span class="num" style="margin-left:auto;font-size:13px;color:#5C6474">'
    + esc(lead.hora) + "</span></div></div></a>";

  const fila = (n) => "<a class=\\"item\\"" + href(n) + ">"
    + '<div class="shot" style="border-left:3px solid ' + esc(n.color) + '">'
    + foto(n.imagen) + '</div><div class="tx"><div class="meta">'
    + (n.serie ? '<b style="color:' + esc(n.color) + '">' + esc(n.serie) + "</b>" : "")
    + '<span class="num">' + esc(n.hora) + "</span></div><h4>"
    + esc(n.texto) + '</h4><span class="src2">' + esc(n.fuente)
    + "</span></div></a>";

  const mitad = Math.ceil(resto.length / 2);
  html += '<div class="col">' + resto.slice(0, mitad).slice(0, 4).map(fila).join("") + "</div>";
  html += '<div class="col">' + resto.slice(mitad).slice(0, 4).map(fila).join("") + "</div>";
  g.innerHTML = html;
}

function pintarChips() {
  const series = [];
  NOTICIAS.forEach((n) => {
    if (n.serie && series.indexOf(n.serie) < 0) series.push(n.serie);
  });
  if (!series.length) { $("#chips").innerHTML = ""; return; }
  $("#chips").innerHTML = ['<button class="chp' + (FILTRO ? "" : " on")
      + '" data-s="">All</button>']
    .concat(series.map((s) => '<button class="chp' + (FILTRO === s ? " on" : "")
      + '" data-s="' + esc(s) + '">' + esc(s) + "</button>")).join("");
  $("#chips").querySelectorAll(".chp").forEach((b) => {
    b.onclick = () => { FILTRO = b.dataset.s; pintarChips(); pintarNoticias(); };
  });
}

function pintarTicker() {
  if (!NOTICIAS.length) return;
  const it = (n) => '<span class="it"><b style="color:' + esc(n.color) + '">'
    + esc(n.serie || n.fuente) + "</b><span>" + esc(n.texto) + "</span></span>";
  // Se pinta dos veces: la animacion desplaza media pista, y con una sola
  // copia se veria el hueco al llegar al final.
  const uno = NOTICIAS.slice(0, 14).map(it).join("");
  $("#run").innerHTML = uno + uno;
  $("#tick").style.display = "flex";
}

// ── tablas ────────────────────────────────────────────────────────────
function tabla(titulo, filas, sub) {
  if (!filas || !filas.length) return "";
  const tr = (f) => '<div class="tr' + (f.pos === 1 ? " top" : "") + '">'
    + '<span class="pos num">' + esc(f.pos) + "</span>"
    + '<span class="bar" style="background:' + esc(f.color || "#8992A3") + '"></span>'
    + '<span class="nm"><b>' + esc(f.nombre) + "</b>"
    + (sub(f) ? "<span>" + esc(sub(f)) + "</span>" : "") + "</span>"
    + '<span class="w num">' + esc(f.wins == null ? "" : f.wins) + "</span>"
    + '<span class="p num">' + esc(Math.round(f.puntos)) + "</span></div>";
  return '<div class="tab"><div class="th"><h3>' + esc(titulo) + "</h3>"
    + '<i class="w">Wins</i><i class="p">Points</i></div>'
    + filas.slice(0, 10).map(tr).join("") + "</div>";
}

// ── calendario ────────────────────────────────────────────────────────
const MES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP",
             "OCT", "NOV", "DEC"];
function cuando(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return MES[d.getUTCMonth()] + " " + d.getUTCDate();
}

function pintarRondas(cal) {
  if (!cal || !cal.length) {
    $("#rounds").innerHTML = '<p class="empty">Calendar unavailable.</p>';
    return;
  }
  // El calendario llega sesion a sesion; en la portada interesa el fin de
  // semana entero, asi que se agrupan por circuito.
  const gps = [];
  cal.forEach((s) => {
    let gp = gps[gps.length - 1];
    if (!gp || gp.circuito !== s.circuito) {
      gp = { pais: s.pais, circuito: s.circuito, inicia: s.inicia, ses: [] };
      gps.push(gp);
    }
    if (gp.ses.indexOf(s.sesion) < 0) gp.ses.push(s.sesion);
  });
  $("#rounds").innerHTML = gps.slice(0, 4).map((g, i) =>
    '<div class="rd' + (i === 0 ? " next" : "") + '"><div class="top">'
    + "<i>ROUND</i><b class=\\"num\\">" + (i + 1) + "</b>"
    + '<span class="when num">' + esc(cuando(g.inicia)) + "</span></div>"
    + '<div style="display:flex;flex-direction:column;gap:4px">'
    + '<span class="gp">' + esc(g.pais) + '</span><span class="cir">'
    + esc(g.circuito) + "</span></div>"
    + '<div class="chips2">' + g.ses.slice(0, 4)
        .map((s) => "<span>" + esc(s) + "</span>").join("") + "</div></div>"
  ).join("");
}

// ── el directo ────────────────────────────────────────────────────────
// Con el ID del video se incrusta el reproductor de YouTube en la propia
// tarjeta (es el embed oficial, para eso está). Sin ID pero con canal, el
// botón lleva a /live. Sin ninguna de las dos no hay a dónde ir, así que
// el botón se esconde en vez de quedarse ahí sin hacer nada.
let videoPuesto = "";
function pintarDirecto(canal) {
  const destino = canal.video
    ? "https://www.youtube.com/watch?v=" + encodeURIComponent(canal.video)
    : (canal.directo || canal.canal || "");

  [$("#watchBtn"), $("#watchTop"), $("#liveShot")].forEach((a) => {
    if (destino) {
      a.href = destino;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.display = "";
    } else if (a !== $("#liveShot")) {
      a.style.display = "none";
    }
  });

  if (canal.video && canal.video !== videoPuesto) {
    videoPuesto = canal.video;
    $("#liveShot").innerHTML = '<iframe src="https://www.youtube.com/embed/'
      + encodeURIComponent(canal.video)
      + '?rel=0" title="Live stream" allow="accelerometer; autoplay; '
      + 'clipboard-write; encrypted-media; picture-in-picture" '
      + 'allowfullscreen></iframe>';
    // Ya no es un enlace: el reproductor se maneja solo dentro del marco.
    $("#liveShot").removeAttribute("href");
  }
  if (!destino) {
    $("#msgDirecto").textContent = "Set YOUTUBE_CHANNEL_ID to link the "
      + "channel here.";
  }
}

// ── carga ─────────────────────────────────────────────────────────────
async function cargar() {
  let d = {};
  try { d = await (await fetch("/apex")).json(); } catch (e) { return; }

  const ps = d.proxima_sesion;
  if (ps) {
    $("#gp").textContent = ps.pais || "Next round";
    $("#circuito").textContent = ps.sesion || "";
    $("#kicker").textContent = "Next session · " + (ps.sesion || "");
    const t = new Date(ps.inicia);
    proxima = isNaN(t) ? null : t.getTime();
    pintarCuenta();
  } else if (d.en_vivo) {
    $("#gp").textContent = d.gp || "Live now";
    $("#circuito").textContent = d.circuito || "";
    $("#kicker").textContent = "On track";
  }

  const cal = d.calendario || [];
  $("#ses").innerHTML = cal.slice(0, 4).map((s, i) =>
    '<div' + (i === 0 ? ' class="next"' : "") + "><b>" + esc(s.sesion)
    + '</b><span class="num">' + esc((s.horarios || {}).utc || cuando(s.inicia))
    + "</span></div>").join("");
  pintarRondas(cal);

  const enVivo = !!d.en_vivo;
  $("#onair").classList.toggle("show", enVivo);
  $("#liveTag").style.display = enVivo ? "flex" : "none";
  const prog = d.programa || {};
  $("#ahora").textContent = prog.titulo || (enVivo ? "Live session" : "Off air");
  $("#siguiente").textContent = d.proximo_programa || "—";
  pintarDirecto(d.canal || {});

  const st = d.standings || {};
  $("#tabs").innerHTML =
      tabla("Drivers", st.pilotos, (f) => f.equipo)
    + tabla("Constructors", st.equipos, () => "");
  if (!$("#tabs").innerHTML) {
    $("#tabs").innerHTML = '<p class="empty">Standings unavailable.</p>';
  }

  try {
    const n = await (await fetch("/noticias")).json();
    NOTICIAS = n.portada || n.noticias || [];
    pintarChips(); pintarNoticias(); pintarTicker();
  } catch (e) { /* la portada se ve igual sin noticias */ }

  try {
    const s = await (await fetch("/shorts")).json();
    const subidos = (s.shorts || []).filter((v) => v.youtube_id);
    if (subidos.length) {
      $("#vids").innerHTML = subidos.slice(0, 4).map((v) =>
        '<a class="vid" href="' + esc(v.youtube_url) + '" target="_blank" '
        + 'rel="noopener noreferrer"><div class="shot">'
        + '<img loading="lazy" src="https://i.ytimg.com/vi/'
        + encodeURIComponent(v.youtube_id) + '/hqdefault.jpg" alt="">'
        + '<span class="play"><svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0 L12 7 L0 14 Z" fill="#FF2D16"/></svg></span>'
        + '</div><div class="body"><span class="src2">'
        + esc(v.tipo || "Short") + "</span><h4>"
        + esc(v.titulo || "Untitled") + "</h4></div></a>").join("");
      const url = "https://www.youtube.com/watch?v=" + subidos[0].youtube_id;
      $("#allVideos").href = url;
    } else {
      $("#vids").innerHTML = '<p class="empty">No videos published yet.</p>';
    }
  } catch (e) {
    $("#vids").innerHTML = '<p class="empty">No videos published yet.</p>';
  }
}

$("#burger").onclick = () => $("#nav").classList.toggle("open");
$("#nav").querySelectorAll("a").forEach((a) => {
  a.onclick = () => {
    $("#nav").classList.remove("open");
    $("#nav").querySelectorAll("a").forEach((x) => x.classList.remove("on"));
    a.classList.add("on");
  };
});

cargar();
setInterval(cargar, 60000);   // los datos cambian despacio
setInterval(pintarCuenta, 1000);
</script>
</body>
</html>"""
