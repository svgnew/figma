/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 360, height: 480, themeColors: true });

figma.ui.onmessage = async (msg: { type: string; svg?: string; error?: string }) => {
  if (msg.type === 'vectorize-selection') {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Select a layer first' });
      return;
    }

    const node = selection[0];
    figma.ui.postMessage({ type: 'status', message: 'Exporting layer...' });

    try {
      const imageBytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 },
      });
      figma.ui.postMessage({ type: 'image-data', data: Array.from(imageBytes) });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'error', message: 'Failed to export layer' });
    }
  }

  if (msg.type === 'insert-svg' && msg.svg) {
    try {
      const svgNode = figma.createNodeFromSvg(msg.svg);
      const selection = figma.currentPage.selection;
      if (selection.length > 0) {
        svgNode.x = selection[0].x + selection[0].width + 50;
        svgNode.y = selection[0].y;
      }
      figma.currentPage.appendChild(svgNode);
      figma.currentPage.selection = [svgNode];
      figma.viewport.scrollAndZoomIntoView([svgNode]);
      figma.notify('SVG vector inserted!');
      figma.ui.postMessage({ type: 'done' });
    } catch (e: any) {
      figma.ui.postMessage({ type: 'error', message: 'Failed to insert SVG' });
    }
  }
};
