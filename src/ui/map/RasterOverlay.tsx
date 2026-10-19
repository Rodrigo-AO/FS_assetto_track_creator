import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

/**
 * ImageOverlay de Leaflet que muestra un <canvas> en vez de un <img>: se redibuja al instante con
 * putImageData, sin codificar imágenes, mientras se pinta. Leaflet crea el <img> en `_initImage`;
 * aquí se sustituye por el canvas y el resto (posición, zoom animado) es el de ImageOverlay.
 */
class CanvasOverlay extends L.ImageOverlay {
  constructor(
    readonly canvas: HTMLCanvasElement,
    bounds: L.LatLngBoundsExpression,
    options?: L.ImageOverlayOptions,
  ) {
    super('', bounds, options);
  }

  _initImage(): void {
    const self = this as unknown as { _image: HTMLElement; _zoomAnimated: boolean };
    const el = (self._image = this.canvas);
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if (self._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    if (this.options.className) L.DomUtil.addClass(el, this.options.className);
    el.onselectstart = L.Util.falseFn;
    el.onmousemove = L.Util.falseFn;
  }
}

export interface Raster {
  readonly image: ImageData;
  /** Esquinas suroeste y noreste en lat/lng. */
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

interface RasterOverlayProps {
  readonly raster: Raster;
  readonly pane: string;
  readonly className?: string;
}

function draw(layer: CanvasOverlay, raster: Raster): void {
  const { canvas } = layer;
  if (canvas.width !== raster.image.width || canvas.height !== raster.image.height) {
    canvas.width = raster.image.width;
    canvas.height = raster.image.height;
  }
  canvas.getContext('2d')!.putImageData(raster.image, 0, 0);
  layer.setBounds(L.latLngBounds([raster.south, raster.west], [raster.north, raster.east]));
}

/** Imagen RGBA alineada con latitud y longitud, redibujada cada vez que cambia `raster`. */
export function RasterOverlay({ raster, pane, className }: RasterOverlayProps) {
  const map = useMap();
  const overlay = useRef<CanvasOverlay | null>(null);
  const latest = useRef(raster);
  latest.current = raster;

  useEffect(() => {
    const r = latest.current;
    const layer = new CanvasOverlay(document.createElement('canvas'), [[r.south, r.west], [r.north, r.east]], { pane, className, interactive: false });
    overlay.current = layer;
    layer.addTo(map);
    draw(layer, r);
    return () => {
      layer.remove();
      overlay.current = null;
    };
  }, [map, pane, className]);

  useEffect(() => {
    if (overlay.current) draw(overlay.current, raster);
  }, [raster]);

  return null;
}
