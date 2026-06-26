import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export async function openTilesetEditor(): Promise<void> {
  const label = 'tileset-editor';
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setDecorations(false);
    await existing.setShadow(true);
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: 'tileset-editor.html',
    title: 'Tileset Editor',
    width: 1080,
    height: 745,
    minWidth: 820,
    minHeight: 560,
    resizable: true,
    decorations: false,
    transparent: true,
    shadow: true,
    backgroundColor: [0, 0, 0, 0]
  });
  win.once('tauri://created', () => {
    void win.setDecorations(false);
    void win.setShadow(true);
  });
  win.once('tauri://error', (e) => console.error('Failed to open tileset editor', e));
}
