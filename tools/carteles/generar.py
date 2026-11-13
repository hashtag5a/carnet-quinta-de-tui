#!/usr/bin/env python3
"""Genera los carteles del fin de semana de A Quinta para redes.

Lee los partidos que el bot de Futgal dejó en el panel (Supabase carnet-quinta-de-tui) y los
escudos y fondos del generador A Quinta Calendarios, y dibuja con el mismo motor que la app:
  - Feed 4:5 (1080x1350), 3 partidos por imagen
  - Story 9:16 (1080x1920), 3 partidos por imagen
  - Story 9:16 con todos los partidos

Uso:
  python3 tools/carteles/generar.py --panel panel.json --escudos escudos.json \
      [--fondo fondo.json] [--finde 2026-11-14] [--salida carteles]

panel.json   lista [{col, id, data}] de panel_docs (cols partidos, equipos, pabellones)
escudos.json lista de filas de la tabla crests (name, aliases, logo_path, is_own, short_name)
--escudos-panel (opcional) filas [{id, data}] de panel_docs col «escudos» (los baja el bot futgal-escudos)
fondo.json   (opcional) una fila de la tabla backgrounds (name, image_path, image_feed_path, dim)
--finde      el sábado del fin de semana (por defecto, el próximo; si hoy es sáb/dom, este)
Necesita: playwright de Python con Chromium.
"""
import argparse, base64, re, datetime as dt, functools, http.server, json, os, shutil, sys, threading, urllib.parse, urllib.request, zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
STORAGE = 'https://uqgbbclcryvyzhqxdkqb.supabase.co/storage/v1/object/public/team-logos/'   # app A Quinta Calendarios
STORAGE_PANEL = 'https://lctgskyabnkowrlgolhv.supabase.co/storage/v1/object/public/escudos/'  # bot futgal-escudos


def proximo_sabado(hoy):
    wd = hoy.weekday()  # lun=0 … dom=6
    if wd == 6:
        return hoy - dt.timedelta(days=1)
    return hoy + dt.timedelta(days=(5 - wd))


def a_partidos(panel, sabado):
    C = {'partidos': {}, 'equipos': {}, 'pabellones': {}}
    for r in panel:
        if r.get('col') in C:
            C[r['col']][r['id']] = r['data']
    desde, hasta = (sabado - dt.timedelta(days=1)).isoformat(), (sabado + dt.timedelta(days=1)).isoformat()
    teams, matches, fuera = {}, [], []
    for pid, p in C['partidos'].items():
        f = p.get('fecha') or ''
        if not (desde <= f <= hasta) or p.get('estado') in ('cancelado', 'aplazado'):
            continue
        e = C['equipos'].get(p.get('equipoId'))
        if not e:
            fuera.append(f"{f} {p.get('rival', '?')}: equipo «{p.get('equipoId')}» no está en el panel")
            continue
        hora = (p.get('hora') or p.get('futgalHora') or '').strip()
        if p.get('casa'):
            pab = C['pabellones'].get(p.get('pabellonId') or '', {}).get('nombre', '')
            venue = p.get('futgalCampo') or pab
        else:
            venue = p.get('lugar') or p.get('futgalCampo') or ''
        if not hora or not venue:
            fuera.append(f"{f} {e.get('categoria', '')} {e.get('nombre', '')} – {p.get('rival', '?')}: falta {'la hora' if not hora else 'el pabellón'}")
            continue
        teams[p['equipoId']] = {'id': p['equipoId'], 'name': e.get('nombre') or 'A Quinta F.S.', 'category': e.get('categoria', ''), 'sponsor': ''}
        jor = str(p.get('jornadaFutgal') or '').strip()
        matches.append({'id': pid, 'team_id': p['equipoId'], 'opponent': p.get('rival') or 'Rival', 'opponent_sponsor': None,
                        'opponent_logo_path': None, 'match_date': f, 'match_time': hora[:5] + ':00', 'venue': venue,
                        'is_home': bool(p.get('casa')), 'group_name': e.get('categoria', ''),
                        'round': int(jor) if jor.isdigit() else None, 'estado': p.get('estado')})
    return matches, list(teams.values()), fuera


def archivo(p):
    return re.sub(r'[^A-Za-z0-9._-]', '_', p)  # igual que en cartel.html


def limpiar_escudo(ruta):
    """Escudos de Futgal: quita el fondo blanco que toca los bordes y los agranda a 400 px."""
    try:
        from PIL import Image
        im = Image.open(ruta).convert('RGBA')
        w, h = im.size
        px = im.load()
        blanco = lambda c: c[3] > 0 and c[0] > 232 and c[1] > 232 and c[2] > 232
        pila = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
        visto = set()
        while pila:
            x, y = pila.pop()
            if (x, y) in visto or not (0 <= x < w and 0 <= y < h):
                continue
            visto.add((x, y))
            if not blanco(px[x, y]):
                continue
            px[x, y] = (255, 255, 255, 0)
            pila += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        caja = im.getbbox()
        if caja:
            im = im.crop(caja)
        lado = max(im.size)
        if lado < 400:
            f = 400 / lado
            im = im.resize((round(im.size[0] * f), round(im.size[1] * f)), Image.LANCZOS)
        im.save(ruta, 'PNG')
    except Exception:
        pass


def descargar(paths, carpeta):
    os.makedirs(carpeta, exist_ok=True)
    fallos = []
    for p in sorted({x for x in paths if x}):
        dest = os.path.join(carpeta, archivo(p))
        if os.path.exists(dest):
            continue
        url = STORAGE_PANEL + urllib.parse.quote(p[6:]) if p.startswith('panel:') else STORAGE + urllib.parse.quote(p)
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                open(dest, 'wb').write(r.read())
            if p.startswith('panel:'):
                limpiar_escudo(dest)
        except Exception as ex:  # el cartel sale igual, con iniciales
            fallos.append(f'{p}: {ex}')
    return fallos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', required=True)
    ap.add_argument('--escudos', required=True)
    ap.add_argument('--escudos-panel')
    ap.add_argument('--fondo')
    ap.add_argument('--finde')
    ap.add_argument('--salida', default='carteles')
    a = ap.parse_args()

    hoy = dt.date.today()
    sabado = dt.date.fromisoformat(a.finde) if a.finde else proximo_sabado(hoy)
    panel = json.load(open(a.panel, encoding='utf-8'))
    crests = json.load(open(a.escudos, encoding='utf-8')) or []
    if a.escudos_panel:  # los del bot van detrás: si un club está en los dos, manda el de la app
        for r in json.load(open(a.escudos_panel, encoding='utf-8')) or []:
            d = r.get('data', r)
            if d.get('path'):
                crests.append({'name': d.get('nombre') or d.get('nombreFutgal') or '', 'aliases': [x for x in [d.get('nombreFutgal')] if x],
                               'logo_path': 'panel:' + d['path'], 'is_own': bool(d.get('propio')), 'short_name': None})
        propios = [c for c in crests if c.get('is_own')]
        for c in propios[1:]:
            c['is_own'] = False  # el primero (el de la app) es el escudo de A Quinta
    fondo = json.load(open(a.fondo, encoding='utf-8')) if a.fondo else None
    if isinstance(fondo, list):
        fondo = fondo[0] if fondo else None

    matches, teams, fuera = a_partidos(panel, sabado)
    informe = {'finde': sabado.isoformat(), 'partidos': len(matches), 'sin_confirmar_en_panel': sum(m['estado'] != 'confirmado' for m in matches),
               'fuera_del_cartel': fuera, 'sin_escudo': [], 'avisos': [], 'archivos': []}
    if not matches:
        informe['avisos'].append('No hay partidos con hora y pabellón para ese fin de semana.')
        print(json.dumps(informe, ensure_ascii=False, indent=1))
        return 2

    esc_dir = os.path.join(AQUI, 'escudos')
    paths = [c.get('logo_path') for c in crests] + ([fondo.get('image_path'), fondo.get('image_feed_path')] if fondo else [])
    informe['avisos'] += [f'No se pudo descargar {x}' for x in descargar(paths, esc_dir)]
    crests = [c for c in crests if c.get('logo_path') and os.path.exists(os.path.join(esc_dir, archivo(c['logo_path'])))]
    datos = {'matches': matches, 'teams': teams, 'crests': crests,
             'background': ({'name': fondo.get('name'), 'image_path': fondo.get('image_path'), 'image_feed_path': fondo.get('image_feed_path'), 'dim': fondo.get('dim', 0.5)} if fondo else None)}

    salida = os.path.abspath(a.salida)
    os.makedirs(salida, exist_ok=True)

    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x): pass
        def guess_type(self, p): return 'text/javascript' if p.endswith(('.js', '.mjs')) else super().guess_type(p)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=AQUI))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/cartel.html')
        pg.wait_for_function('window.ready', timeout=30000)
        missing = set()
        for fmt, batch in [('4:5', '3'), ('9:16', '3'), ('9:16', 'all')]:
            r = pg.evaluate('([d, o]) => window.render(d, o)', [datos, {'format': fmt, 'batch': batch}])
            missing.update(r['missing'])
            for im in r['images']:
                ruta = os.path.join(salida, im['name'])
                open(ruta, 'wb').write(base64.b64decode(im['data'].split(',')[1]))
                informe['archivos'].append(ruta)
        b.close()
        if errs:
            informe['avisos'] += errs
    srv.shutdown()

    informe['sin_escudo'] = sorted(missing)
    zp = os.path.join(salida, f'carteles-a-quinta-{sabado.isoformat()}.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in informe['archivos']:
            z.write(f, os.path.basename(f))
    informe['zip'] = zp
    print(json.dumps(informe, ensure_ascii=False, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
