import type { ComponentType } from 'react';
import { useEditorStore, type ToolId } from '../../state/editorStore';
import { AreaIcon, ChevronLeftIcon, ChevronRightIcon, ConeIcon, FlagIcon, SectorIcon, SurfaceIcon, BrushIcon, ReliefIcon, TrackIcon } from '../icons';
import { circuitPresetById } from '../../domain/presets/presets';
import { useProjectStore } from '../../state/projectStore';
import { useScene } from './sceneContext';

interface ToolEntry {
  readonly id: ToolId;
  readonly label: string;
  readonly Icon: ComponentType<{ size?: number }>;
}

export const TOOLS: readonly ToolEntry[] = [
  { id: 'area', label: 'Delimitar área', Icon: AreaIcon },
  { id: 'track', label: 'Track creator', Icon: TrackIcon },
  { id: 'cones', label: 'Conos', Icon: ConeIcon },
  { id: 'startFinish', label: 'Salida / Meta', Icon: FlagIcon },
  { id: 'sectors', label: 'Sectores', Icon: SectorIcon },
  { id: 'surface', label: 'Tipo de suelo', Icon: SurfaceIcon },
  { id: 'brush', label: 'Brush', Icon: BrushIcon },
  { id: 'relief', label: 'Desnivelador', Icon: ReliefIcon },
];

export function Toolbar() {
  const scene = useScene();
  const tool = useEditorStore((s) => s.tool);
  const collapsed = useEditorStore((s) => s.toolbarCollapsed);
  const setEditor = useEditorStore((s) => s.set);
  const hasArea = scene !== null;
  // Sobre un circuito de AC no se genera suelo: solo conos, líneas y salida.
  const onCircuit = circuitPresetById(useProjectStore((s) => s.project.preset)) !== null;

  return (
    <nav className={`toolbar ${collapsed ? 'toolbar-collapsed' : ''}`} aria-label="Herramientas">
      <button
        className="toolbar-toggle"
        onClick={() => setEditor({ toolbarCollapsed: !collapsed })}
        title={collapsed ? 'Desplegar herramientas' : 'Plegar herramientas'}
      >
        {collapsed ? <ChevronRightIcon size={16} /> : <><ChevronLeftIcon size={16} /> <span>Herramientas</span></>}
      </button>
      {TOOLS.map(({ id, label, Icon }) => {
        const blocked = id === 'surface' && onCircuit;
        const enabled = (id === 'area' || hasArea) && !blocked;
        return (
          <button
            key={id}
            className="toolbar-item"
            aria-pressed={tool === id}
            disabled={!enabled}
            title={enabled ? label : blocked ? `${label} — no disponible sobre un circuito: se conduce sobre su propio suelo` : `${label} — delimita primero un área`}
            onClick={() => setEditor({ tool: tool === id ? null : id, selectedZoneId: null })}
          >
            <Icon size={20} />
            {!collapsed && <span>{label}</span>}
          </button>
        );
      })}
    </nav>
  );
}
