import { useEditorStore } from '../state/editorStore';
import { EditorScreen } from './editor/EditorScreen';
import { MainMenu } from './menu/MainMenu';

export function App() {
  const screen = useEditorStore((s) => s.screen);
  return screen === 'menu' ? <MainMenu /> : <EditorScreen />;
}
