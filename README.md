# Assetto Track Creator

Diseña circuitos de conos tipo Formula Student sobre el mapa satélite y expórtalos como pista jugable de **Assetto Corsa**.

## Arranque

```bash
npm install
npm run dev
```

Abre http://localhost:5173. Para instalar las pistas directamente en el juego, la app busca Assetto Corsa en las bibliotecas de Steam; si está en otro sitio, arráncala con `ATC_AC_PATH=<carpeta de assettocorsa>`.

## Uso rápido

1. **Crear circuito** → *Delimitar área* (polígono o rectángulo). Fuera del área el mapa se oscurece y se activan el resto de herramientas.
2. **Track creator**: traza la pista por puntos, con la pluma Bézier o a mano alzada. Ancho de 3 m por defecto (simétrico o por lado, arrastrando los bordes discontinuos) y conos automáticos cada 5 m: azules a la izquierda y amarillos a la derecha.
3. **Salida / Meta** (obligatoria) y **Sectores**: clic sobre la pista.
4. **Conos** manuales (azul, amarillo, naranja, naranja grande) y **Tipo de suelo** (asfalto, césped o grava). La opción *Hitbox* de la herramienta Conos afecta a todos los conos:
   - **Activada:** los conos son objetos físicos de AC que el coche derriba y arrastra, con la masa de un cono real (**0,45 kg**). **Requiere Custom Shaders Patch con la física extendida:** la pista exportada la activa en `data/surfaces.ini` (`WAV_PITCH=extended-0` en `[SURFACE_0]` y una sección `[DYNAMIC_OBJECTS_ATC_CONES]` con la masa). Sin CSP, AC no puede abrir una pista con conos derribables.
   - **Desactivada:** los conos se atraviesan y cada cono tocado suma **2 s** a la vuelta. Un script de pista de Custom Shaders Patch avisa al tocarlo y, al cerrar la vuelta, muestra el tiempo con la penalización. AC no deja cambiar el tiempo oficial de la vuelta, así que la penalización solo aparece en ese aviso. Sin CSP no hay penalización.
5. **Brush**: arrastra para esparcir **arena** o **grava**, con el tamaño que elijas. Funciona como el pincel de máscaras de Lightroom: lo pintado aparece mientras arrastras y repasar (también sin soltar) ensucia más. El pincel se difumina desde el centro, que deja el 75 % de una pasada completa. En AC reduce el agarre en tres niveles según lo cargada que esté la zona y ensucia los neumáticos. En modo *Borrar* quita las pasadas que toque el pincel.
6. **Desnivelador** (*Positivo* / *Negativo*): sube o baja el suelo por donde arrastras, igual que el Brush. Una pasada deja ±7,5 cm en el centro y el desnivel queda entre −1 m y 5 m. En el mapa libre y en los escenarios 3D (Isla Mágica, ETSI) se deforma el propio suelo, conservando su textura. Sobre los circuitos de AC solo se puede subir: se añade un parche sobre su suelo, porque sus kn5 no se modifican.
7. **Vista topográfica** (botón en los ajustes del Desnivelador): cambia el satélite por el desnivel a color, con escala fija: verde el suelo original, azul −1 m y rojo 5 m. Solo se ve con el Desnivelador activo.
8. **Exportar** → *Instalar en Assetto Corsa* o *Descargar ZIP*.

**Editar circuito** (menú principal): elige el .zip de un circuito exportado (el de *Descargar ZIP*, o la carpeta de la pista comprimida) y se abre de nuevo en el editor. La exportación guarda el proyecto en `atc/project.json`, con la firma de la app y la versión del formato. Un .zip que no sea un circuito de Assetto Track Creator da un error.

## Presets con escenario 3D

El desplegable **Presets**, junto a «Menú», ofrece dos escenarios modelados a mano en Blender a partir de imágenes de Google Maps, Street View y la ortofoto PNOA: **Parking Isla Mágica** (parking de asfalto con farolas, caseta de seguridad y muros de chapa) y **Pistas ETSI** (pista verde hundida que pasa bajo un puente y desemboca en un segundo círculo verde). Al elegir una, el área queda fijada y, al exportar, la pista incluye el escenario 3D (`models.ini` con dos modelos), con conos, líneas y coches apoyados en el terreno.

- Modelos editables: `presets/<id>/<id>.blend` (Git LFS).
- Escenarios exportados: `public/presets/<id>/` (kn5, `terrain.json`, `manifest.json`, `preview.jpg`).
- Pipeline (escena medida en `tools/presets/scenes/<id>.py` → `.blend` → kn5): `tools/presets/`. Con `-ExportOnly` se reexporta un `.blend` retocado a mano.

```bash
powershell -File tools/presets/build_preset.ps1 etsi
```

Referencias visuales: Google Maps y Street View (solo para medir) y PNOA máxima actualidad (CC-BY 4.0 scne.es). Texturas CC0 de [Poly Haven](https://polyhaven.com).

### Circuitos de Assetto Corsa

El mismo desplegable ofrece circuitos ya instalados en AC: **Circuit de Barcelona-Catalunya** y **Hockenheimring**. Sobre ellos el área se delimita libremente y la app solo genera los conos, las líneas y los puntos de salida; el suelo es el del circuito (no se genera asfalto ni zonas de «Tipo de suelo»). La pista exportada carga los kn5 del circuito instalado con rutas `../<circuito>/…`, sin copiarlos.

Dependencias (deben estar en `assettocorsa/content/tracks`):

| Preset | Carpeta | Origen |
|---|---|---|
| Circuit de Barcelona-Catalunya | `ks_barcelona` (trazado `layout_gp`) | Kunos, incluido en Assetto Corsa |
| Hockenheimring | `t78_hockenheimring` (trazado `gp`) | **Incluido en el repositorio:** [`resources/tracks/T78_Hockenheimring_AC_v12.zip`](resources/tracks/T78_Hockenheimring_AC_v12.zip). Es el mod [Hockenheimring Multi Layout](https://www.racedepartment.com/downloads/hockenheimring-multi-layout.7223/) de Tommy78 |

Para instalar Hockenheim, descomprime el .zip en `assettocorsa/content/tracks`. Crea la carpeta `t78_hockenheimring`. El .zip va en Git LFS (208 MB): tras clonar, ejecuta `git lfs pull` si no se ha descargado. Es un mod de terceros sin licencia de redistribución, así que no hagas público el repositorio con él dentro.

- El servidor local (`npm run dev`) lee los kn5 del circuito para saber qué modelos cargar y la altura de su suelo bajo el área. Nada derivado del circuito se guarda en el repositorio.
- **Capa «Superficies de AC»** (leyenda abajo a la izquierda): pinta sobre el satélite las superficies físicas del circuito de AC (asfalto de pista, pianos, pit lane, escapatorias asfaltadas, césped y grava). El satélite y el modelo de AC difieren varios metros en algunas zonas, así que construye sobre esta capa, no sobre el asfalto de la foto.
- **Validación en vivo**: la leyenda indica qué porcentaje del trazado cae sobre pavimento de AC y cuántos conos quedan en césped, grava o sin suelo. En el mapa, esos tramos se marcan en rojo y esos conos con borde rojo, y el diálogo de exportación lo repite como aviso. Donde el circuito no tiene suelo físico (p. ej. el paddock de Barcelona) no se puede circular en AC.
- La georreferencia (circuito de AC ↔ mapa) está en `src/domain/presets/sites.json`. Se calcula ajustando la línea de IA del circuito al trazado de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL):

```bash
tools/presets/.venv/Scripts/python.exe tools/presets/georef_circuit.py montmelo
```

## Desarrollo

| Comando | |
|---|---|
| `npm test` | Tests (Vitest) |
| `npm run typecheck` | TypeScript estricto |
| `npm run build` | Build de producción |
| `npx vite-node scripts/export-sample.ts <carpeta>` | Exporta un circuito de ejemplo |

La documentación completa (arquitectura, formato de pista de AC, decisiones y backlog) está en Obsidian: `04 - Memoria Claude/assetto_track_creator`.
