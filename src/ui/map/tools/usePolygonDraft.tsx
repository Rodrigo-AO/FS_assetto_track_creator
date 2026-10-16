import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleMarker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import type { LatLng } from '../../../domain/geo/projection';
import { fromL, toL } from '../leafletUtils';

/** Píxeles por debajo de los cuales dos clics seguidos se consideran el mismo vértice (doble clic). */
const DUPLICATE_PX = 4;

interface PolygonDraft {
  readonly points: readonly LatLng[];
  readonly preview: JSX.Element | null;
}

/**
 * Dibujo de un polígono por clics: clic añade vértice; clic en el primero, doble clic o Enter
 * lo cierran; Retroceso quita el último; Esc cancela.
 */
export function usePolygonDraft(onFinish: (points: LatLng[]) => void, color = '#4BB8E8'): PolygonDraft {
  const map = useMap();
  const [points, setPoints] = useState<LatLng[]>([]);
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const finish = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length >= 3) onFinish(pts);
    setPoints([]);
  }, [onFinish]);

  const sameAsLast = (p: LatLng): boolean => {
    const last = pointsRef.current[pointsRef.current.length - 1];
    return !!last && map.latLngToContainerPoint(toL(last)).distanceTo(map.latLngToContainerPoint(toL(p))) < DUPLICATE_PX;
  };

  useMapEvents({
    click: (e) => {
      const p = fromL(e.latlng);
      if (!sameAsLast(p)) setPoints((pts) => [...pts, p]);
    },
    dblclick: () => finish(),
    mousemove: (e) => setCursor(fromL(e.latlng)),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') finish();
      else if (e.key === 'Escape') setPoints([]);
      else if (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement)) setPoints((pts) => pts.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  const preview =
    points.length === 0 ? null : (
      <>
        {points.length >= 2 && (
          <Polygon pane="drafts" positions={points.map(toL)} interactive={false} pathOptions={{ stroke: false, fillColor: color, fillOpacity: 0.2 }} />
        )}
        <Polyline pane="drafts" positions={points.map(toL)} interactive={false} pathOptions={{ color, weight: 2 }} />
        {cursor && (
          <Polyline pane="drafts" positions={[toL(points[points.length - 1]), toL(cursor)]} interactive={false} pathOptions={{ color, weight: 2, dashArray: '4 6' }} />
        )}
        {points.map((p, i) => (
          <CircleMarker
            key={i}
            pane="drafts"
            center={toL(p)}
            radius={i === 0 ? 7 : 4}
            bubblingMouseEvents={false}
            eventHandlers={i === 0 ? { click: finish } : undefined}
            pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: color, fillOpacity: 1 }}
          />
        ))}
      </>
    );

  return { points, preview };
}
