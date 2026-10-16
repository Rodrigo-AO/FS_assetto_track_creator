import { useEditorStore } from '../../state/editorStore';
import { hasDraft, useProjectStore } from '../../state/projectStore';
import { ConeIcon, EditIcon, PlusIcon } from '../icons';
import './MainMenu.css';

export function MainMenu() {
  const project = useProjectStore((s) => s.project);
  const reset = useProjectStore((s) => s.reset);
  const setEditor = useEditorStore((s) => s.set);

  const openEditor = (fresh: boolean): void => {
    if (fresh) reset();
    setEditor({ screen: 'editor', tool: fresh ? 'area' : null, exportOpen: false });
  };

  const createNew = (): void => {
    if (hasDraft(project) && !window.confirm(`Se descartará el borrador «${project.name}». ¿Crear un circuito nuevo?`)) return;
    openEditor(true);
  };

  return (
    <main className="menu">
      <div className="menu-card">
        <div className="menu-brand">
          <span className="menu-logo">
            <ConeIcon size={30} />
          </span>
          <div>
            <h1>Assetto Track Creator</h1>
            <p className="muted">Diseña circuitos de conos sobre el mapa y llévalos a Assetto Corsa.</p>
          </div>
        </div>

        <div className="menu-actions">
          <button className="menu-option menu-option-primary" onClick={createNew}>
            <PlusIcon size={26} />
            <span>
              <strong>Crear circuito</strong>
              <small>Elige una zona en el mapa satélite y traza la pista</small>
            </span>
          </button>
          <button className="menu-option" disabled title="Próximamente">
            <EditIcon size={26} />
            <span>
              <strong>
                Editar circuito <em className="menu-tag">Próximamente</em>
              </strong>
              <small>Abre un circuito exportado para modificarlo</small>
            </span>
          </button>
        </div>

        {hasDraft(project) && (
          <button className="menu-resume" onClick={() => openEditor(false)}>
            Continuar con el borrador «{project.name}»
          </button>
        )}
      </div>
    </main>
  );
}
