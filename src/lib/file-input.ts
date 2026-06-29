import type { DragEvent } from 'react';

const FILE_DRAG_TYPE = 'Files';

export const isFileDragEvent = (event: DragEvent<HTMLElement>) =>
  Array.from(event.dataTransfer?.types ?? []).includes(FILE_DRAG_TYPE);

export const allowFileDrop = (event: DragEvent<HTMLElement>) => {
  if (!isFileDragEvent(event)) return;
  event.preventDefault();
};

export const getDroppedFiles = (event: DragEvent<HTMLElement>) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return [];

  event.preventDefault();
  event.stopPropagation();
  return files;
};
