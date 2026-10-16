import type { ComponentType } from 'react';
import { useEditorStore, type ToolId } from '../../state/editorStore';
import { AreaIcon, ChevronLeftIcon, ChevronRightIcon, ConeIcon, FlagIcon, SectorIcon, SurfaceIcon, TrackIcon } from '../icons';
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
];

export function Toolbar() {
  const scene = useScene();
  const tool = useEditorStore((s) => s.tool);
  const collapsed = useEditorStore((s) => s.toolbarCollapsed);
  const setEditor = useEditorStore((s) => s.set);
  const hasArea = scene !== null;

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
        const enabled = id === 'area' || hasArea;
        return (
          <button
            key={id}
            className="toolbar-item"
            aria-pressed={tool === id}
            disabled={!enabled}
            title={enabled ? label : `${label} — delimita primero un área`}
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
