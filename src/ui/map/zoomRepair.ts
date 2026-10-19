/**
 * Arreglos del zoom de Leaflet con gestos rápidos (rueda o pellizco del touchpad, sobre todo al
 * llegar al zoom máximo). Usa campos internos de Leaflet 1.9 (`_paneRenderers`, `_animatingZoom`,
 * `_tileZoom`): si se actualiza Leaflet, revisar.
 */
import L from 'leaflet';

/**
 * Margen de las capas vectoriales (fracción de la pantalla por cada lado). Leaflet usa 0,1: al
 * alejar rápido se veía el borde de la máscara y del trazado como un rectángulo sobre el mapa.
 */
const RENDERER_PADDING = 0.5;

interface RendererInternals {
  _zoom?: number;
  _center?: L.LatLng;
  _reset(): void;
}

interface MapInternals {
  _animatingZoom?: boolean;
  _paneRenderers?: Record<string, RendererInternals>;
  _createRenderer(options: L.RendererOptions): L.Renderer;
}

/** Hace que los renderizadores SVG de cada pane se creen con más margen. */
export function widenRenderers(map: L.Map): void {
  (map as unknown as MapInternals)._createRenderer = (options) => L.svg({ ...options, padding: RENDERER_PADDING });
}

/**
 * Tras cada zoom o desplazamiento, repone las capas que se hayan quedado con la vista anterior: un
 * renderizador vectorial con otro zoom (trazado cortado, máscara desplazada) o teselas del satélite
 * de otro nivel superpuestas.
 */
export function repairAfterZoom(map: L.Map): () => void {
  const internals = map as unknown as MapInternals;
  let frame = 0;
  const check = (): void => {
    frame = 0;
    if (internals._animatingZoom) return;
    const zoom = map.getZoom();
    const center = map.getCenter();
    for (const renderer of Object.values(internals._paneRenderers ?? {})) {
      if (renderer._zoom !== zoom || !renderer._center?.equals(center)) renderer._reset();
    }
    map.eachLayer((layer) => {
      if (!(layer instanceof L.GridLayer)) return;
      const grid = layer as unknown as { _tileZoom?: number; _clampZoom(z: number): number };
      if (grid._tileZoom !== undefined && grid._tileZoom !== grid._clampZoom(Math.round(zoom))) layer.redraw();
    });
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(check);
  };
  map.on('zoomend moveend', schedule);
  return () => {
    cancelAnimationFrame(frame);
    map.off('zoomend moveend', schedule);
  };
}
