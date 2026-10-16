import L from 'leaflet';
import type { LatLng } from '../../domain/geo/projection';
import type { Vec2 } from '../../domain/geometry/vec2';
import type { Scene } from '../../domain/project/scene';

export type LPoint = [number, number];

export const toL = (p: LatLng): LPoint => [p.lat, p.lng];
export const fromL = (p: L.LatLng): LatLng => ({ lat: p.lat, lng: p.lng });
export const localToL = (scene: Scene, v: Vec2): LPoint => toL(scene.projection.toLatLng(v));

/** Panes propios para ordenar las capas por encima de la imagen satélite. */
export const PANES = {
  mask: 410,
  zones: 420,
  track: 430,
  gates: 440,
  cones: 450,
  drafts: 460,
} as const;

export type PaneName = keyof typeof PANES;

const divIcon = (className: string, size: number): L.DivIcon =>
  L.divIcon({ className, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

export const ICONS = {
  vertex: divIcon('map-handle map-handle-vertex', 12),
  anchor: divIcon('map-handle map-handle-anchor', 14),
  anchorBezier: divIcon('map-handle map-handle-anchor-bezier', 14),
  anchorFirst: divIcon('map-handle map-handle-anchor map-handle-first', 16),
  control: divIcon('map-handle map-handle-control', 10),
  width: divIcon('map-handle map-handle-width', 12),
};

const coneIcons = new Map<string, L.DivIcon>();
export function coneIcon(color: string, size: number): L.DivIcon {
  const key = `${color}-${size}`;
  if (!coneIcons.has(key)) {
    coneIcons.set(
      key,
      L.divIcon({
        className: 'map-cone',
        html: `<span style="background:${color};width:${size}px;height:${size}px"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      }),
    );
  }
  return coneIcons.get(key)!;
}

/** Evita el menú contextual del navegador en los clics derechos sobre elementos del mapa. */
export const stopContextMenu = (e: L.LeafletMouseEvent): void => {
  L.DomEvent.preventDefault(e.originalEvent);
};
