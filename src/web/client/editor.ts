import { state } from './state.ts';

/** Ask the local lcr process to hand one current diff file to the configured editor. */
export async function openFileInEditor(path: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const response = await fetch('/api/open-file', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({path,editor:state.cfg.editor||''}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `the server answered ${response.status}`);
  } catch (error) {
    alert(`Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
  }
}
