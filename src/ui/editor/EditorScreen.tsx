import { useEffect, useMemo } from 'react';
import { buildScene } from '../../domain/project/scene';
import { setName } from '../../domain/project/actions';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { BackIcon, ExportIcon, RedoIcon, UndoIcon } from '../icons';
import { MapView } from '../map/MapView';
import { ExportDialog } from './ExportDialog';
import { HintBar } from './HintBar';
import { PresetMenu } from './PresetMenu';
import { SceneContext } from './sceneContext';
import { ToastView } from './ToastView';
import { Toolbar } from './Toolbar';
import { ToolPanel } from './ToolPanel';
import './Editor.css';

function useKeyboardShortcuts(): void {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const setEditor = useEditorStore((s) => s.set);
  useEffect(() => {
    const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent): void => {
      if (typing(e)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setEditor({ spacePan: true });
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setEditor({ spacePan: false });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [undo, redo, setEditor]);
}

export function EditorScreen() {
  const project = useProjectStore((s) => s.project);
  const preview = useProjectStore((s) => s.preview);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const exportOpen = useEditorStore((s) => s.exportOpen);
  const setEditor = useEditorStore((s) => s.set);
  const scene = useMemo(() => buildScene(project), [project]);
  useKeyboardShortcuts();

  return (
    <SceneContext.Provider value={scene}>
      <div className="editor">
        <header className="editor-header">
          <div className="row">
            <button className="btn btn-sm" onClick={() => setEditor({ screen: 'menu', tool: null })}>
              <BackIcon size={16} /> Menú
            </button>
            <PresetMenu />
          </div>
          <input
            className="input editor-name"
            value={project.name}
            onChange={(e) => preview((p) => setName(p, e.target.value))}
            aria-label="Nombre del circuito"
            maxLength={60}
          />
          <div className="row">
            <button className="btn btn-icon btn-sm" onClick={undo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">
              <UndoIcon size={16} />
            </button>
            <button className="btn btn-icon btn-sm" onClick={redo} disabled={!canRedo} title="Rehacer (Ctrl+Y)">
              <RedoIcon size={16} />
            </button>
          </div>
        </header>

        <div className="editor-body">
          <MapView />
          <Toolbar />
          <ToolPanel />
          <button className="btn btn-primary editor-export" onClick={() => setEditor({ exportOpen: true })} disabled={!scene}>
            <ExportIcon size={18} /> Exportar
          </button>
          <HintBar />
          <ToastView />
          {exportOpen && <ExportDialog />}
        </div>
      </div>
    </SceneContext.Provider>
  );
}
