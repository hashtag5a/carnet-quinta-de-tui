# Carteles del fin de semana (bot)

Dibuja los carteles para redes con el mismo motor que la app A Quinta Calendarios (`motor.js`):
feed 4:5 y story 9:16 de 3 en 3, y una story con todos los partidos. Ordena por día y, dentro
del día, de la categoría más pequeña a la mayor.

Datos:
- Partidos, equipos y pabellones: `panel_docs` del proyecto Supabase `carnet-quinta-de-tui`
  (los deja el bot `futgal-calendario`, martes 19:00 y al abrir Generar calendario en el panel).
- Escudos: tabla `crests` de la app A Quinta Calendarios y los que baja de Futgal el bot
  `futgal-escudos` (martes 19:06 y también al abrir Generar calendario).

Lo lanza la tarea programada «Carteles A Quinta» de Claude los martes. A mano:

    python3 tools/carteles/generar.py --panel panel.json --escudos escudos.json \
        --escudos-panel escudos_panel.json [--fondo fondo.json] [--finde AAAA-MM-DD] --salida carteles

Los partidos sin hora o sin pabellón no entran y salen en el informe («fuera_del_cartel»).
