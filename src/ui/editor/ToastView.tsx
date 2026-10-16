import { useEffect } from 'react';
import { useEditorStore } from '../../state/editorStore';

const TOAST_MS = 3500;

export function ToastView() {
  const toast = useEditorStore((s) => s.toast);
  const setEditor = useEditorStore((s) => s.set);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setEditor({ toast: null }), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, setEditor]);
  return toast ? (
    <div className={`toast toast-${toast.kind}`} role="status">
      {toast.text}
    </div>
  ) : null;
}
