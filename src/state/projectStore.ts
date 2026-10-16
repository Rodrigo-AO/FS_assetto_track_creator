import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createEmptyProject, type TrackProject } from '../domain/project/types';

const HISTORY_LIMIT = 100;

type Update = (p: TrackProject) => TrackProject;

interface ProjectState {
  project: TrackProject;
  past: TrackProject[];
  future: TrackProject[];
  /** Aplica un cambio y lo registra en el historial (deshacer/rehacer). */
  commit: (update: Update) => void;
  /** Guarda el estado actual en el historial antes de una edición continua (arrastre). */
  checkpoint: () => void;
  /** Aplica un cambio sin registrarlo (cada movimiento de un arrastre). */
  preview: (update: Update) => void;
  undo: () => void;
  redo: () => void;
  reset: (project?: TrackProject) => void;
}

const pushPast = (past: TrackProject[], p: TrackProject): TrackProject[] => [...past.slice(-(HISTORY_LIMIT - 1)), p];

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      project: createEmptyProject(),
      past: [],
      future: [],
      commit: (update) =>
        set((s) => {
          const next = update(s.project);
          return next === s.project ? s : { project: next, past: pushPast(s.past, s.project), future: [] };
        }),
      checkpoint: () => set((s) => ({ past: pushPast(s.past, s.project), future: [] })),
      preview: (update) => set((s) => ({ project: update(s.project) })),
      undo: () =>
        set((s) => (s.past.length ? { project: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.project, ...s.future] } : s)),
      redo: () => set((s) => (s.future.length ? { project: s.future[0], future: s.future.slice(1), past: pushPast(s.past, s.project) } : s)),
      reset: (project = createEmptyProject()) => set({ project, past: [], future: [] }),
    }),
    {
      name: 'atc.project.v1',
      partialize: (s) => ({ project: s.project }),
      // Borradores de versiones anteriores: completa los campos nuevos (p. ej. `preset`).
      merge: (persisted, current) => ({
        ...current,
        project: { ...createEmptyProject(), ...((persisted as { project?: Partial<TrackProject> })?.project ?? {}) },
      }),
    },
  ),
);

/** Hay un borrador con contenido que merece la pena retomar. */
export const hasDraft = (p: TrackProject): boolean => p.area !== null;
