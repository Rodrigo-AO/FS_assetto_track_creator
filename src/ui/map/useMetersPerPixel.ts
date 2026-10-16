import { useState } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';

/** Metros por píxel de pantalla en el zoom actual (Web Mercator). */
export function useMetersPerPixel(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return (156543.03392 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** zoom;
}
