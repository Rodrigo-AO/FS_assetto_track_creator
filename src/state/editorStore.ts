import { create } from 'zustand';
import type { ConeColor, SurfaceType } from '../domain/project/types';

export type Screen = 'menu' | 'editor';
export type ToolId = 'area' | 'cones' | 'startFinish' | 'sectors' | 'surface' | 'track';
export type AreaMode = 'polygon' | 'rectangle';
export type TrackMode = 'points' | 'bezier' | 'freehand';

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly kind: 'info' | 'error' | 'success';
}

interface EditorState {
  screen: Screen;
  tool: ToolId | null;
  toolbarCollapsed: boolean;
  areaMode: AreaMode;
  coneColor: ConeColor;
  surfaceBrush: SurfaceType;
  trackMode: TrackMode;
  selectedZoneId: string | null;
  exportOpen: boolean;
  /** Barra espaciadora pulsada: el arrastre mueve el mapa aunque la herramienta lo use. */
  spacePan: boolean;
  /** Se incrementa para pedir al mapa que encuadre el área (p. ej. al elegir un preset). */
  fitRequest: number;
  /** Capa con las superficies del circuito de AC (asfalto, pianos, césped…) sobre el satélite. */
  showCircuitLayer: boolean;
  toast: Toast | null;
  set: (patch: Partial<Omit<EditorState, 'set' | 'notify'>>) => void;
  notify: (text: string, kind?: Toast['kind']) => void;
}

export const useEditorStore = create<EditorState>()((set) => ({
  screen: 'menu',
  tool: null,
  toolbarCollapsed: false,
  areaMode: 'polygon',
  coneColor: 'blue',
  surfaceBrush: 'grass',
  trackMode: 'points',
  selectedZoneId: null,
  exportOpen: false,
  spacePan: false,
  fitRequest: 0,
  showCircuitLayer: true,
  toast: null,
  set: (patch) => set(patch),
  notify: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),
}));
