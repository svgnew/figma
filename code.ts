/// <reference types="@figma/plugin-typings" />

// The svg.new API allows 10 vectorizations a minute per account, so one run takes up to 10 layers.
const MAX_LAYERS = 10;
// Layers are exported so their longest side is about this many pixels (never more than 4x).
const EXPORT_LONG_SIDE = 2048;
const MAX_EXPORT_SCALE = 4;
const GAP = 40;

type UiMessage =
  | { type: 'get-key' }
  | { type: 'save-key'; key: string }
  | { type: 'start' }
  | { type: 'export'; id: string }
  | { type: 'insert'; id: string | null; svg: string }
  | { type: 'finish' }
  | { type: 'open-url'; url: string };

figma.showUI(__html__, { width: 360, height: 540, themeColors: true });

let inserted: SceneNode[] = [];

function post(msg: Record<string, unknown>) {
  figma.ui.postMessage(msg);
}

function exportable(node: SceneNode): boolean {
  return 'exportAsync' in node && node.width > 0 && node.height > 0;
}

function sendSelection() {
  const count = figma.currentPage.selection.filter(exportable).length;
  post({ type: 'selection', count, max: MAX_LAYERS });
}

figma.on('selectionchange', sendSelection);
figma.on('currentpagechange', sendSelection);

async function findSceneNode(id: string): Promise<SceneNode | null> {
  const node = await figma.getNodeByIdAsync(id);
  return node && 'visible' in node ? (node as SceneNode) : null;
}

function place(svgNode: FrameNode, original: SceneNode | null) {
  if (original) {
    // Match the original layer's size and put the vector to its right, in page coordinates.
    const scale = Math.min(original.width / svgNode.width, original.height / svgNode.height);
    if (Number.isFinite(scale) && scale > 0) svgNode.rescale(scale);
    const box = original.absoluteBoundingBox ?? {
      x: original.absoluteTransform[0][2],
      y: original.absoluteTransform[1][2],
      width: original.width,
      height: original.height,
    };
    svgNode.x = box.x + box.width + GAP;
    svgNode.y = box.y;
    svgNode.name = `${original.name} (SVG)`;
  } else {
    const center = figma.viewport.center;
    svgNode.x = center.x - svgNode.width / 2;
    svgNode.y = center.y - svgNode.height / 2;
    svgNode.name = 'svg.new vector';
  }
  figma.currentPage.appendChild(svgNode);
}

figma.ui.onmessage = async (msg: UiMessage) => {
  switch (msg.type) {
    case 'get-key': {
      // The UI asks for the key once it has loaded, so this is also when it gets the selection.
      const key = await figma.clientStorage.getAsync('svgnew_api_key');
      if (typeof key === 'string' && key) post({ type: 'stored-key', key });
      sendSelection();
      break;
    }

    case 'save-key':
      await figma.clientStorage.setAsync('svgnew_api_key', msg.key);
      break;

    case 'start': {
      const nodes = figma.currentPage.selection.filter(exportable);
      if (nodes.length === 0) {
        post({ type: 'error', message: 'Select one or more layers first.' });
        return;
      }
      if (nodes.length > MAX_LAYERS) {
        post({ type: 'error', message: `Select up to ${MAX_LAYERS} layers at a time.` });
        return;
      }
      inserted = [];
      post({ type: 'queue', nodes: nodes.map((n) => ({ id: n.id, name: n.name })) });
      break;
    }

    case 'export': {
      const node = await findSceneNode(msg.id);
      if (!node || !exportable(node)) {
        post({ type: 'export-failed', id: msg.id, message: 'This layer is no longer in the file.' });
        return;
      }
      try {
        const scale = Math.min(MAX_EXPORT_SCALE, EXPORT_LONG_SIDE / Math.max(node.width, node.height));
        const data = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
        post({ type: 'exported', id: msg.id, data });
      } catch {
        post({ type: 'export-failed', id: msg.id, message: 'This layer could not be exported as an image.' });
      }
      break;
    }

    case 'insert': {
      try {
        const original = msg.id ? await findSceneNode(msg.id) : null;
        const svgNode = figma.createNodeFromSvg(msg.svg);
        place(svgNode, original);
        inserted.push(svgNode);
        post({ type: 'inserted', id: msg.id });
      } catch {
        post({ type: 'insert-failed', id: msg.id, message: 'The SVG could not be added to the file.' });
      }
      break;
    }

    case 'finish': {
      const nodes = inserted.filter((n) => !n.removed);
      inserted = [];
      if (nodes.length > 0) {
        figma.currentPage.selection = nodes;
        figma.viewport.scrollAndZoomIntoView(nodes);
        figma.notify(nodes.length === 1 ? 'Added 1 vector layer' : `Added ${nodes.length} vector layers`);
      }
      break;
    }

    case 'open-url':
      if (/^https:\/\/svg\.new(\/|$)/.test(msg.url)) figma.openExternal(msg.url);
      break;
  }
};
